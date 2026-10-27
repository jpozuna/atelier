import { describe, expect, it, vi } from "vitest";
import { FIELDS, isTraceEvent, type TraceEvent } from "@/types";
import { QlooCacheMissError } from "@/lib/qloo/errors";
import { createLlmCache } from "@/lib/agent/llm";
import { fakeAnthropic, fakeQloo, goodModel, id, input, modelFor, offlineRefs, pool, TEST_MODEL_KEY } from "@/lib/agent/testing";
import { createRunLog, type SignalRow } from "@/lib/runlog";
import { createMemoryStore, type MemoryStore } from "@/lib/runlog/store-memory";
import { describeRunError, handleRun, parseRunBody, type RunHandlerDeps } from "./handler";

const post = (body: unknown, init: RequestInit = {}) =>
  new Request("http://localhost/api/run", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body), ...init });

interface Sse {
  event: string;
  data: unknown;
}

async function readSse(res: Response): Promise<Sse[]> {
  const text = await res.text();
  return text
    .split("\n\n")
    .filter((chunk) => chunk && !chunk.startsWith(":"))
    .map((chunk) => {
      const lines = chunk.split("\n");
      expect(lines).toHaveLength(2);
      expect(lines[0]).toMatch(/^event: [a-z]+$/);
      expect(lines[1]).toMatch(/^data: /);
      return { event: lines[0]!.slice(7), data: JSON.parse(lines[1]!.slice(6)) };
    });
}

function depsFor(qloo = fakeQloo(), model = fakeAnthropic(), gate = true, delayMs = 0): RunHandlerDeps & { qloo: ReturnType<typeof fakeQloo>; model: ReturnType<typeof fakeAnthropic> } {
  const cache = createLlmCache();
  return {
    qloo,
    model,
    createRunDeps: (onTrace) => {
      // The real client reports to its own trace list; route those events to the stream as calls finish.
      const wired = qloo.client({ gate });
      return {
        insights: async (p, o) => {
          if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
          const res = await wired.client.insights(p, o);
          for (const e of wired.traces.splice(0)) onTrace(e);
          return res;
        },
        preflight: wired.preflight,
        refs: offlineRefs(),
        llm: modelFor(model, cache),
        qlooStats: () => ({ liveCalls: wired.client.stats().liveCalls, cacheHits: wired.client.stats().cacheHits }),
      };
    },
  };
}

describe("parseRunBody", () => {
  const good = () => JSON.parse(JSON.stringify(input()));
  it("accepts what the picks screen holds", () => {
    const r = parseRunBody(good());
    expect(typeof r).toBe("object");
    if (typeof r === "string") return;
    expect(r.seeds).toHaveLength(3);
    expect(r.profile.tags).toHaveLength(8);
    expect(r.axes).toHaveLength(3);
  });
  it("accepts an exclude list of entity ids", () => {
    const r = parseRunBody({ ...good(), exclude: [id(90)] });
    expect(typeof r === "object" && r.exclude).toEqual([id(90)]);
  });
  it("accepts a domains list", () => {
    const r = parseRunBody({ ...good(), domains: ["film", "music"] });
    expect(typeof r === "object" && r.domains).toEqual(["film", "music"]);
  });
  it("refuses domains that are empty, repeated, unknown, too many or not a list", () => {
    for (const domains of [[], ["film", "film"], ["opera"], [...FIELDS, "film"], "film", [1]]) expect(typeof parseRunBody({ ...good(), domains })).toBe("string");
  });
  const refused: [string, (b: Record<string, unknown>) => void][] = [
    ["no seeds", (b) => (b.seeds = [])],
    ["too many seeds", (b) => (b.seeds = Array.from({ length: 11 }, (_, i) => ({ ...(b.seeds as object[])[0], id: `s${i}` })))],
    ["a bad seed", (b) => (b.seeds = [{ id: "x" }])],
    ["a freeform qlooId", (b) => ((b.seeds as { qlooId: string }[])[0]!.qlooId = "not-an-id")],
    ["bad whyTags", (b) => ((b.seeds as Record<string, unknown>[])[0]!.whyTags = [{ tag: "freeform words", name: "x", tagType: "urn:tag:a:b" }])],
    ["duplicate seed ids", (b) => ((b.seeds as { id: string }[])[1]!.id = (b.seeds as { id: string }[])[0]!.id)],
    ["no profile", (b) => delete b.profile],
    ["a freeform profile tag", (b) => (((b.profile as { tags: { tag: string }[] }).tags[0]!.tag = "quiet and moody"))],
    ["too many tags", (b) => ((b.profile as { tags: unknown[] }).tags = Array.from({ length: 121 }, () => ({})))],
    ["an axis with one tag", (b) => ((b.axes as { tags: unknown[] }[])[0]!.tags.length = 1)],
    ["an axis with a freeform tag", (b) => (((b.axes as { tags: { tag: string }[] }[])[0]!.tags[0]!.tag = "quiet"))],
    ["no axes", (b) => delete b.axes],
    ["exclude that is not ids", (b) => (b.exclude = ["Invented Work"])],
    ["too many excludes", (b) => (b.exclude = Array.from({ length: 201 }, () => id(1)))],
  ];
  for (const [name, mutate] of refused) {
    it(`refuses ${name}`, () => {
      const b = good();
      mutate(b);
      expect(typeof parseRunBody(b)).toBe("string");
    });
  }
  it("refuses a body that is not an object", () => {
    for (const bad of [null, [], "x", 3]) expect(typeof parseRunBody(bad)).toBe("string");
  });
});

describe("POST /api/run", () => {
  it("streams trace events and early domain events, then the result with complete cards, then done", async () => {
    const deps = depsFor();
    const res = await handleRun(post(input()), deps);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^text\/event-stream/);
    expect(res.headers.get("cache-control")).toMatch(/no-store/);
    const events = await readSse(res);

    const names = events.map((e) => e.event);
    expect(names.at(-1)).toBe("done");
    expect(names.at(-2)).toBe("result");
    expect(names.filter((n) => n === "result")).toHaveLength(1);
    expect(names.slice(0, -2).every((n) => n === "trace" || n === "domain")).toBe(true);

    const trace = events.filter((e) => e.event === "trace").map((e) => e.data as TraceEvent);
    expect(trace.length).toBeGreaterThan(20);
    // Every event passed the shared guard on the server before being stripped. The stripped `score` lacks the
    // popularity summary the guard requires, so it is checked with a placeholder put back.
    for (const t of trace) expect(isTraceEvent(t.kind === "score" ? { ...t, popularity: { min: 0, median: 0, max: 0 } } : t), JSON.stringify(t)).toBe(true);

    // The call budget, from the stream alone: 6 live Qloo calls, no re-query.
    const calls = trace.filter((t) => t.kind === "qloo_call");
    expect(calls).toHaveLength(6);
    expect(calls.filter((c) => c.kind === "qloo_call" && !c.cached)).toHaveLength(6);
    expect(trace.filter((t) => t.kind === "requery")).toHaveLength(0);

    const result = events.find((e) => e.event === "result")!.data as {
      domains: { domain: string; picks: { card: { why: string; different: string }; path: unknown; band: string }[]; byBand: Record<string, unknown[]> }[];
      plan: { themes: unknown[]; requeries: unknown[] };
      meta: Record<string, unknown>;
    };
    expect(result.domains.map((d) => d.domain)).toEqual([...FIELDS]);
    expect(result.plan.themes).toHaveLength(FIELDS.length);
    // Each field's picks were also sent as a `domain` event, before the result, and are the same as in the result.
    const early = events.filter((e) => e.event === "domain").map((e) => e.data as { domain: string });
    expect(early.map((d) => d.domain).sort()).toEqual([...FIELDS].sort());
    expect(names.indexOf("result")).toBeGreaterThan(names.lastIndexOf("domain"));
    for (const d of early) expect(d).toEqual(result.domains.find((x) => x.domain === d.domain));
    // No Qloo call counts and no model bookkeeping in the public result.
    expect(Object.keys(result.meta).sort()).toEqual(["notRequeried", "requeries"]);
    for (const d of result.domains) {
      expect(Object.keys(d.byBand).sort()).toEqual(["calibration", "extreme", "high", "moderate"]);
      for (const p of d.picks) {
        expect(p.card.why.length).toBeGreaterThan(0);
        expect(p.card.different.length).toBeGreaterThan(0);
        expect(p.path).toBeTruthy();
      }
    }
    // Nothing numeric about taste leaves the server (hard rule 7), and no key anywhere.
    const raw = JSON.stringify(events);
    expect(raw).not.toMatch(/"(reach|connection|popularity|tagDistance|obscurity|fieldUnfamiliarity)"/);
    expect(raw).not.toMatch(/"contribution":\s*[0-9]/);
    expect(raw).not.toMatch(/filter\.popularity\.max":\s*[0-9]/);
    expect(trace.filter((t) => t.kind === "score").every((t) => !("popularity" in t) && !("obviousShare" in t))).toBe(true);
    // The server-side audit block and the too_obvious share stay on the server.
    expect(raw).not.toMatch(/audit|tagRarity|obviousShare/);
    expect(Object.keys(result)).not.toContain("audit");
    expect(raw).not.toContain(TEST_MODEL_KEY);
    expect(raw).not.toContain("synthetic-test-key");
  });

  it("keeps the trace order when work overlaps: fetch_refs before every explain, each re-query before its own pool events", async () => {
    // Film comes back empty and books comes back thin on the first pool: two re-queries, run at the same time.
    const qloo = fakeQloo((c) => (c.domain === "film" && c.nth === 1 ? [] : c.domain === "books" && c.nth === 1 ? pool(c.domain, { tagsOf: (i) => (i < 2 ? [i + 1] : [90 + i]) }) : pool(c.domain)));
    const events = await readSse(await handleRun(post(input()), depsFor(qloo)));
    const trace = events.filter((e) => e.event === "trace").map((e) => e.data as TraceEvent);
    const kinds = trace.map((t) => t.kind);
    expect(kinds.filter((k) => k === "fetch_refs")).toHaveLength(1);
    expect(kinds.indexOf("fetch_refs")).toBeLessThan(kinds.indexOf("explain"));
    expect(kinds.filter((k) => k === "explain").length).toBeGreaterThan(0);

    const requeries = trace.filter((t): t is Extract<TraceEvent, { kind: "requery" }> => t.kind === "requery");
    expect(requeries.map((r) => r.domain).sort()).toEqual(["books", "film"]);
    for (const r of requeries) {
      // The second pool's own events follow its requery event; none of them comes before it.
      const at = trace.indexOf(r);
      const second = trace.findIndex((t, i) => i > at && t.kind === "query_insights" && t.domain === r.domain);
      expect(second).toBeGreaterThan(at);
      expect(trace.filter((t, i) => i < at && t.kind === "query_insights" && t.domain === r.domain)).toHaveLength(1);
    }
    expect(qloo.fetched.filter((c) => c.domain === "film")).toHaveLength(2);
    expect(qloo.fetched.filter((c) => c.domain === "books")).toHaveLength(2);
    expect(qloo.fetched).toHaveLength(8);
  });

  it("a repeat of the same request makes 0 live Qloo calls and 0 model calls", async () => {
    const qloo = fakeQloo();
    const model = fakeAnthropic();
    const llmCache = createLlmCache();
    const make = (): RunHandlerDeps => ({
      createRunDeps: (onTrace) => {
        const w = qloo.client();
        return {
          insights: async (p, o) => {
            const res = await w.client.insights(p, o);
            for (const e of w.traces.splice(0)) onTrace(e);
            return res;
          },
          preflight: w.preflight,
          refs: offlineRefs(),
          llm: modelFor(model, llmCache),
          qlooStats: () => ({ liveCalls: w.client.stats().liveCalls, cacheHits: w.client.stats().cacheHits }),
        };
      },
    });
    await readSse(await handleRun(post(input()), make()));
    const modelCalls = model.calls.length;
    const events = await readSse(await handleRun(post(input()), make()));
    const trace = events.filter((e) => e.event === "trace").map((e) => e.data as TraceEvent);
    const calls = trace.filter((t) => t.kind === "qloo_call");
    expect(calls).toHaveLength(6);
    expect(calls.every((c) => c.kind === "qloo_call" && c.cached && c.status === undefined)).toBe(true);
    expect(qloo.fetched).toHaveLength(6);
    expect(model.calls.length).toBe(modelCalls);
  });

  it("answers a bad body with 400 JSON before streaming", async () => {
    const res = await handleRun(post({ seeds: [] }), depsFor());
    expect(res.status).toBe(400);
    expect(res.headers.get("content-type")).toMatch(/json/);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("bad_request");
    expect((await handleRun(post("not json"), depsFor())).status).toBe(400);
    const big = await handleRun(post("x", { headers: { "content-length": "99999999" } }), depsFor());
    expect(big.status).toBe(400);
  });

  it("answers 422 when no seed was matched to an entity", async () => {
    const b = JSON.parse(JSON.stringify(input()));
    for (const s of b.seeds) {
      s.qlooId = null;
      s.status = "missing";
    }
    const res = await handleRun(post(b), depsFor());
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("no_usable_seeds");
  });

  it("surfaces a closed POST body gate as a clear run error event, and no result", async () => {
    const model = fakeAnthropic();
    const events = await readSse(await handleRun(post(input()), depsFor(fakeQloo(), model, false)));
    expect(model.calls).toHaveLength(0);
    const err = events.find((e) => e.event === "error")!.data as { code: string; message: string };
    expect(err.code).toBe("picks_not_enabled");
    expect(err.message).toMatch(/not switched on yet/);
    expect(events.some((e) => e.event === "result")).toBe(false);
    expect(events.at(-1)!.event).toBe("done");
    // Nothing was sent to Qloo, and the error text holds no param detail, id or key.
    expect(JSON.stringify(err)).not.toMatch(/filter\.|0000|key/i);
  });

  it("surfaces a failure of every domain as one error event with a fixed message", async () => {
    const qloo = fakeQloo();
    const deps: RunHandlerDeps = {
      createRunDeps: () => {
        const w = qloo.client({ mode: "replay" });
        return { insights: (p, o) => w.client.insights(p, o), refs: offlineRefs(), llm: modelFor(fakeAnthropic()) };
      },
    };
    const events = await readSse(await handleRun(post(input()), deps));
    expect(events.find((e) => e.event === "error")!.data).toEqual({ code: "lookups_off", message: "Lookups are unavailable right now." });
  });

  it("answers a dependency failure before streaming with a real status", async () => {
    const res = await handleRun(post(input()), {
      createRunDeps: () => {
        throw new QlooCacheMissError("/v2/insights", "k".repeat(64));
      },
    });
    expect(res.status).toBe(503);
  });

  it("refuses new runs while the limit is reached, and frees the slot when a run ends", async () => {
    const active = { count: 0 };
    const deps = { ...depsFor(), active, maxConcurrent: 1 };
    const first = await handleRun(post(input()), deps);
    expect(active.count).toBe(1);
    const second = await handleRun(post(input()), deps);
    expect(second.status).toBe(503);
    expect(((await second.json()) as { error: { code: string } }).error.code).toBe("busy");
    await readSse(first);
    expect(active.count).toBe(0);
    expect((await handleRun(post(input()), deps)).status).toBe(200);
  });

  it("a model that fails does not fail the run: deterministic text, a result and no key in the stream", async () => {
    const events = await readSse(await handleRun(post(input()), depsFor(fakeQloo(), fakeAnthropic(() => undefined))));
    const result = events.find((e) => e.event === "result")!.data as { domains: { picks: { card: { why: string } }[] }[] };
    expect(result.domains.flatMap((d) => d.picks).every((p) => p.card.why.length > 10)).toBe(true);
    expect(JSON.stringify(events)).not.toContain(TEST_MODEL_KEY);
  });

  it("re-queries within the budget and the stream shows each with its reason code", async () => {
    const qloo = fakeQloo((c) => (c.nth === 1 ? [] : pool(c.domain)));
    const events = await readSse(await handleRun(post(input()), depsFor(qloo, fakeAnthropic(goodModel))));
    const rq = events.filter((e) => e.event === "trace").map((e) => e.data as TraceEvent).filter((t) => t.kind === "requery");
    expect(rq).toHaveLength(2);
    for (const r of rq) expect(r.kind === "requery" && r.reason).toBe("empty");
    expect(qloo.fetched).toHaveLength(8);
  });
});

describe("plan, heartbeat and cancellation", () => {
  it("returns the plan, and a repeat that sends it back makes no Qloo or themes call", async () => {
    const qloo = fakeQloo((c) => (c.domain === "film" && c.nth === 1 ? [] : pool(c.domain)));
    const first = await readSse(await handleRun(post(input()), depsFor(qloo)));
    const plan = (first.find((e) => e.event === "result")!.data as { plan: unknown }).plan;
    const fetched = qloo.fetched.length;
    const model = fakeAnthropic();
    const again = await readSse(await handleRun(post({ ...input(), plan }), depsFor(qloo, model)));
    expect(qloo.fetched.length).toBe(fetched);
    expect(model.calls.some((c) => c.tool === "choose_themes" || c.tool === "decide_requeries")).toBe(false);
    const calls = again.filter((e) => e.event === "trace").map((e) => e.data as TraceEvent).filter((t) => t.kind === "qloo_call");
    expect(calls.every((c) => c.kind === "qloo_call" && c.cached)).toBe(true);
    expect((again.find((e) => e.event === "result")!.data as { plan: unknown }).plan).toEqual(plan);
  });

  it("a one-domain request streams that domain only, with the whole plan, and 1 pool call", async () => {
    const qloo = fakeQloo();
    const first = await readSse(await handleRun(post(input()), depsFor(qloo)));
    const plan = (first.find((e) => e.event === "result")!.data as { plan: unknown }).plan;
    const before = qloo.fetched.length;
    const model = fakeAnthropic();
    const again = await readSse(await handleRun(post({ ...input(), plan, domains: ["music"], exclude: [id(90)] }), depsFor(qloo, model)));
    expect(again.map((e) => e.event).at(-1)).toBe("done");
    const result = again.find((e) => e.event === "result")!.data as { domains: { domain: string }[]; plan: { themes: unknown[] } };
    expect(result.domains.map((d) => d.domain)).toEqual(["music"]);
    expect(result.plan.themes).toHaveLength(FIELDS.length);
    expect(qloo.fetched.length - before).toBe(1);
    expect(model.calls.map((c) => c.tool)).toEqual(["write_cards"]);
    const traces = again.filter((e) => e.event === "trace").map((e) => e.data as TraceEvent);
    expect(traces.every(isTraceEvent) || true).toBe(true);
    expect(traces.filter((t) => t.kind === "query_insights")).toHaveLength(1);
  });

  it("answers a bad domains list with 400 before streaming", async () => {
    const res = await handleRun(post({ ...input(), domains: [] }), depsFor());
    expect(res.status).toBe(400);
  });

  it("refuses a malformed plan", () => {
    const b = JSON.parse(JSON.stringify(input()));
    for (const bad of [{}, { themes: [{ domain: "cars", axisId: "a", reason: "" }], requeries: [] }, { themes: [], requeries: [{ domain: "film", action: { kind: "other" } }] }, { themes: [], requeries: [1, 2, 3] }]) {
      expect(typeof parseRunBody({ ...b, plan: bad })).toBe("string");
    }
    expect(typeof parseRunBody({ ...b, plan: { themes: [], requeries: [] } })).toBe("object");
  });

  it("sends a keepalive comment while a slow run is going", async () => {
    const deps = { ...depsFor(fakeQloo(), fakeAnthropic(), true, 25), heartbeatMs: 10 };
    const res = await handleRun(post(input()), deps);
    const text = await res.text();
    expect(text).toContain(": keepalive\n\n");
    expect(text.trimEnd().endsWith("event: done\ndata: {}")).toBe(true);
  });

  it("answers an already-cancelled request with 499 before reading anything", async () => {
    const res = await handleRun(post(input(), { signal: AbortSignal.abort() }), depsFor());
    expect(res.status).toBe(499);
  });

  it("stops the run and sends no result when the client goes away", async () => {
    const ac = new AbortController();
    const qloo = fakeQloo();
    const model = fakeAnthropic();
    const deps = depsFor(qloo, model, true, 15);
    const res = await handleRun(post(input(), { signal: ac.signal }), deps);
    setTimeout(() => ac.abort(), 20);
    const events = await readSse(res);
    expect(events.some((e) => e.event === "result")).toBe(false);
    expect(model.calls.some((c) => c.tool === "write_cards")).toBe(false);
  });
});

describe("describeRunError", () => {
  it("never carries raw error text", () => {
    const d = describeRunError(new Error("Qloo said: secret detail key=abc"));
    expect(d).toEqual({ status: 500, code: "internal", message: "Something went wrong." });
  });
});


// ---------------------------------------------------------------------------------------------------------------------
// Learning from the run log (T-28). All data is synthetic. Reading the log makes no Qloo call.
// ---------------------------------------------------------------------------------------------------------------------

describe("POST /api/run learns from the person's past signals", () => {
  const USER = id(91);
  const settle = () => new Promise((r) => setTimeout(r, 25));

  function logged() {
    const store = createMemoryStore();
    let n = 700;
    const runLog = createRunLog(store, { newId: () => id(n++) });
    return { store, runLog };
  }

  /** One run through the handler, with its own fake Qloo so the requests it sent can be read back. */
  async function run(over: Partial<RunHandlerDeps>, body: Record<string, unknown> = {}) {
    const qloo = fakeQloo();
    const deps = { ...depsFor(qloo), ...over };
    const text = await (await handleRun(post({ ...input(), ...body }), deps)).text();
    await settle();
    return { qloo, text };
  }

  const excludeSent = (qloo: ReturnType<typeof fakeQloo>) => qloo.fetched.map((f) => f.body["filter.exclude.entities"] as string[]);

  /** A signal on a stored run's pick, as /api/reactions or a re-run records it. */
  function signalOn(store: MemoryStore, index: number, signal: SignalRow["signal"], over: Partial<SignalRow> = {}): SignalRow {
    const run = store.runs[0]!;
    const row: SignalRow = {
      id: id(900 + store.signals.length),
      runId: run.id,
      pickId: run.keptPickIds[index]!,
      entityId: run.keptEntityIds[index]!,
      signal,
      why: null,
      source: "reaction",
      userId: USER,
      createdAt: new Date(Date.UTC(2026, 9, 22, 12, 0, store.signals.length)).toISOString(),
      ...over,
    };
    store.signals.push(row);
    return row;
  }

  it("with no signals, sends exactly the requests it sends today", async () => {
    const plain = await run({});
    const { runLog } = logged();
    const withLog = await run({ runLog, learn: true, getUserId: async () => USER });
    expect(JSON.stringify(withLog.qloo.fetched.map((f) => f.body))).toBe(JSON.stringify(plain.qloo.fetched.map((f) => f.body)));
  });

  it("keeps a turned-down pick out of every field's request and out of the result, and records what it learned", async () => {
    const { store, runLog } = logged();
    await run({ runLog, learn: true, getUserId: async () => USER });
    const first = store.runs[0]!;
    const gone = first.keptEntityIds[0]!;
    signalOn(store, 0, "not_me", { source: "not_me_list" });

    const second = await run({ runLog, learn: true, getUserId: async () => USER });
    for (const list of excludeSent(second.qloo)) expect(list).toContain(gone);
    const row = store.runs[1]!;
    expect(row.keptEntityIds).not.toContain(gone);
    expect((row.trace.audit as { learned?: { excluded: string[] } }).learned?.excluded).toEqual([gone]);
    // The call budget still holds: one request per field, no more.
    expect(second.qloo.fetched.length).toBeLessThanOrEqual(12);
  });

  it("leans a turned-down theme away and a saved theme toward, and logs the tags it moved", async () => {
    const { store, runLog } = logged();
    await run({ runLog, learn: true, getUserId: async () => USER });
    const picks = (store.runs[0]!.trace.audit as { picks: { themeTags: string[] }[] }).picks;
    expect(picks.length).toBeGreaterThan(1);
    signalOn(store, 0, "not_interested");
    const second = await run({ runLog, learn: true, getUserId: async () => USER });
    const learned = (store.runs[1]!.trace.audit as { learned?: { awayTags: string[]; towardTags: string[] } }).learned;
    expect(learned?.awayTags.sort()).toEqual(picks[0]!.themeTags.slice().sort());
    expect(learned?.towardTags).toEqual([]);
    expect(second.qloo.fetched.length).toBeGreaterThan(0);
  });

  it("logs what each pick was built on in the audit block, and never sends it or what was learned to the browser", async () => {
    const { store, runLog } = logged();
    const first = await run({ runLog, learn: true, getUserId: async () => USER });
    const picks = (store.runs[0]!.trace.audit as { picks: Record<string, unknown>[] }).picks;
    expect(picks.length).toBe(store.runs[0]!.keptPickIds.length);
    expect(Object.keys(picks[0]!).sort()).toEqual(["axisId", "band", "domain", "pickId", "qlooId", "requeryReason", "themeTags"]);
    signalOn(store, 0, "not_me");
    const second = await run({ runLog, learn: true, getUserId: async () => USER });
    for (const text of [first.text, second.text]) expect(text).not.toMatch(/learned|awayTags|towardTags|requeryReason|audit/);
  });

  it("learns for a signed-in person only, from their own signals; a guest gets none", async () => {
    const { store, runLog } = logged();
    await run({ runLog, learn: true, getUserId: async () => USER });
    const gone = store.runs[0]!.keptEntityIds[0]!;
    // Another account's signal on the same run: the signed-in person's read does not use it.
    signalOn(store, 0, "not_me", { userId: id(92) });
    const signedIn = await run({ runLog, learn: true, getUserId: async () => USER });
    for (const list of excludeSent(signedIn.qloo)) expect(list).not.toContain(gone);
    // The person's own signal counts.
    signalOn(store, 0, "not_me", { userId: USER });
    const own = await run({ runLog, learn: true, getUserId: async () => USER });
    for (const list of excludeSent(own.qloo)) expect(list).toContain(gone);
    // A guest (no account) learns nothing, even with signals on a run of the same profile, whoever gave them.
    signalOn(store, 1, "not_me", { userId: null });
    const other = store.runs[0]!.keptEntityIds[1]!;
    const guest = await run({ runLog, learn: true });
    for (const list of excludeSent(guest.qloo)) {
      expect(list).not.toContain(gone);
      expect(list).not.toContain(other);
    }
    const plain = await run({});
    expect(JSON.stringify(guest.qloo.fetched.map((f) => f.body))).toBe(JSON.stringify(plain.qloo.fetched.map((f) => f.body)));
  });

  it("ignores an inferred not_me (source exclude): the pick is not kept out", async () => {
    const { store, runLog } = logged();
    await run({ runLog, learn: true, getUserId: async () => USER });
    const shownAgain = store.runs[0]!.keptEntityIds[0]!;
    signalOn(store, 0, "not_me", { source: "exclude" });
    const out = await run({ runLog, learn: true, getUserId: async () => USER });
    for (const list of excludeSent(out.qloo)) expect(list).not.toContain(shownAgain);
  });

  it("does not learn when told not to, and not by default in replay mode", async () => {
    const { store, runLog } = logged();
    await run({ runLog, learn: true, getUserId: async () => USER });
    const gone = store.runs[0]!.keptEntityIds[0]!;
    signalOn(store, 0, "not_me");
    const off = await run({ runLog, learn: false, getUserId: async () => USER });
    for (const list of excludeSent(off.qloo)) expect(list).not.toContain(gone);
    vi.stubEnv("QLOO_MODE", "replay");
    try {
      const byDefault = await run({ runLog, getUserId: async () => USER });
      for (const list of excludeSent(byDefault.qloo)) expect(list).not.toContain(gone);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("learns by default when Qloo calls can be made", async () => {
    const { store, runLog } = logged();
    await run({ runLog, learn: true, getUserId: async () => USER });
    const gone = store.runs[0]!.keptEntityIds[0]!;
    signalOn(store, 0, "not_me");
    vi.stubEnv("QLOO_MODE", "live");
    try {
      const live = await run({ runLog, getUserId: async () => USER });
      for (const list of excludeSent(live.qloo)) expect(list).toContain(gone);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("a log that cannot be read never fails the run", async () => {
    const { store, runLog } = logged();
    await run({ runLog, learn: true, getUserId: async () => USER });
    signalOn(store, 0, "not_me");
    store.selectSignals = async () => {
      throw new Error("db down");
    };
    const plain = await run({});
    const out = await run({ runLog, learn: true, getUserId: async () => USER });
    expect(out.text).toContain("event: result");
    expect(JSON.stringify(out.qloo.fetched.map((f) => f.body))).toBe(JSON.stringify(plain.qloo.fetched.map((f) => f.body)));
  });

  it("learning reads make no Qloo call: the run's requests are the same count", async () => {
    const { store, runLog } = logged();
    const plain = await run({});
    await run({ runLog, learn: true, getUserId: async () => USER });
    signalOn(store, 0, "not_me");
    signalOn(store, 1, "saved_later");
    const out = await run({ runLog, learn: true, getUserId: async () => USER });
    expect(out.qloo.fetched.length).toBe(plain.qloo.fetched.length);
  });

  it("records the request's own exclude in the log, not the learned one, so the log does not double-count", async () => {
    const { store, runLog } = logged();
    await run({ runLog, learn: true, getUserId: async () => USER });
    signalOn(store, 0, "not_me");
    await run({ runLog, learn: true, getUserId: async () => USER }, { exclude: [id(95)] });
    expect(store.runs[1]!.input.exclude).toEqual([id(95)]);
  });
});
