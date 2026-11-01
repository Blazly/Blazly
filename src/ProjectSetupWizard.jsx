import { useEffect, useState } from "react";

const COLLECT = ["Company Overview", "Services & Products", "Market Analysis", "Key Pages"];

const SECTIONS = [
  { id: "company", label: "Company Info", icon: "company" },
  { id: "services", label: "Services", icon: "services" },
  { id: "products", label: "Products", icon: "products" },
  { id: "audiences", label: "Target Audiences", icon: "audiences" },
  { id: "location", label: "Location", icon: "location" },
  { id: "competitors", label: "Competitors", icon: "competitors" },
  { id: "social", label: "Social Profiles", icon: "social" },
];

export const EMPTY_KNOWLEDGE = {
  companyName: "",
  website: "",
  description: "",
  industry: "",
  location: "",
  services: [],
  products: [],
  targetAudiences: [],
  competitors: [],
  socialProfiles: [],
  keyPages: [],
  marketAnalysis: "",
};

export function ProjectSetupWizard({
  variant = "onboarding",
  kicker = "NEW PROJECT",
  titleStep1 = "Create your first project",
  leadStep1 = "Let’s set up your project to power your SEO, GEO, and growth insights.",
  onComplete,
  onCancel,
  finishLabel = "Add project",
}) {
  const inApp = variant === "inApp";
  const [step, setStep] = useState(1);
  const [projectName, setProjectName] = useState("");
  const [website, setWebsite] = useState("");
  const [knowledge, setKnowledge] = useState(EMPTY_KNOWLEDGE);
  const [section, setSection] = useState("company");
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showSite, setShowSite] = useState(false);

  async function startAnalysis(event) {
    event.preventDefault();
    setError("");
    const name = projectName.trim();
    if (!name) {
      setError("Enter a project name.");
      return;
    }
    let url = "";
    try {
      url = normalizeWebsite(website);
    } catch (err) {
      setError(err.message);
      return;
    }
    setWebsite(url);
    setShowSite(false);
    setStep(2);
    setBusy(true);
    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ website: url }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not read that website.");
      setKnowledge({ ...EMPTY_KNOWLEDGE, ...data.knowledge, companyName: data.knowledge?.companyName || name });
      setSection("company");
      setEditing(false);
      setStep(3);
    } catch (err) {
      setError(err.message || "Could not read that website.");
      setStep(2);
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    setBusy(true);
    setError("");
    try {
      await onComplete({
        projectName: projectName.trim(),
        website: knowledge.website || website,
        knowledge: {
          ...knowledge,
          companyName: knowledge.companyName || projectName.trim(),
        },
      });
    } catch (err) {
      setError(err.message || "Could not save this project.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`onboard-sheet project-setup-wizard${inApp ? " is-in-app" : ""} ${step === 3 ? "is-wide" : ""}`}>
      <p className="onboard-kicker">{inApp ? `Projects · step ${step} of 3` : `${kicker} · STEP ${step} OF 3`}</p>
      <div className="onboard-progress" aria-hidden="true">
        {[1, 2, 3].map((item) => (
          <span key={item} className={item <= step ? "is-on" : ""} />
        ))}
      </div>

      {step === 1 && (
        <form onSubmit={startAnalysis}>
          <h1>{titleStep1}</h1>
          <p className="onboard-lead">{leadStep1}</p>
          <div className="setup-card">
            <span className="setup-mark" aria-hidden="true">
              <WindowIcon />
            </span>
            <label className="setup-field">
              <span>Project name</span>
              <input
                value={projectName}
                placeholder="Blazly AI"
                onChange={(event) => setProjectName(event.target.value)}
              />
            </label>
            <label className="setup-field">
              <span>Website URL</span>
              <input
                value={website}
                placeholder="www.blazly.ai"
                inputMode="url"
                onChange={(event) => setWebsite(event.target.value)}
              />
            </label>
          </div>
          {!inApp ? (
            <>
              <p className="onboard-note">We’ll collect information like:</p>
              <div className="collect">
                {COLLECT.map((item) => (
                  <span key={item}>{item}</span>
                ))}
              </div>
            </>
          ) : null}
          {error && <p className="onboard-error">{error}</p>}
          <div className="onboard-actions">
            {onCancel ? (
              <button type="button" className="onboard-secondary" onClick={onCancel} disabled={busy}>
                Cancel
              </button>
            ) : null}
            <button type="submit" className="onboard-continue" disabled={busy}>
              Continue <ArrowIcon />
            </button>
          </div>
        </form>
      )}

      {step === 2 && (
        <section>
          <h1>Analyzing your website</h1>
          <p className="onboard-lead">We’re reading your website and the pages around it. This can take a minute.</p>
          <div className={`analyze-panel ${busy ? "is-busy" : ""}`}>
            <iframe
              className="analyze-frame"
              title="Website homepage"
              src={website}
              sandbox="allow-scripts allow-forms allow-popups"
              referrerPolicy="no-referrer"
              onLoad={(event) => setShowSite(frameShowsHomepage(event.currentTarget))}
              onError={() => setShowSite(false)}
            />
            {!showSite && <div className="analyze-fetching">Fetching</div>}
          </div>
          {error && !/404/.test(error) && <p className="onboard-error">{error}</p>}
          <div className="onboard-actions">
            {onCancel && !busy ? (
              <button type="button" className="onboard-secondary" onClick={onCancel}>
                Cancel
              </button>
            ) : null}
            <button type="button" className="onboard-continue" disabled={busy} onClick={() => setStep(1)}>
              {error ? "Try again" : busy ? "Analyzing…" : "Continue"} {!busy ? <ArrowIcon /> : null}
            </button>
          </div>
        </section>
      )}

      {step === 3 && (
        <section>
          <h1>Review your knowledge base</h1>
          <p className="onboard-lead">
            We’ve collected the following information from your website. You can edit and add more details anytime.
          </p>
          <div className="review">
            <nav className="review-nav" aria-label="Knowledge base">
              {SECTIONS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={section === item.id ? "is-current" : ""}
                  onClick={() => {
                    setSection(item.id);
                    setEditing(false);
                  }}
                >
                  <SectionIcon name={item.icon} />
                  {item.label}
                </button>
              ))}
            </nav>
            <article className="review-panel">
              <header>
                <h2>
                  {SECTIONS.find((item) => item.id === section)?.label === "Company Info"
                    ? "Company information"
                    : SECTIONS.find((item) => item.id === section)?.label}
                </h2>
                <button type="button" className="review-edit" onClick={() => setEditing((value) => !value)}>
                  <PencilIcon /> {editing ? "Done" : "Edit"}
                </button>
              </header>
              <SectionBody section={section} knowledge={knowledge} editing={editing} onChange={setKnowledge} />
            </article>
          </div>
          {error && <p className="onboard-error">{error}</p>}
          <div className="onboard-actions">
            {onCancel ? (
              <button type="button" className="onboard-secondary" onClick={onCancel} disabled={busy}>
                Cancel
              </button>
            ) : null}
            <button type="button" className="onboard-continue" disabled={busy} onClick={finish}>
              {busy ? "Saving…" : finishLabel} <ArrowIcon />
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

function SectionBody({ section, knowledge, editing, onChange }) {
  if (section === "company") {
    return (
      <div className="review-fields">
        <Field label="Company Name" value={knowledge.companyName} editing={editing} onChange={(companyName) => onChange({ ...knowledge, companyName })} />
        <Field label="Website" value={knowledge.website} editing={editing} onChange={(website) => onChange({ ...knowledge, website })} />
        <Field label="Description" value={knowledge.description} editing={editing} multiline onChange={(description) => onChange({ ...knowledge, description })} />
        <Field label="Industry" value={knowledge.industry} editing={editing} onChange={(industry) => onChange({ ...knowledge, industry })} />
        <Field label="Location" value={knowledge.location} editing={editing} onChange={(location) => onChange({ ...knowledge, location })} />
        <Field label="Market analysis" value={knowledge.marketAnalysis} editing={editing} multiline onChange={(marketAnalysis) => onChange({ ...knowledge, marketAnalysis })} />
        <PageList pages={knowledge.keyPages} />
      </div>
    );
  }
  if (section === "location") {
    return (
      <div className="review-fields">
        <Field label="Location" value={knowledge.location} editing={editing} multiline onChange={(location) => onChange({ ...knowledge, location })} />
      </div>
    );
  }
  if (section === "social") {
    return (
      <ListField
        editing={editing}
        items={knowledge.socialProfiles.map((item) => [item.network, item.url].filter(Boolean).join(" — "))}
        empty="No social profiles were found on the site."
        onChange={(lines) => onChange({
          ...knowledge,
          socialProfiles: lines.map((line) => {
            const [network, ...rest] = line.split("—");
            return { network: network.trim(), url: rest.join("—").trim() };
          }),
        })}
      />
    );
  }
  const key = {
    services: "services",
    products: "products",
    audiences: "targetAudiences",
    competitors: "competitors",
  }[section];
  return (
    <ListField
      editing={editing}
      items={knowledge[key] || []}
      empty="Nothing was found for this section."
      onChange={(lines) => onChange({ ...knowledge, [key]: lines })}
    />
  );
}

function Field({ label, value, editing, multiline, onChange }) {
  return (
    <label className="review-field">
      <span>{label}</span>
      {editing ? (
        multiline ? (
          <textarea value={value} rows={3} onChange={(event) => onChange(event.target.value)} />
        ) : (
          <input value={value} onChange={(event) => onChange(event.target.value)} />
        )
      ) : (
        <p>{value || "—"}</p>
      )}
    </label>
  );
}

function ListField({ items, editing, empty, onChange }) {
  const [draft, setDraft] = useState(items.join("\n"));

  useEffect(() => {
    setDraft(items.join("\n"));
  }, [editing, items]);

  if (editing) {
    return (
      <textarea
        className="review-list-edit"
        rows={8}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => onChange(draft.split("\n").map((line) => line.trim()).filter(Boolean))}
      />
    );
  }
  if (!items.length) return <p className="review-empty">{empty}</p>;
  return (
    <ul className="review-list">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

function PageList({ pages }) {
  if (!pages?.length) return null;
  return (
    <div className="review-field">
      <span>Key pages</span>
      <ul className="review-list">
        {pages.map((page) => (
          <li key={`${page.title}-${page.url}`}>{page.title || page.url}</li>
        ))}
      </ul>
    </div>
  );
}

function frameShowsHomepage(frame) {
  try {
    const doc = frame.contentDocument;
    if (!doc) return true;
    const text = doc.body?.innerText || "";
    if (!text.trim()) return false;
    return !(/\b404\b/.test(text) || /page not found/i.test(text));
  } catch {
    return true;
  }
}

export function normalizeWebsite(value) {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("Enter a website URL.");
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url;
  try {
    url = new URL(withProtocol);
  } catch {
    throw new Error("That website URL does not look right.");
  }
  if (!url.hostname.includes(".")) throw new Error("That website URL does not look right.");
  const path = url.pathname.replace(/\/+$/, "");
  return `${url.origin}${path}${url.search}${url.hash}`;
}

function WindowIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 26 26" fill="none" aria-hidden="true">
      <rect x="4" y="4" width="18" height="18" rx="3.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M4 10.5h18M13 10.5V22" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M8.2 2.4 11.6 5.8 4.7 12.7H1.3V9.3L8.2 2.4Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

function SectionIcon({ name }) {
  const common = { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", "aria-hidden": true };
  if (name === "services") {
    return <svg {...common}><circle cx="8" cy="8" r="5.2" stroke="currentColor" strokeWidth="1.3" /><circle cx="8" cy="8" r="1.4" stroke="currentColor" strokeWidth="1.3" /></svg>;
  }
  if (name === "products") {
    return <svg {...common}><path d="M3 5.5 8 3l5 2.5v5L8 13l-5-2.5v-5Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" /></svg>;
  }
  if (name === "audiences") {
    return <svg {...common}><circle cx="6" cy="6" r="2" stroke="currentColor" strokeWidth="1.3" /><circle cx="11" cy="6.5" r="1.5" stroke="currentColor" strokeWidth="1.3" /><path d="M2.8 12.2c.6-1.8 2-2.7 3.2-2.7s2.6.9 3.2 2.7M9.4 9.6c.8-.3 1.6-.2 2.2.2.7.6 1.1 1.5 1.4 2.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>;
  }
  if (name === "location") {
    return <svg {...common}><path d="M8 13.2s3.6-3.1 3.6-5.7A3.6 3.6 0 0 0 8 3.9a3.6 3.6 0 0 0-3.6 3.6c0 2.6 3.6 5.7 3.6 5.7Z" stroke="currentColor" strokeWidth="1.3" /><circle cx="8" cy="7.4" r="1.1" stroke="currentColor" strokeWidth="1.3" /></svg>;
  }
  if (name === "competitors") {
    return <svg {...common}><path d="M4 12.5V6.2M8 12.5V3.5M12 12.5V8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>;
  }
  if (name === "social") {
    return <svg {...common}><path d="M5 11.5 11 4.5M6.2 4.5H11V9.3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>;
  }
  return <svg {...common}><rect x="3" y="3" width="10" height="10" rx="2" stroke="currentColor" strokeWidth="1.3" /><path d="M3 6.5h10" stroke="currentColor" strokeWidth="1.3" /></svg>;
}
