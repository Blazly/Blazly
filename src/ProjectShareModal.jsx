import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon.jsx";
import { fetchTeam } from "./accountClient.js";
import { removeProjectMember, resetShareLink, shareProject, stopSharingProject } from "./sharedProjectsClient.js";

/** Owner-only dialog: create/copy the project's join link and manage who has access. */
export function ProjectShareModal({ project, share, onClose, onChanged }) {
  const [current, setCurrent] = useState(share || null);
  const [team, setTeam] = useState(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    setCurrent(share || null);
  }, [share]);

  useEffect(() => {
    fetchTeam().then(setTeam).catch(() => {});
    const onKey = (event) => event.key === "Escape" && closeRef.current();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function run(kind, fn) {
    setBusy(kind);
    setError("");
    try {
      await fn();
      onChanged?.();
      fetchTeam().then(setTeam).catch(() => {});
    } catch (err) {
      setError(err.message || "Something went wrong.");
    } finally {
      setBusy("");
    }
  }

  const create = () =>
    run("create", async () => {
      setCurrent(
        await shareProject({
          name: project.name,
          website: project.website || project.knowledge?.website || "",
          knowledge: project.knowledge || null,
          logo: project.logo || "",
        }),
      );
    });

  async function copy() {
    if (!current?.link) return;
    await navigator.clipboard?.writeText(current.link);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const seats = team?.seats || 3;
  const used = team ? (team.members?.length || 0) + (team.invites?.length || 0) : null;
  const members = current?.members || [];

  return (
    <div className="referral-modal-backdrop" onClick={onClose}>
      <div className="referral-modal share-modal" role="dialog" aria-modal="true" aria-label={`Share ${project.name}`} onClick={(e) => e.stopPropagation()}>
        <button type="button" className="referral-modal-close" aria-label="Close" onClick={onClose}>
          <Icon name="x" size={16} />
        </button>
        <div className="share-modal-head">
          <span className="share-modal-icon">
            <Icon name="users" size={18} />
          </span>
          <div>
            <h2>Share {project.name}</h2>
            <p>
              Teammates who open this link join your team, see every chat in this project and run agents on your credits.
            </p>
          </div>
        </div>

        {used != null ? (
          <p className="share-modal-seats">
            <strong>
              {used} of {seats}
            </strong>{" "}
            teammate seats used{used >= seats ? " — remove someone to invite a new person." : ""}
          </p>
        ) : null}

        {!current ? (
          <button type="button" className="btn btn-primary" disabled={Boolean(busy)} onClick={create}>
            {busy === "create" ? "Creating link…" : "Create share link"}
          </button>
        ) : (
          <>
            <div className="share-modal-link">
              <input value={current.link || ""} readOnly aria-label="Project share link" onFocus={(e) => e.target.select()} />
              <button type="button" className="btn btn-primary" onClick={copy}>
                <Icon name={copied ? "check" : "copy"} size={14} />
                {copied ? "Copied" : "Copy link"}
              </button>
            </div>
            <div className="share-modal-section">
              <p className="share-modal-label">People with access</p>
              <ul className="share-modal-members">
                <li>
                  <span className="share-avatar">{(current.ownerName || "Y").charAt(0).toUpperCase()}</span>
                  <span className="share-member-name">You</span>
                  <em>Owner</em>
                </li>
                {members.map((member) => (
                  <li key={member.uid}>
                    <span className="share-avatar">{(member.name || member.email || "?").charAt(0).toUpperCase()}</span>
                    <span className="share-member-name">
                      {member.name}
                      {member.email ? <small>{member.email}</small> : null}
                    </span>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      disabled={Boolean(busy)}
                      onClick={() =>
                        run(`remove-${member.uid}`, async () => {
                          await removeProjectMember(current.id, member.uid);
                          setCurrent({ ...current, members: members.filter((m) => m.uid !== member.uid) });
                        })
                      }
                    >
                      {busy === `remove-${member.uid}` ? "Removing…" : "Remove"}
                    </button>
                  </li>
                ))}
                {!members.length ? <li className="share-modal-empty">No one has joined yet. Send them the link.</li> : null}
              </ul>
            </div>
            <div className="share-modal-actions">
              <button
                type="button"
                className="btn btn-ghost"
                disabled={Boolean(busy)}
                onClick={() =>
                  run("reset", async () => {
                    const link = await resetShareLink(current.id);
                    setCurrent({ ...current, link });
                  })
                }
              >
                {busy === "reset" ? "Resetting…" : "Reset link"}
              </button>
              <button
                type="button"
                className="btn btn-ghost share-modal-stop"
                disabled={Boolean(busy)}
                onClick={() => {
                  if (!window.confirm(`Stop sharing ${project.name}? Teammates lose access to it and its shared chats.`)) return;
                  run("stop", async () => {
                    await stopSharingProject(current.id);
                    setCurrent(null);
                    onClose();
                  });
                }}
              >
                Stop sharing
              </button>
            </div>
          </>
        )}
        {error ? <p className="share-modal-error">{error}</p> : null}
      </div>
    </div>
  );
}
