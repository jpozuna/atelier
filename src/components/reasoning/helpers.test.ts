import { describe, expect, it } from "vitest";
import { REQUERY_REASONS, TRACE_EVENT_KINDS, isTraceEvent } from "@/types";
import type { TraceEvent } from "@/types";
import { FIXTURE_PICK_NAMES, FIXTURE_SEED_NAMES, FIXTURE_TRACE } from "./fixture";
import {
  REQUERY_TEXT,
  announcementText,
  buildSteps,
  cleanName,
  cleanReason,
  parseTraceLine,
  renderEvent,
} from "./helpers";

const ctx = { seedNames: FIXTURE_SEED_NAMES, pickNames: FIXTURE_PICK_NAMES };
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

describe("fixture", () => {
  it("is a valid trace covering every event kind", () => {
    expect(FIXTURE_TRACE.every(isTraceEvent)).toBe(true);
    const kinds = new Set(FIXTURE_TRACE.map((e) => e.kind));
    for (const k of TRACE_EVENT_KINDS) expect(kinds.has(k)).toBe(true);
    const reasons = new Set(FIXTURE_TRACE.flatMap((e) => (e.kind === "requery" ? [e.reason] : [])));
    for (const r of REQUERY_REASONS) expect(reasons.has(r)).toBe(true);
  });
});

describe("renderEvent", () => {
  it("renders every non-cached event as one non-empty line", () => {
    for (const e of FIXTURE_TRACE) {
      const r = renderEvent(e, ctx);
      if (e.kind === "qloo_call" && e.cached) {
        expect(r).toBeNull();
      } else {
        expect(r?.text.length).toBeGreaterThan(10);
        expect(r?.text).not.toContain("\n");
      }
    }
  });

  it("states each re-query reason in plain words", () => {
    const texts = REQUERY_REASONS.map((reason) =>
      renderEvent({ t: "x", kind: "requery", say: "", domain: "music", reason, paramChanges: {} })?.text,
    );
    expect(texts[0]).toMatch(/obvious/);
    expect(texts[1]).toMatch(/connected strongly enough/);
    expect(texts[2]).toMatch(/Nothing came back/);
    expect(texts[3]).toMatch(/nothing distinctive/);
    expect(new Set(texts).size).toBe(4);
    for (const r of REQUERY_REASONS) expect(REQUERY_TEXT[r]("music")).not.toMatch(/too_|_/);
  });

  it("states a relaxed band plainly", () => {
    const r = renderEvent({
      t: "x",
      kind: "relax",
      say: "",
      relaxed: "reach_band",
      from: "extreme",
      to: "high",
      reason: "internal filter.popularity.max term",
    });
    expect(r?.text).toBe("Nothing connected strongly enough at the extreme band, so showing high.");
    expect(r?.detail).toBeUndefined();
  });

  it("names seeds and picks from the context, never their ids", () => {
    const resolved = renderEvent(FIXTURE_TRACE[3], ctx);
    expect(resolved?.text).toContain("Fixture Album A");
    const anon = renderEvent(FIXTURE_TRACE[3]);
    expect(anon?.text).toMatch(/^Something you shared/);
    const explained = FIXTURE_TRACE.find((e) => e.kind === "explain");
    expect(renderEvent(explained!, ctx)?.text).toContain("Fixture Pick X");
    expect(renderEvent(explained!)?.text).not.toMatch(UUID);
  });

  it("marks unresolved seeds as notices", () => {
    expect(renderEvent(FIXTURE_TRACE[4], ctx)?.tone).toBe("notice");
    expect(renderEvent(FIXTURE_TRACE[5], ctx)?.tone).toBe("notice");
  });

  it("says when no sources were retrieved, and omits nothing else", () => {
    const r = renderEvent({ t: "x", kind: "fetch_refs", say: "", pickIds: [], sourcedCount: 0, inferredCount: 2 });
    expect(r?.text).toMatch(/left out/);
  });

  it("notes a failed taste-graph call without the status code", () => {
    const r = renderEvent({
      t: "x",
      kind: "qloo_call",
      say: "",
      endpoint: "/v2/insights",
      method: "POST",
      cached: false,
      status: 500,
    });
    expect(r?.text).toMatch(/no answer/);
    expect(r?.text).not.toMatch(/500/);
  });
});

describe("what a line never shows", () => {
  const all = buildSteps(FIXTURE_TRACE, ctx);
  const dump = all.map((s) => `${s.label} ${s.text} ${s.detail ?? ""}`).join("\n");

  it("has no ids, urns, key words, scores or counts", () => {
    expect(dump).not.toMatch(UUID);
    expect(dump).not.toMatch(/urn:/i);
    expect(dump).not.toMatch(/api[-_ ]?key|x-api/i);
    expect(dump).not.toMatch(/\d/);
    expect(dump).not.toMatch(/score|rank|popularity|%/i);
    expect(dump).not.toMatch(/filter\.|signal\./);
  });

  it("labels seeds as what the user shared, not as picks", () => {
    const seedLines = all.filter((x) => x.label === "What you shared");
    expect(seedLines.length).toBe(3);
    expect(seedLines.every((x) => !/pick/i.test(x.text))).toBe(true);
    expect(dump).not.toMatch(/Choose which/);
  });

  it("has no exclamation marks", () => {
    expect(dump).not.toContain("!");
  });
});

describe("buildSteps", () => {
  const steps = buildSteps(FIXTURE_TRACE, ctx);

  it("keeps stream order and gives unique keys", () => {
    expect(new Set(steps.map((s) => s.key)).size).toBe(steps.length);
    const idx = steps.map((s) => Number(s.key.split("-")[0]));
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
  });

  it("drops cached calls as steps", () => {
    const cachedIndex = FIXTURE_TRACE.findIndex((e) => e.kind === "qloo_call" && e.cached);
    expect(steps.some((s) => s.key.startsWith(`${cachedIndex}-`))).toBe(false);
  });

  it("collapses repeated identical lines so repetition shows no count", () => {
    const call = FIXTURE_TRACE[0];
    const out = buildSteps([call, { ...call, t: "later" }, { ...call, t: "later still" }]);
    expect(out).toHaveLength(1);
  });

  it("does not collapse consecutive identical re-queries", () => {
    const rq: TraceEvent = {
      t: "x",
      kind: "requery",
      say: "",
      domain: "music",
      reason: "too_obvious",
      paramChanges: {},
    };
    expect(buildSteps([rq, { ...rq, t: "y" }])).toHaveLength(2);
  });

  it("streams: appending events only appends steps and leaves earlier keys alone", () => {
    for (let n = 1; n < FIXTURE_TRACE.length; n++) {
      const a = buildSteps(FIXTURE_TRACE.slice(0, n), ctx).map((s) => s.key);
      const b = buildSteps(FIXTURE_TRACE.slice(0, n + 1), ctx).map((s) => s.key);
      expect(b.slice(0, a.length)).toEqual(a);
    }
  });

  it("returns nothing for an empty list", () => {
    expect(buildSteps([])).toEqual([]);
  });
});

describe("cleanReason (allowlist)", () => {
  it("keeps plain words and ordinary punctuation", () => {
    const ok = "Your reason mentions slow, patient pacing (and quiet endings): that theme is shared.";
    expect(cleanReason(ok)).toBe(ok);
    expect(cleanReason("  Spaced \n out   words ")).toBe("Spaced out words");
  });

  it.each([
    ["a bare integer", "Score 7 of 10"],
    ["a count", "42 of them were close"],
    ["a rank", "rank #1 in its field"],
    ["a short hash", "picked a3f9c2 as the theme"],
    ["a comma decimal", "affinity of 0,85 here"],
    ["a dot decimal", "popularity 0.82"],
    ["a percentage", "a 90% match"],
    ["an sk- key", "used sk-abcdefghijkl as the key"],
    ["an ant- key", "token ant-api-key-here"],
    ["a long letters-only token", "the token abcdefghijklmnopqrstuvwxyzabcdefghij was used"],
    ["an https url", "see https://example.invalid/page for more"],
    ["the Qloo host", "called hackathon.api.qloo.com directly"],
    ["a www url", "see www example or www.example.invalid"],
    ["a dotted param name", "tightened filter.popularity.max a little"],
    ["a dotted param name, bare", "filter.popularity.max"],
    ["a uuid", "chose 00000000-0000-4000-8000-000000000021 for pacing"],
    ["a urn", "theme urn:tag:genre:fixture is shared"],
    ["a key header", "sent X-Api-Key header"],
    ["the word secret", "kept the secret"],
    ["score words", "gave the highest score to one"],
    ["rank words", "ranked them in order"],
    ["an exclamation mark", "Nice!"],
    ["a slash path", "called /v2/insights"],
  ])("drops the whole text for %s", (_name, text) => {
    expect(cleanReason(text)).toBeUndefined();
  });

  it("ignores non-strings and blanks, and caps length", () => {
    expect(cleanReason(undefined)).toBeUndefined();
    expect(cleanReason(42)).toBeUndefined();
    expect(cleanReason("   ")).toBeUndefined();
    expect(cleanReason("word ".repeat(100))!.length).toBeLessThanOrEqual(201);
  });
});

describe("cleanName (looser)", () => {
  it("allows digits and symbols in titles", () => {
    expect(cleanName("Fixture Album, Vol. 2")).toBe("Fixture Album, Vol. 2");
    expect(cleanName("Fixture 1984 & Co.")).toBe("Fixture 1984 & Co.");
    expect(cleanName("St.Fixture")).toBe("St.Fixture");
  });
  it("drops urns, uuids, urls and keys", () => {
    expect(cleanName("urn:entity:fixture")).toBeUndefined();
    expect(cleanName("00000000-0000-4000-8000-000000000021")).toBeUndefined();
    expect(cleanName("https://example.invalid/x")).toBeUndefined();
    expect(cleanName("hackathon.api.qloo.com")).toBeUndefined();
    expect(cleanName("www.example")).toBeUndefined();
    expect(cleanName("sk-abcdefghijkl")).toBeUndefined();
    expect(cleanName("x".repeat(40))).toBeUndefined();
    expect(cleanName(undefined)).toBeUndefined();
  });
  it("is used for names in lines, so a bad name falls back to the generic subject", () => {
    const e = FIXTURE_TRACE[3];
    expect(renderEvent(e, { seedNames: { [(e as { seedId: string }).seedId]: "Fixture Album, Vol. 2" } })?.text).toContain(
      "Vol. 2",
    );
    expect(renderEvent(e, { seedNames: { [(e as { seedId: string }).seedId]: "https://example.invalid" } })?.text).toMatch(
      /^Something you shared/,
    );
  });
});

describe("announcementText", () => {
  it("speaks only the latest line while streaming", () => {
    expect(announcementText("Latest line.", true, true)).toBe("Latest line.");
    expect(announcementText(undefined, true, false)).toBeNull();
  });
  it("closes while the close is pending, and stays quiet otherwise", () => {
    expect(announcementText("Latest line.", false, true)).toBe("The reasoning is complete.");
    expect(announcementText("Latest line.", false, false)).toBeNull();
  });
});

describe("malformed events", () => {
  it("render a neutral line instead of throwing", () => {
    const bad: unknown[] = [
      null,
      42,
      "text",
      {},
      { t: "x", kind: "requery", say: "", domain: "music", reason: "mystery", paramChanges: {} },
      { t: "x", kind: "score", say: "" },
      { t: "x", kind: "future_kind", say: "Did a new thing." },
      { t: "x", kind: "future_kind", say: "Used filter.popularity.max" },
    ];
    const steps = buildSteps(bad, ctx);
    expect(steps.length).toBeGreaterThan(0);
    expect(steps[0].text).toBe("Took another step.");
    expect(steps.some((s) => s.text === "Did a new thing.")).toBe(true);
    expect(steps.every((s) => !/filter\./.test(s.text))).toBe(true);
  });
});

describe("parseTraceLine", () => {
  it("parses a valid JSONL line and rejects the rest", () => {
    const line = JSON.stringify(FIXTURE_TRACE[3]);
    expect(parseTraceLine(line)).toEqual(FIXTURE_TRACE[3]);
    expect(parseTraceLine(`data: ${line}`)).toEqual(FIXTURE_TRACE[3]);
    expect(parseTraceLine(`data:${line}`)).toEqual(FIXTURE_TRACE[3]);
    expect(parseTraceLine(": keep-alive")).toBeNull();
    expect(parseTraceLine("event: trace")).toBeNull();
    expect(parseTraceLine("data: [DONE]")).toBeNull();
    expect(parseTraceLine("")).toBeNull();
    expect(parseTraceLine("{not json")).toBeNull();
    expect(parseTraceLine(JSON.stringify({ kind: "nope" }))).toBeNull();
  });
});
