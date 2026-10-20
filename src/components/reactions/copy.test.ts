import { describe, expect, it } from "vitest";
import { REACTION_LABEL } from "@/components/card/helpers";
import { FIELDS } from "@/types";
import { COPY, GROUP_COPY, GROUP_ORDER, fieldWord } from "./copy";

function allText(): string[] {
  const out: string[] = [];
  for (const v of Object.values(COPY)) {
    if (typeof v === "string") out.push(v);
    else if (typeof v === "function") {
      const f = v as (...a: never[]) => unknown;
      for (const args of [["music"], ["tv"], [1], [3], ["reader@example.test"], ["Seed Alpha", "a theme"], [null, null], ["Seed Alpha", null]]) {
        try {
          const r = f(...(args as never[]));
          if (typeof r === "string") out.push(r);
        } catch {
          // Sample does not fit this function.
        }
      }
    }
  }
  for (const g of Object.values(GROUP_COPY)) out.push(g.title, g.gloss);
  for (const f of FIELDS) out.push(COPY.lookingAgain(f), COPY.looked(f), COPY.lookedNothing(f), COPY.lookedFailed(f), COPY.furtherHeading(f));
  return out;
}

describe("wording", () => {
  const text = allText();

  it("has text to check", () => {
    expect(text.length).toBeGreaterThan(60);
  });

  it("is reserved: no exclamation marks, and no scores, ranks or match percentages (hard rule 7)", () => {
    for (const t of text) {
      expect(t, t).not.toMatch(/!/);
      expect(t, t).not.toMatch(/\b(score|scores|scored|rank|ranked|ranking|percent|percentage|match(es)? you|stars?|rating)\b|%/i);
    }
  });

  it("does not claim a taste of its own, and does not praise", () => {
    for (const t of text) {
      expect(t, t).not.toMatch(/\bI (love|like|think|recommend)\b|\bwe (love|recommend)\b/i);
      expect(t, t).not.toMatch(/\b(great|awesome|amazing|congrat|well done|nice work)\b/i);
    }
  });

  it("names every group, in the order the list shows", () => {
    // The card's own order and the card's own labels: no group is above another, and one vocabulary runs through both.
    expect(GROUP_ORDER).toEqual(["later", "will_try", "explore", "not_interested", "tried"]);
    for (const k of GROUP_ORDER) expect(GROUP_COPY[k].title).toBe(REACTION_LABEL[k]);
  });

  it("asks the three follow-up questions", () => {
    expect(COPY.triedLegend).toMatch(/try/i);
    expect(COPY.howLegend).toMatch(/how was it/i);
    expect(COPY.whyLabel).toMatch(/why/i);
  });

  it("does not say whether an address already has an account, and says how long the link lasts and where to look", () => {
    expect(COPY.sent("a@example.test")).not.toMatch(/already|exists|welcome back|new account/i);
    expect(COPY.sent("a@example.test")).toMatch(/one hour/);
    expect(COPY.sent("a@example.test")).toMatch(/spam/i);
  });

  it("says why saving needs an account and that the choice is saved after the link", () => {
    expect(COPY.signInLede).toMatch(/Saving needs an account/);
    expect(COPY.signInLede).toMatch(/what you chose is saved/);
  });

  it("asks before saving what a guest chose, naming how many", () => {
    expect(COPY.pendingConfirm(1)).toBe("Save the pick you chose before signing in?");
    expect(COPY.pendingConfirm(4)).toBe("Save the 4 picks you chose before signing in?");
    expect(COPY.pendingForget).toBe("Forget the waiting picks");
  });

  it("does not claim the profile moved where nothing shows it", () => {
    expect(COPY.addedSeed).toMatch(/next time/);
  });

  it("speaks of fields in plain words", () => {
    for (const f of FIELDS) expect(fieldWord(f)).toMatch(/^[a-zA-Z ]+$/);
    expect(COPY.furtherHeading("food_places")).toBe("Further out in food and places");
  });
});
