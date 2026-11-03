import { readJson } from "../readJson.js";
import { identify } from "../credits/middleware.js";
import { requestOrigin } from "../integrations/http.js";
import { describeProjects, editProject, ensureProject, removeProject, syncProjects } from "./projects.js";
import { deleteProjectIntegrations, renameProjectIntegrations, setProvider } from "../integrations/store.js";
import { renameKeysProject } from "../publicMcp/keys.js";
import { acceptInvite, getTeam, inviteMember, leaveTeam, removeMember } from "./team.js";
import { getCreditAccount } from "../credits/store.js";
import { removeFromAllShares } from "../sharedProjects.js";

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}


function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

async function sendInviteEmail({ email, link, ownerEmail, ownerName }) {
  const apiKey = process.env.BREVO_API_KEY?.trim();
  if (!apiKey) return false;
  const inviter = escapeHtml(ownerName || ownerEmail || "A teammate");
  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": apiKey, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      sender: {
        email: process.env.BREVO_SENDER_EMAIL?.trim() || "jerry@blazly.ai",
        name: process.env.BREVO_SENDER_NAME?.trim() || "Blazly Team",
      },
      to: [{ email }],
      subject: `${ownerName || ownerEmail || "A teammate"} invited you to their Blazly team`,
      htmlContent: `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a">
<p>Hi,</p>
<p>${inviter} invited you to join their team on Blazly. You'll share their Business plan and credits.</p>
<p><a href="${escapeHtml(link)}" style="display:inline-block;padding:10px 18px;background:#2f5bea;color:#fff;border-radius:8px;text-decoration:none">Join the team</a></p>
<p>Sign up or sign in with <strong>${escapeHtml(email)}</strong> to accept.</p>
<p>Blazly Team</p></div>`,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  return response.ok;
}

const ROUTES = {
  "GET /api/team": (who) => getTeam(who.uid),
  "POST /api/team/invite": async (who, body, req) => {
    const invite = await inviteMember(who.uid, body.email);
    const link = `${requestOrigin(req)}/?team=${invite.token}`;
    const emailed = await sendInviteEmail({ ...invite, link }).catch(() => false);
    return { email: invite.email, link, emailed };
  },
  "POST /api/team/remove": async (who, body) => {
    const team = await getTeam(who.uid);
    const target = String(body.uid || body.email || "").trim();
    const member = (team.members || []).find((m) => m.uid === target || m.email === target.toLowerCase());
    await removeMember(who.uid, member?.uid || target);
    if (member) await removeFromAllShares(who.uid, member.uid);
    return { ok: true };
  },
  "POST /api/team/accept": (who, body) => acceptInvite(who.uid, String(body.token || "")),
  "POST /api/team/leave": async (who) => {
    const { teamOwner } = await getCreditAccount(who.uid);
    await leaveTeam(who.uid);
    if (teamOwner) await removeFromAllShares(teamOwner, who.uid);
    return { ok: true };
  },
  "GET /api/projects": (who) => describeProjects(who.uid),
  "POST /api/projects/sync": (who, body) => syncProjects(who.uid, body.projects || body.names),
  "POST /api/projects/add": async (who, body) => {
    await ensureProject(who.uid, body.name, body.website);
    return { ok: true };
  },
  "POST /api/projects/remove": async (who, body) => {
    await removeProject(who.uid, body.name); // paid plans only
    await deleteProjectIntegrations(who.uid, String(body.name || ""));
    return { ok: true };
  },
  "POST /api/projects/edit": async (who, body) => {
    const result = await editProject(who.uid, { from: body.from, to: body.to, website: body.website });
    if (!result.unchanged) {
      if (result.name !== String(body.from || "").trim()) {
        await renameProjectIntegrations(who.uid, String(body.from || ""), result.name);
        await renameKeysProject(who.uid, String(body.from || ""), result.name);
      }
      if (result.websiteChanged) {
        // Connections were bound to the old URL; they must be re-made against the new site.
        for (const provider of ["wordpress", "webflow", "webhook", "google"]) {
          await setProvider(who.uid, result.name, provider, null);
        }
      }
    }
    return result;
  },
};

export function attachAccountRoutes(server) {
  server.middlewares.use(async (req, res, next) => {
    const path = (req.url || "").split("?")[0];
    const handler = ROUTES[`${req.method} ${path}`];
    if (!handler) return next();
    try {
      const who = await identify(req);
      if (!who) return sendJson(res, 401, { error: "Sign in first." });
      const body = req.method === "POST" ? await readJson(req) : {};
      return sendJson(res, 200, await handler(who, body, req));
    } catch (error) {
      return sendJson(res, error.status || 500, { error: error.message || "Request failed.", code: error.code, nextEditAt: error.nextEditAt, requiredPlan: error.requiredPlan, limit: error.limit });
    }
  });
}
