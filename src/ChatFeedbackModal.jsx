import { useEffect, useRef } from "react";

const COPY = {
  up: {
    title: "Give positive feedback",
    placeholder: "What was satisfying about this response?",
  },
  down: {
    title: "Give negative feedback",
    placeholder: "What was unsatisfying about this response?",
  },
};

export function ChatFeedbackModal({ open, kind, onClose, onSubmit }) {
  const dialogRef = useRef(null);
  const fieldRef = useRef(null);
  const copy = COPY[kind] || COPY.up;

  useEffect(() => {
    if (!open) return undefined;
    const previous = document.activeElement;
    fieldRef.current?.focus();
    function onKeyDown(event) {
      if (event.key === "Escape") onClose?.();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="chat-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="chat-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="chat-feedback-title"
        ref={dialogRef}
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="chat-feedback-title" className="chat-modal-title">
          {copy.title}
        </h2>
        <form
          className="chat-modal-form"
          onSubmit={(event) => {
            event.preventDefault();
            const detail = fieldRef.current?.value?.trim() || "";
            onSubmit?.(detail);
          }}
        >
          <label className="chat-modal-label" htmlFor="chat-feedback-details">
            Please provide details: (optional)
          </label>
          <textarea
            key={kind}
            id="chat-feedback-details"
            ref={fieldRef}
            className="chat-modal-field"
            rows={5}
            defaultValue=""
            placeholder={copy.placeholder}
          />
          <p className="chat-modal-note">
            Submitting this report saves your feedback and this message to help improve Blazly. We do not use it to
            train third-party models without your consent.
          </p>
          <div className="chat-modal-actions">
            <button type="button" className="chat-modal-btn is-muted" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="chat-modal-btn is-primary">
              Submit
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
