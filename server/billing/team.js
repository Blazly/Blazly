import crypto from "crypto";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { adminAuth, firebaseAdminConfigured } from "../firebaseAdmin.js";
import { getCreditAccount, updateCreditAccount } from "../credits/store.js";
import { PLANS } from "../../src/plans.js";

function db() {
  adminAuth();
  return getFirestore();
}

function fail(message, status, code) {
  return Object.assign(new Error(message), { status, code });
}

function teamRef(ownerUid) {
  return db().collection("teams").doc(ownerUid);
}

/** Max teammates on the plan (owner is not counted). Business = 3 teammates. */
export function seatLimit(plan) {
  return PLANS[plan]?.seats || 1;
}

function teammatesInUse(members, invites) {
  return (members?.length || 0) + (invites?.length || 0);
}

/**
 * Which account pays for and sets the plan of a user's runs.
 * Team members bill the owner while the owner is on a plan with seats and still lists them.
 */
export async function resolveBilling(uid) {
  const account = await getCreditAccount(uid);
  if (account.teamOwner) {
    const [owner, team] = await Promise.all([getCreditAccount(account.teamOwner), teamRef(account.teamOwner).get()]);
    const member = team.exists && (team.data().members || []).some((m) => m.uid === uid);
    if (member && seatLimit(owner.plan) > 1) {
      return { billingUid: account.teamOwner, plan: owner.plan || "free", account: owner, teamOwner: account.teamOwner };
    }
  }
  return { billingUid: uid, plan: PLANS[account.plan] ? account.plan : "free", account, teamOwner: null };
}

export async function planOf(uid) {
  if (!uid || !firebaseAdminConfigured()) return "business";
  return (await resolveBilling(uid)).plan;
}

export async function getTeam(uid) {
  const billing = await resolveBilling(uid);
  if (billing.teamOwner) {
    const owner = await adminAuth().getUser(billing.teamOwner);
    return { role: "member", ownerUid: billing.teamOwner, ownerEmail: owner.email, ownerName: owner.displayName || owner.email?.split("@")[0] || "", plan: billing.plan };
  }
  const snap = await teamRef(uid).get();
  const data = snap.exists ? snap.data() : {};
  return {
    role: "owner",
    plan: billing.plan,
    seats: seatLimit(billing.plan),
    members: data.members || [],
    invites: (data.invites || []).map(({ email, createdAt }) => ({ email, createdAt })),
  };
}

export async function inviteMember(ownerUid, rawEmail) {
  const email = String(rawEmail || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw fail("Enter a valid email address.", 400);
  const { plan, teamOwner } = await resolveBilling(ownerUid);
  if (teamOwner) throw fail("Only the team owner can invite people.", 403);
  const seats = seatLimit(plan);
  if (seats <= 1) throw fail("Team seats are available on the Business plan.", 403, "plan_required");
  const owner = await adminAuth().getUser(ownerUid);
  if (owner.email?.toLowerCase() === email) throw fail("You're already on the team.", 400);

  const token = crypto.randomBytes(18).toString("base64url");
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(teamRef(ownerUid));
    const data = snap.exists ? snap.data() : { members: [], invites: [] };
    const members = data.members || [];
    const invites = (data.invites || []).filter((i) => i.email !== email);
    if (members.some((m) => m.email === email)) throw fail("That person is already on your team.", 400);
    if (teammatesInUse(members, invites) >= seats) {
      throw fail(`Your plan includes ${seats} teammate seats and they're all taken. Remove someone to invite a new person.`, 403);
    }
    invites.push({ email, tokenHash: hash(token), createdAt: new Date().toISOString() });
    tx.set(teamRef(ownerUid), { members, invites, ownerEmail: owner.email || "", updatedAt: FieldValue.serverTimestamp() });
    tx.set(db().collection("teamInvites").doc(hash(token)), { ownerUid, email, createdAt: FieldValue.serverTimestamp() });
  });
  return { token, email, ownerEmail: owner.email, ownerName: owner.displayName || "" };
}

function hash(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

export async function acceptInvite(uid, token) {
  const user = await adminAuth().getUser(uid);
  const inviteRef = db().collection("teamInvites").doc(hash(token));
  const invite = await inviteRef.get();
  if (!invite.exists) throw fail("This invite link is invalid or was already used.", 404);
  const { ownerUid, email } = invite.data();
  if (ownerUid === uid) throw fail("That's your own team.", 400);
  if ((user.email || "").toLowerCase() !== email) {
    throw fail(`This invite was sent to ${email}. Sign in with that email to join.`, 403);
  }
  const account = await getCreditAccount(uid);
  if (account.stripeSubscriptionId && account.subscriptionStatus === "active") {
    throw fail("Cancel your own paid plan before joining a team.", 409);
  }

  await db().runTransaction(async (tx) => {
    const snap = await tx.get(teamRef(ownerUid));
    const data = snap.exists ? snap.data() : { members: [], invites: [] };
    const invites = (data.invites || []).filter((i) => i.email !== email);
    const members = (data.members || []).filter((m) => m.uid !== uid);
    members.push({ uid, email, joinedAt: new Date().toISOString() });
    tx.set(teamRef(ownerUid), { ...data, members, invites, updatedAt: FieldValue.serverTimestamp() });
    tx.delete(inviteRef);
  });
  await updateCreditAccount(uid, { teamOwner: ownerUid });
  return { ok: true };
}

export async function removeMember(ownerUid, target) {
  const email = String(target || "").trim().toLowerCase();
  let removedUid = null;
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(teamRef(ownerUid));
    if (!snap.exists) return;
    const data = snap.data();
    const member = (data.members || []).find((m) => m.email === email || m.uid === target);
    removedUid = member?.uid || null;
    const invite = (data.invites || []).find((i) => i.email === email);
    if (invite) tx.delete(db().collection("teamInvites").doc(invite.tokenHash));
    tx.set(teamRef(ownerUid), {
      ...data,
      members: (data.members || []).filter((m) => m !== member),
      invites: (data.invites || []).filter((i) => i.email !== email),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
  if (removedUid) await updateCreditAccount(removedUid, { teamOwner: null });
}

export async function leaveTeam(uid) {
  const account = await getCreditAccount(uid);
  if (!account.teamOwner) return;
  await removeMember(account.teamOwner, uid);
  await updateCreditAccount(uid, { teamOwner: null });
}
