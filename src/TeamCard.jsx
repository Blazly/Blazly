import { useCallback, useEffect, useState } from "react";
import { Icon } from "./Icon.jsx";
import { fetchTeam, inviteTeammate, leaveTeam, removeTeammate } from "./accountClient.js";

export function TeamCard({ onUpgrade }) {
  const [team, setTeam] = useState(null);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);

  const refresh = useCallback(() => fetchTeam().then(setTeam).catch((err) => setNotice({ tone: "error", text: err.message })), []);
  useEffect(() => {
    refresh();
  }, [refresh]);

  async function run(action, success) {
    setBusy(true);
    setNotice(null);
    try {
      const result = await action();
      setNotice(success ? { tone: "success", text: success(result) } : null);
      await refresh();
    } catch (err) {
      setNotice({ tone: "error", text: err.message });
    } finally {
      setBusy(false);
    }
  }

  if (!team) return null;

  if (team.role === "member") {
    return (
      <section className="settings-section team-card">
        <div className="settings-section-head">
          <h2 className="settings-section-title">Team</h2>
        </div>
        <p className="team-note">
          You're on <strong>{team.ownerEmail}</strong>'s team and share their plan and credits.
        </p>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={busy}
          onClick={() => run(leaveTeam, () => "You left the team.")}
        >
          Leave team
        </button>
        {notice && <p className={`team-notice is-${notice.tone}`}>{notice.text}</p>}
      </section>
    );
  }

  const used = 1 + team.members.length + team.invites.length;
  const hasSeats = team.seats > 1;

  return (
    <section className="settings-section team-card">
      <div className="settings-section-head">
        <h2 className="settings-section-title">Team</h2>
        {hasSeats && (
          <span className="team-seats">
            {used} of {team.seats} seats used
          </span>
        )}
      </div>

      {!hasSeats ? (
        <div className="team-upsell">
          <p className="team-note">Invite up to 2 teammates to share your plan and credits on the Business plan.</p>
          <button type="button" className="btn btn-secondary" onClick={onUpgrade}>
            See Business plan
          </button>
        </div>
      ) : (
        <>
          <p className="team-note">Teammates use your plan and draw from your credit balance.</p>
          <ul className="team-list">
            <li>
              <Icon name="user" size={15} /> <span>You</span> <em>Owner</em>
            </li>
            {team.members.map((member) => (
              <li key={member.uid}>
                <Icon name="user" size={15} /> <span>{member.email}</span> <em>Member</em>
                <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => run(() => removeTeammate(member.email), () => `${member.email} was removed.`)}>
                  Remove
                </button>
              </li>
            ))}
            {team.invites.map((invite) => (
              <li key={invite.email}>
                <Icon name="mail" size={15} /> <span>{invite.email}</span> <em>Invited</em>
                <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => run(() => removeTeammate(invite.email), () => "Invite cancelled.")}>
                  Cancel
                </button>
              </li>
            ))}
          </ul>
          {used < team.seats && (
            <form
              className="team-invite"
              onSubmit={(event) => {
                event.preventDefault();
                run(
                  () => inviteTeammate(email),
                  (result) => {
                    setEmail("");
                    return result.emailed
                      ? `Invite sent to ${result.email}.`
                      : `Couldn't send the email. Share this link with ${result.email}: ${result.link}`;
                  },
                );
              }}
            >
              <input
                type="email"
                required
                placeholder="teammate@company.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
              <button type="submit" className="btn btn-accent" disabled={busy || !email}>
                Invite
              </button>
            </form>
          )}
        </>
      )}
      {notice && <p className={`team-notice is-${notice.tone}`}>{notice.text}</p>}
    </section>
  );
}
