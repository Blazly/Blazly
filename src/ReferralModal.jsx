import { useEffect } from "react";
import { Icon } from "./Icon.jsx";
import { ReferralCard } from "./ReferralCard.jsx";

export function ReferralModal({ open, onClose }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="referral-modal-backdrop" onClick={onClose}>
      <div className="referral-modal" role="dialog" aria-modal="true" aria-label="Invite friends" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="referral-modal-close" aria-label="Close" onClick={onClose}>
          <Icon name="x" size={16} />
        </button>
        <div className="referral-modal-hero">
          <span className="referral-modal-gift">🎁</span>
          <h2>Give Blazly, get 250 credits</h2>
          <p>Every friend who signs up with your link and buys a paid plan adds 250 free credits to your balance. No limit.</p>
          <ol className="referral-steps">
            <li><strong>1</strong> Copy your link</li>
            <li><strong>2</strong> A friend signs up and upgrades</li>
            <li><strong>3</strong> You get +250 credits</li>
          </ol>
        </div>
        <ReferralCard />
      </div>
    </div>
  );
}
