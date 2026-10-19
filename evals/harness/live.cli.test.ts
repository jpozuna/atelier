// Entry point for `npm run evals:live`. Prints the expected live-call count, refuses unless QLOO_LIVE=1, then runs
// the live suites (none yet). Runs only when ATELIER_EVALS_LIVE=1 (set by the npm script).

import { describe, expect, it } from "vitest";
import { repoRoot } from "./repo";
import { LIVE_OUT_DIR, LIVE_SUITES, liveGate } from "./live";

const enabled = process.env.ATELIER_EVALS_LIVE === "1";
const viaScript = process.env.npm_lifecycle_event === "evals:live";

describe.skipIf(!enabled && !viaScript)("evals:live", () => {
  it("is run with ATELIER_EVALS_LIVE=1", () => {
    // Reached through `npm run evals:live` without the env var: fail instead of skipping.
    expect(enabled, 'the "evals:live" script must set ATELIER_EVALS_LIVE=1').toBe(true);
  });

  it.skipIf(!enabled)("is allowed to run", async () => {
    const gate = liveGate(process.env);
    for (const line of gate.lines) console.log(line);
    expect(gate.allowed, gate.lines[gate.lines.length - 1]).toBe(true);
    const outDir = `${repoRoot()}/${LIVE_OUT_DIR}`;
    for (const suite of LIVE_SUITES) {
      console.log(`Running ${suite.id}: ${suite.expectedCalls} live call(s) expected. Output goes to ${LIVE_OUT_DIR}/`);
      await suite.run({ outDir });
    }
  });
});
