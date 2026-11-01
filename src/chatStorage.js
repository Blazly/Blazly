const CHATS_KEY = "blazly-chats";
const MAX_CHATS_PER_PROJECT = 50;

export function loadChats(uid) {
  if (!uid) return [];
  try {
    const saved = JSON.parse(localStorage.getItem(`${CHATS_KEY}-${uid}`) || "[]");
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

export function saveChats(uid, chats) {
  if (!uid) return;
  try {
    const perProject = new Map();
    const kept = [...chats]
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      .filter((chat) => {
        const key = chat.project || "";
        const count = perProject.get(key) || 0;
        perProject.set(key, count + 1);
        return count < MAX_CHATS_PER_PROJECT;
      });
    localStorage.setItem(`${CHATS_KEY}-${uid}`, JSON.stringify(kept));
  } catch {
    // Ignore storage failures.
  }
}

export function defaultChatTitle(text) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return "New chat";
  return clean.length > 52 ? `${clean.slice(0, 52)}…` : clean;
}

export function newChatId() {
  return globalThis.crypto?.randomUUID?.() || `chat-${Date.now()}`;
}

const FEEDBACK_KEY = "blazly-feedback";

export function saveFeedback(uid, entry) {
  if (!uid || !entry) return;
  try {
    const key = `${FEEDBACK_KEY}-${uid}`;
    const saved = JSON.parse(localStorage.getItem(key) || "[]");
    const list = Array.isArray(saved) ? saved : [];
    list.unshift(entry);
    localStorage.setItem(key, JSON.stringify(list.slice(0, 100)));
  } catch {
    // Ignore storage failures.
  }
}
