// Pure checks for the comparison, shared by the route and the screen. No React, no storage, no network.
//  - parseCompareRequest: the request body, reduced to the user's own words (field, typed, why) and the fields asked for.
//  - cleanPlainPicks: the model's reply, kept only when it is names and one plain line each. A pick that carries an id,
//    a link, a number in its reason, or anything that reads as a score is dropped (hard rule 7: no taste scores).

import { FIELDS, isField } from "@/types";
import type { Field } from "@/types";
import { COMPARE_MAX_NAME_CHARS, COMPARE_MAX_PLAIN_WHY_CHARS, COMPARE_PICKS_PER_FIELD, MAX_QUERY_LENGTH, MAX_SEEDS_PER_USER, MAX_WHY_CHARS } from "@/lib/agent/config";
import type { CompareRequest, CompareSeed, PlainPick } from "./types";

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** One line: control characters out, runs of whitespace collapsed, trimmed. */
export function oneLine(s: string): string {
  return s.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
}

export type ParsedRequest = { ok: true; value: CompareRequest } | { ok: false };

/**
 * Only `field`, `typed` and `why` of each seed are read, so ids, candidates and tags a client sends along never reach
 * the model. Fields come back unique and in the product's field order.
 */
export function parseCompareRequest(body: unknown): ParsedRequest {
  if (!isRec(body) || !Array.isArray(body.seeds) || !Array.isArray(body.fields)) return { ok: false };
  if (body.seeds.length < 1 || body.seeds.length > MAX_SEEDS_PER_USER) return { ok: false };
  const seeds: CompareSeed[] = [];
  for (const s of body.seeds) {
    if (!isRec(s) || !isField(s.field) || typeof s.typed !== "string" || typeof s.why !== "string") return { ok: false };
    const typed = oneLine(s.typed);
    const why = oneLine(s.why);
    if (typed.length === 0 || typed.length > MAX_QUERY_LENGTH || why.length > MAX_WHY_CHARS) return { ok: false };
    seeds.push({ field: s.field, typed, why });
  }
  if (body.fields.length < 1 || body.fields.length > FIELDS.length || !body.fields.every(isField)) return { ok: false };
  const asked = new Set<Field>(body.fields as Field[]);
  const fields = FIELDS.filter((f) => asked.has(f));
  return { ok: true, value: { seeds, fields } };
}

// A link, a Qloo-style id, a long hex run: none belongs in a list that has no source.
const ID_LIKE = /urn:|https?:|www\.|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}|\b[0-9a-f]{16,}\b/i;
// A bare domain or a path on one (example.com/x) in a reason: that is a source in all but name. Names may hold dots (Last.fm).
const DOMAIN_LIKE = /\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|org|net|io|co|edu|gov|info|app|dev|uk|us|fm|tv|me|ly|xyz|ai|fr|de)\b|\w\.\w+\//i;
// Anything in a reason that reads as a score, a rank or a percentage. A title may say "Ranking Member": names are not checked.
const SCORE_LIKE = /%|\d\s*\/\s*\d|\bout of\b|\b(score|scores|scored|rating|ratings|rated|rank|ranks|ranked|ranking|stars?|percent|percentage|match(es)? you)\b/i;
const HAS_DIGIT = /\d/;

const norm = (s: string) => oneLine(s).toLowerCase();

/**
 * True when a name or a reason may be shown. Both: no id, link or `urn:`. Names may hold digits and dots (titles do).
 * A reason may not hold a digit, a bare domain, or anything that reads as a score, rank or percentage.
 */
export function isCleanText(text: string, kind: "name" | "why"): boolean {
  if (ID_LIKE.test(text)) return false;
  if (kind === "name") return true;
  return !SCORE_LIKE.test(text) && !DOMAIN_LIKE.test(text) && !HAS_DIGIT.test(text);
}

/**
 * The picks of a model reply that pass: a requested field, a name, one plain line, nothing that looks like an id, a link
 * or a score. Not the user's own seeds, no repeated name, at most COMPARE_PICKS_PER_FIELD per field. Never padded.
 * Output order is field order, then the model's order.
 */
export function cleanPlainPicks(raw: unknown, ask: CompareRequest): PlainPick[] {
  const list = isRec(raw) && Array.isArray(raw.picks) ? raw.picks : [];
  const named = new Set(ask.seeds.map((s) => norm(s.typed)));
  const seen = new Set<string>();
  const perField = new Map<Field, PlainPick[]>(ask.fields.map((f) => [f, []]));
  for (const item of list) {
    if (!isRec(item) || typeof item.name !== "string" || typeof item.why !== "string" || !isField(item.field)) continue;
    const bucket = perField.get(item.field);
    if (!bucket || bucket.length >= COMPARE_PICKS_PER_FIELD) continue;
    const name = oneLine(item.name);
    const why = oneLine(item.why);
    if (!name || !why || name.length > COMPARE_MAX_NAME_CHARS || why.length > COMPARE_MAX_PLAIN_WHY_CHARS) continue;
    if (!isCleanText(name, "name") || !isCleanText(why, "why")) continue;
    const key = norm(name);
    if (named.has(key) || seen.has(key)) continue;
    seen.add(key);
    bucket.push({ name, field: item.field, why });
  }
  return ask.fields.flatMap((f) => perField.get(f) ?? []);
}

/** A reply read back from the route (or from storage): the same shape check, with no request to compare against. */
export function readPlainPicks(raw: unknown): PlainPick[] | null {
  if (!isRec(raw) || !Array.isArray(raw.picks)) return null;
  const out: PlainPick[] = [];
  for (const item of raw.picks) {
    if (!isRec(item) || typeof item.name !== "string" || typeof item.why !== "string" || !isField(item.field)) return null;
    const name = oneLine(item.name);
    const why = oneLine(item.why);
    if (!name || name.length > COMPARE_MAX_NAME_CHARS || why.length > COMPARE_MAX_PLAIN_WHY_CHARS) return null;
    if (!isCleanText(name, "name") || !isCleanText(why, "why")) return null;
    out.push({ name, field: item.field, why });
  }
  return out.length > 0 && out.length <= FIELDS.length * COMPARE_PICKS_PER_FIELD ? out : null;
}
