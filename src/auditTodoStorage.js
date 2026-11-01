const KEY = "blazly-audit-todos";

function storageKey(chatId, signature) {
  return `${chatId || "draft"}::${signature || "default"}`;
}

export function loadAuditTodos(chatId, signature) {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || "{}");
    const list = saved[storageKey(chatId, signature)];
    return Array.isArray(list) ? new Set(list) : new Set();
  } catch {
    return new Set();
  }
}

export function saveAuditTodos(chatId, signature, doneKeys) {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || "{}");
    saved[storageKey(chatId, signature)] = [...doneKeys];
    localStorage.setItem(KEY, JSON.stringify(saved));
  } catch {
    // Ignore quota errors.
  }
}

export function todoItemKey(text, index) {
  return `${index}:${String(text || "").trim()}`;
}
