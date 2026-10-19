// Readings: an excerpt of retrieved text, offered as "a reading". Nothing is written, summarised or interpreted
// here: the text is the source's own words with markup stripped and whitespace collapsed, cut at a sentence end.
// When no retrieved text qualifies, there is no reading (CLAUDE.md hard rule 6).
//
// A reading comes ONLY from `style_description` on movie, tv_show and brand (manager decision, T-09 review).
// Biography, description and plot_summary are never used: they narrate, they do not read. Music, books and places
// have no reading.

import type { Field } from "@/types";
import { LICENSES, QLOO_SOURCE_URL, REFS_LIMITS, SOURCE_LABELS } from "./limits";
import type { Reading, RefsEntity } from "./types";

/** Exact property key per field. No suffix matching. */
export const READING_KEYS: Partial<Record<Field, string>> = {
  film: "style_description",
  tv: "style_description",
  fashion: "style_description",
};

/** Tags removed, whitespace collapsed. */
export function plainText(s: string): string {
  return s
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Words that end in a period without ending a sentence. Compared lowercase, without dots. */
const ABBREVIATIONS = new Set([
  "mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st", "mt", "vs", "etc", "eg", "ie", "inc", "ltd", "co", "vol",
  "fig", "approx", "dept", "est", "ca", "cf", "al",
]);

/** True when the period at `index` belongs to an abbreviation or an initial, so it is not a sentence end. */
function isAbbreviation(text: string, index: number): boolean {
  const before = text.slice(0, index);
  const word = /([A-Za-z][A-Za-z.]*)$/.exec(before)?.[1];
  if (!word) return false;
  const bare = word.replace(/\./g, "").toLowerCase();
  // A single letter is an initial ("J. Fixture"). A dotted run such as "e.g" or "U.S" is an abbreviation.
  return bare.length === 1 || ABBREVIATIONS.has(bare);
}

/** Sentence ends: . ! or ? plus any closing quotes or brackets, followed by a space or the end. Returns end offsets. */
function sentenceEnds(text: string): number[] {
  const ends: number[] = [];
  for (const m of text.matchAll(/[.!?]["'”’)\]]*(?=\s|$)/g)) {
    if (m[0][0] === "." && isAbbreviation(text, m.index)) continue;
    ends.push(m.index + m[0].length);
  }
  return ends;
}

/** An excerpt: whole sentences when they fit, else a word-boundary cut marked with an ellipsis. */
export function excerpt(text: string, max = REFS_LIMITS.READING_MAX_CHARS, min = REFS_LIMITS.READING_MIN_CHARS): string | null {
  const t = plainText(text);
  if (t.length < min) return null;
  if (t.length <= max) return t;
  const end = sentenceEnds(t.slice(0, max + 1)).filter((e) => e <= max + 1).pop() ?? -1;
  if (end >= min) return t.slice(0, end);
  const space = t.lastIndexOf(" ", max - 1);
  const cut = space >= min ? space : max - 1;
  return `${t.slice(0, cut).replace(/[\s.,;:!?-]+$/, "")}…`;
}

/** The reading for an item, from its own retrieved `style_description`. Null when there is none. */
export function readingFor(entity: RefsEntity): Reading | null {
  const key = READING_KEYS[entity.field];
  const v = key ? entity.properties?.[key] : undefined;
  if (typeof v !== "string") return null;
  const text = excerpt(v);
  if (!text) return null;
  return {
    label: "a reading",
    text,
    sourceUrl: QLOO_SOURCE_URL,
    source: "qloo",
    sourceLabel: SOURCE_LABELS.qloo,
    license: LICENSES.qloo,
  };
}
