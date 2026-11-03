import { useCallback, useEffect, useState } from "react";
import { Icon } from "./Icon.jsx";
import { fetchTeam, leaveTeam, removeTeammate } from "./accountClient.js";
import { fetchSharedProjects, fetchTeamUsage } from "./sharedProjectsClient.js";

function Avatar({ name }) {
  return <span className="team-avatar">{(name || "?").trim().charAt(0).toUpperCase()}</span>;
}

const credits = (n) => `${(n || 0).toLocaleString()} credit${n === 1 ? "" : "s"}`;

export function TeamCard({ onUpgrade, onOpenProjects }) {
  const [team, setTeam] = useState(null);
  const [usage, setUsage] = useState(null);
  const [shares, setShares] = useState([]);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const next = await fetchTeam();
      setTeam(next);
      if (next.role === "member" || next.seats > 1) {
        const [u, s] = await Promise.all([fetchTeamUsage(30).catch(() => null), fetchSharedProjects().catch(() => [])]);
        setUsage(u);
        setShares(s);
      }
    } catch (err) {
      setNotice({ tone: "error", text: err.message });
    }
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);

  async function run(kind, action, success) {
    setBusy(kind);
    setNotice(null);
    try {
      await action();
      setNotice(success ? { tone: "success", text: success } : null);
      await refresh();
    } catch (err) {
      setNotice({ tone: "error", text: err.message });
    } finally {
      setBusy("");
    }
  }

  if (!team) return null;

  const usageOf = (uid) => usage?.members?.find((m) => m.uid === uid);
  const projectsOf = (uid) => shares.filter((s) => s.role === "owner" && s.members.some((m) => m.uid === uid)).map((s) => s.name);

  if (team.role === "member") {
    const mine = usage?.members?.find((m) => m.you);
    const joined = shares.filter((s) => s.role === "member");
    const ownerLabel = team.ownerName || team.ownerEmail;
    return (
      <section className="settings-section team-card">
        <div className="settings-section-head team-card-head">
          <h2 className="settings-section-title">Team</h2>
          <span className="team-badge">Member</span>
        </div>
        <p className="team-card-note">
          You're on <strong>{ownerLabel}</strong>'s team{team.ownerName && team.ownerEmail ? ` (${team.ownerEmail})` : ""}.
          Agent runs use their Business plan credits, and they can see how many credits you use.
        </p>
        <ul className="team-people">
          <li className="team-person">
            <Avatar name={ownerLabel} />
            <span className="team-person-main">
              <span className="team-person-name">{ownerLabel}</span>
              <span className="team-person-sub">Owner · pays for the plan</span>
            </span>
          </li>
          <li className="team-person">
            <Avatar name="You" />
            <span className="team-person-main">
              <span className="team-person-name">You</span>
              <span className="team-person-sub">
                {joined.length ? `In ${joined.map((s) => s.name).join(", ")}` : "No shared projects yet"}
              </span>
            </span>
            {mine ? (
              <span className="team-person-usage">
                <strong>{credits(mine.credits)}</strong>
                <span>last 30 days</span>
              </span>
            ) : null}
          </li>
        </ul>
        <div className="team-card-foot">
          <button
            type="button"
            className="btn btn-secondary"
            disabled={Boolean(busy)}
            onClick={() => {
              if (!window.confirm(`Leave ${ownerLabel}'s team? You'll lose access to their shared projects and credits.`)) return;
              run("leave", leaveTeam, "You left the team.");
            }}
          >
            {busy === "leave" ? "Leaving…" : "Leave team"}
          </button>
        </div>
        {notice && <p className={`team-notice is-${notice.tone}`}>{notice.text}</p>}
      </section>
    );
  }

  const hasSeats = team.seats > 1;
  if (!hasSeats) {
    return (
      <section className="settings-section team-card">
        <div className="settings-section-head team-card-head">
          <h2 className="settings-section-title">Team</h2>
        </div>
        <div className="team-upsell">
          <span className="team-upsell-icon">
            <Icon name="users" size={18} />
          </span>
          <p className="team-card-note">
            Work on projects together. The Business plan includes 3 teammate seats (you're not counted): share a project
            link and teammates see its chats and run agents on your credits.
          </p>
          <button type="button" className="btn btn-secondary" onClick={onUpgrade}>
            See Business plan
          </button>
        </div>
        {notice && <p className={`team-notice is-${notice.tone}`}>{notice.text}</p>}
      </section>
    );
  }

  const used = team.members.length + team.invites.length;
  const you = usage?.members?.find((m) => m.you);

  return (
    <section className="settings-section team-card">
      <div className="settings-section-head team-card-head">
        <h2 className="settings-section-title">Team</h2>
        <span className="team-badge">
          {used} of {team.seats} teammate seats used
        </span>
      </div>
      <p className="team-card-note">
        Add teammates by sharing a project from <strong>Projects</strong>. They see that project's chats, every message
        shows who sent it, and their agent runs use your credits.
      </p>

      <ul className="team-people">
        <li className="team-person">
          <Avatar name="You" />
          <span className="team-person-main">
            <span className="team-person-name">You</span>
            <span className="team-person-sub">Owner</span>
          </span>
          {you ? (
            <span className="team-person-usage">
              <strong>{credits(you.credits)}</strong>
              <span>last 30 days</span>
            </span>
          ) : null}
        </li>
        {team.members.map((member) => {
          const stats = usageOf(member.uid);
          const inProjects = projectsOf(member.uid);
          const label = stats?.name || member.name || member.email;
          return (
            <li key={member.uid} className="team-person">
              <Avatar name={label} />
              <span className="team-person-main">
                <span className="team-person-name">{label}</span>
                <span className="team-person-sub">
                  {[stats?.email || member.email, inProjects.length ? `In ${inProjects.join(", ")}` : ""].filter(Boolean).join(" · ")}
                </span>
              </span>
              {stats ? (
                <span className="team-person-usage">
                  <strong>{credits(stats.credits)}</strong>
                  <span>last 30 days</span>
                </span>
              ) : null}
              <button
                type="button"
                className="btn btn-ghost team-person-action"
                disabled={Boolean(busy)}
                onClick={() => {
                  if (!window.confirm(`Remove ${label} from your team? They lose access to every project you shared with them.`)) return;
                  run(`remove-${member.uid}`, () => removeTeammate(member.uid), `${label} was removed.`);
                }}
              >
                {busy === `remove-${member.uid}` ? "Removing…" : "Remove"}
              </button>
            </li>
          );
        })}
        {team.invites.map((invite) => (
          <li key={invite.email} className="team-person is-pending">
            <span className="team-avatar">
              <Icon name="mail" size={14} />
            </span>
            <span className="team-person-main">
              <span className="team-person-name">{invite.email}</span>
              <span className="team-person-sub">Invite pending</span>
            </span>
            <button
              type="button"
              className="btn btn-ghost team-person-action"
              disabled={Boolean(busy)}
              onClick={() => run(`cancel-${invite.email}`, () => removeTeammate(invite.email), "Invite cancelled.")}
            >
              Cancel
            </button>
          </li>
        ))}
      </ul>

      <div className="team-card-foot">
        {used < team.seats ? (
          <button type="button" className="btn btn-primary" onClick={onOpenProjects}>
            <Icon name="link" size={14} />
            Share a project
          </button>
        ) : (
          <span className="team-card-hint">All seats are taken. Remove someone to add a new teammate.</span>
        )}
      </div>
      {notice && <p className={`team-notice is-${notice.tone}`}>{notice.text}</p>}
    </section>
  );
}
