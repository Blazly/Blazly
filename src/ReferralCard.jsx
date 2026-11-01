import { useEffect, useState } from "react";
import { Icon } from "./Icon.jsx";
import { fetchReferral, referralLink } from "./referralClient.js";

export function ReferralCard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetchReferral().then(setData).catch((err) => setError(err.message));
  }, []);

  const link = data ? referralLink(data.code) : "";

  async function copy() {
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <section className="referral-card">
      <div className="referral-head">
        <span className="referral-icon">
          <Icon name="users" size={18} />
        </span>
        <div>
          <h2>Invite friends, earn {data?.reward || 100} credits</h2>
          <p>Share your link. Each person who signs up with it gives you {data?.reward || 100} free credits.</p>
        </div>
      </div>
      {error ? (
        <p className="referral-error">{error}</p>
      ) : (
        <div className="referral-link-row">
          <input className="referral-link" readOnly value={link || "Loading…"} onFocus={(e) => e.target.select()} />
          <button type="button" className="btn btn-accent" disabled={!data} onClick={copy}>
            <Icon name={copied ? "check" : "link"} size={15} /> {copied ? "Copied" : "Copy link"}
          </button>
        </div>
      )}
      {data && (
        <div className="referral-stats">
          <span>
            <strong>{data.joined}</strong> joined
          </span>
          <span>
            <strong>{data.earned.toLocaleString()}</strong> credits earned
          </span>
        </div>
      )}
    </section>
  );
}
