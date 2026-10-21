// The live gate and the registered live suites. No network and no key: nothing here may make a call.

import { afterEach, describe, expect, it, vi } from "vitest";
import { FIELDS } from "@/types";
import { MAX_LIVE_CALLS_PER_RUN, MAX_REQUERIES_PER_RUN } from "@/lib/agent/config";
import { LIVE_SUITES, expectedLiveCalls, liveGate, type LiveSuite } from "./live";

afterEach(() => vi.restoreAllMocks());

describe("liveGate", () => {
  it("refuses without QLOO_LIVE=1, and prints the expected counts first", () => {
    const g = liveGate({});
    expect(g.allowed).toBe(false);
    expect(g.lines[0]).toBe(`Expected live Qloo calls: ${expectedLiveCalls(LIVE_SUITES)} across ${LIVE_SUITES.length} live suite(s), each suite capped at ${MAX_LIVE_CALLS_PER_RUN} per run.`);
    expect(g.lines.findIndex((l) => l.startsWith("Expected Anthropic calls"))).toBeGreaterThan(0);
    const refusal = g.lines.findIndex((l) => l.startsWith("Refusing"));
    expect(refusal).toBeGreaterThan(g.lines.findIndex((l) => l.startsWith("Expected Anthropic calls")));
    expect(g.lines[g.lines.length - 1]).toContain("QLOO_LIVE=1");
  });

  it.each(["0", "true", "", "yes"])("refuses QLOO_LIVE=%j", (v) => {
    expect(liveGate({ QLOO_LIVE: v }).allowed).toBe(false);
  });

  it("allows QLOO_LIVE=1, and still prints the counts first", () => {
    const g = liveGate({ QLOO_LIVE: "1" });
    expect(g.allowed).toBe(true);
    expect(g.lines[0]).toMatch(/^Expected live Qloo calls: \d+ across/);
  });

  it("refuses a suite that expects more than the per-run limit, even with QLOO_LIVE=1", () => {
    const big: LiveSuite = { id: "big", description: "too many", expectedCalls: MAX_LIVE_CALLS_PER_RUN + 1, run: async () => {} };
    const g = liveGate({ QLOO_LIVE: "1" }, [big]);
    expect(g.allowed).toBe(false);
    expect(g.lines[g.lines.length - 1]).toContain(`over the ${MAX_LIVE_CALLS_PER_RUN} per-run limit`);
  });

  it("prints the Anthropic count: 0 without a key, the loop's cap with one", () => {
    expect(liveGate({}).lines.find((l) => l.startsWith("Expected Anthropic calls"))).toContain("Expected Anthropic calls: 0");
    expect(liveGate({ ANTHROPIC_API_KEY: "synthetic-key" }).lines.find((l) => l.startsWith("Expected Anthropic calls"))).toContain("Expected Anthropic calls: 8");
  });
});

describe("registered live suites", () => {
  it("are post-check (7, run by script) then smoke-run (1 + one pool per field + the re-queries)", () => {
    expect(LIVE_SUITES.map((s) => [s.id, s.expectedCalls])).toEqual([
      ["post-check", 7],
      ["smoke-run", 1 + FIELDS.length + MAX_REQUERIES_PER_RUN],
    ]);
    expect(LIVE_SUITES.find((s) => s.id === "smoke-run")!.expectedCalls).toBe(9);
    for (const s of LIVE_SUITES) expect(s.expectedCalls).toBeLessThanOrEqual(MAX_LIVE_CALLS_PER_RUN);
  });

  it("post-check makes no call: it prints the dry run and the live command", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const out: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void out.push(a.join(" ")));
    await LIVE_SUITES.find((s) => s.id === "post-check")!.run({ outDir: "unused" });
    const text = out.join("\n");
    expect(text).toContain("node scripts/spike/04-post-check.mjs --dry-run");
    expect(text).toContain("QLOO_LIVE=1 QLOO_BUDGET=7 node scripts/spike/04-post-check.mjs");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
