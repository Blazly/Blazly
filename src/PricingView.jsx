import { useEffect, useState } from "react";
import { Icon } from "./Icon.jsx";
import { ReferralCard } from "./ReferralCard.jsx";
import { PLAN_ORDER, PLANS, TOPUP_PACKS, topupPrice } from "./plans.js";
import { fetchBillingConfig, openBillingPortal, startPlanCheckout, startTopupCheckout } from "./billingClient.js";

const NOTICES = {
  success: { tone: "success", text: "Payment received. Your plan and credits will update in a few seconds." },
  "topup-success": { tone: "success", text: "Top-up complete. Your new credits will appear in a few seconds." },
  cancelled: { tone: "info", text: "Checkout cancelled. Nothing was charged." },
  "project-limit": { tone: "info", text: "You've reached the project limit for your plan. Upgrade to add more projects." },
  "project-edit": { tone: "info", text: "Editing and deleting projects is available on Pro and Business. Upgrade to change your project's name or website (once every 30 days)." },
};

const MODE_ROWS = [
  ["Who picks the agent", "You", "Blazly's AI router"],
  ["Extra cost", "None", "+1 credit per message"],
  ["Agent prices", "Standard", "Same as manual"],
  ["Chain several agents", "One at a time", "Up to 4 per scheduled task (Pro and Business)"],
  ["Scheduling", "—", "Pro and Business"],
];

const EXAMPLES = [
  ["Keyword research", 5, 6],
  ["Standard blog post", 30, 31],
  ["Blog + publish to WordPress", 35, 36],
  ["Competitor research", 70, 71],
];

function formatPrice(value) {
  return Number.isInteger(value) ? `$${value}` : `$${value.toFixed(2)}`;
}

export function PricingView({ credits, email, notice: initialNotice }) {
  const [interval, setBillingInterval] = useState("month");
  const [config, setConfig] = useState(null);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState(initialNotice ? NOTICES[initialNotice] : null);

  useEffect(() => {
    fetchBillingConfig().then(setConfig);
  }, []);

  const currentPlan = credits?.data?.plan || "free";
  const paid = currentPlan !== "free";
  const teamMember = Boolean(credits?.data?.teamOwner);
  const stripeReady = Boolean(config?.enabled) && !teamMember;

  async function run(key, action) {
    setBusy(key);
    setNotice(null);
    try {
      await action();
    } catch (error) {
      setNotice({ tone: "error", text: error.message });
      setBusy("");
    }
  }

  return (
    <div className="page pricing-page">
      <header className="pricing-hero">
        <h1>Plans and credits</h1>
        <p>Start with 500 free credits. Upgrade when you need more runs, scheduling or team features.</p>
        <div className="pricing-toggle" role="tablist" aria-label="Billing interval">
          <button type="button" role="tab" aria-selected={interval === "month"} className={interval === "month" ? "is-active" : ""} onClick={() => setBillingInterval("month")}>
            Monthly
          </button>
          <button type="button" role="tab" aria-selected={interval === "year"} className={interval === "year" ? "is-active" : ""} onClick={() => setBillingInterval("year")}>
            Annual <span className="pricing-save">2 months free</span>
          </button>
        </div>
      </header>

      {notice && <div className={`pricing-notice is-${notice.tone}`}>{notice.text}</div>}
      {teamMember && (
        <div className="pricing-notice is-info">You're on a team plan. The team owner manages billing and credits.</div>
      )}
      {config && !config.enabled && (
        <div className="pricing-notice is-info">Payments are being set up. Upgrades will be available shortly.</div>
      )}

      <div className="pricing-grid">
        {PLAN_ORDER.map((id) => {
          const plan = PLANS[id];
          const price = interval === "year" ? plan.annual / 12 : plan.monthly;
          const isCurrent = currentPlan === id;
          const priceConfigured = id === "free" || config?.prices?.[id]?.[interval];
          return (
            <article key={id} className={`pricing-card${plan.popular ? " is-popular" : ""}${isCurrent ? " is-current" : ""}`}>
              {isCurrent ? (
                <span className="pricing-badge is-current">Your plan</span>
              ) : (
                plan.popular && <span className="pricing-badge">Most popular</span>
              )}
              <h2>{plan.name}</h2>
              <p className="pricing-tagline">{plan.tagline}</p>
              <div className="pricing-price">
                <strong>{formatPrice(Math.round(price * 100) / 100)}</strong>
                <span>{id === "free" ? "forever" : "/ month"}</span>
              </div>
              <p className="pricing-billed">
                {id === "free" ? "No card required" : interval === "year" ? `Billed $${plan.annual} yearly` : "Billed monthly"}
              </p>
              <p className="pricing-credits">
                <Icon name="bolt" size={15} /> {plan.creditsNote}
              </p>

              {isCurrent ? (
                <>
                  <button type="button" className="btn btn-secondary pricing-cta is-current-plan" disabled>
                    <Icon name="check" size={15} /> Current plan
                  </button>
                  {paid && !teamMember && credits?.data?.stripeCustomerId && (
                    <button
                      type="button"
                      className="pricing-manage"
                      disabled={busy === "portal"}
                      onClick={() => run("portal", openBillingPortal)}
                    >
                      {busy === "portal" ? "Opening…" : "Manage subscription"}
                    </button>
                  )}
                </>
              ) : id === "free" ? (
                <button type="button" className="btn btn-secondary pricing-cta" disabled>
                  Included
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-accent pricing-cta"
                  disabled={!stripeReady || !priceConfigured || Boolean(busy)}
                  onClick={() =>
                    run(id, () => (paid ? openBillingPortal() : startPlanCheckout(id, interval, email)))
                  }
                >
                  {busy === id ? "Redirecting…" : paid ? `Switch to ${plan.name}` : `Upgrade to ${plan.name}`}
                </button>
              )}

              <ul className="pricing-features">
                {plan.features.map((feature) => feature.endsWith(":") ? (
                  <li key={feature} className="is-heading">{feature}</li>
                ) : (
                  <li key={feature}>
                    <Icon name="check" size={15} /> {feature}
                  </li>
                ))}
                {plan.excluded.map((feature) => (
                  <li key={feature} className="is-excluded">
                    <Icon name="x" size={15} /> {feature}
                  </li>
                ))}
              </ul>
            </article>
          );
        })}
      </div>

      <ReferralCard />

      <section className="pricing-section">
        <h2>Need more credits?</h2>
        <p className="pricing-section-note">
          {paid
            ? "Top-up credits never expire and roll over with your plan credits."
            : "Top-ups are available on Pro and Business."}
        </p>
        <div className="pricing-topups">
          {TOPUP_PACKS.map((pack) => {
            const price = topupPrice(currentPlan, pack);
            return (
              <button
                key={pack}
                type="button"
                className="pricing-topup"
                disabled={!paid || !stripeReady || Boolean(busy)}
                onClick={() => run(`topup-${pack}`, () => startTopupCheckout(pack, email))}
              >
                <strong>{pack.toLocaleString()} credits</strong>
                <span>{price ? formatPrice(price) : `from ${formatPrice(topupPrice("business", pack))}`}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="pricing-section">
        <h2>AI mode vs manual mode</h2>
        <p className="pricing-section-note">
          Both modes are on every plan and run the same agents at the same price. AI mode adds 1 credit per message
          for picking and chaining agents for you.
        </p>
        <div className="pricing-table-wrap">
          <table className="pricing-table">
            <thead>
              <tr>
                <th />
                <th>Manual mode</th>
                <th>AI mode</th>
              </tr>
            </thead>
            <tbody>
              {MODE_ROWS.map(([label, manual, ai]) => (
                <tr key={label}>
                  <th scope="row">{label}</th>
                  <td>{manual}</td>
                  <td>{ai}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="pricing-table-wrap">
          <table className="pricing-table">
            <thead>
              <tr>
                <th>Example task</th>
                <th>Manual</th>
                <th>AI mode</th>
              </tr>
            </thead>
            <tbody>
              {EXAMPLES.map(([task, manual, ai]) => (
                <tr key={task}>
                  <th scope="row">{task}</th>
                  <td>{manual} credits</td>
                  <td>{ai} credits</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
