import { readJson as sharedReadJson } from "./readJson.js";
import crypto from "crypto";
import { adminAuth } from "./firebaseAdmin.js";

const CODE_TTL_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_SENDS_PER_HOUR = 5;
const MAX_IP_SENDS_PER_HOUR = 20;
const MAX_ATTEMPTS = 5;
const TOKEN_TTL_MS = 30 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

const pending = globalThis.__blazlyOtpPending || (globalThis.__blazlyOtpPending = new Map());
const ipSends = globalThis.__blazlyOtpIpSends || (globalThis.__blazlyOtpIpSends = new Map());

function fail(message, status = 400, extra = {}) {
  return Object.assign(new Error(message), { status, ...extra });
}

function secret() {
  return process.env.BREVO_API_KEY || process.env.CRON_SECRET || "blazly-otp-dev";
}

function hash(value) {
  return crypto.createHmac("sha256", secret()).update(value).digest("hex");
}

function normalizeEmail(email) {
  const value = String(email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) || value.length > 254) throw fail("Enter a valid email address.");
  return value;
}

function clientIp(req) {
  return String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket?.remoteAddress || "unknown";
}

function recent(times, now) {
  return (times || []).filter((t) => now - t < HOUR);
}

function prune(now) {
  for (const [email, entry] of pending) if (now - entry.lastSentAt > HOUR) pending.delete(email);
  for (const [ip, times] of ipSends) {
    const kept = recent(times, now);
    if (kept.length) ipSends.set(ip, kept);
    else ipSends.delete(ip);
  }
}

/** The template reads {{ contact.FIRSTNAME }}, so the recipient must exist as a Brevo contact with that attribute. */
async function upsertBrevoContact(apiKey, email, firstName) {
  try {
    const response = await fetch("https://api.brevo.com/v3/contacts", {
      method: "POST",
      headers: { "api-key": apiKey, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ email, attributes: { FIRSTNAME: firstName }, updateEnabled: true }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      console.warn(`[otp] Brevo contact upsert failed (${response.status}): ${data.message || data.code || "unknown"}`);
    }
  } catch (error) {
    console.warn(`[otp] Brevo contact upsert failed: ${error.message}`);
  }
}

const PURPOSES = {
  verify: {
    templateEnv: "BREVO_VERIFICATION_TEMPLATE_ID",
    defaultTemplate: 86,
    params: (firstName, code) => ({ FIRSTNAME: firstName || "there", OTP_CODE: code }),
  },
  reset: {
    templateEnv: "BREVO_PASSWORD_RESET_TEMPLATE_ID",
    defaultTemplate: 87,
    params: (firstName, code) => ({
      FIRSTNAME: firstName || "there",
      first_name: firstName || "there",
      OTP_CODE: code,
      password_reset_code: code,
      PASSWORD_RESET_CODE: code,
    }),
  },
};

async function sendViaBrevo({ email, firstName, code, purpose }) {
  const apiKey = process.env.BREVO_API_KEY?.trim();
  const config = PURPOSES[purpose];
  const templateId = Number(process.env[config.templateEnv]) || config.defaultTemplate;
  if (!apiKey) throw fail("Email sending is not configured.", 500);
  if (firstName) await upsertBrevoContact(apiKey, email, firstName);
  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": apiKey, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      templateId,
      sender: {
        email: process.env.BREVO_SENDER_EMAIL?.trim() || "jerry@blazly.ai",
        name: process.env.BREVO_SENDER_NAME?.trim() || "Blazly Team",
      },
      to: [{ email, ...(firstName ? { name: firstName } : {}) }],
      params: config.params(firstName, code),
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    console.warn(`[otp] Brevo send failed (${response.status}): ${data.message || data.code || "unknown"}`);
    throw fail("We couldn't send the email. Try again in a moment.", 502);
  }
}

export async function sendOtp(req, { email, name }, purpose = "verify") {
  const now = Date.now();
  prune(now);
  const address = normalizeEmail(email);
  const slot = `${purpose}:${address}`;
  const firstName = String(name || "").trim().split(/\s+/)[0]?.slice(0, 40) || "";
  const ip = clientIp(req);

  const existing = pending.get(slot);
  if (existing && now - existing.lastSentAt < RESEND_COOLDOWN_MS) {
    const wait = Math.ceil((RESEND_COOLDOWN_MS - (now - existing.lastSentAt)) / 1000);
    throw fail(`Please wait ${wait}s before requesting another code.`, 429, { retryAfter: wait });
  }
  const sends = recent(existing?.sends, now);
  if (sends.length >= MAX_SENDS_PER_HOUR) throw fail("Too many codes requested for this email. Try again in an hour.", 429);
  const ipTimes = recent(ipSends.get(ip), now);
  if (ipTimes.length >= MAX_IP_SENDS_PER_HOUR) throw fail("Too many verification requests. Try again later.", 429);

  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  await sendViaBrevo({ email: address, firstName, code, purpose });

  pending.set(slot, {
    codeHash: hash(`${address}:${code}`),
    expiresAt: now + CODE_TTL_MS,
    attempts: 0,
    lastSentAt: now,
    sends: [...sends, now],
  });
  ipSends.set(ip, [...ipTimes, now]);
  return { sent: true, expiresInSeconds: CODE_TTL_MS / 1000, resendInSeconds: RESEND_COOLDOWN_MS / 1000 };
}

export function verifyOtp({ email, code }, purpose = "verify") {
  const address = normalizeEmail(email);
  const slot = `${purpose}:${address}`;
  const entry = pending.get(slot);
  const clean = String(code || "").replace(/\D/g, "");
  if (!entry) throw fail("Request a new verification code.");
  if (Date.now() > entry.expiresAt) {
    pending.delete(slot);
    throw fail("That code has expired. Request a new one.");
  }
  if (entry.attempts >= MAX_ATTEMPTS) {
    pending.delete(slot);
    throw fail("Too many wrong attempts. Request a new code.", 429);
  }
  const expected = Buffer.from(entry.codeHash);
  const actual = Buffer.from(hash(`${address}:${clean}`));
  if (clean.length !== 6 || !crypto.timingSafeEqual(expected, actual)) {
    entry.attempts += 1;
    const left = MAX_ATTEMPTS - entry.attempts;
    throw fail(left > 0 ? `That code isn't right. ${left} attempt${left === 1 ? "" : "s"} left.` : "Too many wrong attempts. Request a new code.");
  }
  pending.delete(slot);
  const body = Buffer.from(JSON.stringify({ email: address, exp: Date.now() + TOKEN_TTL_MS })).toString("base64url");
  return { verified: true, token: `${body}.${hash(body)}` };
}

export function checkVerificationToken(token, email) {
  const [body, sig] = String(token || "").split(".");
  if (!body || !sig || sig.length !== 64) return false;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(hash(body)))) return false;
  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  return payload.exp > Date.now() && payload.email === normalizeEmail(email);
}

function firstNameFrom(user, email) {
  const display = String(user?.displayName || "").trim().split(/\s+/)[0];
  if (display) return display;
  const word = email.split("@")[0].split("+")[0].replace(/[0-9]+/g, " ").split(/[._\-\s]+/).find((w) => w.length > 1);
  return word ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase() : "";
}

/** Always reports success so the form can't be used to discover which emails have accounts. */
async function sendResetCode(req, { email }) {
  const address = normalizeEmail(email);
  let user = null;
  try {
    user = await adminAuth().getUserByEmail(address);
  } catch (error) {
    if (error.code !== "auth/user-not-found") throw error;
  }
  const generic = { sent: true, expiresInSeconds: CODE_TTL_MS / 1000, resendInSeconds: RESEND_COOLDOWN_MS / 1000 };
  if (!user || user.disabled) return generic;
  return sendOtp(req, { email: address, name: firstNameFrom(user, address) }, "reset");
}

async function confirmPasswordReset({ email, code, newPassword }) {
  const password = String(newPassword || "");
  if (password.length < 6) throw fail("Use at least 6 characters for your new password.");
  if (password.length > 128) throw fail("That password is too long.");
  const address = normalizeEmail(email);
  verifyOtp({ email: address, code }, "reset");
  const auth = adminAuth();
  const user = await auth.getUserByEmail(address);
  await auth.updateUser(user.uid, { password, emailVerified: true });
  await auth.revokeRefreshTokens(user.uid);
  return { reset: true };
}

function readJson(req) {
  return sharedReadJson(req, { maxBytes: 10_000 });
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

export function attachEmailOtp(server) {
  server.middlewares.use(async (req, res, next) => {
    const path = (req.url || "").split("?")[0];
    if (req.method !== "POST" || !path.startsWith("/api/auth/otp/")) return next();
    try {
      const body = await readJson(req);
      if (path === "/api/auth/otp/send") return sendJson(res, 200, await sendOtp(req, body));
      if (path === "/api/auth/otp/verify") return sendJson(res, 200, verifyOtp(body));
      if (path === "/api/auth/otp/check") return sendJson(res, 200, { valid: checkVerificationToken(body.token, body.email) });
      if (path === "/api/auth/otp/reset-send") return sendJson(res, 200, await sendResetCode(req, body));
      if (path === "/api/auth/otp/reset-confirm") return sendJson(res, 200, await confirmPasswordReset(body));
      next();
    } catch (error) {
      sendJson(res, error.status || 400, { error: error.message, ...(error.retryAfter ? { retryAfter: error.retryAfter } : {}) });
    }
  });
}
