// Explanations. Each card's `why` and `different` are written from the pick's stored Path and nothing else: the
// prompt gets the seed name and field and the user's own words about it, the shared tag names, up to 3 tag names only
// the pick carries, plain distance words, the pick name and field, and the retrieved lineage line when the path has
// one. It gets no popularity, no reach, no tags outside the path, no other fact about the entity.
//
// Model output is validated in code (text.ts). A line that fails, or a pick the model skipped, gets deterministic
// text built from the same path, so a card is never empty and never ungrounded. A sourced lineage claim is added by
// code as its own sentence, attributed to its source and worded from the hop's retrieved label, so sourced and
// inferred never share a sentence (hard rule 6). A pick whose path names no theme gets no card (it is dropped).
// The model is called once per domain with all of that domain's picks (at most one call per domain per run).

import type { Card, DistanceHint, Field, Path, Pick as AtelierPick, TraceEvent } from "@/types";
import type { FrontierPick } from "@/lib/frontier";
import { nameMatchKey, type Reading } from "@/lib/refs";
import {
  DIFFERENT_MAX_CHARS,
  FALLBACK_TAGS_SHOWN,
  LLM_EXPLAIN_MAX_TOKENS,
  MAX_PICK_ONLY_TAGS,
  MAX_THEME_TAGS_IN_INPUT,
  MAX_WHY_CHARS_IN_PROMPT,
  WHY_MAX_CHARS,
} from "@/lib/agent/config";
import type { Llm } from "./llm";
import { sourceNameOfHop } from "./names";
import { CARDS_SYSTEM, cardsMessage } from "./prompts";
import { parseCards, WRITE_CARDS_TOOL, type CardLines } from "./tools";
import { buildVocabulary, checkText, FIELD_IN, FIELD_PHRASE, fold, joinList, maskNames, namesTag, restates } from "./text";
import type { ExplainInput } from "./types";

export interface ExplainContext {
  /** Profile tag id to Qloo's tag name. Shared tags are always profile tags. */
  tagNames: ReadonlyMap<string, string>;
  /** Names of the pool candidates' own tags (for `Path.pickOnlyTags`), by tag id. */
  pickTagNames: ReadonlyMap<string, string>;
  /** Seed id to the seed's field. */
  seedFields: ReadonlyMap<string, Field>;
  /** Seed id to the user's own words about it. */
  seedWhys: ReadonlyMap<string, string>;
  /** The user's seed names (as typed), to tell whether a retrieved lineage line names one of them. */
  seedNames: readonly string[];
  llm: Llm;
  signal?: AbortSignal;
  /** Throws when the run was cancelled. */
  checkAbort: () => void;
  emit: (event: TraceEvent) => void;
  now: () => Date;
}

/** `Path.distance` in plain words. Never numbers. */
export const DISTANCE_WORDS: Readonly<Record<DistanceHint, string>> = {
  other_field: "a different field from the seed",
  farther_from_tags: "shares fewer of the usual themes",
  less_familiar: "less familiar territory",
};

const nonEmpty = (xs: readonly (string | undefined)[]): string[] => xs.filter((n): n is string => !!n && n.trim().length > 0);

/** The whole of what an explanation may know about a pick. Reads the path only. */
export function buildExplainInput(pick: AtelierPick | FrontierPick, ctx: Pick<ExplainContext, "tagNames" | "pickTagNames" | "seedFields" | "seedWhys" | "seedNames">): ExplainInput {
  const path = pick.path;
  const seedHop = path.hops.find((h) => h.kind === "seed");
  const themeHop = path.hops.find((h) => h.kind === "theme");
  const lineageHop = path.hops.find((h) => h.kind === "lineage");
  const themeTags = [...new Set(nonEmpty(path.sharedTags.map((id) => ctx.tagNames.get(id) ?? ctx.pickTagNames.get(id))))].slice(0, MAX_THEME_TAGS_IN_INPUT);
  if (themeTags.length === 0 && themeHop?.label.trim()) themeTags.push(themeHop.label.trim());
  const pickOnlyTags = [...new Set(nonEmpty((path.pickOnlyTags ?? []).map((id) => ctx.pickTagNames.get(id) ?? ctx.tagNames.get(id))))].slice(0, MAX_PICK_ONLY_TAGS);
  const source = lineageHop ? sourceNameOfHop(lineageHop) : null;
  const why = ctx.seedWhys.get(path.seedId)?.replace(/\s+/g, " ").trim().slice(0, MAX_WHY_CHARS_IN_PROMPT);
  return {
    pickId: pick.id,
    seed: { label: seedHop?.label ?? "", field: ctx.seedFields.get(path.seedId) ?? pick.field, why: why || null },
    themeTags,
    pickOnlyTags,
    distance: (path.distance ?? []).map((d) => DISTANCE_WORDS[d]),
    lineage:
      lineageHop && source
        ? { text: lineageHop.label, source, touchesSeed: ctx.seedNames.some((n) => !!nameMatchKey(n) && ` ${nameMatchKey(lineageHop.label)} `.includes(` ${nameMatchKey(n)} `)) }
        : null,
    pick: { label: pick.name, field: pick.field },
    anchorBasis: path.anchor.source === "qloo_explainability" ? "graph_link" : "shared_tags",
  };
}

/** Everything the lines may name: seed, pick, theme and pick-only tags, the user's words, and the field phrases. */
function allowedNames(input: ExplainInput): string[] {
  return [input.seed.label, input.pick.label, ...input.themeTags, ...input.pickOnlyTags, ...(input.seed.why ? [input.seed.why] : []), ...Object.values(FIELD_PHRASE)];
}

function vocabularyFor(input: ExplainInput) {
  return buildVocabulary([...allowedNames(input), ...input.distance, ...Object.values(FIELD_IN)]);
}

/** "the theme" (or this/that) followed, in the same clause, by two or more of the theme tags. */
function singularOverSeveral(why: string, tags: readonly string[]): boolean {
  for (const m of why.matchAll(/\b(?:the|this|that) theme\b([^.;,]*)/gi)) {
    if (tags.filter((t) => namesTag(m[1]!, t)).length > 1) return true;
  }
  return false;
}

/** Why a pair of model lines is refused; empty means accepted. */
export function validateLines(lines: CardLines, input: ExplainInput): string[] {
  const allowed = allowedNames(input);
  const vocabulary = vocabularyFor(input);
  const reasons: string[] = [];
  const why = lines.why.trim();
  const different = lines.different.trim();
  const echo = input.seed.why;
  for (const r of checkText(why, { allowed, maxChars: WHY_MAX_CHARS, vocabulary, echo })) reasons.push(`why: ${r}`);
  for (const r of checkText(different, { allowed, maxChars: DIFFERENT_MAX_CHARS, vocabulary, echo })) reasons.push(`different: ${r}`);
  if (why && !input.themeTags.some((t) => namesTag(why, t))) reasons.push("why: names none of the shared tags");
  const n = input.themeTags.length;
  if (n === 1 && /\b(themes|both themes|these themes)\b/i.test(why)) reasons.push("why: plural for one theme");
  if (n > 1 && singularOverSeveral(why, input.themeTags)) reasons.push("why: singular for several themes");
  if (why && different && restates(maskNames(different, allowed), maskNames(why, allowed))) reasons.push("different: restates why");
  if (input.lineage) {
    const l = fold(input.lineage.text);
    if (l && (fold(why).includes(l) || fold(different).includes(l))) reasons.push("restates the lineage line");
  }
  return reasons;
}

/** Deterministic lines from the path. Used when the model is off, fails, or is refused. */
export function fallbackLines(input: ExplainInput): CardLines {
  const shown = input.themeTags.slice(0, FALLBACK_TAGS_SHOWN);
  const list = joinList(shown);
  const one = shown.length === 1;
  const cross = input.seed.field !== input.pick.field;
  const where = cross ? FIELD_IN[input.pick.field] : "in a second work";
  const why = `${input.seed.label} and ${input.pick.label} share ${one ? "the theme" : "the themes"} ${list}. Seeing ${list} ${where} may help you notice ${one ? "it" : "them"} in ${input.seed.label}.`;

  const parts: string[] = [];
  if (input.pickOnlyTags.length) {
    const p = input.pickOnlyTags;
    parts.push(`${input.pick.label} also carries ${joinList(p)}, which ${p.length === 1 ? "is" : "are"} not among the themes in your profile.`);
  }
  if (input.distance.includes(DISTANCE_WORDS.other_field)) {
    parts.push(`It comes from ${FIELD_PHRASE[input.pick.field]}, a different field from ${FIELD_PHRASE[input.seed.field]}.`);
  }
  if (input.distance.includes(DISTANCE_WORDS.farther_from_tags)) parts.push("It shares fewer of your usual themes than a closer pick would.");
  if (input.distance.includes(DISTANCE_WORDS.less_familiar)) parts.push("It is less familiar territory.");
  const different = parts.length ? parts.join(" ") : `The link runs only through ${list}; the rest of ${input.pick.label} may differ.`;
  return { why, different };
}

const LINEAGE_FORMS: readonly [RegExp, (names: string) => string][] = [
  [/^Influenced by (.+)$/i, (n) => `influenced by ${n}`],
  [/^Influenced the genres (.+)$/i, (n) => `having influenced the genres ${n}`],
  [/^Influenced other media: (.+)$/i, (n) => `having influenced other media: ${n}`],
  [/^Influenced (.+)$/i, (n) => `having influenced ${n}`],
  [/^Listed as a similar brand to (.+)$/i, (n) => `a similar brand to ${n}`],
  [/^Based on (.+)$/i, (n) => `based on ${n}`],
  [/^Inspired by (.+)$/i, (n) => `inspired by ${n}`],
];

/**
 * The sourced lineage claim as its own sentence, attributed and completing "<pick> ...", worded only from the hop's
 * retrieved label. `leads` is true when the retrieved names include one of the user's seeds, so it opens the card text.
 * Null when the path has no lineage hop (or its source is unknown: nothing is claimed without a source).
 */
export function lineageSentence(input: ExplainInput): { text: string; leads: boolean } | null {
  if (!input.lineage) return null;
  const label = input.lineage.text.trim().replace(/[.!?]+$/, "");
  if (!label) return null;
  let names = "";
  let phrase: string | null = null;
  for (const [re, make] of LINEAGE_FORMS) {
    const m = re.exec(label);
    if (m) {
      names = m[1]!;
      phrase = make(names);
      break;
    }
  }
  const text = phrase ? `${input.lineage.source} lists ${input.pick.label} as ${phrase}.` : `${input.lineage.source} lists this about ${input.pick.label}: ${label}.`;
  return { text, leads: input.lineage.touchesSeed };
}

const oneLine = (s: string): string => s.replace(/\s+/g, " ").trim();
const sentence = (s: string): string => (/[.!?]$/.test(s) ? s : `${s}.`);

/** Provenance counts equal the hop counts (the provenance scorer checks this). */
export function provenanceOf(path: Path): { sourced: number; inferred: number } {
  const sourced = path.hops.filter((h) => h.provenance === "sourced").length;
  return { sourced, inferred: path.hops.length - sourced };
}

export function assembleCard(path: Path, lines: CardLines, input: ExplainInput, reading?: Reading): Card {
  const lineage = lineageSentence(input);
  const why = sentence(oneLine(lines.why));
  return {
    path,
    why: (lineage?.leads ? [lineage.text, why] : [why, lineage?.text]).filter(Boolean).join(" "),
    different: sentence(oneLine(lines.different)),
    provenance: provenanceOf(path),
    ...(reading ? { reading: { text: reading.text, sourceUrl: reading.sourceUrl, ...(reading.sourceLabel ? { sourceLabel: reading.sourceLabel } : {}) } } : {}),
  };
}

export interface ExplainedDomain {
  picks: AtelierPick[];
  /** Steps that used deterministic text, for `meta.fallbacks`. */
  fallbacks: string[];
}

/**
 * Cards for one domain's picks. At most ONE model call. Emits one `explain` event per pick, in pick order.
 * Never throws for a model problem; throws only when the run was cancelled. A pick whose path names no theme is
 * left out.
 */
export async function explainDomain(
  domain: Field,
  allPicks: readonly FrontierPick[],
  readings: ReadonlyMap<string, Reading | undefined>,
  ctx: ExplainContext,
): Promise<ExplainedDomain> {
  const pairs = allPicks.map((pick) => ({ pick, input: buildExplainInput(pick, ctx) })).filter((p) => p.input.themeTags.length > 0);
  const picks = pairs.map((p) => p.pick);
  const inputs = pairs.map((p) => p.input);
  const fallbacks: string[] = [];
  if (picks.length < allPicks.length) fallbacks.push(`cards:${domain}:${allPicks.length - picks.length} left out`);
  ctx.checkAbort();
  let lines = new Map<string, CardLines>();
  let answered = false;
  if (picks.length > 0 && ctx.llm.enabled) {
    try {
      const raw = await ctx.llm.call({
        tool: WRITE_CARDS_TOOL,
        system: CARDS_SYSTEM,
        user: cardsMessage(inputs),
        maxTokens: LLM_EXPLAIN_MAX_TOKENS,
        signal: ctx.signal,
      });
      lines = parseCards(raw, new Set(inputs.map((_, n) => `p${n + 1}`)));
      answered = true;
    } catch {
      ctx.checkAbort();
      fallbacks.push(`cards:${domain}`);
    }
  } else if (picks.length > 0) {
    fallbacks.push(`cards:${domain}`);
  }

  let replaced = 0;
  const out: AtelierPick[] = [];
  for (let i = 0; i < picks.length; i++) {
    ctx.checkAbort();
    const pick = picks[i]!;
    const input = inputs[i]!;
    const modelLines = lines.get(`p${i + 1}`);
    const accepted = modelLines && validateLines(modelLines, input).length === 0 ? modelLines : null;
    if (!accepted && answered) replaced += 1;
    const card = assembleCard(pick.path, accepted ?? fallbackLines(input), input, readings.get(pick.qlooId));
    ctx.emit({
      kind: "explain",
      t: ctx.now().toISOString(),
      say: `Wrote the explanation for ${pick.name} from its path.`,
      pickId: pick.id,
    });
    out.push({ ...pick, card });
  }
  if (replaced > 0) fallbacks.push(`cards:${domain}:${replaced} lines`);
  return { picks: out, fallbacks };
}
