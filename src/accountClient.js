const TEAM_INVITE_KEY = "blazly-team-invite";

async function call(method, path, body) {
  const response = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error || "Request failed."), { code: data.code, status: response.status });
  return data;
}

export const fetchTeam = () => call("GET", "/api/team");
export const inviteTeammate = (email) => call("POST", "/api/team/invite", { email });
export const removeTeammate = (email) => call("POST", "/api/team/remove", { email });
export const leaveTeam = () => call("POST", "/api/team/leave", {});

/** `projects` is a list of { name, website }. */
export const syncProjectsWithServer = (projects) => call("POST", "/api/projects/sync", { projects });
export const registerProject = (name, website) => call("POST", "/api/projects/add", { name, website });
export const fetchProjectPolicy = () => call("GET", "/api/projects");
/** Paid plans only, once per 30 days. Returns { name, website, websiteChanged }. */
export const editProjectOnServer = ({ from, to, website }) => call("POST", "/api/projects/edit", { from, to, website });
/** Paid plans only. Also removes the project's integrations. */
export const deleteProjectOnServer = (name) => call("POST", "/api/projects/remove", { name });

/** Remembers ?team=TOKEN so it survives sign-up. */
export function captureTeamInviteFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get("team");
  if (!token) return;
  localStorage.setItem(TEAM_INVITE_KEY, token);
  params.delete("team");
  const query = params.toString();
  window.history.replaceState({}, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
}

/** Returns a message to show the user, or null when there was no pending invite. */
export async function acceptPendingTeamInvite() {
  const token = localStorage.getItem(TEAM_INVITE_KEY);
  if (!token) return null;
  try {
    await call("POST", "/api/team/accept", { token });
    localStorage.removeItem(TEAM_INVITE_KEY);
    window.dispatchEvent(new CustomEvent("blazly:credits-changed"));
    return { tone: "success", text: "You joined the team. You now share its plan and credits." };
  } catch (error) {
    if (error.status === 401) return null;
    localStorage.removeItem(TEAM_INVITE_KEY);
    return { tone: "error", text: error.message };
  }
}
