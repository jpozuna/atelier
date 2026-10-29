// Checks on model-written text, run in code before anything reaches a card or the trace. The agent has no taste of
// its own and explains from the stored path only, so text is rejected when it:
//  - is empty, too long, or has markup, links or tag ids;
//  - holds a number or an era word (scores, counts, years and decades are never shown), unless inside a path name;
//  - uses an internal phrase (connection floor, reach score, extreme band, popularity, percentile ...) or the words
//    score, rank, popular;
//  - speaks in the first person, praises ("great", "masterpiece") or promises ("you will love it");
//  - makes a lineage claim (lineage comes only from retrieved text and is added by code, labelled with its source);
//  - names something that is not in the path (a capitalised word that is not a path name or a field phrase);
//  - adds descriptive words that come from no source: not from the theme tags, the pick-only tags, the user's own
//    why, the path names, the distance words, or the neutral vocabulary below (more than MAX_UNKNOWN_WORDS);
//  - restates another line.
// Names from the path are masked before the term checks, as whole names and as their words of 4+ letters, always on
// word boundaries, so a tag called "Popular Culture" is not refused. Pure functions, no I/O.

import type { Field } from "@/types";
import { MAX_UNKNOWN_WORDS, MIN_CHECKED_WORD_CHARS, MIN_MASKED_NAME_CHARS, RESTATE_OVERLAP, SHARED_PREFIX_CHARS } from "@/lib/agent/config";

/** A field as a noun, e.g. "a different field from music". */
export const FIELD_PHRASE: Readonly<Record<Field, string>> = {
  music: "music",
  film: "film",
  tv: "TV",
  books: "books",
  food_places: "food and places",
  fashion: "fashion",
};

/** Where something is seen, e.g. "Seeing it on TV". */
export const FIELD_IN: Readonly<Record<Field, string>> = {
  music: "in music",
  film: "in film",
  tv: "on TV",
  books: "in books",
  food_places: "among places to eat and go",
  fashion: "in fashion",
};

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Lower-case, accents and punctuation folded, for comparing names and counting overlap. */
export const fold = (s: string): string =>
  s.normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim().toLowerCase();

/** Whole names plus their words of MIN_CHECKED_WORD_CHARS or more letters. Names under MIN_MASKED_NAME_CHARS are ignored. */
function maskTerms(names: readonly string[]): string[] {
  const out = new Set<string>();
  for (const raw of names) {
    const n = raw.trim();
    if (n.length < MIN_MASKED_NAME_CHARS) continue;
    out.add(n);
    for (const w of n.split(/[^\p{L}\p{N}']+/u)) if (w.length >= MIN_CHECKED_WORD_CHARS) out.add(w);
  }
  return [...out].sort((a, b) => b.length - a.length);
}

/** Replaces every whole-word occurrence of the given names (and their longer words) with a space, case-insensitive. */
export function maskNames(text: string, names: readonly string[]): string {
  let out = text;
  for (const n of maskTerms(names)) {
    out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escape(n)}(?![\\p{L}\\p{N}])`, "giu"), " ");
  }
  return out;
}

// Score, rank and affinity words are refused only in their metric sense, so "a spare piano score", "the frontier"
// of a western and "an affinity for ritual" stay ordinary words.
const INTERNAL_TERMS =
  /\b(connection floor|(?:reach|taste|match|similarity|affinity|connection|strong|weak|good|high|low|top) scores?|scor(?:ed|es|ing) (?:high|low|well|above|below)|high(?:er|est)?[- ]scor\w*|(?:calibration|moderate|high|extreme) band|band edges?|popularity|percentile|affinity scores?|frontier picks?|algorithm\w*|explainability|backfill\w*|tag ids?|rank(?:ed|ing)s?|popular\w*)\b/i;
const FIRST_PERSON = /\b(I|I'm|I've|I'll|I'd)\b|\b(my|mine|we|our|ours)\b/i;
const PRAISE = /\b(great|amazing|the best|best[- ]ever|brilliant|masterpiece|wonderful|perfect|stunning|fantastic|incredible|must[- ](?:see|read|hear|try|watch))\b/i;
/** Praise words are refused wherever model text is checked, however few other words are unknown. */
export const hasPraise = (text: string): boolean => PRAISE.test(text);
const PROMISE = /\byou(?:'ll| will| would)\s+(?:like|love|enjoy|adore)\b|\brecommend\w*/i;
const LINEAGE_WORDS = /\b(influenc\w*|inspir\w*|lineage|descendants?|descend(?:s|ed) from|homage|successors?|predecessors?|precursors?|based on)\b/i;
const ERA_WORDS = /\b(decades?|centur(?:y|ies)|(?:sixt|sevent|eight|ninet)ies|(?:nineteen|twenty)\b)\b/i;
const MARKUP = /[`<>{}[\]*#|\\]|https?:|www\.|urn:/i;

/** Words that carry no description of their own. Anything else must come from the path, the pick-only tags or the user's why. */
const NEUTRAL = `about above across after again against along also although among another around away back because been before being between both bring brings
carry carries come comes connect connects connected connection could differ different differs does each else even every field fields find finds follow following
from have help helps here however into just keep keeps kind less like link links linked look looks make makes many might more most much must near only other others
over pick picks same seed seeds seeing share shares shared show shows shown side since some still such than that their them then there these theme themes they
this those through thread toward towards trace traces tracing travel travels turn turns under until used uses using very what when where which while will with within
without work works would your yours notice noticing sits stays stay lead leads route own whole part parts held holds hold sees see seen turns again twice second
another place places way ways idea ideas thing things shape shapes appear appears appeared appearing recurs recur recurring carried carrying
describe describes described call calls called value values want wants name named graph range run runs rest rests going goes beside alongside beyond
rather though whose whom doesn isn don add adds added tag tags match matches close closer narrow narrower wider broader overlap overlaps pull
something shift shifts tied tie ties quality qualities form forms written while being other end`.split(/\s+/);

/** The word and each form of it with one common suffix taken off ("grooves" -> grooves, groov, groove). */
export const stems = (w: string): string[] => [w, ...["ing", "ed", "es", "ly", "s"].filter((suf) => w.length - suf.length >= 3 && w.endsWith(suf)).map((suf) => w.slice(0, -suf.length))];

const words = (s: string): string[] => fold(s).split(" ").filter(Boolean);

/** The words a line may use: neutral vocabulary plus every word of the given sources (names, tags, the user's why, distance words). */
export function buildVocabulary(sources: readonly string[]): Set<string> {
  const v = new Set<string>();
  // A multi-word source also counts joined up ("Hand-Made" allows "handmade").
  const joined = sources.map((s) => words(s).join("")).filter((w) => w.length >= MIN_CHECKED_WORD_CHARS);
  for (const w of [...NEUTRAL, ...sources.flatMap(words), ...joined]) {
    for (const s of stems(w)) v.add(s);
  }
  return v;
}

/** True when the word, its stem, or a form sharing SHARED_PREFIX_CHARS leading letters with it is in the vocabulary. */
function knownWord(w: string, vocabulary: ReadonlySet<string>): boolean {
  if (stems(w).some((s) => vocabulary.has(s))) return true;
  if (w.length < SHARED_PREFIX_CHARS) return false;
  const prefix = w.slice(0, SHARED_PREFIX_CHARS);
  for (const v of vocabulary) if (v.startsWith(prefix)) return true;
  return false;
}

/** Does the text name the tag: the whole name, or every word of it in some form ("melancholic" for "Melancholy")? */
export function namesTag(text: string, tag: string): boolean {
  const t = fold(tag);
  if (!t) return false;
  if (` ${fold(text)} `.includes(` ${t} `)) return true;
  const have = buildVocabulary([text]);
  if (t.includes(" ") && have.has(t.replace(/ /g, ""))) return true;
  return t.split(" ").every((w) => (w.length < MIN_CHECKED_WORD_CHARS ? have.has(w) : knownWord(w, have)));
}

export interface TextCheck {
  /** Names that appear in the path (labels, tag names, field phrases). They are masked before the term checks. */
  allowed: readonly string[];
  maxChars: number;
  /** Set (from `buildVocabulary`) to refuse descriptive words that come from no source. */
  vocabulary?: ReadonlySet<string>;
  /** False for lines that may talk about lineage. Default true: the model writes none, code adds it. */
  noLineage?: boolean;
  /** The user's own words. A quoted span found in them is masked, so a partial echo ("my rainy-day album") passes. */
  echo?: string | null;
}

const QUOTED = /"([^"]+)"|“([^”]+)”|‘([^’]+)’|(?<![\p{L}\p{N}])'([^']+)'(?![\p{L}\p{N}])/gu;

/** Masks every quoted span whose words are, in order, part of the user's own words. */
export function maskEcho(text: string, echo: string | null | undefined): string {
  const source = echo ? ` ${fold(echo)} ` : "";
  if (!source.trim()) return text;
  return text.replace(QUOTED, (whole, ...groups: (string | undefined)[]) => {
    const inner = groups.slice(0, 4).find((g) => typeof g === "string") ?? "";
    const f = fold(inner);
    return f && source.includes(` ${f} `) ? " " : whole;
  });
}

/** Why a model-written line is refused. An empty list means it passes. */
export function checkText(text: string, opts: TextCheck): string[] {
  const reasons: string[] = [];
  const t = text.trim();
  if (!t) return ["empty"];
  if (t.length > opts.maxChars) reasons.push(`longer than ${opts.maxChars} characters`);
  if (/[\u0000-\u001f]/.test(t.replace(/\n/g, ""))) reasons.push("control characters");
  const masked = maskNames(maskEcho(t, opts.echo), opts.allowed);
  if (MARKUP.test(masked)) reasons.push("markup, link or tag id");
  if (/\d/.test(masked)) reasons.push("a number");
  if (ERA_WORDS.test(masked)) reasons.push("a year or decade");
  if (INTERNAL_TERMS.test(masked)) reasons.push("an internal term");
  if (FIRST_PERSON.test(masked)) reasons.push("first person");
  if (PRAISE.test(masked)) reasons.push("praise or a claim of taste");
  if (PROMISE.test(masked)) reasons.push("a promise that the user will like it");
  if (opts.noLineage !== false && LINEAGE_WORDS.test(masked)) reasons.push("a lineage claim");
  if (unknownNames(masked).length) reasons.push("a name that is not in the path");
  if (opts.vocabulary) {
    const unknown = new Set(
      words(masked).filter((w) => w.length >= MIN_CHECKED_WORD_CHARS && !knownWord(w, opts.vocabulary!)),
    );
    if (unknown.size > MAX_UNKNOWN_WORDS) reasons.push("descriptive words that come from no tag, name or the user's own words");
  }
  return reasons;
}

/**
 * Capitalised words in the middle of a sentence that are not path names (those were masked) or field phrases.
 * The first word of a sentence is skipped. This is a guard, not a parser: it catches a model adding a creator or
 * a work that the path never named.
 */
/** Capitalised adjectives of place or style ("Japanese", "Gothic", "Parisian") describe, they do not name a work or a person. */
const STYLE_WORD = /^\p{Lu}\p{L}{3,}(?:ese|ish|ian|ean|ic|esque)$/u;

export function unknownNames(maskedText: string): string[] {
  const out: string[] = [];
  const sentences = maskedText.split(/(?<=[.!?:])\s+/);
  for (const s of sentences) {
    const ws = s.split(/\s+/).filter(Boolean);
    for (let i = 1; i < ws.length; i++) {
      const w = ws[i]!.replace(/^[("'“‘]+|[)"'”’.,;:!?]+$/g, "");
      if (!w) continue;
      if (/^\p{Lu}/u.test(w) && w !== "TV" && !STYLE_WORD.test(w)) out.push(w);
    }
  }
  return out;
}

const overlapWords = (s: string): string[] => words(s).filter((w) => w.length > 2);

/** Share of the candidate's words (3+ letters) that also appear in the main line. */
export function overlapShare(candidate: string, mainLine: string): number {
  const c = overlapWords(candidate);
  if (c.length === 0) return 0;
  const m = new Set(overlapWords(mainLine));
  return c.filter((w) => m.has(w)).length / c.length;
}

/** True when `candidate` says what `mainLine` already says. Mask path names from both first when comparing card lines. */
export const restates = (candidate: string, mainLine: string): boolean => overlapShare(candidate, mainLine) >= RESTATE_OVERLAP;

/** `A`, `A and B`, `A, B and C`. */
export function joinList(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
