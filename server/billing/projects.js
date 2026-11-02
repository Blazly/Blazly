import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { adminAuth, firebaseAdminConfigured } from "../firebaseAdmin.js";
import { PLANS } from "../../src/plans.js";
import { planOf } from "./team.js";
import { siteHost } from "../integrations/siteMatch.js";

/**
 * Server-side list of each user's projects (name + website) so plan limits, the
 * "integrations only talk to the project's own URL" rule and the 30-day edit
 * cooldown can't be bypassed from the browser.
 *
 * Doc shape: { names: string[], meta: { [name]: { website, createdAt, lastEditedAt } } }
 */
export const EDIT_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;

function ref(uid) {
  adminAuth();
  return getFirestore().collection("projectRegistry").doc(uid);
}

function clean(name) {
  return String(name || "").trim().slice(0, 120);
}

function cleanSite(website) {
  const raw = String(website || "").trim().slice(0, 300);
  if (!raw) return "";
  const withProto = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(withProto);
    return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return "";
  }
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

function paidOnlyError(action) {
  return Object.assign(
    new Error(`${action} is available on Pro and Business plans. Upgrade to change your projects.`),
    { status: 403, code: "plan_required", requiredPlan: "pro" },
  );
}

function lockedError(nextEditAt) {
  const when = new Date(nextEditAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return Object.assign(
    new Error(`Projects can be changed once every 30 days. You can edit this project again on ${when}.`),
    { status: 403, code: "edit_locked", nextEditAt },
  );
}

async function readDoc(uid) {
  const snap = await ref(uid).get();
  const data = snap.exists ? snap.data() : {};
  return { names: data.names || [], meta: data.meta || {} };
}

export async function listRegisteredProjects(uid) {
  return (await readDoc(uid)).names;
}

/** Projects with their website and when they may next be edited (for the client). */
export async function describeProjects(uid) {
  if (!firebaseAdminConfigured()) return { plan: "free", projects: [] };
  const [{ names, meta }, plan] = await Promise.all([readDoc(uid), planOf(uid)]);
  const paid = plan !== "free";
  return {
    plan,
    paid,
    cooldownDays: EDIT_COOLDOWN_MS / 86_400_000,
    projects: names.map((name) => {
      const m = meta[name] || {};
      const last = m.lastEditedAt || m.createdAt || 0;
      const nextEditAt = last ? last + EDIT_COOLDOWN_MS : 0;
      return { name, website: m.website || "", createdAt: m.createdAt || 0, lastEditedAt: m.lastEditedAt || 0, nextEditAt, editable: paid && Date.now() >= nextEditAt };
    }),
  };
}

export async function projectWebsite(uid, rawName) {
  if (!firebaseAdminConfigured()) return "";
  const { meta } = await readDoc(uid);
  return meta[clean(rawName)]?.website || "";
}

/** Registers a project if there's room; already-registered projects always pass (website is recorded if missing). */
export async function ensureProject(uid, rawName, rawWebsite) {
  const name = clean(rawName);
  const website = cleanSite(rawWebsite);
  if (!uid || !name || name === "default" || !firebaseAdminConfigured()) return;
  const limit = projectLimit(await planOf(uid));
  await getFirestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref(uid));
    const data = snap.exists ? snap.data() : {};
    const names = data.names || [];
    const meta = { ...(data.meta || {}) };
    if (names.includes(name)) {
      if (website && !meta[name]?.website) {
        meta[name] = { ...(meta[name] || {}), website };
        tx.set(ref(uid), { meta, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      }
      return;
    }
    if (names.length >= limit) throw limitError(limit);
    meta[name] = { website, createdAt: Date.now(), lastEditedAt: 0 };
    tx.set(ref(uid), { names: [...names, name], meta, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  });
}

/**
 * Registers projects the browser already has, up to the limit. Accepts names or {name, website}.
 * Projects that pre-date the registry get createdAt 0 so they're editable right away.
 */
export async function syncProjects(uid, rawEntries) {
  const limit = projectLimit(await planOf(uid));
  const wanted = [];
  for (const entry of rawEntries || []) {
    const name = clean(typeof entry === "string" ? entry : entry?.name);
    if (!name || wanted.some((w) => w.name === name)) continue;
    wanted.push({ name, website: cleanSite(typeof entry === "string" ? "" : entry?.website) });
  }
  let names = [];
  await getFirestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref(uid));
    const data = snap.exists ? snap.data() : {};
    names = data.names || [];
    const meta = { ...(data.meta || {}) };
    for (const { name, website } of wanted) {
      if (!names.includes(name) && names.length < limit) names.push(name);
      if (names.includes(name)) {
        const current = meta[name] || { website: "", createdAt: 0, lastEditedAt: 0 };
        if (!current.website && website) current.website = website;
        meta[name] = current;
      }
    }
    tx.set(ref(uid), { names, meta, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  });
  return { names, limit, locked: wanted.map((w) => w.name).filter((n) => !names.includes(n)) };
}

/** Paid plans only. */
export async function removeProject(uid, rawName) {
  const name = clean(rawName);
  if ((await planOf(uid)) === "free") throw paidOnlyError("Deleting projects");
  await getFirestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref(uid));
    const data = snap.exists ? snap.data() : {};
    const meta = { ...(data.meta || {}) };
    delete meta[name];
    tx.set(ref(uid), { names: (data.names || []).filter((n) => n !== name), meta, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  });
}

/**
 * Rename and/or change the website of a project. Paid plans only, once every 30 days
 * (counted from creation or the last edit). Returns { name, website, websiteChanged }.
 */
export async function editProject(uid, { from, to, website }) {
  const oldName = clean(from);
  const newName = clean(to) || oldName;
  if (!uid || !oldName || !firebaseAdminConfigured()) throw new Error("Project not found.");
  if ((await planOf(uid)) === "free") throw paidOnlyError("Editing projects");
  let result;
  await getFirestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref(uid));
    const data = snap.exists ? snap.data() : {};
    const names = data.names || [];
    const meta = { ...(data.meta || {}) };
    if (!names.includes(oldName)) throw Object.assign(new Error("Project not found."), { status: 404 });
    if (newName !== oldName && names.includes(newName)) throw new Error("That project name already exists.");
    const current = meta[oldName] || { website: "", createdAt: 0, lastEditedAt: 0 };
    const nextSite = website === undefined ? current.website : cleanSite(website);
    const websiteChanged = siteHost(nextSite) !== siteHost(current.website);
    if (newName === oldName && !websiteChanged) {
      result = { name: oldName, website: current.website, websiteChanged: false, unchanged: true };
      return;
    }
    const last = current.lastEditedAt || current.createdAt || 0;
    if (last && Date.now() - last < EDIT_COOLDOWN_MS) throw lockedError(last + EDIT_COOLDOWN_MS);
    delete meta[oldName];
    meta[newName] = { ...current, website: nextSite, lastEditedAt: Date.now() };
    tx.set(
      ref(uid),
      { names: names.map((n) => (n === oldName ? newName : n)), meta, updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
    result = { name: newName, website: nextSite, websiteChanged };
  });
  return result;
}

/** Internal rename without policy checks (used only by legacy integration rename route). */
export async function renameProject(uid, from, to) {
  const oldName = clean(from);
  const newName = clean(to);
  if (!uid || !oldName || !newName || !firebaseAdminConfigured()) return;
  await getFirestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref(uid));
    const data = snap.exists ? snap.data() : {};
    const names = data.names || [];
    const meta = { ...(data.meta || {}) };
    if (meta[oldName]) {
      meta[newName] = meta[oldName];
      delete meta[oldName];
    }
    const next = names.map((n) => (n === oldName ? newName : n)).filter((n, i, all) => all.indexOf(n) === i);
    tx.set(ref(uid), { names: next, meta, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  });
}
