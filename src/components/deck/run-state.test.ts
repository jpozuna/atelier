import { describe, expect, it } from "vitest";
import { initialRunState, isStreaming, runReducer } from "./run-state";
import type { RunAction, RunState } from "./run-state";
import { makeFixtureResult, makeFixtureTrace } from "./fixture";
import type { RunMessage } from "./sse";

const msg = (message: RunMessage): RunAction => ({ type: "message", message });
const run = (actions: RunAction[], from: RunState = initialRunState()) => actions.reduce(runReducer, from);
const trace = makeFixtureTrace();
const result = makeFixtureResult();

describe("a full run", () => {
  it("streams events, then a result, then done", () => {
    let s = run([{ type: "start" }, msg({ type: "trace", event: trace[0] }), msg({ type: "trace", event: trace[1] })]);
    expect(s.phase).toBe("running");
    expect(isStreaming(s)).toBe(true);
    expect(s.events).toHaveLength(2);
    s = run([msg({ type: "result", result }), msg({ type: "done" })], s);
    expect(s.phase).toBe("done");
    expect(isStreaming(s)).toBe(false);
    expect(s.result).toBe(result);
    expect(s.freshIds.length).toBe(result.domains.reduce((n, d) => n + d.picks.length, 0));
  });

  it("keeps events in order and never mutates the earlier list", () => {
    const s1 = run([{ type: "start" }, msg({ type: "trace", event: trace[0] })]);
    const s2 = runReducer(s1, msg({ type: "trace", event: trace[1] }));
    expect(s1.events).toHaveLength(1);
    expect(s2.events).toEqual([trace[0], trace[1]]);
  });

  it("caps the trace", () => {
    let s = runReducer(initialRunState(), { type: "start" });
    for (let i = 0; i < 450; i += 1) s = runReducer(s, msg({ type: "trace", event: trace[i % trace.length] }));
    expect(s.events.length).toBe(400);
  });

  it("ignores messages that arrive before a start or after the end", () => {
    const idle = runReducer(initialRunState(), msg({ type: "trace", event: trace[0] }));
    expect(idle.events).toHaveLength(0);
    const done = run([{ type: "start" }, msg({ type: "result", result }), msg({ type: "done" })]);
    expect(runReducer(done, msg({ type: "trace", event: trace[0] }))).toBe(done);
  });
});

describe("a run that cannot give picks", () => {
  it("picks_not_enabled is the calm not-ready state, with the events kept", () => {
    const s = run([{ type: "start" }, msg({ type: "trace", event: trace[0] }), msg({ type: "error", error: { code: "picks_not_enabled" } }), msg({ type: "done" })]);
    expect(s.phase).toBe("not_ready");
    expect(s.errorCode).toBe("picks_not_enabled");
    expect(s.result).toBeNull();
    expect(s.events).toHaveLength(1);
    expect(isStreaming(s)).toBe(false);
  });

  it("any other error code is a failure", () => {
    const s = run([{ type: "start" }, msg({ type: "error", error: { code: "upstream" } }), msg({ type: "done" })]);
    expect(s.phase).toBe("failed");
    expect(s.errorCode).toBe("upstream");
  });

  it("a stream that ends with no result is an interrupted run, not a blank screen", () => {
    expect(run([{ type: "start" }, msg({ type: "done" })]).errorCode).toBe("incomplete");
    expect(run([{ type: "start" }, { type: "closed" }]).phase).toBe("failed");
  });

  it("a connection that drops after the result still shows the result", () => {
    const s = run([{ type: "start" }, msg({ type: "result", result }), { type: "closed" }]);
    expect(s.phase).toBe("done");
  });

  it("a retry starts clean", () => {
    const failed = run([{ type: "start" }, msg({ type: "error", error: { code: "network" } })]);
    const again = runReducer(failed, { type: "start" });
    expect(again.phase).toBe("running");
    expect(again.errorCode).toBeNull();
    expect(again.events).toHaveLength(0);
  });
});

describe("restoring and re-running", () => {
  it("a restored result is done and not live (no reveal, no run)", () => {
    const s = initialRunState({ result, events: trace });
    expect(s.phase).toBe("done");
    expect(s.freshIds).toEqual([]);
    expect(s.events).toBe(trace);
  });

  it("a 'not me' re-run keeps the picks on screen and refreshes only the affected fields", () => {
    const start = initialRunState({ result, events: trace });
    const aside = result.domains[0].byBand.calibration[0].qlooId;
    const s = run(
      [
        { type: "start", refresh: { fields: ["music"], aside: [aside] } },
        msg({ type: "trace", event: trace[0] }),
        msg({ type: "result", result: makeFixtureResult("again") }),
        msg({ type: "done" }),
      ],
      start,
    );
    expect(s.phase).toBe("done");
    expect(s.events).toHaveLength(trace.length + 1);
    const music = s.result?.domains.find((d) => d.domain === "music");
    const film = s.result?.domains.find((d) => d.domain === "film");
    expect(music?.byBand.calibration.map((p) => p.qlooId)).not.toContain(aside);
    expect(film).toEqual(result.domains.find((d) => d.domain === "film"));
    expect(music?.byBand.high).toEqual(result.domains[0].byBand.high);
  });

  it("after a re-run only the new picks are fresh, so the rest of the reveal is not replayed", () => {
    const start = initialRunState({ result, events: trace });
    const aside = result.domains[0].byBand.calibration[0].qlooId;
    const s = run([{ type: "start", refresh: { fields: ["music"], aside: [aside] } }, msg({ type: "result", result: makeFixtureResult("again") }), msg({ type: "done" })], start);
    const before = new Set(result.domains.flatMap((d) => d.picks.map((p) => p.id)));
    expect(s.freshIds.length).toBeGreaterThan(0);
    for (const id of s.freshIds) expect(before.has(id)).toBe(false);
  });

  it("stores a merged plan that still covers every field", () => {
    const start = initialRunState({ result, events: trace });
    const again = makeFixtureResult("again");
    again.plan = { themes: [{ domain: "music", axisId: "axis-new", reason: "x" }], requeries: [] };
    const s = run([{ type: "start", refresh: { fields: ["music"], aside: [] } }, msg({ type: "result", result: again }), msg({ type: "done" })], start);
    expect(s.result?.plan.themes).toHaveLength(result.plan.themes.length);
  });

  it("a failed re-run leaves the picks and records the failure", () => {
    const start = initialRunState({ result, events: trace });
    const s = run([{ type: "start", refresh: { fields: ["music"], aside: [] } }, msg({ type: "error", error: { code: "rate_limited" } }), msg({ type: "done" })], start);
    expect(s.phase).toBe("done");
    expect(s.result).toBe(result);
    expect(s.rerunError).toBe("rate_limited");
  });

  it("a re-run whose stream gives nothing is reported, not silent", () => {
    const start = initialRunState({ result, events: trace });
    const s = run([{ type: "start", refresh: { fields: ["film"], aside: [] } }, msg({ type: "done" })], start);
    expect(s.phase).toBe("done");
    expect(s.rerunError).toBe("incomplete");
    expect(s.result).toBe(result);
  });
});
