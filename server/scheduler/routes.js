import { readJson as sharedReadJson } from "../readJson.js";
import { identify } from "../credits/middleware.js";
import crypto from "crypto";
import { cancelJob, createJob, listUserJobs, resolveBaseUrl, startScheduler, tick } from "./index.js";

function readJson(req) {
  return sharedReadJson(req, { maxBytes: 2_000_000 });
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

async function requireAuth(req) {
  const who = await identify(req);
  if (!who) throw Object.assign(new Error("Sign in to manage scheduled tasks."), { status: 401 });
  return who.uid;
}

function cronAuthorized(req) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const header = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "") || String(req.headers["x-cron-secret"] || "");
  const a = Buffer.from(header);
  const b = Buffer.from(secret);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function attachScheduler(server) {
  startScheduler(server);

  server.middlewares.use(async (req, res, next) => {
    const [path, query = ""] = (req.url || "").split("?");
    if (!path.startsWith("/api/schedules") && path !== "/api/scheduler/tick") return next();
    const params = new URLSearchParams(query);

    try {
      if (path === "/api/scheduler/tick" && req.method === "POST") {
        if (!cronAuthorized(req)) {
          sendJson(res, 401, { error: "Unauthorized." });
          return;
        }
        sendJson(res, 200, await tick(resolveBaseUrl(server)));
        return;
      }

      if (path === "/api/schedules" && req.method === "GET") {
        const uid = (await requireAuth(req));
        sendJson(res, 200, { jobs: await listUserJobs(uid, params.get("project") || "") });
        return;
      }

      if (path === "/api/schedules" && req.method === "POST") {
        const body = await readJson(req);
        sendJson(res, 200, { job: await createJob({ ...body, uid: await requireAuth(req) }) });
        return;
      }

      if (path === "/api/schedules/cancel" && req.method === "POST") {
        const body = await readJson(req);
        sendJson(res, 200, { job: await cancelJob((await requireAuth(req)), String(body.id || "")) });
        return;
      }

      next();
    } catch (error) {
      sendJson(res, error.status || 400, { error: error.message || "Scheduler request failed.", code: error.code });
    }
  });
}
