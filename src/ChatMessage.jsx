import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChatAnswerToolbar } from "./ChatAnswerToolbar.jsx";
import { ChatThinking, thinkingLabel } from "./ChatThinking.jsx";
import { buildMarkdownBlocks } from "./markdownBlocks.js";
import { formatInline } from "./inlineFormat.jsx";
import { hasStructuredSegments, parseAssistantContent, stripUiBlocks } from "./parseAssistantUi.js";
import { parseOrchestratorBadge } from "./aiOrchestratorClient.js";
import { extractAuditSidebar, isAuditRerunActionLabel, splitArticleAssistantText } from "./chatBlocks.js";
import { isHtmlArticle, sanitizeArticleHtml } from "./articleFormat.js";
import { ChatAuditFixes } from "./ChatAuditFixes.jsx";
import { ChatBrandSentiment } from "./ChatBrandSentiment.jsx";
import { ChatActionChecklist } from "./ChatActionChecklist.jsx";
import { Icon } from "./Icon.jsx";

const TABLE_HEADER_TOOLTIPS = {
  confidence:
    "How sure Blazly is about its volume estimate—not how popular the prompt is. High = stronger signal; Low = niche wording or harder to pin down.",
};

export function ChatMessage({
  message,
  onAction,
  animateSteps,
  messageIndex,
  onRetry,
  retryDisabled,
  feedbackUid,
  chatId,
  lastUserMessage,
  onEditUserMessage,
  editUserDisabled,
}) {
  if (message.role === "user") {
    return (
      <UserMessage
        message={message}
        messageIndex={messageIndex}
        onEditUserMessage={onEditUserMessage}
        editDisabled={editUserDisabled}
      />
    );
  }

  if (message.streaming) {
    const label = thinkingLabel(lastUserMessage);
    return (
      <article className="chat-msg is-assistant is-streaming">
        <div className="chat-bubble">
          {!message.content?.trim() ? (
            <ChatThinking label={label} />
          ) : (() => {
            const aware = renderArticleAwareText(message.content);
            if (aware === null) {
              const { html } = splitArticleAssistantText(message.content);
              if (html && isHtmlArticle(html)) {
                return (
                  <>
                    <ChatInlineArticle html={html} />
                    <span className="chat-stream-cursor" aria-hidden="true" />
                  </>
                );
              }
              return (
                <>
                  <p className="chat-article-panel-hint">Writing your draft…</p>
                  <span className="chat-stream-cursor" aria-hidden="true" />
                </>
              );
            }
            if (aware) {
              return (
                <>
                  {aware}
                  <span className="chat-stream-cursor" aria-hidden="true" />
                </>
              );
            }
            return (
              <>
                <AssistantBody content={message.content} />
                <span className="chat-stream-cursor" aria-hidden="true" />
              </>
            );
          })()}
        </div>
      </article>
    );
  }

  const segments = parseAssistantContent(message.content);
  const structured = hasStructuredSegments(segments);
  const toolbar = (
    <ChatAnswerToolbar
      content={message.content}
      messageIndex={messageIndex}
      onRetry={onRetry}
      retryDisabled={retryDisabled}
      uid={feedbackUid}
      chatId={chatId}
    />
  );

  if (!structured) {
    const plain = renderArticleAwareText(message.content);
    const auditOnly = extractAuditSidebar(message.content);
    return (
      <article className="chat-msg is-assistant">
        {plain ?? (
          <div className="chat-bubble">
            <AssistantBody content={message.content} />
          </div>
        )}
        {auditOnly ? (
          <ChatAuditFixes
            fixesTable={auditOnly.fixesTable}
            priorityCard={auditOnly.priorityCard}
            checklist={auditOnly.checklist}
            chatId={chatId}
            signature={`audit-${auditOnly.fixesTable?.rows?.length || 0}-${auditOnly.checklist?.items?.length || 0}`}
            hideChecklist
          />
        ) : null}
        {toolbar}
      </article>
    );
  }

  const actions = segments
    .filter((segment) => segment.type === "action")
    .filter((segment) => !isAuditRerunActionLabel(segment.label));
  const auditSidebar = extractAuditSidebar(message.content);

  return (
    <article className="chat-msg is-assistant">
      {segments.map((segment, index) => {
        if (segment.type === "text") {
          const rendered = renderArticleAwareText(segment.content);
          if (rendered === null) return null;
          if (rendered) {
            return (
              <div key={`text-${index}`}>{rendered}</div>
            );
          }
          return (
            <div key={`text-${index}`} className="chat-bubble">
              <AssistantBody content={segment.content} />
            </div>
          );
        }
        if (segment.type === "plan") {
          return (
            <ChatPlanCard
              key={`plan-${index}`}
              title={segment.title}
              rows={segment.rows}
              onAction={onAction}
            />
          );
        }
        if (segment.type === "card") {
          return <ChatInfoCard key={`card-${index}`} title={segment.title} rows={segment.rows} />;
        }
        if (segment.type === "steps" && segment.checklist) {
          return (
            <ChatActionChecklist
              key={`checklist-${index}`}
              items={segment.items}
              chatId={chatId}
              signature={`checklist-${messageIndex}-${index}-${segment.items.length}`}
            />
          );
        }
        if (segment.type === "steps") {
          return <ChatSteps key={`steps-${index}`} items={segment.items} animate={animateSteps} />;
        }
        if (segment.type === "metrics") {
          return <ChatMetrics key={`metrics-${index}`} items={segment.items} />;
        }
        if (segment.type === "chart") {
          return (
            <ChatTrendChart key={`chart-${index}`} title={segment.title} points={segment.points} />
          );
        }
        if (segment.type === "table") {
          return (
            <ChatDataTable key={`table-${index}`} headers={segment.headers} rows={segment.rows} />
          );
        }
        if (segment.type === "sentiment") {
          return <ChatBrandSentiment key={`sentiment-${index}`} data={segment.data} />;
        }
        if (segment.type === "result") {
          return <ChatResultCard key={`result-${index}`} rows={segment.rows} />;
        }
        if (segment.type === "video") {
          return (
            <div key={`video-${index}`} className="chat-reel-wrap">
              <p className="chat-reel-label">{segment.title}</p>
              <video className="chat-reel-player" src={segment.src} controls playsInline preload="metadata" />
            </div>
          );
        }
        if (segment.type === "workpane") {
          return null;
        }
        return null;
      })}
      {actions.length > 0 && (
        <div className={`chat-actions${actions.length > 1 ? " is-split" : ""}`}>
          {actions.map((action, index) => (
            <button
              key={`action-${index}`}
              type="button"
              className={
                action.variant === "secondary"
                  ? "chat-action is-secondary"
                  : action.variant === "link"
                    ? "chat-action is-link"
                    : "chat-action"
              }
              onClick={() => {
                if (action.variant === "link" && /^https?:\/\//i.test(action.message)) {
                  window.open(action.message, "_blank", "noopener,noreferrer");
                  return;
                }
                onAction?.(action.message);
              }}
            >
              {action.variant === "secondary" && <RefreshIcon />}
              {action.label.replace(/\s*→\s*$/, "")}
              {action.variant === "primary" && <span aria-hidden="true">→</span>}
            </button>
          ))}
        </div>
      )}
      {auditSidebar ? (
        <ChatAuditFixes
          fixesTable={auditSidebar.fixesTable}
          priorityCard={auditSidebar.priorityCard}
          checklist={auditSidebar.checklist}
          chatId={chatId}
          signature={`audit-${auditSidebar.fixesTable?.rows?.length || 0}-${auditSidebar.checklist?.items?.length || 0}`}
          hideChecklist
        />
      ) : null}
      {toolbar}
    </article>
  );
}

function ChatArticleHtml({ html }) {
  return (
    <div
      className="chat-article-html article-html-body"
      dangerouslySetInnerHTML={{ __html: sanitizeArticleHtml(html) }}
    />
  );
}

function ChatInlineArticle({ html }) {
  return (
    <div className="chat-bubble chat-bubble-article">
      <ChatArticleHtml html={html} />
    </div>
  );
}

function isImagePlanRow(label) {
  return /image|photo|visual|hero|thumbnail|featured image|alt text/i.test(String(label || ""));
}

function ChatPlanCard({ title, rows, onAction }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(rows);

  useEffect(() => {
    setDraft(rows);
    setEditing(false);
  }, [rows]);

  function saveEdits() {
    setEditing(false);
    const summary = draft.map((row) => `${row.label}: ${row.value}`).join("; ");
    onAction?.(`Please update the article plan with these values — ${summary}`);
  }

  return (
    <div className="chat-plan">
      <div className="chat-plan-head">
        <span>{title || "Article plan"}</span>
        <button
          type="button"
          className="chat-plan-edit"
          aria-label={editing ? "Save plan edits" : "Edit plan"}
          onClick={() => {
            if (editing) saveEdits();
            else setEditing(true);
          }}
        >
          {editing ? <CheckIcon /> : <PencilIcon />}
        </button>
      </div>
      <dl className="chat-plan-rows">
        {draft.filter((row) => !isImagePlanRow(row.label)).map((row) => (
          <div key={row.label} className="chat-plan-row">
            <dt>{row.label}</dt>
            {editing ? (
              <dd>
                <input
                  className="chat-plan-input"
                  value={row.value}
                  onChange={(event) => {
                    const value = event.target.value;
                    setDraft((current) =>
                      current.map((item) => (item.label === row.label ? { ...item, value } : item))
                    );
                  }}
                />
              </dd>
            ) : (
              <dd>{row.value}</dd>
            )}
          </div>
        ))}
      </dl>
    </div>
  );
}

function ChatInfoCard({ title, rows }) {
  return (
    <div className="chat-plan chat-card">
      <div className="chat-plan-head">
        <span>{title || "Details"}</span>
      </div>
      <dl className="chat-plan-rows">
        {rows.map((row) => (
          <div key={row.label} className="chat-plan-row">
            <dt>{row.label}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function metricNeedsFullRow(item) {
  const label = String(item.label || "").toLowerCase();
  if (label === "target url" || label === "meta description" || label === "meta title") return true;
  return String(item.displayValue || "").length > 52;
}

function ChatMetrics({ items }) {
  return (
    <div className="chat-metrics">
      {items.map((item) => (
        <div
          key={item.label}
          className={`chat-metric is-${item.tone || "neutral"}${metricNeedsFullRow(item) ? " is-wide" : ""}`}
        >
          <span className="chat-metric-label">{item.label}</span>
          <strong className="chat-metric-value">{item.displayValue}</strong>
        </div>
      ))}
    </div>
  );
}

function ChatTrendChart({ title, points }) {
  if (!points?.length) return null;
  const max = Math.max(...points.map((point) => point.value), 1);

  return (
    <div className="chat-trend-chart">
      {title ? <p className="chat-trend-chart-title">{title}</p> : null}
      <div className="chat-trend-chart-bars" role="img" aria-label={title || "Search trend chart"}>
        {points.map((point) => (
          <div key={point.label} className="chat-trend-chart-bar-col">
            <div className="chat-trend-chart-bar-track">
              <div
                className="chat-trend-chart-bar-fill"
                style={{ height: `${Math.max(8, Math.round((point.value / max) * 100))}%` }}
                title={`${point.label}: ${point.value.toLocaleString()}`}
              />
            </div>
            <span className="chat-trend-chart-bar-value">{point.value.toLocaleString()}</span>
            <span className="chat-trend-chart-bar-label">{point.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function tableHeaderTooltip(header) {
  const plain = String(header || "")
    .replace(/<[^>]+>/g, "")
    .trim()
    .toLowerCase();
  return TABLE_HEADER_TOOLTIPS[plain] || null;
}

function ChatColumnHeaderTip({ label, tooltip }) {
  const anchorRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });

  function syncPosition() {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const gap = 8;
    const estimatedHeight = 88;
    const spaceBelow = window.innerHeight - rect.bottom;
    const showAbove = spaceBelow < estimatedHeight + gap && rect.top > estimatedHeight + gap;
    setPosition({
      top: showAbove ? rect.top - gap : rect.bottom + gap,
      left: rect.left + rect.width / 2,
      placement: showAbove ? "above" : "below",
    });
  }

  function show() {
    syncPosition();
    setOpen(true);
  }

  function hide() {
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const onScrollOrResize = () => syncPosition();
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [open]);

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className="chat-th-info"
        aria-label={label}
        aria-expanded={open}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
      >
        <Icon name="info" size={14} strokeWidth={1.5} />
      </button>
      {open
        ? createPortal(
            <div
              className={`chat-th-tooltip-portal${position.placement === "above" ? " is-above" : ""}`}
              style={{ top: position.top, left: position.left }}
              role="tooltip"
            >
              {tooltip}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

function ChatTableHeader({ header, headerIndex }) {
  const tooltip = tableHeaderTooltip(header);
  if (!tooltip) {
    return <th key={`${headerIndex}-${header}`}>{formatInline(header)}</th>;
  }
  return (
    <th key={`${headerIndex}-${header}`}>
      <span className="chat-th-head">
        <span className="chat-th-label">{formatInline(header)}</span>
        <ChatColumnHeaderTip label="What does Confidence mean?" tooltip={tooltip} />
      </span>
    </th>
  );
}

function ChatDataTable({ headers, rows }) {
  return (
    <div className="chat-table-wrap">
      <table className="chat-table">
        <thead>
          <tr>
            {headers.map((header, headerIndex) => (
              <ChatTableHeader key={`${headerIndex}-${header}`} header={header} headerIndex={headerIndex} />
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <td key={`${rowIndex}-${cellIndex}`}>{formatInline(cell)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ChatSteps({ items, animate }) {
  const [visible, setVisible] = useState(animate ? 0 : items.length);

  useEffect(() => {
    if (!animate) {
      setVisible(items.length);
      return;
    }
    setVisible(0);
  }, [animate, items]);

  useEffect(() => {
    if (!animate || visible >= items.length) return undefined;
    const timer = window.setTimeout(() => setVisible((count) => count + 1), 420);
    return () => window.clearTimeout(timer);
  }, [animate, visible, items.length]);

  return (
    <div className="chat-steps">
      <ul className="chat-steps-list">
        {items.map((item, index) => {
          const label = typeof item === "string" ? item : item.text;
          const state = typeof item === "string" ? null : item.state;
          const done = state === "done" || (!state && index < visible);
          const pending = state === "pending" || (!state && animate && index >= visible);
          const active = state === "active";
          return (
            <li
              key={`${label}-${index}`}
              className={done ? "is-done" : active ? "is-active" : pending ? "is-pending" : ""}
            >
              <span className="chat-step-icon" aria-hidden="true">
                {done ? (
                  <StepCheckIcon />
                ) : active ? (
                  <span className="chat-step-spinner" />
                ) : (
                  <span className="chat-step-dot" />
                )}
              </span>
              <span>{label}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ChatResultCard({ rows }) {
  const map = Object.fromEntries(rows.map((row) => [row.label.toLowerCase(), row.value]));
  const title = map.title || map["seo title"] || "Article title";
  const copy = map.copy || map.excerpt || map.description || "Your article preview will appear here.";

  return (
    <div className="chat-result">
      <p className="chat-result-lead">Your article is ready!</p>
      <div className="chat-result-preview is-text-only">
        <strong>{title}</strong>
        <p>{copy}</p>
      </div>
    </div>
  );
}

function renderArticleAwareText(content) {
  const { summary, html } = splitArticleAssistantText(content);
  if (html && isHtmlArticle(html)) {
    return (
      <div className="chat-bubble chat-bubble-article">
        {summary ? (
          <div className="chat-bubble-article-summary">
            <AssistantBody content={summary} />
          </div>
        ) : null}
        <ChatArticleHtml html={html} />
      </div>
    );
  }
  if (isHtmlArticle(content)) {
    return (
      <div className="chat-bubble chat-bubble-article">
        <ChatArticleHtml html={content} />
      </div>
    );
  }
  return undefined;
}

export function AssistantBody({ content }) {
  const badge = parseOrchestratorBadge(content);
  const blocks = buildMarkdownBlocks(stripUiBlocks(content));
  return (
    <div className="chat-body">
      {badge ? (
        <span className="chat-orchestrator-badge">Agent · {badge.title}</span>
      ) : null}
      {blocks.map((block, index) => {
        if (block.type === "table") {
          return (
            <ChatDataTable key={index} headers={block.headers} rows={block.rows} />
          );
        }
        if (block.type === "list") {
          return (
            <ul key={index} className="chat-list">
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{formatInline(item)}</li>
              ))}
            </ul>
          );
        }
        if (block.type === "heading") {
          const level = Math.min(3, Math.max(1, block.level || 2));
          return (
            <p key={index} className={`chat-heading is-h${level}`}>
              {formatInline(block.text)}
            </p>
          );
        }
        return (
          <p key={index} className="chat-paragraph">
            {formatInline(block.text)}
          </p>
        );
      })}
    </div>
  );
}

function UserMessage({ message, messageIndex, onEditUserMessage, editDisabled }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content || "");
  const images = (message.attachments || []).filter((item) => item.type === "image");
  const hasAttachments = (message.attachments || []).length > 0;
  const canEdit = !editDisabled && !hasAttachments && Boolean(onEditUserMessage);

  useEffect(() => {
    if (!editing) setDraft(message.content || "");
  }, [message.content, editing]);

  function cancelEdit() {
    setDraft(message.content || "");
    setEditing(false);
  }

  function submitEdit() {
    const next = draft.trim();
    if (!next) return;
    onEditUserMessage?.(messageIndex, next);
    setEditing(false);
  }

  if (editing) {
    return (
      <div className="chat-user-wrap is-editing-mode">
        <article className="chat-msg is-user is-editing">
          <textarea
            className="chat-user-edit-input"
            value={draft}
            rows={Math.min(12, Math.max(3, draft.split("\n").length + 1))}
            aria-label="Edit message"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                cancelEdit();
              }
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                submitEdit();
              }
            }}
          />
          <div className="chat-user-edit-actions">
            <button type="button" className="chat-user-edit-btn" onClick={cancelEdit}>
              Cancel
            </button>
            <button
              type="button"
              className="chat-user-edit-btn is-primary"
              disabled={!draft.trim()}
              onClick={submitEdit}
            >
              Resend
            </button>
          </div>
        </article>
      </div>
    );
  }

  return (
    <div className="chat-user-wrap">
      <article className="chat-msg is-user">
        {images.length > 0 && (
          <div className="chat-user-attachments">
            {images.map((item, imageIndex) => (
              <figure key={`${item.name}-${imageIndex}`} className="chat-user-attachment">
                {item.previewUrl ? (
                  <img src={item.previewUrl} alt={item.name || "Attached image"} />
                ) : (
                  <span className="chat-user-attachment-fallback">{item.name || "Image"}</span>
                )}
              </figure>
            ))}
          </div>
        )}
        {message.content ? <p>{message.content}</p> : null}
      </article>
      {canEdit && message.content ? (
        <div className="chat-user-actions">
          <button
            type="button"
            className="chat-user-action-btn"
            aria-label="Edit message"
            title="Edit and resend"
            onClick={() => setEditing(true)}
          >
            <PencilIcon />
            <span>Edit</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}

function PencilIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M11.333 2a1.886 1.886 0 0 1 2.667 2.667l-8 8-2.667.667.667-2.667 8-8Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3.5 8.5 6.5 11.5 12.5 4.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function StepCheckIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <circle cx="9" cy="9" r="9" fill="currentColor" />
      <path
        className="chat-step-check-mark"
        d="M5.5 9.2 7.8 11.5 12.5 6.5"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path
        d="M14.5 9a5.5 5.5 0 1 1-1.6-3.9M14.5 4.5V9h-4.5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

