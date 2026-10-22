import { describe, expect, it } from "vitest";
import { learningEnabled } from "./enabled";

describe("learningEnabled", () => {
  it("is off in replay, by default and when set", () => {
    expect(learningEnabled({})).toBe(false);
    expect(learningEnabled({ QLOO_MODE: "replay" })).toBe(false);
  });
  it("is on when Qloo calls can be made", () => {
    expect(learningEnabled({ QLOO_MODE: "live" })).toBe(true);
    expect(learningEnabled({ QLOO_MODE: "record" })).toBe(true);
    expect(learningEnabled({ QLOO_SYNTHETIC: "1" })).toBe(true);
  });
  it("is never on for synthetic Qloo on Vercel", () => {
    expect(learningEnabled({ QLOO_SYNTHETIC: "1", VERCEL: "1" })).toBe(false);
  });
  it("is forced by ATELIER_LEARN", () => {
    expect(learningEnabled({ ATELIER_LEARN: "off", QLOO_MODE: "live" })).toBe(false);
    expect(learningEnabled({ ATELIER_LEARN: "on" })).toBe(true);
  });
});
