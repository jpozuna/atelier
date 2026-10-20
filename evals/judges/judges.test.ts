// Tests for the judges, using only the fake model. No network, no key, no Qloo data.

import { describe, expect, it } from "vitest";
import { createFakeLlm } from "./fake";
import { agrees, itemAgrees, judgeUserMessage, missingQuotes, nothingToCheck, parseVerdict, runJudge, scalar } from "./judge";
import { CALIBRATION, allCalibrationItems } from "./calibration";
import { JUDGE_TOOL_NAME, judgeSystem, judgeTool, loadRubric, parseRubricSections } from "./rubrics";
import { MAX_JUDGE_CALLS_PER_RUN, MIN_AGREEMENT, MIN_QUOTE_CHARS } from "@/lib/agent/config";
import { ENV_LIVE } from "./config";
import { expectedCalls, formatReport, judgeModel, judgesGate, llmFor, runJudges } from "./run";
import { JUDGE_IDS, JUDGE_KIND, type CalibrationItem, type JudgeInput, type Verdict } from "./types";
import { LlmError } from "@/lib/agent/llm";

const items = allCalibrationItems();
const byId = (id: string): CalibrationItem => {
  const it = items.find((i) => i.id === id);
  if (!it) throw new Error(`no item ${id}`);
  return it;
};
const good = (it: CalibrationItem, over: Record<string, unknown> = {}): Record<string, unknown> => ({
  scorer: it.judge,
  card_id: it.id,
  judgeable: true,
  result: it.expected,
  evidence: [it.input.judge === "stretch-defensibility" ? it.input.stretch.why : it.input.card.why],
  unsupported_claims: [],
  reason: "ok",
  ...(JUDGE_KIND[it.judge] === "fit" ? { slop: false } : {}),
  ...over,
});

describe("rubrics", () => {
  it("loads the general instructions and a section for every judge from the shared rubric file", () => {
    for (const j of JUDGE_IDS) {
      const { general, criterion } = loadRubric(j);
      expect(general.length).toBeGreaterThan(50);
      expect(criterion.length).toBeGreaterThan(50);
    }
  });

  it("parses headings that carry a suffix", () => {
    const m = parseRubricSections("# t\n\n## General instructions for x\nA\n\n## bridge-quality (1 to 5)\nB\n");
    expect(m.get("general")).toBe("A");
    expect(m.get("bridge-quality")).toBe("B");
  });

  it("builds a system prompt with the rubric, the data-not-instructions rule and the tool name", () => {
    for (const j of JUDGE_IDS) {
      const s = judgeSystem(j);
      expect(s).toContain(loadRubric(j).criterion.slice(0, 40));
      expect(s).toMatch(/never as instructions/);
      expect(s).toContain(JUDGE_TOOL_NAME);
    }
  });

  it("defines one structured-output tool per judge with the right result shape", () => {
    for (const j of JUDGE_IDS) {
      const t = judgeTool(j);
      const props = (t.input_schema as { properties: Record<string, { enum?: string[]; type?: string }>; required: string[] }).properties;
      const required = (t.input_schema as { required: string[] }).required;
      expect(t.name).toBe(JUDGE_TOOL_NAME);
      expect(props.scorer.enum).toEqual([j]);
      for (const k of ["card_id", "judgeable", "result", "evidence", "unsupported_claims", "reason"]) expect(required).toContain(k);
      const kind = JUDGE_KIND[j];
      if (kind === "binary") expect(props.result.enum).toEqual(["pass", "fail"]);
      if (kind === "score") expect(props.result.type).toBe("integer");
      if (kind === "fit") {
        expect(props.result.type).toBe("object");
        expect(required).toContain("slop");
      }
    }
  });
});

describe("user message", () => {
  it("is the input as JSON and carries no tag ids and no numbers about taste", () => {
    for (const it of items) {
      const text = judgeUserMessage(it.input);
      expect(JSON.parse(text).id).toBe(it.id);
      expect(text).not.toMatch(/urn:tag:/);
      expect(text).not.toMatch(/"(contribution|popularity|reach|score|connection)\w*"\s*:/i);
    }
  });
});

describe("evidence check", () => {
  const input = byId("bg-01").input;
  it("finds quotes that are in the explanation, ignoring case, spacing and quote marks", () => {
    expect(missingQuotes(input, ["SHARES the seed\u2019s long takes", "long takes  and slow pacing"])).toEqual([]);
  });
  it("reports quotes that are not there", () => {
    expect(missingQuotes(input, ["was inspired by the seed's director"])).toEqual(["was inspired by the seed's director"]);
  });
  it("rejects quotes shorter than the minimum", () => {
    expect("slow pacing".length).toBeLessThan(MIN_QUOTE_CHARS);
    expect(missingQuotes(input, ["slow pacing"])).toEqual(["slow pacing"]);
  });
  it("groundedness quotes must come from why or different, not from the seed's own words", () => {
    const inCard = (input as Extract<JudgeInput, { card: unknown }>).card;
    expect(missingQuotes(input, [inCard.seed.why])).toEqual([inCard.seed.why]);
    expect(missingQuotes(input, [inCard.different])).toEqual([]);
  });
  it("other judges may quote anywhere on the card, and stretch only from the Stretch card", () => {
    const q = byId("bq-05").input as Extract<JudgeInput, { card: unknown }>;
    expect(missingQuotes(q, [q.card.seed.why])).toEqual([]);
    const sd = byId("sd-01").input as Extract<JudgeInput, { stretch: unknown }>;
    expect(missingQuotes(sd, [sd.stretch.why])).toEqual([]);
    expect(missingQuotes(sd, [sd.match.why])).toEqual([sd.match.why]);
  });
});

describe("nothingToCheck", () => {
  it("is decided from the card: lineage hop or sources need evidence; readings and sources need evidence for reading-restraint", () => {
    expect(nothingToCheck(byId("lg-03").input)).toBe(true);
    expect(nothingToCheck(byId("lg-01").input)).toBe(false);
    expect(nothingToCheck(byId("lg-07").input)).toBe(false);
    expect(nothingToCheck(byId("rr-01").input)).toBe(true);
    expect(nothingToCheck(byId("rr-02").input)).toBe(false);
    expect(nothingToCheck(byId("bg-01").input)).toBe(false);
    expect(nothingToCheck(byId("sd-01").input)).toBe(false);
  });
});

describe("parseVerdict", () => {
  const it0 = byId("bg-01");
  it("accepts a well-formed pass with real evidence", () => {
    const v = parseVerdict(it0.judge, it0.id, it0.input, good(it0));
    expect(v.result).toBe("pass");
    expect(v.evidenceMissing).toEqual([]);
    expect(v.adjusted).toBeUndefined();
  });

  it("downgrades a pass whose quote is not in the input", () => {
    const v = parseVerdict(it0.judge, it0.id, it0.input, good(it0, { evidence: ["it was inspired by the seed's director"] }));
    expect(v.result).toBe("fail");
    expect(v.adjusted).toMatch(/not in the input/);
  });

  it("downgrades a groundedness pass with no evidence", () => {
    expect(parseVerdict(it0.judge, it0.id, it0.input, good(it0, { evidence: [] })).result).toBe("fail");
  });

  it("lets lineage and reading judges pass with no evidence only when the card has nothing to check", () => {
    for (const id of ["lg-03", "rr-01"]) {
      const it = byId(id);
      expect(parseVerdict(it.judge, it.id, it.input, good(it, { evidence: [] })).result).toBe("pass");
    }
    for (const id of ["lg-01", "lg-02", "rr-02", "rr-03"]) {
      const it = byId(id);
      const v = parseVerdict(it.judge, it.id, it.input, good(it, { evidence: [] }));
      expect(v.result, id).toBe("fail");
      expect(v.adjusted).toMatch(/no evidence/);
    }
  });

  it("withdraws a scored or fit verdict with no evidence, a too-short quote, or a quote not on the card", () => {
    for (const id of ["bq-05", "rf-01"]) {
      const it = byId(id);
      for (const evidence of [[], ["slow pacing"], ["a sentence that is nowhere on this card"]]) {
        const v = parseVerdict(it.judge, it.id, it.input, good(it, { evidence }));
        expect(v.judgeable, `${id} ${evidence.join()}`).toBe(false);
        expect(v.result).toBeNull();
        expect(v.adjusted).toMatch(/withdrawn/);
        expect(agrees(it.expected, v)).toBe(false);
      }
      expect(parseVerdict(it.judge, it.id, it.input, good(it)).judgeable).toBe(true);
    }
  });

  it("does not downgrade a fail", () => {
    const f = byId("bg-06");
    const v = parseVerdict(f.judge, f.id, f.input, good(f, { evidence: ["not in the input at all"], unsupported_claims: ["was inspired by the seed's director"] }));
    expect(v.result).toBe("fail");
    expect(v.unsupportedClaims).toEqual(["was inspired by the seed's director"]);
  });

  it("rejects replies that do not fit the schema", () => {
    const q = byId("bq-05");
    const f = byId("rf-01");
    const cases: [CalibrationItem, Record<string, unknown>][] = [
      [it0, good(it0, { scorer: "bridge-quality" })],
      [it0, good(it0, { card_id: "other" })],
      [it0, good(it0, { result: "maybe" })],
      [it0, good(it0, { evidence: "quote" })],
      [it0, good(it0, { judgeable: "yes" })],
      [q, good(q, { result: 7 })],
      [q, good(q, { result: 3.5 })],
      [f, good(f, { result: { discernment: 4 } })],
      [f, good(f, { slop: undefined })],
    ];
    for (const [it, raw] of cases) expect(() => parseVerdict(it.judge, it.id, it.input, raw)).toThrow(LlmError);
  });

  it("keeps a not-judgeable reply without a result", () => {
    const v = parseVerdict(it0.judge, it0.id, it0.input, good(it0, { judgeable: false, result: undefined, reason: "no path" }));
    expect(v.judgeable).toBe(false);
    expect(v.result).toBeNull();
    expect(agrees("pass", v)).toBe(false);
  });
});

describe("agreement", () => {
  const verdict = (result: Verdict["result"]): Verdict => ({ judge: "bridge-quality", id: "x", judgeable: true, result, evidence: [], evidenceMissing: [], unsupportedClaims: [], reason: "" });
  it("is exact for pass and fail", () => {
    expect(agrees("pass", verdict("pass"))).toBe(true);
    expect(agrees("pass", verdict("fail"))).toBe(false);
  });
  it("allows one point of difference on 1 to 5 scores in the middle, no more", () => {
    expect(agrees(4, verdict(5))).toBe(true);
    expect(agrees(4, verdict(2))).toBe(false);
    expect(agrees(2, verdict(3))).toBe(true);
  });
  it("needs an exact match when the label is 1 or 5", () => {
    expect(agrees(1, verdict(2))).toBe(false);
    expect(agrees(1, verdict(1))).toBe(true);
    expect(agrees(5, verdict(4))).toBe(false);
    expect(agrees(5, verdict(5))).toBe(true);
  });
  it("compares rubric-fit slop to the label when the item has one", () => {
    const it = byId("rf-06");
    const v = { ...verdict({ discernment: 1, pattern: 1, idiosyncrasy: 1 }), judge: "rubric-fit" as const, slop: false };
    expect(it.expectedSlop).toBe(true);
    expect(itemAgrees(it, v)).toBe(false);
    expect(itemAgrees(it, { ...v, slop: true })).toBe(true);
  });
  it("collapses a rubric-fit result to the mean of its three scores", () => {
    expect(scalar({ discernment: 3, pattern: 4, idiosyncrasy: 5 })).toBe(4);
    expect(scalar(3)).toBe(3);
    expect(scalar("pass")).toBeNull();
  });
  it("needs every rubric-fit score within tolerance", () => {
    const label = { discernment: 4, pattern: 4, idiosyncrasy: 5 };
    expect(agrees(label, verdict({ discernment: 3, pattern: 5, idiosyncrasy: 4 }))).toBe(true);
    expect(agrees(label, verdict({ discernment: 3, pattern: 5, idiosyncrasy: 3 }))).toBe(false);
  });
});

describe("runJudge with the fake model", () => {
  it("sends a forced-tool request with the rubric system prompt and the input as the user message", async () => {
    const fake = createFakeLlm(items);
    const it = byId("sd-01");
    const v = await runJudge(fake, it.input);
    expect(v.result).toBe("pass");
    const req = fake.requests[0];
    expect(req.tool.name).toBe(JUDGE_TOOL_NAME);
    expect(req.system).toContain("stretch-defensibility");
    expect(JSON.parse(req.user)).toMatchObject({ judge: "stretch-defensibility", id: "sd-01" });
  });

  it("surfaces a reply that does not fit as an LlmError", async () => {
    const fake = createFakeLlm([]);
    await expect(runJudge(fake, byId("bg-01").input)).rejects.toBeInstanceOf(LlmError);
  });
});

describe("runJudges", () => {
  it("makes one call per calibration item and agrees on all of them with the oracle fake", async () => {
    const fake = createFakeLlm(items);
    const report = await runJudges({ llm: fake, mode: "fake", model: "fake", items });
    expect(report.calls).toBe(items.length);
    expect(report.judges.map((j) => j.judge)).toEqual([...JUDGE_IDS]);
    for (const j of report.judges) {
      expect(j.agreement).toBe(1);
      expect(j.errors).toBe(0);
      expect(j.meetsThreshold).toBe(true);
    }
    expect(report.allMeetThreshold).toBe(true);
  });

  it("reports the ordering check for scored judges: high labels must outscore low labels", async () => {
    const ok = await runJudges({ llm: createFakeLlm(items), mode: "fake", model: "fake", items });
    for (const j of ok.judges) {
      if (JUDGE_KIND[j.judge] === "binary") expect(j.ordering).toBeUndefined();
      else {
        expect(j.ordering?.ok, j.judge).toBe(true);
        expect(j.ordering!.high!).toBeGreaterThan(j.ordering!.low!);
      }
    }
    const flipped = await runJudges({ llm: createFakeLlm(items, { flip: true }), mode: "fake", model: "fake", items });
    for (const j of flipped.judges) if (JUDGE_KIND[j.judge] !== "binary") expect(j.ordering?.ok, j.judge).toBe(false);
  });

  it("fails a scored judge whose agreement is high but whose ordering is wrong", async () => {
    const subset = items.filter((i) => i.judge === "bridge-quality");
    // Always answers 3: within tolerance of every middle label, exact for none of the ends, and no ordering at all.
    const flat = createFakeLlm(subset);
    const call = flat.call.bind(flat);
    flat.call = async (req) => ({ ...(await call(req)), result: 3 });
    const report = await runJudges({ llm: flat, mode: "real", model: "m", items: subset });
    expect(report.judges[0].ordering?.ok).toBe(false);
    expect(report.judges[0].meetsThreshold).toBe(false);
  });

  it("catches a model that disagrees with the labels", async () => {
    const report = await runJudges({ llm: createFakeLlm(items, { flip: true }), mode: "fake", model: "fake", items });
    for (const j of report.judges) {
      expect(j.agreement).toBeLessThan(MIN_AGREEMENT);
      expect(j.meetsThreshold).toBe(false);
      expect(j.disagreements.length).toBeGreaterThan(0);
    }
    expect(report.allMeetThreshold).toBe(false);
  });

  it("counts failed calls as disagreements and never retries", async () => {
    const subset = items.filter((i) => i.judge === "reading-restraint");
    const fake = createFakeLlm(subset.slice(0, 5));
    const report = await runJudges({ llm: fake, mode: "fake", model: "fake", items: subset });
    const j = report.judges[0];
    expect(j.errors).toBe(subset.length - 5);
    expect(j.agreed).toBe(5);
    expect(fake.stats().calls).toBe(subset.length);
  });

  it("formats a report that says plainly when the model is fake", async () => {
    const report = await runJudges({ llm: createFakeLlm(items), mode: "fake", model: "fake", items });
    const text = formatReport(report);
    expect(text).toMatch(/FAKE model/);
    expect(text).toMatch(/NOT measured/);
    expect(text).toContain("n/a (fake)");
    expect(text).not.toMatch(/100%|\bok\b|BELOW/);
    for (const j of JUDGE_IDS) expect(text).toContain(j);
  });

  it("shows real agreement and status for a real run", () => {
    const text = formatReport({
      mode: "real",
      model: "m",
      calls: 1,
      allMeetThreshold: false,
      judges: [{ judge: "reading-restraint", total: 10, agreed: 7, errors: 0, agreement: 0.7, summary: "5/10 pass", meetsThreshold: false, disagreements: [{ id: "rr-01", expected: "pass", got: "fail", reason: "r" }] }],
    });
    expect(text).toContain("70%");
    expect(text).toContain("BELOW THRESHOLD");
    expect(text).toContain("rr-01");
  });
});

describe("gate", () => {
  it("prints the expected call count first and defaults to the fake model", () => {
    const g = judgesGate({});
    expect(g.lines[0]).toContain(`Expected model calls for a real run: ${items.length}`);
    expect(g.mode).toBe("fake");
    expect(g.allowed).toBe(true);
  });

  it("refuses a real run without a key", () => {
    const g = judgesGate({ [ENV_LIVE]: "1" });
    expect(g.mode).toBe("real");
    expect(g.allowed).toBe(false);
    expect(g.lines[0]).toContain("Expected model calls");
  });

  it("allows a real run with the flag and a key, and names the model but not the key", () => {
    const g = judgesGate({ [ENV_LIVE]: "1", ANTHROPIC_API_KEY: "placeholder-not-a-key", ATELIER_JUDGE_MODEL: "judge-model-x" });
    expect(g.allowed).toBe(true);
    const text = g.lines.join("\n");
    expect(text).toContain("judge-model-x");
    expect(text).not.toContain("placeholder-not-a-key");
  });

  it("refuses a real run over the per-run call limit", () => {
    const many = Array.from({ length: MAX_JUDGE_CALLS_PER_RUN + 1 }, () => items[0]);
    const g = judgesGate({ [ENV_LIVE]: "1", ANTHROPIC_API_KEY: "placeholder-not-a-key" }, many);
    expect(g.allowed).toBe(false);
    expect(g.lines.join("\n")).toMatch(/over the/);
  });

  it("only treats the exact value 1 as the go-ahead", () => {
    expect(judgesGate({ [ENV_LIVE]: "true", ANTHROPIC_API_KEY: "placeholder-not-a-key" }).mode).toBe("fake");
  });
});

describe("llmFor", () => {
  const item = byId("bq-05");
  const bodyOf = async (env: Record<string, string>): Promise<{ model: string }> => {
    let sent: { model: string } | undefined;
    const fetchStub = (async (_url: unknown, init: { body: string }) => {
      sent = JSON.parse(init.body) as { model: string };
      return new Response(JSON.stringify({ stop_reason: "tool_use", content: [{ type: "tool_use", name: JUDGE_TOOL_NAME, input: good(item) }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const gate = judgesGate({ [ENV_LIVE]: "1", ...env }, items);
    expect(gate.mode).toBe("real");
    const llm = llmFor(gate, { [ENV_LIVE]: "1", ...env }, items, { fetch: fetchStub });
    await runJudge(llm, item.input);
    return sent!;
  };

  it("sends the judge model, not the generator's ATELIER_MODEL", async () => {
    const sent = await bodyOf({ ANTHROPIC_API_KEY: "placeholder-not-a-key", ATELIER_MODEL: "generator-model", ATELIER_JUDGE_MODEL: "judge-model-x" });
    expect(sent.model).toBe("judge-model-x");
  });
  it("falls back to ATELIER_MODEL, then the default", async () => {
    expect((await bodyOf({ ANTHROPIC_API_KEY: "placeholder-not-a-key", ATELIER_MODEL: "generator-model" })).model).toBe("generator-model");
    expect((await bodyOf({ ANTHROPIC_API_KEY: "placeholder-not-a-key" })).model).toBe("claude-sonnet-5-5");
    expect(judgeModel({})).toBe("claude-sonnet-5-5");
  });
  it("uses the fake model, which sends nothing, when the gate is not live", async () => {
    const gate = judgesGate({}, items);
    const llm = llmFor(gate, {}, items);
    expect((await runJudge(llm, item.input)).result).toBe(3);
  });
});

describe("calibration sets", () => {
  it("has a set for every judge, with at least 10 items and both outcomes", () => {
    for (const j of JUDGE_IDS) {
      const set = CALIBRATION[j];
      expect(set.length, j).toBeGreaterThanOrEqual(10);
      expect(new Set(set.map((i) => i.id)).size, `${j} ids`).toBe(set.length);
      for (const it of set) expect(it.judge).toBe(j);
      if (JUDGE_KIND[j] === "binary") {
        expect(set.some((i) => i.expected === "pass"), `${j} pass`).toBe(true);
        expect(set.some((i) => i.expected === "fail"), `${j} fail`).toBe(true);
      }
    }
    expect(expectedCalls(items)).toBe(items.length);
    expect(items.length).toBeLessThanOrEqual(MAX_JUDGE_CALLS_PER_RUN);
  });

  it("labels have the right type for each judge, and ids are unique across the sets", () => {
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
    for (const it of items) {
      const kind = JUDGE_KIND[it.judge];
      if (kind === "binary") expect(["pass", "fail"]).toContain(it.expected);
      if (kind === "score") expect(Number.isInteger(it.expected) && (it.expected as number) >= 1 && (it.expected as number) <= 5).toBe(true);
      if (kind === "fit") expect(Object.keys(it.expected as object).sort()).toEqual(["discernment", "idiosyncrasy", "pattern"]);
      expect(it.input.judge).toBe(it.judge);
      expect(it.input.id).toBe(it.id);
      expect(it.note.length).toBeGreaterThan(10);
    }
  });

  it("has an injected-instruction item for every judge, labeled as the card deserves and never pass or a high score", () => {
    for (const j of JUDGE_IDS) {
      const injected = CALIBRATION[j].filter((it) => {
        const cards = it.input.judge === "stretch-defensibility" ? [it.input.match, it.input.stretch] : [it.input.card];
        return cards.some((c) => /ignore the rubric/i.test(`${c.why} ${c.different}`));
      });
      expect(injected.length, j).toBeGreaterThanOrEqual(1);
      for (const it of injected) {
        const e = it.expected;
        const bad = e === "fail" || (typeof e === "number" && e === 1) || (typeof e === "object" && Math.max(e.discernment, e.pattern, e.idiosyncrasy) <= 1);
        expect(bad, it.id).toBe(true);
      }
    }
  });

  it("labels are not tied to text length: the longest bridge-quality card is not scored above the shortest strong one", () => {
    const size = (it: CalibrationItem): number => (it.input as Extract<JudgeInput, { card: unknown }>).card.why.length + (it.input as Extract<JudgeInput, { card: unknown }>).card.different.length;
    const q = CALIBRATION["bridge-quality"];
    const longestWeak = q.filter((i) => (i.expected as number) <= 2).sort((a, b) => size(b) - size(a))[0];
    const shortestStrong = q.filter((i) => (i.expected as number) >= 4).sort((a, b) => size(a) - size(b))[0];
    expect(size(longestWeak)).toBeGreaterThan(size(shortestStrong));
  });

  it("rubric-fit items all carry a slop label", () => {
    for (const it of CALIBRATION["rubric-fit"]) expect(typeof it.expectedSlop, it.id).toBe("boolean");
  });

  it("reading-restraint has a hedged reading with no retrieved text, labeled fail", () => {
    const it = byId("rr-11");
    expect(it.expected).toBe("fail");
    expect(nothingToCheck(it.input)).toBe(true);
    expect((it.input as Extract<JudgeInput, { card: unknown }>).card.different).toMatch(/one reading/i);
  });

  it("bridge-quality covers every score from 1 to 5", () => {
    expect(new Set(CALIBRATION["bridge-quality"].map((i) => i.expected))).toEqual(new Set([1, 2, 3, 4, 5]));
  });

  it("stretch items carry a profile, a Match and a Stretch card", () => {
    for (const it of CALIBRATION["stretch-defensibility"]) {
      const input = it.input as Extract<JudgeInput, { judge: "stretch-defensibility" }>;
      expect(input.profile.seeds.length).toBeGreaterThan(0);
      expect(input.match.pick.label).not.toBe(input.stretch.pick.label);
    }
  });

  it("is synthetic: every name is invented and no tag id or uuid-like value is present", () => {
    const text = JSON.stringify(items);
    expect(text).not.toMatch(/urn:tag:/);
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    for (const it of items) {
      const cards = it.input.judge === "stretch-defensibility" ? [it.input.match, it.input.stretch] : [it.input.card];
      for (const c of cards) {
        expect(c.pick.label).toMatch(/^Fixture /);
        expect(c.seed.label).toMatch(/^Fixture /);
      }
    }
  });

  it("source references are example.org urls or the label Qloo", () => {
    for (const it of items) {
      const cards = it.input.judge === "stretch-defensibility" ? [it.input.match, it.input.stretch] : [it.input.card];
      for (const c of cards) {
        const refs = [...c.hops.map((h) => h.source), c.reading?.source, ...c.sources.map((s) => s.ref)].filter(Boolean) as string[];
        for (const r of refs) expect(r === "Qloo" || r.startsWith("https://example.org/fixture/"), r).toBe(true);
      }
    }
  });
});
