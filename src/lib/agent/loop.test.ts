import { describe, expect, it } from "vitest";
import { FIELDS, isCard, isPath, isTraceEvent, type Band, type Field, type TraceEvent } from "@/types";
import {
  CALIBRATION_PICKS_MAX,
  CONNECTION_FLOOR,
  EDGE_FIELD_SHARE_MAX,
  EDGE_PICKS_MAX,
  MAX_LIVE_CALLS_PER_RUN,
  MAX_REQUERIES_PER_RUN,
  LLM_MAX_CALLS_PER_RUN,
  OBVIOUS_SHARE,
  REQUERY_POPULARITY_STEP,
  POOL_POPULARITY_MAX,
} from "@/lib/agent/config";
import { QlooParamError } from "@/lib/qloo/errors";
import { FIELD_SEARCH_TYPE } from "@/lib/seeds/field-types";
import { disabledLlm, createLlmCache, type Llm } from "./llm";
import { publicTrace, toPublicResult } from "./public";
import { scoreCallBudget } from "../../../evals/scorers/call-budget";
import { scoreDialBehavior } from "../../../evals/scorers/dial-behavior";
import { scoreEdgeCap } from "../../../evals/scorers/edge-cap";
import { scoreReachMargin } from "../../../evals/scorers/reach-margin";
import { badEvents, candidateNumber, fakeAnthropic, fakeQloo, goodModel, id, input, modelFor, offlineRefs, pool, runWorld, type FakeAnthropic, type FakeQloo, type ModelResponder } from "./testing";
import { runAgent } from "./loop";
import type { DomainResult, RunDeps, RunInput } from "./types";

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

type ScoreEv = Extract<TraceEvent, { kind: "score" }>;
const scores = (events: readonly TraceEvent[], domain: Field) => kinds(events, "score").filter((e) => (e as ScoreEv).domain === domain) as ScoreEv[];

describe("server-side audit block", () => {
  it("holds the seed ids, the exclusion list sent per domain and the tag rarity behind the shown picks", async () => {
    const shown = [id(90), id(91)];
    const qloo = fakeQloo();
    const { result } = await runWorld({ qloo, llm: disabledLlm, exclude: shown });
    const { audit } = result;
    const seedIds = input().seeds.map((s) => s.qlooId);
    expect(audit.seedIds).toEqual(seedIds);
    expect(Object.keys(audit.exclude).sort()).toEqual([...FIELDS].sort());
    for (const d of FIELDS) {
      // The list the client was handed for that domain: seeds, then the request's exclude.
      expect(audit.exclude[d]).toEqual([...seedIds, ...shown]);
      const sent = qloo.fetched.filter((c) => c.domain === d).map((c) => c.body["filter.exclude.entities"]);
      for (const list of sent) expect(list).toEqual(audit.exclude[d]);
    }
    for (const d of result.domains) {
      const rarity = audit.tagRarity[d.domain]!;
      expect(Object.keys(rarity).length).toBeGreaterThan(0);
      for (const v of Object.values(rarity)) expect(v >= 0 && v <= 1).toBe(true);
      for (const p of d.picks) for (const t of p.path.sharedTags) expect(rarity[t]).toBeTypeOf("number");
    }
  });

  it("covers only the domains a limited run queried", async () => {
    const { result } = await runWorld({ qloo: fakeQloo(), llm: disabledLlm, domains: ["film"] });
    expect(Object.keys(result.audit.exclude)).toEqual(["film"]);
    expect(Object.keys(result.audit.tagRarity)).toEqual(["film"]);
  });

  it("never reaches the browser", async () => {
    const { result, events } = await runWorld({ qloo: fakeQloo(), llm: modelFor(fakeAnthropic()) });
    expect(result.audit.seedIds.length).toBeGreaterThan(0);
    const pub = toPublicResult(result);
    expect(pub).not.toHaveProperty("audit");
    expect(JSON.stringify(pub)).not.toMatch(/audit|tagRarity|obviousShare/);
    expect(JSON.stringify(events.map(publicTrace))).not.toMatch(/audit|tagRarity|obviousShare/);
  });
});

describe("score.obviousShare", () => {
  it("is on every score event of a healthy run, below the too_obvious threshold, and no re-query follows", async () => {
    const { events } = await runWorld({ qloo: fakeQloo(), llm: modelFor(fakeAnthropic()) });
    const all = kinds(events, "score") as ScoreEv[];
    expect(all).toHaveLength(FIELDS.length);
    for (const e of all) {
      expect(e.obviousShare).toBeTypeOf("number");
      expect(e.obviousShare!).toBeGreaterThanOrEqual(0);
      expect(e.obviousShare!).toBeLessThan(OBVIOUS_SHARE);
    }
    expect(badEvents(events)).toEqual([]);
  });

  it("is the value that drives too_obvious: at or over the threshold on the pool that was flagged, under it elsewhere", async () => {
    const qloo = fakeQloo((c) => (c.domain === "film" && c.nth === 1 ? pool("film", { properties: { influenced_other_media: ["Invented Work 1"] } }) : pool(c.domain)));
    const { events } = await runWorld({ qloo, llm: modelFor(fakeAnthropic()) });
    const rq = requeries(events);
    expect(rq).toHaveLength(1);
    expect(rq[0]!.reason).toBe("too_obvious");
    const film = scores(events, "film");
    expect(film).toHaveLength(2);
    expect(film[0]!.obviousShare!).toBeGreaterThanOrEqual(OBVIOUS_SHARE);
    for (const d of FIELDS.filter((x) => x !== "film")) for (const e of scores(events, d)) expect(e.obviousShare!).toBeLessThan(OBVIOUS_SHARE);
    // The score event comes before the requery it triggered (the first pool), the second pool's after it.
    const at = (e: TraceEvent) => events.indexOf(e);
    expect(at(film[0]!)).toBeLessThan(at(rq[0]!));
    expect(at(film[1]!)).toBeGreaterThan(at(rq[0]!));
  });

  it("is left out when no candidate cleared the floor, and publicTrace strips it", async () => {
    const qloo = fakeQloo((c) => (c.domain === "film" && c.nth === 1 ? [] : pool(c.domain)));
    const { events } = await runWorld({ qloo, llm: modelFor(fakeAnthropic()) });
    expect(scores(events, "film")[0]).not.toHaveProperty("obviousShare");
    const score = { kind: "score", t: "t", say: "s", domain: "film", scored: 3, clearedFloor: 2, popularity: { min: 0.1, median: 0.3, max: 0.5 }, obviousShare: 0.5 } as const;
    expect(publicTrace(score)).not.toHaveProperty("obviousShare");
    expect(score.obviousShare).toBe(0.5);
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

describe("a run limited to some domains", () => {
  const only = (d: Field) => [d];

  it("with a plan, one domain makes 1 pool and no themes call, and returns only that domain with the whole plan", async () => {
    const qloo = fakeQloo();
    const first = await runWorld({ qloo, llm: modelFor(fakeAnthropic()) });
    const before = qloo.fetched.length;
    const model = fakeAnthropic();
    const shown = first.result.domains.find((d) => d.domain === "film")!.picks.map((p) => p.qlooId);
    const again = await runWorld({ qloo, llm: modelFor(model), plan: first.result.plan, domains: only("film"), exclude: shown });

    expect(again.result.domains.map((d) => d.domain)).toEqual(["film"]);
    expect(qloo.fetched.length - before).toBe(1);
    expect(qloo.fetched.slice(before).every((c) => c.domain === "film")).toBe(true);
    expect(again.client.stats().liveCalls).toBe(1);
    expect(model.calls.map((c) => c.tool)).toEqual(["write_cards"]);
    expect(kinds(again.events, "choose_theme")).toHaveLength(1);
    expect(kinds(again.events, "query_insights")).toHaveLength(1);
    expect(kinds(again.events, "fetch_refs")).toHaveLength(1);
    for (const e of kinds(again.events, "explain") as { pickId: string }[]) expect(again.result.domains[0]!.picks.some((p) => p.id === e.pickId)).toBe(true);
    // The excluded picks are sent, the other domains' pools are untouched, and the plan still covers every field.
    for (const c of qloo.fetched.slice(before)) for (const x of shown) expect(c.body["filter.exclude.entities"]).toContain(x);
    for (const p of again.result.domains[0]!.picks) expect(shown).not.toContain(p.qlooId);
    expect(again.result.plan.themes.map((t) => t.domain)).toEqual([...FIELDS]);
    // Carried entries keep domain, axis and reason (the client-sent plan has no informational leadSeedIds).
    const core = (t: { domain: string; axisId: string; reason: string }) => ({ domain: t.domain, axisId: t.axisId, reason: t.reason });
    expect(again.result.plan.themes.filter((t) => t.domain !== "film").map(core)).toEqual(first.result.plan.themes.filter((t) => t.domain !== "film").map(core));
    expect(scoreCallBudget({ id: "one", run: "new_profile", trace: again.events })).toMatchObject({ pass: true });
  });

  it("the other domains still replay from cache after a one-domain run with exclude", async () => {
    const qloo = fakeQloo();
    const first = await runWorld({ qloo, llm: modelFor(fakeAnthropic()) });
    await runWorld({ qloo, llm: modelFor(fakeAnthropic()), plan: first.result.plan, domains: only("film"), exclude: [id(90)] });
    const before = qloo.fetched.length;
    const rest = await runWorld({ qloo, llm: modelFor(fakeAnthropic()), plan: first.result.plan, domains: FIELDS.filter((d) => d !== "film") });
    expect(rest.client.stats().liveCalls).toBe(0);
    expect(qloo.fetched.length).toBe(before);
  });

  it("a domain flagged on the re-run is reviewed and re-queried at most once: 2 live Qloo calls, at most 2 model calls, no themes call", async () => {
    const qloo = fakeQloo((c) => (c.domain === "music" && c.nth === 2 ? [] : pool(c.domain)));
    const first = await runWorld({ qloo, llm: modelFor(fakeAnthropic()) });
    expect(first.result.plan.requeries).toEqual([]);
    const before = qloo.fetched.length;
    const model = fakeAnthropic();
    const again = await runWorld({ qloo, llm: modelFor(model), plan: first.result.plan, domains: only("music"), exclude: [id(90)] });
    expect(requeries(again.events)).toHaveLength(1);
    expect(qloo.fetched.length - before).toBe(2);
    expect(again.client.stats().liveCalls).toBe(2);
    expect(model.calls.map((c) => c.tool).sort()).toEqual(["decide_requeries", "write_cards"]);
    expect(again.result.meta.anthropic.calls).toBeLessThanOrEqual(2);
    expect(again.result.plan.requeries.map((r) => r.domain)).toEqual(["music"]);
    expect(again.result.plan.themes).toHaveLength(FIELDS.length);
    expect(scoreCallBudget({ id: "one", run: "new_profile", trace: again.events })).toMatchObject({ pass: true });
  });

  it("without a plan, one domain makes at most a themes, a review and a cards call, 2 Qloo calls and 1 re-query", async () => {
    const qloo = fakeQloo((c) => (c.nth === 1 ? [] : pool(c.domain)));
    const model = fakeAnthropic();
    const { result, events, client } = await runWorld({ qloo, llm: modelFor(model), domains: only("books") });
    expect(result.domains.map((d) => d.domain)).toEqual(["books"]);
    expect(client.stats().liveCalls).toBe(2);
    expect(requeries(events)).toHaveLength(1);
    expect(model.calls.map((c) => c.tool).sort()).toEqual(["choose_themes", "decide_requeries", "write_cards"]);
    // The model is only offered the requested domain, and the plan covers only what was run.
    const themes = model.calls.find((c) => c.tool === "choose_themes")!;
    expect((themes.user as { domains: { domain: string }[] }).domains.map((d) => d.domain)).toEqual(["books"]);
    expect(result.plan.themes.map((t) => t.domain)).toEqual(["books"]);
  });

  it("drops carried re-queries beyond the plan limit, keeping this run's first, and never repeats a domain's re-query on replay", async () => {
    const qloo = fakeQloo((c) => (c.nth === 1 ? [] : pool(c.domain)));
    const first = await runWorld({ qloo, llm: modelFor(fakeAnthropic()) });
    expect(first.result.plan.requeries).toHaveLength(MAX_REQUERIES_PER_RUN);
    const [a] = first.result.plan.requeries;
    const other = FIELDS.find((d) => !first.result.plan.requeries.some((r) => r.domain === d))!;
    const again = await runWorld({ qloo, llm: modelFor(fakeAnthropic()), plan: first.result.plan, domains: only(other) });
    expect(again.result.plan.requeries.length).toBeLessThanOrEqual(MAX_REQUERIES_PER_RUN);
    expect(again.result.plan.requeries.filter((r) => r.domain === other).length).toBeLessThanOrEqual(1);
    expect(again.result.plan.requeries.some((r) => r.domain === a!.domain)).toBe(true);
    const dup = { ...first.result.plan, requeries: [first.result.plan.requeries[0]!, first.result.plan.requeries[0]!] };
    const r = await runWorld({ qloo, llm: disabledLlm, plan: dup, domains: only(a!.domain) });
    expect(requeries(r.events).length).toBeLessThanOrEqual(1);
  });

  it("checks the gate for the requested types only, before any model call, and strips rule-7 fields as ever", async () => {
    const model = fakeAnthropic();
    await expect(runWorld({ qloo: fakeQloo(), llm: modelFor(model), gate: false, domains: only("film") })).rejects.toBeInstanceOf(QlooParamError);
    expect(model.calls).toHaveLength(0);
    const { result } = await runWorld({ qloo: fakeQloo(), llm: modelFor(fakeAnthropic()), domains: ["tv", "film"] });
    expect(result.domains.map((d) => d.domain)).toEqual(FIELDS.filter((d) => d === "tv" || d === "film"));
    const text = JSON.stringify(toPublicResult(result));
    expect(text).not.toMatch(/"(reach|connection|popularity|contribution)":\s*[0-9]/);
  });

  it("stops between stages when cancelled, as a full run does", async () => {
    const ctl = new AbortController();
    ctl.abort();
    await expect(runWorld({ qloo: fakeQloo(), llm: disabledLlm, domains: only("film"), signal: ctl.signal })).rejects.toThrow();
  });
});

describe("the edge cap", () => {
  const edgeOf = (r: Awaited<ReturnType<typeof runWorld>>["result"]) => r.domains.flatMap((d) => d.picks).filter((p) => p.band !== "calibration");

  it("shows at most 20 edge picks and 6 calibration picks, with no field above its share, and every edge pick has a strength", async () => {
    const { result } = await runWorld({ qloo: fakeQloo(), llm: modelFor(fakeAnthropic()) });
    const edge = edgeOf(result);
    const calibration = result.domains.flatMap((d) => d.picks).filter((p) => p.band === "calibration");
    expect(edge.length).toBeLessThanOrEqual(EDGE_PICKS_MAX);
    expect(edge.length).toBeGreaterThan(0);
    expect(calibration.length).toBeLessThanOrEqual(CALIBRATION_PICKS_MAX);
    for (const d of result.domains) expect(d.picks.filter((p) => p.band !== "calibration").length).toBeLessThanOrEqual(Math.floor(EDGE_FIELD_SHARE_MAX * edge.length));
    for (const p of edge) expect(["strong", "steady", "light"]).toContain(p.strength);
    for (const p of calibration) expect(p.strength).toBeUndefined();
    // Every kept pick still has its stored path and a complete card, and still clears the floor.
    for (const p of [...edge, ...calibration]) {
      expect(isCard(p.card)).toBe(true);
      expect(p.connection).toBeGreaterThanOrEqual(CONNECTION_FLOOR);
    }
  });

  it("looks up references and writes explanations only for kept picks", async () => {
    const { result, events } = await runWorld({ qloo: fakeQloo(), llm: disabledLlm });
    const kept = new Set(result.domains.flatMap((d) => d.picks.map((p) => p.id)));
    const refs = kinds(events, "fetch_refs") as Extract<TraceEvent, { kind: "fetch_refs" }>[];
    expect(refs).toHaveLength(1);
    expect(new Set(refs[0]!.pickIds)).toEqual(kept);
    const explained = (kinds(events, "explain") as { pickId: string }[]).map((e) => e.pickId);
    expect(new Set(explained)).toEqual(kept);
    expect(explained).toHaveLength(kept.size);
  });

  it("emits one cap event with counts and words only, and publicTrace passes it through unchanged", async () => {
    const { result, events } = await runWorld({ qloo: fakeQloo(), llm: disabledLlm });
    const caps = kinds(events, "cap") as Extract<TraceEvent, { kind: "cap" }>[];
    expect(caps).toHaveLength(1);
    const cap = caps[0]!;
    expect(isTraceEvent(cap)).toBe(true);
    const shown = result.domains.flatMap((d) => d.picks);
    expect(cap.edgeShown).toBe(shown.filter((p) => p.band !== "calibration").length);
    expect(cap.calibrationShown).toBe(shown.filter((p) => p.band === "calibration").length);
    expect(cap.byBand.moderate + cap.byBand.high + cap.byBand.extreme).toBe(cap.edgeShown);
    expect(JSON.stringify(cap)).not.toMatch(/connection|reach|popularity|score|urn:|[0-9a-f]{8}-[0-9a-f]{4}-/i);
    expect(publicTrace(cap)).toEqual(cap);
    // The cap event comes after the bands and before references.
    const at = (k: string) => events.findIndex((e) => e.kind === k);
    expect(at("cap")).toBeGreaterThan(events.map((e) => e.kind).lastIndexOf("score"));
    expect(at("cap")).toBeLessThan(at("fetch_refs"));
  });

  it("real loop output passes the edge-cap, reach-margin and dial-behavior scorers", async () => {
    const { result, events } = await runWorld({ qloo: fakeQloo(), llm: disabledLlm });
    const input = { id: "loop-output", run: "new_profile" as const, trace: events, result };
    expect(scoreEdgeCap(input)).toMatchObject({ pass: true });
    expect(scoreReachMargin(input)).toMatchObject({ pass: true });
    expect(scoreDialBehavior(input)).toMatchObject({ pass: true });
  });

  it("a follow-up of one field passes the edge-cap scorer with the fixed per-field limit", async () => {
    const { result, events } = await runWorld({ qloo: fakeQloo(), llm: disabledLlm, domains: ["film"] });
    expect(scoreEdgeCap({ id: "follow-up", run: "new_profile", trace: events, result })).toMatchObject({ pass: true });
  });

  it("does not report a domain as thin because the cap trimmed it", async () => {
    const { result } = await runWorld({ qloo: fakeQloo(), llm: disabledLlm });
    for (const d of result.domains) {
      expect(d.thin).toBe(false);
      expect(d.status).toBe("ok");
      expect(d.note).toBeUndefined();
    }
  });

  it("keeps strength on the public pick and still strips every number about taste", async () => {
    const { result } = await runWorld({ qloo: fakeQloo(), llm: disabledLlm });
    const pub = toPublicResult(result);
    const text = JSON.stringify(pub);
    expect(text).not.toMatch(/"(reach|connection|popularity|tagDistance|obscurity|fieldUnfamiliarity)"/);
    const edge = pub.domains.flatMap((d) => d.picks).filter((p) => p.band !== "calibration");
    expect(edge.length).toBeGreaterThan(0);
    for (const p of edge) expect(["strong", "steady", "light"]).toContain(p.strength);
  });

  it("a run limited to one field takes its field limit from the whole screen's size", async () => {
    const { result } = await runWorld({ qloo: fakeQloo(), llm: disabledLlm, domains: ["film"] });
    const edge = edgeOf(result);
    expect(edge.length).toBeGreaterThan(0);
    expect(edge.length).toBeLessThanOrEqual(Math.floor(EDGE_FIELD_SHARE_MAX * EDGE_PICKS_MAX));
  });
});

// ---- streaming per domain, parallel re-queries (T-31) ---------------------------------------------------------------

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

interface StreamedRun {
  result: Awaited<ReturnType<typeof runAgent>>;
  events: TraceEvent[];
  domainsSeen: DomainResult[];
  client: ReturnType<FakeQloo["client"]>["client"];
  /** Re-query pool calls (a domain's second or later call) in the order they finished, and how many ran at once at most. */
  requeryDone: Field[];
  maxRequeriesInFlight: number;
}

/** Like runWorld, but with the optional `onDomain` hook, a refs context of the caller's, and a delay per Qloo call. */
async function runStreamed(opts: {
  qloo: FakeQloo;
  llm: Llm;
  refs?: RunDeps["refs"];
  onDomain?: (d: DomainResult) => void;
  /** Called with each event the loop emits, as it happens. */
  onEvent?: (e: TraceEvent) => void;
  /** Milliseconds a Qloo call waits before it is sent; `n` counts that domain's calls from 1 (2 is the re-query). */
  delayFor?: (domain: Field, n: number) => number;
  /** An error a Qloo call throws before it is sent (it never reaches the fake network); `n` as in `delayFor`. */
  throwFor?: (domain: Field, n: number) => Error | undefined;
  input?: RunInput;
  domains?: RunInput["domains"];
  signal?: AbortSignal;
}): Promise<StreamedRun> {
  const { client, traces, preflight } = opts.qloo.client();
  const events: TraceEvent[] = [];
  const record = traces.push.bind(traces);
  traces.push = (...items) => {
    events.push(...items);
    return record(...items);
  };
  const calls = new Map<Field, number>();
  const requeryDone: Field[] = [];
  let inFlight = 0;
  let maxRequeriesInFlight = 0;
  const domainsSeen: DomainResult[] = [];
  const deps: RunDeps & { onDomain?: (d: DomainResult) => void } = {
    insights: async (p, o) => {
      const domain = FIELDS.find((d) => FIELD_SEARCH_TYPE[d] === p["filter.type"])!;
      const n = (calls.get(domain) ?? 0) + 1;
      calls.set(domain, n);
      const boom = opts.throwFor?.(domain, n);
      if (boom) throw boom;
      if (n >= 2) maxRequeriesInFlight = Math.max(maxRequeriesInFlight, ++inFlight);
      try {
        const ms = opts.delayFor?.(domain, n) ?? 0;
        if (ms) await sleep(ms);
        return await client.insights(p, o);
      } finally {
        if (n >= 2) {
          inFlight -= 1;
          requeryDone.push(domain);
        }
      }
    },
    preflight,
    refs: opts.refs ?? offlineRefs(),
    llm: opts.llm,
    emit: (e) => {
      events.push(e);
      opts.onEvent?.(e);
    },
    signal: opts.signal,
    qlooStats: () => {
      const s = client.stats();
      return { liveCalls: s.liveCalls, cacheHits: s.cacheHits };
    },
    onDomain: (d) => {
      domainsSeen.push(d);
      opts.onDomain?.(d);
    },
  };
  const result = await runAgent({ ...(opts.input ?? input()), ...(opts.domains ? { domains: opts.domains } : {}) }, deps);
  return { result, events, domainsSeen, client, requeryDone, get maxRequeriesInFlight() { return maxRequeriesInFlight; } };
}

/** The model endpoint with a wait before each answer, chosen from the tool and the request. */
function slowModel(fake: FakeAnthropic, delayOf: (tool: string, user: Record<string, unknown>) => number): FakeAnthropic {
  const inner = fake.fetch;
  const fetch = (async (url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { tools: { name: string }[]; messages: { content: string }[] };
    const ms = delayOf(body.tools[0]!.name, JSON.parse(body.messages[0]!.content) as Record<string, unknown>);
    if (ms) await sleep(ms);
    return inner(url, init);
  }) as typeof globalThis.fetch;
  return { ...fake, fetch };
}

/** The field a write_cards request is for. */
const cardsField = (user: Record<string, unknown>): Field => (user.picks as { pick: { field: Field } }[])[0]!.pick.field;

/** A Wikidata stand-in that records the order lookups start in and spends a cap like the real client (first come, first served). */
function recordingRefs(opts: { cap?: number; hold?: (field: Field) => Promise<void> | undefined; failFor?: Field } = {}) {
  const started: { id: string; field: Field }[] = [];
  const answered: { id: string; field: Field; status: string }[] = [];
  let spent = 0;
  const refs = {
    wikidata: {
      userAgent: "synthetic-contact",
      requests: 0,
      lookups: 0,
      lookup: async (wid: string, field: Field) => {
        started.push({ id: wid, field });
        const wait = opts.hold?.(field);
        if (wait) await wait;
        if (opts.failFor === field) throw new Error("synthetic refs failure");
        const status = spent < (opts.cap ?? 6) ? "ok" : "budget_exhausted";
        spent += 1;
        answered.push({ id: wid, field, status });
        return { status, lineage: [] };
      },
    },
  } as unknown as RunDeps["refs"];
  return { refs, started, answered };
}

/** A pool whose items carry a Wikidata id, so the refs layer asks the (fake) Wikidata about each finalist. */
const withWikidata = (domain: Field) => pool(domain, { propertiesOf: (i) => ({ wikidata_id: `Q${9000 + candidateNumber(domain, i)}` }) });

describe("onDomain", () => {
  it("is called once per field with a domain that equals that field in the final result, and the result is unchanged by it", async () => {
    const qloo = fakeQloo();
    const seen: DomainResult[] = [];
    const run = await runStreamed({ qloo, llm: modelFor(fakeAnthropic()), onDomain: (d) => seen.push(d) });
    expect(seen).toEqual(run.domainsSeen);
    expect(seen).toHaveLength(FIELDS.length);
    expect(new Set(seen.map((d) => d.domain))).toEqual(new Set(FIELDS));
    for (const d of seen) {
      expect(d).toEqual(run.result.domains.find((x) => x.domain === d.domain));
      expect(d.picks.length).toBeGreaterThan(0);
      for (const p of d.picks) expect(isCard(p.card)).toBe(true);
    }
    // Same answer as a run without the hook.
    const plain = await runWorld({ qloo: fakeQloo(), llm: modelFor(fakeAnthropic()) });
    expect(run.result.domains.map((d) => d.picks.map((p) => p.id))).toEqual(plain.result.domains.map((d) => d.picks.map((p) => p.id)));
    expect(run.result.meta).toEqual(plain.result.meta);
  });

  it("is called before the run returns, and with the model off still gets complete (fallback) cards", async () => {
    const seen: DomainResult[] = [];
    let returned = false;
    const pending = runStreamed({ qloo: fakeQloo(), llm: disabledLlm, onDomain: (d) => { expect(returned).toBe(false); seen.push(d); } });
    const run = await pending;
    returned = true;
    expect(seen).toHaveLength(FIELDS.length);
    for (const d of seen) for (const p of d.picks) expect(isCard(p.card)).toBe(true);
    expect(run.result.domains).toHaveLength(FIELDS.length);
  });

  it("is called once for a run limited to one field, and not at all for a field that could not be reached", async () => {
    const one = await runStreamed({ qloo: fakeQloo(), llm: modelFor(fakeAnthropic()), domains: ["film"] });
    expect(one.domainsSeen.map((d) => d.domain)).toEqual(["film"]);

    const qloo = fakeQloo((c) => (c.domain === "tv" ? { status: 500 } : pool(c.domain)));
    const run = await runStreamed({ qloo, llm: modelFor(fakeAnthropic()) });
    expect(run.domainsSeen.map((d) => d.domain).sort()).toEqual(FIELDS.filter((d) => d !== "tv").sort());
    expect(run.result.domains.find((d) => d.domain === "tv")!.status).toBe("unavailable");
    expect(run.result.domains).toHaveLength(FIELDS.length);
  });

  it("a hook that throws does not fail the run or change what it returns", async () => {
    let calls = 0;
    const run = await runStreamed({
      qloo: fakeQloo(),
      llm: modelFor(fakeAnthropic()),
      onDomain: () => {
        calls += 1;
        throw new Error("a streaming problem");
      },
    });
    expect(calls).toBe(FIELDS.length);
    const plain = await runWorld({ qloo: fakeQloo(), llm: modelFor(fakeAnthropic()) });
    expect(run.result.domains.map((d) => d.picks.map((p) => p.id))).toEqual(plain.result.domains.map((d) => d.picks.map((p) => p.id)));
    for (const d of run.result.domains) for (const p of d.picks) expect(isCard(p.card)).toBe(true);
  });

  it("is never called when the run is cancelled before cards", async () => {
    const ac = new AbortController();
    const qloo = fakeQloo((c) => {
      if (c.domain === "tv") ac.abort();
      return pool(c.domain);
    });
    const seen: DomainResult[] = [];
    await expect(runStreamed({ qloo, llm: modelFor(fakeAnthropic()), signal: ac.signal, onDomain: (d) => seen.push(d) })).rejects.toThrow(/cancelled/);
    expect(seen).toEqual([]);
  });

  it("a domain whose references are in does not wait for another domain's slow lookups, and the explain events still follow the one fetch_refs", async () => {
    // Film's lookups are held until books (no Wikidata lookup of its own) has its cards. If cards waited for every
    // domain's references, books would never finish first and the timer below would have to release the hold.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      release();
    }, 1500);
    const { refs } = recordingRefs({ hold: (f) => (f === "film" ? gate : undefined) });
    const qloo = fakeQloo((c) => withWikidata(c.domain));
    const run = await runStreamed({
      qloo,
      llm: modelFor(fakeAnthropic()),
      refs,
      onDomain: (d) => {
        if (d.domain === "books") release();
      },
    });
    clearTimeout(timer);
    expect(timedOut).toBe(false);
    expect(run.domainsSeen).toHaveLength(FIELDS.length);
    // books reported before film.
    const order = run.domainsSeen.map((d) => d.domain);
    expect(order.indexOf("books")).toBeLessThan(order.indexOf("film"));

    const fetchRefs = run.events.map((e, i) => [e, i] as const).filter(([e]) => e.kind === "fetch_refs");
    expect(fetchRefs).toHaveLength(1);
    const explains = run.events.map((e, i) => [e, i] as const).filter(([e]) => e.kind === "explain");
    const picks = run.result.domains.flatMap((d) => d.picks);
    expect(explains).toHaveLength(picks.length);
    for (const [, i] of explains) expect(i).toBeGreaterThan(fetchRefs[0]![1]);
    expect(new Set((fetchRefs[0]![0] as Extract<TraceEvent, { kind: "fetch_refs" }>).pickIds)).toEqual(new Set(picks.map((p) => p.id)));
    expect(badEvents(run.events)).toEqual([]);
  });

  it("a reference lookup that throws costs only that pick's hops: the run still finishes with complete cards and one fetch_refs", async () => {
    const { refs } = recordingRefs({ failFor: "film" });
    const run = await runStreamed({ qloo: fakeQloo((c) => withWikidata(c.domain)), llm: modelFor(fakeAnthropic()), refs });
    expect(kinds(run.events, "fetch_refs")).toHaveLength(1);
    expect(run.domainsSeen).toHaveLength(FIELDS.length);
    for (const d of run.result.domains) {
      expect(d.picks.length).toBeGreaterThan(0);
      for (const p of d.picks) expect(isCard(p.card)).toBe(true);
    }
  });
});

describe("parallel re-queries", () => {
  // Every first pool is empty, so all six are flagged and the two re-queries the budget allows are made.
  const empties = () => fakeQloo((c) => (c.nth === 1 ? [] : pool(c.domain)));
  /** Events up to the cap event, as kind and domain. Qloo's own call events are left out (they follow completion). */
  const shape = (events: readonly TraceEvent[]) => {
    const upto = events.findIndex((e) => e.kind === "cap");
    return events
      .slice(0, upto)
      .filter((e) => e.kind !== "qloo_call")
      .map((e) => `${e.kind}:${"domain" in e ? e.domain : ""}`);
  };

  it("overlap in time, yet the trace reads in decision order whichever one finishes first", async () => {
    const base = await runStreamed({ qloo: empties(), llm: modelFor(fakeAnthropic()) });
    const decided = base.result.plan.requeries.map((r) => r.domain);
    expect(decided).toHaveLength(MAX_REQUERIES_PER_RUN);
    const [first, second] = decided as [Field, Field];

    const firstSlow = await runStreamed({ qloo: empties(), llm: modelFor(fakeAnthropic()), delayFor: (d, n) => (n >= 2 ? (d === first ? 60 : 5) : 0) });
    const secondSlow = await runStreamed({ qloo: empties(), llm: modelFor(fakeAnthropic()), delayFor: (d, n) => (n >= 2 ? (d === second ? 60 : 5) : 0) });

    // The calls really overlapped, and really finished out of decision order in one run and in order in the other.
    expect(firstSlow.maxRequeriesInFlight).toBe(MAX_REQUERIES_PER_RUN);
    expect(secondSlow.maxRequeriesInFlight).toBe(MAX_REQUERIES_PER_RUN);
    expect(firstSlow.requeryDone).toEqual([second, first]);
    expect(secondSlow.requeryDone).toEqual([first, second]);

    // The same plan and the same trace order whatever the timing.
    expect(firstSlow.result.plan).toEqual(base.result.plan);
    expect(secondSlow.result.plan).toEqual(base.result.plan);
    expect(shape(firstSlow.events)).toEqual(shape(base.events));
    expect(shape(secondSlow.events)).toEqual(shape(base.events));

    // That order is the sequential one: each requery event is followed by its own domain's events only, before the next requery.
    const rq = requeries(firstSlow.events);
    expect(rq.map((r) => r.domain)).toEqual(decided);
    const at = rq.map((r) => firstSlow.events.indexOf(r));
    const between = firstSlow.events.slice(at[0]! + 1, at[1]!).filter((e) => e.kind !== "qloo_call");
    expect(between.length).toBeGreaterThan(0);
    for (const e of between) expect((e as { domain?: Field }).domain).toBe(first);
    const after = firstSlow.events.slice(at[1]! + 1).filter((e) => e.kind === "query_insights" || e.kind === "score");
    expect(after[0] && (after[0] as { domain: Field }).domain).toBe(second);
    for (const e of firstSlow.events.slice(0, at[0]!)) expect(e.kind).not.toBe("requery");
    expect(badEvents(firstSlow.events)).toEqual([]);
  });

  it("the picks do not depend on which re-query finishes first", async () => {
    const base = await runStreamed({ qloo: empties(), llm: modelFor(fakeAnthropic()) });
    const [first] = base.result.plan.requeries.map((r) => r.domain);
    const slow = await runStreamed({ qloo: empties(), llm: modelFor(fakeAnthropic()), delayFor: (d, n) => (n >= 2 ? (d === first ? 40 : 0) : 0) });
    expect(slow.result.domains.map((d) => [d.domain, d.status, d.requeried, d.requeryResult, d.picks.map((p) => p.id)])).toEqual(
      base.result.domains.map((d) => [d.domain, d.status, d.requeried, d.requeryResult, d.picks.map((p) => p.id)]),
    );
    expect(slow.result.meta.requeries).toEqual(base.result.meta.requeries);
    expect(slow.result.meta.notRequeried).toEqual(base.result.meta.notRequeried);
  });

  it("makes the same Qloo calls as before: 6 pools plus at most 2 re-queries, within the per-run limit", async () => {
    const qloo = empties();
    const run = await runStreamed({ qloo, llm: modelFor(fakeAnthropic()), delayFor: (_d, n) => (n >= 2 ? 10 : 0) });
    expect(qloo.fetched).toHaveLength(FIELDS.length + MAX_REQUERIES_PER_RUN);
    expect(run.client.stats().liveCalls).toBe(FIELDS.length + MAX_REQUERIES_PER_RUN);
    expect(run.client.stats().liveCalls).toBeLessThanOrEqual(MAX_LIVE_CALLS_PER_RUN);
    const perDomain = new Map<Field, number>();
    for (const c of qloo.fetched) perDomain.set(c.domain, (perDomain.get(c.domain) ?? 0) + 1);
    for (const d of FIELDS) expect(perDomain.get(d)).toBe(run.result.plan.requeries.some((r) => r.domain === d) ? 2 : 1);
    expect(run.result.meta.requeries).toHaveLength(MAX_REQUERIES_PER_RUN);
    expect(run.result.meta.anthropic.calls).toBeLessThanOrEqual(LLM_MAX_CALLS_PER_RUN);
    expect(scoreCallBudget({ id: "parallel", run: "new_profile", trace: run.events })).toMatchObject({ pass: true });
  });

  it("a healthy run still makes 6 Qloo calls and 7 model calls with the hook and a slow model", async () => {
    const qloo = fakeQloo();
    const model = fakeAnthropic();
    const run = await runStreamed({ qloo, llm: modelFor(slowModel(model, () => 3)) });
    expect(qloo.fetched).toHaveLength(6);
    expect(run.client.stats().liveCalls).toBe(6);
    expect(model.calls).toHaveLength(7);
    expect(run.result.meta.anthropic.calls).toBe(7);
  });

  it("a failing re-query pool costs its call but not the run, and the other re-query still lands", async () => {
    // Re-query pools answer 500 for the first decided domain only.
    const base = await runStreamed({ qloo: empties(), llm: modelFor(fakeAnthropic()) });
    const [first, second] = base.result.plan.requeries.map((r) => r.domain) as [Field, Field];
    const qloo = fakeQloo((c) => (c.nth === 1 ? [] : c.domain === first ? { status: 500 } : pool(c.domain)));
    const run = await runStreamed({ qloo, llm: modelFor(fakeAnthropic()), delayFor: (d, n) => (n >= 2 && d === second ? 20 : 0) });
    expect(requeries(run.events).map((r) => r.domain)).toEqual([first, second]);
    expect(run.result.domains.find((d) => d.domain === second)!.requeryResult).toBe("improved");
    expect(run.result.domains.find((d) => d.domain === first)!.requeryResult).toBe("kept_first");
    expect(qloo.fetched).toHaveLength(FIELDS.length + MAX_REQUERIES_PER_RUN);
  });
});

describe("meta.fallbacks order", () => {
  it("lists the cards fallbacks in field order even when the fields finish in another order", async () => {
    const done: Field[] = [];
    const failCards: ModelResponder = (tool, user, system) => (tool === "write_cards" ? undefined : goodModel(tool, user, system));
    const fake = fakeAnthropic(failCards);
    // The earlier the field, the longer its cards call takes, so they finish in reverse field order.
    const slow = slowModel(fake, (tool, user) => (tool === "write_cards" ? (FIELDS.length - FIELDS.indexOf(cardsField(user))) * 12 : 0));
    const run = await runStreamed({ qloo: fakeQloo(), llm: modelFor(slow), onDomain: (d) => done.push(d.domain) });
    expect(done).toHaveLength(FIELDS.length);
    expect(done).not.toEqual([...FIELDS]);
    expect(run.result.meta.fallbacks).toEqual(FIELDS.map((d) => `cards:${d}`));
  });

  it("keeps the themes and review fallbacks ahead of the cards ones", async () => {
    const run = await runStreamed({ qloo: fakeQloo((c) => (c.domain === "film" && c.nth === 1 ? [] : pool(c.domain))), llm: disabledLlm });
    const f = run.result.meta.fallbacks;
    expect(f[0]).toBe("themes");
    const cards = f.filter((x) => x.startsWith("cards:"));
    expect(cards).toEqual(FIELDS.map((d) => `cards:${d}`));
    expect(f.indexOf(cards[0]!)).toBeGreaterThan(f.lastIndexOf("themes"));
    if (f.includes("review")) expect(f.indexOf("review")).toBeLessThan(f.indexOf(cards[0]!));
  });
});

describe("reference lookups", () => {
  type Refs = ReturnType<typeof recordingRefs>;
  const expectedOrder = (result: StreamedRun["result"]) => {
    // Round-robin across fields in field order, farthest band first inside a field.
    const priority: Band[] = ["extreme", "high", "moderate", "calibration"];
    const lists = result.domains.map((d) => [...d.picks].sort((a, b) => priority.indexOf(a.band) - priority.indexOf(b.band)));
    const order: string[] = [];
    for (let i = 0; lists.some((l) => i < l.length); i++) for (const l of lists) if (i < l.length) order.push(l[i]!.qlooId);
    return order;
  };
  const widOf = (qlooId: string) => {
    for (const d of FIELDS) for (let i = 0; i < 14; i++) if (id(candidateNumber(d, i)) === qlooId) return `Q${9000 + candidateNumber(d, i)}`;
    throw new Error("unknown pick");
  };

  it("starts every finalist's lookup in round-robin order, so the Wikidata cap goes to the same picks as before", async () => {
    const wd: Refs = recordingRefs({ cap: 6 });
    const run = await runStreamed({ qloo: fakeQloo((c) => withWikidata(c.domain)), llm: modelFor(fakeAnthropic()), refs: wd.refs });
    const order = expectedOrder(run.result);
    // More finalists than the cap, so which ones get a lookup depends on the order.
    expect(wd.started.length).toBeGreaterThan(6);
    // Lookups start in the finalists' round-robin order (the pick filter keeps the ones Wikidata applies to).
    const startedIds = wd.started.map((s) => s.id);
    expect(startedIds).toEqual(order.map(widOf).filter((w) => startedIds.includes(w)));
    // The cap (6) was spent on the first six in that order; the rest were told the budget is spent.
    expect(wd.answered.filter((a) => a.status === "ok")).toHaveLength(6);
    expect(wd.answered.slice(0, 6).every((a) => a.status === "ok")).toBe(true);
    expect(wd.answered.slice(6).every((a) => a.status === "budget_exhausted")).toBe(true);
    expect(wd.answered.slice(0, 6).map((a) => a.id)).toEqual(startedIds.slice(0, 6));
    // The first lookups go to different fields, not six of one.
    expect(new Set(wd.started.slice(0, 3).map((s) => s.field)).size).toBeGreaterThan(1);
  });

  it("the fetch_refs event lists the finalists in that same order, and the cap order does not change with a slow lookup", async () => {
    const plain = recordingRefs({ cap: 6 });
    const slowFilm = recordingRefs({ cap: 6, hold: (f) => (f === "film" ? sleep(25) : undefined) });
    const a = await runStreamed({ qloo: fakeQloo((c) => withWikidata(c.domain)), llm: modelFor(fakeAnthropic()), refs: plain.refs });
    const b = await runStreamed({ qloo: fakeQloo((c) => withWikidata(c.domain)), llm: modelFor(fakeAnthropic()), refs: slowFilm.refs });
    expect(slowFilm.started).toEqual(plain.started);
    const pickIdsOf = (events: TraceEvent[]) => (kinds(events, "fetch_refs")[0] as Extract<TraceEvent, { kind: "fetch_refs" }>).pickIds;
    expect(pickIdsOf(b.events)).toEqual(pickIdsOf(a.events));
    // Pick ids in the event are the picks' own ids, in the round-robin order.
    const byQloo = new Map(a.result.domains.flatMap((d) => d.picks).map((p) => [p.qlooId, p.id]));
    expect(pickIdsOf(a.events)).toEqual(expectedOrder(a.result).map((q) => byQloo.get(q)));
    // Same picks come out whichever lookup was slow.
    expect(b.result.domains.map((d) => d.picks.map((p) => p.id))).toEqual(a.result.domains.map((d) => d.picks.map((p) => p.id)));
  });

  it("makes no reference lookup, emits no fetch_refs and calls no hook when no field has a pick", async () => {
    const wd = recordingRefs();
    const run = await runStreamed({ qloo: fakeQloo(() => []), llm: disabledLlm, refs: wd.refs });
    expect(wd.started).toEqual([]);
    expect(kinds(run.events, "fetch_refs")).toHaveLength(0);
    expect(kinds(run.events, "explain")).toHaveLength(0);
    expect(run.result.domains.every((d) => d.picks.length === 0)).toBe(true);
    for (const d of run.domainsSeen) expect(d.picks).toEqual([]);
  });
});

describe("explain events, in field order", () => {
  const explainDomains = (run: StreamedRun) => {
    const fieldOf = new Map(run.result.domains.flatMap((d) => d.picks.map((p) => [p.id, d.domain] as const)));
    return run.events.filter((e) => e.kind === "explain").map((e) => fieldOf.get((e as Extract<TraceEvent, { kind: "explain" }>).pickId)!);
  };
  const inFieldOrder = (fields: Field[]) => fields.every((f, i) => i === 0 || FIELDS.indexOf(fields[i - 1]!) <= FIELDS.indexOf(f));

  it("are sent in field order however the fields finish, held ones and later ones alike, after the one fetch_refs", async () => {
    // The earlier the field, the longer its cards call takes, so the fields finish in reverse order.
    const reverse = (tool: string, user: Record<string, unknown>) => (tool === "write_cards" ? (FIELDS.length - FIELDS.indexOf(cardsField(user))) * 12 : 0);
    const forward = (tool: string, user: Record<string, unknown>) => (tool === "write_cards" ? (FIELDS.indexOf(cardsField(user)) + 1) * 12 : 0);
    const runs: StreamedRun[] = [];
    for (const delay of [reverse, forward]) {
      const wd = recordingRefs({ hold: () => sleep(5) });
      runs.push(await runStreamed({ qloo: fakeQloo((c) => withWikidata(c.domain)), llm: modelFor(slowModel(fakeAnthropic(), delay)), refs: wd.refs }));
    }
    for (const run of runs) {
      const fields = explainDomains(run);
      expect(fields.length).toBeGreaterThan(0);
      expect(inFieldOrder(fields)).toBe(true);
      const at = (kind: TraceEvent["kind"]) => run.events.map((e, i) => (e.kind === kind ? i : -1)).filter((i) => i >= 0);
      expect(at("fetch_refs")).toHaveLength(1);
      expect(Math.min(...at("explain"))).toBeGreaterThan(at("fetch_refs")[0]!);
      expect(badEvents(run.events)).toEqual([]);
    }
    // The fields really did finish in another order, yet the trace is the same.
    expect(runs[0]!.domainsSeen.map((d) => d.domain)).not.toEqual(runs[1]!.domainsSeen.map((d) => d.domain));
    expect(explainDomains(runs[0]!)).toEqual(explainDomains(runs[1]!));
  });

  it("without any reference lookup they are still in field order", async () => {
    const reverse = (tool: string, user: Record<string, unknown>) => (tool === "write_cards" ? (FIELDS.length - FIELDS.indexOf(cardsField(user))) * 10 : 0);
    const run = await runStreamed({ qloo: fakeQloo(), llm: modelFor(slowModel(fakeAnthropic(), reverse)) });
    expect(inFieldOrder(explainDomains(run))).toBe(true);
    expect(explainDomains(run)).toHaveLength(run.result.domains.flatMap((d) => d.picks).length);
  });

  it("a domain reaches onDomain before its own explain events when the references are slow (the order contract), and every explain event is out by the result", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { refs } = recordingRefs({ hold: (f) => (f === "film" ? gate : undefined) });
    let explainsWhenBooksArrived = -1;
    let explains = 0;
    const run = await runStreamed({
      qloo: fakeQloo((c) => withWikidata(c.domain)),
      llm: modelFor(fakeAnthropic()),
      refs,
      onEvent: (e) => {
        if (e.kind === "explain") explains += 1;
      },
      onDomain: (d) => {
        if (d.domain === "books") {
          explainsWhenBooksArrived = explains;
          release();
        }
      },
    });
    // books has no lookup, so its picks went out while film's lookup was held: before fetch_refs, so before any explain event.
    expect(explainsWhenBooksArrived).toBe(0);
    expect(run.events.filter((e) => e.kind === "explain")).toHaveLength(run.result.domains.flatMap((d) => d.picks).length);
  });
});

describe("failure and cancel stop the concurrent work", () => {
  it("when one re-query throws, the run fails with that error once the other has settled, and no later stage starts", async () => {
    const base = await runStreamed({ qloo: fakeQloo((c) => (c.nth === 1 ? [] : pool(c.domain))), llm: modelFor(fakeAnthropic()) });
    const [first, second] = base.result.plan.requeries.map((r) => r.domain) as [Field, Field];

    const qloo = fakeQloo((c) => (c.nth === 1 ? [] : withWikidata(c.domain)));
    const model = fakeAnthropic();
    const wd = recordingRefs();
    const seen: DomainResult[] = [];
    await expect(
      runStreamed({
        qloo,
        llm: modelFor(model),
        refs: wd.refs,
        onDomain: (d) => seen.push(d),
        throwFor: (d, n) => (n >= 2 && d === first ? new Error("synthetic re-query failure") : undefined),
        delayFor: (d, n) => (n >= 2 && d === second ? 30 : 0),
      }),
    ).rejects.toThrow("synthetic re-query failure");
    // Only the other re-query's call (already in flight) reached the network; nothing after that.
    expect(qloo.fetched).toHaveLength(FIELDS.length + 1);
    expect(model.calls.map((c) => c.tool)).not.toContain("write_cards");
    expect(wd.started).toEqual([]);
    expect(seen).toEqual([]);
  });

  it("a cancel in the middle of the reference lookups starts no further lookup and no cards call", async () => {
    const ac = new AbortController();
    const model = fakeAnthropic();
    const wd = recordingRefs({
      hold: () => {
        ac.abort();
        return undefined;
      },
    });
    const seen: DomainResult[] = [];
    await expect(
      runStreamed({ qloo: fakeQloo((c) => withWikidata(c.domain)), llm: modelFor(model), refs: wd.refs, signal: ac.signal, onDomain: (d) => seen.push(d) }),
    ).rejects.toThrow(/cancelled/);
    expect(wd.started).toHaveLength(1);
    expect(model.calls.map((c) => c.tool)).not.toContain("write_cards");
    expect(seen).toEqual([]);
  });

  it("a cancel while the cards are being written lets no other domain start a new step, and the run ends once they have all settled", async () => {
    const ac = new AbortController();
    const model = fakeAnthropic();
    // Each cards call takes a moment; the first to arrive cancels the run.
    const slow = slowModel(model, (tool) => {
      if (tool === "write_cards") ac.abort();
      return tool === "write_cards" ? 15 : 0;
    });
    const seen: DomainResult[] = [];
    await expect(runStreamed({ qloo: fakeQloo(), llm: modelFor(slow), signal: ac.signal, onDomain: (d) => seen.push(d) })).rejects.toThrow(/cancelled/);
    expect(seen).toEqual([]);
  });
});
