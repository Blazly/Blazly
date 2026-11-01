import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { adminAuth, firebaseAdminConfigured } from "../firebaseAdmin.js";
import { PLANS } from "../../src/plans.js";
import { planOf } from "./team.js";

/** Server-side list of each user's projects so plan project limits can't be bypassed from the browser. */
function ref(uid) {
  adminAuth();
  return getFirestore().collection("projectRegistry").doc(uid);
}

function clean(name) {
  return String(name || "").trim().slice(0, 120);
}

export function projectLimit(plan) {
  return PLANS[plan]?.projects || PLANS.free.projects;
}

function limitError(limit) {
  return Object.assign(
    new Error(`Your plan includes ${limit} project${limit === 1 ? "" : "s"}. Upgrade to add more.`),
    { status: 403, code: "project_limit", limit },
  );
}

export async function listRegisteredProjects(uid) {
  const snap = await ref(uid).get();
  return snap.exists ? snap.data().names || [] : [];
}

/** Registers a project if there's room; already-registered projects always pass. */
export async function ensureProject(uid, rawName) {
  const name = clean(rawName);
  if (!uid || !name || name === "default" || !firebaseAdminConfigured()) return;
  const limit = projectLimit(await planOf(uid));
  await getFirestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref(uid));
    const names = snap.exists ? snap.data().names || [] : [];
    if (names.includes(name)) return;
    if (names.length >= limit) throw limitError(limit);
    tx.set(ref(uid), { names: [...names, name], updatedAt: FieldValue.serverTimestamp() });
  });
}

/** Registers projects the browser already has, up to the limit. Returns which ones are usable. */
export async function syncProjects(uid, rawNames) {
  const limit = projectLimit(await planOf(uid));
  const wanted = [...new Set((rawNames || []).map(clean).filter(Boolean))];
  let names = [];
  await getFirestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref(uid));
    names = snap.exists ? snap.data().names || [] : [];
    for (const name of wanted) {
      if (!names.includes(name) && names.length < limit) names.push(name);
    }
    tx.set(ref(uid), { names, updatedAt: FieldValue.serverTimestamp() });
  });
  return { names, limit, locked: wanted.filter((n) => !names.includes(n)) };
}

export async function removeProject(uid, rawName) {
  const name = clean(rawName);
  await ref(uid).set({ names: FieldValue.arrayRemove(name), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
}

export async function renameProject(uid, from, to) {
  const oldName = clean(from);
  const newName = clean(to);
  if (!uid || !oldName || !newName || !firebaseAdminConfigured()) return;
  await getFirestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref(uid));
    const names = snap.exists ? snap.data().names || [] : [];
    const next = names.map((n) => (n === oldName ? newName : n)).filter((n, i, all) => all.indexOf(n) === i);
    tx.set(ref(uid), { names: next, updatedAt: FieldValue.serverTimestamp() });
  });
}
