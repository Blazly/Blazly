import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { adminAuth } from "../firebaseAdmin.js";
import { FREE_STARTING_CREDITS } from "./pricing.js";

function db() {
  adminAuth();
  return getFirestore();
}

function fail(message, status, extra = {}) {
  return Object.assign(new Error(message), { status, ...extra });
}

function freshAccount() {
  return {
    balance: FREE_STARTING_CREDITS,
    granted: FREE_STARTING_CREDITS,
    used: 0,
    plan: "free",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export async function getCreditAccount(uid) {
  const ref = db().collection("credits").doc(uid);
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists) return snap.data();
    const account = freshAccount();
    tx.set(ref, account);
    tx.set(ref.collection("transactions").doc(), {
      type: "grant",
      amount: FREE_STARTING_CREDITS,
      label: "Free starter credits",
      createdAt: FieldValue.serverTimestamp(),
    });
    return account;
  });
}

/** Holds credits before an agent runs; throws 402 when the balance is too low. */
export async function reserveCredits(uid, amount, { agent, label, source, minimum }) {
  const ref = db().collection("credits").doc(uid);
  const txRef = ref.collection("transactions").doc();
  let held = amount;
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const account = snap.exists ? snap.data() : freshAccount();
    if (!snap.exists) {
      tx.set(ref.collection("transactions").doc(), {
        type: "grant",
        amount: FREE_STARTING_CREDITS,
        label: "Free starter credits",
        createdAt: FieldValue.serverTimestamp(),
      });
    }
    const floor = minimum ?? amount;
    if (account.balance < floor) {
      throw fail(
        `Not enough credits: ${label} needs ${floor === amount ? amount : `at least ${floor}`} and you have ${account.balance} left.`,
        402,
        { code: "insufficient_credits", required: floor, balance: account.balance },
      );
    }
    held = Math.min(amount, account.balance);
    tx.set(ref, {
      ...account,
      balance: account.balance - held,
      used: (account.used || 0) + held,
      updatedAt: new Date().toISOString(),
    });
    tx.set(txRef, {
      type: "charge",
      status: "reserved",
      agent,
      label,
      source: source || "app",
      reserved: held,
      amount: held,
      createdAt: FieldValue.serverTimestamp(),
    });
  });
  return { txId: txRef.id, reserved: held };
}

/** Final charge: refunds the difference between what was reserved and what the run actually cost. */
export async function settleCredits(uid, txId, finalAmount) {
  const ref = db().collection("credits").doc(uid);
  const txRef = ref.collection("transactions").doc(txId);
  await db().runTransaction(async (tx) => {
    const [snap, txSnap] = await Promise.all([tx.get(ref), tx.get(txRef)]);
    if (!snap.exists || !txSnap.exists || txSnap.data().status !== "reserved") return;
    const reserved = txSnap.data().reserved;
    const amount = Math.max(0, Math.min(reserved, Math.round(finalAmount)));
    const refund = reserved - amount;
    const account = snap.data();
    tx.update(ref, {
      balance: account.balance + refund,
      used: Math.max(0, (account.used || 0) - refund),
      updatedAt: new Date().toISOString(),
    });
    tx.update(txRef, { status: amount === 0 ? "refunded" : "settled", amount, settledAt: FieldValue.serverTimestamp() });
  });
}

/**
 * Adds purchased or renewed credits. `eventId` makes Stripe webhook retries idempotent.
 * Unused credits roll over.
 */
export async function grantCredits(uid, amount, { eventId, label, patch = {} }) {
  const ref = db().collection("credits").doc(uid);
  const txRef = eventId ? ref.collection("transactions").doc(`evt_${eventId}`) : ref.collection("transactions").doc();
  await db().runTransaction(async (tx) => {
    const [snap, txSnap] = await Promise.all([tx.get(ref), tx.get(txRef)]);
    if (txSnap.exists) return;
    const account = snap.exists ? snap.data() : freshAccount();
    tx.set(ref, {
      ...account,
      balance: account.balance + amount,
      granted: (account.granted || 0) + amount,
      ...patch,
      updatedAt: new Date().toISOString(),
    });
    tx.set(txRef, { type: "grant", amount, label, createdAt: FieldValue.serverTimestamp() });
  });
}

export async function updateCreditAccount(uid, patch) {
  const ref = db().collection("credits").doc(uid);
  await getCreditAccount(uid);
  await ref.set({ ...patch, updatedAt: new Date().toISOString() }, { merge: true });
}

export async function findUidByCustomer(customerId) {
  const snap = await db().collection("credits").where("stripeCustomerId", "==", customerId).limit(1).get();
  return snap.empty ? null : snap.docs[0].id;
}

export async function recentTransactions(uid, limit = 25) {
  const snap = await db()
    .collection("credits")
    .doc(uid)
    .collection("transactions")
    .orderBy("createdAt", "desc")
    .limit(limit)
    .get();
  return snap.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      type: data.type,
      status: data.status || null,
      label: data.label,
      agent: data.agent || null,
      amount: data.amount,
      source: data.source || null,
      createdAt: data.createdAt?.toDate?.().toISOString() || null,
    };
  });
}
