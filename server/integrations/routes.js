import { identify } from "../credits/middleware.js";
import { removeProject, renameProject } from "../billing/projects.js";
import { deleteProjectIntegrations, getProjectIntegrations, renameProjectIntegrations, setProvider } from "./store.js";
import { buildWordPressAuthUrl, normalizeSiteUrl, testWordPress } from "./wordpress.js";
import {
  buildWebflowAuthUrl,
  describeWebflowCollection,
  exchangeWebflowCode,
  listWebflowCollections,
  listWebflowSites,
  saveWebflowToken,
  webflowConfigured,
} from "./webflow.js";
import { generateWebhookSecret, normalizeEndpointUrl, testWebhook } from "./webhook.js";
import { buildAuthUrl, exchangeCode, saveGoogleTokens, signState, verifyState } from "./google.js";
import { listGscSites } from "./gsc.js";
import { listGa4Properties } from "./ga4.js";
import { parseUrl, readJson, redirect, requestOrigin, sendJson, writeSse } from "./http.js";
import { runIntegrationsAgent } from "../integrationsAgent.js";
import { renameKeysProject } from "../publicMcp/keys.js";

function publicStatus(integrations) {
  const wp = integrations.wordpress;
  const google = integrations.google;
  return {
    wordpress: wp?.appPassword
      ? { connected: true, siteUrl: wp.siteUrl, username: wp.username, displayName: wp.displayName || "" }
      : { connected: false },
    webflow: integrations.webflow?.accessToken
      ? {
          connected: true,
          userName: integrations.webflow.userName || "",
          siteId: integrations.webflow.siteId || "",
          siteName: integrations.webflow.siteName || "",
          siteDomain: integrations.webflow.siteDomain || "",
          collectionId: integrations.webflow.collectionId || "",
          collectionName: integrations.webflow.collectionName || "",
        }
      : { connected: false },
    webflowConfigured: webflowConfigured(),
    webhook: integrations.webhook?.secret
      ? {
          connected: Boolean(integrations.webhook.verifiedAt),
          configured: true,
          endpointUrl: integrations.webhook.endpointUrl,
          siteUrl: integrations.webhook.siteUrl || "",
          secret: integrations.webhook.secret,
          verifiedAt: integrations.webhook.verifiedAt || "",
        }
      : { connected: false },
    google: google?.refreshToken
      ? {
          connected: true,
          email: google.email || "",
          gscSiteUrl: google.gscSiteUrl || "",
          ga4PropertyId: google.ga4PropertyId || "",
          ga4PropertyName: google.ga4PropertyName || "",
        }
      : { connected: false },
    googleConfigured: Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET),
  };
}

async function requireAuth(req) {
  const who = await identify(req);
  if (!who) {
    const error = new Error("Sign in to manage integrations.");
    error.status = 401;
    throw error;
  }
  return who.uid;
}

export function attachIntegrations(server, ctx) {
  server.middlewares.use(async (req, res, next) => {
    const { path, params } = parseUrl(req);
    if (!path.startsWith("/api/integrations")) return next();

    try {
      if (path === "/api/integrations/status" && req.method === "GET") {
        const uid = (await requireAuth(req));
        const integrations = await getProjectIntegrations(uid, params.get("project"));
        sendJson(res, 200, publicStatus(integrations));
        return;
      }

      if (path === "/api/integrations/wordpress" && req.method === "POST") {
        const body = await readJson(req);
        const uid = (await requireAuth(req));
        const creds = {
          siteUrl: normalizeSiteUrl(body.siteUrl),
          username: String(body.username || "").trim(),
          appPassword: String(body.appPassword || "").trim(),
        };
        if (!creds.username || !creds.appPassword) {
          throw new Error("Enter your WordPress username and an application password.");
        }
        const check = await testWordPress(creds);
        await setProvider(uid, body.project, "wordpress", { ...creds, displayName: check.name });
        sendJson(res, 200, publicStatus(await getProjectIntegrations(uid, body.project)));
        return;
      }

      if (path === "/api/integrations/wordpress/authorize" && req.method === "POST") {
        const body = await readJson(req);
        const uid = (await requireAuth(req));
        const origin = requestOrigin(req);
        const project = body.project || "default";
        const state = signState({ uid, project, provider: "wordpress", siteUrl: normalizeSiteUrl(body.siteUrl) });
        const result = await buildWordPressAuthUrl({
          siteUrl: body.siteUrl,
          callbackUrl: `${origin}/api/integrations/wordpress/callback?state=${encodeURIComponent(state)}`,
          rejectUrl: `${origin}/?integrations=error&reason=${encodeURIComponent("WordPress access was not approved.")}`,
        });
        sendJson(res, 200, result);
        return;
      }

      if (path === "/api/integrations/wordpress/callback" && req.method === "GET") {
        const { uid, project, provider, siteUrl } = verifyState(params.get("state"));
        if (provider !== "wordpress") throw new Error("Invalid authorization state.");
        const username = String(params.get("user_login") || "").trim();
        const appPassword = String(params.get("password") || "").trim();
        if (!username || !appPassword) throw new Error("WordPress didn't return an application password.");
        const creds = { siteUrl: normalizeSiteUrl(params.get("site_url") || siteUrl), username, appPassword };
        const check = await testWordPress(creds);
        await setProvider(uid, project, "wordpress", { ...creds, displayName: check.name });
        redirect(res, "/?integrations=wordpress-connected");
        return;
      }

      if (path === "/api/integrations/webflow/start" && req.method === "POST") {
        const uid = await requireAuth(req);
        const body = await readJson(req);
        sendJson(res, 200, { url: buildWebflowAuthUrl({ origin: requestOrigin(req), uid, project: String(body.project || "default") }) });
        return;
      }

      if (path === "/api/integrations/webflow/callback" && req.method === "GET") {
        if (params.get("error")) {
          redirect(res, `/?integrations=error&reason=${encodeURIComponent(params.get("error_description") || params.get("error"))}`);
          return;
        }
        const { uid, project, provider } = verifyState(params.get("state"));
        if (provider !== "webflow") throw new Error("Invalid OAuth state.");
        const token = await exchangeWebflowCode({ code: params.get("code"), origin: requestOrigin(req) });
        await saveWebflowToken(uid, project, token);
        redirect(res, "/?integrations=webflow-connected");
        return;
      }

      if (path === "/api/integrations/webflow/sites" && req.method === "GET") {
        const uid = (await requireAuth(req));
        sendJson(res, 200, { sites: await listWebflowSites(uid, params.get("project")) });
        return;
      }

      if (path === "/api/integrations/webflow/collections" && req.method === "GET") {
        const uid = (await requireAuth(req));
        const project = params.get("project");
        sendJson(res, 200, { collections: await listWebflowCollections(uid, project, params.get("siteId")) });
        return;
      }

      if (path === "/api/integrations/webflow/select" && req.method === "POST") {
        const body = await readJson(req);
        const uid = (await requireAuth(req));
        const sites = await listWebflowSites(uid, body.project);
        const site = sites.find((s) => s.id === body.siteId);
        if (!site) throw new Error("Pick a Webflow site.");
        const collections = await listWebflowCollections(uid, body.project, site.id);
        const collection = collections.find((c) => c.id === body.collectionId);
        if (!collection) throw new Error("Pick the CMS collection that holds your blog posts.");
        const domain = site.domains[0] ? `https://${site.domains[0].replace(/^https?:\/\//, "")}` : `https://${site.shortName}.webflow.io`;
        await setProvider(uid, body.project, "webflow", {
          siteId: site.id,
          siteName: site.name,
          siteDomain: domain,
          collectionId: collection.id,
          collectionName: collection.name,
        });
        const described = await describeWebflowCollection(uid, body.project, collection.id);
        sendJson(res, 200, { ...publicStatus(await getProjectIntegrations(uid, body.project)), webflowMapping: described.mapping });
        return;
      }

      if (path === "/api/integrations/webhook" && req.method === "POST") {
        const body = await readJson(req);
        const uid = (await requireAuth(req));
        const existing = (await getProjectIntegrations(uid, body.project)).webhook;
        const config = {
          endpointUrl: normalizeEndpointUrl(body.endpointUrl || existing?.endpointUrl),
          secret: body.rotateSecret || !existing?.secret ? generateWebhookSecret() : existing.secret,
          siteUrl: String(body.siteUrl ?? existing?.siteUrl ?? "").trim(),
        };
        const unchanged = existing?.verifiedAt && existing.endpointUrl === config.endpointUrl && existing.secret === config.secret;
        await setProvider(uid, body.project, "webhook", { ...config, verifiedAt: unchanged ? existing.verifiedAt : "" });
        sendJson(res, 200, publicStatus(await getProjectIntegrations(uid, body.project)));
        return;
      }

      if (path === "/api/integrations/webhook/test" && req.method === "POST") {
        const body = await readJson(req);
        const uid = (await requireAuth(req));
        const hook = (await getProjectIntegrations(uid, body.project)).webhook;
        if (!hook?.secret) throw new Error("Save your endpoint first.");
        await testWebhook(hook);
        await setProvider(uid, body.project, "webhook", { ...hook, verifiedAt: new Date().toISOString() });
        sendJson(res, 200, publicStatus(await getProjectIntegrations(uid, body.project)));
        return;
      }

      if (path === "/api/integrations/project/rename" && req.method === "POST") {
        const body = await readJson(req);
        const uid = (await requireAuth(req));
        await renameProjectIntegrations(uid, String(body.from || ""), String(body.to || ""));
        await renameKeysProject(uid, String(body.from || ""), String(body.to || ""));
        await renameProject(uid, String(body.from || ""), String(body.to || ""));
        sendJson(res, 200, { ok: true });
        return;
      }

      if (path === "/api/integrations/project/delete" && req.method === "POST") {
        const body = await readJson(req);
        const uid = (await requireAuth(req));
        await deleteProjectIntegrations(uid, String(body.project || ""));
        await removeProject(uid, String(body.project || ""));
        sendJson(res, 200, { ok: true });
        return;
      }

      if (path === "/api/integrations/disconnect" && req.method === "POST") {
        const body = await readJson(req);
        const uid = (await requireAuth(req));
        if (!["wordpress", "google", "webhook", "webflow"].includes(body.provider)) throw new Error("Unknown integration.");
        await setProvider(uid, body.project, body.provider, null);
        sendJson(res, 200, publicStatus(await getProjectIntegrations(uid, body.project)));
        return;
      }

      if (path === "/api/integrations/google/start" && req.method === "POST") {
        const uid = await requireAuth(req);
        const body = await readJson(req);
        sendJson(res, 200, { url: buildAuthUrl({ origin: requestOrigin(req), uid, project: String(body.project || "default") }) });
        return;
      }

      if (path === "/api/integrations/google/callback" && req.method === "GET") {
        if (params.get("error")) {
          redirect(res, `/?integrations=error&reason=${encodeURIComponent(params.get("error"))}`);
          return;
        }
        const { uid, project } = verifyState(params.get("state"));
        const tokens = await exchangeCode({ code: params.get("code"), origin: requestOrigin(req) });
        await saveGoogleTokens(uid, project, tokens);
        redirect(res, "/?integrations=google-connected");
        return;
      }

      if (path === "/api/integrations/google/properties" && req.method === "GET") {
        const uid = (await requireAuth(req));
        const project = params.get("project");
        const [gsc, ga4] = await Promise.allSettled([listGscSites(uid, project), listGa4Properties(uid, project)]);
        sendJson(res, 200, {
          gscSites: gsc.status === "fulfilled" ? gsc.value : [],
          ga4Properties: ga4.status === "fulfilled" ? ga4.value : [],
          errors: {
            gsc: gsc.status === "rejected" ? gsc.reason.message : "",
            ga4: ga4.status === "rejected" ? ga4.reason.message : "",
          },
        });
        return;
      }

      if (path === "/api/integrations/google/select" && req.method === "POST") {
        const body = await readJson(req);
        const uid = (await requireAuth(req));
        await setProvider(uid, body.project, "google", {
          gscSiteUrl: String(body.gscSiteUrl || ""),
          ga4PropertyId: String(body.ga4PropertyId || ""),
          ga4PropertyName: String(body.ga4PropertyName || ""),
        });
        sendJson(res, 200, publicStatus(await getProjectIntegrations(uid, body.project)));
        return;
      }

      if (path === "/api/integrations/agent" && req.method === "POST") {
        res.statusCode = 200;
        res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache, no-transform");
        res.setHeader("Connection", "keep-alive");
        res.flushHeaders?.();
        try {
          const body = await readJson(req);
          const content = await runIntegrationsAgent(body, (event) => writeSse(res, event), ctx);
          writeSse(res, { type: "complete", content });
          res.write("data: [DONE]\n\n");
        } catch (error) {
          writeSse(res, { type: "error", error: error.message || "Integrations agent failed." });
        }
        res.end();
        return;
      }

      next();
    } catch (error) {
      if (path.endsWith("/callback")) {
        redirect(res, `/?integrations=error&reason=${encodeURIComponent(error.message)}`);
        return;
      }
      sendJson(res, error.status || 400, { error: error.message || "Integration request failed." });
    }
  });
}
