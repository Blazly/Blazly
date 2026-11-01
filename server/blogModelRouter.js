import { classifyBlogEffortTier, modelForEffortTier } from "./modelRouter.js";
import { currentPlan, hasFeature } from "./billing/entitlements.js";

export async function resolveBlogWriterGenkitChain({ message, effortAuto, effortTier }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const workspaceId = process.env.ANTHROPIC_WORKSPACE_ID;
  const auto =
    effortAuto === undefined || effortAuto === null || effortAuto === true || effortAuto === "true";

  let tier = effortTier || "medium";
  if (auto) {
    tier = await classifyBlogEffortTier(message, { apiKey, workspaceId });
  }

  if ((tier === "max" || tier === "extraHigh") && !hasFeature(currentPlan(), "maxBlog")) tier = "high";

  const route = modelForEffortTier(tier);
  const chain =
    route.provider === "anthropic"
      ? [`anthropic/${route.model}`]
      : [`googleai/${route.model}`];

  return { chain, resolvedTier: route.resolvedTier, provider: route.provider, model: route.model };
}
