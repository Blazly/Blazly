import { useEffect, useState } from "react";
import { Icon } from "./Icon.jsx";
import { TOPUP_PACKS, topupPrice } from "./plans.js";
import { startTopupCheckout } from "./billingClient.js";

function formatPrice(value) {
  return Number.isInteger(value) ? `$${value}` : `$${value.toFixed(2)}`;
}

export function OutOfCreditsModal({ open, onClose, credits, email, onSeePlans }) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const plan = credits?.data?.plan || "free";
  const balance = credits?.data?.balance ?? 0;
  const teamMember = Boolean(credits?.data?.teamOwner);

  useEffect(() => {
    if (!open) return undefined;
    setError("");
    setBusy("");
    const onKey = (event) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  async function buy(pack) {
    setBusy(String(pack));
    setError("");
    try {
      await startTopupCheckout(pack, email);
    } catch (err) {
      setError(err.message);
      setBusy("");
    }
  }

  return (
    <div className="referral-modal-backdrop" onClick={onClose}>
      <div className="referral-modal credits-modal" role="dialog" aria-modal="true" aria-label="Need more credits" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="referral-modal-close" aria-label="Close" onClick={onClose}>
          <Icon name="x" size={16} />
        </button>
        <div className="referral-modal-hero">
          <span className="referral-modal-gift">⚡</span>
          <h2>You're out of credits</h2>
          <p>
            You have {balance.toLocaleString()} credits left.{" "}
            {teamMember
              ? "Ask your team owner to top up so you can keep running agents."
              : "Top up to keep running agents. Top-up credits never expire and are only used when you run an agent."}
          </p>
        </div>
        {!teamMember && (
          <div className="pricing-topups credits-modal-packs">
            {TOPUP_PACKS.map((pack) => (
              <button key={pack} type="button" className="pricing-topup" disabled={Boolean(busy)} onClick={() => buy(pack)}>
                <strong>{pack.toLocaleString()} credits</strong>
                <span>{busy === String(pack) ? "Redirecting…" : formatPrice(topupPrice(plan, pack))}</span>
              </button>
            ))}
          </div>
        )}
        {error && <p className="credits-modal-error">{error}</p>}
        <button type="button" className="btn btn-secondary credits-modal-plans" onClick={onSeePlans}>
          See plans
        </button>
      </div>
    </div>
  );
}
