// Entry point for `npm run evals:judges`. Prints the expected number of model calls first. By default it runs every
// judge over the synthetic calibration sets with the FAKE model (zero calls; plumbing only). With
// ATELIER_JUDGES_LIVE=1 and ANTHROPIC_API_KEY set it makes real calls, one per calibration item, and fails if any
// judge agrees with its labels less than MIN_AGREEMENT. It runs only when ATELIER_EVALS_JUDGES=1 (set by the npm
// script), and it never passes by doing nothing: reached through the script without the env var, it fails.

import { describe, expect, it } from "vitest";
import { repoRoot } from "../harness/repo";
import { writeRecording } from "../harness/live";
import { allCalibrationItems } from "./calibration";
import { formatReport, judgeModel, judgesGate, llmFor, runJudges } from "./run";

const enabled = process.env.ATELIER_EVALS_JUDGES === "1";
const viaScript = process.env.npm_lifecycle_event === "evals:judges";

describe.skipIf(!enabled && !viaScript)("evals:judges", async () => {
  if (!enabled) {
    it("is run with ATELIER_EVALS_JUDGES=1", () => {
      expect.fail('`npm run evals:judges` must set ATELIER_EVALS_JUDGES=1 (see the "evals:judges" script)');
    });
    return;
  }

  const items = allCalibrationItems();
  const gate = judgesGate(process.env, items);
  for (const line of gate.lines) console.log(line);

  it("is allowed to run", () => {
    expect(gate.allowed, gate.lines[gate.lines.length - 1]).toBe(true);
  });

  if (!gate.allowed) return;

  const report = await runJudges({ llm: llmFor(gate, process.env, items), mode: gate.mode, model: judgeModel(process.env), items });
  console.log(`\n${formatReport(report)}\n`);
  if (gate.mode === "real") console.log(`Report written to ${writeRecording(repoRoot(), "judges-report.json", report)}`);

  it("ran every calibration item once", () => {
    expect(report.calls).toBe(gate.expectedCalls);
  });

  for (const j of report.judges) {
    it(`${j.judge}: agrees with at least the threshold of its labels${gate.mode === "fake" ? " (fake model: plumbing only)" : ""}`, () => {
      expect(j.meetsThreshold, `${j.judge} agreed on ${j.agreed}/${j.total}`).toBe(true);
    });
  }
});
