// domain-coverage: each locked domain has at least MIN_PICKS_PER_FIELD picks, or is reported thin (status thin,
// empty or unavailable, or `thin: true`) and is not padded. Backfilled picks do not count toward the minimum unless
// they clear the connection floor on their own, and a backfilled pick under the floor shown at all is padding. No
// more than one pick per creator or franchise in a domain. Picks the Qloo graph does not ground are labeled
// `llmBridged`, all or none within a domain.
//
// A Pick carries no creator field, so "same creator or franchise" is read from the pick names: two picks of one
// domain are one franchise when their names are equal, or one name's leading words are the other's (a whole name that
// opens the other: "Dune" and "Dune Part Two"), or they share at least two leading words, or they differ only by a
// trailing number, numeral or "part/volume/book/season" marker ("Saga Part 1", "Saga Part 2"). The eval markers
// "Fixture", "Invented" and "Synthetic" are ignored so invented names do not all look alike. A shared influence
// label in the lineage hop is NOT a franchise: many picks can be influenced by one source.
// A domain with no picks and no thin report is a failure, even if it is a field the user never mentioned. A result in
// which every domain is unavailable has no coverage at all and fails.

import { CONNECTION_FLOOR, MIN_PICKS_PER_FIELD } from "@/lib/agent/config";
import { FIELDS } from "@/types";
import type { CaseInput, ScorerResult, TraceScorer } from "../harness/types";
import { fold, isNum, isObj, list, nonEmpty, pickLabel, withResult } from "./_shared";

const REPORTED = new Set(["thin", "empty", "unavailable"]);

const MARKERS = new Set(["fixture", "invented", "synthetic"]);
const SERIES_WORDS = new Set(["part", "pt", "vol", "volume", "book", "season", "episode", "chapter", "no"]);
const NUMERAL = /^(\d+|[ivxlc]+|one|two|three|four|five|six|seven|eight|nine|ten)$/;

const tokens = (name: string): string[] => fold(name).split(" ").filter((t) => t && !MARKERS.has(t));

/** The words of a name with any trailing series marker and number removed ("saga part 2" becomes "saga"). */
function stem(t: string[]): string[] {
  const out = [...t];
  while (out.length > 1 && NUMERAL.test(out[out.length - 1]!)) out.pop();
  while (out.length > 1 && SERIES_WORDS.has(out[out.length - 1]!)) out.pop();
  return out;
}

export function sameFranchise(a: string, b: string): boolean {
  const x = tokens(a);
  const y = tokens(b);
  if (x.length === 0 || y.length === 0) return false;
  let c = 0;
  while (c < x.length && c < y.length && x[c] === y[c]) c++;
  if (c === 0) return false;
  if (c === x.length || c === y.length) return true;
  if (c >= 2) return true;
  const sx = stem(x).join(" ");
  const sy = stem(y).join(" ");
  return sx === sy;
}

export function scoreDomainCoverage(input: CaseInput): ScorerResult {
  return withResult(input, (r) => {
    const reasons: string[] = [];
    const have = new Set(r.domains.map((d) => d.domain));
    for (const f of FIELDS) if (!have.has(f)) reasons.push(`${f}: the result has no entry for this locked domain`);

    if (r.domains.length > 0 && r.domains.every((d) => d.status === "unavailable")) reasons.push("every domain is unavailable, so the run has no coverage at all");
    let total = 0;
    for (const d of r.domains) {
      total += d.picks.length;
      const reported = d.thin || (d.status !== undefined && REPORTED.has(d.status));
      const counted = d.picks.filter((p) => p.origin !== "backfill" || (isNum(p.connection) && p.connection >= CONNECTION_FLOOR));
      for (const p of d.picks) {
        if (p.origin === "backfill" && !(isNum(p.connection) && p.connection >= CONNECTION_FLOOR)) {
          reasons.push(`${pickLabel(d.domain, p)}: a backfilled pick that does not clear the connection floor is shown (padding)`);
        }
      }
      if (counted.length < MIN_PICKS_PER_FIELD && !reported) {
        reasons.push(`${d.domain}: ${counted.length} counted pick(s), under the minimum of ${MIN_PICKS_PER_FIELD}, and the domain is not reported thin`);
      }

      for (let i = 0; i < d.picks.length; i++) {
        for (let j = i + 1; j < d.picks.length; j++) {
          const p = d.picks[i]!;
          const q = d.picks[j]!;
          if (nonEmpty(p.name) && nonEmpty(q.name) && sameFranchise(p.name, q.name)) {
            reasons.push(`${d.domain}: 2 picks (${pickLabel(d.domain, p)}, ${pickLabel(d.domain, q)}) share one creator, franchise or name (their names open the same way); at most one per creator or franchise`);
          }
        }
      }

      const bridged = d.picks.filter((p) => p.llmBridged === true).length;
      if (bridged > 0 && bridged < d.picks.length) reasons.push(`${d.domain}: ${bridged} of ${d.picks.length} picks are labeled llmBridged; a domain is bridged all or none`);
      for (const p of d.picks) {
        const path = isObj(p.path) ? p.path : {};
        const grounded = list(path.sharedTags).filter(nonEmpty).length > 0 || list(path.hops).filter(isObj).some((h) => h.kind === "lineage");
        if (p.llmBridged !== true && !grounded) {
          reasons.push(`${pickLabel(d.domain, p)}: no shared Qloo tags and no retrieved lineage, so nothing grounds it, but it is not labeled llmBridged`);
        }
      }
    }

    // Duplicate franchise reasons can repeat across keys (same pair by name and by lineage). Report each once.
    const unique = [...new Set(reasons)];
    if (unique.length) return { pass: false, reasons: unique };
    return { pass: true, reasons: [`${r.domains.length} domain(s), ${total} pick(s); thin domains are reported, none padded`] };
  });
}

export const domainCoverage: TraceScorer = {
  kind: "trace",
  name: "domain-coverage",
  description: `Each locked domain has at least ${MIN_PICKS_PER_FIELD} picks or is reported thin; no padding; one pick per creator or franchise; bridged domains are labeled.`,
  score: scoreDomainCoverage,
};
