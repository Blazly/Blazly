import { useEffect, useState } from "react";
import { fetchTeamUsage } from "./sharedProjectsClient.js";

const RANGES = [7, 30, 90];

/** Per-person credit usage for teams that share one plan. Hidden for solo accounts. */
export function TeamUsageCard() {
  const [days, setDays] = useState(30);
  const [usage, setUsage] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetchTeamUsage(days)
      .then((data) => !cancelled && (setUsage(data), setError("")))
      .catch((err) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [days]);

  const people = usage?.members || [];
  if (!usage && !error) return null;
  if (usage && people.length < 2 && !["business", "agency"].includes(usage.plan)) return null;
  const top = Math.max(1, ...people.map((p) => p.credits));

  return (
    <section className="pricing-section team-usage">
      <div className="team-usage-head">
        <div>
          <h2>Team usage</h2>
          <p className="pricing-section-note">
            Who used how many credits from {usage?.payerIsYou === false ? "the team owner's" : "your"} plan.
          </p>
        </div>
        <div className="team-usage-range" role="group" aria-label="Time range">
          {RANGES.map((range) => (
            <button key={range} type="button" className={range === days ? "is-active" : ""} onClick={() => setDays(range)}>
              {range} days
            </button>
          ))}
        </div>
      </div>
      {error ? <p className="team-notice is-error">{error}</p> : null}
      {usage ? (
        <div className="team-usage-table">
          {people.length < 2 ? (
            <p className="team-usage-empty">No teammates yet. Share a project from Projects to invite up to 2 people.</p>
          ) : null}
          {people.map((person) => (
            <div key={person.uid} className="team-usage-row">
              <span className="team-avatar">{(person.name || "?").charAt(0).toUpperCase()}</span>
              <span className="team-usage-who">
                <span className="team-usage-name">
                  {person.you ? "You" : person.name}
                  <em>{person.role === "owner" ? "Owner" : person.role === "member" ? "Member" : "Former member"}</em>
                </span>
                <span className="team-usage-bar" aria-hidden="true">
                  <span style={{ width: `${Math.round((person.credits / top) * 100)}%` }} />
                </span>
                {person.topAgents.length ? (
                  <span className="team-usage-agents">
                    {person.topAgents.map((agent) => `${agent.label} · ${agent.credits.toLocaleString()}`).join("   ")}
                  </span>
                ) : (
                  <span className="team-usage-agents">No runs in this period</span>
                )}
              </span>
              <span className="team-usage-num">
                <strong>{person.credits.toLocaleString()}</strong>
                <span>
                  credits · {person.runs} run{person.runs === 1 ? "" : "s"}
                </span>
              </span>
            </div>
          ))}
          <div className="team-usage-total">
            <span>Total, last {usage.days} days</span>
            <strong>{usage.total.toLocaleString()} credits</strong>
          </div>
        </div>
      ) : null}
    </section>
  );
}
