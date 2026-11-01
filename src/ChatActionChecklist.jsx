import { useEffect, useState } from "react";
import { loadAuditTodos, saveAuditTodos, todoItemKey } from "./auditTodoStorage.js";
import { formatInline } from "./inlineFormat.jsx";

export function ChatActionChecklist({ items, chatId, signature, title = "Action checklist" }) {
  const [done, setDone] = useState(() => loadAuditTodos(chatId, signature));

  useEffect(() => {
    setDone(loadAuditTodos(chatId, signature));
  }, [chatId, signature]);

  if (!items?.length) return null;

  const keys = items.map((item, index) => todoItemKey(typeof item === "string" ? item : item.text, index));
  const completed = keys.filter((key) => done.has(key)).length;
  const percent = Math.round((completed / keys.length) * 100);
  const allDone = completed === keys.length;

  function toggle(key) {
    setDone((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      saveAuditTodos(chatId, signature, next);
      return next;
    });
  }

  return (
    <section className={`action-checklist${allDone ? " is-complete" : ""}`}>
      <header className="action-checklist-head">
        <div>
          <h4 className="action-checklist-title">{title}</h4>
          <p className="action-checklist-sub">
            {allDone ? "All done. Nice work." : "Tick each step off as you complete it."}
          </p>
        </div>
        <span className="action-checklist-count">
          {completed}/{keys.length}
        </span>
      </header>
      <div className="action-checklist-bar" aria-hidden="true">
        <span style={{ width: `${percent}%` }} />
      </div>
      <ol className="action-checklist-list">
        {items.map((item, index) => {
          const text = typeof item === "string" ? item : item.text;
          const key = keys[index];
          const checked = done.has(key);
          return (
            <li key={key} className={checked ? "is-done" : ""}>
              <button
                type="button"
                className="action-checklist-item"
                role="checkbox"
                aria-checked={checked}
                onClick={() => toggle(key)}
              >
                <span className="action-checklist-box" aria-hidden="true">
                  <svg width="12" height="12" viewBox="0 0 12 12">
                    <path
                      d="M2 6.2 4.8 9 10 3"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
                <span className="action-checklist-num">{String(index + 1).padStart(2, "0")}</span>
                <span className="action-checklist-text">{formatInline(text)}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
