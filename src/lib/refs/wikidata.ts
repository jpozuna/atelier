// Small Wikidata client for the reference layer: wbgetentities by id, fetch-based, server-only. Wikidata data is
// CC0 (credit: "Data from Wikidata (CC0)"). Nothing here is a Qloo call. `fetch` is injected so tests never touch
// the network.
//
// Policy (researcher-verified): the User-Agent must carry real contact info, because an unidentified client is
// capped at about 10 requests a minute. Without a real ATELIER_CONTACT, Wikidata is skipped entirely (`no_contact`).
// Every request sends maxlag, requests are serial, and a 429, 503 or maxlag error blocks the whole process until
// its Retry-After has passed (module-level `blockedUntil`). A timeout, network failure or the run deadline blocks
// the rest of the run. Any failure returns nothing for that finalist: a missing lineage hop is always acceptable,
// a guessed one never is.
//
// Flow for one finalist: one request for its claims, then one batched request for the English labels of the related
// items found (a claim holds ids, not names). Both are cached by id; a cached finalist costs nothing. The per-run
// cap counts finalists looked up (REFS_LIMITS.WIKIDATA_MAX_LOOKUPS_PER_RUN), so a run makes at most 2 x 6 requests.

import "server-only";

import type { Field } from "@/types";
import { buildLineageRef, isWikidataId } from "./lineage";
import { REFS_LIMITS, USER_AGENT_PRODUCT, WIKIDATA_API_URL, WIKIDATA_ENTITY_URL, type RefsLimits } from "./limits";
import type { LineageRef, LineageRelation, WikidataStatus } from "./types";

/** The slice of `Response` the client uses. Tests pass a fake. */
export interface FetchResponseLike {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  headers?: { get(name: string): string | null };
}
export type FetchLike = (
  url: string,
  init: { headers: Record<string, string>; signal: AbortSignal },
) => Promise<FetchResponseLike>;

/** Wikidata properties read per field. Lineage for books and places is not offered (DECISIONS.md, 2026-10-19). */
const PROPERTIES: Partial<Record<Field, readonly { pid: string; relation: LineageRelation }[]>> = {
  film: [
    { pid: "P144", relation: "based_on" },
    { pid: "P737", relation: "influenced_by" },
    { pid: "P941", relation: "inspired_by" },
  ],
  tv: [
    { pid: "P144", relation: "based_on" },
    { pid: "P737", relation: "influenced_by" },
    { pid: "P941", relation: "inspired_by" },
  ],
  fashion: [
    { pid: "P737", relation: "influenced_by" },
    { pid: "P941", relation: "inspired_by" },
  ],
};

export const wikidataAppliesTo = (field: Field): boolean => PROPERTIES[field] !== undefined;

/** A resolved relation, kept in the cache without the hop wrapper. `names` is the full list. */
interface ResolvedRelation {
  relation: LineageRelation;
  names: string[];
}

export interface WikidataCache {
  get(key: string): ResolvedRelation[] | undefined;
  set(key: string, value: ResolvedRelation[], ttlMs: number): void;
}

/** In-memory TTL cache. A server process shares one by default; tests make their own. */
export function createMemoryCache(now: () => number = Date.now): WikidataCache {
  const map = new Map<string, { value: ResolvedRelation[]; expires: number }>();
  return {
    get(key) {
      const hit = map.get(key);
      if (!hit) return undefined;
      if (hit.expires <= now()) {
        map.delete(key);
        return undefined;
      }
      return hit.value;
    },
    set(key, value, ttlMs) {
      map.set(key, { value, expires: now() + ttlMs });
    },
  };
}

/** When Wikidata may be called again (epoch ms). One per process by default, so the next run does not retry at once. */
export interface BlockState {
  until: number;
}
const sharedBlock: BlockState = { until: 0 };
/** For tests that use the shared block. */
export function resetSharedBlock(): void {
  sharedBlock.until = 0;
}

export interface WikidataClientOptions {
  /** Defaults to the global `fetch`. */
  fetch?: FetchLike;
  /** Contact for the User-Agent. Defaults to env `ATELIER_CONTACT`. A missing or placeholder contact skips Wikidata. */
  contact?: string;
  cache?: WikidataCache;
  /** Defaults to a process-wide block. */
  block?: BlockState;
  limits?: Partial<RefsLimits>;
  now?: () => number;
}

export interface WikidataLookup {
  status: WikidataStatus;
  lineage: LineageRef[];
}

export interface WikidataClient {
  /** `lookup` never throws. `seedNames` only orders the names shown in a hop label. */
  lookup(id: string, field: Field, seedNames?: readonly string[]): Promise<WikidataLookup>;
  /** Null when there is no real contact: nothing is sent. */
  readonly userAgent: string | null;
  /** HTTP requests started so far (cache hits make none). */
  readonly requests: number;
  /** Finalists looked up so far against the per-run cap. */
  readonly lookups: number;
}

const sharedCache = createMemoryCache();

/** Header values must be one line of visible text. */
const clean = (s: string) => s.replace(/[^\x20-\x7e]+/g, " ").replace(/\s+/g, " ").trim();
const PLACEHOLDER = /^(your[-_ ]|<|changeme|placeholder|todo|xxx|none$|null$|undefined$)/i;

/** A real contact is an email or a URL, and not a placeholder such as `your-email@example.com`. */
export function isRealContact(contact: string): boolean {
  return /@|https?:\/\//i.test(contact) && !PLACEHOLDER.test(contact);
}

/** The User-Agent, or null when there is no real contact. There is no contactless fallback. */
export function buildUserAgent(contact?: string): string | null {
  const c = clean(contact ?? process.env.ATELIER_CONTACT ?? "");
  return c && isRealContact(c) ? `${USER_AGENT_PRODUCT} (${c})` : null;
}

export function entityUrl(ids: readonly string[], props: string, maxlag: number = REFS_LIMITS.WIKIDATA_MAXLAG_SECONDS): string {
  const p = new URLSearchParams({
    action: "wbgetentities",
    format: "json",
    ids: ids.join("|"),
    languages: "en",
    maxlag: String(maxlag),
    props,
  });
  return `${WIKIDATA_API_URL}?${p.toString()}`;
}

/** Retry-After as milliseconds: delta seconds or an HTTP date. Null when absent or unreadable. */
export function parseRetryAfter(value: string | null | undefined, now: number): number | null {
  if (!value) return null;
  const v = value.trim();
  if (/^\d+$/.test(v)) return Number(v) * 1000;
  const at = Date.parse(v);
  return Number.isNaN(at) ? null : Math.max(0, at - now);
}

class Unavailable extends Error {}

const asRecord = (v: unknown): Record<string, unknown> | undefined =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;

/** Related item ids in a claims block, in source order, skipping deprecated statements and non-item values. */
function targetIds(claims: unknown, pid: string, max: number): string[] {
  const list = asRecord(claims)?.[pid];
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  for (const st of list) {
    const s = asRecord(st);
    if (!s || s.rank === "deprecated") continue;
    const snak = asRecord(s.mainsnak);
    if (snak?.snaktype !== "value") continue;
    const id = asRecord(asRecord(snak.datavalue)?.value)?.id;
    if (isWikidataId(id) && !out.includes(id)) out.push(id);
    if (out.length >= max) break;
  }
  return out;
}

export function createWikidataClient(opts: WikidataClientOptions = {}): WikidataClient {
  const limits: RefsLimits = { ...REFS_LIMITS, ...opts.limits };
  const doFetch: FetchLike = opts.fetch ?? ((url, init) => fetch(url, init));
  const cache = opts.cache ?? sharedCache;
  const block = opts.block ?? sharedBlock;
  const now = opts.now ?? Date.now;
  const userAgent = buildUserAgent(opts.contact);
  const state = { requests: 0, lookups: 0, runBlocked: false, deadlineAt: null as number | null };
  const inflight = new Map<string, Promise<WikidataLookup>>();
  // Requests run one at a time: each lookup waits for the one before it.
  let queue: Promise<unknown> = Promise.resolve();

  function blockFor(retryAfterMs: number | null): void {
    const wait = Math.min(retryAfterMs ?? limits.WIKIDATA_DEFAULT_RETRY_MS, limits.WIKIDATA_MAX_RETRY_MS);
    block.until = Math.max(block.until, now() + wait);
    state.runBlocked = true;
  }

  async function getJson(url: string): Promise<Record<string, unknown>> {
    if (!userAgent) throw new Unavailable("no contact");
    if (state.runBlocked || now() < block.until) throw new Unavailable("blocked");
    state.deadlineAt ??= now() + limits.WIKIDATA_RUN_DEADLINE_MS;
    const remaining = state.deadlineAt - now();
    if (remaining <= 0) {
      state.runBlocked = true;
      throw new Unavailable("deadline");
    }
    state.requests += 1;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Unavailable("timeout"));
      }, Math.min(limits.WIKIDATA_TIMEOUT_MS, remaining));
    });
    try {
      const res = await Promise.race([
        doFetch(url, { headers: { "User-Agent": userAgent, Accept: "application/json" }, signal: controller.signal }),
        timeout,
      ]);
      if (res.status === 429 || res.status === 503) {
        blockFor(parseRetryAfter(res.headers?.get("retry-after"), now()));
        throw new Unavailable(`http ${res.status}`);
      }
      if (!res.ok) throw new Unavailable(`http ${res.status}`);
      const body = asRecord(await Promise.race([res.json(), timeout]));
      if (!body) throw new Unavailable("bad body");
      if (body.error) {
        // maxlag arrives as a 200 with an `error` member: the servers are lagging, so stop and back off.
        if (asRecord(body.error)?.code === "maxlag") blockFor(parseRetryAfter(res.headers?.get("retry-after"), now()));
        throw new Unavailable("api error");
      }
      return body;
    } catch (e) {
      // A timeout or network failure blocks the rest of this run (not the process).
      state.runBlocked = true;
      throw e instanceof Unavailable ? e : new Unavailable(e instanceof Error ? e.message : "fetch failed");
    } finally {
      clearTimeout(timer);
    }
  }

  async function fetchRelations(id: string, field: Field): Promise<ResolvedRelation[]> {
    const specs = PROPERTIES[field] ?? [];
    const claimsBody = await getJson(entityUrl([id], "claims", limits.WIKIDATA_MAXLAG_SECONDS));
    const claims = asRecord(asRecord(claimsBody.entities)?.[id])?.claims;
    const found = specs
      .map((s) => ({ ...s, ids: targetIds(claims, s.pid, limits.WIKIDATA_MAX_TARGETS_PER_PROPERTY) }))
      .filter((s) => s.ids.length > 0);
    if (found.length === 0) return [];
    const all = [...new Set(found.flatMap((s) => s.ids))];
    const labels = new Map<string, string>();
    for (let i = 0; i < all.length; i += limits.WIKIDATA_MAX_LABEL_IDS) {
      const body = await getJson(
        entityUrl(all.slice(i, i + limits.WIKIDATA_MAX_LABEL_IDS), "labels", limits.WIKIDATA_MAXLAG_SECONDS),
      );
      const entities = asRecord(body.entities);
      for (const qid of all.slice(i, i + limits.WIKIDATA_MAX_LABEL_IDS)) {
        const v = asRecord(asRecord(asRecord(entities?.[qid])?.labels)?.en)?.value;
        if (typeof v === "string" && v.trim()) labels.set(qid, v.replace(/\s+/g, " ").trim());
      }
    }
    const out: ResolvedRelation[] = [];
    for (const s of found) {
      // A related item with no English label is dropped, never shown as a bare id.
      const names = s.ids.map((q) => labels.get(q)).filter((n): n is string => n !== undefined);
      if (names.length > 0) out.push({ relation: s.relation, names });
    }
    return out;
  }

  const toRefs = (id: string, rels: ResolvedRelation[], seedNames: readonly string[]): LineageRef[] =>
    rels.flatMap((r) => {
      const ref = buildLineageRef("wikidata", r.relation, r.names, WIKIDATA_ENTITY_URL + id, seedNames);
      return ref ? [ref] : [];
    });

  function lookup(id: string, field: Field, seedNames: readonly string[] = []): Promise<WikidataLookup> {
    if (!wikidataAppliesTo(field)) return Promise.resolve({ status: "not_applicable", lineage: [] });
    if (!isWikidataId(id)) return Promise.resolve({ status: "no_id", lineage: [] });
    if (!userAgent) return Promise.resolve({ status: "no_contact", lineage: [] });
    const key = `lineage:${field}:${id}`;
    const hit = cache.get(key);
    if (hit) return Promise.resolve({ status: "cached", lineage: toRefs(id, hit, seedNames) });
    const running = inflight.get(key);
    if (running) return running.then((r) => (r.status === "ok" ? { status: "ok", lineage: reseed(r, seedNames) } : r));
    // Reserve the slot before any await so concurrent callers cannot overshoot the cap.
    if (state.lookups >= limits.WIKIDATA_MAX_LOOKUPS_PER_RUN) {
      return Promise.resolve({ status: "budget_exhausted", lineage: [] });
    }
    state.lookups += 1;
    const task = () =>
      fetchRelations(id, field).then(
        (rels): WikidataLookup => {
          cache.set(key, rels, limits.WIKIDATA_CACHE_TTL_MS);
          return { status: "ok", lineage: toRefs(id, rels, seedNames) };
        },
        (): WikidataLookup => ({ status: "unavailable", lineage: [] }),
      );
    const p = queue.then(task);
    queue = p;
    inflight.set(key, p);
    void p.finally(() => inflight.delete(key));
    return p;
  }

  /** A second caller sharing an in-flight lookup gets hops relabelled for its own seeds. */
  function reseed(r: WikidataLookup, seedNames: readonly string[]): LineageRef[] {
    return r.lineage.flatMap((l) => {
      const ref = buildLineageRef("wikidata", l.relation, l.allNames, l.hop.sourceUrl ?? "", seedNames);
      return ref ? [ref] : [];
    });
  }

  return {
    lookup,
    userAgent,
    get requests() {
      return state.requests;
    },
    get lookups() {
      return state.lookups;
    },
  };
}
