import { describe, expect, it } from "vitest";
import { FIELDS } from "@/types";
import { COPY, failedBodyFor, failedTitleFor, rerunFailedFor } from "./copy";

/** Every string the screen can say, with the functions called on sample input. */
function allText(): string[] {
  const out: string[] = [];
  for (const v of Object.values(COPY)) {
    if (typeof v === "string") out.push(v);
    else if (typeof v === "function") {
      const f = v as (...a: never[]) => unknown;
      const samples: unknown[][] = [[3], ["Amber Study"], ["music"], ["Moderate"], ["Seed Alpha", "a theme"], [null, null], [null], ["Seed Alpha"]];
      for (const args of samples) {
        try {
          const r = f(...(args as never[]));
          if (typeof r === "string") out.push(r);
        } catch {
          // A sample that does not fit this function.
        }
      }
    }
  }
  for (const code of [null, "busy", "rate_limited", "budget", "lookups_off", "demo_resting", "too_many_requests", "http_429", "upstream", "incomplete", "network"]) {
    out.push(failedBodyFor(code), failedTitleFor(code), rerunFailedFor(code));
  }
  return out;
}

describe("wording", () => {
  const text = allText();

  it("has text to check", () => {
    expect(text.length).toBeGreaterThan(40);
  });

  it("is reserved: no exclamation marks, and no scores, ranks or match percentages (hard rule 7)", () => {
    for (const t of text) {
      expect(t, t).not.toMatch(/!/);
      expect(t, t).not.toMatch(/\b(score|scores|scored|rank|ranked|ranking|percent|percentage|match(es)? you|stars?)\b|%/i);
    }
  });

  it("does not claim a taste of its own", () => {
    for (const t of text) expect(t, t).not.toMatch(/\bI (love|like|think|recommend)\b|\bwe (love|recommend)\b/i);
  });

  it("never carries the server's wording: a failure maps to a fixed sentence", () => {
    expect(failedBodyFor("upstream")).toBe(COPY.failedBody);
    expect(failedBodyFor("picks_not_enabled")).toBe(COPY.failedBody);
  });

  it("maps resting and rate-limit codes to fixed calm copy", () => {
    for (const code of ["demo_resting", "budget", "lookups_off"]) {
      expect(failedBodyFor(code)).toBe(COPY.restingBody);
      expect(failedTitleFor(code)).toBe(COPY.restingTitle);
      expect(rerunFailedFor(code)).toBe(COPY.restingRerun);
    }
    for (const code of ["too_many_requests", "http_429"]) {
      expect(failedBodyFor(code)).toBe(COPY.tooManyBody);
      expect(failedTitleFor(code)).toBe(COPY.tooManyTitle);
      expect(rerunFailedFor(code)).toBe(COPY.tooManyRerun);
    }
    expect(COPY.restingBody).toBe("The demo is resting for now. Your list and chart are kept here; try again later.");
    expect(COPY.restingBody).not.toMatch(/error|failed|sorry/i);
  });

  it("keeps the failure wording for other codes and never echoes a code", () => {
    for (const code of [null, "upstream", "network", "weird_code_xyz"]) {
      expect(failedTitleFor(code)).toBe(COPY.failedTitle);
      expect(rerunFailedFor(code)).toBe(COPY.rerunFailed);
      expect(failedBodyFor(code)).not.toContain("weird_code_xyz");
    }
  });

  it("says the not-ready state calmly, with no error language", () => {
    expect(COPY.notReadyTitle).toBe("Picks aren't ready yet");
    expect(COPY.notReadyBody).not.toMatch(/error|failed|wrong with the/i);
  });

  it("names a hide button for every field", () => {
    for (const f of FIELDS) expect(COPY.hideField(f)).toMatch(/^Hide /);
  });

  it("builds the hint on a tile from the path's own words, omitting what is missing", () => {
    expect(COPY.fromThrough("Seed", "a theme")).toBe("From Seed, through a theme");
    expect(COPY.fromThrough("Seed", null)).toBe("From Seed");
    expect(COPY.fromThrough(null, null)).toBe("");
  });
});
