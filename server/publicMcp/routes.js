import { readJson as sharedReadJson } from "../readJson.js";
import { identify } from "../credits/middleware.js";
import { MINUTE, enforceLimit, limitsFor } from "../billing/rateLimit.js";
import { ensureProject } from "../billing/projects.js";
import { hasFeature, planFor, planRequiredError, requireFeature } from "../billing/entitlements.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createBlazlyMcpServer } from "./server.js";
import { createApiKey, listApiKeys, resolveApiKey, revokeApiKey } from "./keys.js";
import { resolveBaseUrl } from "../scheduler/index.js";

function readJson(req) {
  return sharedReadJson(req, { maxBytes: 4_000_000 });
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

function rpcError(res, status, message, code = -32001) {
  sendJson(res, status, { jsonrpc: "2.0", error: { code, message }, id: null });
}

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, Mcp-Session-Id, Mcp-Protocol-Version, X-Blazly-Key");
  res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id, WWW-Authenticate");
}

async function requireAuth(req) {
  const who = await identify(req);
  if (!who) throw Object.assign(new Error("Sign in to manage API keys."), { status: 401 });
  return who.uid;
}

function keyFromRequest(req, path) {
  const fromPath = path.match(/^\/mcp\/k\/([^/]+)\/?$/)?.[1];
  if (fromPath) return decodeURIComponent(fromPath);
  const auth = String(req.headers.authorization || "");
  if (/^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, "").trim();
  return String(req.headers["x-blazly-key"] || "").trim();
}

async function handleMcp(req, res, path, server) {
  setCors(res);
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, OPTIONS");
    rpcError(res, 405, "This Blazly MCP endpoint is stateless; send JSON-RPC requests with POST.", -32000);
    return;
  }

  const account = await resolveApiKey(keyFromRequest(req, path));
  if (!account) {
    res.setHeader("WWW-Authenticate", 'Bearer realm="blazly", error="invalid_token"');
    rpcError(res, 401, "Missing or invalid Blazly API key. Create one in Blazly → Connect AI tools.");
    return;
  }
  const plan = await planFor(account.uid);
  if (!hasFeature(plan, "mcp")) {
    rpcError(res, 403, planRequiredError("mcp").message);
    return;
  }
  try {
    enforceLimit(`mcp:${account.id || account.uid}`, limitsFor(plan).mcpPerMinute, MINUTE, "MCP request");
  } catch (error) {
    res.setHeader("Retry-After", String(Math.ceil((error.retryAfterMs || 60_000) / 1000)));
    rpcError(res, 429, error.message, -32000);
    return;
  }

  const body = await readJson(req);
  const mcp = createBlazlyMcpServer(account, { baseUrl: resolveBaseUrl(server) });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on("close", () => {
    transport.close().catch(() => {});
    mcp.close().catch(() => {});
  });
  await mcp.connect(transport);
  await transport.handleRequest(req, res, body);
}

export function attachPublicMcp(server) {
  server.middlewares.use(async (req, res, next) => {
    const [path, query = ""] = (req.url || "").split("?");
    const params = new URLSearchParams(query);
    try {
      if (path === "/mcp" || path.startsWith("/mcp/k/")) {
        await handleMcp(req, res, path, server);
        return;
      }

      if (path === "/api/mcp-keys" && req.method === "GET") {
        const uid = (await requireAuth(req));
        sendJson(res, 200, { keys: await listApiKeys(uid, params.get("project") || "") });
        return;
      }

      if (path === "/api/mcp-keys" && req.method === "POST") {
        const body = (await readJson(req)) || {};
        const uid = (await requireAuth(req));
        await requireFeature(uid, "mcp");
        await ensureProject(uid, body.project);
        sendJson(res, 200, await createApiKey({ ...body, uid }));
        return;
      }

      if (path === "/api/mcp-keys/revoke" && req.method === "POST") {
        const body = (await readJson(req)) || {};
        await revokeApiKey((await requireAuth(req)), String(body.id || ""));
        sendJson(res, 200, { ok: true });
        return;
      }
    } catch (error) {
      if (res.headersSent) {
        res.end();
        return;
      }
      if (path.startsWith("/mcp")) rpcError(res, error.status || 500, error.message || "MCP request failed.", -32603);
      else sendJson(res, error.status || 400, { error: error.message || "Request failed.", code: error.code });
      return;
    }
    next();
  });
}
