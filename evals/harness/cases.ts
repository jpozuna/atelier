// Cases live in evals/fixtures/cases.json: an id, a trace file, a run kind and the expected outcome per scorer.
// A scorer not listed for a case is expected to pass. A negative case (expect "fail") proves the scorer can fail.

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseTraceJsonl } from "./trace";
import type { CaseSpec, Expectation, LoadedCase, RunKind } from "./types";

export const FIXTURES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../fixtures");

const RUN_KINDS: readonly RunKind[] = ["new_profile", "repeat_view"];

function isExpectation(v: unknown): v is Expectation {
  if (v === "pass" || v === "fail") return true;
  return typeof v === "object" && v !== null && typeof (v as { fail?: unknown }).fail === "string";
}

export function parseCaseSpecs(json: unknown): CaseSpec[] {
  const list = (json as { cases?: unknown } | null)?.cases;
  if (!Array.isArray(list)) throw new Error("cases.json: expected { cases: [...] }");
  const ids = new Set<string>();
  return list.map((raw, i) => {
    const c = raw as Partial<CaseSpec>;
    const at = `cases.json case ${i + 1}`;
    if (typeof c.id !== "string" || !c.id) throw new Error(`${at}: id is required`);
    if (ids.has(c.id)) throw new Error(`${at}: duplicate id ${c.id}`);
    ids.add(c.id);
    if (typeof c.description !== "string") throw new Error(`${at} (${c.id}): description is required`);
    if (typeof c.trace !== "string") throw new Error(`${at} (${c.id}): trace path is required`);
    if (c.run !== undefined && !RUN_KINDS.includes(c.run)) throw new Error(`${at} (${c.id}): run must be one of ${RUN_KINDS.join(", ")}`);
    for (const [scorer, e] of Object.entries(c.expect ?? {})) {
      if (!isExpectation(e)) throw new Error(`${at} (${c.id}): expectation for ${scorer} must be "pass", "fail" or { "fail": "text" }`);
    }
    return c as CaseSpec;
  });
}

export function loadCases(dir = FIXTURES_DIR): LoadedCase[] {
  const specs = parseCaseSpecs(JSON.parse(readFileSync(join(dir, "cases.json"), "utf8")));
  return specs.map((spec) => ({
    ...spec,
    input: {
      id: spec.id,
      run: spec.run ?? "new_profile",
      trace: parseTraceJsonl(readFileSync(join(dir, spec.trace), "utf8"), spec.trace),
      result: spec.result ? JSON.parse(readFileSync(join(dir, spec.result), "utf8")) : undefined,
      live: spec.live === true,
    },
  }));
}
