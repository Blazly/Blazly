import { useEffect, useState } from "react";
import { ChatMessage } from "./ChatMessage.jsx";
import { loadChatShare } from "./chatShare.js";

export function SharedChatView({ shareId }) {
  const [state, setState] = useState({ status: "loading", data: null });

  useEffect(() => {
    let cancelled = false;
    loadChatShare(shareId)
      .then((data) => {
        if (cancelled) return;
        setState(data ? { status: "ready", data } : { status: "missing", data: null });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "missing", data: null });
      });
    return () => {
      cancelled = true;
    };
  }, [shareId]);

  useEffect(() => {
    if (state.data?.title) document.title = `${state.data.title} · Blazly`;
  }, [state.data?.title]);

  const { status, data } = state;

  return (
    <div className="shared-chat">
      <header className="shared-chat-bar">
        <a className="shared-chat-brand" href="/">
          <img src="/favicon.png" alt="" width="22" height="22" />
          <span>Blazly</span>
        </a>
        <a className="btn btn-accent shared-chat-cta" href="/">
          Try Blazly
        </a>
      </header>

      <main className="shared-chat-main">
        {status === "loading" ? <p className="shared-chat-note">Loading shared chat…</p> : null}
        {status === "missing" ? (
          <div className="shared-chat-empty">
            <h1>This chat isn’t available</h1>
            <p>The link may be wrong, or the owner stopped sharing it.</p>
          </div>
        ) : null}
        {status === "ready" ? (
          <>
            <div className="shared-chat-head">
              <h1>{data.title}</h1>
              <p>
                Shared{data.ownerName ? ` by ${data.ownerName}` : ""} · read-only
              </p>
            </div>
            <div className="chat-thread shared-chat-thread">
              {data.messages.map((message, index) => (
                <ChatMessage
                  key={index}
                  message={message}
                  messageIndex={index}
                  chatId={`share-${shareId}`}
                  onAction={() => {}}
                  retryDisabled
                  editUserDisabled
                />
              ))}
            </div>
          </>
        ) : null}
      </main>
    </div>
  );
}
