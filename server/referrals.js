import { readJson } from "./readJson.js";
import crypto from "crypto";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { adminAuth } from "./firebaseAdmin.js";
import { identify } from "./credits/middleware.js";
import { grantCredits } from "./credits/store.js";

/** Paid to the referrer once, when the referred user makes their first payment (plan or top-up). */
export const REFERRAL_REWARD = 250;
const NEW_ACCOUNT_WINDOW_MS = 24 * 60 * 60 * 1000;

function db() {
  adminAuth();
  return getFirestore();
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}


async function ensureCode(uid) {
  const ref = db().collection("referrals").doc(uid);
  const snap = await ref.get();
  if (snap.exists && snap.data().code) return snap.data();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = crypto.randomBytes(5).toString("base64url").replace(/[-_]/g, "").slice(0, 7).toUpperCase();
    const codeRef = db().collection("referralCodes").doc(code);
    const created = await db().runTransaction(async (tx) => {
      if ((await tx.get(codeRef)).exists) return false;
      tx.set(codeRef, { uid });
      tx.set(ref, { code, joined: 0, earned: 0, createdAt: FieldValue.serverTimestamp() }, { merge: true });
      return true;
    });
    if (created) return { code, joined: 0, earned: 0 };
  }
  throw new Error("Could not create a referral code.");
}

async function claim(newUid, rawCode) {
  const code = String(rawCode || "").trim().toUpperCase();
  if (!/^[A-Z0-9]{4,12}$/.test(code)) return { ok: false, reason: "invalid_code" };

  const codeSnap = await db().collection("referralCodes").doc(code).get();
  if (!codeSnap.exists) return { ok: false, reason: "invalid_code" };
  const referrerUid = codeSnap.data().uid;
  if (referrerUid === newUid) return { ok: false, reason: "self_referral" };

  const user = await adminAuth().getUser(newUid);
  if (Date.now() - new Date(user.metadata.creationTime).getTime() > NEW_ACCOUNT_WINDOW_MS) {
    return { ok: false, reason: "not_new_account" };
  }

  const claimRef = db().collection("referralClaims").doc(newUid);
  const fresh = await db().runTransaction(async (tx) => {
    if ((await tx.get(claimRef)).exists) return false;
    tx.set(claimRef, { referrerUid, code, createdAt: FieldValue.serverTimestamp() });
    tx.set(db().collection("referrals").doc(referrerUid), { joined: FieldValue.increment(1) }, { merge: true });
    return true;
  });
  if (!fresh) return { ok: false, reason: "already_claimed" };
  return { ok: true };
}

export async function rewardReferralOnPayment(paidUid) {
  const claimRef = db().collection("referralClaims").doc(paidUid);
  const referrerUid = await db().runTransaction(async (tx) => {
    const snap = await tx.get(claimRef);
    if (!snap.exists || snap.data().rewardedAt) return null;
    const { referrerUid: uid } = snap.data();
    tx.update(claimRef, { rewardedAt: FieldValue.serverTimestamp() });
    tx.set(
      db().collection("referrals").doc(uid),
      { paid: FieldValue.increment(1), earned: FieldValue.increment(REFERRAL_REWARD) },
      { merge: true },
    );
    return uid;
  });
  if (!referrerUid) return;
  const user = await adminAuth().getUser(paidUid).catch(() => null);
  await grantCredits(referrerUid, REFERRAL_REWARD, {
    eventId: `referral_paid_${paidUid}`,
    label: `Referral bonus: ${user?.email || "a friend"} upgraded`,
  });
}

export function attachReferrals(server) {
  server.middlewares.use(async (req, res, next) => {
    const path = (req.url || "").split("?")[0];
    if (!path.startsWith("/api/referrals")) return next();
    try {
      const who = await identify(req);
      if (!who) return sendJson(res, 401, { error: "Sign in first." });

      if (path === "/api/referrals" && req.method === "GET") {
        const info = await ensureCode(who.uid);
        return sendJson(res, 200, {
          code: info.code,
          joined: info.joined || 0,
          paid: info.paid || 0,
          earned: info.earned || 0,
          reward: REFERRAL_REWARD,
        });
      }

      if (path === "/api/referrals/claim" && req.method === "POST") {
        const body = await readJson(req);
        return sendJson(res, 200, await claim(who.uid, body.code));
      }
    } catch (error) {
      return sendJson(res, 500, { error: error.message || "Referral request failed." });
    }
    return next();
  });
}
