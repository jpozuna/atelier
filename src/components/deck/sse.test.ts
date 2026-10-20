import { describe, expect, it } from "vitest";
import { codeFromErrorBody, feedSse, readMessage, readPick, readResult } from "./sse";
import { makeFixtureResult, makeFixtureTrace } from "./fixture";

const frame = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

describe("feedSse", () => {
  it("returns complete messages and keeps the unfinished tail", () => {
    const a = feedSse("", 'event: trace\ndata: {"a":1}\n\nevent: tr');
    expect(a.messages).toEqual([{ event: "trace", data: '{"a":1}' }]);
    const b = feedSse(a.rest, 'ace\ndata: {"b":2}\n\n');
    expect(b.messages).toEqual([{ event: "trace", data: '{"b":2}' }]);
    expect(b.rest).toBe("");
  });

  it("is the same however the stream is cut into chunks", () => {
    const text = frame("trace", { n: 1 }) + ": keepalive\n\n" + frame("done", {});
    const whole = feedSse("", text).messages;
    let buffer = "";
    const pieces: ReturnType<typeof feedSse>["messages"] = [];
    for (const ch of text) {
      const r = feedSse(buffer, ch);
      buffer = r.rest;
      pieces.push(...r.messages);
    }
    expect(pieces).toEqual(whole);
    expect(whole.map((m) => m.event)).toEqual(["trace", "done"]);
  });

  it("skips keepalive comments and handles CRLF, a missing space and multi-line data", () => {
    const r = feedSse("", ": keepalive\r\n\r\nevent:trace\r\ndata:one\r\ndata: two\r\n\r\n");
    expect(r.messages).toEqual([{ event: "trace", data: "one\ntwo" }]);
  });

  it("holds a trailing lone CR until the next chunk shows whether it starts a CRLF", () => {
    const first = feedSse("", "event: trace\r\ndata: one\r");
    expect(first.messages).toEqual([]);
    const second = feedSse(first.rest, "\n\r\n");
    expect(second.messages).toEqual([{ event: "trace", data: "one" }]);
    // A CR that ends the blank line, cut right after it, still completes the message once the stream continues.
    const a = feedSse("", "data: x\r\n\r");
    expect(a.messages).toEqual([]);
    expect(feedSse(a.rest, "\n").messages).toEqual([{ event: "message", data: "x" }]);
  });

  it("does not turn a comment into a message", () => {
    expect(feedSse("", ": keepalive\n\n").messages).toEqual([]);
  });
});

describe("readMessage", () => {
  it("reads a trace event, including a public score event with no popularity", () => {
    const score = makeFixtureTrace().find((e) => e.kind === "score");
    expect(score).toBeDefined();
    expect(score && "popularity" in score).toBe(false);
    const m = readMessage({ event: "trace", data: JSON.stringify(score) });
    expect(m?.type).toBe("trace");
  });

  it("drops a malformed or unknown trace event and unknown event names", () => {
    expect(readMessage({ event: "trace", data: '{"kind":"nope"}' })).toBeNull();
    expect(readMessage({ event: "trace", data: "{not json" })).toBeNull();
    expect(readMessage({ event: "mystery", data: "{}" })).toBeNull();
  });

  it("reads the result and the done event", () => {
    const m = readMessage({ event: "result", data: JSON.stringify(makeFixtureResult()) });
    expect(m?.type).toBe("result");
    expect(readMessage({ event: "done", data: "{}" })).toEqual({ type: "done" });
  });

  it("keeps only the error code: the server's text is never carried to the screen", () => {
    const m = readMessage({ event: "error", data: JSON.stringify({ code: "picks_not_enabled", message: "Live picks are not switched on yet." }) });
    expect(m).toEqual({ type: "error", error: { code: "picks_not_enabled" } });
    expect(JSON.stringify(m)).not.toContain("switched on");
  });

  it("treats an error without a code as internal", () => {
    expect(readMessage({ event: "error", data: "{}" })).toEqual({ type: "error", error: { code: "internal" } });
  });
});

describe("readResult and readPick", () => {
  it("keeps valid picks and drops invalid ones", () => {
    const result = makeFixtureResult();
    const raw = JSON.parse(JSON.stringify(result));
    raw.domains[0].byBand.moderate.push({ id: "x" });
    const read = readResult(raw);
    expect(read?.domains[0].byBand.moderate.length).toBe(result.domains[0].byBand.moderate.length);
  });

  it("rebuilds `picks` from the bands, lowest band first", () => {
    const raw = JSON.parse(JSON.stringify(makeFixtureResult()));
    raw.domains[0].picks = [];
    const read = readResult(raw);
    const bands = read?.domains[0].picks.map((p) => p.band) ?? [];
    expect(bands.length).toBeGreaterThan(0);
    const order = ["calibration", "moderate", "high", "extreme"];
    expect(bands.map((b) => order.indexOf(b))).toEqual([...bands.map((b) => order.indexOf(b))].sort((a, b) => a - b));
  });

  it("rejects a result with no plan or no domains", () => {
    const base = JSON.parse(JSON.stringify(makeFixtureResult()));
    expect(readResult({ ...base, plan: undefined })).toBeNull();
    expect(readResult({ ...base, domains: [] })).toBeNull();
    expect(readResult(null)).toBeNull();
  });

  it("keeps no field the contract does not list: a stray score never reaches the screen", () => {
    const pick = makeFixtureResult().domains[0].picks[0];
    const read = readPick({ ...pick, reach: { reach: 0.9 }, connection: 0.8, popularity: 0.1, rank: 1 });
    expect(read).not.toBeNull();
    expect(Object.keys(read ?? {}).sort()).toEqual(["band", "card", "field", "id", "llmBridged", "name", "origin", "path", "qlooId"]);
  });

  it("rejects a pick whose path or card is malformed", () => {
    const pick = makeFixtureResult().domains[0].picks[0];
    expect(readPick({ ...pick, path: { seedId: "s" } })).toBeNull();
    expect(readPick({ ...pick, band: "huge" })).toBeNull();
    expect(readPick({ ...pick, llmBridged: "no" })).toBeNull();
  });
});

describe("codeFromErrorBody", () => {
  it("reads the code from the route's error body, else the status", () => {
    expect(codeFromErrorBody(503, { error: { code: "busy", message: "x" } })).toBe("busy");
    expect(codeFromErrorBody(503, { error: { code: "demo_resting", message: "x", retryAfterSeconds: 60 } })).toBe("demo_resting");
    expect(codeFromErrorBody(429, { error: { code: "too_many_requests", message: "x" } })).toBe("too_many_requests");
    expect(codeFromErrorBody(500, null)).toBe("http_500");
  });
});
