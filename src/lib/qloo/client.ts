// The one door to Qloo. Every Qloo request in Atelier goes through createQlooClient(); no other module may
// call fetch against Qloo. Server-side only: the key is read from the environment here and sent only in the
// X-Api-Key header.
//
// Request path: validate params against the registry -> normalize and hash -> cache (replay, record) ->
// singleflight -> budget guards -> rate-limited fetch with 429 backoff -> strip, parse, store -> trace event.

import "server-only";

import {
  QlooBudgetError,
  QlooCacheMissError,
  QlooConfigError,
  QlooError,
  QlooHttpError,
  QlooNetworkError,
  QlooParamError,
  QlooParseError,
} from "./errors";
import { CACHE_ENTRY_VERSION, requestKey, stripBody, type QlooCacheAdapter } from "./cache";
import { createDefaultCache } from "./cache-select";
import { LIMITS, QLOO_HOST, type QlooLimits } from "./limits";
import {
  emptyDiagnosis,
  httpErrorFor,
  isNoResultsBody,
  parseFlatEntities,
  parseInsightsEntities,
  parseTags,
  parseTasteAnalysis,
  type Parsed,
} from "./parse";
import { ENTITIES_ENDPOINT, INSIGHTS_PATH, REGISTRY, SEARCH_ENDPOINT, TAGS_ENDPOINT, type Registry } from "./registry";
import { buildCallEvent } from "./trace";
import type {
  CallMeta,
  CallSource,
  ClientStats,
  EntitiesParams,
  HttpMethod,
  InsightsEntity,
  InsightsPurpose,
  InsightsParams,
  QlooEndpoint,
  QlooMode,
  QlooParams,
  QlooResponse,
  SearchItem,
  SearchParams,
  TagItem,
  TagsParams,
  TasteAnalysisParams,
  TasteTag,
  TraceSink,
} from "./types";
import {
  encodeQuery,
  normalizeParams,
  prepareEntities,
  prepareInsights,
  prepareSearch,
  prepareTags,
  prepareTasteAnalysis,
  type PreparedRequest,
} from "./validate";
import { redactParams } from "./trace";

const ALLOWED_PATHS: readonly string[] = [SEARCH_ENDPOINT.path, ENTITIES_ENDPOINT.path, TAGS_ENDPOINT.path, INSIGHTS_PATH];
const MODES: readonly QlooMode[] = ["replay", "record", "live"];

type Env = Record<string, string | undefined>;
type Sleep = (ms: number) => Promise<void>;

/** Process-wide state shared by every client in the process: the concurrency limiter, in-flight calls, and the
 *  last known monthly quota. The per-run live-call counter is NOT here; it belongs to each client. */
export interface SharedState {
  limiter: Limiter;
  inflight: Map<string, Promise<LiveResult>>;
  remaining: number | null;
}

export interface QlooClientOptions {
  /** replay (default), record or live. Falls back to env QLOO_MODE. */
  mode?: QlooMode;
  /** Where stripped responses are stored. Default: see cache-select.ts (QLOO_CACHE; Supabase in production, else files under .qloo-private/cache/). null disables caching. */
  cache?: QlooCacheAdapter | null;
  /** Receives one `qloo_call` event per call, including refusals and failures. Errors thrown by the sink are ignored. */
  onTrace?: TraceSink;
  /** HTTP method for taste analysis. GET (default) has every param confirmed by the spike. POST needs the body gate. */
  tasteAnalysisMethod?: HttpMethod;
  // Test seams. Production code should not set these.
  env?: () => Env;
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: Sleep;
  limits?: Partial<QlooLimits>;
  shared?: SharedState;
  registry?: Registry;
}

export interface QlooClient {
  /** GET /search. A no-match query returns outcome "empty". */
  search(params: SearchParams): Promise<QlooResponse<SearchItem>>;
  /** GET /entities. */
  entities(params: EntitiesParams): Promise<QlooResponse<SearchItem>>;
  /** GET /v2/tags. */
  tags(params: TagsParams): Promise<QlooResponse<TagItem>>;
  /** Taste analysis: /v2/insights with filter.type=urn:tag. One call for all seeds. */
  tasteAnalysis(params: TasteAnalysisParams): Promise<QlooResponse<TasteTag>>;
  /**
   * POST /v2/insights with a JSON body. Seeds go as [{id, weight}] (repeated ids collapse to the max weight).
   * With `purpose: "picks"`, filter.exclude.entities must include every seed id, or the call is refused.
   */
  insights(params: InsightsParams, opts?: { purpose?: InsightsPurpose }): Promise<QlooResponse<InsightsEntity>>;
  mode: QlooMode;
  stats(): ClientStats;
}

// ---------------------------------------------------------------------------------------------------------
// Concurrency limiter: at most `max` in flight, request starts spaced by `minIntervalMs`.

export class Limiter {
  private active = 0;
  private waiting: (() => void)[] = [];
  private nextStart = 0;
  constructor(
    private readonly max: number,
    private readonly minIntervalMs: number,
    private readonly now: () => number,
    private readonly sleep: Sleep,
  ) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) await new Promise<void>((resolve) => this.waiting.push(resolve));
    else this.active++;
    try {
      const startAt = Math.max(this.now(), this.nextStart);
      this.nextStart = startAt + this.minIntervalMs;
      const wait = startAt - this.now();
      if (wait > 0) await this.sleep(wait);
      return await fn();
    } finally {
      const next = this.waiting.shift();
      if (next) next(); // hand the slot over without releasing it
      else this.active--;
    }
  }
}

function headerNumber(raw: string | null): number | undefined {
  if (raw === null || raw.trim() === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

const realSleep: Sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createSharedState(limits: QlooLimits = LIMITS, now: () => number = Date.now, sleep: Sleep = realSleep): SharedState {
  return { limiter: new Limiter(limits.MAX_IN_FLIGHT, limits.MIN_REQUEST_INTERVAL_MS, now, sleep), inflight: new Map(), remaining: null };
}

let defaultShared: SharedState | undefined;

// ---------------------------------------------------------------------------------------------------------

/** The base URL must be exactly the hackathon host. Staging and production return 401 with this key. */
export function resolveBaseUrl(raw: string | undefined): URL {
  if (!raw) throw new QlooConfigError("QLOO_BASE_URL is not set");
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new QlooConfigError(`QLOO_BASE_URL is not a valid URL; it must be https://${QLOO_HOST}`);
  }
  const bare = u.pathname === "/" || u.pathname === "";
  if (u.protocol !== "https:" || u.hostname !== QLOO_HOST || u.port || u.username || u.password || !bare || u.search || u.hash) {
    throw new QlooConfigError(`QLOO_BASE_URL must be exactly https://${QLOO_HOST} (other hosts return 401)`);
  }
  return u;
}

export function parseMode(raw: string | undefined): QlooMode {
  if (raw === undefined || raw === "") return "replay";
  if ((MODES as readonly string[]).includes(raw)) return raw as QlooMode;
  throw new QlooConfigError(`QLOO_MODE must be replay, record or live (got "${raw}")`);
}

interface LiveResult {
  status: number;
  /** Stripped body (null for a 404 empty). */
  body: unknown;
  ms: number;
}

type Kind = "flat" | "insights" | "tags" | "taste";

function kindOf(req: PreparedRequest): Kind {
  if (req.endpoint === "/search" || req.endpoint === "/entities") return "flat";
  if (req.endpoint === "/v2/tags") return "tags";
  return req.entityType === REGISTRY.tagInsights.urn ? "taste" : "insights";
}

function parseFor(req: PreparedRequest, status: number, body: unknown): { parsed: Parsed<unknown>; diagKind: "entity" | "tag" | "search" } {
  const kind = kindOf(req);
  if (status === 404) return { parsed: { items: [], dropped: 0 }, diagKind: kind === "tags" || kind === "taste" ? "tag" : "search" };
  switch (kind) {
    case "flat":
      return { parsed: parseFlatEntities(req.endpoint, body), diagKind: "search" };
    case "insights":
      return { parsed: parseInsightsEntities(body), diagKind: "entity" };
    case "tags":
      return { parsed: parseTags(body), diagKind: "tag" };
    case "taste":
      return { parsed: parseTasteAnalysis(body), diagKind: "tag" };
  }
}

export function createQlooClient(options: QlooClientOptions = {}): QlooClient {
  const getEnv: () => Env = options.env ?? (() => process.env as Env);
  const mode = options.mode ?? parseMode(getEnv().QLOO_MODE);
  const limits: QlooLimits = { ...LIMITS, ...options.limits };
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? realSleep;
  const fetchImpl = options.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const registry = options.registry ?? REGISTRY;
  const cache: QlooCacheAdapter | null = options.cache === undefined ? createDefaultCache(getEnv()) : options.cache;
  const tasteMethod: HttpMethod = options.tasteAnalysisMethod ?? "GET";
  const shared =
    options.shared ?? (options.limits || options.now || options.sleep ? createSharedState(limits, now, sleep) : (defaultShared ??= createSharedState()));

  // Run-scoped counters.
  let liveCalls = 0;
  let httpAttempts = 0;
  let cacheHits = 0;
  let sharedCalls = 0;

  function emit(event: ReturnType<typeof buildCallEvent>) {
    try {
      options.onTrace?.(event);
    } catch {
      // A broken sink must not break a call.
    }
  }

  function budgetGuards(endpoint: QlooEndpoint, env: Env) {
    if (liveCalls >= limits.MAX_LIVE_CALLS_PER_RUN) {
      throw new QlooBudgetError(
        endpoint,
        "run_limit",
        `Qloo ${endpoint}: refused live call number ${liveCalls + 1}; this run is capped at ${limits.MAX_LIVE_CALLS_PER_RUN}`,
      );
    }
    const reserveRaw = env.QLOO_RESERVE;
    const reserve = reserveRaw === undefined || reserveRaw === "" ? limits.DEFAULT_RESERVE : Number(reserveRaw);
    if (!Number.isFinite(reserve) || reserve < 0) throw new QlooConfigError("QLOO_RESERVE must be a non-negative number");
    if (shared.remaining !== null && shared.remaining < reserve && env.ATELIER_DEMO !== "1") {
      throw new QlooBudgetError(
        endpoint,
        "reserve",
        `Qloo ${endpoint}: refused live call; ${shared.remaining} monthly calls remain, below the reserve of ${reserve}. Serve the cache, or set ATELIER_DEMO=1 in the deployed demo.`,
      );
    }
  }

  function backoffMs(attempt: number, retryAfterSec?: number): number {
    if (retryAfterSec !== undefined && Number.isFinite(retryAfterSec) && retryAfterSec >= 0) return Math.min(limits.BACKOFF_CAP_MS, retryAfterSec * 1000);
    return Math.min(limits.BACKOFF_CAP_MS, limits.BACKOFF_BASE_MS * 2 ** attempt);
  }

  async function liveFetch(req: PreparedRequest, key: string): Promise<LiveResult> {
    const env = getEnv();
    const base = resolveBaseUrl(env.QLOO_BASE_URL);
    const apiKey = env.QLOO_API_KEY;
    if (!apiKey) throw new QlooConfigError("QLOO_API_KEY is not set");
    if (!ALLOWED_PATHS.includes(req.endpoint)) throw new QlooConfigError(`refusing path ${req.endpoint}`);
    budgetGuards(req.endpoint, env);
    liveCalls++;

    const url = new URL(req.endpoint, base);
    const headers: Record<string, string> = { "X-Api-Key": apiKey, Accept: "application/json" };
    let body: string | undefined;
    if (req.method === "GET") url.search = encodeQuery(req.params);
    else {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(req.params);
    }

    for (let attempt = 0; ; attempt++) {
      httpAttempts++;
      const t0 = now();
      let status: number;
      let text: string;
      let retryAfter: number | undefined;
      try {
        ({ status, text, retryAfter } = await shared.limiter.run(async () => {
          const res = await fetchImpl(url, {
            method: req.method,
            headers,
            body,
            cache: "no-store",
            // A redirect would carry X-Api-Key to another origin. Never follow one.
            redirect: "error",
            signal: AbortSignal.timeout(limits.REQUEST_TIMEOUT_MS),
          });
          // An empty or non-numeric header means "unknown", never 0.
          const remaining = headerNumber(res.headers.get("x-month-ratelimit-remaining"));
          if (remaining !== undefined) shared.remaining = remaining;
          return { status: res.status, text: await res.text(), retryAfter: headerNumber(res.headers.get("retry-after")) };
        }));
      } catch (e) {
        if (e instanceof QlooError) throw e;
        const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
        throw new QlooNetworkError(req.endpoint, timedOut ? `timed out after ${limits.REQUEST_TIMEOUT_MS} ms` : "request failed", e);
      }
      const ms = now() - t0;

      if (status === 429) {
        if (attempt < limits.MAX_429_RETRIES) {
          await sleep(backoffMs(attempt, retryAfter));
          continue;
        }
        throw httpErrorFor(req.endpoint, status, text, retryAfter);
      }
      let stored: unknown = null;
      if (status === 404 && (req.endpoint === "/search" || req.endpoint === "/entities") && isNoResultsBody(text)) {
        // "No results" ({code, reason, message}): not a failure. Stored too, so a repeat costs nothing.
      } else {
        if (status < 200 || status >= 300) throw httpErrorFor(req.endpoint, status, text, retryAfter);
        let json: unknown;
        try {
          json = JSON.parse(text);
        } catch {
          throw new QlooParseError(req.endpoint, "200 response was not JSON");
        }
        stored = stripBody(json);
        parseFor(req, status, stored); // validate the envelope before it can be cached
      }
      if (cache) {
        try {
          await cache.set({ v: CACHE_ENTRY_VERSION, key, endpoint: req.endpoint, method: req.method, status, body: stored, createdAt: new Date(now()).toISOString() });
        } catch {
          // A failed cache write costs a future call, not this one.
        }
      }
      return { status, body: stored, ms };
    }
  }

  async function execute(req: PreparedRequest): Promise<QlooResponse<unknown>> {
    const t0 = now();
    const key = requestKey(req);
    let source: CallSource = "live";
    let status = 0;
    try {
      let result: LiveResult | undefined;
      let cacheReadError: unknown;
      if (mode !== "live" && cache) {
        try {
          const hit = await cache.get(key);
          if (hit) {
            result = { status: hit.status, body: hit.body, ms: 0 };
            source = "cache";
            cacheHits++;
          }
        } catch (e) {
          cacheReadError = e;
        }
      }
      if (!result) {
        if (mode === "replay") throw new QlooCacheMissError(req.endpoint, key, cacheReadError);
        const flight = shared.inflight.get(key);
        let followed: LiveResult | undefined;
        if (flight) {
          try {
            followed = await flight;
          } catch (e) {
            // A guard error (budget, config) belongs to the leader's client, not to this request. Evaluate our
            // own guards instead of inheriting it. Any other failure (HTTP, parse, network) is shared.
            if (!(e instanceof QlooBudgetError || e instanceof QlooConfigError)) throw e;
            if (shared.inflight.get(key) === flight) shared.inflight.delete(key);
          }
        }
        if (followed) {
          result = followed;
          source = "shared";
          sharedCalls++;
        } else {
          const p = liveFetch(req, key);
          shared.inflight.set(key, p);
          try {
            result = await p;
          } finally {
            if (shared.inflight.get(key) === p) shared.inflight.delete(key);
          }
          source = "live";
        }
      }
      status = result.status;
      const { parsed, diagKind } = parseFor(req, result.status, result.body);
      const empty = parsed.items.length === 0;
      const meta: CallMeta = {
        endpoint: req.endpoint,
        method: req.method,
        requestKey: key,
        cached: source !== "live",
        source,
        status,
        ms: source === "live" ? result.ms : now() - t0,
        remaining: shared.remaining,
      };
      const response: QlooResponse<unknown> = { outcome: empty ? "empty" : "ok", items: parsed.items, meta };
      if (parsed.query) response.query = parsed.query;
      if (parsed.dropped) response.droppedItems = parsed.dropped;
      if (empty) response.diagnosis = emptyDiagnosis(req.endpoint, diagKind, parsed.dropped);
      emit(
        buildCallEvent({
          now: new Date(now()), req, endpointFallback: req.endpoint, methodFallback: req.method,
          cached: meta.cached, source, status: source === "live" ? status : undefined, ms: meta.ms, outcome: response.outcome,
          resultCount: parsed.items.length, droppedItems: parsed.dropped, runLiveCalls: liveCalls, mode, requestKey: key,
        }),
      );
      return response;
    } catch (e) {
      const err = e instanceof QlooError ? e : new QlooError("network", "unexpected failure", { endpoint: req.endpoint, cause: e });
      emit(
        buildCallEvent({
          now: new Date(now()), req, endpointFallback: req.endpoint, methodFallback: req.method,
          cached: false, source: "none", status: err instanceof QlooHttpError ? err.status : undefined, ms: now() - t0,
          outcome: "error", errorKind: err.kind, runLiveCalls: liveCalls, mode, requestKey: key,
        }),
      );
      throw err;
    }
  }

  async function call(endpoint: QlooEndpoint, method: HttpMethod, raw: QlooParams, prepare: () => PreparedRequest): Promise<QlooResponse<unknown>> {
    let req: PreparedRequest;
    try {
      req = prepare();
    } catch (e) {
      if (e instanceof QlooParamError) {
        emit(
          buildCallEvent({
            now: new Date(now()), endpointFallback: endpoint, methodFallback: method,
            rawParamsRedacted: redactParams(normalizeParams(raw)),
            cached: false, source: "none", ms: 0, outcome: "error", errorKind: e.kind, runLiveCalls: liveCalls, mode,
          }),
        );
      }
      throw e;
    }
    return execute(req);
  }

  return {
    mode,
    search: (p) => call("/search", "GET", p, () => prepareSearch(p)) as Promise<QlooResponse<SearchItem>>,
    entities: (p) => call("/entities", "GET", p, () => prepareEntities(p)) as Promise<QlooResponse<SearchItem>>,
    tags: (p) => call("/v2/tags", "GET", p, () => prepareTags(p)) as Promise<QlooResponse<TagItem>>,
    tasteAnalysis: (p) => call(INSIGHTS_PATH, tasteMethod, p, () => prepareTasteAnalysis(p, tasteMethod, registry)) as Promise<QlooResponse<TasteTag>>,
    insights: (p, o) => call(INSIGHTS_PATH, "POST", p, () => prepareInsights(p, registry, { purpose: o?.purpose })) as Promise<QlooResponse<InsightsEntity>>,
    stats: () => ({ liveCalls, httpAttempts, cacheHits, sharedCalls, remaining: shared.remaining }),
  };
}
