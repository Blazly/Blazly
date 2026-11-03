const JOIN_KEY = "blazly-project-join";

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

export const fetchSharedProjects = () => call("GET", "/api/shared-projects").then((d) => d.projects || []);
/** Owner: start sharing (or refresh details of) a project. Returns the project with its invite link. */
export const shareProject = ({ name, website, knowledge, logo }) =>
  call("POST", "/api/shared-projects", { name, website, knowledge, logo }).then((d) => d.project);
export const updateSharedProject = (id, patch) => call("PATCH", `/api/shared-projects/${id}`, patch);
export const stopSharingProject = (id) => call("DELETE", `/api/shared-projects/${id}`);
export const resetShareLink = (id) => call("POST", `/api/shared-projects/${id}/link/reset`, {}).then((d) => d.link);
export const removeProjectMember = (id, uid) => call("POST", `/api/shared-projects/${id}/members/remove`, { uid });
export const leaveSharedProject = (id) => call("POST", `/api/shared-projects/${id}/leave`, {});
export const fetchSharedChat = (id, chatId) => call("GET", `/api/shared-projects/${id}/chats/${chatId}`).then((d) => d.chat);
export const pushSharedChat = (id, chat, baseUpdatedAt = null) =>
  call("PUT", `/api/shared-projects/${id}/chats/${chat.id}`, {
    baseUpdatedAt,
    title: chat.title,
    agent: chat.agent || null,
    interactionMode: chat.interactionMode || null,
    scope: chat.scope || null,
    mode: chat.mode || null,
    messages: chat.messages || [],
  }).then((d) => d.chat);
export const deleteSharedChat = (id, chatId) => call("DELETE", `/api/shared-projects/${id}/chats/${chatId}`);
export const fetchTeamUsage = (days = 30) => call("GET", `/api/team/usage?days=${days}`);

/** Remembers ?join=TOKEN so it survives sign-up / sign-in. */
export function captureProjectJoinFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get("join");
  if (!token) return;
  try {
    localStorage.setItem(JOIN_KEY, token);
  } catch {
    // Still try in this session below.
    window.__blazlyJoinToken = token;
  }
  params.delete("join");
  const query = params.toString();
  window.history.replaceState({}, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
}

/** Joins the project from a pending link, if any. Returns the joined project or null. */
export async function joinPendingProject() {
  let token = window.__blazlyJoinToken || "";
  try {
    token = localStorage.getItem(JOIN_KEY) || token;
  } catch {
    // ignore
  }
  if (!token) return null;
  try {
    const { project } = await call("POST", "/api/shared-projects/join", { token });
    return { project };
  } catch (error) {
    return { error: error.message };
  } finally {
    try {
      localStorage.removeItem(JOIN_KEY);
    } catch {
      // ignore
    }
    window.__blazlyJoinToken = "";
  }
}

/** Fingerprint of a chat's messages, used to avoid re-uploading what we just downloaded. */
export function chatFingerprint(messages) {
  return (messages || []).map((m) => `${m.role}:${(m.content || "").length}:${(m.content || "").slice(-40)}`).join("|");
}
