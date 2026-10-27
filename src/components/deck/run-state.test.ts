import { describe, expect, it } from "vitest";
import { initialRunState, isStreaming, pendingFields, runReducer, shownResult } from "./run-state";
import { domainSteps } from "./preview";
import { FIELDS } from "@/types";
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

const dom = (r: typeof result, i: number): RunAction => msg({ type: "domain", domain: r.domains[i] });
const ids = (r: { domains: { picks: { id: string }[] }[] } | null) => (r?.domains ?? []).flatMap((d) => d.picks.map((p) => p.id));

describe("early picks (domain events)", () => {
  it("builds partial from the fields that have arrived, in field order, and leaves result alone", () => {
    const s = run([{ type: "start" }, dom(result, 2), dom(result, 0)]);
    expect(s.phase).toBe("running");
    expect(s.result).toBeNull();
    expect(s.received).toBe(false);
    expect(s.partial?.domains.map((d) => d.domain)).toEqual([FIELDS[0], FIELDS[2]]);
    expect(s.arrived).toEqual([FIELDS[2], FIELDS[0]]);
    expect(shownResult(s)).toBe(s.partial);
  });

  it("lists the fields still pending, and none once the stream is over", () => {
    let s = run([{ type: "start" }]);
    expect(pendingFields(s)).toEqual([...FIELDS]);
    s = run([dom(result, 0), dom(result, 3)], s);
    expect(pendingFields(s)).toEqual(FIELDS.filter((f) => f !== FIELDS[0] && f !== FIELDS[3]));
    s = run([msg({ type: "result", result }), msg({ type: "done" })], s);
    expect(pendingFields(s)).toEqual([]);
  });

  it("the final result replaces and clears partial; storage-facing result is final-only", () => {
    const s = run([{ type: "start" }, dom(result, 0), msg({ type: "result", result }), msg({ type: "done" })]);
    expect(s.result).toBe(result);
    expect(s.partial).toBeNull();
    expect(s.arrived).toEqual([]);
    expect(s.received).toBe(true);
    expect(shownResult(s)).toBe(result);
  });

  it("freshIds grow with each domain and the final result keeps the same ids", () => {
    let s = run([{ type: "start" }, dom(result, 0)]);
    expect(s.freshIds).toEqual(ids(s.partial));
    s = run([dom(result, 1)], s);
    expect(s.freshIds).toEqual(ids(s.partial));
    expect(s.freshIds.length).toBeGreaterThan(0);
    s = run([msg({ type: "result", result }), msg({ type: "done" })], s);
    expect(new Set(s.freshIds)).toEqual(new Set(ids(result)));
    expect(s.freshIds.length).toBe(ids(result).length);
  });

  it("ignores a second domain event for the same field", () => {
    const s = run([{ type: "start" }, dom(result, 0), dom(makeFixtureResult("again"), 0)]);
    expect(s.partial?.domains).toHaveLength(1);
    expect(ids(s.partial)).toEqual(ids({ domains: [result.domains[0]] }));
  });

  it("a domain event after the final result (before done) is ignored", () => {
    const s = run([{ type: "start" }, dom(result, 0), msg({ type: "result", result }), dom(result, 1), msg({ type: "done" })]);
    expect(s.partial).toBeNull();
    expect(s.arrived).toEqual([]);
    expect(s.result).toBe(result);
    expect(shownResult(s)).toBe(result);
    expect(s.freshIds.length).toBe(ids(result).length);
  });

  it("a retry (start) after a failed run clears the old partial, and picks_not_enabled keeps early picks like not_ready", () => {
    const s = run([{ type: "start" }, dom(result, 0), msg({ type: "error", error: { code: "picks_not_enabled" } }), msg({ type: "done" })]);
    expect(s.phase).toBe("not_ready");
    expect(s.errorCode).toBe("picks_not_enabled");
    expect(s.partial?.domains).toHaveLength(1);
    expect(s.arrived).toEqual([FIELDS[0]]);
    expect(runReducer(s, { type: "start" }).partial).toBeNull();
  });

  it("ignores a domain event outside a run", () => {
    const idle = runReducer(initialRunState(), dom(result, 0));
    expect(idle.partial).toBeNull();
    const done = run([{ type: "start" }, msg({ type: "result", result }), msg({ type: "done" })]);
    expect(runReducer(done, dom(result, 0))).toBe(done);
  });

  it("a stream that breaks after some domain events keeps those picks and sets the error", () => {
    const failed = run([{ type: "start" }, dom(result, 0), dom(result, 1), msg({ type: "error", error: { code: "upstream" } }), msg({ type: "done" })]);
    expect(failed.phase).toBe("failed");
    expect(failed.errorCode).toBe("upstream");
    expect(failed.result).toBeNull();
    expect(failed.partial?.domains).toHaveLength(2);
    expect(failed.arrived).toEqual([FIELDS[0], FIELDS[1]]);
    const cut = run([{ type: "start" }, dom(result, 0), { type: "closed" }]);
    expect(cut.phase).toBe("failed");
    expect(cut.errorCode).toBe("incomplete");
    expect(cut.partial?.domains).toHaveLength(1);
    expect(pendingFields(cut)).toEqual([]);
  });

  it("a retry clears the partial picks", () => {
    const failed = run([{ type: "start" }, dom(result, 0), msg({ type: "error", error: { code: "network" } })]);
    const again = runReducer(failed, { type: "start" });
    expect(again.partial).toBeNull();
    expect(again.arrived).toEqual([]);
  });

  it("does not need the pick's explain events: partial is the same with no trace, or with trace events after", () => {
    const a = run([{ type: "start" }, dom(result, 0)]);
    const b = run([{ type: "start" }, msg({ type: "trace", event: trace[0] }), dom(result, 0), msg({ type: "trace", event: trace[1] })]);
    expect(b.partial).toEqual(a.partial);
    expect(a.events).toHaveLength(0);
    expect(a.partial?.domains[0].picks.length).toBeGreaterThan(0);
  });
});

describe("early picks in a 'not me' re-run", () => {
  const start = () => initialRunState({ result, events: trace });
  const aside = result.domains[0].byBand.calibration[0].qlooId;
  const again = makeFixtureResult("again");

  it("merges an event for a refreshed field onto the current result, like mergeRerun", () => {
    const s = run([{ type: "start", refresh: { fields: ["music"], aside: [aside] } }, dom(again, 0)], start());
    expect(s.result).toBe(result); // result stays as it was
    const music = s.partial?.domains.find((d) => d.domain === "music");
    expect(music?.byBand.calibration.map((p) => p.qlooId)).not.toContain(aside);
    expect(music?.byBand.high).toEqual(result.domains[0].byBand.high);
    expect(s.partial?.domains.map((d) => d.domain)).toEqual(result.domains.map((d) => d.domain));
    expect(s.partial?.domains.find((d) => d.domain === "film")).toEqual(result.domains.find((d) => d.domain === "film"));
    expect(s.partial?.plan).toBe(result.plan);
    expect(s.partial?.meta).toBe(result.meta);
    expect(shownResult(s)).toBe(s.partial);
  });

  it("ignores events for fields that are not being refreshed", () => {
    const s = run([{ type: "start", refresh: { fields: ["music"], aside: [] } }, dom(again, 1), dom(again, 2)], start());
    expect(s.partial).toBeNull();
    expect(s.arrived).toEqual([]);
    expect(shownResult(s)).toBe(result);
  });

  it("pending is the refreshed fields not yet arrived", () => {
    let s = run([{ type: "start", refresh: { fields: ["music", "film"], aside: [] } }], start());
    expect(pendingFields(s)).toEqual(FIELDS.filter((f) => f === "music" || f === "film"));
    s = run([dom(again, 0)], s);
    expect(pendingFields(s)).toEqual(["film"]);
  });

  it("only new picks are fresh, and the final result ends in the same merge", () => {
    const s = run([{ type: "start", refresh: { fields: ["music"], aside: [aside] } }, dom(again, 0)], start());
    const before = new Set(ids(result));
    expect(s.freshIds.length).toBeGreaterThan(0);
    for (const id of s.freshIds) expect(before.has(id)).toBe(false);
    const partialIds = [...s.freshIds];
    const done = run([msg({ type: "result", result: again }), msg({ type: "done" })], s);
    expect(done.partial).toBeNull();
    expect(done.freshIds).toEqual(partialIds);
    expect(done.result?.domains.find((d) => d.domain === "music")).toEqual(s.partial?.domains.find((d) => d.domain === "music"));
  });

  it("a failed re-run falls back to the stored result: partial and arrived are cleared, the failure is recorded", () => {
    const s = run([{ type: "start", refresh: { fields: ["music"], aside: [aside] } }, dom(again, 0), msg({ type: "error", error: { code: "rate_limited" } }), msg({ type: "done" })], start());
    expect(s.phase).toBe("done");
    expect(s.rerunError).toBe("rate_limited");
    expect(s.result).toBe(result);
    expect(s.partial).toBeNull();
    expect(s.arrived).toEqual([]);
    expect(s.freshIds).toEqual([]);
    expect(shownResult(s)).toBe(result);
    expect(pendingFields(s)).toEqual([]);
  });

  it("a re-run cut by the connection closing falls back to the stored result too", () => {
    const s = run([{ type: "start", refresh: { fields: ["music", "film"], aside: [aside] } }, dom(again, 0), { type: "closed" }], start());
    expect(s.phase).toBe("done");
    expect(s.rerunError).toBe("incomplete");
    expect(s.partial).toBeNull();
    expect(s.arrived).toEqual([]);
    expect(shownResult(s)).toBe(result);
  });

  it("merges two refreshed fields onto the earlier partial", () => {
    const s = run([{ type: "start", refresh: { fields: ["music", "film"], aside: [aside] } }, dom(again, 0), dom(again, 1)], start());
    expect(s.arrived).toEqual(["music", "film"]);
    const get = (r: typeof result | null, f: string) => r?.domains.find((d) => d.domain === f);
    expect(get(s.partial, "music")).toEqual(get(runReducer(run([{ type: "start", refresh: { fields: ["music", "film"], aside: [aside] } }, dom(again, 0)], start()), dom(again, 0)).partial, "music"));
    expect(get(s.partial, "film")?.byBand.high.map((p) => p.qlooId)).toEqual(again.domains[1].byBand.high.map((p) => p.qlooId));
    expect(s.partial?.domains.map((d) => d.domain)).toEqual(result.domains.map((d) => d.domain));
    expect(get(s.partial, FIELDS[2])).toEqual(get(result, FIELDS[2]));
    expect(pendingFields(s)).toEqual([]);
  });

  it("ignores a second domain event for the same field in a re-run", () => {
    const first = run([{ type: "start", refresh: { fields: ["music"], aside: [aside] } }, dom(again, 0)], start());
    const second = runReducer(first, dom(makeFixtureResult("first"), 0));
    expect(second).toBe(first);
  });

  it("a refreshed field with status unavailable still counts as arrived", () => {
    const gone = { ...again.domains[0], status: "unavailable" as const, picks: [], byBand: { calibration: [], moderate: [], high: [], extreme: [] } };
    const s = run([{ type: "start", refresh: { fields: ["music", "film"], aside: [] } }, msg({ type: "domain", domain: gone })], start());
    expect(s.arrived).toEqual(["music"]);
    expect(pendingFields(s)).toEqual(["film"]);
    // like the final merge, an unavailable answer leaves the field as it was on screen
    expect(s.partial?.domains.find((d) => d.domain === "music")).toEqual(result.domains[0]);
  });

  it("a new re-run start clears a previous partial", () => {
    const cut = run([{ type: "start", refresh: { fields: ["music"], aside: [] } }, dom(again, 0), msg({ type: "result", result: again }), msg({ type: "done" })], start());
    const next = runReducer({ ...cut, partial: again }, { type: "start", refresh: { fields: ["film"], aside: [] } });
    expect(next.partial).toBeNull();
    expect(next.arrived).toEqual([]);
    expect(next.phase).toBe("running");
  });

  it("a domain event after the final result does not shrink the view", () => {
    const s = run([{ type: "start", refresh: { fields: ["music"], aside: [] } }, msg({ type: "result", result: again }), dom(again, 0), msg({ type: "done" })], start());
    expect(s.partial).toBeNull();
    expect(s.arrived).toEqual([]);
    expect(shownResult(s)).toBe(s.result);
    expect(s.result?.domains).toHaveLength(result.domains.length);
  });

  it("a restored result carries no partial", () => {
    const s = start();
    expect(s.partial).toBeNull();
    expect(s.arrived).toEqual([]);
  });
});

describe("domainSteps (the /picks/preview stream)", () => {
  it("sends one field at a time, spaced out, in the order given", () => {
    const steps = domainSteps(result, 1000, 400, ["film", "music"]);
    expect(steps.map((s) => s.at)).toEqual([1000, 1400]);
    expect(steps.map((s) => s.message.type === "domain" && s.message.domain.domain)).toEqual(["film", "music"]);
  });

  it("defaults to the result's field order and skips fields the result lacks", () => {
    expect(domainSteps(result, 0, 100)).toHaveLength(result.domains.length);
    expect(domainSteps({ ...result, domains: result.domains.slice(0, 2) }, 0, 100, FIELDS)).toHaveLength(2);
  });

  it("its messages drive the reducer to the same partial as the result", () => {
    const s = run([{ type: "start" }, ...domainSteps(result, 0, 1, [...FIELDS].reverse()).map((x) => msg(x.message))]);
    expect(s.partial?.domains).toEqual(result.domains);
    expect(pendingFields(s)).toEqual([]);
  });
});
