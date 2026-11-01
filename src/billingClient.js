async function post(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Billing request failed.");
  return data;
}

export async function fetchBillingConfig() {
  const response = await fetch("/api/billing/config");
  return response.ok ? response.json() : { enabled: false, prices: {} };
}

export async function startPlanCheckout(plan, interval, email) {
  const { url } = await post("/api/billing/checkout", { kind: "subscription", plan, interval, email });
  window.location.assign(url);
}

export async function startTopupCheckout(credits, email) {
  const { url } = await post("/api/billing/checkout", { kind: "topup", credits, email });
  window.location.assign(url);
}

export async function openBillingPortal() {
  const { url } = await post("/api/billing/portal");
  window.location.assign(url);
}
