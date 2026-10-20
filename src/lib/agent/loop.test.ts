import { describe, expect, it } from "vitest";
import { FIELDS, isCard, isPath, isTraceEvent, type Band, type Field, type TraceEvent } from "@/types";
import { CONNECTION_FLOOR, MAX_LIVE_CALLS_PER_RUN, MAX_REQUERIES_PER_RUN } from "./config";
import { QlooParamError } from "@/lib/qloo/errors";
import { disabledLlm, createLlmCache } from "./llm";
import { publicTrace, toPublicResult } from "./public";
import { LLM_MAX_CALLS_PER_RUN, REQUERY_POPULARITY_STEP } from "./run-constants";
import { scoreCallBudget } from "../../../evals/scorers/call-budget";
import { badEvents, candidateNumber, fakeAnthropic, fakeQloo, goodModel, id, input, modelFor, pool, runWorld, type ModelResponder } from "./testing";
import { POOL_POPULARITY_MAX } from "./config";

const kinds = (events: readonly TraceEvent[], kind: TraceEvent["kind"]) => events.filter((e) => e.kind === kind);
const requeries = (events: readonly TraceEvent[]) => kinds(events, "requery") as Extract<TraceEvent, { kind: "requery" }>[];

describe("a healthy run", () => {
  it("makes one pool per domain, no re-query and no review call, and ends with complete cards", async () => {
    const qloo = fakeQloo();
    const model = fakeAnthropic();
    const { result, events, client } = await runWorld({ qloo, llm: modelFor(model) });

    // Qloo: 6 live calls (no profile call, no re-query).
    expect(client.stats().liveCalls).toBe(6);
    expect(qloo.fetched).toHaveLength(6);
    expect(new Set(qloo.fetched.map((c) => c.domain))).toEqual(new Set(FIELDS));
    expect(kinds(events, "query_insights")).toHaveLength(6);
    expect(requeries(events)).toHaveLength(0);

    // Model: themes + one cards call per domain, and no review because nothing was flagged.
    expect(model.calls.map((c) => c.tool).sort()).toEqual(["choose_themes", ...FIELDS.map(() => "write_cards")].sort());
    expect(result.meta.anthropic.calls).toBe(7);
    expect(result.meta.fallbacks).toEqual([]);
    expect(result.meta.requeries).toEqual([]);

    // Every event passes the shared guard, and every pick has a stored path and a complete card.
    expect(badEvents(events)).toEqual([]);
    expect(result.domains.map((d) => d.domain)).toEqual([...FIELDS]);
    for (const d of result.domains) {
      expect(d.picks.length).toBeGreaterThan(0);
      for (const p of d.picks) {
        expect(isPath(p.path)).toBe(true);
        expect(p.path.sharedTags.length).toBeGreaterThan(0);
        expect(p.path.distinctive).toBe(true);
        expect(p.card.path).toBe(p.path);
        expect(isCard(p.card)).toBe(true);
        expect(p.card.why.length).toBeGreaterThan(0);
        expect(p.card.different.length).toBeGreaterThan(0);
        expect(p.connection).toBeGreaterThanOrEqual(CONNECTION_FLOOR);
        expect(p.llmBridged).toBe(false);
        expect(p.band).toBeTruthy();
      }
      // byBand holds the same picks as picks.
      expect((Object.values(d.byBand) as unknown[][]).flat()).toHaveLength(d.picks.length);
    }
    // One explain event per pick.
    const picks = result.domains.flatMap((d) => d.picks);
    expect(kinds(events, "explain")).toHaveLength(picks.length);
    expect(new Set(picks.map((p) => p.id)).size).toBe(picks.length);
  });

  it("emits one choose_theme per domain with real profile tag ids and a model reason that adds information", async () => {
    const { events } = await runWorld({ qloo: fakeQloo(), llm: modelFor(fakeAnthropic()) });
    const themes = kinds(events, "choose_theme") as Extract<TraceEvent, { kind: "choose_theme" }>[];
    expect(themes).toHaveLength(FIELDS.length);
    const profileTags = new Set(input().profile.tags.map((t) => t.tag));
    for (const t of themes) {
      expect(t.themeTags.length).toBeGreaterThan(0);
      expect(t.themeTags.every((x) => profileTags.has(x))).toBe(true);
      expect(t.reason.length).toBeGreaterThan(10);
      expect(t.reason).not.toBe(t.say);
    }
  });

  it("excludes every seed and every given shown pick in every call, and never sends bias.trends", async () => {
    const qloo = fakeQloo();
    const shown = [id(90), id(91)];
    await runWorld({ qloo, llm: disabledLlm, exclude: shown });
    for (const c of qloo.fetched) {
      const excluded = c.body["filter.exclude.entities"] as string[];
      for (const s of input().seeds) expect(excluded).toContain(s.qlooId);
      for (const x of shown) expect(excluded).toContain(x);
      expect(Object.keys(c.body)).not.toContain("bias.trends");
      expect(c.body.take).toBe(50);
      expect(c.body["filter.popularity.max"]).toBe(POOL_POPULARITY_MAX);
      expect(c.body["feature.explainability"]).toBe(true);
    }
  });

  it("runs without a model: deterministic themes and cards, zero model calls", async () => {
    const { result, events } = await runWorld({ qloo: fakeQloo(), llm: disabledLlm });
    expect(result.meta.anthropic).toEqual({ calls: 0, cacheHits: 0, failures: 0 });
    expect(result.meta.fallbacks).toContain("themes");
    expect(result.meta.fallbacks.filter((f) => f.startsWith("cards:"))).toHaveLength(FIELDS.length);
    expect(badEvents(events)).toEqual([]);
    for (const p of result.domains.flatMap((d) => d.picks)) expect(isCard(p.card)).toBe(true);
  });
});

describe("call budget", () => {
  it("a repeat of the same profile makes 0 live Qloo calls and 0 model calls", async () => {
    const qloo = fakeQloo();
    const model = fakeAnthropic();
    const llmCache = createLlmCache();
    const first = await runWorld({ qloo, llm: modelFor(model, llmCache) });
    const fetchedAfterFirst = qloo.fetched.length;
    const modelCallsAfterFirst = model.calls.length;
    expect(first.client.stats().liveCalls).toBe(6);

    const second = await runWorld({ qloo, llm: modelFor(model, llmCache) });
    expect(second.client.stats().liveCalls).toBe(0);
    expect(qloo.fetched.length).toBe(fetchedAfterFirst);
    expect(second.client.stats().cacheHits).toBe(6);
    expect(model.calls.length).toBe(modelCallsAfterFirst);
    expect(second.result.meta.anthropic.calls).toBe(0);
    expect(second.result.meta.anthropic.cacheHits).toBe(7);
    // Every qloo_call of the repeat is cached, as the call-budget scorer reads it.
    expect(second.traces.every((t) => t.cached)).toBe(true);
    expect(second.traces.some((t) => (t as { status?: number }).status !== undefined)).toBe(false);
    // And the picks are the same.
    expect(second.result.domains.map((d) => d.picks.map((p) => p.id))).toEqual(first.result.domains.map((d) => d.picks.map((p) => p.id)));
  });

  it("passes the call-budget scorer on its own trace: a new run, then a repeat view", async () => {
    const qloo = fakeQloo((c) => (c.domain === "film" && c.nth === 1 ? [] : pool(c.domain)));
    const llm = createLlmCache();
    const first = await runWorld({ qloo, llm: modelFor(fakeAnthropic(), llm) });
    expect(scoreCallBudget({ id: "new", run: "new_profile", trace: first.events })).toMatchObject({ pass: true });
    const again = await runWorld({ qloo, llm: modelFor(fakeAnthropic(), llm) });
    expect(scoreCallBudget({ id: "repeat", run: "repeat_view", trace: again.events })).toMatchObject({ pass: true });
    // The repeat re-runs the same re-query from cache too: 0 live calls.
    expect(again.client.stats().liveCalls).toBe(0);
    expect(requeries(again.events)).toHaveLength(1);
  });

  it("with the worst case of re-queries stays at 8 live calls (limit 12) and at most 2 re-queries", async () => {
    // Every domain's first pool is empty, so all six are flagged, but only 2 re-queries are allowed.
    const qloo = fakeQloo((c) => (c.nth === 1 ? [] : pool(c.domain)));
    const model = fakeAnthropic();
    const { result, events, client } = await runWorld({ qloo, llm: modelFor(model) });
    expect(requeries(events)).toHaveLength(MAX_REQUERIES_PER_RUN);
    expect(client.stats().liveCalls).toBe(FIELDS.length + MAX_REQUERIES_PER_RUN);
    expect(client.stats().liveCalls).toBeLessThanOrEqual(MAX_LIVE_CALLS_PER_RUN);
    // Model calls: themes + review + cards for each domain that has picks.
    expect(result.meta.anthropic.calls).toBeLessThanOrEqual(LLM_MAX_CALLS_PER_RUN);
    expect(result.meta.anthropic.calls).toBe(1 + 1 + (FIELDS.length - 4));
    expect(result.meta.notRequeried).toHaveLength(FIELDS.length - MAX_REQUERIES_PER_RUN);
    // The four domains that were not re-queried are reported empty, never padded.
    expect(result.domains.filter((d) => d.status === "empty")).toHaveLength(FIELDS.length - MAX_REQUERIES_PER_RUN);
    for (const d of result.domains.filter((x) => x.status === "empty")) {
      expect(d.picks).toEqual([]);
      expect(d.note).toMatch(/nothing/i);
    }
    expect(badEvents(events)).toEqual([]);
  });

  it("emits at most one insights pool per domain plus one per re-query for that domain", async () => {
    const qloo = fakeQloo((c) => (c.domain === "books" && c.nth === 1 ? [] : pool(c.domain)));
    const { events } = await runWorld({ qloo, llm: modelFor(fakeAnthropic()) });
    const perDomain = new Map<string, number>();
    for (const e of events) if (e.kind === "query_insights") perDomain.set(e.domain, (perDomain.get(e.domain) ?? 0) + 1);
    const rq = requeries(events);
    for (const [d, n] of perDomain) expect(n).toBe(1 + rq.filter((r) => r.domain === d).length);
  });
});

describe("re-query logic", () => {
  it("does not re-query a good result set", async () => {
    const { events, result } = await runWorld({ qloo: fakeQloo(), llm: modelFor(fakeAnthropic()) });
    expect(requeries(events)).toEqual([]);
    expect(result.meta.notRequeried).toEqual([]);
  });

  it("re-queries an empty domain with reason empty, by leaning another axis, and changes a param", async () => {
    const qloo = fakeQloo((c) => (c.domain === "film" && c.nth === 1 ? [] : pool(c.domain)));
    const { events, result } = await runWorld({ qloo, llm: modelFor(fakeAnthropic()) });
    const rq = requeries(events);
    expect(rq).toHaveLength(1);
    expect(rq[0]).toMatchObject({ domain: "film", reason: "empty" });
    expect(Object.keys(rq[0]!.paramChanges)).toEqual(["signal.interests.entities"]);
    // An empty pool cannot be fixed by a lower popularity ceiling, so that action was never offered.
    const film = qloo.fetched.filter((c) => c.domain === "film");
    expect(film).toHaveLength(2);
    expect(film[1]!.body["signal.interests.entities"]).not.toEqual(film[0]!.body["signal.interests.entities"]);
    expect(film[1]!.body["filter.popularity.max"]).toBe(film[0]!.body["filter.popularity.max"]);
    // The score event for the empty pool precedes the requery, as the requery-logic scorer reads it.
    const at = (pred: (e: TraceEvent) => boolean) => events.findIndex(pred);
    expect(at((e) => e.kind === "score" && e.domain === "film" && e.scored === 0)).toBeLessThan(at((e) => e.kind === "requery"));
    expect(result.domains.find((d) => d.domain === "film")?.requeried).toBe("empty");
    expect(result.domains.find((d) => d.domain === "film")?.picks.length).toBeGreaterThan(0);
  });

  it("flags too_obvious when the cleared results are tied to a seed by name, and tightens the popularity ceiling", async () => {
    // Every film candidate lists a seed in its lineage names (same franchise).
    const qloo = fakeQloo((c) => (c.domain === "film" && c.nth === 1 ? pool("film", { properties: { influenced_other_media: ["Invented Work 1"] } }) : pool(c.domain)));
    const { events } = await runWorld({ qloo, llm: modelFor(fakeAnthropic()) });
    const rq = requeries(events);
    expect(rq).toHaveLength(1);
    expect(rq[0]).toMatchObject({ domain: "film", reason: "too_obvious", paramChanges: { "filter.popularity.max": Number((POOL_POPULARITY_MAX - REQUERY_POPULARITY_STEP).toFixed(2)) } });
    const film = qloo.fetched.filter((c) => c.domain === "film");
    expect(film[1]!.body["filter.popularity.max"]).toBeLessThan(film[0]!.body["filter.popularity.max"] as number);
  });

  it("flags too_weak when fewer than the minimum clear the floor", async () => {
    // Only two books candidates carry a profile tag (the rest carry tags the profile never named).
    const thin = (c: { domain: Field }) => pool(c.domain, { tagsOf: (i) => (i < 2 ? [i + 1] : [90 + i]) });
    const qloo = fakeQloo((c) => (c.domain === "books" && c.nth === 1 ? thin(c) : pool(c.domain)));
    const { events } = await runWorld({ qloo, llm: modelFor(fakeAnthropic()) });
    expect(requeries(events).map((r) => [r.domain, r.reason])).toEqual([["books", "too_weak"]]);
  });

  it("flags weak_connection when candidates exist but none shares a distinctive tag", async () => {
    // Every music candidate carries the same profile tag, so it is never rare.
    const generic = (c: { domain: Field }) => pool(c.domain, { tagsOf: () => [1] });
    const qloo = fakeQloo((c) => (c.domain === "music" && c.nth === 1 ? generic(c) : pool(c.domain)));
    const { events } = await runWorld({ qloo, llm: modelFor(fakeAnthropic()) });
    expect(requeries(events).map((r) => [r.domain, r.reason])).toEqual([["music", "weak_connection"]]);
  });

  it("honours a model that skips, and never makes a requery the model did not decide", async () => {
    const skip: ModelResponder = (tool, user, system) =>
      tool === "decide_requeries" ? { decisions: ((user.flagged as { domain: string }[]) ?? []).map((f) => ({ domain: f.domain, action: "skip" })) } : goodModel(tool, user, system);
    const qloo = fakeQloo((c) => (c.domain === "film" && c.nth === 1 ? [] : pool(c.domain)));
    const { events, result } = await runWorld({ qloo, llm: modelFor(fakeAnthropic(skip)) });
    expect(requeries(events)).toEqual([]);
    expect(result.meta.notRequeried).toEqual([{ domain: "film", reason: "empty" }]);
    expect(qloo.fetched).toHaveLength(6);
  });

  it("drops a model decision for an axis or action that code did not offer, then does not re-query", async () => {
    const wrong: ModelResponder = (tool, user, system) =>
      tool === "decide_requeries"
        ? { decisions: [{ domain: "film", action: "lean_axis", axisId: "axis-invented" }, { domain: "film", action: "tighten_popularity" }] }
        : goodModel(tool, user, system);
    const qloo = fakeQloo((c) => (c.domain === "film" && c.nth === 1 ? [] : pool(c.domain)));
    const { events } = await runWorld({ qloo, llm: modelFor(fakeAnthropic(wrong)) });
    // tighten_popularity is not offered for an empty pool, and axis-invented does not exist.
    expect(requeries(events)).toEqual([]);
  });

  it("falls back to a deterministic decision when the model fails, still within the budget", async () => {
    const failing: ModelResponder = (tool, user, system) => (tool === "decide_requeries" ? undefined : goodModel(tool, user, system));
    const qloo = fakeQloo((c) => (c.nth === 1 ? [] : pool(c.domain)));
    const { events, result } = await runWorld({ qloo, llm: modelFor(fakeAnthropic(failing)) });
    expect(requeries(events)).toHaveLength(MAX_REQUERIES_PER_RUN);
    expect(result.meta.fallbacks).toContain("review");
  });

  it("never lowers the connection floor to fill a gap: a thin domain stays thin", async () => {
    // Two usable candidates and nothing better on any re-query.
    const qloo = fakeQloo((c) => (c.domain === "books" ? pool("books", { tagsOf: (i) => (i < 2 ? [i + 1] : [90 + i]) }) : pool(c.domain)));
    const { result } = await runWorld({ qloo, llm: modelFor(fakeAnthropic()) });
    const books = result.domains.find((d) => d.domain === "books")!;
    expect(books.thin).toBe(true);
    expect(books.status).toBe("thin");
    expect(books.picks.length).toBeLessThanOrEqual(2);
    expect(books.note).toBeTruthy();
    for (const p of books.picks) expect(p.connection).toBeGreaterThanOrEqual(CONNECTION_FLOOR);
  });
});

describe("failures", () => {
  it("surfaces a closed POST body gate as a QlooParamError the handler maps to picks_not_enabled, before any model call", async () => {
    const qloo = fakeQloo();
    const model = fakeAnthropic();
    await expect(runWorld({ qloo, llm: modelFor(model), gate: false })).rejects.toBeInstanceOf(QlooParamError);
    expect(qloo.fetched).toHaveLength(0);
    expect(model.calls).toHaveLength(0);
  });

  it("marks one domain unavailable on a server error and still returns the others", async () => {
    const qloo = fakeQloo((c) => (c.domain === "tv" ? { status: 500 } : pool(c.domain)));
    const { result, events } = await runWorld({ qloo, llm: modelFor(fakeAnthropic()) });
    const tv = result.domains.find((d) => d.domain === "tv")!;
    expect(tv.status).toBe("unavailable");
    expect(tv.picks).toEqual([]);
    expect(tv.note).toMatch(/TV could not be reached/);
    expect(result.domains.filter((d) => d.status !== "unavailable")).toHaveLength(FIELDS.length - 1);
    expect(badEvents(events)).toEqual([]);
  });

  it("throws when every domain failed (replay mode with an empty cache)", async () => {
    const qloo = fakeQloo();
    await expect(runWorld({ qloo, llm: disabledLlm, mode: "replay" })).rejects.toMatchObject({ kind: "cache_miss" });
  });

  it("refuses a run with no resolved seed before any call", async () => {
    const qloo = fakeQloo();
    const base = input();
    const noIds = { ...base, seeds: base.seeds.map((s) => ({ ...s, qlooId: null, status: "missing" as const })) };
    await expect(runWorld({ qloo, llm: disabledLlm, input: noIds })).rejects.toMatchObject({ code: "no_usable_seeds" });
    expect(qloo.fetched).toHaveLength(0);
  });
});

describe("result for the browser", () => {
  it("strips reach, connection and popularity from every pick and keeps the card", async () => {
    const { result } = await runWorld({ qloo: fakeQloo(), llm: modelFor(fakeAnthropic()) });
    const pub = toPublicResult(result);
    const text = JSON.stringify(pub);
    expect(text).not.toMatch(/"(reach|connection|popularity|tagDistance|obscurity|fieldUnfamiliarity)"/);
    expect(text).not.toMatch(/"contribution":\s*[0-9]/);
    expect(Object.keys(pub.meta).sort()).toEqual(["notRequeried", "requeries"]);
    expect(text).not.toMatch(/fallbacks|anthropic|cacheHits/);
    for (const d of pub.domains) {
      for (const p of d.picks) {
        // A public card has all four parts. (isCard itself refuses an explainability anchor with no contribution, so it
        // is checked on the internal result; the manager may want a public variant of the guard.)
        expect(p.card.why.length).toBeGreaterThan(0);
        expect(p.card.different.length).toBeGreaterThan(0);
        expect(p.card.provenance.sourced + p.card.provenance.inferred).toBe(p.card.path.hops.length);
        expect(p.path.hops.length).toBeGreaterThanOrEqual(3);
      }
    }
    // The internal result keeps them, for evals.
    expect(result.domains[0]!.picks[0]!.reach.reach).toBeGreaterThan(0);
    expect(result.domains[0]!.picks[0]!.path.anchor.contribution).not.toBeNull();
    // The public anchor keeps its source (and `thin` when set) but no contribution.
    const anchor = pub.domains[0]!.picks[0]!.path.anchor;
    expect(anchor.contribution).toBeNull();
    expect(anchor.source).toBe(result.domains[0]!.picks[0]!.path.anchor.source);
    expect(pub.domains[0]!.picks[0]!.card.path.anchor.contribution).toBeNull();
  });

  it("every band keeps its picks in the right bucket", async () => {
    const { result } = await runWorld({ qloo: fakeQloo(), llm: disabledLlm });
    for (const d of result.domains) {
      for (const b of Object.keys(d.byBand) as Band[]) for (const p of d.byBand[b]) expect(p.band).toBe(b);
    }
  });

  it("uses candidate ids from the pool only (no invented picks)", async () => {
    const { result } = await runWorld({ qloo: fakeQloo(), llm: disabledLlm });
    for (const d of result.domains) {
      const allowed = new Set(Array.from({ length: 14 }, (_, i) => id(candidateNumber(d.domain, i))));
      for (const p of d.picks) expect(allowed.has(p.qlooId)).toBe(true);
    }
  });
});

describe("trace contract", () => {
  it("every emitted event passes isTraceEvent, including the client's qloo_call events", async () => {
    const qloo = fakeQloo((c) => (c.domain === "film" && c.nth === 1 ? [] : pool(c.domain)));
    const { events } = await runWorld({ qloo, llm: modelFor(fakeAnthropic()) });
    expect(events.length).toBeGreaterThan(20);
    for (const e of events) expect(isTraceEvent(e), JSON.stringify(e)).toBe(true);
    const seen = new Set(events.map((e) => e.kind));
    for (const k of ["qloo_call", "choose_theme", "query_insights", "score", "requery", "fetch_refs", "explain"] as const) expect(seen.has(k), k).toBe(true);
  });

  it("carries no entity id in the query and call events (picks are named by their pick id only)", async () => {
    const { events } = await runWorld({ qloo: fakeQloo(), llm: disabledLlm });
    const noIds = events.filter((e) => e.kind !== "fetch_refs" && e.kind !== "explain");
    expect(JSON.stringify(noIds)).not.toMatch(/00000000-0000-4000-8000-/);
  });
});

describe("public trace", () => {
  it("drops the popularity summary and masks popularity limits, without changing the input", () => {
    const score = { kind: "score", t: "2026-10-20T00:00:00Z", say: "s", domain: "film", scored: 3, clearedFloor: 2, popularity: { min: 0.1, median: 0.3, max: 0.5 } } as const;
    expect(publicTrace(score)).not.toHaveProperty("popularity");
    expect(score.popularity.max).toBe(0.5);
    const qi = { kind: "query_insights", t: "t", say: "s", domain: "film", endpoint: "/v2/insights", params: { "filter.popularity.max": 0.6, take: 50 }, resultCount: 1, explainability: true, primaryCount: 0, backfillCount: 0 } as const;
    expect((publicTrace(qi) as typeof qi).params).toEqual({ "filter.popularity.max": "limited", take: 50 });
    const rq = { kind: "requery", t: "t", say: "s", domain: "film", reason: "too_obvious", paramChanges: { "filter.popularity.max": 0.45 } } as const;
    expect((publicTrace(rq) as typeof rq).paramChanges).toEqual({ "filter.popularity.max": "tightened" });
    const call = { kind: "qloo_call", t: "t", say: "s", endpoint: "/v2/insights", method: "POST", cached: false, params: { "filter.popularity.max": 0.6, take: 50 } } as const;
    expect(JSON.stringify(publicTrace(call))).not.toMatch(/0\.6/);
    const other = { kind: "explain", t: "t", say: "s", pickId: "p" } as const;
    expect(publicTrace(other)).toBe(other);
  });
});

describe("plan replay", () => {
  it("a repeat with the returned plan replays every Qloo request from cache and makes no themes or review call, whatever the model cache holds", async () => {
    const qloo = fakeQloo((c) => (c.domain === "film" && c.nth === 1 ? [] : pool(c.domain)));
    const first = await runWorld({ qloo, llm: modelFor(fakeAnthropic()) });
    expect(first.result.plan.themes).toHaveLength(FIELDS.length);
    expect(first.result.plan.requeries).toHaveLength(1);
    for (const t of first.result.plan.themes) expect(t.leadSeedIds?.length).toBeGreaterThan(0);
    const fetched = qloo.fetched.length;

    // A fresh model client with an EMPTY cache that answers themes differently: the plan wins.
    const different = fakeAnthropic((tool, user, system) => (tool === "choose_themes" ? { themes: [] } : goodModel(tool, user, system)));
    const again = await runWorld({ qloo, llm: modelFor(different), plan: first.result.plan });
    expect(again.client.stats().liveCalls).toBe(0);
    expect(qloo.fetched.length).toBe(fetched);
    expect(different.calls.some((c) => c.tool === "choose_themes" || c.tool === "decide_requeries")).toBe(false);
    expect(different.calls.filter((c) => c.tool === "write_cards")).toHaveLength(FIELDS.length);
    expect(again.result.plan).toEqual(first.result.plan);
    expect(requeries(again.events).map((r) => [r.domain, r.reason])).toEqual([["film", "empty"]]);
    expect(again.result.domains.map((d) => d.picks.map((p) => p.id))).toEqual(first.result.domains.map((d) => d.picks.map((p) => p.id)));
    expect(scoreCallBudget({ id: "r", run: "repeat_view", trace: again.events })).toMatchObject({ pass: true });
  });

  it("a replay with a plan makes no model call at all when the model is off, and ignores plan entries it cannot honour", async () => {
    const qloo = fakeQloo();
    const first = await runWorld({ qloo, llm: modelFor(fakeAnthropic()) });
    const bad = {
      themes: [{ domain: "film" as const, axisId: "axis-invented", reason: "x" }, ...first.result.plan.themes.filter((t) => t.domain !== "film")],
      requeries: [
        { domain: "film" as const, action: { kind: "lean_axis" as const, axisId: "axis-invented" } },
        { domain: "music" as const, action: { kind: "tighten_popularity" as const, popularityMax: 0.99 } },
      ],
    };
    const again = await runWorld({ qloo, llm: disabledLlm, plan: bad });
    // film falls back to the deterministic axis, so its request differs from the first run's: one live call at most.
    expect(again.client.stats().liveCalls).toBeLessThanOrEqual(1);
    expect(requeries(again.events)).toEqual([]);
    expect(again.result.meta.anthropic.calls).toBe(0);
  });
});

describe("re-query outcome", () => {
  it("says the new results replace the first when they do, and puts the requery before the second pool's events", async () => {
    const qloo = fakeQloo((c) => (c.domain === "film" && c.nth === 1 ? [] : pool(c.domain)));
    const { events, result } = await runWorld({ qloo, llm: modelFor(fakeAnthropic()) });
    const rq = requeries(events)[0]!;
    expect(rq.say).toMatch(/replace the first/);
    expect(result.domains.find((d) => d.domain === "film")?.requeryResult).toBe("improved");
    const i = events.indexOf(rq);
    const filmPools = events.map((e, n) => [e, n] as const).filter(([e]) => e.kind === "query_insights" && e.domain === "film");
    expect(filmPools).toHaveLength(2);
    expect(filmPools[1]![1]).toBeGreaterThan(i);
  });

  it("says so when a too_obvious re-query keeps the first results", async () => {
    // Every film candidate names a seed in its lineage on both tries, so the second pool is no less obvious.
    const obvious = () => pool("film", { properties: { influenced_other_media: ["Invented Work 1"] } });
    const qloo = fakeQloo((c) => (c.domain === "film" ? obvious() : pool(c.domain)));
    const { events, result } = await runWorld({ qloo, llm: modelFor(fakeAnthropic()) });
    const rq = requeries(events);
    expect(rq).toHaveLength(1);
    expect(rq[0]!.reason).toBe("too_obvious");
    expect(rq[0]!.say).toMatch(/first results stay/);
    expect(rq[0]!.say).not.toMatch(/replace/);
    expect(result.domains.find((d) => d.domain === "film")?.requeryResult).toBe("kept_first");
  });
});

describe("cancellation", () => {
  it("stops after a cancel: no cards are written and no model call follows", async () => {
    const ac = new AbortController();
    const qloo = fakeQloo((c) => {
      if (c.domain === "tv") ac.abort();
      return pool(c.domain);
    });
    const model = fakeAnthropic();
    await expect(runWorld({ qloo, llm: modelFor(model), signal: ac.signal })).rejects.toThrow(/cancelled/);
    expect(model.calls.some((c) => c.tool === "write_cards")).toBe(false);
    expect(model.calls.some((c) => c.tool === "decide_requeries")).toBe(false);
  });

  it("does not start when already cancelled", async () => {
    const ac = new AbortController();
    ac.abort();
    const qloo = fakeQloo();
    const model = fakeAnthropic();
    await expect(runWorld({ qloo, llm: modelFor(model), signal: ac.signal })).rejects.toThrow(/cancelled/);
    expect(qloo.fetched).toHaveLength(0);
    expect(model.calls).toHaveLength(0);
  });
});
