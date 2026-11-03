import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { adminAuth, firebaseAdminConfigured } from "./firebaseAdmin.js";
import { identify } from "./credits/middleware.js";
import { getCreditAccount, updateCreditAccount } from "./credits/store.js";
import { listRegisteredProjects } from "./billing/projects.js";
import { removeMember, resolveBilling, seatLimit } from "./billing/team.js";
import { readJson } from "./readJson.js";
import { requestOrigin } from "./integrations/http.js";

/**
 * Business-plan project sharing. A project's metadata and membership live in Firestore
 * (`sharedProjects/{id}`, server-only); its chats live on disk so long agent reports
 * aren't limited by Firestore's 1 MB document size. Members join the owner's team,
 * so their runs bill the owner's credits through the existing team billing.
 */

const CHATS_DIR = () => process.env.SHARED_CHATS_DIR?.trim() || path.join(process.cwd(), ".shared-chats");
const ID_RE = /^[A-Za-z0-9_-]{1,100}$/;
const MAX_CHAT_BYTES = 6_000_000;
const MAX_MESSAGES = 400;

function db() {
  adminAuth();
  return getFirestore();
}

function fail(message, status = 400, code) {
  return Object.assign(new Error(message), { status, code });
}

const sharesCol = () => db().collection("sharedProjects");
const invitesCol = () => db().collection("projectInvites");

function hash(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

function newToken() {
  return crypto.randomBytes(18).toString("base64url");
}

function joinLink(req, token) {
  return `${requestOrigin(req)}/?join=${encodeURIComponent(token)}`;
}

const people = new Map();
async function person(uid) {
  const cached = people.get(uid);
  if (cached && Date.now() - cached.at < 10 * 60_000) return cached.value;
  let value = { uid, name: "Teammate", email: "" };
  try {
    const user = await adminAuth().getUser(uid);
    value = { uid, name: user.displayName || user.email?.split("@")[0] || "Teammate", email: user.email || "" };
  } catch {
    // Deleted account: keep the placeholder.
  }
  people.set(uid, { at: Date.now(), value });
  return value;
}

async function ownerHasSeats(ownerUid) {
  const account = await getCreditAccount(ownerUid);
  return seatLimit(account.plan) > 1;
}

/** Loads a share and the caller's role, or throws 404 (never reveals projects you can't see). */
async function access(uid, shareId) {
  if (!ID_RE.test(String(shareId || ""))) throw fail("Project not found.", 404);
  const snap = await sharesCol().doc(shareId).get();
  if (!snap.exists) throw fail("Project not found.", 404);
  const share = { id: snap.id, ...snap.data() };
  if (share.ownerUid === uid) return { share, role: "owner" };
  if ((share.memberUids || []).includes(uid) && (await ownerHasSeats(share.ownerUid))) return { share, role: "member" };
  throw fail("Project not found.", 404);
}

function publicShare(share, role, req, chats) {
  return {
    id: share.id,
    role,
    name: share.name,
    website: share.website || "",
    knowledge: share.knowledge || null,
    logo: share.logo || "",
    ownerUid: share.ownerUid,
    ownerName: share.ownerName || "",
    ownerEmail: role === "owner" ? share.ownerEmail || "" : undefined,
    members: (share.members || []).map(({ uid, name, email, joinedAt }) => ({ uid, name, email, joinedAt })),
    link: role === "owner" && share.inviteToken ? joinLink(req, share.inviteToken) : undefined,
    chats,
  };
}

/* ---------------- chat storage (disk) ---------------- */

const queues = new Map();
function serialize(shareId, fn) {
  const prev = queues.get(shareId) || Promise.resolve();
  const run = prev.then(fn, fn);
  queues.set(shareId, run.catch(() => {}));
  return run;
}

function shareDir(shareId) {
  return path.join(CHATS_DIR(), shareId);
}

async function readIndex(shareId) {
  try {
    return JSON.parse(await fs.readFile(path.join(shareDir(shareId), "_index.json"), "utf8"));
  } catch {
    return {};
  }
}

async function writeFileAtomic(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(`${file}.tmp`, data);
  await fs.rename(`${file}.tmp`, file);
}

async function readChat(shareId, chatId) {
  try {
    return JSON.parse(await fs.readFile(path.join(shareDir(shareId), `${chatId}.json`), "utf8"));
  } catch {
    return null;
  }
}

function summary(chat) {
  const lastUser = [...(chat.messages || [])].reverse().find((m) => m.role === "user");
  return {
    id: chat.id,
    title: chat.title,
    agent: chat.agent || null,
    interactionMode: chat.interactionMode || null,
    createdBy: chat.createdBy,
    updatedAt: chat.updatedAt,
    messageCount: (chat.messages || []).length,
    lastAuthor: lastUser?.author?.name || "",
  };
}

async function listChats(shareId) {
  const index = await readIndex(shareId);
  return Object.values(index).sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Saves a chat, stamping who wrote each user message. Authors on existing messages can't be rewritten. */
async function saveChat(shareId, chatId, body, me) {
  if (!ID_RE.test(chatId)) throw fail("Invalid chat id.");
  const incoming = Array.isArray(body.messages) ? body.messages.slice(0, MAX_MESSAGES) : [];
  return serialize(shareId, async () => {
    const existing = await readChat(shareId, chatId);
    // Clients send the version they last saw; a mismatch means someone else saved in between.
    if ("baseUpdatedAt" in body && existing && existing.updatedAt !== body.baseUpdatedAt) {
      throw fail("This chat changed on another device.", 409, "conflict");
    }
    const now = Date.now();
    const messages = incoming
      .filter((m) => m && (m.role === "user" || m.role === "assistant"))
      .map((m, i) => {
        const { author: _a, at: _t, streaming: _s, ...rest } = m;
        const prior = existing?.messages?.[i];
        const same = prior && prior.role === m.role && prior.content === m.content;
        if (same) return { ...rest, author: prior.author || null, at: prior.at || now };
        return { ...rest, author: m.role === "user" ? { uid: me.uid, name: me.name } : null, at: now };
      });
    const chat = {
      id: chatId,
      title: String(body.title || existing?.title || "New chat").slice(0, 120),
      agent: body.agent ?? existing?.agent ?? null,
      interactionMode: body.interactionMode ?? existing?.interactionMode ?? null,
      scope: body.scope ?? existing?.scope ?? null,
      mode: body.mode ?? existing?.mode ?? null,
      createdBy: existing?.createdBy || me.uid,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      messages,
    };
    const data = JSON.stringify(chat);
    if (data.length > MAX_CHAT_BYTES) throw fail("This chat is too large to share. Start a new chat.", 413);
    await writeFileAtomic(path.join(shareDir(shareId), `${chatId}.json`), data);
    const index = await readIndex(shareId);
    index[chatId] = summary(chat);
    await writeFileAtomic(path.join(shareDir(shareId), "_index.json"), JSON.stringify(index));
    return chat;
  });
}

async function deleteChat(shareId, chatId) {
  return serialize(shareId, async () => {
    await fs.rm(path.join(shareDir(shareId), `${chatId}.json`), { force: true });
    const index = await readIndex(shareId);
    delete index[chatId];
    await writeFileAtomic(path.join(shareDir(shareId), "_index.json"), JSON.stringify(index));
  });
}

/* ---------------- membership ---------------- */

async function sharesOwnedBy(uid) {
  const snap = await sharesCol().where("ownerUid", "==", uid).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function sharesJoinedBy(uid) {
  const snap = await sharesCol().where("memberUids", "array-contains", uid).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function createOrGetShare(ownerUid, body) {
  const name = String(body.name || "").trim().slice(0, 120);
  if (!name) throw fail("Pick a project to share.");
  const billing = await resolveBilling(ownerUid);
  if (billing.teamOwner) throw fail("Only the team owner can share projects.", 403);
  if (seatLimit(billing.plan) <= 1) {
    throw fail("Sharing projects with teammates is available on the Business plan.", 403, "plan_required");
  }
  const registered = await listRegisteredProjects(ownerUid);
  if (!registered.includes(name)) throw fail("That project isn't registered on your account yet. Reload and try again.", 404);
  const existing = (await sharesOwnedBy(ownerUid)).find((s) => s.name === name);
  const details = {
    website: String(body.website || "").slice(0, 300),
    knowledge: body.knowledge && typeof body.knowledge === "object" ? body.knowledge : null,
    logo: String(body.logo || "").slice(0, 2000),
  };
  if (existing) {
    await sharesCol().doc(existing.id).set({ ...details, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return { ...existing, ...details };
  }
  const owner = await person(ownerUid);
  const token = newToken();
  const ref = sharesCol().doc(`sp_${crypto.randomBytes(9).toString("hex")}`);
  const share = {
    ownerUid,
    ownerName: owner.name,
    ownerEmail: owner.email,
    name,
    ...details,
    members: [],
    memberUids: [],
    inviteToken: token,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
  const batch = db().batch();
  batch.set(ref, share);
  batch.set(invitesCol().doc(hash(token)), { shareId: ref.id, ownerUid, createdAt: FieldValue.serverTimestamp() });
  await batch.commit();
  return { id: ref.id, ...share };
}

async function resetLink(share) {
  const token = newToken();
  const batch = db().batch();
  if (share.inviteToken) batch.delete(invitesCol().doc(hash(share.inviteToken)));
  batch.set(invitesCol().doc(hash(token)), { shareId: share.id, ownerUid: share.ownerUid, createdAt: FieldValue.serverTimestamp() });
  batch.update(sharesCol().doc(share.id), { inviteToken: token, updatedAt: FieldValue.serverTimestamp() });
  await batch.commit();
  return token;
}

async function joinShare(uid, token) {
  const invite = await invitesCol().doc(hash(token)).get();
  if (!invite.exists) throw fail("This project link is invalid or was reset by the owner.", 404);
  const { shareId, ownerUid } = invite.data();
  if (ownerUid === uid) return { shareId, alreadyOwner: true };
  if (!(await ownerHasSeats(ownerUid))) throw fail("The project owner's plan no longer includes team seats.", 403);

  const account = await getCreditAccount(uid);
  if (account.teamOwner && account.teamOwner !== ownerUid) {
    throw fail("You're already on another team. Leave it under Profile → Team, then open this link again.", 409);
  }
  if (account.stripeSubscriptionId && account.subscriptionStatus === "active") {
    throw fail("Cancel your own paid plan before joining a team project (you'll use the owner's plan and credits).", 409);
  }
  const me = await person(uid);
  const ownerAccount = await getCreditAccount(ownerUid);
  const seats = seatLimit(ownerAccount.plan);

  await db().runTransaction(async (tx) => {
    const teamRef = db().collection("teams").doc(ownerUid);
    const shareRef = sharesCol().doc(shareId);
    const [teamSnap, shareSnap] = await Promise.all([tx.get(teamRef), tx.get(shareRef)]);
    if (!shareSnap.exists) throw fail("This project is no longer shared.", 404);
    const team = teamSnap.exists ? teamSnap.data() : { members: [], invites: [] };
    const members = team.members || [];
    const email = (me.email || "").toLowerCase();
    const invites = (team.invites || []).filter((i) => i.email !== email);
    if (!members.some((m) => m.uid === uid)) {
      if (members.length + invites.length >= seats) {
        throw fail(`All ${seats} teammate seats on this team are taken. Ask the owner to free a seat.`, 403, "seats_full");
      }
      members.push({ uid, email, joinedAt: new Date().toISOString(), via: "project" });
      for (const old of (team.invites || []).filter((i) => i.email === email)) {
        tx.delete(db().collection("teamInvites").doc(old.tokenHash));
      }
    }
    tx.set(teamRef, { ...team, members, invites, updatedAt: FieldValue.serverTimestamp() });
    const share = shareSnap.data();
    if (!(share.memberUids || []).includes(uid)) {
      tx.update(shareRef, {
        memberUids: FieldValue.arrayUnion(uid),
        members: [...(share.members || []), { uid, name: me.name, email, joinedAt: new Date().toISOString() }],
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
  });
  await updateCreditAccount(uid, { teamOwner: ownerUid });
  return { shareId };
}

/** Removes a member from one project; when they have no other projects with this owner they leave the team too. */
async function removeFromShare(share, memberUid) {
  await sharesCol().doc(share.id).update({
    memberUids: FieldValue.arrayRemove(memberUid),
    members: (share.members || []).filter((m) => m.uid !== memberUid),
    updatedAt: FieldValue.serverTimestamp(),
  });
  const others = (await sharesJoinedBy(memberUid)).filter((s) => s.ownerUid === share.ownerUid && s.id !== share.id);
  if (!others.length) await removeMember(share.ownerUid, memberUid);
}

/** Called when someone leaves or is removed from the team: drop them from every project of that owner. */
export async function removeFromAllShares(ownerUid, memberUid) {
  if (!firebaseAdminConfigured() || !ownerUid || !memberUid) return;
  const joined = (await sharesJoinedBy(memberUid)).filter((s) => s.ownerUid === ownerUid);
  await Promise.all(
    joined.map((s) =>
      sharesCol().doc(s.id).update({
        memberUids: FieldValue.arrayRemove(memberUid),
        members: (s.members || []).filter((m) => m.uid !== memberUid),
        updatedAt: FieldValue.serverTimestamp(),
      }),
    ),
  );
}

async function stopSharing(share) {
  const batch = db().batch();
  if (share.inviteToken) batch.delete(invitesCol().doc(hash(share.inviteToken)));
  batch.delete(sharesCol().doc(share.id));
  await batch.commit();
  await fs.rm(shareDir(share.id), { recursive: true, force: true });
  for (const uid of share.memberUids || []) {
    const others = (await sharesJoinedBy(uid)).filter((s) => s.ownerUid === share.ownerUid);
    if (!others.length) await removeMember(share.ownerUid, uid);
  }
}

/* ---------------- credit usage per teammate ---------------- */

function actorOf(tx, payerUid) {
  if (tx.actorUid) return tx.actorUid;
  const match = String(tx.source || "").match(/team-member:([A-Za-z0-9_-]+)/);
  return match ? match[1] : payerUid;
}

export async function teamUsage(uid, days = 30) {
  const billing = await resolveBilling(uid);
  const payer = billing.billingUid;
  const since = new Date(Date.now() - days * 86_400_000);
  const snap = await db()
    .collection("credits")
    .doc(payer)
    .collection("transactions")
    .where("createdAt", ">=", since)
    .orderBy("createdAt", "desc")
    .limit(3000)
    .get();
  const byActor = new Map();
  for (const doc of snap.docs) {
    const tx = doc.data();
    if (tx.type !== "charge" || tx.status === "refunded") continue;
    const actor = actorOf(tx, payer);
    const entry = byActor.get(actor) || { credits: 0, runs: 0, agents: new Map() };
    entry.credits += Number(tx.amount) || 0;
    entry.runs += 1;
    const label = tx.label || tx.agent || "Other";
    entry.agents.set(label, (entry.agents.get(label) || 0) + (Number(tx.amount) || 0));
    byActor.set(actor, entry);
  }
  const team = await db().collection("teams").doc(payer).get();
  const memberUids = (team.exists ? team.data().members || [] : []).map((m) => m.uid);
  const uids = [...new Set([payer, ...memberUids, ...byActor.keys()])];
  const rows = await Promise.all(
    uids.map(async (id) => {
      const who = await person(id);
      const entry = byActor.get(id) || { credits: 0, runs: 0, agents: new Map() };
      return {
        uid: id,
        name: who.name,
        email: who.email,
        role: id === payer ? "owner" : memberUids.includes(id) ? "member" : "former member",
        you: id === uid,
        credits: entry.credits,
        runs: entry.runs,
        topAgents: [...entry.agents.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 4)
          .map(([label, credits]) => ({ label, credits })),
      };
    }),
  );
  rows.sort((a, b) => (a.role === "owner" ? -1 : b.role === "owner" ? 1 : b.credits - a.credits));
  return {
    days,
    plan: billing.plan,
    payerIsYou: payer === uid,
    total: rows.reduce((sum, r) => sum + r.credits, 0),
    members: rows,
  };
}

/** Display names for transaction actors (used by /api/credits). */
export async function actorNames(uids) {
  const out = {};
  await Promise.all([...new Set(uids.filter(Boolean))].map(async (id) => (out[id] = (await person(id)).name)));
  return out;
}

/* ---------------- routes ---------------- */

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

export function attachSharedProjects(server) {
  server.middlewares.use(async (req, res, next) => {
    const url = (req.url || "").split("?")[0];
    if (!url.startsWith("/api/shared-projects") && url !== "/api/team/usage") return next();
    try {
      if (!firebaseAdminConfigured()) throw fail("Sharing needs the Firebase service account configured.", 503);
      const who = await identify(req);
      if (!who) throw fail("Sign in first.", 401);
      const uid = who.uid;
      const method = req.method;

      if (url === "/api/team/usage" && method === "GET") {
        const days = Math.min(90, Math.max(1, Number(new URLSearchParams(req.url.split("?")[1] || "").get("days")) || 30));
        return sendJson(res, 200, await teamUsage(uid, days));
      }

      if (url === "/api/shared-projects" && method === "GET") {
        const [owned, joined] = await Promise.all([sharesOwnedBy(uid), sharesJoinedBy(uid)]);
        const visibleJoined = [];
        for (const s of joined) if (await ownerHasSeats(s.ownerUid)) visibleJoined.push(s);
        const projects = await Promise.all([
          ...owned.map(async (s) => publicShare(s, "owner", req, await listChats(s.id))),
          ...visibleJoined.map(async (s) => publicShare(s, "member", req, await listChats(s.id))),
        ]);
        return sendJson(res, 200, { projects });
      }

      if (url === "/api/shared-projects" && method === "POST") {
        const share = await createOrGetShare(uid, await readJson(req));
        return sendJson(res, 200, { project: publicShare(share, "owner", req, await listChats(share.id)) });
      }

      if (url === "/api/shared-projects/join" && method === "POST") {
        const body = await readJson(req);
        const { shareId } = await joinShare(uid, String(body.token || ""));
        const { share, role } = await access(uid, shareId);
        return sendJson(res, 200, { project: publicShare(share, role, req, await listChats(share.id)) });
      }

      const match = url.match(/^\/api\/shared-projects\/([A-Za-z0-9_-]+)(?:\/(.*))?$/);
      if (!match) throw fail("Not found.", 404);
      const [, shareId, rest = ""] = match;
      const { share, role } = await access(uid, shareId);
      const ownerOnly = () => {
        if (role !== "owner") throw fail("Only the project owner can do that.", 403);
      };

      if (!rest && method === "PATCH") {
        ownerOnly();
        const body = await readJson(req);
        const patch = {};
        if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim().slice(0, 120);
        if (typeof body.website === "string") patch.website = body.website.slice(0, 300);
        if (body.knowledge && typeof body.knowledge === "object") patch.knowledge = body.knowledge;
        if (typeof body.logo === "string") patch.logo = body.logo.slice(0, 2000);
        await sharesCol().doc(shareId).set({ ...patch, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        return sendJson(res, 200, { ok: true });
      }
      if (!rest && method === "DELETE") {
        ownerOnly();
        await stopSharing(share);
        return sendJson(res, 200, { ok: true });
      }
      if (rest === "link/reset" && method === "POST") {
        ownerOnly();
        const token = await resetLink(share);
        return sendJson(res, 200, { link: joinLink(req, token) });
      }
      if (rest === "members/remove" && method === "POST") {
        ownerOnly();
        const body = await readJson(req);
        await removeFromShare(share, String(body.uid || ""));
        return sendJson(res, 200, { ok: true });
      }
      if (rest === "leave" && method === "POST") {
        if (role !== "member") throw fail("Owners can stop sharing instead of leaving.", 400);
        await removeFromShare(share, uid);
        return sendJson(res, 200, { ok: true });
      }

      const chatMatch = rest.match(/^chats\/([A-Za-z0-9_-]{1,100})$/);
      if (rest === "chats" && method === "GET") return sendJson(res, 200, { chats: await listChats(shareId) });
      if (chatMatch && method === "GET") {
        const chat = await readChat(shareId, chatMatch[1]);
        if (!chat) throw fail("Chat not found.", 404);
        return sendJson(res, 200, { chat });
      }
      if (chatMatch && method === "PUT") {
        const me = await person(uid);
        const chat = await saveChat(shareId, chatMatch[1], await readJson(req, { maxBytes: MAX_CHAT_BYTES }), me);
        return sendJson(res, 200, { chat });
      }
      if (chatMatch && method === "DELETE") {
        const chat = await readChat(shareId, chatMatch[1]);
        if (chat && role !== "owner" && chat.createdBy !== uid) throw fail("Only the owner or the person who started this chat can delete it.", 403);
        await deleteChat(shareId, chatMatch[1]);
        return sendJson(res, 200, { ok: true });
      }
      throw fail("Not found.", 404);
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message || "Request failed.", code: error.code });
    }
  });
}
