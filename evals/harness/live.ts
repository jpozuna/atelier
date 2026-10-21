// Live evals call the real Qloo API through src/lib/qloo/client.ts, so they spend quota and run only on request:
// QLOO_LIVE=1. The runner prints the expected number of live calls before anything else. Recordings and run output
// go to .qloo-private/evals/ (gitignored) and never into a tracked path. Only a scores-only summary (numbers and
// pass or fail, no entity names or tags) may be copied out by hand.
//
// A suite is added here with its expected call count, which must stay within MAX_LIVE_CALLS_PER_RUN, and it must call
// Qloo only through the client. Suites live under evals/live/. One Qloo client per suite run, so the per-run cap holds.

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { MAX_LIVE_CALLS_PER_RUN } from "@/lib/agent/config";
import { postCheck } from "../live/post-check";
import { smokeRun } from "../live/smoke-run";

export const LIVE_OUT_DIR = ".qloo-private/evals";

export interface LiveSuite {
  id: string;
  description: string;
  /** Live calls one run of this suite makes (cache hits not counted). Printed before the suite runs. */
  expectedCalls: number;
  /** Anthropic calls one run may make, given the environment (for example 0 without a key). Printed with the Qloo count. */
  expectedAnthropicCalls?(env: Record<string, string | undefined>): number;
  /** Set when the Qloo calls are made by this separate script, never by this runner (`run` only prints how to run it). */
  viaScript?: string;
  /** Writes its output with `writeRecording`. Calls Qloo only through src/lib/qloo/client.ts. */
  run(ctx: { outDir: string }): Promise<void>;
}

export const LIVE_SUITES: readonly LiveSuite[] = [postCheck, smokeRun];

export const expectedLiveCalls = (suites: readonly LiveSuite[]): number => suites.reduce((n, s) => n + s.expectedCalls, 0);

export interface LiveGate {
  allowed: boolean;
  /** What to print, in order. The expected-call line is always first. */
  lines: string[];
}

export function liveGate(env: Record<string, string | undefined>, suites: readonly LiveSuite[] = LIVE_SUITES): LiveGate {
  const lines = [
    `Expected live Qloo calls: ${expectedLiveCalls(suites)} across ${suites.length} live suite(s), each suite capped at ${MAX_LIVE_CALLS_PER_RUN} per run.`,
  ];
  for (const s of suites) {
    const anthropic = s.expectedAnthropicCalls?.(env);
    lines.push(
      `  ${s.id}: ${s.expectedCalls} live Qloo call(s)${s.viaScript ? `, made only by ${s.viaScript} (this runner makes none for it)` : ""}${anthropic === undefined ? "" : `, up to ${anthropic} Anthropic call(s)`}. ${s.description}`,
    );
  }
  const own = suites.filter((s) => !s.viaScript).reduce((n, s) => n + s.expectedCalls, 0);
  if (own !== expectedLiveCalls(suites)) lines.push(`Of those, ${own} are made by this runner; the rest are made only when you run the script a suite points to.`);
  const anthropicTotal = suites.reduce((n, s) => n + (s.expectedAnthropicCalls?.(env) ?? 0), 0);
  lines.push(`Expected Anthropic calls: ${anthropicTotal}${anthropicTotal === 0 ? " (no ANTHROPIC_API_KEY set, or no suite uses the model)" : " at most"}.`);
  for (const s of suites) {
    if (s.expectedCalls > MAX_LIVE_CALLS_PER_RUN) {
      lines.push(`Refusing: suite ${s.id} expects ${s.expectedCalls} live calls, over the ${MAX_LIVE_CALLS_PER_RUN} per-run limit.`);
      return { allowed: false, lines };
    }
  }
  if (env.QLOO_LIVE !== "1") {
    lines.push("Refusing to run live evals: set QLOO_LIVE=1 to confirm you want to spend the calls above.");
    return { allowed: false, lines };
  }
  if (suites.length === 0) lines.push("No live suites yet; nothing to run.");
  return { allowed: true, lines };
}

/** Write one recording under <root>/.qloo-private/evals/. The name is a plain file name, never a path. */
export function writeRecording(root: string, name: string, data: unknown): string {
  if (!/^[A-Za-z0-9._-]+$/.test(name) || name.startsWith(".")) throw new Error(`recording name must be a plain file name: ${name}`);
  const dir = resolve(root, LIVE_OUT_DIR);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, name);
  writeFileSync(file, JSON.stringify(data, null, 2));
  return file;
}
