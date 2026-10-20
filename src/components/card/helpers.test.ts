import { afterEach, describe, expect, it, vi } from "vitest";
import { REACTION_STATES, isCard } from "@/types";
import type { Path } from "@/types";
import {
  REACTION_LABEL,
  SAVE_STATES,
  buildReaction,
  choiceStatus,
  countProvenance,
  initialState,
  offeredStates,
  pathToDisplaySteps,
  pickTitle,
  provenanceSummary,
  safeHref,
  showsWords,
  whyHint,
} from "./helpers";
import { MOCK_CARDS } from "./mock";

const [withLineage, inferredOnly, reacted] = MOCK_CARDS;

afterEach(() => vi.restoreAllMocks());

describe("mock cards", () => {
  it("are valid cards and their stored provenance equals their counted hops", () => {
    for (const m of MOCK_CARDS) {
      expect(isCard(m.card)).toBe(true);
      expect(m.card.provenance).toEqual(countProvenance(m.card.path));
    }
  });
  it("use only synthetic ids", () => {
    const ids = JSON.stringify(MOCK_CARDS).match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) ?? [];
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(id).toMatch(/^00000000-0000-4000-8000-0000000000\d\d$/);
  });
  it("only ever source a lineage hop, never a seed or pick", () => {
    for (const m of MOCK_CARDS) {
      for (const hop of m.card.path.hops) {
        if (hop.kind === "seed" || hop.kind === "pick") expect(hop.sourceUrl).toBeUndefined();
        if (hop.kind === "lineage") expect(hop.provenance).toBe("sourced");
      }
    }
  });
  it("carry no popularity or audience phrasing", () => {
    const text = MOCK_CARDS.map((m) => `${m.card.why} ${m.card.different}`).join(" ").toLowerCase();
    for (const word of ["popular", "widely known", "following", "audience", "mainstream", "obscure"]) {
      expect(text).not.toContain(word);
    }
  });
});

describe("pathToDisplaySteps", () => {
  it("keeps hop order", () => {
    expect(pathToDisplaySteps(withLineage.card.path).map((s) => s.kind)).toEqual(["seed", "theme", "lineage", "pick"]);
  });
  it("puts a provenance badge on theme and lineage hops only, in words", () => {
    const steps = pathToDisplaySteps(withLineage.card.path);
    expect(steps.map((s) => s.badge?.label)).toEqual([undefined, "Inferred", "Sourced", undefined]);
    expect(steps.filter((s) => s.kind === "seed" || s.kind === "pick").every((s) => !s.badge && !s.href)).toBe(true);
  });
  it("uses solid for sourced and dashed for inferred", () => {
    const badges = pathToDisplaySteps(withLineage.card.path).flatMap((s) => (s.badge ? [s.badge] : []));
    expect(badges.every((b) => b.lineStyle === (b.provenance === "sourced" ? "solid" : "dashed"))).toBe(true);
  });
  it("links the sourced lineage hop only", () => {
    const steps = pathToDisplaySteps(reacted.card.path);
    expect(steps.filter((s) => s.href).map((s) => s.kind)).toEqual(["lineage"]);
  });
  it("labels a lineage hop as a reading", () => {
    const lineage = pathToDisplaySteps(withLineage.card.path).find((s) => s.kind === "lineage");
    expect(lineage?.kindLabel.toLowerCase()).toContain("a reading");
  });
  it("has no links for an inferred-only path", () => {
    expect(pathToDisplaySteps(inferredOnly.card.path).some((s) => s.href)).toBe(false);
  });
  it("flags a sourced hop with an unusable link instead of linking it", () => {
    const path = structuredClone(withLineage.card.path);
    path.hops[2].sourceUrl = "javascript:alert(1)";
    const lineage = pathToDisplaySteps(path)[2];
    expect(lineage.href).toBeUndefined();
    expect(lineage.linkMissing).toBe(true);
  });
  it("flags a sourced hop with no sourceUrl", () => {
    const path = structuredClone(withLineage.card.path);
    delete path.hops[2].sourceUrl;
    const lineage = pathToDisplaySteps(path)[2];
    expect(lineage.href).toBeUndefined();
    expect(lineage.linkMissing).toBe(true);
  });
  it("does not link an inferred hop that carries a sourceUrl", () => {
    const path = structuredClone(withLineage.card.path);
    path.hops[1].sourceUrl = "https://example.org/mock/stray";
    const theme = pathToDisplaySteps(path)[1];
    expect(theme.badge?.label).toBe("Inferred");
    expect(theme.href).toBeUndefined();
    expect(theme.linkMissing).toBe(false);
  });
  it("omits an inferred lineage hop and warns, never drawing it as lineage", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const path: Path = structuredClone(withLineage.card.path);
    path.hops[2].provenance = "inferred";
    const steps = pathToDisplaySteps(path);
    expect(steps.map((s) => s.kind)).toEqual(["seed", "theme", "pick"]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(countProvenance(path)).toEqual({ sourced: 0, inferred: 1 });
  });
  it("returns no steps for empty hops", () => {
    expect(pathToDisplaySteps({ ...withLineage.card.path, hops: [] })).toEqual([]);
  });
});

describe("safeHref", () => {
  it("allows http and https", () => {
    expect(safeHref("https://example.org/a")).toBe("https://example.org/a");
    expect(safeHref("http://example.org/a")).toBe("http://example.org/a");
  });
  it("rejects empty, data:, mailto:, javascript: and malformed values", () => {
    for (const bad of ["", "data:text/html,hi", "mailto:a@example.org", "javascript:alert(1)", "not a url", undefined]) {
      expect(safeHref(bad)).toBeUndefined();
    }
  });
});

describe("provenance summary and title", () => {
  it("counts theme and lineage hops only, in words", () => {
    expect(provenanceSummary(withLineage.card.path)).toBe("Connecting steps: 1 sourced, 1 inferred.");
    expect(provenanceSummary(inferredOnly.card.path)).toBe("Connecting steps: 0 sourced, 1 inferred.");
  });
  it("takes the title from the pick hop", () => {
    expect(pickTitle(withLineage.card)).toBe("Hollow Meridian");
  });
  it("falls back to Untitled pick when there are no hops", () => {
    expect(pickTitle({ ...withLineage.card, path: { ...withLineage.card.path, hops: [] } })).toBe("Untitled pick");
  });
});

describe("reaction", () => {
  it("offers four save states, each with a label, and with tried makes up every reaction state", () => {
    expect(SAVE_STATES).toHaveLength(4);
    for (const s of SAVE_STATES) expect(REACTION_LABEL[s].length).toBeGreaterThan(0);
    expect([...SAVE_STATES, "tried"].sort()).toEqual([...REACTION_STATES].sort());
  });
  it("offers tried only when the card already carries it", () => {
    expect(offeredStates(undefined)).toEqual([...SAVE_STATES]);
    expect(offeredStates({ state: "will_try", at: "2026-10-19T00:00:00.000Z" })).toEqual([...SAVE_STATES]);
    expect(offeredStates({ state: "tried", at: "2026-10-19T00:00:00.000Z" })).toEqual([...SAVE_STATES, "tried"]);
  });
  it("never offers tried in states mode, even when the card carries it", () => {
    const tried = { state: "tried", at: "2026-10-19T00:00:00.000Z" } as const;
    expect(offeredStates(tried, "states")).toEqual([...SAVE_STATES]);
    expect(offeredStates(undefined, "states")).toEqual([...SAVE_STATES]);
    expect(offeredStates(tried, "full")).toEqual([...SAVE_STATES, "tried"]);
  });
  it("starts on the stored state only when the mode offers it", () => {
    const at = "2026-10-19T00:00:00.000Z";
    expect(initialState({ state: "explore", at }, "states")).toBe("explore");
    expect(initialState({ state: "tried", at }, "states")).toBeNull();
    expect(initialState({ state: "tried", at }, "full")).toBe("tried");
    expect(initialState(undefined)).toBeNull();
  });
  it("shows the words box always in full mode, and only for Not for me in states mode", () => {
    for (const s of [null, ...REACTION_STATES]) expect(showsWords("full", s)).toBe(true);
    expect(showsWords("states", "not_interested")).toBe(true);
    for (const s of [null, "later", "will_try", "explore", "tried"] as const) expect(showsWords("states", s)).toBe(false);
  });
  it("says Chosen, never Saved, and nothing when the parent confirms", () => {
    expect(choiceStatus("later", false)).toBe("Chosen: Save for later.");
    expect(choiceStatus("later", true)).toBe("");
    expect(choiceStatus(null, false)).toBe("");
    for (const s of SAVE_STATES) expect(choiceStatus(s, false)).not.toMatch(/saved/i);
  });
  it("builds a reaction and omits empty words", () => {
    const now = new Date("2026-10-19T00:00:00.000Z");
    expect(buildReaction("later", "   ", now)).toEqual({ state: "later", at: now.toISOString() });
    expect(buildReaction("not_interested", "  too ornate ", now)).toEqual({
      state: "not_interested",
      words: "too ornate",
      at: now.toISOString(),
    });
  });
  it("asks for a reason on not_interested in plain words", () => {
    expect(whyHint("not_interested")).toBe("Say what did not fit.");
  });
});
