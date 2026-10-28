// Live suite "smoke-run": ONE end-to-end run through the real client, then the code scorers over what it recorded.
//
//   seeds     read at run time from .qloo-private/spike/resolved.json (already-resolved entity ids: 0 /search calls).
//             They stay in memory and in .qloo-private/; nothing from that file is copied into a tracked path.
//   profile   buildProfile: ONE taste-analysis call. The seeds carry a synthetic "why" and no why tags, so there is no
//             /v2/tags call. Axes are named by the deterministic namer (no model call).
//   run       runAgent over all six fields: at most one pool each, at most MAX_REQUERIES_PER_RUN re-queries.
//   budget    1 + 6 + 2 = 9 Qloo calls at most, through ONE client (so its per-run cap of MAX_LIVE_CALLS_PER_RUN holds).
//             Mode is "record": every response is cached privately, so a repeat run costs 0 live calls.
//             Anthropic: at most LLM_MAX_CALLS_PER_RUN, or none without ANTHROPIC_API_KEY (the loop then falls back).
//   output    <outDir>/<timestamp>/: trace.jsonl, result.json (server-side RunResult, WITH the audit block), profile.json,
//             summary.json (scorer names and pass or fail only). All of it is Qloo data: it belongs under .qloo-private/.
//   scoring   every registered trace scorer runs over the trace and result as one case with `live: true`, so a check
//             that cannot be verified from the recording fails instead of passing with a note.
//
// The POST body gate (registry POST_BODY.confirmedBodyParams) opened on 2026-10-28 after scripts/spike/04-post-check.mjs.
// This suite still checks it first, before any call, and says so if a registry change ever closes it again.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import type { Field, TraceEvent } from "@/types";
import { FIELDS } from "@/types";
import { LLM_MAX_CALLS_PER_RUN, MAX_REQUERIES_PER_RUN, MAX_SEEDS_PER_USER, POOL_POPULARITY_MAX, POOL_TAKE } from "@/lib/agent/config";
import { createLlm, createLlmCache, type Llm } from "@/lib/agent/llm";
import { runAgent } from "@/lib/agent/loop";
import type { RunDeps, RunResult } from "@/lib/agent/types";
import type { QlooCacheAdapter } from "@/lib/qloo/cache";
import { createQlooClient, type QlooClientOptions } from "@/lib/qloo/client";
import { QlooConfigError, QlooParamError } from "@/lib/qloo/errors";
import { REGISTRY, type Registry } from "@/lib/qloo/registry";
import { prepareInsights } from "@/lib/qloo/validate";
import { buildProfile } from "@/lib/profile/build";
import { fallbackNamer } from "@/lib/profile/naming";
import type { ProfileSeed } from "@/lib/profile/types";
import { createRefsContext, type RefsContext } from "@/lib/refs";
import type { LiveSuite } from "../harness/live";
import { repoRoot } from "../harness/repo";
import type { CaseInput, LoadedCase } from "../harness/types";
import { runEvals } from "../run";
import { SCORERS } from "../scorers";

type Env = Record<string, string | undefined>;

/** Qloo calls the run may make: one taste analysis, one pool per field, and the re-queries. */
export const SMOKE_EXPECTED_CALLS = 1 + FIELDS.length + MAX_REQUERIES_PER_RUN;

/** Where the spike left its resolved seeds, relative to the repo root. */
export const RESOLVED_SEEDS_PATH = ".qloo-private/spike/resolved.json";

const SMOKE_WHY = "Synthetic reason for the smoke run.";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The spike calls the food and places field "places". */
const SPIKE_FIELD: Readonly<Record<string, Field>> = { music: "music", film: "film", tv: "tv", books: "books", places: "food_places", fashion: "fashion" };

export type SmokeSetupCode = "missing_resolved" | "bad_resolved" | "no_seeds" | "picks_not_enabled" | "config" | "run_failed" | "scorers_failed" | "bad_out_dir";

/** A setup or run failure with a fixed code and a message safe to print (no ids, no names, no keys). */
export class SmokeError extends Error {
  constructor(
    readonly code: SmokeSetupCode,
    message: string,
  ) {
    super(message);
    this.name = "SmokeError";
  }
}

export const expectedAnthropicCalls = (env: Env): number => (env.ANTHROPIC_API_KEY?.trim() ? LLM_MAX_CALLS_PER_RUN : 0);

// ---- seeds ------------------------------------------------------------------------------------------------------

/**
 * Seeds from the spike's resolved.json (`{ resolved: { <field>: [{ query, status, entity_id, name }] } }`). Entries with
 * no entity id or status "missing" are skipped. Clean entries come first, taken round-robin across fields so every
 * field with a seed is represented, up to MAX_SEEDS_PER_USER. Each is a clean seed with a synthetic why.
 */
export function loadResolvedSeeds(path: string): ProfileSeed[] {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    throw new SmokeError(
      "missing_resolved",
      `No resolved seeds at ${RESOLVED_SEEDS_PATH}. That file comes from the spike's resolve step (scripts/spike/01-resolve.mjs, which makes live /search calls: run it with --dry-run and get the user's OK first). The smoke run needs it so it can skip all /search calls. Nothing was called.`,
    );
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new SmokeError("bad_resolved", `${RESOLVED_SEEDS_PATH} is not valid JSON. Re-run scripts/spike/01-resolve.mjs. Nothing was called.`);
  }
  const resolved = (json as { resolved?: unknown } | null)?.resolved;
  if (typeof resolved !== "object" || resolved === null || Array.isArray(resolved)) {
    throw new SmokeError("bad_resolved", `${RESOLVED_SEEDS_PATH} has no "resolved" object keyed by field. Re-run scripts/spike/01-resolve.mjs. Nothing was called.`);
  }

  const perField: { field: Field; clean: ProfileSeed[]; other: ProfileSeed[] }[] = [];
  let n = 0;
  for (const [key, entries] of Object.entries(resolved)) {
    const field = SPIKE_FIELD[key];
    if (!field || !Array.isArray(entries)) continue;
    const bucket = { field, clean: [] as ProfileSeed[], other: [] as ProfileSeed[] };
    for (const e of entries) {
      const entry = e as { query?: unknown; status?: unknown; entity_id?: unknown };
      if (typeof entry?.entity_id !== "string" || !UUID.test(entry.entity_id) || entry.status === "missing") continue;
      n += 1;
      const seed: ProfileSeed = {
        id: `seed-${n}`,
        field,
        typed: typeof entry.query === "string" && entry.query.trim() ? entry.query.trim() : `Seed ${n}`,
        why: SMOKE_WHY,
        qlooId: entry.entity_id,
        status: "clean",
      };
      (entry.status === "clean" ? bucket.clean : bucket.other).push(seed);
    }
    perField.push(bucket);
  }

  const queues = perField.map((b) => [...b.clean, ...b.other]);
  const seeds: ProfileSeed[] = [];
  const seen = new Set<string>();
  for (let round = 0; seeds.length < MAX_SEEDS_PER_USER && queues.some((q) => q.length > round); round++) {
    for (const q of queues) {
      const s = q[round];
      if (!s || seeds.length >= MAX_SEEDS_PER_USER || seen.has(s.qlooId as string)) continue;
      seen.add(s.qlooId as string);
      seeds.push(s);
    }
  }
  if (seeds.length === 0) {
    throw new SmokeError("no_seeds", `${RESOLVED_SEEDS_PATH} holds no seed with an entity id (all missing). Re-run scripts/spike/01-resolve.mjs. Nothing was called.`);
  }
  return seeds;
}

// ---- the POST body gate -----------------------------------------------------------------------------------------

/**
 * Fails before any call when the registry would refuse a picks query. Validates the same params the loop's pools send
 * (see src/lib/frontier/pool.ts), with an invented id: no network, no Qloo data. The loop's own preflight stays the
 * authority; this only saves the taste-analysis call that would run before it.
 */
export function assertPicksEnabled(registry: Registry = REGISTRY): void {
  const probe = "00000000-0000-4000-8000-000000000001";
  try {
    prepareInsights(
      {
        "filter.type": "urn:entity:artist",
        "signal.interests.entities": [{ id: probe, weight: 1 }],
        "filter.exclude.entities": [probe],
        "filter.popularity.max": POOL_POPULARITY_MAX,
        "feature.explainability": true,
        take: POOL_TAKE,
      },
      registry,
      { purpose: "picks" },
    );
  } catch (err) {
    throw picksNotEnabled(err) ?? err;
  }
}

function picksNotEnabled(err: unknown): SmokeError | null {
  if (!(err instanceof QlooParamError)) return null;
  const closed = err.issues.filter((i) => i.reason === "body_unconfirmed").map((i) => i.param);
  if (closed.length === 0) return null;
  return new SmokeError(
    "picks_not_enabled",
    `picks_not_enabled: the POST body gate is closed (not confirmed in the registry: ${closed.join(", ")}). Run post-check first and record its result in the registry: ` +
      `node scripts/spike/04-post-check.mjs --dry-run, then QLOO_LIVE=1 QLOO_BUDGET=7 node scripts/spike/04-post-check.mjs, then add what it confirmed to POST_BODY.confirmedBodyParams in src/lib/qloo/registry.ts (manager-only file).`,
  );
}

// ---- the run ----------------------------------------------------------------------------------------------------

export interface SmokeOptions {
  /** Folder that gets one <timestamp>/ subfolder. The real suite passes <repo>/.qloo-private/evals. */
  outDir: string;
  /** Default: <repo root>/.qloo-private/spike/resolved.json. */
  resolvedPath?: string;
  /** Default process.env. */
  env?: Env;
  /** Default console.log. */
  log?: (line: string) => void;
  now?: () => Date;
  // Test seams. The live suite sets none of these.
  fetch?: typeof fetch;
  cache?: QlooCacheAdapter | null;
  registry?: Registry;
  llm?: Llm;
  refs?: RefsContext;
  sleep?: QlooClientOptions["sleep"];
  limits?: QlooClientOptions["limits"];
}

export interface SmokeScore {
  scorer: string;
  pass: boolean;
  reasons: string[];
}

export interface SmokeOutcome {
  /** The folder the recording went to. */
  dir: string;
  scores: SmokeScore[];
  ok: boolean;
  qloo: { live: number; cached: number };
  anthropicCalls: number;
}

const stamp = (d: Date): string => d.toISOString().replace(/[:.]/g, "-");
const write = (dir: string, name: string, data: string): void => writeFileSync(join(dir, name), data);

export async function runSmoke(opts: SmokeOptions): Promise<SmokeOutcome> {
  const env = opts.env ?? (process.env as Env);
  const log = opts.log ?? ((line: string) => console.log(line));
  const now = opts.now ?? (() => new Date());

  // Everything that can fail without a call fails first.
  const seeds = loadResolvedSeeds(opts.resolvedPath ?? join(repoRoot(), RESOLVED_SEEDS_PATH));
  assertPicksEnabled(opts.registry ?? REGISTRY);

  const dir = join(opts.outDir, stamp(now()));
  mkdirSync(dir, { recursive: true });
  log(`smoke-run: ${seeds.length} seed(s) from the spike record, ${SMOKE_EXPECTED_CALLS} Qloo call(s) at most, up to ${expectedAnthropicCalls(env)} Anthropic call(s). Recording to ${dir}`);

  const events: TraceEvent[] = [];
  const emit = (e: TraceEvent) => void events.push(e);
  const client = createQlooClient({
    mode: "record",
    onTrace: emit,
    env: () => env,
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
    ...(opts.cache !== undefined ? { cache: opts.cache } : {}),
    ...(opts.registry ? { registry: opts.registry } : {}),
    ...(opts.sleep ? { sleep: opts.sleep } : {}),
    ...(opts.limits ? { limits: opts.limits } : {}),
  });

  const fail = (err: unknown): never => {
    // Keep what was recorded so far (private), then report a safe message.
    write(dir, "trace.jsonl", events.map((e) => JSON.stringify(e)).join("\n") + "\n");
    const s = client.stats();
    log(`smoke-run: stopped. ${s.liveCalls} live Qloo call(s) made, ${s.cacheHits} from cache. Partial trace written to ${dir}`);
    const closed = picksNotEnabled(err);
    if (closed) throw closed;
    if (err instanceof QlooConfigError) {
      throw new SmokeError(
        "config",
        "The Qloo client is not configured in this process. Vitest does not read .env: export QLOO_BASE_URL (the hackathon host) and QLOO_API_KEY first, for example `set -a; . ./.env; set +a`.",
      );
    }
    const name = err instanceof Error ? err.name : "Error";
    throw new SmokeError("run_failed", `The run failed (${name}). The partial trace is in ${dir}; the error text is not printed because it can carry Qloo data.`);
  };

  const at = () => now().toISOString();
  seeds.forEach((s) => {
    emit({ t: at(), kind: "resolve_seed", say: "Seed taken from the spike's resolved record (no search call).", seedId: s.id, status: "clean", candidateCount: 1 });
  });

  let built: Awaited<ReturnType<typeof buildProfile>>;
  let result: RunResult;
  try {
    built = await buildProfile(seeds, { client, namer: fallbackNamer, emit, now });
    const deps: RunDeps = {
      insights: (p, o) => client.insights(p, o),
      preflight: (p, o) => void prepareInsights(p, opts.registry ?? REGISTRY, { purpose: o.purpose }),
      refs: opts.refs ?? createRefsContext(),
      llm: opts.llm ?? createLlm(env, { cache: createLlmCache() }),
      emit,
      now,
      qlooStats: () => {
        const s = client.stats();
        return { liveCalls: s.liveCalls, cacheHits: s.cacheHits };
      },
    };
    result = await runAgent({ seeds, profile: built.profile, axes: built.axes }, deps);
  } catch (err) {
    return fail(err);
  }

  write(dir, "trace.jsonl", events.map((e) => JSON.stringify(e)).join("\n") + "\n");
  write(dir, "result.json", JSON.stringify(result, null, 2));
  write(dir, "profile.json", JSON.stringify({ profile: built.profile, axes: built.axes }, null, 2));

  // Score the recording with every trace scorer, as one live case.
  const input: CaseInput = { id: "smoke-run", run: "new_profile", trace: events, result, live: true };
  const smokeCase: LoadedCase = { id: "smoke-run", description: "Recorded live smoke run", trace: "trace.jsonl", live: true, input };
  const traceScorers = SCORERS.filter((s) => s.kind === "trace");
  const report = await runEvals({ scorers: traceScorers, cases: [smokeCase] });
  const scores: SmokeScore[] = report.scorers.map((s) => ({ scorer: s.scorer, pass: s.outcomes[0]!.actual.pass, reasons: s.outcomes[0]!.actual.reasons }));
  write(dir, "summary.json", JSON.stringify({ scores: scores.map((s) => ({ scorer: s.scorer, pass: s.pass })), qloo: result.meta.qloo, anthropic: result.meta.anthropic }, null, 2));

  const qloo = result.meta.qloo ?? (() => {
    const s = client.stats();
    return { live: s.liveCalls, cached: s.cacheHits };
  })();
  log(`smoke-run: ${qloo.live} live Qloo call(s), ${qloo.cached} from cache, ${result.meta.anthropic.calls} Anthropic call(s). Scorers:`);
  for (const s of scores) {
    log(`  ${s.pass ? "PASS" : "FAIL"}  ${s.scorer}`);
    for (const r of s.reasons) log(`        ${r}`);
  }
  const ok = scores.every((s) => s.pass);
  log(`smoke-run: ${scores.filter((s) => s.pass).length}/${scores.length} scorers pass. Recording: ${dir}`);
  return { dir, scores, ok, qloo, anthropicCalls: result.meta.anthropic.calls };
}

// ---- the suite --------------------------------------------------------------------------------------------------

export const smokeRun: LiveSuite = {
  id: "smoke-run",
  description: `One end-to-end live run: 1 taste analysis, up to ${FIELDS.length} pools, up to ${MAX_REQUERIES_PER_RUN} re-queries; seeds from the spike record (0 searches); record mode, so a repeat costs 0.`,
  expectedCalls: SMOKE_EXPECTED_CALLS,
  expectedAnthropicCalls,
  async run({ outDir }) {
    // The recording holds Qloo data: refuse any folder outside .qloo-private/.
    const parts = resolve(outDir).split(sep);
    if (!parts.includes(".qloo-private")) throw new SmokeError("bad_out_dir", `The live recording folder must be under .qloo-private/ (got a path without it). Nothing was called.`);
    const outcome = await runSmoke({ outDir });
    if (!outcome.ok) {
      const failed = outcome.scores.filter((s) => !s.pass).map((s) => s.scorer);
      throw new SmokeError("scorers_failed", `smoke-run: ${failed.length} scorer(s) failed: ${failed.join(", ")}. Reasons are printed above; the recording is in ${outcome.dir}.`);
    }
  },
};
