import { useCallback, useEffect, useState } from "react";
import { Icon } from "./Icon.jsx";
import {
  connectWordPress,
  startWordPressApproval,
  disconnectIntegration,
  fetchGoogleProperties,
  fetchIntegrationStatus,
  startGoogleConnect,
  fetchWebflowCollections,
  fetchWebflowSites,
  saveWebhook,
  selectGoogleProperties,
  selectWebflowTarget,
  startWebflowConnect,
  testWebhook,
} from "./integrationsClient.js";

const RECEIVER_EXAMPLE = `// Node / Express example: POST /api/blazly
import crypto from "node:crypto";

app.post("/api/blazly", express.raw({ type: "application/json" }), async (req, res) => {
  const raw = req.body.toString("utf8");
  const ts = req.get("X-Blazly-Timestamp");
  const expected = "sha256=" + crypto
    .createHmac("sha256", process.env.BLAZLY_WEBHOOK_SECRET)
    .update(\`\${ts}.\${raw}\`)
    .digest("hex");
  const given = req.get("X-Blazly-Signature") || "";
  const fresh = Math.abs(Date.now() / 1000 - Number(ts)) < 300;
  if (!fresh || given.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected))) {
    return res.status(401).json({ error: "Bad signature" });
  }

  const { event, data } = JSON.parse(raw);
  if (event === "ping") return res.json({ ok: true });

  if (event === "post.publish") {
    // data: title, slug, content_html, excerpt, categories, tags,
    //       status, featured_image_url, published_at
    const post = await db.posts.create(data);
    return res.json({ id: post.id, url: \`https://yoursite.com/blog/\${post.slug}\` });
  }

  if (event === "post.update") {
    // data: id or slug, plus only the fields that changed
    const post = await db.posts.update(data);
    return res.json({ id: post.id, url: \`https://yoursite.com/blog/\${post.slug}\` });
  }

  res.status(400).json({ error: "Unknown event" });
});`;

export function IntegrationsView({ uid, project, notice }) {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!uid) return;
    setLoading(true);
    try {
      setStatus(await fetchIntegrationStatus(uid, project));
      setError("");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [uid, project]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <div className="page integrations-page">
      <header className="page-intro">
        <div className="page-intro-text">
          <h1>Integrations</h1>
          <p className="subpage-lead">
            Connect <strong>{project}</strong>’s website and analytics. Agents use these connections to publish posts and
            pull real Search Console and GA4 data. Each project has its own connections.
          </p>
        </div>
      </header>

      {notice ? <p className={`integration-notice is-${notice.tone}`}>{notice.text}</p> : null}
      {error ? <p className="integration-notice is-error">{error}</p> : null}

      {loading && !status ? (
        <p className="integration-muted">Loading connections…</p>
      ) : status ? (
        <div className="integration-list">
          <WordPressCard uid={uid} project={project} status={status.wordpress} onChange={setStatus} />
          <WebflowCard
            uid={uid}
            project={project}
            status={status.webflow || { connected: false }}
            configured={status.webflowConfigured}
            onChange={setStatus}
          />
          <WebhookCard uid={uid} project={project} status={status.webhook || { connected: false }} onChange={setStatus} />
          <GoogleCard
            uid={uid}
            project={project}
            status={status.google}
            configured={status.googleConfigured}
            onChange={setStatus}
          />
        </div>
      ) : null}
    </div>
  );
}

function IntegrationShell({ icon, title, subtitle, connected, children }) {
  return (
    <section className={`integration-card${connected ? " is-connected" : ""}`}>
      <header className="integration-card-head">
        <span className="integration-card-icon">
          <Icon name={icon} size={18} />
        </span>
        <span className="integration-card-copy">
          <span className="integration-card-title">{title}</span>
          <span className="integration-card-sub">{subtitle}</span>
        </span>
        <span className={`integration-pill${connected ? " is-on" : ""}`}>{connected ? "Connected" : "Not connected"}</span>
      </header>
      <div className="integration-card-body">{children}</div>
    </section>
  );
}

function WordPressCard({ uid, project, status, onChange }) {
  const [siteUrl, setSiteUrl] = useState("");
  const [username, setUsername] = useState("");
  const [appPassword, setAppPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [manual, setManual] = useState(false);

  async function approve(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await startWordPressApproval({ uid, project, siteUrl });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      onChange(await connectWordPress({ uid, project, siteUrl, username, appPassword }));
      setAppPassword("");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    try {
      onChange(await disconnectIntegration({ uid, project, provider: "wordpress" }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <IntegrationShell
      icon="fileText"
      title="WordPress"
      subtitle="Publish and update blog posts live on your site."
      connected={status.connected}
    >
      {status.connected ? (
        <div className="integration-row">
          <span>
            <strong>{status.siteUrl}</strong> · signed in as {status.displayName || status.username}
          </span>
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={disconnect}>
            Disconnect
          </button>
        </div>
      ) : (
        <div className="integration-form">
          <form className="wp-quick" onSubmit={approve}>
            <ol className="wp-steps">
              <li>Enter your site address</li>
              <li>Log in to WordPress if asked</li>
              <li>
                Click <strong>Yes, I approve of this connection</strong>
              </li>
            </ol>
            <div className="wp-quick-row">
              <input
                value={siteUrl}
                onChange={(e) => setSiteUrl(e.target.value)}
                placeholder="yourblog.com"
                aria-label="WordPress site URL"
                required
              />
              <button type="submit" className="btn btn-primary" disabled={busy}>
                {busy ? "Opening WordPress…" : "Connect with WordPress"}
              </button>
            </div>
            <p className="integration-help">
              Use an Author, Editor, or Administrator account. No passwords to copy — WordPress hands Blazly a revocable key you can
              remove anytime under Users → Profile.
            </p>
            {error && !manual ? <p className="integration-error">{error}</p> : null}
          </form>

          <button type="button" className="wp-manual-toggle" onClick={() => setManual((v) => !v)}>
            <Icon name={manual ? "chevronDown" : "chevronRight"} size={14} />
            Trouble connecting? Set up manually
          </button>

          {manual ? (
        <form className="integration-form" onSubmit={submit}>
          <label className="integration-field">
            <span>Site URL</span>
            <input value={siteUrl} onChange={(e) => setSiteUrl(e.target.value)} placeholder="https://yourblog.com" required />
          </label>
          <label className="integration-field">
            <span>Username</span>
            <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" required />
          </label>
          <label className="integration-field">
            <span>Application password</span>
            <input
              type="password"
              value={appPassword}
              onChange={(e) => setAppPassword(e.target.value)}
              placeholder="xxxx xxxx xxxx xxxx xxxx xxxx"
              autoComplete="new-password"
              required
            />
          </label>
          <p className="integration-help">
            In WordPress go to <strong>Users → Profile → Application Passwords</strong>, create one named “Blazly”, and paste
            it here. Use an Author, Editor, or Administrator account.
          </p>
          {error ? <p className="integration-error">{error}</p> : null}
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? "Testing connection…" : "Connect WordPress"}
          </button>
        </form>
          ) : null}
        </div>
      )}
    </IntegrationShell>
  );
}

function WebflowCard({ uid, project, status, configured, onChange }) {
  const [sites, setSites] = useState(null);
  const [collections, setCollections] = useState(null);
  const [siteId, setSiteId] = useState(status.siteId || "");
  const [collectionId, setCollectionId] = useState(status.collectionId || "");
  const [mapping, setMapping] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!status.connected) return;
    let cancelled = false;
    fetchWebflowSites(uid, project)
      .then((data) => !cancelled && setSites(data.sites))
      .catch((err) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [status.connected, uid, project]);

  useEffect(() => {
    setSiteId(status.siteId || "");
    setCollectionId(status.collectionId || "");
  }, [status.siteId, status.collectionId]);

  useEffect(() => {
    if (!status.connected || !siteId) {
      setCollections(null);
      return;
    }
    let cancelled = false;
    setCollections(null);
    fetchWebflowCollections(uid, project, siteId)
      .then((data) => {
        if (cancelled) return;
        setCollections(data.collections);
        const blog = data.collections.find((c) => /blog|post|article|news/i.test(`${c.name} ${c.slug}`));
        setCollectionId((current) =>
          data.collections.some((c) => c.id === current) ? current : blog?.id || data.collections[0]?.id || "",
        );
      })
      .catch((err) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [status.connected, siteId, uid, project]);

  async function save() {
    setBusy(true);
    setError("");
    try {
      const result = await selectWebflowTarget({ uid, project, siteId, collectionId });
      setMapping(result.webflowMapping || null);
      onChange(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    try {
      onChange(await disconnectIntegration({ uid, project, provider: "webflow" }));
      setSites(null);
      setMapping(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const ready = status.connected && status.collectionId;

  return (
    <IntegrationShell
      icon="globe"
      title="Webflow"
      subtitle="Publish blog posts live to your Webflow CMS collection."
      connected={Boolean(ready)}
    >
      {!configured ? (
        <p className="integration-help">
          Add <code>WEBFLOW_CLIENT_ID</code> and <code>WEBFLOW_CLIENT_SECRET</code> to <code>.env</code> and restart the dev
          server to enable Webflow.
        </p>
      ) : !status.connected ? (
        <button type="button" className="btn btn-primary integration-google-btn" onClick={() => startWebflowConnect(project).catch((err) => alert(err.message))}>
          <Icon name="globe" size={16} />
          Connect Webflow
        </button>
      ) : (
        <div className="integration-form">
          <div className="integration-row">
            <span>
              {status.userName ? (
                <>
                  Authorized by <strong>{status.userName}</strong>
                </>
              ) : (
                "Webflow authorized"
              )}
              {ready ? (
                <>
                  {" "}
                  · publishing to <strong>{status.collectionName}</strong> on {status.siteDomain}
                </>
              ) : null}
            </span>
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={disconnect}>
              Disconnect
            </button>
          </div>
          <label className="integration-field">
            <span>Site</span>
            <select value={siteId} onChange={(e) => setSiteId(e.target.value)} disabled={!sites}>
              <option value="">{sites ? "Select a site" : "Loading…"}</option>
              {(sites || []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.domains[0] ? ` · ${s.domains[0]}` : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="integration-field">
            <span>Blog collection</span>
            <select value={collectionId} onChange={(e) => setCollectionId(e.target.value)} disabled={!collections}>
              <option value="">{!siteId ? "Pick a site first" : collections ? "Select a collection" : "Loading…"}</option>
              {(collections || []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          {mapping ? (
            <p className="integration-help">
              Body → <code>{mapping.body || "none found"}</code> · Summary → <code>{mapping.summary || "none"}</code> · Image →{" "}
              <code>{mapping.image || "none"}</code>
              {mapping.unmappedRequired?.length
                ? ` · Required fields Blazly will need values for: ${mapping.unmappedRequired.map((f) => f.name).join(", ")}`
                : ""}
            </p>
          ) : null}
          <p className="integration-help">
            If your site isn’t listed, reconnect and make sure you authorize that site or workspace in Webflow.
          </p>
          {error ? <p className="integration-error">{error}</p> : null}
          <div className="integration-row">
            <span className="integration-muted">{mapping ? "Saved." : ""}</span>
            <button type="button" className="btn btn-primary" disabled={busy || !siteId || !collectionId} onClick={save}>
              {busy ? "Saving…" : "Save collection"}
            </button>
          </div>
        </div>
      )}
    </IntegrationShell>
  );
}

function developerEmailHref({ project, endpointUrl, siteUrl, secret }) {
  const body = [
    "Hi,",
    "",
    `I'm using Blazly to write blog posts for ${siteUrl || "our website"} and want it to publish them automatically. Could you add a small endpoint that receives posts from Blazly?`,
    "",
    `1. Create a POST endpoint, e.g. ${endpointUrl || "https://oursite.com/api/blazly"}`,
    secret
      ? `2. Save this signing secret on the server as BLAZLY_WEBHOOK_SECRET: ${secret}`
      : "2. I'll send the signing secret once I've saved the endpoint in Blazly.",
    "3. Verify the X-Blazly-Signature header: HMAC-SHA256 of `${X-Blazly-Timestamp}.${rawBody}` with the secret, sent as sha256=<hex>.",
    "4. Handle the X-Blazly-Event values: ping (just return 200), post.publish (create the post), post.update (update it).",
    "5. Reply with JSON like { \"id\": \"123\", \"url\": \"https://oursite.com/blog/my-post\" } so Blazly can link to it.",
    "",
    "Blazly has a full Express example under Integrations → Custom website → Developer guide. Let me know when it's live and I'll press \"Send test\".",
    "",
    "Thanks!",
  ].join("\n");
  const subject = `Connect our website to Blazly (${project})`;
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function WebhookCard({ uid, project, status, onChange }) {
  const [endpointUrl, setEndpointUrl] = useState(status.endpointUrl || "");
  const [siteUrl, setSiteUrl] = useState(status.siteUrl || "");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");
  const [showGuide, setShowGuide] = useState(false);

  useEffect(() => {
    setEndpointUrl(status.endpointUrl || "");
    setSiteUrl(status.siteUrl || "");
  }, [status.endpointUrl, status.siteUrl]);

  async function run(kind, fn) {
    setBusy(kind);
    setError("");
    try {
      onChange(await fn());
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  function save(event, rotateSecret = false) {
    event?.preventDefault();
    run("save", () => saveWebhook({ uid, project, endpointUrl, siteUrl, rotateSecret }));
  }

  async function copy(label, text) {
    await navigator.clipboard?.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(""), 1500);
  }

  return (
    <IntegrationShell
      icon="code"
      title="Custom website (webhook)"
      subtitle="Publish to any site built with your own code: Next.js, Laravel, Django, Rails and more."
      connected={status.connected}
    >
      <form className="integration-form" onSubmit={save}>
        {!status.connected ? (
          <div className="webhook-nontech">
            <Icon name="users" size={16} />
            <div>
              <p>
                <strong>Not technical?</strong> This needs a small piece of code on your site — about 15 minutes for whoever
                built it. Save below, then send them everything they need in one email.
              </p>
              <a className="btn btn-secondary" href={developerEmailHref({ project, endpointUrl, siteUrl, secret: status.secret })}>
                <Icon name="mail" size={14} />
                Email my developer
              </a>
            </div>
          </div>
        ) : null}
        <label className="integration-field">
          <span>Endpoint URL</span>
          <input
            value={endpointUrl}
            onChange={(e) => setEndpointUrl(e.target.value)}
            placeholder="https://yoursite.com/api/blazly"
            required
          />
        </label>
        <label className="integration-field">
          <span>Site URL (optional)</span>
          <input value={siteUrl} onChange={(e) => setSiteUrl(e.target.value)} placeholder="https://yoursite.com" />
        </label>

        {status.configured ? (
          <div className="integration-field">
            <span>Signing secret</span>
            <div className="integration-row">
              <code className="integration-secret">{status.secret}</code>
              <button type="button" className="btn btn-secondary" onClick={() => copy("secret", status.secret)}>
                {copied === "secret" ? "Copied" : "Copy"}
              </button>
            </div>
            <p className="integration-help">
              Save this on your server as <code>BLAZLY_WEBHOOK_SECRET</code>. Every request is signed with it in the{" "}
              <code>X-Blazly-Signature</code> header.
            </p>
          </div>
        ) : null}

        {error ? <p className="integration-error">{error}</p> : null}

        <div className="integration-row">
          <span className="integration-muted">
            {status.connected
              ? `Verified ${new Date(status.verifiedAt).toLocaleString()}`
              : status.configured
                ? "Add the secret to your server, then send a test."
                : "Save to generate a signing secret."}
          </span>
          <span className="integration-actions">
            {status.configured ? (
              <button
                type="button"
                className="btn btn-secondary"
                disabled={Boolean(busy)}
                onClick={() => run("test", () => testWebhook({ uid, project }))}
              >
                {busy === "test" ? "Sending…" : "Send test"}
              </button>
            ) : null}
            <button type="submit" className="btn btn-primary" disabled={Boolean(busy)}>
              {busy === "save" ? "Saving…" : status.configured ? "Save" : "Save & generate secret"}
            </button>
          </span>
        </div>

        {status.configured ? (
          <div className="integration-row">
            <button type="button" className="btn btn-ghost" onClick={() => setShowGuide((v) => !v)}>
              {showGuide ? "Hide developer guide" : "Developer guide"}
            </button>
            <span className="integration-actions">
              <button type="button" className="btn btn-ghost" disabled={Boolean(busy)} onClick={(e) => save(e, true)}>
                Rotate secret
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={Boolean(busy)}
                onClick={() => run("disconnect", () => disconnectIntegration({ uid, project, provider: "webhook" }))}
              >
                Disconnect
              </button>
            </span>
          </div>
        ) : null}

        {showGuide ? (
          <div className="integration-guide">
            <p className="integration-help">
              Blazly sends a <code>POST</code> with JSON <code>{"{ id, event, created_at, data }"}</code>. The event is{" "}
              <code>ping</code>, <code>post.publish</code> or <code>post.update</code>. Verify the signature over{" "}
              <code>{"`${timestamp}.${rawBody}`"}</code>, then reply 2xx with <code>{"{ id, url }"}</code> so Blazly
              can link to the live post.
            </p>
            <div className="integration-row">
              <span className="integration-muted">Example receiver</span>
              <button type="button" className="btn btn-ghost" onClick={() => copy("code", RECEIVER_EXAMPLE)}>
                {copied === "code" ? "Copied" : "Copy code"}
              </button>
            </div>
            <pre className="integration-code">{RECEIVER_EXAMPLE}</pre>
          </div>
        ) : null}
      </form>
    </IntegrationShell>
  );
}

function GoogleCard({ uid, project, status, configured, onChange }) {
  const [props, setProps] = useState(null);
  const [gscSiteUrl, setGscSiteUrl] = useState(status.gscSiteUrl || "");
  const [ga4PropertyId, setGa4PropertyId] = useState(status.ga4PropertyId || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!status.connected) return;
    let cancelled = false;
    fetchGoogleProperties(uid, project)
      .then((data) => {
        if (cancelled) return;
        setProps(data);
        const errs = [data.errors?.gsc, data.errors?.ga4].filter(Boolean);
        if (errs.length) setError(errs.join(" · "));
      })
      .catch((err) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [status.connected, uid, project]);

  useEffect(() => {
    setGscSiteUrl(status.gscSiteUrl || "");
    setGa4PropertyId(status.ga4PropertyId || "");
  }, [status.gscSiteUrl, status.ga4PropertyId]);

  async function save() {
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      const ga4 = props?.ga4Properties?.find((p) => p.propertyId === ga4PropertyId);
      onChange(
        await selectGoogleProperties({
          uid,
          project,
          gscSiteUrl,
          ga4PropertyId,
          ga4PropertyName: ga4?.displayName || "",
        }),
      );
      setSaved(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    try {
      onChange(await disconnectIntegration({ uid, project, provider: "google" }));
      setProps(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <IntegrationShell
      icon="trendingUp"
      title="Google Search Console & GA4"
      subtitle="Real queries, rankings, index status, sitemaps, traffic, and conversions."
      connected={status.connected}
    >
      {!configured ? (
        <p className="integration-help">
          Add <code>GOOGLE_OAUTH_CLIENT_ID</code> and <code>GOOGLE_OAUTH_CLIENT_SECRET</code> to <code>.env</code> and
          restart the dev server to enable Google sign-in.
        </p>
      ) : !status.connected ? (
        <button type="button" className="btn btn-primary integration-google-btn" onClick={() => startGoogleConnect(project).catch((err) => alert(err.message))}>
          <Icon name="globe" size={16} />
          Connect Google account
        </button>
      ) : (
        <div className="integration-form">
          <div className="integration-row">
            <span>
              Signed in as <strong>{status.email || "Google account"}</strong>
            </span>
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={disconnect}>
              Disconnect
            </button>
          </div>
          <label className="integration-field">
            <span>Search Console property</span>
            <select value={gscSiteUrl} onChange={(e) => setGscSiteUrl(e.target.value)} disabled={!props}>
              <option value="">{props ? "Select a property" : "Loading…"}</option>
              {(props?.gscSites || []).map((site) => (
                <option key={site.siteUrl} value={site.siteUrl}>
                  {site.siteUrl}
                </option>
              ))}
            </select>
          </label>
          <label className="integration-field">
            <span>GA4 property</span>
            <select value={ga4PropertyId} onChange={(e) => setGa4PropertyId(e.target.value)} disabled={!props}>
              <option value="">{props ? "Select a property" : "Loading…"}</option>
              {(props?.ga4Properties || []).map((p) => (
                <option key={p.propertyId} value={p.propertyId}>
                  {p.displayName} · {p.account}
                </option>
              ))}
            </select>
          </label>
          {error ? <p className="integration-error">{error}</p> : null}
          <div className="integration-row">
            <span className="integration-muted">{saved ? "Saved." : ""}</span>
            <button type="button" className="btn btn-primary" disabled={busy || !props} onClick={save}>
              Save properties
            </button>
          </div>
        </div>
      )}
    </IntegrationShell>
  );
}
