// The private run log as seen from POST /api/run: written once after the stream ends, never blocking or failing the
// run, and never visible to the browser. All data is synthetic.

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { isTraceEvent, type TraceEvent } from "@/types";
import { createLlmCache } from "@/lib/agent/llm";
import { fakeAnthropic, fakeQloo, id, input, modelFor, offlineRefs } from "@/lib/agent/testing";
import { createRunLog, hashProfile, type RunLog } from "@/lib/runlog";
import { createMemoryStore } from "@/lib/runlog/store-memory";
import { handleRun, parseNotMe, type RunHandlerDeps } from "./handler";

const post = (body: unknown) => new Request("http://localhost/api/run", { method: "POST", body: JSON.stringify(body) });
const USER = id(91);

function deps(over: Partial<RunHandlerDeps> = {}, gate = true, delayMs = 0, extraEvents: unknown[] = []): RunHandlerDeps {
  const qloo = fakeQloo();
  const model = fakeAnthropic();
  const cache = createLlmCache();
  return {
    createRunDeps: (onTrace) => {
      const w = qloo.client({ gate });
      return {
        insights: async (p, o) => {
          if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
          for (const e of extraEvents) onTrace(e as TraceEvent);
          const res = await w.client.insights(p, o);
          for (const e of w.traces.splice(0)) onTrace(e);
          return res;
        },
        preflight: w.preflight,
        refs: offlineRefs(),
        llm: modelFor(model, cache),
        qlooStats: () => ({ liveCalls: w.client.stats().liveCalls, cacheHits: w.client.stats().cacheHits }),
      };
    },
    ...over,
  };
}

/** Wait until background work has had a chance to run. */
const settle = () => new Promise((r) => setTimeout(r, 25));

function logged() {
  const store = createMemoryStore();
  let n = 500;
  const runLog = createRunLog(store, { newId: () => id(n++) });
  return { store, runLog };
}

describe("POST /api/run writes the private run log", () => {
  it("writes one row per finished run, after the stream has ended, with the unredacted trace", async () => {
    const { store, runLog } = logged();
    const res = await handleRun(post(input()), deps({ runLog, getUserId: async () => USER }));
    const text = await res.text();
    await settle();
    expect(store.runs).toHaveLength(1);
    const row = store.runs[0]!;
    expect(row.outcome).toBe("ok");
    expect(row.userId).toBe(USER);
    expect(row.profileHash).toBe(hashProfile({ seeds: input().seeds, tagIds: input().profile.tags.map((t) => t.tag) }));
    expect(row.trace.events.length).toBeGreaterThan(20);
    expect(row.keptPickIds.length).toBeGreaterThan(0);
    expect(row.keptPickIds).toHaveLength(row.keptEntityIds.length);
    expect(row.plan?.themes.length).toBeGreaterThan(0);
    // Unredacted: the popularity summary that the stream strips is in the stored `score` events.
    expect(row.trace.events.some((e) => e.kind === "score" && "popularity" in e)).toBe(true);
    expect(text).not.toContain('"popularity"');
  });

  it("writes one row for a failed run, with the fixed code", async () => {
    const { store, runLog } = logged();
    const res = await handleRun(post(input()), deps({ runLog }, false));
    await res.text();
    await settle();
    expect(store.runs).toHaveLength(1);
    expect(store.runs[0]).toMatchObject({ outcome: "failed", errorCode: "picks_not_enabled", keptPickIds: [], plan: null, userId: null });
  });

  it("logs a client abort as a failed run with code cancelled", async () => {
    const { store, runLog } = logged();
    const ac = new AbortController();
    const req = new Request("http://localhost/api/run", { method: "POST", body: JSON.stringify(input()), signal: ac.signal });
    const res = await handleRun(req, deps({ runLog }, true, 15));
    setTimeout(() => ac.abort(), 20);
    await res.text();
    await settle();
    expect(store.runs).toHaveLength(1);
    expect(store.runs[0]).toMatchObject({ outcome: "failed", errorCode: "cancelled", keptPickIds: [], plan: null });
  });

  it("keeps an event that fails isTraceEvent out of the log (and out of the stream)", async () => {
    const { store, runLog } = logged();
    const bad = { t: 0, kind: "not_a_real_event", say: "x", secret: "bogus-marker" };
    const text = await (await handleRun(post(input()), deps({ runLog }, true, 0, [bad]))).text();
    await settle();
    const events = store.runs[0]!.trace.events;
    expect(events.length).toBeGreaterThan(20);
    expect(events.every((e) => isTraceEvent(e))).toBe(true);
    expect(JSON.stringify(events)).not.toContain("bogus-marker");
    expect(text).not.toContain("bogus-marker");
  });

  it("writes nothing for a request refused before streaming", async () => {
    const { store, runLog } = logged();
    expect((await handleRun(post({ seeds: [] }), deps({ runLog }))).status).toBe(400);
    await settle();
    expect(store.runs).toEqual([]);
  });

  it("is fire-and-forget: the stream ends while the write is still pending", async () => {
    const store = createMemoryStore();
    let release: () => void = () => {};
    const pending = new Promise<void>((r) => (release = r));
    let started = false;
    store.insertRun = async () => {
      started = true;
      await pending;
    };
    const runLog = createRunLog(store);
    const res = await handleRun(post(input()), deps({ runLog }));
    const text = await res.text();
    expect(text).toContain("event: done");
    await settle();
    expect(started).toBe(true);
    release();
  });

  it("swallows a failing store: the run still returns its result and done", async () => {
    const store = createMemoryStore();
    store.insertRun = async () => {
      throw new Error("db down: row text 00000000-0000-4000-8000-000000000001");
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await handleRun(post(input()), deps({ runLog: createRunLog(store), getUserId: async () => USER }));
    const text = await res.text();
    await settle();
    expect(res.status).toBe(200);
    expect(text).toContain("event: result");
    expect(text.trimEnd().endsWith("data: {}")).toBe(true);
    expect(text).not.toContain("db down");
    expect(warn.mock.calls.flat().join(" ")).not.toContain("db down");
    warn.mockRestore();
  });

  it("swallows a failing user lookup and logs the run as a guest's", async () => {
    const { store, runLog } = logged();
    const res = await handleRun(post(input()), deps({ runLog, getUserId: async () => Promise.reject(new Error("no session")) }));
    await res.text();
    await settle();
    expect(store.runs[0]!.userId).toBeNull();
  });

  it("hands the write to the host's after hook, and survives a hook that throws", async () => {
    const { store, runLog } = logged();
    const handed: Promise<unknown>[] = [];
    await (await handleRun(post(input()), deps({ runLog, afterResponse: (p) => void handed.push(p) }))).text();
    expect(handed).toHaveLength(1);
    await handed[0];
    expect(store.runs).toHaveLength(1);

    const second = logged();
    const res = await handleRun(post(input()), deps({ runLog: second.runLog, afterResponse: () => { throw new Error("outside a request"); } }));
    expect((await res.text()).includes("event: done")).toBe(true);
    await settle();
    expect(second.store.runs).toHaveLength(1);
  });

  it("logs nothing when the log is off or absent", async () => {
    const off: RunLog = { ...logged().runLog, store: { ...createMemoryStore(), kind: "off" } };
    const spy = vi.spyOn(off, "recordRun");
    await (await handleRun(post(input()), deps({ runLog: off }))).text();
    await (await handleRun(post(input()), deps())).text();
    await settle();
    expect(spy).not.toHaveBeenCalled();
  });

  it("never shows the browser a log id, the log's contents, or a log field", async () => {
    const { store, runLog } = logged();
    const text = await (await handleRun(post(input()), deps({ runLog, getUserId: async () => USER }))).text();
    await settle();
    const row = store.runs[0]!;
    expect(text).not.toContain(row.id);
    expect(text).not.toContain(row.profileHash);
    expect(text).not.toContain(USER);
    expect(text).not.toMatch(/runId|run_id|profileHash|profile_hash|runLog|run_log|keptPickIds|errorCode/);
  });
});

describe("a re-run with exclude records not_me", () => {
  async function twoRuns(second: Record<string, unknown>) {
    const { store, runLog } = logged();
    await (await handleRun(post(input()), deps({ runLog, getUserId: async () => USER }))).text();
    await settle();
    const first = store.runs[0]!;
    await (await handleRun(post({ ...input(), ...second }), deps({ runLog, getUserId: async () => USER }))).text();
    await settle();
    return { store, first };
  }

  it("records the explicit notMe ids against the run that showed them", async () => {
    const probe = logged();
    await (await handleRun(post(input()), deps({ runLog: probe.runLog }))).text();
    await settle();
    const shown = probe.store.runs[0]!.keptEntityIds.slice(0, 2);
    const { store, first } = await twoRuns({ exclude: shown, notMe: [shown[0]] });
    expect(store.signals).toHaveLength(1);
    expect(store.signals[0]).toMatchObject({ runId: first.id, entityId: shown[0], signal: "not_me", source: "not_me_list", userId: USER });
    expect(store.signals[0]!.pickId).toBe(first.keptPickIds[first.keptEntityIds.indexOf(shown[0]!)]);
  });

  it("without notMe, records every excluded id that a known run showed, labelled as inferred", async () => {
    const probe = logged();
    await (await handleRun(post(input()), deps({ runLog: probe.runLog }))).text();
    await settle();
    const shown = probe.store.runs[0]!.keptEntityIds.slice(0, 2);
    const { store } = await twoRuns({ exclude: [...shown, id(88)] });
    expect(store.signals.map((s) => [s.entityId, s.source])).toEqual(shown.map((e) => [e, "exclude"]));
  });

  it("makes no signal when the excluded id was never shown by a logged run", async () => {
    const { store } = await twoRuns({ exclude: [id(88)] });
    expect(store.signals).toEqual([]);
  });
});

describe("parseNotMe", () => {
  it("is absent when not sent, a list when valid, and a reason when not", () => {
    expect(parseNotMe({}, undefined)).toBeUndefined();
    expect(parseNotMe({ notMe: [id(1)] }, [id(1), id(2)])).toEqual([id(1)]);
    expect(typeof parseNotMe({ notMe: [id(1)] }, [id(2)])).toBe("string");
    expect(typeof parseNotMe({ notMe: ["Invented Work"] }, ["Invented Work"])).toBe("string");
    expect(typeof parseNotMe({ notMe: "x" }, [])).toBe("string");
    expect(typeof parseNotMe({ notMe: Array.from({ length: 201 }, () => id(1)) }, [id(1)])).toBe("string");
  });

  it("is refused with 400 before streaming, and is not passed to the run", async () => {
    const res = await handleRun(post({ ...input(), exclude: [id(2)], notMe: [id(1)] }), deps());
    expect(res.status).toBe(400);
  });
});
