import dns from "node:dns/promises";
import net from "node:net";

/** Guards for URLs typed by users that the server will fetch (SSRF protection). */

function fail(message) {
  return Object.assign(new Error(message), { status: 400, code: "unsafe_url" });
}

export function isPrivateIp(ip) {
  const kind = net.isIP(ip);
  if (kind === 4) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  if (kind === 6) {
    const v = ip.toLowerCase();
    if (v === "::" || v === "::1") return true;
    if (v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe8") || v.startsWith("fe9") || v.startsWith("fea") || v.startsWith("feb")) return true;
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIp(mapped[1]);
    return false;
  }
  return false;
}

/** Fast synchronous check on the hostname itself. */
export function assertPublicUrl(input) {
  let url;
  try {
    url = input instanceof URL ? input : new URL(String(input));
  } catch {
    throw fail("That URL isn't valid.");
  }
  if (!["http:", "https:"].includes(url.protocol)) throw fail("Only http and https URLs are allowed.");
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || !host.includes(".") && !net.isIP(host)) {
    throw fail("That address can't be reached from Blazly.");
  }
  if (isPrivateIp(host)) throw fail("That address can't be reached from Blazly.");
  return url;
}

/** Resolves the hostname and rejects if any answer points at a private network (defeats DNS rebinding). */
export async function assertPublicHost(input) {
  const url = assertPublicUrl(input);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host)) return url;
  let answers;
  try {
    answers = await dns.lookup(host, { all: true, verbatim: true });
  } catch {
    throw fail("We couldn't look up that address.");
  }
  if (!answers.length || answers.some((a) => isPrivateIp(a.address))) {
    throw fail("That address can't be reached from Blazly.");
  }
  return url;
}

/** fetch() that checks the target and every redirect hop against private networks. */
export async function safeFetch(input, init = {}, { maxRedirects = 5 } = {}) {
  let current = await assertPublicHost(input);
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const response = await fetch(current, { ...init, redirect: "manual" });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) return response;
      current = await assertPublicHost(new URL(location, current));
      if (response.status === 303 || ((response.status === 301 || response.status === 302) && init.method === "POST")) {
        init = { ...init, method: "GET", body: undefined };
      }
      continue;
    }
    return response;
  }
  throw fail("Too many redirects.");
}
