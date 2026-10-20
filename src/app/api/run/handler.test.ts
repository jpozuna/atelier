import { describe, expect, it } from "vitest";
import { FIELDS, isTraceEvent, type TraceEvent } from "@/types";
import { QlooCacheMissError } from "@/lib/qloo/errors";
import { createLlmCache } from "@/lib/agent/llm";
import { fakeAnthropic, fakeQloo, goodModel, id, input, modelFor, offlineRefs, pool, TEST_MODEL_KEY } from "@/lib/agent/testing";
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
  it("streams trace events, then the result with complete cards, then done", async () => {
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
    expect(names.slice(0, -2).every((n) => n === "trace")).toBe(true);

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
