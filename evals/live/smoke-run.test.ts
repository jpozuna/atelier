// The smoke-run suite, with no network: a fake Qloo fetch, a fake model, a temp directory instead of .qloo-private/.
// Nothing here reads .env, .qloo-private/ or a real key. Names and ids are invented.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FIELDS } from "@/types";
import { MAX_LIVE_CALLS_PER_RUN, MAX_REQUERIES_PER_RUN } from "@/lib/agent/config";
import { createMemoryCache } from "@/lib/qloo/cache";
import { REGISTRY, type Registry } from "@/lib/qloo/registry";
import { ENV, fakeFetch, id, type FakeCall, type FakeResponse } from "@/lib/qloo/testing";
import { FIELD_SEARCH_TYPE } from "@/lib/seeds/field-types";
import type { InsightsEntity } from "@/lib/qloo/types";
import { fakeAnthropic, modelFor, offlineRefs, pool } from "@/lib/agent/testing";
import { createLlm } from "@/lib/agent/llm";
import { tasteItem, tasteResponse } from "@/lib/profile/fixtures";
import { SCORERS } from "../scorers";
import { RESOLVED_SEEDS_PATH, SMOKE_EXPECTED_CALLS, SmokeError, assertPicksEnabled, expectedAnthropicCalls, loadResolvedSeeds, runSmoke, smokeRun } from "./smoke-run";

const ALL_TYPES = Object.values(FIELD_SEARCH_TYPE);
const OPEN_REGISTRY: Registry = { ...REGISTRY, post: { ...REGISTRY.post, confirmedBodyParams: ["filter.popularity.max", "filter.exclude.entities", "feature.explainability"] } };

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "atelier-smoke-"));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  vi.restoreAllMocks();
});

/** A spike-shaped resolved.json with invented entries. Ids 1 to 3 match what the synthetic pools explain against. */
function writeResolved(over: unknown = null): string {
  const file = join(tmp, "resolved.json");
  const entry = (n: number, status = "clean") => ({ query: `Invented Query ${n}`, status, http: 200, n: 1, exactMatches: 1, entity_id: id(n), name: `Invented Name ${n}` });
  writeFileSync(file, JSON.stringify(over ?? { resolved: { music: [entry(1)], film: [entry(2)], tv: [], books: [entry(3)], places: [], fashion: [] }, extras: {} }));
  return file;
}

/** Taste analysis: eight "theme" tags (the same ids the synthetic pools carry) plus a few other kinds. */
function tasteBody() {
  const items = [
    ...Array.from({ length: 8 }, (_, i) => tasteItem({ type: "theme", n: i + 1, affinity: 0.9 - i * 0.05, types: ALL_TYPES })),
    ...["style", "mood", "setting"].flatMap((type) => [1, 2, 3].map((n) => tasteItem({ type, n, affinity: 0.5, types: ALL_TYPES }))),
  ];
  return tasteResponse(items);
}

// Invented one-word openers, so no two synthetic picks look like one franchise (domain-coverage checks that).
const OPENERS = ["Amber", "Birch", "Cobalt", "Dune", "Ember", "Flint", "Garnet", "Harbor", "Indigo", "Juniper", "Kestrel", "Lumen", "Marble", "Nimbus", "Onyx", "Quill"];
const distinct = (domain: (typeof FIELDS)[number], items: InsightsEntity[]): InsightsEntity[] =>
  items.map((e, i) => ({ ...e, name: `${OPENERS[(i + FIELDS.indexOf(domain) * 5) % OPENERS.length]} ${["Atlas", "Choir", "Tide", "Lantern"][FIELDS.indexOf(domain) % 4]} ${i}` }));

function fakeQlooFetch() {
  const f = fakeFetch((call: FakeCall): FakeResponse => {
    const body = call.body as Record<string, unknown> | undefined;
    if (call.method === "GET" && call.url.pathname === "/v2/insights" && call.url.searchParams.get("filter.type") === "urn:tag") return { body: tasteBody() };
    const domain = FIELDS.find((d) => FIELD_SEARCH_TYPE[d] === body?.["filter.type"]);
    if (call.method === "POST" && domain) return { body: { success: true, results: { entities: distinct(domain, pool(domain)), duration: 5 } } };
    return { status: 400, body: { errors: [{ message: "unexpected request" }] } };
  });
  return f;
}

const base = () => ({
  outDir: join(tmp, "out"),
  env: { ...ENV } as Record<string, string | undefined>,
  sleep: async () => {},
  limits: { MIN_REQUEST_INTERVAL_MS: 0 },
  log: () => {},
});

describe("expected counts", () => {
  it("declares 9 Qloo calls: 1 taste analysis, one pool per field, the re-queries", () => {
    expect(SMOKE_EXPECTED_CALLS).toBe(1 + FIELDS.length + MAX_REQUERIES_PER_RUN);
    expect(SMOKE_EXPECTED_CALLS).toBe(9);
    expect(smokeRun.expectedCalls).toBe(9);
    expect(SMOKE_EXPECTED_CALLS).toBeLessThanOrEqual(MAX_LIVE_CALLS_PER_RUN);
  });

  it("expects 0 Anthropic calls without a key and the loop cap with one", () => {
    expect(expectedAnthropicCalls({})).toBe(0);
    expect(expectedAnthropicCalls({ ANTHROPIC_API_KEY: "  " })).toBe(0);
    expect(expectedAnthropicCalls({ ANTHROPIC_API_KEY: "synthetic-key" })).toBe(8);
  });
});

describe("loadResolvedSeeds", () => {
  it("a missing file gives a clear message that names the spike step and says nothing was called", () => {
    try {
      loadResolvedSeeds(join(tmp, "nope.json"));
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(SmokeError);
      expect((e as SmokeError).code).toBe("missing_resolved");
      expect((e as SmokeError).message).toContain(RESOLVED_SEEDS_PATH);
      expect((e as SmokeError).message).toContain("01-resolve.mjs");
      expect((e as SmokeError).message).toContain("--dry-run");
      expect((e as SmokeError).message).toContain("Nothing was called");
    }
  });

  it("rejects a file that is not JSON, has no resolved object, or has no usable entry", () => {
    const f = join(tmp, "x.json");
    writeFileSync(f, "{not json");
    expect(() => loadResolvedSeeds(f)).toThrow(/not valid JSON/);
    writeFileSync(f, JSON.stringify({ other: 1 }));
    expect(() => loadResolvedSeeds(f)).toThrow(/no "resolved" object/);
    writeFileSync(f, JSON.stringify({ resolved: { music: [{ query: "Invented", status: "missing" }, { query: "Invented 2", status: "clean", entity_id: "not-an-id" }] } }));
    expect(() => loadResolvedSeeds(f)).toThrow(/no seed with an entity id/);
  });

  it("builds clean seeds with a synthetic why, maps places to food_places, skips missing, and caps the count", () => {
    const entry = (n: number, status = "clean") => ({ query: `Invented Query ${n}`, status, entity_id: id(n) });
    const f = join(tmp, "many.json");
    writeFileSync(
      f,
      JSON.stringify({
        resolved: {
          music: [entry(1, "ambiguous"), entry(2), entry(3)],
          places: [entry(4), entry(5, "missing")],
          film: Array.from({ length: 10 }, (_, i) => entry(10 + i)),
        },
      }),
    );
    const seeds = loadResolvedSeeds(f);
    expect(seeds).toHaveLength(10);
    expect(new Set(seeds.map((s) => s.qlooId)).size).toBe(10);
    expect(seeds.every((s) => s.status === "clean" && s.why === "Synthetic reason for the smoke run.")).toBe(true);
    expect(seeds.some((s) => s.field === "food_places")).toBe(true);
    expect(seeds.find((s) => s.qlooId === id(5))).toBeUndefined();
    // Clean entries lead within a field, and every field is represented before one field gets a second seed.
    expect(seeds.slice(0, 3).map((s) => s.field).sort()).toEqual(["film", "food_places", "music"]);
    expect(seeds.find((s) => s.field === "music")!.qlooId).toBe(id(2));
  });
});

describe("the POST body gate", () => {
  it("is closed by default: picks_not_enabled, and it says to run post-check and record the result in the registry", () => {
    try {
      assertPicksEnabled(REGISTRY);
      expect.unreachable();
    } catch (e) {
      expect((e as SmokeError).code).toBe("picks_not_enabled");
      expect((e as SmokeError).message).toContain("Run post-check first and record its result in the registry");
      expect((e as SmokeError).message).toContain("04-post-check.mjs --dry-run");
    }
  });

  it("passes once the three body params are confirmed", () => {
    expect(() => assertPicksEnabled(OPEN_REGISTRY)).not.toThrow();
  });

  it("runSmoke stops on a closed gate before any request and before writing anything", async () => {
    const f = fakeQlooFetch();
    await expect(runSmoke({ ...base(), resolvedPath: writeResolved(), fetch: f.fetch, cache: createMemoryCache() })).rejects.toMatchObject({ code: "picks_not_enabled" });
    expect(f.calls).toHaveLength(0);
    expect(existsSync(join(tmp, "out"))).toBe(false);
  });

  it("runSmoke with no resolved.json makes no request and writes nothing", async () => {
    const f = fakeQlooFetch();
    await expect(runSmoke({ ...base(), resolvedPath: join(tmp, "absent.json"), registry: OPEN_REGISTRY, fetch: f.fetch, cache: createMemoryCache() })).rejects.toMatchObject({ code: "missing_resolved" });
    expect(f.calls).toHaveLength(0);
    expect(existsSync(join(tmp, "out"))).toBe(false);
  });
});

describe("a recorded run (fake Qloo, fake model)", () => {
  const run = (extra: Record<string, unknown> = {}) => {
    const f = fakeQlooFetch();
    const model = fakeAnthropic();
    const cache = createMemoryCache();
    const lines: string[] = [];
    const go = (more: Record<string, unknown> = {}) =>
      runSmoke({ ...base(), resolvedPath: writeResolved(), registry: OPEN_REGISTRY, fetch: f.fetch, cache, llm: modelFor(model), refs: offlineRefs(), log: (l) => void lines.push(l), ...extra, ...more });
    return { f, model, cache, lines, go };
  };

  it("records under the given folder (never .qloo-private), within the call budget, and scores every trace scorer", async () => {
    const { f, lines, go } = run();
    const out = await go();

    expect(out.dir.startsWith(join(tmp, "out"))).toBe(true);
    expect(out.dir).not.toContain(".qloo-private");
    expect(readdirSync(out.dir).sort()).toEqual(["profile.json", "result.json", "summary.json", "trace.jsonl"]);

    // Calls: one taste analysis by GET, then one POST per field plus at most the re-queries. No search, no tags.
    const paths = f.calls.map((c) => `${c.method} ${c.url.pathname}`);
    expect(paths.filter((p) => p === "GET /v2/insights")).toHaveLength(1);
    expect(paths.filter((p) => p === "POST /v2/insights").length).toBeGreaterThanOrEqual(FIELDS.length);
    expect(paths.filter((p) => p !== "GET /v2/insights" && p !== "POST /v2/insights")).toEqual([]);
    expect(f.calls.length).toBeLessThanOrEqual(SMOKE_EXPECTED_CALLS);
    expect(out.qloo.live).toBe(f.calls.length);

    // The recording: the server-side result carries the audit block; the trace is JSONL.
    const result = JSON.parse(readFileSync(join(out.dir, "result.json"), "utf8"));
    expect(result.audit.seedIds).toEqual([id(1), id(2), id(3)]);
    const trace = readFileSync(join(out.dir, "trace.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(trace.filter((e) => e.kind === "resolve_seed")).toHaveLength(3);
    expect(trace.filter((e) => e.kind === "qloo_call" && e.endpoint === "/search")).toHaveLength(0);

    // Scorers: every registered trace scorer ran, once, and the summary holds names and pass or fail only.
    const traceScorers = SCORERS.filter((s) => s.kind === "trace").map((s) => s.name);
    expect(out.scores.map((s) => s.scorer)).toEqual(traceScorers);
    // The test opens the gate on a COPY of the registry, but param-validity checks the recording against the real one,
    // so it is the one scorer that fails here, and only for the closed body gate. With the gate recorded in
    // registry.ts (what a live run needs) the real registry agrees and it passes.
    const failing = out.scores.filter((s) => !s.pass);
    expect(failing.map((s) => s.scorer)).toEqual(["param-validity"]);
    expect(failing[0]!.reasons.every((r) => r.includes("body_unconfirmed"))).toBe(true);
    expect(out.ok).toBe(false);
    const summary = JSON.parse(readFileSync(join(out.dir, "summary.json"), "utf8"));
    expect(Object.keys(summary.scores[0]).sort()).toEqual(["pass", "scorer"]);
    for (const sc of out.scores) expect(lines).toContain(`  ${sc.pass ? "PASS" : "FAIL"}  ${sc.scorer}`);
    expect(lines.some((l) => /live Qloo call\(s\)/.test(l))).toBe(true);
  });

  it("a repeat run reads the cache: 0 live calls", async () => {
    const { f, go } = run();
    await go();
    const before = f.calls.length;
    const again = await go();
    expect(f.calls.length).toBe(before);
    expect(again.qloo.live).toBe(0);
    expect(again.scores.filter((s) => !s.pass).map((s) => s.scorer)).toEqual(["param-validity"]);
  });

  it("without a model key the run still completes through the deterministic fallback, with 0 Anthropic calls", async () => {
    const { f, go } = run();
    const noKeyFetch = vi.fn();
    const out = await go({ llm: createLlm({}, { fetch: noKeyFetch as unknown as typeof fetch }) });
    expect(noKeyFetch).not.toHaveBeenCalled();
    expect(out.anthropicCalls).toBe(0);
    expect(f.calls.length).toBeLessThanOrEqual(SMOKE_EXPECTED_CALLS);
    expect(out.scores).not.toHaveLength(0);
  });

  it("a failing scorer makes the recorded case fail, never pass on missing evidence", async () => {
    // A live case whose result has no audit block must fail "not verifiable", not pass with a note.
    const { go } = run();
    const out = await go();
    const result = JSON.parse(readFileSync(join(out.dir, "result.json"), "utf8"));
    delete result.audit;
    const trace = readFileSync(join(out.dir, "trace.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    const failing = SCORERS.filter((s) => s.kind === "trace").filter((s) => !s.score({ id: "x", run: "new_profile", trace, result, live: true }).pass);
    expect(failing.length).toBeGreaterThan(0);
  });

  it("a failed run keeps a partial trace and prints no error text", async () => {
    const f = fakeFetch(() => ({ status: 500, body: { errors: [{ message: "secret detail" }] } }));
    const lines: string[] = [];
    const err = await runSmoke({ ...base(), resolvedPath: writeResolved(), registry: OPEN_REGISTRY, fetch: f.fetch, cache: createMemoryCache(), llm: modelFor(fakeAnthropic()), refs: offlineRefs(), log: (l) => void lines.push(l) }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SmokeError);
    expect((err as SmokeError).code).toBe("run_failed");
    expect((err as SmokeError).message).not.toContain("secret detail");
    expect(lines.join("\n")).not.toContain("secret detail");
    const dirs = readdirSync(join(tmp, "out"));
    expect(dirs).toHaveLength(1);
    expect(readFileSync(join(tmp, "out", dirs[0]!, "trace.jsonl"), "utf8")).toContain('"kind":"qloo_call"');
    expect(f.calls).toHaveLength(1);
  });

  it("a missing Qloo key reads as a configuration message that mentions .env", async () => {
    const f = fakeQlooFetch();
    const err = await runSmoke({ ...base(), env: {}, resolvedPath: writeResolved(), registry: OPEN_REGISTRY, fetch: f.fetch, cache: createMemoryCache(), llm: modelFor(fakeAnthropic()), refs: offlineRefs() }).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "config" });
    expect((err as SmokeError).message).toContain(".env");
    expect(f.calls).toHaveLength(0);
  });
});

describe("the suite entry point", () => {
  it("refuses to record outside .qloo-private/ before doing anything", async () => {
    mkdirSync(join(tmp, "evals"), { recursive: true });
    await expect(smokeRun.run({ outDir: join(tmp, "evals") })).rejects.toMatchObject({ code: "bad_out_dir" });
    expect(readdirSync(join(tmp, "evals"))).toEqual([]);
  });
});
