// card-completeness: every card has its four parts (path, why, different, provenance counts). A `reading` exists only
// when it is sourced (a non-empty sourceUrl and text) and is kept apart from the inferred lines: the reading's text
// is not copied into `why` or `different`. Whether the UI labels it "a reading" is a rendering concern the data cannot
// show, so the scorer checks the part the data can: the reading is its own field, with its own source.
// No card contains a taste score, ranking or audience metric (hard rule 7): no field named like one, and in the
// model-written lines (`why`, `different`) none of these families:
//   percent       "92%", "percent"
//   scale         "8/10", "4 out of 5", "3 stars"
//   taste score   "match score", "92 match", "a score of 9", "best match"
//   ranking       "ranked", "ranking", "#3", "No. 2"
//   decimal       a bare decimal such as "0.82" in prose
//   audience      popular, popularity, followers, listeners, million(s), billion(s)
// The retrieved `reading` text is the source's own words, so it is exempt from the number and rank families (percent,
// scale, ranking, decimal, stars); it is still refused for taste scores and audience metrics. The patterns are narrow
// on purpose so a film score (music) or a year is not flagged; the bridge judges read the prose for anything subtler.

import type { CaseInput, ScorerResult, TraceScorer } from "../harness/types";
import { isNum, isObj, list, nonEmpty, pickLabel, withResult } from "./_shared";

const BANNED_KEYS = /^(score|scores|rank|ranking|rating|affinity|popularity|reach|connection|similarity|matchscore|tastescore|followers|listeners)$/i;

interface Family {
  name: string;
  re: RegExp;
  /** The retrieved reading text is exempt from this family. */
  readingExempt: boolean;
}
const FAMILIES: Family[] = [
  { name: "a percentage", re: /\b\d+(\.\d+)?\s?%|\bpercent\b/i, readingExempt: true },
  { name: "a rating out of a scale", re: /\b\d+(\.\d+)?\s?(\/|out of)\s?(5|10|100)\b/i, readingExempt: true },
  { name: "a star rating", re: /\b\d+(\.\d+)?\s+stars?\b/i, readingExempt: true },
  { name: "a taste score or rank", re: /\b(match|taste|affinity|similarity|connection|reach|fit)\s+(score|rating|rank|ranking)\b/i, readingExempt: false },
  { name: "a numbered match", re: /\b\d+(\.\d+)?\s+(match|matches)\b/i, readingExempt: false },
  { name: "a score with a number", re: /\bscored?\s+(of\s+)?\d/i, readingExempt: true },
  { name: "a best-match claim", re: /\b(top|best|closest|strongest)\s+(match|pick|fit)\b/i, readingExempt: false },
  { name: "a ranking", re: /\b(ranked|ranks|ranking)\b/i, readingExempt: true },
  { name: "a rank number", re: /(^|\s)#\d+\b|\bno\.\s?\d+\b/i, readingExempt: true },
  { name: "a bare decimal", re: /(?<![\w.])\d+\.\d+(?![\w.])/, readingExempt: true },
  { name: "an audience metric", re: /\b(popular|popularity|followers?|listeners?|millions?|billions?)\b/i, readingExempt: false },
];

function bannedKeyPaths(v: unknown, at: string, out: string[]): void {
  if (Array.isArray(v)) v.forEach((x, i) => bannedKeyPaths(x, `${at}[${i}]`, out));
  else if (isObj(v)) {
    for (const [k, x] of Object.entries(v)) {
      if (BANNED_KEYS.test(k)) out.push(`${at}.${k}`);
      bannedKeyPaths(x, `${at}.${k}`, out);
    }
  }
}

export function scoreCardCompleteness(input: CaseInput): ScorerResult {
  return withResult(input, (r) => {
    const reasons: string[] = [];
    let cards = 0;
    for (const d of r.domains) {
      for (const pick of d.picks) {
        const who = pickLabel(d.domain, pick);
        const card = isObj(pick.card) ? pick.card : null;
        if (!card) {
          reasons.push(`${who}: no card`);
          continue;
        }
        cards++;
        if (!isObj(card.path) || list(card.path.hops).length === 0) reasons.push(`${who}: the card has no path`);
        if (!nonEmpty(card.why)) reasons.push(`${who}: the card has no why`);
        if (!nonEmpty(card.different)) reasons.push(`${who}: the card has no different`);
        const counts = isObj(card.provenance) ? card.provenance : null;
        if (!counts || !isNum(counts.sourced) || !isNum(counts.inferred)) reasons.push(`${who}: the card has no provenance`);

        if (card.reading !== undefined) {
          const reading = isObj(card.reading) ? card.reading : null;
          if (!reading || !nonEmpty(reading.text)) reasons.push(`${who}: the card's reading has no text`);
          else if (!nonEmpty(reading.sourceUrl)) reasons.push(`${who}: the card has a reading with no source; a reading exists only when sourced`);
          else {
            const text = reading.text.trim().toLowerCase();
            for (const part of ["why", "different"] as const) {
              const line = card[part];
              if (nonEmpty(line) && line.toLowerCase().includes(text)) reasons.push(`${who}: the reading's text is repeated inside ${part}, merging sourced and inferred text`);
            }
          }
        }

        const texts: [string, unknown, boolean][] = [["why", card.why, false], ["different", card.different, false], ["reading", isObj(card.reading) ? card.reading.text : undefined, true]];
        for (const [part, text, isReading] of texts) {
          if (!nonEmpty(text)) continue;
          for (const f of FAMILIES) {
            if (isReading && f.readingExempt) continue;
            if (f.re.test(text)) reasons.push(`${who}: the ${part} text contains ${f.name}; the product shows no taste scores, rankings or audience metrics`);
          }
        }
        const keyHits: string[] = [];
        bannedKeyPaths(card, "card", keyHits);
        for (const k of keyHits) reasons.push(`${who}: ${k} is a score-like field on a card`);
      }
    }
    if (reasons.length) return { pass: false, reasons };
    return { pass: true, reasons: [`${cards} card(s) have path, why, different and provenance; readings are sourced; no scores, rankings or audience metrics`] };
  });
}

export const cardCompleteness: TraceScorer = {
  kind: "trace",
  name: "card-completeness",
  description: "Every card has path, why, different and provenance; a reading exists only when sourced; no taste score or ranking.",
  score: scoreCardCompleteness,
};
