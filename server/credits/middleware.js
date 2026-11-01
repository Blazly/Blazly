import crypto from "crypto";
import { adminAuth, firebaseAdminConfigured } from "../firebaseAdmin.js";
import { AGENT_PRICING } from "./pricing.js";
import { getCreditAccount, recentTransactions, reserveCredits, settleCredits } from "./store.js";
import { AGENT_FEATURES, hasFeature, planContext, planRequiredError } from "../billing/entitlements.js";
import { resolveBilling } from "../billing/team.js";
import { DAY, HOUR, enforceLimit, limitsFor } from "../billing/rateLimit.js";

/** Lets in-process callers (scheduler, MCP) run agents on a user's behalf without a browser token. */
export const INTERNAL_SECRET =
  globalThis.__blazlyInternalSecret || (globalThis.__blazlyInternalSecret = crypto.randomBytes(32).toString("hex"));

export function internalHeaders(uid, source) {
  return { "X-Blazly-Internal": INTERNAL_SECRET, "X-Blazly-Uid": uid, "X-Blazly-Source": source };
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a || ""));
  const y = Buffer.from(String(b || ""));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export async function identify(req) {
  if (safeEqual(req.headers["x-blazly-internal"], INTERNAL_SECRET) && req.headers["x-blazly-uid"]) {
    return { uid: String(req.headers["x-blazly-uid"]), source: String(req.headers["x-blazly-source"] || "internal") };
  }
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  try {
    const decoded = await adminAuth().verifyIdToken(token);
    return { uid: decoded.uid, source: "app" };
  } catch {
    return null;
  }
}

/** Watches an agent's SSE/JSON response to learn whether it completed and what it produced. */
function trackOutcome(res, onDone) {
  let complete = null;
  let errored = false;
  let carry = "";
  const scan = (chunk) => {
    if (chunk == null || complete) return;
    const text = carry + (typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    const parts = text.split("\n\n");
    carry = parts.pop() || "";
    if (carry.length > 5_000_000) carry = "";
    for (const part of parts) {
      const line = part.split("\n").find((l) => l.startsWith("data: "));
      if (!line) continue;
      const payload = line.slice(6).trim();
      if (!payload.startsWith("{")) continue;
      if (payload.includes('"type":"error"')) errored = true;
      if (payload.includes('"type":"complete"')) {
        try {
          complete = JSON.parse(payload);
        } catch {
          complete = {};
        }
      }
    }
  };
  const write = res.write.bind(res);
  const end = res.end.bind(res);
  res.write = (chunk, ...rest) => {
    scan(chunk);
    return write(chunk, ...rest);
  };
  res.end = (chunk, ...rest) => {
    scan(chunk);
    if (carry) scan("\n\n");
    return end(chunk, ...rest);
  };
  let settled = false;
  const finish = (closedEarly) => {
    if (settled) return;
    settled = true;
    const isStream = String(res.getHeader("Content-Type") || "").includes("text/event-stream");
    let ok;
    if (res.statusCode >= 400) ok = false;
    else if (isStream) ok = complete ? true : errored ? false : closedEarly;
    else ok = true;
    onDone({ ok, complete });
  };
  res.on("finish", () => finish(false));
  res.on("close", () => finish(true));
}

export function attachCredits(server) {
  server.middlewares.use(async (req, res, next) => {
    const path = (req.url || "").split("?")[0];

    if (path === "/api/credits" && req.method === "GET") {
      try {
        const who = await identify(req);
        if (!who) return sendJson(res, 401, { error: "Sign in to see your credits." });
        const billing = await resolveBilling(who.uid);
        const transactions = await recentTransactions(billing.billingUid);
        return sendJson(res, 200, { ...billing.account, plan: billing.plan, teamOwner: billing.teamOwner, transactions });
      } catch (error) {
        return sendJson(res, 500, { error: error.message || "Could not load credits." });
      }
    }

    const pricing = req.method === "POST" ? AGENT_PRICING[path] : null;
    if (!pricing) return next();
    if (!firebaseAdminConfigured()) return next();

    let who;
    let txId;
    let reserved;
    let plan;
    let payer;
    try {
      who = await identify(req);
      if (!who) return sendJson(res, 401, { error: "Sign in to use Blazly agents." });
      const billing = await resolveBilling(who.uid);
      plan = billing.plan;
      payer = billing.billingUid;
      const feature = AGENT_FEATURES[path];
      if (feature && !hasFeature(plan, feature)) throw planRequiredError(feature);
      const limits = limitsFor(plan);
      if (path === "/api/chat" || path === "/api/ai-orchestrator") {
        enforceLimit(`chat:${payer}`, limits.chatPerHour, HOUR, "Message");
      } else {
        enforceLimit(`agent:h:${payer}`, limits.agentRunsPerHour, HOUR, "Agent run");
        enforceLimit(`agent:d:${payer}`, limits.agentRunsPerDay, DAY, "Daily agent run");
      }
      ({ txId, reserved } = await reserveCredits(payer, pricing.reserve(), {
        agent: pricing.agent,
        label: pricing.label,
        source: payer === who.uid ? who.source : `${who.source}:team-member:${who.uid}`,
        minimum: pricing.minimum,
      }));
    } catch (error) {
      return sendJson(res, error.status || 500, {
        error: error.message || "Could not check your credits.",
        ...(error.code
          ? { code: error.code, required: error.required, balance: error.balance, requiredPlan: error.requiredPlan, retryAfterMs: error.retryAfterMs }
          : {}),
      });
    }

    trackOutcome(res, ({ ok, complete }) => {
      const final = !ok ? 0 : pricing.settle ? pricing.settle(complete, reserved) : reserved;
      settleCredits(payer, txId, final).catch((error) => console.warn(`[credits] settle failed: ${error.message}`));
    });
    planContext.run({ plan, uid: who.uid }, next);
  });
}
