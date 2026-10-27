import { describe, expect, it } from "vitest";
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

  it("says stretch as a word, never a number or a connection word", () => {
    expect(COPY.stretchLabel("low")).toBe("Low stretch");
    expect(COPY.whereEdge("Quiet rooms", "medium")).toBe("On the chart: beside Quiet rooms, at medium stretch.");
    expect(COPY.whereEdge(null, "high")).toBe("On the chart: at high stretch.");
    expect(COPY.whereClose(null)).toBe("On the chart: very close to what you named.");
    for (const t of [COPY.edgeLede, COPY.keyHint, COPY.stretchLabel("high")]) expect(t).not.toMatch(/\b(strong|steady|light|strength)\b/i);
  });

  it("no longer offers the streamed steps or the plain-model comparison on this screen", () => {
    const keys = Object.keys(COPY);
    for (const gone of ["latestStep", "lastStep", "stepsLabel", "readAllSteps", "compareLink"]) expect(keys).not.toContain(gone);
  });

  it("announces a tick with the axis, and says nothing about one when there is none", () => {
    expect(COPY.addedAnnounce("Juniper Study", "Weather and coast")).toBe("Juniper Study is on the chart, beside Weather and coast.");
    expect(COPY.addedAnnounce("Juniper Study", null)).toBe("Juniper Study is on the chart.");
    expect(COPY.beside("Handmade craft")).toBe("Beside Handmade craft");
    expect(COPY.cleared).toBeTruthy();
  });

  it("no longer carries the sources-none or inferred-count lines", () => {
    const keys = Object.keys(COPY);
    for (const gone of ["sourcesNone", "inferredSteps", "inferredWord", "shown"]) expect(keys).not.toContain(gone);
  });

  it("has no sort or field-toggle wording any more: the chart key filters fields", () => {
    const keys = Object.keys(COPY);
    for (const gone of ["sortLabel", "sortField", "sortStretch", "fieldsHeading", "fieldsHint", "hideField", "moreBelow"]) expect(keys).not.toContain(gone);
    expect(COPY.keyHint).toBe("Select a field to hide it.");
    expect(COPY.edgeLede).toBe("Stretch is distance from your profile, not a grade. Select one to see its path back to you.");
  });

  it("says which fields are still coming, and what a stopped run kept, by their labels and without codes", () => {
    expect(COPY.stillComing(["tv", "books"])).toBe("Still coming: TV, Books.");
    expect(COPY.partialStopped(["film"])).toBe("The run stopped early. Film did not arrive; the rest are shown.");
    expect(COPY.partialStopped(["tv", "books", "food_places", "fashion"])).toBe("The run stopped early. TV, Books, Food and places and Fashion did not arrive; the rest are shown.");
    expect(COPY.partialStopped(["film", "tv"])).toBe("The run stopped early. Film and TV did not arrive; the rest are shown.");
    expect(COPY.partialStopped([])).toMatch(/stopped early/);
    for (const t of [COPY.stillComing(["film"]), COPY.partialStopped(["film"]), COPY.partialStopped([]), COPY.notMeStopped]) expect(t).not.toMatch(/error|failed|sorry|!/i);
  });

  it("builds the hint on a tile from the path's own words, omitting what is missing", () => {
    expect(COPY.fromThrough("Seed", "a theme")).toBe("From Seed, through a theme");
    expect(COPY.fromThrough("Seed", null)).toBe("From Seed");
    expect(COPY.fromThrough(null, null)).toBe("");
  });
});
