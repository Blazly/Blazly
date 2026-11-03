import { TeamCard } from "./TeamCard.jsx";
import { ReferralCard } from "./ReferralCard.jsx";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "./AuthContext.jsx";
import { deleteProfilePhoto, uploadProfilePhoto } from "./firebase.js";
import { Icon } from "./Icon.jsx";
import { CreditMeter, CreditsCard, useCredits } from "./CreditsCard.jsx";
import { ProjectAvatar } from "./ProjectAvatar.jsx";
import { projectDisplayWebsite } from "./projectStorage.js";

function normalizeLinkedInUrl(raw) {
  const value = String(raw || "").trim();
  if (!value) return "";
  const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
  if (!/(^|\.)linkedin\.com$/i.test(url.hostname)) throw new Error("Enter a linkedin.com profile URL.");
  url.protocol = "https:";
  return url.toString().replace(/\/+$/, "");
}

export function ProfileView({
  notice,
  onUpgrade,
  onOpenProjects,
  displayName,
  email,
  initial,
  avatarUrl,
  profile,
  projectName,
  projectWebsite,
  projects = [],
  chatCounts = {},
  onSwitchProject,
}) {
  const { user, updateProfileFields } = useAuth();
  const credits = useCredits();
  const website = projectWebsite || profile?.website || "";
  const company = profile?.knowledge?.companyName || profile?.project || projectName || "";

  const fileRef = useRef(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState("");

  const [linkedin, setLinkedin] = useState(profile?.linkedinUrl || "");
  const [linkedinState, setLinkedinState] = useState({ busy: false, error: "", saved: false });

  useEffect(() => {
    setLinkedin(profile?.linkedinUrl || "");
  }, [profile?.linkedinUrl]);

  async function onPhotoPicked(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !user) return;
    setPhotoBusy(true);
    setPhotoError("");
    try {
      const previousPath = profile?.avatarPath;
      const uploaded = await uploadProfilePhoto(user.uid, file);
      await updateProfileFields(uploaded);
      if (previousPath && previousPath !== uploaded.avatarPath) deleteProfilePhoto(previousPath);
    } catch (err) {
      setPhotoError(
        err?.code === "storage/unauthorized"
          ? "Upload blocked by Firebase Storage rules. Publish the storage rules and try again."
          : err.message || "Could not upload that image.",
      );
    } finally {
      setPhotoBusy(false);
    }
  }

  async function removePhoto() {
    setPhotoBusy(true);
    setPhotoError("");
    try {
      const path = profile?.avatarPath;
      await updateProfileFields({ avatarURL: "", avatarPath: "" });
      deleteProfilePhoto(path);
    } catch (err) {
      setPhotoError(err.message || "Could not remove the photo.");
    } finally {
      setPhotoBusy(false);
    }
  }

  async function saveLinkedin(event) {
    event.preventDefault();
    setLinkedinState({ busy: true, error: "", saved: false });
    try {
      const url = normalizeLinkedInUrl(linkedin);
      await updateProfileFields({ linkedinUrl: url });
      setLinkedin(url);
      setLinkedinState({ busy: false, error: "", saved: true });
    } catch (err) {
      setLinkedinState({
        busy: false,
        error: err instanceof TypeError ? "That URL isn't valid." : err.message || "Could not save.",
        saved: false,
      });
    }
  }

  const linkedinDirty = (linkedin || "").trim() !== (profile?.linkedinUrl || "");

  return (
    <div className="page page-narrow">
      <header className="page-intro">
        <div className="page-intro-text">
          <h1>Profile</h1>
          <p className="subpage-lead">Your account and the brand context Blazly uses in every answer.</p>
        </div>
      </header>
      <div className="settings">
        <section className="settings-section" aria-label="Account">
          <div className="profile-hero">
            <button
              type="button"
              className="profile-avatar-button"
              onClick={() => fileRef.current?.click()}
              disabled={photoBusy}
              aria-label="Change profile photo"
            >
              {avatarUrl ? (
                <img className="avatar avatar-lg avatar-img" src={avatarUrl} alt="" />
              ) : (
                <span className="avatar avatar-lg">{initial}</span>
              )}
              <span className="profile-avatar-overlay" aria-hidden="true">
                {photoBusy ? "…" : <Icon name="pencil" size={14} />}
              </span>
            </button>
            <div className="profile-hero-text">
              <p className="profile-name">{displayName}</p>
              <p className="profile-email">{email || "No email on file"}</p>
              <div className="profile-photo-actions">
                <button type="button" className="btn btn-secondary" disabled={photoBusy} onClick={() => fileRef.current?.click()}>
                  {photoBusy ? "Uploading…" : avatarUrl ? "Change photo" : "Upload photo"}
                </button>
                {profile?.avatarURL ? (
                  <button type="button" className="btn btn-ghost" disabled={photoBusy} onClick={removePhoto}>
                    Remove
                  </button>
                ) : null}
              </div>
              {photoError ? <p className="profile-field-error">{photoError}</p> : null}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              hidden
              onChange={onPhotoPicked}
            />
          </div>

          <form className="settings-row profile-linkedin" onSubmit={saveLinkedin}>
            <label className="settings-row-text" htmlFor="profile-linkedin">
              <span className="settings-row-label">LinkedIn profile</span>
              <span className="settings-row-note">Shown to your team and used for author bios.</span>
            </label>
            <span className="profile-linkedin-field">
              <input
                id="profile-linkedin"
                type="url"
                inputMode="url"
                value={linkedin}
                onChange={(e) => {
                  setLinkedin(e.target.value);
                  setLinkedinState((s) => ({ ...s, saved: false, error: "" }));
                }}
                placeholder="https://www.linkedin.com/in/your-name"
              />
              {profile?.linkedinUrl && !linkedinDirty ? (
                <a className="btn btn-ghost" href={profile.linkedinUrl} target="_blank" rel="noreferrer">
                  Open
                </a>
              ) : (
                <button type="submit" className="btn btn-primary" disabled={linkedinState.busy || !linkedinDirty}>
                  {linkedinState.busy ? "Saving…" : "Save"}
                </button>
              )}
            </span>
            {linkedinState.error ? <p className="profile-field-error">{linkedinState.error}</p> : null}
            {linkedinState.saved ? <p className="profile-field-ok">Saved.</p> : null}
          </form>
        </section>

        <CreditsCard />

        <section className="settings-section">
          <div className="settings-section-head">
            <h2 className="settings-section-title">Projects</h2>
            <p className="settings-section-note">
              {projects.length} project{projects.length === 1 ? "" : "s"}. Each has its own chats, knowledge base and
              integrations.
            </p>
          </div>
          {projects.map((item) => {
            const active = item.name === projectName;
            const site = projectDisplayWebsite(item);
            const count = chatCounts[item.name] || 0;
            return (
              <div key={item.id || item.name} className={`settings-row profile-project${active ? " is-active" : ""}`}>
                <span className="profile-project-main">
                  <ProjectAvatar name={item.name} logo={item.logo} className="project-badge is-lg" />
                  <span className="settings-row-text">
                    <span className="settings-row-label">{item.name}</span>
                    <span className="settings-row-note">
                      {[site.replace(/^https?:\/\//, "").replace(/\/$/, ""), `${count} chat${count === 1 ? "" : "s"}`]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                </span>
                {active ? (
                  <span className="profile-project-active">Active</span>
                ) : (
                  <button type="button" className="btn btn-secondary" onClick={() => onSwitchProject?.(item.name)}>
                    Switch
                  </button>
                )}
              </div>
            );
          })}
        </section>

        <section className="settings-section">
          <div className="settings-section-head">
            <h2 className="settings-section-title">Brand context</h2>
            <p className="settings-section-note">From the active project.</p>
          </div>
          <div className="settings-row">
            <span className="settings-row-label">Active project</span>
            <span className="settings-row-value">{projectName || "—"}</span>
          </div>
          <div className="settings-row">
            <span className="settings-row-label">Company or brand</span>
            <span className="settings-row-value">{company || "—"}</span>
          </div>
          <div className="settings-row">
            <span className="settings-row-label">Website</span>
            <span className="settings-row-value">{website || "—"}</span>
          </div>
        </section>

        {notice && <div className={`pricing-notice is-${notice.tone}`}>{notice.text}</div>}
        <TeamCard onUpgrade={onUpgrade} onOpenProjects={onOpenProjects} />

        <ReferralCard />

        <section className="settings-section">
          <div className="settings-section-head">
            <h2 className="settings-section-title">Plan</h2>
          </div>
          <div className="settings-row">
            <span className="settings-row-text">
              <span className="settings-row-label">Credits used</span>
              <span className="settings-row-note">Agent runs and long answers use more credits.</span>
            </span>
            <span className="settings-row-meter">
              <span>
                {credits.data ? `${credits.percent}% used · ${credits.balance.toLocaleString()} left` : "Loading…"}
              </span>
              <CreditMeter credits={credits} />
            </span>
          </div>
        </section>
      </div>
    </div>
  );
}
