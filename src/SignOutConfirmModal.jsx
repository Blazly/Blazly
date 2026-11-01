export function SignOutConfirmModal({ open, onClose, onConfirm }) {
  if (!open) return null;

  return (
    <div className="chat-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="chat-modal chat-modal-confirm"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="sign-out-title"
        aria-describedby="sign-out-desc"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="sign-out-title" className="chat-modal-title">
          Sign out?
        </h2>
        <p id="sign-out-desc" className="chat-modal-body">
          You will need to log in again to open your workspace and chats.
        </p>
        <div className="chat-modal-actions">
          <button type="button" className="chat-modal-btn is-muted" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="chat-modal-btn is-danger" onClick={onConfirm}>
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
