import { useCallback, useEffect, useState } from "react";
import { Icon } from "./Icon.jsx";
import { createMcpKey, listMcpKeys, revokeMcpKey } from "./mcpKeysClient.js";

const KEY_PLACEHOLDER = "YOUR_BLAZLY_KEY";

function clients(origin, key) {
  const k = key || KEY_PLACEHOLDER;
  const keyUrl = `${origin}/mcp/k/${k}`;
  const url = `${origin}/mcp`;
  return [
    {
      id: "claude",
      name: "Claude",
      note: "claude.ai and Claude Desktop",
      steps: [
        "Open Settings → Connectors",
        "Click Add custom connector",
        "Name it Blazly and paste the URL below, then click Add",
      ],
      code: keyUrl,
    },
    {
      id: "chatgpt",
      name: "ChatGPT",
      note: "Plus, Pro, Business and Enterprise",
      steps: [
        "Open Settings → Apps & Connectors → Advanced settings and turn on Developer mode",
        "Click Create, name it Blazly and paste the URL below",
        "Set Authentication to No authentication (the key is in the URL), then Create",
      ],
      code: keyUrl,
    },
    {
      id: "cursor",
      name: "Cursor",
      note: "Add to ~/.cursor/mcp.json",
      steps: ["Open Cursor Settings → MCP → Add new MCP server, or edit ~/.cursor/mcp.json", "Paste this and save"],
      code: JSON.stringify({ mcpServers: { blazly: { url, headers: { Authorization: `Bearer ${k}` } } } }, null, 2),
    },
    {
      id: "claude-code",
      name: "Claude Code",
      note: "Terminal",
      steps: ["Run this in your terminal"],
      code: `claude mcp add --transport http blazly ${url} --header "Authorization: Bearer ${k}"`,
    },
    {
      id: "lovable",
      name: "Lovable",
      note: "Personal connectors",
      steps: [
        "Open Settings → Connectors → Personal connectors → New MCP server",
        "Name it Blazly, paste the URL below and choose Bearer token / API key auth",
        `Paste your key as the token`,
      ],
      code: url,
    },
    {
      id: "other",
      name: "Other agents",
      note: "Any MCP client",
      steps: [
        "Transport: Streamable HTTP",
        `Send the key as an Authorization: Bearer header, or use the key URL if headers aren't supported`,
      ],
      code: `URL:     ${url}\nHeader:  Authorization: Bearer ${k}\nKey URL: ${keyUrl}`,
    },
  ];
}

const TOOLS = [
  "keyword_research",
  "site_audit",
  "write_seo_blog",
  "write_geo_blog",
  "publish_post",
  "schedule_task",
  "competitor_research",
  "ai_visibility",
  "find_backlinks",
  "serp_tracking",
  "search_console_and_analytics",
  "+ 9 more",
];

export function ConnectAiView({ uid, project, projectContext }) {
  const origin = typeof window === "undefined" ? "https://app.blazly.ai" : window.location.origin;
  const [keys, setKeys] = useState(null);
  const [newKey, setNewKey] = useState(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [client, setClient] = useState("claude");
  const [copied, setCopied] = useState("");

  const refresh = useCallback(async () => {
    if (!uid) return;
    try {
      setKeys(await listMcpKeys(uid, project));
    } catch (err) {
      setError(err.message);
    }
  }, [uid, project]);

  useEffect(() => {
    setNewKey(null);
    refresh();
  }, [refresh]);

  async function create(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { key } = await createMcpKey({
        uid,
        project,
        name: name || clients(origin).find((c) => c.id === client)?.name,
        website: projectContext?.website,
        brandName: projectContext?.brandName,
        knowledge: projectContext?.knowledge,
      });
      setNewKey(key);
      setName("");
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id) {
    if (!window.confirm("Revoke this key? Any AI tool using it will stop working.")) return;
    try {
      await revokeMcpKey(uid, id);
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  function copy(id, value) {
    navigator.clipboard?.writeText(value);
    setCopied(id);
    setTimeout(() => setCopied(""), 1500);
  }

  const list = clients(origin, newKey);
  const active = list.find((c) => c.id === client) || list[0];

  return (
    <div className="page connect-ai-page">
      <header className="page-intro">
        <div className="page-intro-text">
          <h1>Connect AI tools</h1>
          <p className="subpage-lead">
            Use Blazly inside Claude, ChatGPT, Cursor, Lovable and any MCP-compatible agent. They get Blazly’s SEO team for{" "}
            <strong>{project}</strong> — research, audits, blog writing, publishing and scheduling — right in the chat.
          </p>
        </div>
      </header>

      <section className="connect-ai-card">
        <div className="connect-ai-step">
          <span className="connect-ai-num">1</span>
          <div className="connect-ai-step-body">
            <h2>Create a key for {project}</h2>
            <p className="integration-help">Each key works with this project’s website, brand voice and integrations.</p>
            {newKey ? (
              <div className="connect-ai-newkey">
                <p>
                  <Icon name="alert" size={14} /> Copy it now — you won’t see this key again.
                </p>
                <div className="integration-row">
                  <code className="integration-secret">{newKey}</code>
                  <button type="button" className="btn btn-primary" onClick={() => copy("key", newKey)}>
                    {copied === "key" ? "Copied" : "Copy key"}
                  </button>
                </div>
              </div>
            ) : (
              <form className="wp-quick-row" onSubmit={create}>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={`Key name, e.g. ${active.name}`}
                  aria-label="Key name"
                />
                <button type="submit" className="btn btn-primary" disabled={busy || !uid}>
                  {busy ? "Creating…" : "Create key"}
                </button>
              </form>
            )}
            {error ? <p className="integration-error">{error}</p> : null}
          </div>
        </div>

        <div className="connect-ai-step">
          <span className="connect-ai-num">2</span>
          <div className="connect-ai-step-body">
            <h2>Add Blazly to your AI tool</h2>
            <div className="connect-ai-tabs" role="tablist">
              {list.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  role="tab"
                  aria-selected={c.id === active.id}
                  className={`connect-ai-tab${c.id === active.id ? " is-active" : ""}`}
                  onClick={() => setClient(c.id)}
                >
                  {c.name}
                </button>
              ))}
            </div>
            <p className="connect-ai-note">{active.note}</p>
            <ol className="connect-ai-steps">
              {active.steps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
            <div className="connect-ai-code">
              <pre>{active.code}</pre>
              <button type="button" className="btn btn-secondary" onClick={() => copy("code", active.code)}>
                {copied === "code" ? "Copied" : "Copy"}
              </button>
            </div>
            {!newKey ? (
              <p className="integration-help">
                Replace <code>{KEY_PLACEHOLDER}</code> with your key — or create one above and it’s filled in for you.
              </p>
            ) : null}
          </div>
        </div>

        <div className="connect-ai-step">
          <span className="connect-ai-num">3</span>
          <div className="connect-ai-step-body">
            <h2>Ask away</h2>
            <p className="integration-help">
              Try: “Use Blazly to research keywords for project management software, write an SEO blog for the best one and publish
              it as a draft.”
            </p>
            <div className="connect-ai-tools">
              {TOOLS.map((t) => (
                <code key={t}>{t}</code>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section>
        <h2 className="schedule-heading">Active keys for {project}</h2>
        {keys === null ? (
          <p className="integration-muted">Loading…</p>
        ) : !keys.length ? (
          <p className="integration-muted">No keys yet.</p>
        ) : (
          <ul className="schedule-list">
            {keys.map((k) => (
              <li key={k.id} className="schedule-item">
                <span className="schedule-body">
                  <span className="schedule-title">{k.name}</span>
                  <span className="schedule-steps">
                    <code>{k.prefix}</code> · created {new Date(k.createdAt).toLocaleDateString()} ·{" "}
                    {k.lastUsedAt ? `last used ${new Date(k.lastUsedAt).toLocaleString()}` : "never used"}
                  </span>
                </span>
                <button type="button" className="btn btn-secondary" onClick={() => revoke(k.id)}>
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
