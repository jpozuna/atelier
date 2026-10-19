// The scorer registry. To register a scorer: write it under evals/scorers/ (or evals/harness/ until a ticket owns
// a path for it), export a `TraceScorer` (reads a case's trace and result) or a `RepoScorer` (reads git), import it
// here and add it to SCORERS. The runner picks it up with no other change. Names must be unique and match the
// names in .claude/skills/atelier-evals/references/scorers.md.

import type { Scorer } from "../harness/types";
import { callBudget } from "./call-budget";
import { paramValidity } from "./param-validity";
import { repoHygiene } from "./repo-hygiene";

export const SCORERS: readonly Scorer[] = [repoHygiene, paramValidity, callBudget];

export function assertUniqueNames(scorers: readonly Scorer[]): void {
  const seen = new Set<string>();
  for (const s of scorers) {
    if (seen.has(s.name)) throw new Error(`duplicate scorer name: ${s.name}`);
    seen.add(s.name);
  }
}
