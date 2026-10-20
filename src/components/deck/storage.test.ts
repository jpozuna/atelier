import { describe, expect, it } from "vitest";
import { FIXTURE_INPUTS, makeFixtureResult, makeFixtureTrace } from "./fixture";
import { parseStored, serializeStored, sessionKey } from "./storage";
import type { StoredPicks } from "./storage";

const key = sessionKey(FIXTURE_INPUTS);
const stored = (): StoredPicks => ({
  version: 1,
  key,
  result: makeFixtureResult(),
  events: makeFixtureTrace(),
  notMe: [],
  hidden: ["film"],
  reactions: { a: { state: "will_try", words: "to see how it is built", at: "2026-10-20T12:00:00.000Z" } },
  reruns: 1,
});

describe("sessionKey", () => {
  it("is stable, and changes when the seeds or axes change", () => {
    expect(sessionKey(FIXTURE_INPUTS)).toBe(key);
    expect(sessionKey({ ...FIXTURE_INPUTS, seeds: FIXTURE_INPUTS.seeds.slice(1) })).not.toBe(key);
    expect(sessionKey({ ...FIXTURE_INPUTS, axes: FIXTURE_INPUTS.axes.slice(1) })).not.toBe(key);
  });
});

describe("parseStored", () => {
  it("round-trips what was stored", () => {
    const back = parseStored(serializeStored(stored()), key);
    expect(back?.hidden).toEqual(["film"]);
    expect(back?.reruns).toBe(1);
    expect(back?.reactions.a.words).toBe("to see how it is built");
    expect(back?.result.domains).toHaveLength(6);
    expect(back?.events.length).toBe(makeFixtureTrace().length);
    expect(back?.result.plan).toEqual(makeFixtureResult().plan);
  });

  it("returns null for another taste session, another version, damage or nothing", () => {
    const raw = serializeStored(stored());
    expect(parseStored(raw, "00000000")).toBeNull();
    expect(parseStored(raw.replace('"version":1', '"version":2'), key)).toBeNull();
    expect(parseStored("{not json", key)).toBeNull();
    expect(parseStored(null, key)).toBeNull();
    expect(parseStored(JSON.stringify({ ...stored(), result: { domains: [] } }), key)).toBeNull();
  });

  it("drops bad parts rather than failing", () => {
    const bad = { ...stored(), hidden: ["film", "moon"], notMe: ["x", 4], events: [{ kind: "nope" }], reactions: { a: { state: "adore", at: "t" } }, reruns: -3 };
    const back = parseStored(JSON.stringify(bad), key);
    expect(back?.hidden).toEqual(["film"]);
    expect(back?.notMe).toEqual(["x"]);
    expect(back?.events).toEqual([]);
    expect(back?.reactions).toEqual({});
    expect(back?.reruns).toBe(0);
  });
});
