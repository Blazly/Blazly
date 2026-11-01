import crypto from "crypto";
import { getProjectIntegrations, setProvider } from "./store.js";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/webmasters",
  "https://www.googleapis.com/auth/analytics.readonly",
];

function clientConfig() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new Error("Google OAuth is not configured. Add GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET to .env.");
  }
  return { clientId, clientSecret };
}

export function redirectUri(origin) {
  return process.env.GOOGLE_OAUTH_REDIRECT_URI?.trim() || `${origin}/api/integrations/google/callback`;
}

function stateSecret() {
  return process.env.INTEGRATIONS_SECRET?.trim() || process.env.GOOGLE_OAUTH_CLIENT_SECRET || "blazly";
}

export function signState(payload) {
  const body = Buffer.from(JSON.stringify({ ...payload, ts: Date.now() })).toString("base64url");
  const sig = crypto.createHmac("sha256", stateSecret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyState(state) {
  const [body, sig] = String(state || "").split(".");
  if (!body || !sig) throw new Error("Invalid OAuth state.");
  const expected = crypto.createHmac("sha256", stateSecret()).update(body).digest("base64url");
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) throw new Error("Invalid OAuth state.");
  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  if (Date.now() - payload.ts > 15 * 60 * 1000) throw new Error("OAuth session expired. Try connecting again.");
  return payload;
}

export function buildAuthUrl({ origin, uid, project }) {
  const { clientId } = clientConfig();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(origin),
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state: signState({ uid, project }),
  });
  return `${AUTH_URL}?${params}`;
}

export async function exchangeCode({ code, origin }) {
  const { clientId, clientSecret } = clientConfig();
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri(origin),
      grant_type: "authorization_code",
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error_description || data.error || "Google sign-in failed.");
  return data;
}

function emailFromIdToken(idToken) {
  try {
    const payload = JSON.parse(Buffer.from(String(idToken).split(".")[1], "base64url").toString("utf8"));
    return payload.email || "";
  } catch {
    return "";
  }
}

export async function saveGoogleTokens(uid, project, tokens) {
  const existing = (await getProjectIntegrations(uid, project)).google || {};
  await setProvider(uid, project, "google", {
    refreshToken: tokens.refresh_token || existing.refreshToken,
    accessToken: tokens.access_token,
    expiresAt: Date.now() + (Number(tokens.expires_in) || 3600) * 1000,
    email: emailFromIdToken(tokens.id_token) || existing.email || "",
    scopes: tokens.scope || existing.scopes || "",
  });
}

export async function googleAccessToken(uid, project) {
  const google = (await getProjectIntegrations(uid, project)).google;
  if (!google?.refreshToken) throw new Error("Google is not connected for this project. Connect it under Integrations.");
  if (google.accessToken && google.expiresAt - 60_000 > Date.now()) return google.accessToken;

  const { clientId, clientSecret } = clientConfig();
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: google.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error("Google access expired. Reconnect Google under Integrations.");
  }
  await setProvider(uid, project, "google", {
    accessToken: data.access_token,
    expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000,
  });
  return data.access_token;
}

export async function googleFetch(uid, project, url, { method = "GET", body } = {}) {
  const token = await googleAccessToken(uid, project);
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60_000),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(data.error?.message || `Google API error (${response.status}).`);
  }
  return data;
}
