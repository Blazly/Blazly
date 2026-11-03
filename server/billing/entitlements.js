import { AsyncLocalStorage } from "async_hooks";
import { planOf } from "./team.js";
import { PLANS } from "../../src/plans.js";

const RANK = { free: 0, pro: 1, business: 2, agency: 3 };

/** Paid features and the cheapest plan that includes them. */
export const FEATURES = {
  b2b: { plan: "pro", label: "B2B lead finder" },
  maxBlog: { plan: "pro", label: "Max-effort blogs" },
  scheduling: { plan: "pro", label: "Scheduled tasks" },
  mcp: { plan: "pro", label: "Connect AI tools (MCP)" },
};

export const AGENT_FEATURES = {
  "/api/b2b-lead-finder": "b2b",
};

/** Lets deep agent code (e.g. the blog model router) see the caller's plan without threading it through. */
export const planContext = new AsyncLocalStorage();

export function currentPlan() {
  return planContext.getStore()?.plan || "business";
}

export async function planFor(uid) {
  return planOf(uid);
}

export function hasFeature(plan, feature) {
  return (RANK[plan] ?? 0) >= RANK[FEATURES[feature].plan];
}

export function planRequiredError(feature) {
  const { plan, label } = FEATURES[feature];
  return Object.assign(new Error(`${label} is available on the ${PLANS[plan].name} plan and above. Upgrade to unlock it.`), {
    status: 403,
    code: "plan_required",
    requiredPlan: plan,
    feature,
  });
}

export async function requireFeature(uid, feature) {
  const plan = await planFor(uid);
  if (!hasFeature(plan, feature)) throw planRequiredError(feature);
  return plan;
}

export function chainLimit(plan) {
  return PLANS[plan]?.aiChainSteps || PLANS.free.aiChainSteps;
}
