import { useEffect, useState } from "react";
import { loadAuditTodos, saveAuditTodos, todoItemKey } from "./auditTodoStorage.js";
import { AssistantBody } from "./ChatMessage.jsx";
import { htmlToPlainMarkdown, isHtmlArticle, sanitizeArticleHtml } from "./articleFormat.js";
import { formatInline } from "./inlineFormat.jsx";

const TABS = {
  article: [
    { id: "content", label: "Content" },
    { id: "seo", label: "SEO Details" },
  ],
  report: [
    { id: "content", label: "Content" },
    { id: "seo", label: "Details" },
  ],
};

function WorkpaneDataTable({ table, caption }) {
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

function AuditTodoList({ items, chatId, signature }) {
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

function AuditFixesPanel({ data, chatId }) {
  return (
    <div className="chat-workpane-content workpane-audit-fixes">
      <p className="workpane-audit-lead">Tick items as you fix them — completed to-dos stay struck through for this audit.</p>
      {data.fixChecklist?.items?.length ? (
        <AuditTodoList items={data.fixChecklist.items} chatId={chatId} signature={data.signature} />
      ) : null}
      {data.priorityFixes?.rows?.length ? (
        <div className="workpane-audit-priority">
          <h4>{data.priorityFixes.title || "Priority fixes"}</h4>
          <dl className="chat-workpane-seo">
            {data.priorityFixes.rows.map((row) => (
              <div key={row.label} className="chat-workpane-row">
                <dt>{row.label}</dt>
                <dd>{row.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
      <WorkpaneDataTable table={data.auditFixes} caption="All recommended fixes" />
    </div>
  );
}

function WorkpaneCopyIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <rect x="6" y="6" width="9" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M5 12H4a1.5 1.5 0 0 1-1.5-1.5V4A1.5 1.5 0 0 1 4 2.5h6.5A1.5 1.5 0 0 1 12 4v1"
        stroke="currentColor"
        strokeWidth="1.3"
      />
    </svg>
  );
}

function WorkpaneCheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M3.5 8.2 6.3 11 12.5 4.8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function workpaneCopyText(data, body) {
  const article = String(body || "").trim();
  if (!article) return "";
  const title = String(data?.title || "").trim();
  let text = isHtmlArticle(article) ? htmlToPlainMarkdown(article) : article;
  if (title) text = `${title}\n\n${text}`.trim();
  return text;
}

function WorkpaneExpandIcon({ expanded }) {
  const stroke = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.4,
    strokeLinecap: "round",
    strokeLinejoin: "round",
  };
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      {expanded ? (
        <>
          <path d="M6 2H2v4M2 2l4 4" {...stroke} />
          <path d="M10 14h4v-4M14 14l-4-4" {...stroke} />
        </>
      ) : (
        <>
          <path d="M6 2H2v4M2 2l4 4" {...stroke} />
          <path d="M10 14h4v-4M14 14l-4-4" {...stroke} transform="rotate(180 8 8)" />
        </>
      )}
    </svg>
  );
}

export function ChatWorkpane({
  data,
  tab,
  onTabChange,
  onClose,
  fullPage = false,
  onToggleFullPage,
  onOpenFullEditor,
  draft,
  streaming,
  chatId,
}) {
  const [localTab, setLocalTab] = useState(tab || "content");
  const [copied, setCopied] = useState(false);
  const activeTab = tab || localTab;
  const tabs = TABS[data?.task] || TABS.article;
  const body = draft ?? data?.body ?? "";
  const isAudit = data?.task === "audit";
  const copyable = !isAudit && Boolean(String(body || "").trim());

  useEffect(() => {
    if (!copied) return undefined;
    const timer = window.setTimeout(() => setCopied(false), 2200);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function copyArticle() {
    const text = workpaneCopyText(data, body);
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  function chooseTab(id) {
    setLocalTab(id);
    onTabChange?.(id);
  }

  if (!data) return null;

  const heading = isAudit ? "Fixes & to-dos" : data.task === "report" ? "Report" : "Blog article";

  return (
    <aside className="chat-workpane" aria-label={`${heading} preview`}>
      <header className="chat-workpane-head">
        <h2>{heading}</h2>
        <div className="chat-workpane-head-actions">
          {!isAudit && (
            <button
              type="button"
              className={`chat-workpane-copy-btn${copied ? " is-copied" : ""}`}
              aria-label={copied ? "Copied" : "Copy article"}
              disabled={!copyable && !copied}
              onClick={copyArticle}
            >
              {copied ? (
                <>
                  <WorkpaneCheckIcon />
                  <span className="chat-workpane-copy-label">Copied</span>
                </>
              ) : (
                <WorkpaneCopyIcon />
              )}
            </button>
          )}
          <button
            type="button"
            className="chat-workpane-icon-btn"
            aria-label={fullPage ? "Exit full page view" : "Open panel full page"}
            aria-pressed={fullPage}
            onClick={() => onToggleFullPage?.()}
          >
            <WorkpaneExpandIcon expanded={fullPage} />
          </button>
          <button type="button" className="chat-workpane-close" aria-label="Close panel" onClick={onClose}>
            ×
          </button>
        </div>
      </header>

      {!isAudit && (
        <div className="chat-workpane-tabs" role="tablist">
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={activeTab === item.id}
              className={activeTab === item.id ? "is-active" : ""}
              onClick={() => chooseTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}

      <div className="chat-workpane-body">
        {isAudit ? (
          <AuditFixesPanel data={data} chatId={chatId} />
        ) : (
          <>
            {activeTab === "content" && (
              <div className="chat-workpane-content">
                <h3>{data.title}</h3>
                {body ? (
                  <div className="chat-workpane-article">
                    {isHtmlArticle(body) ? (
                      <div
                        className="article-html-body"
                        dangerouslySetInnerHTML={{ __html: sanitizeArticleHtml(body) }}
                      />
                    ) : (
                      <AssistantBody content={body} />
                    )}
                    {streaming && <span className="chat-stream-cursor" aria-hidden="true" />}
                  </div>
                ) : streaming ? (
                  <p className="chat-workpane-empty chat-workpane-streaming">Writing your draft…</p>
                ) : (
                  <p className="chat-workpane-empty">
                    {data.result?.copy || "Your draft will appear here once Blazly finishes writing."}
                  </p>
                )}
              </div>
            )}

            {activeTab === "seo" && (
              <dl className="chat-workpane-seo">
                <WorkpaneRow label="Target keyword" value={data.targetKeyword} />
                <WorkpaneRow label="Meta description" value={data.metaDescription} />
                <WorkpaneRow label="Word count" value={data.wordCount} />
                <WorkpaneRow label="Intent" value={data.intent} />
                <WorkpaneRow label="Target URL" value={data.targetUrl} />
                {data.plan
                  ?.filter((row) => !shouldHidePlanRow(row.label))
                  .map((row) => (
                    <WorkpaneRow key={row.label} label={row.label} value={row.value} />
                  ))}
              </dl>
            )}
          </>
        )}
      </div>

      <footer className="chat-workpane-foot">
        {!isAudit && (
          <>
            <button type="button" className="chat-workpane-btn is-muted" onClick={() => onOpenFullEditor?.()}>
              Edit in Editor
            </button>
            <button type="button" className="chat-workpane-btn is-primary">
              Publish to Website
              <span aria-hidden="true">→</span>
            </button>
          </>
        )}
        {isAudit && (
          <button type="button" className="chat-workpane-btn is-muted" onClick={onClose}>
            Close panel
          </button>
        )}
      </footer>
    </aside>
  );
}

function WorkpaneRow({ label, value }) {
  if (!value) return null;
  return (
    <div className="chat-workpane-row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function shouldHidePlanRow(label) {
  return /seo title|meta description|target keyword|word count|intent|target url/i.test(String(label || ""));
}
