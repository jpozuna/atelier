import { describe, expect, it } from "vitest";
import { fakeAnthropic, fakeQloo, input, modelFor, offlineRefs } from "@/lib/agent/testing";
import { runAgent } from "@/lib/agent/loop";
import { toPublicResult } from "@/lib/agent/public";
import { pickRecordsOf, withPickRecords } from "./pick-records";

async function realRun() {
  const w = fakeQloo().client();
  return runAgent(input(), { insights: (p, o) => w.client.insights(p, o), preflight: w.preflight, refs: offlineRefs(), llm: modelFor(fakeAnthropic()) });
}

describe("pickRecordsOf", () => {
  it("has one record per shown pick, with its themes, field, band and the axis that led its field", async () => {
    const result = await realRun();
    const records = pickRecordsOf(result);
    const shown = result.domains.flatMap((d) => d.picks);
    expect(records.map((r) => r.pickId)).toEqual(shown.map((p) => p.id));
    for (const r of records) {
      const pick = shown.find((p) => p.id === r.pickId)!;
      expect(r.qlooId).toBe(pick.qlooId);
      expect(r.band).toBe(pick.band);
      expect(r.themeTags).toEqual([...new Set([...pick.path.sharedTags, ...pick.path.hops.flatMap((h) => (h.kind === "theme" ? (h.tags ?? []) : []))])].sort());
      expect(r.axisId).toBe(result.plan.themes.find((t) => t.domain === r.domain)?.axisId ?? null);
    }
  });
});

describe("withPickRecords", () => {
  it("adds audit.picks (and audit.learned when the run learned) to a copy, and the public result still has no audit", async () => {
    const result = await realRun();
    const out = withPickRecords(result, { exclude: ["e1"], awayTags: ["t1"], towardTags: [], step: 0.3 });
    expect(out).not.toBe(result);
    expect((result.audit as unknown as Record<string, unknown>).picks).toBeUndefined();
    const audit = out.audit as unknown as { picks: unknown[]; learned: unknown; seedIds: string[] };
    expect(audit.picks.length).toBe(pickRecordsOf(result).length);
    expect(audit.learned).toEqual({ excluded: ["e1"], awayTags: ["t1"], towardTags: [] });
    expect(audit.seedIds).toEqual(result.audit.seedIds);
    expect(JSON.stringify(toPublicResult(out))).not.toMatch(/awayTags|"picks":\[\{"pickId"|learned/);
  });

  it("omits learned when nothing was learned", async () => {
    const result = await realRun();
    expect((withPickRecords(result, null).audit as unknown as Record<string, unknown>).learned).toBeUndefined();
    expect((withPickRecords(result, { exclude: [], awayTags: [], towardTags: [], step: 0.3 }).audit as unknown as Record<string, unknown>).learned).toBeUndefined();
  });
});
