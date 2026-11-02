/** Helpers for "integrations may only talk to the project's own website". */

export function siteHost(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const text = raw.replace(/^sc-domain:/i, "");
  const withProto = /^https?:\/\//i.test(text) ? text : `https://${text}`;
  try {
    return new URL(withProto).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** True when `candidate` is the project host itself or a subdomain of it (or vice versa, e.g. blog.site.com ↔ site.com). */
export function sameSite(projectUrl, candidate) {
  const a = siteHost(projectUrl);
  const b = siteHost(candidate);
  if (!a || !b) return false;
  return a === b || b.endsWith(`.${a}`) || a.endsWith(`.${b}`);
}

export function requireProjectWebsite(website, project) {
  const host = siteHost(website);
  if (!host) {
    throw Object.assign(
      new Error(`Add a website to the "${project || "current"}" project first. Integrations only connect to the project's own site.`),
      { status: 400, code: "project_website_missing" },
    );
  }
  return host;
}

export function mismatchError(what, projectUrl, given) {
  return Object.assign(
    new Error(
      `${what} must be on this project's website (${siteHost(projectUrl)}). ${given ? `"${siteHost(given) || given}" doesn't match.` : ""}`.trim(),
    ),
    { status: 400, code: "site_mismatch" },
  );
}
