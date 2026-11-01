import { useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon.jsx";
import { publishChatShare, shareUrl } from "./chatShare.js";

export function ShareChatButton({ uid, chat, messages, ownerName, onShared, disabled }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState("idle");
  const [url, setUrl] = useState("");
  const [copied, setCopied] = useState(false);

  async function publish() {
    setStatus("publishing");
    setCopied(false);
    try {
      const shareId = await publishChatShare({
        uid,
        chat,
        messages,
        ownerName,
        existingShareId: chat?.shareId,
      });
      if (shareId !== chat?.shareId) onShared?.(shareId);
      setUrl(shareUrl(shareId));
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }

  function openDialog() {
    setOpen(true);
    publish();
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="btn btn-secondary share-chat-trigger"
        onClick={openDialog}
        disabled={disabled}
      >
        <Icon name="link" size={15} />
        Share
      </button>
      {open
        ? createPortal(
            <div className="chat-modal-backdrop" onClick={() => setOpen(false)}>
              <div
                className="chat-modal share-chat-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="share-chat-title"
                onClick={(event) => event.stopPropagation()}
              >
                <h2 id="share-chat-title" className="chat-modal-title">
                  Share this chat
                </h2>
                <p className="chat-modal-body">
                  Anyone with the link can view this conversation. They can’t edit it or see your other chats. Messages
                  you send later aren’t included until you share again.
                </p>
                <div className="share-chat-field">
                  <input
                    readOnly
                    value={status === "ready" ? url : status === "error" ? "" : "Creating link…"}
                    placeholder={status === "error" ? "Could not create link" : ""}
                    onFocus={(event) => event.target.select()}
                    aria-label="Share link"
                  />
                  <button
                    type="button"
                    className="btn btn-accent"
                    onClick={status === "error" ? publish : copy}
                    disabled={status === "publishing"}
                  >
                    {status === "error" ? "Retry" : copied ? "Copied" : "Copy link"}
                  </button>
                </div>
                {status === "error" ? (
                  <p className="share-chat-error">Could not create the share link. Check your connection and retry.</p>
                ) : null}
                <div className="chat-modal-actions">
                  <button type="button" className="chat-modal-btn is-muted" onClick={() => setOpen(false)}>
                    Done
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
