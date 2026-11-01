import { ensureProject } from "../billing/projects.js";
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";

const DIR = path.join(process.cwd(), ".integrations");
const KEY_FILE = path.join(DIR, ".key");

let cachedKey = null;

async function encryptionKey() {
  if (cachedKey) return cachedKey;
  const secret = process.env.INTEGRATIONS_SECRET?.trim();
  if (secret) {
    cachedKey = crypto.createHash("sha256").update(secret).digest();
    return cachedKey;
  }
  await fs.mkdir(DIR, { recursive: true });
  try {
    cachedKey = Buffer.from((await fs.readFile(KEY_FILE, "utf8")).trim(), "hex");
  } catch {
    cachedKey = crypto.randomBytes(32);
    await fs.writeFile(KEY_FILE, cachedKey.toString("hex"), { mode: 0o600 });
  }
  return cachedKey;
}

function fileFor(uid) {
  const id = crypto.createHash("sha256").update(String(uid)).digest("hex").slice(0, 32);
  return path.join(DIR, `${id}.json.enc`);
}

async function readAll(uid) {
  try {
    const raw = await fs.readFile(fileFor(uid));
    const key = await encryptionKey();
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const json = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
    return JSON.parse(json);
  } catch {
    return { projects: {} };
  }
}

async function writeAll(uid, data) {
  await fs.mkdir(DIR, { recursive: true });
  const key = await encryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(data), "utf8"), cipher.final()]);
  await fs.writeFile(fileFor(uid), Buffer.concat([iv, cipher.getAuthTag(), body]), { mode: 0o600 });
}

export async function getProjectIntegrations(uid, project) {
  if (!uid) return {};
  const all = await readAll(uid);
  return all.projects?.[project || "default"] || {};
}

export async function updateProjectIntegrations(uid, project, updater) {
  if (!uid) throw new Error("Sign in to manage integrations.");
  await ensureProject(uid, project);
  const all = await readAll(uid);
  all.projects = all.projects || {};
  const key = project || "default";
  const next = updater({ ...(all.projects[key] || {}) });
  all.projects[key] = next;
  await writeAll(uid, all);
  return next;
}

export async function renameProjectIntegrations(uid, from, to) {
  if (!uid) throw new Error("Sign in to manage integrations.");
  const all = await readAll(uid);
  all.projects = all.projects || {};
  if (!from || !to || from === to || !all.projects[from]) return;
  all.projects[to] = { ...(all.projects[to] || {}), ...all.projects[from] };
  delete all.projects[from];
  await writeAll(uid, all);
}

export async function deleteProjectIntegrations(uid, project) {
  if (!uid) throw new Error("Sign in to manage integrations.");
  const all = await readAll(uid);
  if (!all.projects?.[project]) return;
  delete all.projects[project];
  await writeAll(uid, all);
}

export async function setProvider(uid, project, provider, value) {
  return updateProjectIntegrations(uid, project, (current) => {
    if (value == null) delete current[provider];
    else current[provider] = { ...(current[provider] || {}), ...value };
    return current;
  });
}
