// Axis naming. The model sees only one axis's tags and may only name it from them. Code then checks the answer
// against the listed tags before accepting it; anything that fails falls back to a deterministic name built from
// the tag kind and the heaviest tag. The justification is stored with the axis.
//
// The check is strict and has no escape hatch: every label word must come from a listed tag name or the tag kind
// (never from "urn", "tag", the namespace, "media" or "qloo"), and every justification word must come from the
// tags, the kind, or a short connective allowlist. Words are matched exactly (no stemming), case and accents aside.

import {
  MAX_JUSTIFICATION_CHARS,
  MAX_LABEL_CHARS,
  MAX_LABEL_WORDS,
  MIN_CITED_NAME_CHARS,
  NAME_CACHE_MAX,
} from "@/lib/agent/config";
import { nameKey } from "./tags";
import type { NamingSource } from "./types";

export interface AxisNameInput {
  /** The Qloo tag type this axis groups, as returned (`urn:tag:<kind>:<namespace>`). */
  tagType: string;
  /** The tag kind (`urn:tag:` and the namespace stripped), for the prompt and the check. */
  kind: string;
  /** Member tag names, heaviest first. The model sees nothing else about the axis. */
  tagNames: readonly string[];
}

export interface AxisName {
  label: string;
  labelJustification: string;
}

/** Names one axis from its listed tags. Implementations may call a model; they must not add data. */
export interface AxisNamer {
  name(input: AxisNameInput): Promise<AxisName>;
}

/** `urn:tag:<kind>:<ns>[:<value>]` -> kind; otherwise the string itself. Underscores and dashes become spaces. */
export function tagKind(tagType: string): string {
  const parts = tagType.split(":");
  const kind = tagType.startsWith("urn:tag:") && parts[2] ? parts[2] : tagType;
  return kind.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

/** Connectives a label may use alongside content words. They never count as content. */
const LABEL_STOP = new Set(["a", "an", "the", "of", "and", "or", "in", "on", "for", "to", "with", "by", "at", "as"]);

/** Words a justification may use besides tag-name and kind words. */
export const JUSTIFICATION_CONNECTIVES: readonly string[] = [
  ...LABEL_STOP,
  "from", "is", "are", "both", "its", "their", "this", "that", "these", "those", "it", "they", "each", "all", "one", "two", "three",
  "name", "named", "label", "tag", "tags", "type", "kind", "follows", "drawn", "derived", "shared", "common", "together", "across",
  "heaviest", "top", "highest", "weight", "listed", "like", "such",
];
const CONNECTIVES = new Set(JUSTIFICATION_CONNECTIVES);

/** Words that never come from a kind: Qloo tag-id scaffolding and the two shared namespaces. */
const SCAFFOLD = new Set(["urn", "tag", "media", "qloo"]);

const LABEL_CHARS = /^[\p{L}\p{N}][\p{L}\p{N} '&:-]*$/u;
const JUSTIFICATION_CHARS = /^[\p{L}\p{N}\s.,;:'"&()-]+$/u;

/** Words of a string: accent-free, lower-case, split on anything that is not a letter or digit. No stemming. */
export function words(s: string): string[] {
  return nameKey(s).split(" ").filter(Boolean);
}

export interface NameCheck {
  ok: boolean;
  problems: string[];
}

/** Does `needle` occur in `haystack` as whole words (both normalised)? */
function mentions(haystack: string, needle: string): boolean {
  const n = nameKey(needle);
  return n.length > 0 && ` ${nameKey(haystack)} `.includes(` ${n} `);
}

/**
 * Accept an axis name only if all of these hold:
 * - the label is 1 to MAX_LABEL_WORDS words, within MAX_LABEL_CHARS, letters, digits, spaces and `' & : -` only,
 *   with at least one content word (not a connective), and every word is in a listed tag name or the kind;
 * - the justification is within MAX_JUSTIFICATION_CHARS, uses a restricted character set, cites at least two
 *   distinct listed tags by name (names shorter than MIN_CITED_NAME_CHARS are ignored; one if only one is
 *   citable), and every word is in a tag name, the kind, or the connective allowlist.
 */
export function checkAxisName(name: AxisName, input: Pick<AxisNameInput, "tagType" | "kind" | "tagNames">): NameCheck {
  const problems: string[] = [];
  const label = typeof name.label === "string" ? name.label.trim() : "";
  const just = typeof name.labelJustification === "string" ? name.labelJustification.trim() : "";
  const tagWords = new Set(input.tagNames.flatMap(words));
  const kindWords = new Set(words(input.kind).filter((w) => !SCAFFOLD.has(w)));
  const known = new Set<string>([...tagWords, ...kindWords]);

  const labelWords = words(label);
  if (!label) problems.push("empty label");
  else {
    if (!LABEL_CHARS.test(label)) problems.push("label has characters outside letters, digits, spaces and ' & : -");
    if (label.length > MAX_LABEL_CHARS) problems.push("label too long");
    if (labelWords.length < 1 || labelWords.length > MAX_LABEL_WORDS) problems.push(`label must be 1 to ${MAX_LABEL_WORDS} words`);
    if (!labelWords.some((w) => !LABEL_STOP.has(w))) problems.push("label has no content word");
    const outside = [...new Set(labelWords.filter((w) => !LABEL_STOP.has(w) && !known.has(w)))];
    if (outside.length) problems.push(`label words not in the listed tags or kind: ${outside.join(", ")}`);
  }

  if (!just) problems.push("no justification");
  else {
    if (!JUSTIFICATION_CHARS.test(just)) problems.push("justification has disallowed characters");
    if (just.length > MAX_JUSTIFICATION_CHARS) problems.push("justification too long");
    const citable = [...new Map(input.tagNames.filter((n) => nameKey(n).length >= MIN_CITED_NAME_CHARS).map((n) => [nameKey(n), n])).values()];
    const cited = citable.filter((n) => mentions(just, n));
    const need = Math.min(2, citable.length);
    if (cited.length < need) problems.push(`justification cites ${cited.length} distinct listed tags, needs ${need}`);
    const outside = [...new Set(words(just).filter((w) => !known.has(w) && !CONNECTIVES.has(w)))];
    if (outside.length) problems.push(`justification words not in the listed tags, kind or connectives: ${outside.join(", ")}`);
  }
  return { ok: problems.length === 0, problems };
}

const title = (s: string) => s.replace(/\b\p{L}/gu, (c) => c.toUpperCase());

/** Deterministic name: the tag kind plus the heaviest tag. Passes `checkAxisName` by construction. No model. */
export const fallbackNamer: AxisNamer = {
  async name(input) {
    const top = input.tagNames.slice(0, 3);
    const kindWords = words(input.kind).filter((w) => !SCAFFOLD.has(w));
    const kind = kindWords.join(" ");
    const room = MAX_LABEL_WORDS - kindWords.length;
    const headWords = (top[0] ?? "").split(/\s+/).filter(Boolean);
    const label =
      kind && room >= 1
        ? `${title(kind)}: ${headWords.slice(0, room).join(" ")}`
        : headWords.slice(0, MAX_LABEL_WORDS).join(" ");
    return {
      label: label.trim(),
      labelJustification: `Named from its tag type${kind ? ` ${kind}` : ""} and its heaviest tags: ${top.join(", ")}.`,
    };
  },
};

export interface NamedAxis extends AxisName {
  source: NamingSource;
  /** Internal only: why the primary namer's answer was not used. Never returned by the API. */
  reason?: string;
}

/** Bounded in-memory memory of model-named axes, keyed by the axis's sorted tag-id set. */
export interface NameCache {
  get(key: string): AxisName | undefined;
  set(key: string, name: AxisName): void;
}

export function createNameCache(max: number = NAME_CACHE_MAX): NameCache {
  const m = new Map<string, AxisName>();
  return {
    get: (k) => m.get(k),
    set(k, v) {
      m.delete(k);
      m.set(k, v);
      while (m.size > max) m.delete(m.keys().next().value as string);
    },
  };
}

export const nameCacheKey = (tagIds: readonly string[]) => [...new Set(tagIds)].sort().join("|");

/** Try the primary namer; accept its answer only if it passes `checkAxisName`, else use the fallback. */
export async function nameAxis(
  input: AxisNameInput,
  primary: AxisNamer,
  opts: { fallback?: AxisNamer; cache?: NameCache; cacheKey?: string } = {},
): Promise<NamedAxis> {
  const fallback = opts.fallback ?? fallbackNamer;
  let reason: string | undefined;
  if (primary !== fallback) {
    const hit = opts.cache && opts.cacheKey ? opts.cache.get(opts.cacheKey) : undefined;
    if (hit && checkAxisName(hit, input).ok) return { ...hit, source: "model" };
    try {
      const got = await primary.name(input);
      const check = checkAxisName(got, input);
      if (check.ok) {
        const named = { label: got.label.trim(), labelJustification: got.labelJustification.trim() };
        if (opts.cache && opts.cacheKey) opts.cache.set(opts.cacheKey, named);
        return { ...named, source: "model" };
      }
      reason = check.problems.join("; ");
    } catch (err) {
      reason = `namer error: ${err instanceof Error ? err.message : "unknown"}`;
    }
  }
  const got = await fallback.name(input);
  return { label: got.label.trim(), labelJustification: got.labelJustification.trim(), source: "fallback", ...(reason ? { reason } : {}) };
}

/** Run `fn` over `items` with at most `limit` in flight, keeping result order. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
