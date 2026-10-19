import type { Band, Field, RequeryReason, TraceEvent } from "@/types";
import { isTraceEvent } from "@/types";

/**
 * Pure event -> line rendering for the reasoning panel. No React in here, so it is testable in the node env.
 *
 * Rules the renderer enforces (hard rule 7 and the Qloo data rules):
 * - Lines are built from structured fields in fixed wording. Ids, tag ids, raw params, scores,
 *   popularity numbers and call counts are never put in a line.
 * - Model-written text (`choose_theme.reason`, `say` for unknown kinds) goes through `cleanReason`, an
 *   allowlist: plain words and ordinary punctuation only, otherwise the whole text is dropped.
 * - Seed and pick display names go through the looser `cleanName` (digits allowed), which still drops
 *   urns, uuids, urls and key-like strings.
 * - Cached Qloo calls are not steps. Repeated identical lines collapse, so repetition never shows a count.
 */

export const FIELD_NOUN: Record<Field, string> = {
  music: "music",
  film: "film",
  tv: "TV",
  books: "books",
  food_places: "food and places",
  fashion: "fashion",
};

const BAND_WORD: Record<Band, string> = {
  calibration: "very close",
  moderate: "moderate",
  high: "high",
  extreme: "extreme",
};

/** Plain-words reason for each re-query code (hard rule 8: the reason is computed, the words are fixed). */
export const REQUERY_TEXT: Record<RequeryReason, (field: string) => string> = {
  too_obvious: (f) => `Too many obvious results in ${f}, asking again for less popular ones.`,
  too_weak: (f) => `Too few results in ${f} connected strongly enough, asking again with a different theme.`,
  empty: (f) => `Nothing came back in ${f}, asking again with looser terms.`,
  weak_connection: (f) => `The results in ${f} were far enough but shared nothing distinctive with your taste, asking again.`,
};

export type StepTone = "plain" | "quiet" | "notice";

export interface ReasoningStep {
  /** Stable React key: position of the source event in the stream. */
  key: string;
  /** Small word label shown beside the line. Meaning never rests on color alone. */
  label: string;
  /** The one-line rendering. */
  text: string;
  /** Optional second line (a model-written reason, cleaned). */
  detail?: string;
  /** `quiet` for plumbing (taste-graph lookups), `notice` for re-queries and relaxed bands. */
  tone: StepTone;
  /** ISO time of the event, for a <time> element. */
  t: string;
}

export interface RenderContext {
  /** Seed id -> what the user typed, so lines can name the seed. Never shown as an id. */
  seedNames?: Readonly<Record<string, string>>;
  /** Pick id -> display name, so lines can name the pick. Never shown as an id. */
  pickNames?: Readonly<Record<string, string>>;
}

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
const URN = /\burn:/i;
const URL_LIKE = /\b(?:https?|ftp|wss?):|\/\/|\bwww\.|\.(?:com|net|org|io|dev|app|co|ai|invalid)\b/i;
const KEYISH = /api[\s_-]?key|x-api|secret|bearer\b|authorization|\b(?:sk|pk|ant|key|tok|token)[_-]/i;
const SCOREISH = /\b(?:scores?|scored|ranks?|ranked|ranking|rankings|percent|percentage|popularity)\b/i;
const MAX_REASON = 200;
const MAX_NAME = 120;

/** Plain words and ordinary punctuation: letters, spaces, . , ; : ' " ( ) ? and dashes. No digits, no slashes, no symbols. */
const PLAIN_TEXT = /^[\p{L}\p{M}\s.,;:'\u2019\u2018"\u201c\u201d()?\u2013\u2014-]+$/u;
/** A dot, colon or dash joining letters with no space is an identifier (filter.popularity.max, a host), not prose. */
const DOTTED = /\p{L}[.:]\p{L}/u;
/** A single letters-only run this long is a token or key, not a word. */
const LONG_WORD = /[\p{L}]{20,}/u;

function capAt(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const at = cut.lastIndexOf(" ");
  return `${cut.slice(0, at > max / 2 ? at : max).trimEnd()}\u2026`;
}

/**
 * Model-written reason text, allowlisted. Shown only when it is plain words and ordinary punctuation:
 * no digits, urls, dotted identifiers, urns, uuids, key-like prefixes, long tokens, or score words.
 * Anything else drops the whole text. Nothing is stripped mid-sentence.
 */
export function cleanReason(input: unknown): string | undefined {
  if (typeof input !== "string") return undefined;
  const s = input.replace(/\s+/g, " ").trim();
  if (!s) return undefined;
  if (!PLAIN_TEXT.test(s) || DOTTED.test(s) || LONG_WORD.test(s)) return undefined;
  if (UUID.test(s) || URN.test(s) || URL_LIKE.test(s) || KEYISH.test(s) || SCOREISH.test(s)) return undefined;
  return capAt(s, MAX_REASON);
}

/**
 * A seed or pick display name: a user-typed or Qloo title, so digits and symbols are fine ("Vol. 2").
 * Dropped (undefined) when it looks like an urn, uuid, url, key, or a long opaque token.
 */
export function cleanName(input: unknown): string | undefined {
  if (typeof input !== "string") return undefined;
  const s = input.replace(/\s+/g, " ").trim();
  if (!s) return undefined;
  if (UUID.test(s) || URN.test(s) || URL_LIKE.test(s) || KEYISH.test(s)) return undefined;
  if (/\S{32,}/.test(s)) return undefined;
  return capAt(s, MAX_NAME);
}

function named(map: Readonly<Record<string, string>> | undefined, id: string): string | undefined {
  const s = cleanName(map?.[id]);
  return s ? `\u201c${s}\u201d` : undefined;
}

type Rendered = Omit<ReasoningStep, "key" | "t">;

function endpointLine(endpoint: string, failed: boolean): string {
  if (failed) return "The taste graph had no answer for that request, carrying on.";
  switch (endpoint) {
    case "/search":
      return "Looked up what you named in the taste graph.";
    case "/v2/tags":
      return "Looked up themes in the taste graph.";
    case "/v2/insights":
      return "Asked the taste graph for connected entries.";
    case "/entities":
      return "Read an entry's details from the taste graph.";
    default:
      return "Consulted the taste graph.";
  }
}

const NEUTRAL: Rendered = { label: "Step", text: "Took another step.", tone: "quiet" };

/**
 * One-line rendering of a single event, or null when the event is not a step (cached calls).
 * Never throws: an event that fails the contract (unknown kind or reason, missing fields) renders the
 * loop's own sentence if it passes `cleanReason`, otherwise a neutral line.
 */
export function renderEvent(event: unknown, ctx: RenderContext = {}): Rendered | null {
  if (!isTraceEvent(event)) return fallback(event);
  try {
    return renderValid(event, ctx);
  } catch {
    return fallback(event);
  }
}

function fallback(event: unknown): Rendered {
  const say = typeof event === "object" && event !== null ? (event as { say?: unknown }).say : undefined;
  const text = cleanReason(say);
  return text ? { label: "Step", text, tone: "plain" } : NEUTRAL;
}

function renderValid(event: TraceEvent, ctx: RenderContext): Rendered | null {
  switch (event.kind) {
    case "qloo_call": {
      if (event.cached) return null;
      const failed = typeof event.status === "number" && event.status >= 400;
      return { label: "Taste graph", text: endpointLine(event.endpoint, failed), tone: "quiet" };
    }
    case "resolve_seed": {
      const subject = named(ctx.seedNames, event.seedId) ?? "Something you shared";
      if (event.status === "clean") {
        return { label: "What you shared", text: `${subject} matched a single entry.`, tone: "plain" };
      }
      if (event.status === "ambiguous") {
        return { label: "What you shared", text: `${subject} could mean more than one thing.`, tone: "notice" };
      }
      return { label: "What you shared", text: `${subject} was not found.`, tone: "notice" };
    }
    case "extract_tags":
      return {
        label: "Themes",
        text: `Gathered the themes running through your ${FIELD_NOUN[event.field]}.`,
        tone: "plain",
      };
    case "build_axes":
      return { label: "Themes", text: "Grouped those themes into the axes of your chart.", tone: "plain" };
    case "map_why": {
      const name = named(ctx.seedNames, event.seedId);
      const base = name ? `Read your reason for ${name}` : "Read your reason";
      return {
        label: "Your words",
        text: event.semanticSearch
          ? `${base} and matched it to themes by meaning rather than exact words.`
          : `${base} and matched it to themes.`,
        tone: "plain",
      };
    }
    case "choose_theme": {
      const detail = cleanReason(event.reason);
      return { label: "Decision", text: "Chose a theme to follow outward from your taste.", detail, tone: "plain" };
    }
    case "query_insights":
      return {
        label: "Search",
        text: event.explainability
          ? `Looked in ${FIELD_NOUN[event.domain]} for entries connected to that theme, with reasons attached.`
          : `Looked in ${FIELD_NOUN[event.domain]} for entries connected to that theme.`,
        tone: "plain",
      };
    case "score": {
      const f = FIELD_NOUN[event.domain];
      if (event.clearedFloor === 0) {
        return { label: "Check", text: `Nothing in ${f} connected strongly enough to your taste.`, tone: "notice" };
      }
      return {
        label: "Check",
        text:
          event.clearedFloor < event.scored
            ? `Checked ${f} entries for connection and distance, and set aside those connected too weakly.`
            : `Checked ${f} entries for connection and distance.`,
        tone: "plain",
      };
    }
    case "requery":
      return {
        label: "Asking again",
        text: REQUERY_TEXT[event.reason](FIELD_NOUN[event.domain]),
        tone: "notice",
      };
    case "fetch_refs": {
      if (event.sourcedCount <= 0) {
        return {
          label: "Sources",
          text: "No written sources turned up, so lineage and symbolism are left out.",
          tone: "plain",
        };
      }
      return {
        label: "Sources",
        text:
          event.inferredCount > 0
            ? "Found written sources for some picks. Those are marked sourced and the rest stay marked inferred."
            : "Found written sources for these picks.",
        tone: "plain",
      };
    }
    case "relax":
      return {
        label: "Relaxed",
        text: `Nothing connected strongly enough at the ${BAND_WORD[event.from]} band, so showing ${BAND_WORD[event.to]}.`,
        tone: "notice",
      };
    case "explain": {
      const name = named(ctx.pickNames, event.pickId);
      return {
        label: "Explaining",
        text: name
          ? `Wrote why ${name} was chosen, from its path only.`
          : "Wrote why a pick was chosen, from its path only.",
        tone: "plain",
      };
    }
    default:
      return NEUTRAL;
  }
}

/**
 * Turn the accumulated event list into display steps, in stream order.
 * Cached calls are skipped; a non-requery line identical to the one before it is skipped, so repetition never
 * reveals a count. Re-queries never collapse: each one is visible reasoning.
 */
export function buildSteps(events: readonly unknown[], ctx: RenderContext = {}): ReasoningStep[] {
  const steps: ReasoningStep[] = [];
  events.forEach((event, i) => {
    const r = renderEvent(event, ctx);
    if (!r) return;
    const prev = steps[steps.length - 1];
    const isRequery = r.label === "Asking again";
    if (!isRequery && prev && prev.text === r.text && prev.label === r.label && prev.detail === r.detail) return;
    const kind = (event as { kind?: unknown } | null)?.kind;
    const t = (event as { t?: unknown } | null)?.t;
    steps.push({ ...r, key: `${i}-${typeof kind === "string" ? kind : "step"}`, t: typeof t === "string" ? t : "" });
  });
  return steps;
}

/**
 * What to say in the polite live region. While a run streams, the latest step's line; once it has stopped,
 * one closing line for as long as `closePending` holds (the caller clears it when the line has been spoken).
 * Never the whole list, so a burst of events reads as one update.
 */
export function announcementText(
  latest: string | undefined,
  streaming: boolean,
  closePending: boolean,
): string | null {
  if (streaming) return latest ?? null;
  return closePending ? "The reasoning is complete." : null;
}

/**
 * Parse one line of a streamed trace: bare JSONL, or an SSE `data:` line (the prefix is removed).
 * Returns null for blank lines, SSE comments and `event:` or `id:` fields, malformed JSON, and non-trace objects.
 */
export function parseTraceLine(line: string): TraceEvent | null {
  let s = line.trim();
  if (!s || s.startsWith(":")) return null;
  if (/^(event|id|retry):/.test(s)) return null;
  if (s.startsWith("data:")) s = s.slice(5).trim();
  if (!s || !s.startsWith("{")) return null;
  try {
    const v: unknown = JSON.parse(s);
    return isTraceEvent(v) ? v : null;
  } catch {
    return null;
  }
}
