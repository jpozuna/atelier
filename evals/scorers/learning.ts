// learning: a run that learned from the person's earlier signals (T-28) kept its promises.
//
// Evidence, an extra a fixture result carries (a live RunResult has none; a run with no signals has nothing to check and
// passes, as the other result scorers do for a case without a result):
//   result.learning = {
//     notMe:      entity ids the person set aside or turned down before this run,
//     leanedAway: tag ids of themes the run leaned away from (they appear only in turned-down picks' theme hops),
//     before:     { domains: [{ picks: [{ qlooId, path: { sharedTags } }] }] }, the picks of the earlier run,
//   }
// Checks, all of which must hold:
//   1. a not_me pick never reappears: no shown pick has an entity id in `notMe`;
//   2. every queried domain's exclusion list (result.audit.exclude, what the Qloo client was sent) holds every `notMe` id;
//   3. a leaned-away theme's picks drop in share: the share of shown picks whose theme tags (path.sharedTags) include a
//      leaned-away tag is lower than in the earlier run (and the earlier run must have had some, or there is nothing to drop);
//   4. the connection floor holds (the connection-floor scorer, unchanged);
//   5. the cap holds (the edge-cap scorer, unchanged).
// A share is a count over a count, computed here for the check only; it is never shown to a person.

import type { CaseInput, ScorerResult, TraceScorer } from "../harness/types";
import { finish, isObj, nonEmpty, readResult, strs, list, type Obj } from "./_shared";
import { scoreConnectionFloor } from "./connection-floor";
import { scoreEdgeCap } from "./edge-cap";

const picksOf = (domains: unknown): Obj[] =>
  list(domains)
    .filter(isObj)
    .flatMap((d) => [...list(d.picks).filter(isObj), ...(isObj(d.byBand) ? Object.values(d.byBand).flatMap((b) => list(b).filter(isObj)) : [])]);

const themeTagsOf = (p: Obj): string[] => (isObj(p.path) ? strs(p.path.sharedTags) : []);

/** Share of picks with at least one of `tags` among their theme tags; null when there are no picks. */
function shareWith(picks: readonly Obj[], tags: ReadonlySet<string>): number | null {
  if (picks.length === 0) return null;
  return picks.filter((p) => themeTagsOf(p).some((t) => tags.has(t))).length / picks.length;
}

export function scoreLearning(input: CaseInput): ScorerResult {
  if (input.result === undefined) return { pass: true, reasons: ["no result in this case; nothing to check"] };
  const view = readResult(input.result);
  if (typeof view === "string") return { pass: false, reasons: [view] };
  const learning = isObj(input.result) ? input.result.learning : undefined;
  if (!isObj(learning)) return { pass: true, reasons: ["the run learned nothing (no signals); nothing to check"] };

  const reasons: string[] = [];
  const unverified: string[] = [];
  const notMe = strs(learning.notMe);
  const away = new Set(strs(learning.leanedAway));
  const shown = view.domains.flatMap((d) => d.picks);
  if (shown.length === 0) return { pass: false, reasons: ["the result has no picks at all, so this check would pass on nothing"] };

  // 1. A not_me pick never reappears.
  for (const d of view.domains) {
    for (const p of d.picks) {
      if (nonEmpty(p.qlooId) && notMe.includes(p.qlooId)) reasons.push(`${d.domain}/${String(p.id ?? p.qlooId)}: a pick the person set aside appears again`);
    }
  }

  // 2. The exclusion list sent for each queried domain holds every not_me id.
  if (notMe.length > 0) {
    if (!view.audit) unverified.push("the result has no audit block, so the exclusion lists sent cannot be read");
    else {
      for (const d of view.domains) {
        const sent = view.audit.exclude[d.domain];
        if (!sent) unverified.push(`${d.domain}: no exclusion list recorded for this field`);
        else if (notMe.some((id) => !sent.includes(id))) reasons.push(`${d.domain}: the exclusion list sent does not hold every pick the person set aside`);
      }
    }
  }

  // 3. A leaned-away theme's picks drop in share.
  if (away.size > 0) {
    const before = isObj(learning.before) ? picksOf(learning.before.domains) : [];
    const was = shareWith(before, away);
    const now = shareWith(shown, away);
    if (was === null) unverified.push("the case does not list the earlier run's picks, so the share of the leaned-away theme cannot be compared");
    else if (was === 0) reasons.push("the earlier run held no pick of the leaned-away theme, so there is no share to drop");
    else if (now !== null && now >= was) reasons.push(`the leaned-away theme's share of the picks did not drop: ${Math.round(now * 100)}% now against ${Math.round(was * 100)}% before`);
  }

  // 4 and 5. The floor and the cap hold, by the scorers that own them.
  const floor = scoreConnectionFloor(input);
  if (!floor.pass) reasons.push(...floor.reasons.map((r) => `floor: ${r}`));
  const cap = scoreEdgeCap(input);
  if (!cap.pass) reasons.push(...cap.reasons.map((r) => `cap: ${r}`));

  const dropNote = away.size > 0 ? `; ${away.size} leaned-away theme(s) dropped in share` : "";
  return finish(input, reasons, unverified, `${notMe.length} set-aside pick(s) stayed out and were excluded${dropNote}; the floor and the cap hold`);
}

export const learning: TraceScorer = {
  kind: "trace",
  name: "learning",
  description: "A run that learned from earlier signals: a not_me pick never reappears and is excluded, a leaned-away theme's picks drop in share, the connection floor holds, the edge cap holds.",
  score: scoreLearning,
};
