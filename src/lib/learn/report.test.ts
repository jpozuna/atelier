import { describe, expect, it } from "vitest";
import { buildReport, formatReport, type ReportRun, type ReportSignal } from "./report";

const rec = (pickId: string, domain: string, band: string, themeTags: string[], axisId: string | null = "axis-a", requeryReason: string | null = null) => ({ pickId, domain, band, themeTags, axisId, requeryReason });
const runOf = (id: string, picks: ReturnType<typeof rec>[], extra: Record<string, unknown> = {}): ReportRun => ({ id, outcome: "ok", keptPickIds: picks.map((p) => p.pickId), trace: { audit: { picks, ...extra } } });
const sig = (runId: string, pickId: string, signal: string, source = "reaction", createdAt = "2026-10-22T10:00:00.000Z"): ReportSignal => ({ runId, pickId, signal, source, createdAt });

describe("buildReport", () => {
  const runs: ReportRun[] = [
    runOf("r1", [rec("p1", "film", "high", ["t1", "t2"]), rec("p2", "music", "extreme", ["t1"], "axis-b", "too_obvious"), rec("p3", "books", "moderate", ["t3"])]),
    runOf("r2", [rec("p4", "film", "high", ["t2"])], { learned: { excluded: [] } }),
    { id: "r3", outcome: "ok", keptPickIds: ["p5", "p6"], trace: { audit: {} } },
    { id: "r4", outcome: "failed", keptPickIds: [], trace: { audit: null } },
  ];

  it("counts shown, kept, set aside and shown again per theme, axis, re-query reason, band and field", () => {
    const r = buildReport(runs, [sig("r1", "p1", "saved_later"), sig("r1", "p2", "not_me", "not_me_list"), sig("r1", "p3", "not_me", "exclude"), sig("r2", "p4", "tried")]);
    expect(r.runs).toEqual({ total: 4, ok: 3, failed: 1, withPickRecords: 2, thatLearned: 1 });
    expect(r.picks).toEqual({ shown: 4, kept: 1, setAside: 1, shownAgain: 1, unrecorded: 2 });
    expect(r.byTheme.t1).toEqual({ shown: 2, kept: 1, setAside: 1, shownAgain: 0 });
    expect(r.byTheme.t2).toEqual({ shown: 2, kept: 1, setAside: 0, shownAgain: 0 });
    expect(r.byTheme.t3).toEqual({ shown: 1, kept: 0, setAside: 0, shownAgain: 1 });
    expect(r.byAxis["axis-b"]).toEqual({ shown: 1, kept: 0, setAside: 1, shownAgain: 0 });
    expect(r.byRequery.too_obvious).toEqual({ shown: 1, kept: 0, setAside: 1, shownAgain: 0 });
    expect(r.byRequery.none?.shown).toBe(3);
    expect(r.byBand.high).toEqual({ shown: 2, kept: 1, setAside: 0, shownAgain: 0 });
    expect(r.byField.film?.shown).toBe(2);
  });

  it("the latest stance wins, and tried is skipped", () => {
    const r = buildReport([runs[0]!], [sig("r1", "p1", "saved_try", "reaction", "2026-10-22T10:00:00.000Z"), sig("r1", "p1", "not_interested", "reaction", "2026-10-22T11:00:00.000Z"), sig("r1", "p2", "not_me", "not_me_list", "2026-10-22T10:00:00.000Z"), sig("r1", "p2", "saved_later", "reaction", "2026-10-22T12:00:00.000Z"), sig("r1", "p2", "tried")]);
    expect(r.picks).toMatchObject({ kept: 1, setAside: 1 });
  });

  it("an inferred (exclude) not_me never overrides an exact save, and is counted as shown again", () => {
    const r = buildReport([runs[0]!], [sig("r1", "p1", "saved_later", "reaction", "2026-10-22T10:00:00.000Z"), sig("r1", "p1", "not_me", "exclude", "2026-10-22T12:00:00.000Z")]);
    expect(r.picks).toMatchObject({ kept: 1, setAside: 0, shownAgain: 1 });
    expect(buildReport([runs[0]!], [sig("r1", "p2", "not_me", "exclude")]).picks).toMatchObject({ kept: 0, setAside: 0, shownAgain: 1 });
  });

  it("orders mixed time formats by the instant they name", () => {
    // 11:00 at +00:00 is later than 10:30Z, though the strings sort the other way.
    const r = buildReport([runs[0]!], [sig("r1", "p1", "saved_try", "reaction", "2026-10-22T11:00:00.000+00:00"), sig("r1", "p1", "not_interested", "reaction", "2026-10-22T10:30:00.000Z")]);
    expect(r.picks).toMatchObject({ kept: 1, setAside: 0 });
  });

  it("reads an empty log, and a malformed audit, without throwing", () => {
    expect(buildReport([], []).picks.shown).toBe(0);
    expect(buildReport([{ id: "x", trace: { audit: { picks: [null, 3, { pickId: 5 }, { pickId: "ok" }] } } }], []).picks.shown).toBe(1);
  });

  it("holds counts only: every figure is a whole number under a plain count name", () => {
    const r = buildReport(runs, [sig("r1", "p1", "saved_later")]);
    for (const m of [r.byTheme, r.byAxis, r.byRequery, r.byBand, r.byField]) {
      for (const c of Object.values(m)) {
        expect(Object.keys(c).sort()).toEqual(["kept", "setAside", "shown", "shownAgain"]);
        for (const n of Object.values(c)) expect(Number.isInteger(n)).toBe(true);
      }
    }
    expect(Object.keys(r.picks).sort()).toEqual(["kept", "setAside", "shown", "shownAgain", "unrecorded"]);
  });

  it("formats a table for a terminal", () => {
    const text = formatReport(buildReport(runs, [sig("r1", "p1", "saved_later")]));
    expect(text).toContain("by band");
    expect(text).toContain("by theme tag");
    expect(text).toMatch(/high\s+2\s+1/);
  });
});
