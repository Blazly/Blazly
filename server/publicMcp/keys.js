import fs from "fs/promises";
import path from "path";
import crypto from "crypto";

const DIR = () => process.env.MCP_KEYS_DIR?.trim() || path.join(process.cwd(), ".mcp-keys");
const FILE = () => path.join(DIR(), "keys.json");
const MAX_KEYS_PER_USER = 20;

let queue = Promise.resolve();

function withLock(fn) {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

async function readKeys() {
  try {
    const data = JSON.parse(await fs.readFile(FILE(), "utf8"));
    return Array.isArray(data.keys) ? data.keys : [];
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function writeKeys(keys) {
  await fs.mkdir(DIR(), { recursive: true });
  const tmp = `${FILE()}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify({ keys }, null, 2), { mode: 0o600 });
  await fs.rename(tmp, FILE());
}

function hashKey(key) {
  return crypto.createHash("sha256").update(key).digest("hex");
}

function fail(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

function trimKnowledge(knowledge) {
  if (!knowledge || typeof knowledge !== "object") return null;
  if (JSON.stringify(knowledge).length <= 60_000) return knowledge;
  const { companyName, brandName, website, summary, description, audience, tone, products, services } = knowledge;
  return { companyName, brandName, website, summary, description, audience, tone, products, services };
}

export function publicKey(record) {
  return {
    id: record.id,
    name: record.name,
    project: record.project,
    prefix: record.prefix,
    createdAt: record.createdAt,
    lastUsedAt: record.lastUsedAt || null,
  };
}

/** Returns the plaintext key once; only its hash is stored. */
export async function createApiKey({ uid, project, name, website, brandName, knowledge }) {
  if (!uid) throw fail("Sign in to create an API key.", 401);
  const key = `blz_${crypto.randomBytes(24).toString("base64url")}`;
  const record = {
    id: `key_${crypto.randomBytes(6).toString("hex")}`,
    hash: hashKey(key),
    prefix: `${key.slice(0, 10)}…`,
    uid,
    project: String(project || "").trim() || "default",
    name: String(name || "").trim().slice(0, 60) || "AI assistant",
    website: String(website || "").trim(),
    brandName: String(brandName || "").trim(),
    knowledge: trimKnowledge(knowledge),
    createdAt: new Date().toISOString(),
  };
  await withLock(async () => {
    const keys = await readKeys();
    if (keys.filter((k) => k.uid === uid).length >= MAX_KEYS_PER_USER) {
      throw fail(`You can have up to ${MAX_KEYS_PER_USER} keys. Revoke one first.`);
    }
    await writeKeys([...keys, record]);
  });
  return { key, record: publicKey(record) };
}

export async function listApiKeys(uid, project) {
  const keys = await readKeys();
  return keys.filter((k) => k.uid === uid && (!project || k.project === project)).map(publicKey);
}

export async function revokeApiKey(uid, id) {
  await withLock(async () => {
    const keys = await readKeys();
    if (!keys.some((k) => k.id === id && k.uid === uid)) throw fail("Key not found.", 404);
    await writeKeys(keys.filter((k) => !(k.id === id && k.uid === uid)));
  });
}

export async function renameKeysProject(uid, from, to) {
  await withLock(async () => {
    const keys = await readKeys();
    await writeKeys(keys.map((k) => (k.uid === uid && k.project === from ? { ...k, project: to } : k)));
  });
}

export async function resolveApiKey(key) {
  if (!/^blz_[A-Za-z0-9_-]{20,}$/.test(String(key || ""))) return null;
  const hash = hashKey(key);
  const keys = await readKeys();
  const record = keys.find((k) => k.hash.length === hash.length && crypto.timingSafeEqual(Buffer.from(k.hash), Buffer.from(hash)));
  if (!record) return null;
  const now = Date.now();
  if (!record.lastUsedAt || now - new Date(record.lastUsedAt).getTime() > 5 * 60 * 1000) {
    withLock(async () => {
      const all = await readKeys();
      await writeKeys(all.map((k) => (k.id === record.id ? { ...k, lastUsedAt: new Date(now).toISOString() } : k)));
    }).catch(() => {});
  }
  return record;
}
