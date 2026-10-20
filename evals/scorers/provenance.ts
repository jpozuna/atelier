// provenance: every hop of every path has a provenance (sourced or inferred). A sourced hop has a `sourceUrl` that was
// actually retrieved for that pick in this run: it appears in the `sourceUrls` of a `fetch_refs` event whose `pickIds`
// include the pick (a source retrieved for another pick does not count). A card's
// `reading` is sourced text too, so its `sourceUrl` must have been retrieved the same way. `card.provenance` counts
// equal the hop counts, for the pick's stored path and for the path the card carries. Sourced and inferred are never
// merged: a hop is one or the other, and an inferred hop that names a source link is called out.

import { PROVENANCES } from "@/types";
import type { CaseInput, ScorerResult, TraceScorer } from "../harness/types";
import { isNum, isObj, list, nonEmpty, pickLabel, withResult } from "./_shared";

export function scoreProvenance(input: CaseInput): ScorerResult {
  // A source counts for a pick only when a fetch_refs event that lists the pick retrieved it.
  const retrievedFor = (pickId: string, url: string): boolean =>
    input.trace.some((e) => e.kind === "fetch_refs" && e.pickIds.includes(pickId) && (e.sourceUrls ?? []).includes(url));

  return withResult(input, (r) => {
    const reasons: string[] = [];
    let hopsChecked = 0;
    let picks = 0;
    for (const d of r.domains) {
      for (const pick of d.picks) {
        picks++;
        const who = pickLabel(d.domain, pick);
        const card = isObj(pick.card) ? pick.card : null;
        const paths = [{ name: "stored path", path: isObj(pick.path) ? pick.path : null }];
        if (card && isObj(card.path) && card.path !== pick.path) paths.push({ name: "card path", path: card.path });

        for (const { name, path } of paths) {
          if (!path) {
            reasons.push(`${who}: no ${name}`);
            continue;
          }
          const hops = list(path.hops).filter(isObj);
          let sourced = 0;
          let inferred = 0;
          hops.forEach((h, i) => {
            hopsChecked++;
            const at = `${who} ${name} hop ${i + 1} (${String(h.kind)})`;
            if (h.provenance === "sourced") {
              sourced++;
              if (!nonEmpty(h.sourceUrl)) reasons.push(`${at}: sourced but has no sourceUrl`);
              else if (!retrievedFor(String(pick.id), h.sourceUrl)) reasons.push(`${at}: sourced, but its sourceUrl was never retrieved for this pick (no fetch_refs event for the pick lists it)`);
            } else if (h.provenance === "inferred") {
              inferred++;
              if (nonEmpty(h.sourceUrl)) reasons.push(`${at}: inferred but names a sourceUrl; sourced and inferred must stay separate`);
            } else {
              reasons.push(`${at}: no provenance (must be ${PROVENANCES.join(" or ")})`);
            }
          });
          if (card) {
            const counts = isObj(card.provenance) ? card.provenance : null;
            if (!counts || !isNum(counts.sourced) || !isNum(counts.inferred)) reasons.push(`${who}: the card has no provenance counts`);
            else if (counts.sourced !== sourced || counts.inferred !== inferred) {
              reasons.push(`${who}: card.provenance says ${counts.sourced} sourced and ${counts.inferred} inferred, but the ${name} has ${sourced} sourced and ${inferred} inferred hop(s)`);
            }
          }
        }

        const reading = card && isObj(card.reading) ? card.reading : null;
        if (reading) {
          if (!nonEmpty(reading.sourceUrl)) reasons.push(`${who}: the card's reading has no sourceUrl`);
          else if (!retrievedFor(String(pick.id), reading.sourceUrl)) reasons.push(`${who}: the card's reading cites a source that was never retrieved for this pick`);
        }
      }
    }
    if (reasons.length) return { pass: false, reasons };
    return { pass: true, reasons: [`${hopsChecked} hop(s) across ${picks} pick(s) carry provenance; every source was retrieved for its pick; card counts equal hop counts`] };
  });
}

export const provenance: TraceScorer = {
  kind: "trace",
  name: "provenance",
  description: "Every hop has provenance; sourced hops cite a retrieved source; card.provenance counts equal the hop counts.",
  score: scoreProvenance,
};
