// Timing script for the server routes (T-31): /api/seeds/resolve, /api/profile/why, /api/profile and /api/run.
//
// It makes ZERO live Qloo calls, ZERO Anthropic calls and ZERO Wikidata calls. Every outside service is a stub that
// waits a fixed time and answers from synthetic data (invented names, ids shaped 00000000-0000-4000-8000-0000000000NN):
//   - Qloo: the real client (limiter, cache, param checks) over a fake fetch that waits PERF_QLOO_MS per request;
//   - model: a stub `Llm` / `AxisNamer` that waits a fixed time per call and answers like the test model;
//   - Wikidata: the real refs client over a fake fetch that waits PERF_WIKIDATA_MS per request.
// The delays are placeholders, not measurements of the real services: read the table for how the server's own
// sequencing changes (which waits overlap), not for absolute seconds.
//
//   npx vitest run --config scripts/perf/vitest.config.ts                        current config.ts values
//   PERF_CONFIG=proposed npx vitest run --config scripts/perf/vitest.config.ts   with the concurrency values the T-31 hand-off proposes
//   PERF_DRY_RUN=1 npx vitest run --config scripts/perf/vitest.config.ts         say what would run, run nothing
//   PERF_LABEL=after ...                                                         names the output file
//
// Output: a table on stdout and JSON under .qloo-private/perf/ (gitignored, never committed).

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Field } from "@/types";
import { handleRun } from "@/app/api/run/handler";
import { handleProfile } from "@/lib/profile/handler";
import { handleWhy } from "@/lib/profile/why-handler";
import { handleResolve } from "@/lib/seeds/handler";
import { createNameCache, type AxisNamer } from "@/lib/profile/naming";
import { richTaste, seed as profileSeed, tagsResponse, tid } from "@/lib/profile/fixtures";
import { createMemoryCache } from "@/lib/qloo/cache";
import { createQlooClient } from "@/lib/qloo/client";
import { REGISTRY } from "@/lib/qloo/registry";
import { ENV, fakeFetch, searchBody } from "@/lib/qloo/testing";
import { prepareInsights } from "@/lib/qloo/validate";
import { createMemoryCache as createRefsCache, createRefsContext, type FetchLike } from "@/lib/refs";
import { FIELD_SEARCH_TYPE } from "@/lib/seeds/field-types";
import { FIELDS } from "@/types";
import { goodModel, input, pool } from "@/lib/agent/testing";
import { LlmError, type Llm } from "@/lib/agent/llm";

// The concurrency values the hand-off proposes for config.ts. Only used with PERF_CONFIG=proposed.
const PROPOSED = vi.hoisted(() => ({ RUN_POOL_CONCURRENCY: 6, LLM_EXPLAIN_CONCURRENCY: 6, NAMER_CONCURRENCY: 8 }));
vi.mock("@/lib/agent/config", async (original) => {
  const real = await original<typeof import("@/lib/agent/config")>();
  return process.env.PERF_CONFIG === "proposed" ? { ...real, ...PROPOSED } : real;
});

const num = (name: string, fallback: number): number => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v >= 0 && process.env[name] !== undefined ? v : fallback;
};
const DELAY = {
  qlooMs: num("PERF_QLOO_MS", 600),
  tasteMs: num("PERF_TASTE_MS", 900),
  wikidataMs: num("PERF_WIKIDATA_MS", 350),
  llm: {
    choose_themes: num("PERF_LLM_THEMES_MS", 2500),
    decide_requeries: num("PERF_LLM_REVIEW_MS", 1500),
    write_cards: num("PERF_LLM_CARDS_MS", 3500),
    namer: num("PERF_LLM_NAMER_MS", 1200),
  } as Record<string, number>,
};

const label = process.env.PERF_LABEL ?? "run";
// The repo root, not the working directory: the output goes to the same private folder wherever vitest was started.
const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

// Every service below is injected as a stub. Anything that reaches the real network anyway (a client built without its
// stub fetch, a missed hook) must fail loudly instead of making a live Qloo, Anthropic or Wikidata call.
const realFetch = globalThis.fetch;
beforeAll(() => {
  globalThis.fetch = (() => {
    throw new Error("perf run: an unstubbed global fetch was called (this script makes no live calls)");
  }) as typeof globalThis.fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
});
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface Span {
  kind: "llm" | "qloo" | "wikidata";
  name: string;
  start: number;
  end: number;
}

/** Records spans against one clock, starting at `begin()`. */
class Clock {
  private t0 = performance.now();
  spans: Span[] = [];
  marks: { name: string; at: number }[] = [];
  begin() {
    this.t0 = performance.now();
    this.spans = [];
    this.marks = [];
  }
  now() {
    return performance.now() - this.t0;
  }
  async span<T>(kind: Span["kind"], name: string, fn: () => Promise<T>): Promise<T> {
    const start = this.now();
    try {
      return await fn();
    } finally {
      this.spans.push({ kind, name, start, end: this.now() });
    }
  }
  mark(name: string) {
    this.marks.push({ name, at: this.now() });
  }
}

function peak(spans: Span[]): number {
  const edges = spans.flatMap((s) => [
    [s.start, 1],
    [s.end, -1],
  ]) as [number, number][];
  edges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let cur = 0;
  let max = 0;
  for (const [, d] of edges) max = Math.max(max, (cur += d));
  return max;
}

const round = (n: number) => Math.round(n);

interface Row {
  route: string;
  scenario: string;
  totalMs: number;
  firstTraceMs: number | null;
  firstPicksMs: number | null;
  resultMs: number | null;
  llm: { calls: number; busyMs: number; peak: number };
  qloo: { calls: number; busyMs: number; peak: number };
  wikidata: { calls: number; busyMs: number; peak: number };
  stages: Record<string, [number, number]>;
}

function summarise(c: Clock, route: string, scenario: string, extra: Partial<Row> = {}): Row {
  const by = (k: Span["kind"]) => {
    const s = c.spans.filter((x) => x.kind === k);
    return { calls: s.length, busyMs: round(s.reduce((n, x) => n + (x.end - x.start), 0)), peak: peak(s) };
  };
  const stages: Row["stages"] = {};
  for (const m of c.marks) {
    const cur = stages[m.name];
    stages[m.name] = cur ? [cur[0], round(m.at)] : [round(m.at), round(m.at)];
  }
  return {
    route,
    scenario,
    totalMs: round(c.now()),
    firstTraceMs: null,
    firstPicksMs: null,
    resultMs: null,
    llm: by("llm"),
    qloo: by("qloo"),
    wikidata: by("wikidata"),
    stages,
    ...extra,
  };
}

// ---- stubs ---------------------------------------------------------------------------------------------------

function stubLlm(clock: Clock): Llm {
  const stats = { calls: 0, cacheHits: 0, failures: 0 };
  return {
    enabled: true,
    stats: () => ({ ...stats }),
    async call(req) {
      stats.calls += 1;
      return clock.span("llm", req.tool.name, async () => {
        await sleep(DELAY.llm[req.tool.name] ?? 1500);
        const out = goodModel(req.tool.name, JSON.parse(req.user) as Record<string, unknown>, req.system);
        if (!out) throw new LlmError("shape", "no stub answer");
        return out;
      });
    },
  };
}

/** The Qloo client for /v2/insights: the real client over a fake network that answers after a fixed wait. */
function qlooClient(clock: Clock, responder: (domain: Field, nth: number) => ReturnType<typeof pool>, waitMs: number) {
  const perDomain = new Map<Field, number>();
  const f = fakeFetch(async (call) => {
    const body = (call.body ?? {}) as Record<string, unknown>;
    const domain = FIELDS.find((d) => FIELD_SEARCH_TYPE[d] === body["filter.type"]);
    if (!domain) return { status: 400, body: {} };
    const nth = (perDomain.get(domain) ?? 0) + 1;
    perDomain.set(domain, nth);
    return clock.span("qloo", `insights:${domain}`, async () => {
      await sleep(waitMs);
      return { body: { success: true, results: { entities: responder(domain, nth), duration: 5 } } };
    });
  });
  const registry = { ...REGISTRY, post: { ...REGISTRY.post, confirmedBodyParams: ["filter.popularity.max", "filter.exclude.entities", "feature.explainability"] } };
  const client = createQlooClient({ mode: "record", cache: createMemoryCache(), fetch: f.fetch, env: () => ENV, limits: { MIN_REQUEST_INTERVAL_MS: 220 }, registry });
  return { client, registry, calls: f.calls };
}

function wikidataFetch(clock: Clock): FetchLike {
  return async (url) =>
    clock.span("wikidata", "wbgetentities", async () => {
      await sleep(DELAY.wikidataMs);
      const u = new URL(url);
      const ids = (u.searchParams.get("ids") ?? "").split("|");
      const entities: Record<string, unknown> = {};
      for (const q of ids) {
        entities[q] =
          u.searchParams.get("props") === "claims"
            ? { claims: { P737: [{ rank: "normal", mainsnak: { snaktype: "value", datavalue: { value: { id: "Q99001" } } } }] } }
            : { labels: { en: { value: "Invented Influence" } } };
      }
      return { ok: true, status: 200, json: async () => ({ entities }) };
    });
}

// ---- scenarios -----------------------------------------------------------------------------------------------

/** Reads an SSE response, marking the first trace, the first `domain` (early picks) and the `result` event. */
async function readStream(res: Response, clock: Clock): Promise<{ firstTrace: number | null; firstPicks: number | null; result: number | null; events: string[] }> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const out = { firstTrace: null as number | null, firstPicks: null as number | null, result: null as number | null, events: [] as string[] };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const blocks = buf.split("\n\n");
    buf = blocks.pop() ?? "";
    for (const b of blocks) {
      const m = /^event: (\w+)/m.exec(b);
      if (!m) continue;
      out.events.push(m[1]!);
      if (m[1] === "trace" && out.firstTrace === null) out.firstTrace = clock.now();
      if (m[1] === "domain" && out.firstPicks === null) out.firstPicks = clock.now();
      if (m[1] === "result") out.result = clock.now();
    }
  }
  return out;
}

interface RunOptions {
  /** Film empty and books thin on the first pool: a review call and 2 re-queries. */
  flagged?: boolean;
  /** No Wikidata contact configured: refs make no request. */
  noWikidata?: boolean;
  /** The Qloo client answers from its cache (a repeat view, or QLOO_MODE=replay): a few ms per call instead of a network wait. */
  cachedQloo?: boolean;
}

async function runScenario(scenario: string, o: RunOptions = {}): Promise<Row> {
  const clock = new Clock();
  const body = input();
  // Candidates carry a Wikidata id so film, tv and fashion picks trigger refs lookups (capped at 6 per run).
  const items = (domain: Field) => pool(domain, { propertiesOf: (i) => ({ wikidata_id: `Q${1000 + i}` }) });
  const { client, registry } = qlooClient(clock, (domain, nth) => {
    if (o.flagged && nth === 1 && domain === "film") return [];
    if (o.flagged && nth === 1 && domain === "books") return pool(domain, { tagsOf: (i) => (i < 2 ? [i + 1] : [90 + i]) });
    return items(domain);
  }, o.cachedQloo ? 5 : DELAY.qlooMs);
  const refs = createRefsContext({ fetch: wikidataFetch(clock), contact: o.noWikidata ? "none" : "perf@example.test", cache: createRefsCache(), block: { until: 0 } });
  const llm = stubLlm(clock);
  clock.begin();
  const res = await handleRun(new Request("http://localhost/api/run", { method: "POST", body: JSON.stringify(body) }), {
    createRunDeps: () => ({
      insights: (p, o) => client.insights(p, o),
      preflight: (p, o) => void prepareInsights(p, registry, { purpose: o.purpose }),
      refs,
      llm,
      qlooStats: () => ({ liveCalls: client.stats().liveCalls, cacheHits: client.stats().cacheHits }),
    }),
    heartbeatMs: 3_600_000,
  });
  const seen = await readStream(res, clock);
  // Stage marks: when each kind of work started and ended, from the spans (the trace events carry no timestamps we trust).
  for (const s of clock.spans) {
    clock.marks.push({ name: s.kind === "llm" ? `llm:${s.name}` : s.kind === "qloo" ? "qloo:insights" : "wikidata", at: s.start });
    clock.marks.push({ name: s.kind === "llm" ? `llm:${s.name}` : s.kind === "qloo" ? "qloo:insights" : "wikidata", at: s.end });
  }
  clock.marks.sort((a, b) => a.at - b.at);
  expect(seen.events.at(-1)).toBe("done");
  expect(seen.events).toContain("result");
  return summarise(clock, "/api/run", scenario, {
    firstTraceMs: seen.firstTrace === null ? null : round(seen.firstTrace),
    firstPicksMs: seen.firstPicks === null ? null : round(seen.firstPicks),
    resultMs: seen.result === null ? null : round(seen.result),
  });
}

async function profileScenario(): Promise<Row> {
  const clock = new Clock();
  const namer: AxisNamer = {
    name: (inp) =>
      clock.span("llm", "namer", async () => {
        await sleep(DELAY.llm.namer!);
        // A name the checker accepts: the kind plus the heaviest tag (it is checked word by word in code).
        const top = inp.tagNames.slice(0, 2);
        return { label: inp.tagNames[0]!, labelJustification: `Named from ${top.join(" and ")}.` };
      }),
  };
  const client = {
    tasteAnalysis: () =>
      clock.span("qloo", "taste", async () => {
        await sleep(DELAY.tasteMs);
        return { outcome: "ok" as const, items: richTaste(), meta: {} as never };
      }),
  };
  clock.begin();
  const res = await handleProfile(
    new Request("http://localhost/api/profile", { method: "POST", body: JSON.stringify({ seeds: [profileSeed(1), profileSeed(2), profileSeed(3)] }) }),
    { createClient: () => client, createNamer: () => namer, nameCache: createNameCache() },
  );
  expect(res.status).toBe(200);
  await res.json();
  return summarise(clock, "/api/profile", "fresh (no name cache)");
}

async function whyScenario(): Promise<Row> {
  const clock = new Clock();
  const client = {
    tags: () =>
      clock.span("qloo", "tags", async () => {
        await sleep(DELAY.qlooMs);
        return { outcome: "ok" as const, items: tagsResponse([{ id: tid("theme", 1), name: "Fixture theme 1", type: "urn:tag:fixture:theme" }]).results.tags, meta: {} as never };
      }),
  };
  clock.begin();
  const res = await handleWhy(new Request("http://localhost/api/profile/why", { method: "POST", body: JSON.stringify({ field: "film", why: "quiet and patient", seedId: "seed-1" }) }), {
    createClient: () => client,
  });
  expect(res.status).toBe(200);
  return summarise(clock, "/api/profile/why", "one /v2/tags call");
}

async function resolveScenario(): Promise<Row> {
  const clock = new Clock();
  const client = {
    search: () =>
      clock.span("qloo", "search", async () => {
        await sleep(DELAY.qlooMs);
        return { outcome: "ok" as const, items: searchBody([5]).results as never, meta: {} as never };
      }),
  };
  clock.begin();
  const res = await handleResolve(new Request("http://localhost/api/seeds/resolve", { method: "POST", body: JSON.stringify({ field: "film", query: "Invented Work 5" }) }), {
    createClient: () => client,
  });
  expect(res.status).toBeLessThan(500);
  return summarise(clock, "/api/seeds/resolve", "one /search call");
}

// ---- report --------------------------------------------------------------------------------------------------

function table(rows: Row[]): string {
  const head = ["route", "scenario", "total ms", "first trace", "first picks", "result", "LLM calls (peak)", "Qloo calls (peak)", "Wikidata (peak)"];
  const cell = (n: number | null) => (n === null ? "-" : String(n));
  const body = rows.map((r) => [
    r.route,
    r.scenario,
    String(r.totalMs),
    cell(r.firstTraceMs),
    cell(r.firstPicksMs),
    cell(r.resultMs),
    `${r.llm.calls} (${r.llm.peak})`,
    `${r.qloo.calls} (${r.qloo.peak})`,
    `${r.wikidata.calls} (${r.wikidata.peak})`,
  ]);
  const widths = head.map((h, i) => Math.max(h.length, ...body.map((b) => b[i]!.length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i]!)).join("  ");
  return [line(head), line(widths.map((w) => "-".repeat(w))), ...body.map(line)].join("\n");
}

function stageTable(r: Row): string {
  return Object.entries(r.stages)
    .map(([k, [a, b]]) => `    ${k.padEnd(26)} ${String(a).padStart(6)} -> ${String(b).padStart(6)} ms`)
    .join("\n");
}

describe("server timing (stubbed services, zero live calls)", () => {
  it("times the routes", async () => {
    const config = process.env.PERF_CONFIG === "proposed" ? "proposed" : "current";
    if (process.env.PERF_DRY_RUN) {
      console.log(
        [
          "perf dry run: nothing is executed.",
          "  live Qloo calls: 0 (the real client runs over a fake network that waits per request)",
          "  live Anthropic calls: 0 (stub model, fixed delay per call)",
          "  live Wikidata calls: 0 (fake network, fixed delay per request)",
          `  scenarios: /api/seeds/resolve, /api/profile/why, /api/profile, /api/run (healthy; flagged = 2 re-queries + review call; no Wikidata; Qloo cached)`,
          `  config: ${config}; delays: ${JSON.stringify(DELAY)}`,
        ].join("\n"),
      );
      return;
    }
    const rows: Row[] = [];
    rows.push(await resolveScenario());
    rows.push(await whyScenario());
    rows.push(await profileScenario());
    rows.push(await runScenario("healthy"));
    rows.push(await runScenario("flagged", { flagged: true }));
    rows.push(await runScenario("healthy, no Wikidata", { noWikidata: true }));
    rows.push(await runScenario("healthy, Qloo cached, no Wikidata", { noWikidata: true, cachedQloo: true }));
    const text = table(rows);
    console.log(`\nlabel=${label} config=${config} delays=${JSON.stringify(DELAY)}\n${text}`);
    for (const r of rows.filter((x) => x.route === "/api/run" && !x.scenario.includes("no Wikidata"))) console.log(`\n  stages, ${r.route} ${r.scenario}:\n${stageTable(r)}`);
    const dir = join(REPO_ROOT, ".qloo-private", "perf");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${label}-${config}.json`), JSON.stringify({ label, config, delays: DELAY, rows }, null, 2));
  });
});
