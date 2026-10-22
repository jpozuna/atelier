// A slow run log must not hold up a run: after LEARN_READ_TIMEOUT_MS the run goes ahead as the request says.

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/agent/config", async (original) => ({ ...(await original<typeof import("@/lib/agent/config")>()), LEARN_READ_TIMEOUT_MS: 20 }));

import { createLlmCache } from "@/lib/agent/llm";
import { fakeAnthropic, fakeQloo, id, input, modelFor, offlineRefs } from "@/lib/agent/testing";
import { createRunLog } from "@/lib/runlog";
import { createMemoryStore } from "@/lib/runlog/store-memory";
import { handleRun } from "@/app/api/run/handler";

describe("a slow run log", () => {
  it("does not hold up the run, which then runs as requested", async () => {
    const store = createMemoryStore();
    store.selectRuns = () => new Promise(() => {});
    store.selectSignals = () => new Promise(() => {});
    const qloo = fakeQloo();
    const cache = createLlmCache();
    const model = fakeAnthropic();
    const res = await handleRun(new Request("http://localhost/api/run", { method: "POST", body: JSON.stringify(input()) }), {
      learn: true,
      runLog: createRunLog(store, { newId: () => id(1) }),
      getUserId: async () => id(91),
      createRunDeps: () => {
        const w = qloo.client();
        return { insights: (p, o) => w.client.insights(p, o), preflight: w.preflight, refs: offlineRefs(), llm: modelFor(model, cache) };
      },
    });
    const text = await res.text();
    expect(text).toContain("event: result");
    expect(qloo.fetched.length).toBeGreaterThan(0);
  });
});
