import { useEffect, useRef, useState } from "react";
import { assistantPlainText } from "./assistantPlainText.js";
import { ChatFeedbackModal } from "./ChatFeedbackModal.jsx";
import { saveFeedback } from "./chatStorage.js";

export function ChatAnswerToolbar({ content, messageIndex, onRetry, retryDisabled, uid, chatId }) {
  const [copied, setCopied] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [thanks, setThanks] = useState("");
  const utteranceRef = useRef(null);

  const plain = assistantPlainText(content);

  useEffect(() => {
    return () => {
      if (typeof window !== "undefined" && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  useEffect(() => {
    if (!copied) return undefined;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function copyAnswer() {
    const text = plain || content;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  function speakAnswer() {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    const text = plain || content;
    if (!text) return;

    if (speaking) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
      return;
    }

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1;
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    utteranceRef.current = utterance;
    setSpeaking(true);
    window.speechSynthesis.speak(utterance);
  }

  function submitFeedback(kind, detail) {
    saveFeedback(uid, {
      kind,
      detail,
      messageIndex,
      chatId: chatId || null,
      excerpt: (plain || content).slice(0, 2000),
      at: Date.now(),
    });
    setFeedback(null);
    setThanks(kind === "up" ? "Thanks for the feedback." : "Thanks — we'll use this to improve.");
    window.setTimeout(() => setThanks(""), 2400);
  }

  return (
    <>
      <div className="chat-answer-toolbar" aria-label="Message actions">
        <ToolbarButton label={copied ? "Copied" : "Copy"} onClick={copyAnswer}>
          <CopyIcon />
        </ToolbarButton>
        <ToolbarButton label={speaking ? "Stop speaking" : "Speak"} onClick={speakAnswer} pressed={speaking}>
          <SpeakIcon />
        </ToolbarButton>
        <ToolbarButton label="Good response" onClick={() => setFeedback("up")}>
          <ThumbUpIcon />
        </ToolbarButton>
        <ToolbarButton label="Bad response" onClick={() => setFeedback("down")}>
          <ThumbDownIcon />
        </ToolbarButton>
        <ToolbarButton label="Try again" onClick={() => onRetry?.(messageIndex)} disabled={retryDisabled}>
          <TryAgainIcon />
        </ToolbarButton>
        {thanks && <span className="chat-toolbar-note">{thanks}</span>}
      </div>
      <ChatFeedbackModal
        open={feedback === "up" || feedback === "down"}
        kind={feedback || "up"}
        onClose={() => setFeedback(null)}
        onSubmit={(detail) => submitFeedback(feedback, detail)}
      />
    </>
  );
}

function ToolbarButton({ label, onClick, pressed, disabled, children }) {
  return (
    <button
      type="button"
      className={`chat-toolbar-btn${pressed ? " is-active" : ""}`}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
      <span className="chat-toolbar-tooltip" role="tooltip">
        {label}
      </span>
    </button>
  );
}

function CopyIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <rect x="6" y="6" width="9" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M5 12H4a1.5 1.5 0 0 1-1.5-1.5V4A1.5 1.5 0 0 1 4 2.5h6.5A1.5 1.5 0 0 1 12 4v1" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

function SpeakIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M4 7.5v3a1 1 0 0 0 1 1h2.5L11 15V3L7.5 6.5H5a1 1 0 0 0-1 1Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M13.5 6.5a4 4 0 0 1 0 5M15.5 4.5a6.5 6.5 0 0 1 0 9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function ThumbUpIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path
        d="M5.5 8.5V15h-1A1.5 1.5 0 0 1 3 13.5v-4A1.5 1.5 0 0 1 4.5 8h1ZM5.5 8.5 9 3.5c.4-.7 1.5-.4 1.5.6V8h3.2c1.1 0 1.8 1.2 1.3 2.2l-1.5 3.2c-.3.7-1 .9-1.5.9H5.5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ThumbDownIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path
        d="M5.5 9.5V3h-1A1.5 1.5 0 0 0 3 4.5v4A1.5 1.5 0 0 0 4.5 10h1ZM5.5 9.5 9 14.5c.4.7 1.5.4 1.5-.6V10h3.2c1.1 0 1.8-1.2 1.3-2.2l-1.5-3.2c-.3-.7-1-.9-1.5-.9H5.5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TryAgainIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
