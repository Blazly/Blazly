const STORAGE_KEY = "blazly-referral-code";

/** Remembers ?ref=CODE so it survives the sign-up flow. */
export function captureReferralFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("ref");
  if (!code) return;
  localStorage.setItem(STORAGE_KEY, code.trim().toUpperCase());
  params.delete("ref");
  const query = params.toString();
  window.history.replaceState({}, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
}

export async function claimPendingReferral() {
  const code = localStorage.getItem(STORAGE_KEY);
  if (!code) return;
  try {
    const response = await fetch("/api/referrals/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    if (response.status !== 401) localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Retried on the next load.
  }
}

export async function fetchReferral() {
  const response = await fetch("/api/referrals");
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Could not load your referral link.");
  return data;
}

export function referralLink(code) {
  return `${window.location.origin}/?ref=${code}`;
}
