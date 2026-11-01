import { readJson } from "./readJson.js";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { adminAuth } from "./firebaseAdmin.js";
import { identify } from "./credits/middleware.js";

export const CATEGORIES = ["question", "seo", "content", "ai-visibility", "feature-request", "show-and-tell"];

const LIMITS = { post: { max: 10, windowMs: 60 * 60 * 1000 }, comment: { max: 60, windowMs: 60 * 60 * 1000 } };
const hits = new Map();

function db() {
  adminAuth();
  return getFirestore();
}

function fail(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

function rateLimit(uid, kind) {
  const { max, windowMs } = LIMITS[kind];
  const key = `${kind}:${uid}`;
  const now = Date.now();
  const recent = (hits.get(key) || []).filter((t) => now - t < windowMs);
  if (recent.length >= max) throw fail("You're posting a lot. Try again in a little while.", 429);
  recent.push(now);
  hits.set(key, recent);
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}


function text(value, max) {
  return String(value || "").replace(/\r\n/g, "\n").trim().slice(0, max);
}

async function author(uid) {
  const [user, profile] = await Promise.all([
    adminAuth().getUser(uid),
    db().collection("users").doc(uid).get(),
  ]);
  const data = profile.exists ? profile.data() : {};
  const name = data.displayName || data.name || user.displayName || (user.email || "Member").split("@")[0];
  return { authorUid: uid, authorName: String(name).slice(0, 80), authorAvatar: data.avatarUrl || user.photoURL || "" };
}

function iso(value) {
  return value?.toDate?.().toISOString() || null;
}

function serializePost(doc, uid, voted) {
  const d = doc.data();
  return {
    id: doc.id,
    title: d.title,
    body: d.body,
    category: d.category,
    authorName: d.authorName,
    authorAvatar: d.authorAvatar,
    mine: d.authorUid === uid,
    upvotes: d.upvotes || 0,
    commentCount: d.commentCount || 0,
    voted: Boolean(voted),
    createdAt: iso(d.createdAt),
    lastActivityAt: iso(d.lastActivityAt),
  };
}

async function votedSet(uid, refs) {
  if (!refs.length) return new Set();
  const snaps = await db().getAll(...refs.map((r) => r.collection("votes").doc(uid)));
  return new Set(snaps.filter((s) => s.exists).map((s) => s.ref.parent.parent.id));
}

async function listPosts(uid, { sort, category, q }) {
  const snap = await db().collection("communityPosts").orderBy("createdAt", "desc").limit(300).get();
  let docs = snap.docs;
  if (CATEGORIES.includes(category)) docs = docs.filter((d) => d.data().category === category);
  const needle = text(q, 100).toLowerCase();
  if (needle) docs = docs.filter((d) => `${d.data().title} ${d.data().body}`.toLowerCase().includes(needle));
  if (sort === "top") docs = [...docs].sort((a, b) => (b.data().upvotes || 0) - (a.data().upvotes || 0));
  docs = docs.slice(0, 60);
  const voted = await votedSet(uid, docs.map((d) => d.ref));
  return docs.map((d) => {
    const post = serializePost(d, uid, voted.has(d.id));
    return { ...post, body: post.body.slice(0, 280) };
  });
}

async function createPost(uid, body) {
  const title = text(body.title, 160);
  const content = text(body.body, 8000);
  const category = CATEGORIES.includes(body.category) ? body.category : "question";
  if (title.length < 8) throw fail("Give your post a title of at least 8 characters.");
  rateLimit(uid, "post");
  const ref = db().collection("communityPosts").doc();
  await ref.set({
    title,
    body: content,
    category,
    ...(await author(uid)),
    upvotes: 0,
    commentCount: 0,
    createdAt: FieldValue.serverTimestamp(),
    lastActivityAt: FieldValue.serverTimestamp(),
  });
  return { id: ref.id };
}

async function getPost(uid, id) {
  const ref = db().collection("communityPosts").doc(id);
  const [snap, commentsSnap] = await Promise.all([ref.get(), ref.collection("comments").orderBy("createdAt", "asc").limit(500).get()]);
  if (!snap.exists) throw fail("This post was removed.", 404);
  const [postVoted, commentVoted] = await Promise.all([
    votedSet(uid, [ref]),
    votedSet(uid, commentsSnap.docs.map((d) => d.ref)),
  ]);
  return {
    post: serializePost(snap, uid, postVoted.has(id)),
    comments: commentsSnap.docs.map((d) => {
      const c = d.data();
      return {
        id: d.id,
        body: c.body,
        authorName: c.authorName,
        authorAvatar: c.authorAvatar,
        isAuthor: c.authorUid === snap.data().authorUid,
        mine: c.authorUid === uid,
        upvotes: c.upvotes || 0,
        voted: commentVoted.has(d.id),
        createdAt: iso(c.createdAt),
      };
    }),
  };
}

/** One vote per user per item; calling again removes the vote. */
async function toggleVote(uid, targetRef) {
  const voteRef = targetRef.collection("votes").doc(uid);
  return db().runTransaction(async (tx) => {
    const [target, vote] = await Promise.all([tx.get(targetRef), tx.get(voteRef)]);
    if (!target.exists) throw fail("This item was removed.", 404);
    const current = target.data().upvotes || 0;
    if (vote.exists) {
      tx.delete(voteRef);
      tx.update(targetRef, { upvotes: Math.max(0, current - 1) });
      return { voted: false, upvotes: Math.max(0, current - 1) };
    }
    tx.set(voteRef, { createdAt: FieldValue.serverTimestamp() });
    tx.update(targetRef, { upvotes: current + 1 });
    return { voted: true, upvotes: current + 1 };
  });
}

async function addComment(uid, postId, body) {
  const content = text(body.body, 4000);
  if (content.length < 2) throw fail("Write a comment first.");
  rateLimit(uid, "comment");
  const postRef = db().collection("communityPosts").doc(postId);
  const commentRef = postRef.collection("comments").doc();
  const who = await author(uid);
  await db().runTransaction(async (tx) => {
    const post = await tx.get(postRef);
    if (!post.exists) throw fail("This post was removed.", 404);
    tx.set(commentRef, { body: content, ...who, upvotes: 0, createdAt: FieldValue.serverTimestamp() });
    tx.update(postRef, { commentCount: FieldValue.increment(1), lastActivityAt: FieldValue.serverTimestamp() });
  });
  return { id: commentRef.id };
}

async function deletePost(uid, postId) {
  const ref = db().collection("communityPosts").doc(postId);
  const snap = await ref.get();
  if (!snap.exists) return;
  if (snap.data().authorUid !== uid) throw fail("You can only delete your own posts.", 403);
  await db().recursiveDelete(ref);
}

async function deleteComment(uid, postId, commentId) {
  const postRef = db().collection("communityPosts").doc(postId);
  const ref = postRef.collection("comments").doc(commentId);
  const snap = await ref.get();
  if (!snap.exists) return;
  if (snap.data().authorUid !== uid) throw fail("You can only delete your own comments.", 403);
  await db().recursiveDelete(ref);
  await postRef.update({ commentCount: FieldValue.increment(-1) });
}

export function attachCommunity(server) {
  server.middlewares.use(async (req, res, next) => {
    const [path, query = ""] = (req.url || "").split("?");
    if (!path.startsWith("/api/community/")) return next();
    try {
      const who = await identify(req);
      if (!who) return sendJson(res, 401, { error: "Sign in to join the discussion." });
      const uid = who.uid;
      const params = new URLSearchParams(query);
      const parts = path.split("/").filter(Boolean).slice(2);
      const [resource, id, action] = parts;

      if (req.method === "GET" && resource === "posts" && !id) {
        return sendJson(res, 200, {
          posts: await listPosts(uid, { sort: params.get("sort"), category: params.get("category"), q: params.get("q") }),
        });
      }
      if (req.method === "GET" && resource === "posts" && id) return sendJson(res, 200, await getPost(uid, id));

      if (req.method !== "POST") return next();
      const body = await readJson(req);
      const postRef = id ? db().collection("communityPosts").doc(id) : null;

      if (resource === "posts" && !id) return sendJson(res, 200, await createPost(uid, body));
      if (resource === "posts" && action === "vote") return sendJson(res, 200, await toggleVote(uid, postRef));
      if (resource === "posts" && action === "comments") return sendJson(res, 200, await addComment(uid, id, body));
      if (resource === "posts" && action === "delete") {
        await deletePost(uid, id);
        return sendJson(res, 200, { ok: true });
      }
      if (resource === "posts" && action === "comment-vote") {
        return sendJson(res, 200, await toggleVote(uid, postRef.collection("comments").doc(String(body.commentId || ""))));
      }
      if (resource === "posts" && action === "comment-delete") {
        await deleteComment(uid, id, String(body.commentId || ""));
        return sendJson(res, 200, { ok: true });
      }
      return next();
    } catch (error) {
      return sendJson(res, error.status || 500, { error: error.message || "Community request failed." });
    }
  });
}
