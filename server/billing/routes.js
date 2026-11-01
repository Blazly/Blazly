import { readJson as sharedReadJson } from "../readJson.js";
import Stripe from "stripe";
import { identify } from "../credits/middleware.js";
import { findUidByCustomer, getCreditAccount, grantCredits, updateCreditAccount } from "../credits/store.js";
import { requestOrigin } from "../integrations/http.js";
import { PLANS, TOPUP_PACKS, topupPrice } from "../../src/plans.js";

/** Stripe Price IDs per plan and interval, read from env so test and live modes can differ. */
const PRICE_ENV = {
  pro: { month: "STRIPE_PRICE_PRO_MONTHLY", year: "STRIPE_PRICE_PRO_ANNUAL" },
  business: { month: "STRIPE_PRICE_BUSINESS_MONTHLY", year: "STRIPE_PRICE_BUSINESS_ANNUAL" },
};

let client = null;
function stripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  if (!client) client = new Stripe(key);
  return client;
}

function priceId(plan, interval) {
  return process.env[PRICE_ENV[plan]?.[interval]] || "";
}

function planForPrice(id) {
  for (const [plan, intervals] of Object.entries(PRICE_ENV)) {
    for (const [interval, envKey] of Object.entries(intervals)) {
      if (process.env[envKey] && process.env[envKey] === id) return { plan, interval };
    }
  }
  return null;
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

function readRaw(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function readJson(req) {
  return sharedReadJson(req, { maxBytes: 1_000_000 });
}

async function ensureCustomer(uid, email) {
  const account = await getCreditAccount(uid);
  if (account.stripeCustomerId) return account.stripeCustomerId;
  const customer = await stripe().customers.create({ email: email || undefined, metadata: { app: "blazly", uid } });
  await updateCreditAccount(uid, { stripeCustomerId: customer.id });
  return customer.id;
}

async function startCheckout(req, who, body) {
  const origin = requestOrigin(req);
  const customer = await ensureCustomer(who.uid, body.email);
  const back = `${origin}/?view=pricing`;

  if (body.kind === "topup") {
    const account = await getCreditAccount(who.uid);
    const credits = Number(body.credits);
    if (!TOPUP_PACKS.includes(credits)) throw Object.assign(new Error("Unknown credit pack."), { status: 400 });
    const price = topupPrice(account.plan, credits);
    if (!price) throw Object.assign(new Error("Top-ups are available on Pro and Business."), { status: 403 });
    return stripe().checkout.sessions.create({
      mode: "payment",
      customer,
      client_reference_id: who.uid,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: Math.round(price * 100),
            product_data: { name: `${credits.toLocaleString()} Blazly credits` },
          },
        },
      ],
      metadata: { app: "blazly", uid: who.uid, kind: "topup", credits: String(credits) },
      success_url: `${back}&billing=topup-success`,
      cancel_url: `${back}&billing=cancelled`,
    });
  }

  const plan = body.plan;
  const interval = body.interval === "year" ? "year" : "month";
  const price = priceId(plan, interval);
  if (!PLANS[plan] || plan === "free") throw Object.assign(new Error("Unknown plan."), { status: 400 });
  if (!price) throw Object.assign(new Error(`Stripe price for ${plan} (${interval}) is not configured yet.`), { status: 503 });
  return stripe().checkout.sessions.create({
    mode: "subscription",
    customer,
    client_reference_id: who.uid,
    line_items: [{ price, quantity: 1 }],
    allow_promotion_codes: true,
    subscription_data: { metadata: { app: "blazly", uid: who.uid, plan, interval } },
    metadata: { app: "blazly", uid: who.uid, kind: "subscription", plan, interval },
    success_url: `${back}&billing=success`,
    cancel_url: `${back}&billing=cancelled`,
  });
}

async function uidFor(object) {
  return object.metadata?.uid || (object.customer ? await findUidByCustomer(object.customer) : null);
}

async function handleEvent(event) {
  const object = event.data.object;

  // The Stripe account is shared with other Blazly products, so only act on our own sessions and prices.
  if (event.type === "checkout.session.completed" && object.metadata?.app === "blazly" && object.metadata?.kind === "topup") {
    if (object.payment_status !== "paid") return;
    const credits = Number(object.metadata.credits) || 0;
    await grantCredits(object.metadata.uid, credits, { eventId: event.id, label: `Top-up: ${credits} credits` });
    return;
  }

  // Each paid invoice (first payment and every renewal) grants that period's plan credits.
  if (event.type === "invoice.paid") {
    const line = object.lines?.data?.[0];
    const match = planForPrice(line?.pricing?.price_details?.price || line?.price?.id);
    const uid = await uidFor(object);
    if (!match || !uid) return;
    const plan = PLANS[match.plan];
    const credits = match.interval === "year" ? plan.credits * 12 : plan.credits;
    await grantCredits(uid, credits, {
      eventId: event.id,
      label: `${plan.name} plan credits`,
      patch: { plan: match.plan, billingInterval: match.interval, stripeCustomerId: object.customer },
    });
    return;
  }

  if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.created") {
    const match = planForPrice(object.items?.data?.[0]?.price?.id);
    if (!match) return;
    const uid = await uidFor(object);
    if (!uid) return;
    await updateCreditAccount(uid, {
      stripeSubscriptionId: object.id,
      subscriptionStatus: object.status,
      cancelAtPeriodEnd: Boolean(object.cancel_at_period_end),
      ...(["active", "trialing"].includes(object.status) ? { plan: match.plan, billingInterval: match.interval } : {}),
    });
    return;
  }

  if (event.type === "customer.subscription.deleted") {
    if (!planForPrice(object.items?.data?.[0]?.price?.id)) return;
    const uid = await uidFor(object);
    if (uid) await updateCreditAccount(uid, { plan: "free", subscriptionStatus: "canceled", stripeSubscriptionId: null });
  }
}

export function attachBilling(server) {
  server.middlewares.use(async (req, res, next) => {
    const path = (req.url || "").split("?")[0];
    if (!path.startsWith("/api/billing/")) return next();

    if (path === "/api/billing/config" && req.method === "GET") {
      return sendJson(res, 200, {
        enabled: Boolean(stripe()),
        prices: Object.fromEntries(
          Object.keys(PRICE_ENV).map((plan) => [plan, { month: Boolean(priceId(plan, "month")), year: Boolean(priceId(plan, "year")) }]),
        ),
      });
    }

    if (path === "/api/billing/webhook" && req.method === "POST") {
      if (!stripe() || !process.env.STRIPE_WEBHOOK_SECRET) return sendJson(res, 503, { error: "Stripe is not configured." });
      let event;
      try {
        const raw = await readRaw(req);
        event = stripe().webhooks.constructEvent(raw, req.headers["stripe-signature"], process.env.STRIPE_WEBHOOK_SECRET);
      } catch (error) {
        return sendJson(res, 400, { error: `Webhook signature failed: ${error.message}` });
      }
      try {
        await handleEvent(event);
        return sendJson(res, 200, { received: true });
      } catch (error) {
        console.warn(`[billing] ${event.type} failed: ${error.message}`);
        return sendJson(res, 500, { error: error.message });
      }
    }

    if (req.method !== "POST") return next();
    if (!stripe()) return sendJson(res, 503, { error: "Payments are not set up yet. Please check back soon." });

    try {
      const who = await identify(req);
      if (!who) return sendJson(res, 401, { error: "Sign in to manage your plan." });
      const body = await readJson(req);

      if (path === "/api/billing/checkout") {
        const session = await startCheckout(req, who, body);
        return sendJson(res, 200, { url: session.url });
      }

      if (path === "/api/billing/portal") {
        const account = await getCreditAccount(who.uid);
        if (!account.stripeCustomerId) return sendJson(res, 400, { error: "No billing account yet." });
        const session = await stripe().billingPortal.sessions.create({
          customer: account.stripeCustomerId,
          ...(process.env.STRIPE_PORTAL_CONFIG ? { configuration: process.env.STRIPE_PORTAL_CONFIG } : {}),
          return_url: `${requestOrigin(req)}/?view=pricing`,
        });
        return sendJson(res, 200, { url: session.url });
      }
    } catch (error) {
      return sendJson(res, error.status || 500, { error: error.message || "Billing request failed." });
    }
    return next();
  });
}
