import { useCallback, useEffect, useState } from "react";
import { fetchCredits } from "./firebase.js";

const RADIUS = 80;
const ARC = Math.PI * RADIUS;

function gaugeTone(ratio) {
  if (ratio >= 0.9) return "is-critical";
  if (ratio >= 0.7) return "is-warning";
  return "is-healthy";
}

function CreditGauge({ used, granted }) {
  const ratio = granted > 0 ? Math.min(1, used / granted) : 0;
  return (
    <div className={`credit-gauge ${gaugeTone(ratio)}`} role="img" aria-label={`${used} of ${granted} credits used`}>
      <svg viewBox="0 0 200 116" width="100%">
        <path className="credit-gauge-track" d="M 20 100 A 80 80 0 0 1 180 100" />
        <path
          className="credit-gauge-fill"
          d="M 20 100 A 80 80 0 0 1 180 100"
          strokeDasharray={ARC}
          strokeDashoffset={ARC * (1 - ratio)}
        />
      </svg>
      <div className="credit-gauge-center">
        <span className="credit-gauge-value">{used.toLocaleString()}</span>
        <span className="credit-gauge-label">of {granted.toLocaleString()} used</span>
      </div>
      <div className="credit-gauge-scale">
        <span>0</span>
        <span>{granted.toLocaleString()}</span>
      </div>
    </div>
  );
}

function formatWhen(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** Live credit balance; refreshes after every agent run and every minute. */
export function useCredits(enabled = true) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      setData(await fetchCredits());
      setError("");
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    refresh();
    const onChange = () => setTimeout(refresh, 1500);
    window.addEventListener("blazly:credits-changed", onChange);
    const timer = setInterval(refresh, 60_000);
    return () => {
      window.removeEventListener("blazly:credits-changed", onChange);
      clearInterval(timer);
    };
  }, [refresh, enabled]);

  const granted = data?.granted || 0;
  const used = data?.used || 0;
  const percent = granted ? Math.min(100, Math.round((used / granted) * 100)) : 0;
  return { data, error, used, granted, balance: data?.balance ?? 0, percent, refresh };
}

export function CreditMeter({ credits, className = "" }) {
  const tone = credits.percent >= 90 ? " is-critical" : credits.percent >= 70 ? " is-warning" : "";
  return (
    <div className={`meter${tone} ${className}`} aria-hidden="true">
      <span style={{ width: `${credits.percent}%` }} />
    </div>
  );
}

export function CreditsCard() {
  const { data, error } = useCredits();

  const usage = (data?.transactions || []).filter((t) => t.type === "charge" && t.status !== "refunded").slice(0, 8);

  return (
    <section className="settings-section">
      <div className="settings-section-head">
        <h2 className="settings-section-title">Credits</h2>
        <p className="settings-section-note">
          Every agent run uses credits based on the AI and data it needs. {data?.plan === "free" ? "Free plan." : ""}
        </p>
      </div>
      {error ? <p className="profile-field-error">{error}</p> : null}
      {!data && !error ? <p className="settings-section-note">Loading credits…</p> : null}
      {data ? (
        <div className="credit-overview">
          <CreditGauge used={data.used || 0} granted={data.granted || 0} />
          <div className="credit-stats">
            <div className="credit-stat">
              <span className="credit-stat-value">{(data.balance || 0).toLocaleString()}</span>
              <span className="credit-stat-label">credits left</span>
            </div>
            <div className="credit-stat">
              <span className="credit-stat-value">{(data.used || 0).toLocaleString()}</span>
              <span className="credit-stat-label">used</span>
            </div>
            <div className="credit-stat">
              <span className="credit-stat-value">{(data.granted || 0).toLocaleString()}</span>
              <span className="credit-stat-label">total granted</span>
            </div>
          </div>
        </div>
      ) : null}
      {usage.length ? (
        <ul className="credit-usage">
          {usage.map((t) => (
            <li key={t.id}>
              <span className="credit-usage-label">
                {t.label}
                {t.source && t.source !== "app" ? <span className="credit-usage-source">{t.source}</span> : null}
              </span>
              <span className="credit-usage-when">{formatWhen(t.createdAt)}</span>
              <span className="credit-usage-amount">−{t.amount}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
