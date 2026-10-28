// Test-only helpers for the agent loop: a synthetic world (seeds, profile, axes, pools), a fake Qloo behind the REAL
// client (fake fetch, in-memory cache, POST body gate opened on a copy of the registry), a fake Anthropic endpoint
// behind the REAL model client, and a refs context that never touches the network.
// Production code never imports this file. Everything is invented: entity ids shaped
// 00000000-0000-4000-8000-0000000000NN, tag ids urn:tag:fixture:..., names "Invented ..." and "Fixture ...".

import type { Axis, Field, TraceEvent } from "@/types";
import { FIELDS, isTraceEvent } from "@/types";
import { createMemoryCache, type QlooCacheAdapter } from "@/lib/qloo/cache";
import { createQlooClient, type QlooClient } from "@/lib/qloo/client";
import { prepareInsights } from "@/lib/qloo/validate";
import { REGISTRY } from "@/lib/qloo/registry";
import { ENV, fakeFetch, id } from "@/lib/qloo/testing";
import type { InsightsEntity, QlooCallTraceEvent } from "@/lib/qloo/types";
import { entity, profileOf, profileTag, seedOf, tg } from "@/lib/frontier/fixtures";
import type { Profile, ProfileSeed } from "@/lib/profile/types";
import { createRefsContext, createMemoryCache as createRefsCache } from "@/lib/refs";
import { FIELD_SEARCH_TYPE } from "@/lib/seeds/field-types";
import { runAgent } from "./loop";
import { createAnthropicLlm, createLlmCache, type Llm, type LlmCache } from "./llm";
import type { RunDeps, RunInput, RunResult } from "./types";

export { id, tg };

/** Seeds: one music, one film, one books. Names "Invented Work 1..3". */
export function seeds(): ProfileSeed[] {
  return [seedOf(1, "music"), seedOf(2, "film"), seedOf(3, "books")];
}

/** Tags 1 to 8. Types cover all six entity types, so every domain can use every tag. */
export function world(): { seeds: ProfileSeed[]; profile: Profile; axes: Axis[] } {
  const weights = [0.9, 0.8, 0.7, 0.6, 0.55, 0.5, 0.45, 0.4];
  const fieldsOf = (n: number): Field[] => (n <= 2 ? ["music"] : n <= 4 ? ["film"] : n <= 6 ? ["books"] : ["music", "film", "books"]);
  const tags = weights.map((w, i) => profileTag(i + 1, w, { fields: fieldsOf(i + 1) }));
  const sd = seeds();
  const axis = (n: number, label: string, members: number[]): Axis => ({
    id: `axis-${label.toLowerCase()}`,
    label,
    labelJustification: `Named from the listed tags ${members.map((m) => `Fixture Tag ${m}`).join(" and ")}.`,
    weight: 1 - n * 0.1,
    tagType: "urn:tag:fixture:theme",
    tags: members.map((m) => tags[m - 1]!),
  });
  return {
    seeds: sd,
    profile: profileOf(tags, sd.map((s) => s.id), ["music", "film", "books"]),
    axes: [axis(0, "Alpha", [1, 2]), axis(1, "Beta", [3, 4]), axis(2, "Gamma", [5, 6, 7])],
  };
}

export function input(extra: Partial<RunInput> = {}): RunInput {
  return { ...world(), ...extra };
}

const domainIndex = (d: Field) => FIELDS.indexOf(d);

export interface PoolOptions {
  /** Candidates in the pool. Default 14 (ids stay under 100). */
  size?: number;
  /** Extra properties on every item, e.g. lineage names. */
  properties?: Record<string, unknown>;
  /** Properties of candidate i (overrides `properties`). */
  propertiesOf?: (i: number) => Record<string, unknown> | undefined;
  /** Tags of candidate i. Default: two of the eight profile tags, each carried by about a quarter of the pool. */
  tagsOf?: (i: number) => number[];
  popularityOf?: (i: number) => number;
}

/** Entity ids: 10 + 14 * domain index + i, so six domains of 14 fit under 100. */
export function candidateNumber(domain: Field, i: number): number {
  return 10 + domainIndex(domain) * 14 + i;
}

/** A healthy pool: spread of popularity, distinctive shared tags, explainability on. */
export function pool(domain: Field, o: PoolOptions = {}): InsightsEntity[] {
  const size = o.size ?? 14;
  return Array.from({ length: size }, (_, i) =>
    entity({
      n: candidateNumber(domain, i),
      name: `Invented ${domain} Pick ${i}`,
      subtype: FIELD_SEARCH_TYPE[domain],
      popularity: o.popularityOf ? o.popularityOf(i) : Number((0.55 - i * 0.03).toFixed(2)),
      tags: o.tagsOf ? o.tagsOf(i) : [(i % 8) + 1, ((i + 3) % 8) + 1],
      affinity: Number((0.9 - i * 0.02).toFixed(2)),
      explain: [[1 + (i % 3), 0.5]],
      ...((o.propertiesOf ? o.propertiesOf(i) : o.properties) ? { properties: (o.propertiesOf ? o.propertiesOf(i) : o.properties)! } : {}),
    }),
  );
}

export interface InsightsCall {
  domain: Field;
  body: Record<string, unknown>;
  /** 1-based number of insights calls for this domain so far. */
  nth: number;
}

export type Responder = (call: InsightsCall) => InsightsEntity[] | { status: number };

const OPEN_GATE = ["filter.popularity.max", "filter.exclude.entities", "feature.explainability"];

export interface FakeQloo {
  cache: QlooCacheAdapter & { size(): number };
  /** HTTP requests that reached the fake network, in order. */
  fetched: InsightsCall[];
  /** A new client (one per run), sharing the cache. */
  client(opts?: { gate?: boolean; mode?: "record" | "replay" }): { client: QlooClient; traces: QlooCallTraceEvent[]; preflight: NonNullable<RunDeps["preflight"]> };
}

export function fakeQloo(responder: Responder = (c) => pool(c.domain)): FakeQloo {
  const cache = createMemoryCache();
  const fetched: InsightsCall[] = [];
  const perDomain = new Map<Field, number>();
  const f = fakeFetch((call) => {
    const body = (call.body ?? {}) as Record<string, unknown>;
    const domain = FIELDS.find((d) => FIELD_SEARCH_TYPE[d] === body["filter.type"]);
    if (!domain) return { status: 400, body: { errors: [{ message: "unexpected request" }] } };
    const nth = (perDomain.get(domain) ?? 0) + 1;
    perDomain.set(domain, nth);
    const entry: InsightsCall = { domain, body, nth };
    fetched.push(entry);
    const out = responder(entry);
    if (!Array.isArray(out)) return { status: out.status, body: { errors: [{ message: "synthetic failure" }] } };
    return { body: { success: true, results: { entities: out, duration: 5 } } };
  });
  return {
    cache,
    fetched,
    client(opts = {}) {
      const traces: QlooCallTraceEvent[] = [];
      // `gate: false` is a closed gate on a copy, so the closed-gate path stays tested now that the real registry is open.
      const registry = { ...REGISTRY, post: { ...REGISTRY.post, confirmedBodyParams: opts.gate === false ? [] : OPEN_GATE } };
      const client = createQlooClient({
        mode: opts.mode ?? "record",
        cache,
        fetch: f.fetch,
        env: () => ENV,
        onTrace: (e) => traces.push(e),
        sleep: async () => {},
        limits: { MIN_REQUEST_INTERVAL_MS: 0 },
        registry,
      });
      return { client, traces, preflight: (p, o) => void prepareInsights(p, registry, { purpose: o.purpose }) };
    },
  };
}

// ---- fake model -----------------------------------------------------------------------------------------------

type Rec = Record<string, unknown>;
export type ModelResponder = (tool: string, user: Rec, system: string) => Rec | undefined;

/** A model that answers every tool with valid, plain output built only from what the user message holds. */
export const goodModel: ModelResponder = (tool, user) => {
  if (tool === "choose_themes") {
    const domains = (user.domains as { domain: string; options: { axisId: string }[] }[]) ?? [];
    return {
      themes: domains.map((d, i) => ({
        domain: d.domain,
        axisId: d.options[i % d.options.length]!.axisId,
        reason: "Several of the seeds lean this way, which gives the search a clear direction.",
      })),
    };
  }
  if (tool === "decide_requeries") {
    const budget = Number(user.budget ?? 0);
    const flagged = (user.flagged as { domain: string; actions: { action: string; axisId?: string }[] }[]) ?? [];
    return {
      decisions: flagged.slice(0, budget).flatMap((f) => (f.actions[0] ? [{ domain: f.domain, action: f.actions[0].action, ...(f.actions[0].axisId ? { axisId: f.actions[0].axisId } : {}) }] : [])),
    };
  }
  if (tool === "write_cards") {
    const picks = (user.picks as { ref: string; seed: { name: string; field: string }; themeTags: string[]; pick: { name: string; field: string } }[]) ?? [];
    return {
      cards: picks.map((p) => ({
        ref: p.ref,
        why: `${p.seed.name} and ${p.pick.name} share ${p.themeTags.length === 1 ? "the theme" : "the themes"} ${p.themeTags.join(" and ")}. Tracing ${p.themeTags.length === 1 ? "it" : "them"} into ${p.pick.field} may help you notice ${p.themeTags.length === 1 ? "it" : "them"} in ${p.seed.name}.`,
        different: `This one sits in ${p.pick.field} while the seed sits in ${p.seed.field}, and only the named themes link them.`,
      })),
    };
  }
  return undefined;
};

export interface ModelCall {
  tool: string;
  system: string;
  user: Rec;
}

export interface FakeAnthropic {
  fetch: typeof fetch;
  /** Requests that reached the fake endpoint. */
  calls: ModelCall[];
  /** Raw request bodies' headers, to check where the key goes. */
  headers: Record<string, string>[];
  /** Raw JSON bodies, as sent. */
  bodies: string[];
}

export function fakeAnthropic(respond: ModelResponder = goodModel): FakeAnthropic {
  const calls: ModelCall[] = [];
  const headers: Record<string, string>[] = [];
  const bodies: string[] = [];
  const fn = (async (_url: string, init?: RequestInit) => {
    const raw = String(init?.body ?? "{}");
    bodies.push(raw);
    headers.push({ ...(init?.headers as Record<string, string>) });
    const body = JSON.parse(raw) as { tools: { name: string }[]; system: string; messages: { content: string }[] };
    const tool = body.tools[0]!.name;
    const user = JSON.parse(body.messages[0]!.content) as Rec;
    calls.push({ tool, system: body.system, user });
    const input = respond(tool, user, body.system);
    if (!input) return new Response(JSON.stringify({ error: { message: "synthetic failure with a secret detail" } }), { status: 500 });
    return new Response(JSON.stringify({ stop_reason: "tool_use", content: [{ type: "tool_use", id: "tu_1", name: tool, input }] }), { status: 200 });
  }) as unknown as typeof fetch;
  return { fetch: fn, calls, headers, bodies };
}

export const TEST_MODEL_KEY = "synthetic-anthropic-key";

/** The real model client talking to the fake endpoint. */
export function modelFor(fake: FakeAnthropic, cache: LlmCache = createLlmCache()): Llm {
  return createAnthropicLlm({ apiKey: TEST_MODEL_KEY, model: "claude-sonnet-5-5", fetch: fake.fetch, cache });
}

// ---- running ----------------------------------------------------------------------------------------------------

/** A refs context with no network and no Wikidata (no contact). Qloo-sourced lineage still works. */
export function offlineRefs() {
  return createRefsContext({
    fetch: async () => {
      throw new Error("no network in tests");
    },
    contact: "none",
    cache: createRefsCache(),
    block: { until: 0 },
  });
}

export interface WorldRun {
  result: RunResult;
  events: TraceEvent[];
  traces: QlooCallTraceEvent[];
  client: QlooClient;
}

/** One run through the real client (record mode, in-memory cache) against the fake network. */
export async function runWorld(opts: { qloo: FakeQloo; llm: Llm; input?: RunInput; gate?: boolean; mode?: "record" | "replay"; exclude?: string[]; plan?: RunInput["plan"]; domains?: RunInput["domains"]; signal?: AbortSignal }): Promise<WorldRun> {
  const { client, traces, preflight } = opts.qloo.client({ gate: opts.gate, mode: opts.mode });
  const events: TraceEvent[] = [];
  // The client's own call events join the stream, as in production (the handler wires onTrace to emit).
  const record = traces.push.bind(traces);
  traces.push = (...items: QlooCallTraceEvent[]) => {
    events.push(...items);
    return record(...items);
  };
  const base = opts.input ?? input();
  const deps: RunDeps = {
    insights: (p, o) => client.insights(p, o),
    preflight,
    refs: offlineRefs(),
    llm: opts.llm,
    emit: (e) => events.push(e),
    signal: opts.signal,
    qlooStats: () => {
      const s = client.stats();
      return { liveCalls: s.liveCalls, cacheHits: s.cacheHits };
    },
  };
  const result = await runAgent({ ...base, ...(opts.exclude ? { exclude: opts.exclude } : {}), ...(opts.plan ? { plan: opts.plan } : {}), ...(opts.domains ? { domains: opts.domains } : {}) }, deps);
  return { result, events, traces, client };
}

/** Every event must pass the shared guard. Returns the offenders (empty when all pass). */
export const badEvents = (events: readonly TraceEvent[]): TraceEvent[] => events.filter((e) => !isTraceEvent(e));
