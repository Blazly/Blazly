import { useEffect, useState } from "react";
import { loadAuditTodos, saveAuditTodos, todoItemKey } from "./auditTodoStorage.js";
import { formatInline } from "./inlineFormat.jsx";

function AuditDataTable({ table, caption }) {
  if (!table?.headers?.length) return null;
  return (
    <div className="workpane-audit-table-block">
      {caption ? <p className="workpane-audit-caption">{caption}</p> : null}
      <div className="chat-table-wrap workpane-audit-table-wrap">
        <table className="chat-table">
          <thead>
            <tr>
              {table.headers.map((header, headerIndex) => (
                <th key={`${headerIndex}-${header}`}>{formatInline(header)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex}>{formatInline(cell)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function AuditTodoList({ items, chatId, signature }) {
  const [done, setDone] = useState(() => loadAuditTodos(chatId, signature));

  useEffect(() => {
    setDone(loadAuditTodos(chatId, signature));
  }, [chatId, signature]);

  if (!items?.length) return null;

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
    <ul className="workpane-audit-checklist">
      {items.map((item, index) => {
        const key = todoItemKey(item.text, index);
        const checked = done.has(key);
        return (
          <li key={key} className={checked ? "is-done" : "is-pending"}>
            <button
              type="button"
              className="workpane-audit-check"
              role="checkbox"
              aria-checked={checked}
              aria-label={checked ? "Mark as not done" : "Mark as done"}
              onClick={() => toggle(key)}
            >
              {checked ? (
                <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                  <path
                    d="M2 6.2 4.8 9 10 3"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              ) : null}
            </button>
            <span className="workpane-audit-check-label">{item.text}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function ChatAuditFixes({ fixesTable, priorityCard, checklist, chatId, signature, hideChecklist }) {
  const showChecklist = !hideChecklist && checklist?.items?.length;
  const showPriority = priorityCard?.rows?.length;
  const showTable = fixesTable?.headers?.length && fixesTable?.rows?.length;
  if (!showChecklist && !showPriority && !showTable) return null;

  return (
    <div className="chat-audit-fixes workpane-audit-fixes">
      {showChecklist ? (
        <>
          <p className="workpane-audit-lead">Tick items as you fix them. Completed items stay checked for this audit.</p>
          <AuditTodoList items={checklist.items} chatId={chatId} signature={signature} />
        </>
      ) : null}
      {priorityCard?.rows?.length ? (
        <div className="workpane-audit-priority">
          <h4>{priorityCard.title || "Priority fixes"}</h4>
          <dl className="chat-workpane-seo">
            {priorityCard.rows.map((row) => (
              <div key={row.label} className="chat-workpane-row">
                <dt>{row.label}</dt>
                <dd>{row.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
      <AuditDataTable table={fixesTable} caption="All recommended fixes" />
    </div>
  );
}
