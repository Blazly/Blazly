import { doc, getDoc, serverTimestamp, setDoc, writeBatch } from "firebase/firestore";
import { db } from "./firebase.js";

const SHARE_PATH = /^\/share\/([A-Za-z0-9_-]{8,64})\/?$/;

export function shareIdFromLocation(location = window.location) {
  const match = SHARE_PATH.exec(location.pathname);
  return match ? match[1] : null;
}

export function shareUrl(shareId) {
  return `${window.location.origin}/share/${shareId}`;
}

function newShareId() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(36).padStart(2, "0")).join("").slice(0, 20);
}

function publicMessages(messages) {
  return (messages || [])
    .filter((m) => !m.streaming && (m.role === "user" || m.role === "assistant"))
    .map((m) => ({ role: m.role, content: String(m.content || "") }));
}

export async function publishChatShare({ uid, chat, messages, ownerName, existingShareId }) {
  const shareId = existingShareId || newShareId();
  const batch = writeBatch(db);
  // Ownership lives in a private document so the public share never reveals the owner's user ID.
  batch.set(doc(db, "sharedChatOwners", shareId), { ownerUid: uid, updatedAt: serverTimestamp() });
  batch.set(doc(db, "sharedChats", shareId), {
    ownerName: ownerName || "",
    title: chat?.title || "Shared chat",
    agent: chat?.agent || null,
    messages: publicMessages(messages),
    updatedAt: serverTimestamp(),
  });
  await batch.commit();
  return shareId;
}

export async function loadChatShare(shareId) {
  const snap = await getDoc(doc(db, "sharedChats", shareId));
  return snap.exists() ? snap.data() : null;
}
