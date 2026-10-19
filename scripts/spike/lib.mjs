// Spike helpers: one cached GET to Qloo, results stored in .qloo-private/spike/ only.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const PRIV = join(ROOT, ".qloo-private/spike");
const CACHE = join(PRIV, "cache");
mkdirSync(CACHE, { recursive: true });

function loadEnv() {
  const env = {};
  for (const line of readFileSync(join(ROOT, ".env"), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}
const env = loadEnv();
const BASE = env.QLOO_BASE_URL;
const KEY = env.QLOO_API_KEY;
if (!BASE || !new URL(BASE).host.startsWith("hackathon.api.qloo.com")) throw new Error("QLOO_BASE_URL must be the hackathon host");
if (!KEY) throw new Error("QLOO_API_KEY missing");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Call budget. Default is cache-only: a cache miss throws unless QLOO_LIVE=1, and at most
// QLOO_BUDGET live calls are made per run (default 0). `--dry-run` counts misses without calling.
// Before any live run: dry-run first, show the count, get the user's OK.
const LIVE = process.env.QLOO_LIVE === "1";
const BUDGET = Number(process.env.QLOO_BUDGET ?? 0);
const DRY = process.argv.includes("--dry-run");
let liveCalls = 0;
const misses = new Set();
if (DRY) {
  process.on("exit", () => console.error(`[dry-run] ${misses.size} cache misses = ${misses.size} live calls needed`));
}
class CacheMiss extends Error {}
const emptyMiss = (method, url) => ({ method, url, status: 0, ms: 0, bytes: 0, headers: {}, body: null, cached: false, dryRun: true });

export function buildUrl(path, params = {}) {
  const u = new URL(path, BASE);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    u.searchParams.set(k, Array.isArray(v) ? v.join(",") : String(v));
  }
  return u.toString();
}

// Returns { status, ms, body, headers, cached }. Never throws on HTTP errors.
export async function q(path, params = {}, { method = "GET", body, noCache = false } = {}) {
  const url = buildUrl(path, params);
  const key = createHash("sha1").update(method + " " + url + (body ? JSON.stringify(body) : "")).digest("hex");
  const file = join(CACHE, key + ".json");
  if (existsSync(file) && (!noCache || !LIVE)) return { ...JSON.parse(readFileSync(file, "utf8")), cached: true };
  if (DRY) { misses.add(key); return emptyMiss(method, url); }
  if (!LIVE) throw new CacheMiss(`cache miss and QLOO_LIVE is not set: ${method} ${new URL(url).pathname} (run with --dry-run to count)`);
  if (liveCalls >= BUDGET) throw new CacheMiss(`QLOO_BUDGET=${BUDGET} exhausted`);
  liveCalls++;
  for (let attempt = 0; attempt < 4; attempt++) {
    const t0 = performance.now();
    const res = await fetch(url, {
      method,
      headers: { "X-Api-Key": KEY, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const ms = Math.round(performance.now() - t0);
    const text = await res.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = { _raw: text.slice(0, 500) }; }
    const headers = {};
    for (const [h, v] of res.headers) if (/rate|limit|quota|retry/i.test(h)) headers[h] = v;
    const rec = { method, url, status: res.status, ms, bytes: text.length, headers, body: parsed };
    if (res.status === 429) {
      appendLog({ ...rec, body: undefined, note: "429 retry " + attempt });
      await sleep(2000 * (attempt + 1));
      continue;
    }
    writeFileSync(file, JSON.stringify(rec));
    appendLog({ ...rec, body: undefined });
    return { ...rec, cached: false };
  }
  return { method, url, status: 429, ms: 0, body: null, headers: {}, cached: false };
}

function appendLog(rec) {
  writeFileSync(join(PRIV, "calls.log.jsonl"), JSON.stringify({ t: new Date().toISOString(), ...rec }) + "\n", { flag: "a" });
}

export const readPriv = (name) => JSON.parse(readFileSync(join(PRIV, name), "utf8"));
export const writePriv = (name, data) => writeFileSync(join(PRIV, name), JSON.stringify(data, null, 2));

export const ents = (r) => r?.body?.results?.entities ?? [];
export const tags = (r) => r?.body?.results?.tags ?? [];
export const ids = (list) => list.map((e) => e.entity_id ?? e.id ?? e.tag_id);
export const median = (xs) => {
  const s = xs.filter((x) => typeof x === "number").sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
export const jaccard = (a, b) => {
  const A = new Set(a), B = new Set(b);
  const inter = [...A].filter((x) => B.has(x)).length;
  const uni = new Set([...A, ...B]).size;
  return uni ? inter / uni : 1;
};
// Same ids in same order -> identical; used for silent-ignore detection.
export const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

export const DOMAINS = {
  music: "urn:entity:artist",
  film: "urn:entity:movie",
  tv: "urn:entity:tv_show",
  books: "urn:entity:book",
  places: "urn:entity:place",
  fashion: "urn:entity:brand",
};
