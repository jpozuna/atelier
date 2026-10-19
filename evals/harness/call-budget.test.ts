import { describe, expect, it } from "vitest";
import { MAX_LIVE_CALLS_PER_RUN, MAX_REQUERIES_PER_RUN } from "@/lib/agent/config";
import type { TraceEvent } from "@/types";
import { scoreCallBudget } from "../scorers/call-budget";
import type { RunKind } from "./types";

const T = "2026-01-01T00:00:00.000Z";
const call = (cached: boolean, extra: Record<string, unknown> = {}): TraceEvent =>
  ({ t: T, say: "x", kind: "qloo_call", endpoint: "/search", method: "GET", cached, ...(cached ? {} : { status: 200 }), ...extra }) as TraceEvent;
const live = (n: number) => Array.from({ length: n }, () => call(false, { source: "live" }));
const requery = (domain: "film" | "books" = "film"): TraceEvent => ({ t: T, say: "x", kind: "requery", domain, reason: "too_obvious", paramChanges: { take: 30 } });
const pool = (domain: "film" | "books" = "film"): TraceEvent => ({ t: T, say: "x", kind: "query_insights", domain, endpoint: "/v2/insights", params: {}, resultCount: 20, explainability: false, primaryCount: 0, backfillCount: 0 });
const run = (trace: TraceEvent[], kind: RunKind = "new_profile") => scoreCallBudget({ id: "t", run: kind, trace });

describe("call-budget", () => {
  it("allows exactly the live-call limit and fails one more", () => {
    expect(run(live(MAX_LIVE_CALLS_PER_RUN)).pass).toBe(true);
    const r = run(live(MAX_LIVE_CALLS_PER_RUN + 1));
    expect(r.pass).toBe(false);
    expect(r.reasons[0]).toContain(`${MAX_LIVE_CALLS_PER_RUN + 1} live calls`);
  });

  it("does not count cache hits, shared calls or refusals as live", () => {
    const trace = [
      ...live(MAX_LIVE_CALLS_PER_RUN),
      call(true, { source: "cache" }),
      call(false, { source: "shared" }),
      call(false, { source: "none", status: undefined, outcome: "error", errorKind: "budget" }),
    ];
    expect(run(trace).pass).toBe(true);
  });

  it("counts a live attempt that failed: source none with a status, or runLiveCalls rising", () => {
    const failedWithStatus = call(false, { source: "none", status: 504, outcome: "error", errorKind: "gateway_timeout" });
    const failedNoStatus = (n: number) => call(false, { source: "none", status: undefined, outcome: "error", errorKind: "network", runLiveCalls: n });
    // 12 good calls plus one failed attempt is 13.
    expect(run([...live(MAX_LIVE_CALLS_PER_RUN), failedWithStatus]).pass).toBe(false);
    expect(run([...live(MAX_LIVE_CALLS_PER_RUN), failedNoStatus(MAX_LIVE_CALLS_PER_RUN + 1)]).reasons[0]).toContain(`${MAX_LIVE_CALLS_PER_RUN + 1} live calls`);
    // A failed attempt at the limit is still within it.
    expect(run([...live(MAX_LIVE_CALLS_PER_RUN - 1), failedWithStatus]).pass).toBe(true);
    // Repeat view: any live attempt fails, whether or not it succeeded.
    expect(run([call(true), failedWithStatus], "repeat_view").pass).toBe(false);
    expect(run([call(true), failedNoStatus(1)], "repeat_view").reasons[0]).toContain("repeat view made 1 live");
  });

  it("a refusal before sending (no status, runLiveCalls unchanged) is not a live attempt", () => {
    const refused = call(false, { source: "none", status: undefined, outcome: "error", errorKind: "param_invalid", runLiveCalls: 0 });
    expect(run([call(true), refused], "repeat_view").pass).toBe(true);
  });

  it("a repeat view must make 0 live calls", () => {
    expect(run([call(true), call(true)], "repeat_view").pass).toBe(true);
    const r = run([call(true), ...live(1)], "repeat_view");
    expect(r.pass).toBe(false);
    expect(r.reasons[0]).toContain("repeat view made 1 live");
  });

  it("allows the re-query limit and fails one more", () => {
    expect(run(Array.from({ length: MAX_REQUERIES_PER_RUN }, () => requery())).pass).toBe(true);
    const r = run(Array.from({ length: MAX_REQUERIES_PER_RUN + 1 }, () => requery()));
    expect(r.pass).toBe(false);
    expect(r.reasons.join()).toContain(`${MAX_REQUERIES_PER_RUN + 1} re-queries`);
  });

  it("fails when the client's own running count exceeds the cap", () => {
    expect(run([call(false, { source: "live", runLiveCalls: MAX_LIVE_CALLS_PER_RUN + 1 })]).pass).toBe(false);
  });

  it("one insights pool per domain; a re-query for that domain allows one more", () => {
    expect(run([pool("film"), pool("books")]).pass).toBe(true);
    expect(run([pool("film"), requery("film"), pool("film")]).pass).toBe(true);
    const r = run([pool("film"), pool("film")]);
    expect(r.pass).toBe(false);
    expect(r.reasons[0]).toContain("insights pools");
    // A re-query for a different domain does not excuse the extra pool.
    expect(run([pool("film"), requery("books"), pool("film")]).pass).toBe(false);
  });

  it("an empty trace passes", () => {
    expect(run([]).pass).toBe(true);
  });
});
