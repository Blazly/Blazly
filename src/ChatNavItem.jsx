import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export function ChatNavItem({ chat, active, meta, onOpen, onDelete, onRename }) {
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [draft, setDraft] = useState(chat.title);
  const inputRef = useRef(null);
  const deleteDialogRef = useRef(null);

  useEffect(() => {
    setDraft(chat.title);
  }, [chat.title]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  useEffect(() => {
    if (!confirmDelete) return;
    deleteDialogRef.current?.focus();
    function onKeyDown(event) {
      if (event.key === "Escape") setConfirmDelete(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [confirmDelete]);

  function commitRename() {
    const title = draft.trim() || "New chat";
    onRename(title);
    setEditing(false);
  }

  return (
    <div className={`chat-nav-item${active ? " is-active" : ""}`}>
      {editing ? (
        <input
          ref={inputRef}
          className="chat-nav-rename"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commitRename}
          onKeyDown={(event) => {
            if (event.key === "Enter") commitRename();
            if (event.key === "Escape") {
              setDraft(chat.title);
              setEditing(false);
            }
          }}
        />
      ) : (
        <button type="button" className="chat-nav-open" onClick={onOpen}>
          <span className="chat-nav-title">{chat.title}</span>
          {meta ? <span className="chat-nav-meta">{meta}</span> : null}
        </button>
      )}
      <div className="chat-nav-actions">
        <button
          type="button"
          className="chat-nav-icon"
          aria-label={`Rename ${chat.title}`}
          onClick={() => setEditing(true)}
        >
          <RenameIcon />
        </button>
        <button
          type="button"
          className="chat-nav-icon chat-nav-icon-danger"
          aria-label={`Delete ${chat.title}`}
          onClick={(event) => {
            event.stopPropagation();
            setConfirmDelete(true);
          }}
        >
          <DeleteIcon />
        </button>
      </div>

      {confirmDelete ? createPortal(
        <div
          className="chat-modal-backdrop"
          role="presentation"
          onClick={() => setConfirmDelete(false)}
        >
          <div
            className="chat-modal chat-modal-confirm"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={`delete-chat-title-${chat.id}`}
            aria-describedby={`delete-chat-desc-${chat.id}`}
            ref={deleteDialogRef}
            tabIndex={-1}
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id={`delete-chat-title-${chat.id}`} className="chat-modal-title">
              Delete chat?
            </h2>
            <p id={`delete-chat-desc-${chat.id}`} className="chat-modal-body">
              Are you sure you want to delete <strong>{chat.title}</strong>? This can&apos;t be undone.
            </p>
            <div className="chat-modal-actions">
              <button type="button" className="chat-modal-btn is-muted" onClick={() => setConfirmDelete(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="chat-modal-btn is-danger"
                onClick={() => {
                  setConfirmDelete(false);
                  onDelete();
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>,
        document.body,
      ) : null}
    </div>
  );
}

function RenameIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M11.333 2a1.886 1.886 0 0 1 2.667 2.667l-8 8-2.667.667.667-2.667 8-8Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function DeleteIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3 4.5h10M6 4.5V3.5h4v1M5 4.5v8h6v-8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}
