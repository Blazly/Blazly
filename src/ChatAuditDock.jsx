import { AuditTodoList } from "./ChatAuditFixes.jsx";

export function ChatAuditDock({ dock, chatId, onRerun, rerunDisabled, inThread }) {
  if (!dock?.checklist?.items?.length && !dock?.rerunMessage) return null;

  const label = dock.rerunLabel?.replace(/\s*→\s*$/, "") || "Re-run audit after fixes";

  return (
    <div className={`chat-audit-dock${inThread ? " is-in-thread" : ""}`} aria-label="Audit fixes">
      {dock.checklist?.items?.length ? (
        <div className="chat-audit-dock-checklist chat-audit-fixes workpane-audit-fixes">
          <p className="workpane-audit-lead">
            Tick items as you fix them. Completed items stay checked for this audit.
          </p>
          <AuditTodoList items={dock.checklist.items} chatId={chatId} signature={dock.signature} />
        </div>
      ) : null}
      {dock.rerunMessage ? (
        <button
          type="button"
          className="chat-audit-dock-rerun chat-action"
          disabled={rerunDisabled}
          onClick={() => onRerun?.(dock.rerunMessage)}
        >
          {label}
          <span aria-hidden="true">→</span>
        </button>
      ) : null}
    </div>
  );
}
