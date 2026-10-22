import { BANDS, FIELDS, ORIGINS, PROVENANCES } from './field';
import type { Band, Field, Origin, Provenance } from './field';
import { HOP_KINDS, ANCHOR_SOURCES, DISTANCE_HINTS } from './path';
import type { Path, PathHop } from './path';
import { REACTION_STATES } from './card';
import type { Card } from './card';
import { PROFILE_TAG_SOURCES } from './profile';
import type { Axis, ProfileTag } from './profile';
import { SEED_STATUSES } from './seed';
import type { Seed, SeedStatus } from './seed';
import { QLOO_ENDPOINTS, REQUERY_REASONS, TRACE_EVENT_KINDS } from './trace';
import type { TraceEvent, TraceEventKind } from './trace';

type Rec = Record<string, unknown>;

const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
const isStrArr = (v: unknown): v is string[] => Array.isArray(v) && v.every(isStr);
const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T =>
  isStr(v) && (list as readonly string[]).includes(v);

export const isField = (v: unknown): v is Field => oneOf(FIELDS, v);
export const isBand = (v: unknown): v is Band => oneOf(BANDS, v);
export const isProvenance = (v: unknown): v is Provenance => oneOf(PROVENANCES, v);
export const isOrigin = (v: unknown): v is Origin => oneOf(ORIGINS, v);
export const isSeedStatus = (v: unknown): v is SeedStatus => oneOf(SEED_STATUSES, v);

export function isSeed(v: unknown): v is Seed {
  if (!isRec(v)) return false;
  if (!isStr(v.id) || !isField(v.field) || !isStr(v.typed) || !isStr(v.why)) return false;
  if (!isSeedStatus(v.status)) return false;
  if (!(v.qlooId === null || isStr(v.qlooId))) return false;
  if (v.status === 'clean' && v.qlooId === null) return false;
  if (v.candidates !== undefined) {
    if (!Array.isArray(v.candidates)) return false;
    if (!v.candidates.every((c) => isRec(c) && isStr(c.qlooId) && isStr(c.label))) return false;
  }
  if (v.status === 'ambiguous' && !(Array.isArray(v.candidates) && v.candidates.length > 1)) return false;
  return true;
}

export function isProfileTag(v: unknown): v is ProfileTag {
  return (
    isRec(v) &&
    isStr(v.tag) &&
    isStr(v.name) &&
    isStr(v.tagType) &&
    isNum(v.affinity) &&
    isStrArr(v.types) &&
    isNum(v.weight) &&
    Array.isArray(v.fields) &&
    v.fields.every(isField) &&
    oneOf(PROFILE_TAG_SOURCES, v.source) &&
    (v.bridge === undefined || isBool(v.bridge)) &&
    (v.rarity === undefined || isNum(v.rarity))
  );
}

/** An axis needs at least 2 member tags (docs/DECISIONS.md, axes). */
export function isAxis(v: unknown): v is Axis {
  return (
    isRec(v) &&
    isStr(v.id) &&
    isStr(v.label) &&
    isStr(v.labelJustification) &&
    isNum(v.weight) &&
    isStr(v.tagType) &&
    Array.isArray(v.tags) &&
    v.tags.length >= 2 &&
    v.tags.every(isProfileTag)
  );
}

export function isPathHop(v: unknown): v is PathHop {
  if (!isRec(v)) return false;
  if (!oneOf(HOP_KINDS, v.kind) || !isStr(v.label) || !isProvenance(v.provenance)) return false;
  if (v.tags !== undefined && !isStrArr(v.tags)) return false;
  if (v.sourceUrl !== undefined && !isStr(v.sourceUrl)) return false;
  // A sourced hop must carry the link it was retrieved from.
  if (v.provenance === 'sourced' && !(isStr(v.sourceUrl) && v.sourceUrl.length > 0)) return false;
  return true;
}

/** Hops run seed, theme, optional lineage, pick, in that order. */
export function isPath(v: unknown): v is Path {
  if (!isRec(v) || !isStr(v.seedId) || !isStrArr(v.sharedTags) || !isBool(v.distinctive)) return false;
  if (v.pickOnlyTags !== undefined && !(isStrArr(v.pickOnlyTags) && v.pickOnlyTags.length <= 3)) return false;
  if (v.distance !== undefined && !(Array.isArray(v.distance) && v.distance.every((d) => oneOf(DISTANCE_HINTS, d)))) return false;
  const a = v.anchor;
  if (!isRec(a) || !oneOf(ANCHOR_SOURCES, a.source)) return false;
  if (!(a.contribution === null || isNum(a.contribution))) return false;
  if (a.thin !== undefined && !isBool(a.thin)) return false;
  if (!Array.isArray(v.hops) || !v.hops.every(isPathHop)) return false;
  const hops = v.hops as PathHop[];
  // Lineage comes only from retrieved text (hard rule 6), so a lineage hop is always sourced.
  if (hops.some((h) => h.kind === 'lineage' && h.provenance !== 'sourced')) return false;
  const kinds = hops.map((h) => h.kind).join('>');
  return kinds === 'seed>theme>pick' || kinds === 'seed>theme>lineage>pick';
}

export function isCard(v: unknown): v is Card {
  if (!isRec(v) || !isPath(v.path) || !isStr(v.why) || !isStr(v.different)) return false;
  const p = v.provenance;
  if (!isRec(p) || !isCount(p.sourced) || !isCount(p.inferred)) return false;
  if (v.reading !== undefined) {
    const r = v.reading;
    if (!isRec(r) || !isStr(r.text) || !isStr(r.sourceUrl) || r.sourceUrl.length === 0) return false;
  }
  if (v.reaction !== undefined) {
    const r = v.reaction;
    if (!isRec(r) || !oneOf(REACTION_STATES, r.state) || !isStr(r.at)) return false;
    if (r.words !== undefined && !isStr(r.words)) return false;
  }
  return true;
}

export const isTraceEventKind = (v: unknown): v is TraceEventKind => oneOf(TRACE_EVENT_KINDS, v);

/** Checks the base fields and the fields specific to each event kind. */
export function isTraceEvent(v: unknown): v is TraceEvent {
  if (!isRec(v) || !isStr(v.t) || !isStr(v.say) || !isTraceEventKind(v.kind)) return false;
  switch (v.kind) {
    case 'qloo_call':
      return (
        oneOf(QLOO_ENDPOINTS, v.endpoint) &&
        (v.method === 'GET' || v.method === 'POST') &&
        isBool(v.cached) &&
        (v.entityType === undefined || isStr(v.entityType)) &&
        (v.status === undefined || isNum(v.status))
      );
    case 'resolve_seed':
      return isStr(v.seedId) && isSeedStatus(v.status) && isNum(v.candidateCount);
    case 'extract_tags':
      return isField(v.field) && isNum(v.tagCount);
    case 'build_axes':
      return (
        isStrArr(v.axisIds) &&
        isRec(v.tagCounts) &&
        Object.values(v.tagCounts).every(isNum) &&
        (v.droppedGeneric === undefined || isNum(v.droppedGeneric)) &&
        (v.droppedTagTypes === undefined || isStrArr(v.droppedTagTypes)) &&
        (v.axisShortfall === undefined || isBool(v.axisShortfall)) &&
        (v.naming === undefined ||
          (isRec(v.naming) && Object.values(v.naming).every((n) => n === 'model' || n === 'fallback')))
      );
    case 'map_why':
      return (
        isStr(v.seedId) &&
        isStrArr(v.tagIds) &&
        isBool(v.semanticSearch) &&
        (v.failed === undefined || v.failed === 'budget' || v.failed === 'unavailable' || v.failed === 'error')
      );
    case 'choose_theme':
      return isStrArr(v.themeTags) && isStr(v.reason);
    case 'query_insights':
      return (
        isField(v.domain) &&
        oneOf(QLOO_ENDPOINTS, v.endpoint) &&
        isRec(v.params) &&
        isNum(v.resultCount) &&
        isBool(v.explainability) &&
        isNum(v.primaryCount) &&
        isNum(v.backfillCount)
      );
    case 'score': {
      const p = v.popularity;
      return (
        isField(v.domain) &&
        isNum(v.scored) &&
        isNum(v.clearedFloor) &&
        (p === undefined || (isRec(p) && isNum(p.min) && isNum(p.median) && isNum(p.max))) &&
        (v.obviousShare === undefined || (isNum(v.obviousShare) && v.obviousShare >= 0 && v.obviousShare <= 1))
      );
    }
    case 'requery':
      return isField(v.domain) && oneOf(REQUERY_REASONS, v.reason) && isRec(v.paramChanges);
    case 'fetch_refs':
      return (
        isStrArr(v.pickIds) &&
        isNum(v.sourcedCount) &&
        isNum(v.inferredCount) &&
        (v.sourceUrls === undefined || isStrArr(v.sourceUrls))
      );
    case 'relax':
      return v.relaxed === 'reach_band' && isBand(v.from) && isBand(v.to) && isStr(v.reason);
    case 'explain':
      return isStr(v.pickId);
    case 'cap':
      return (
        isNum(v.edgeShown) &&
        isNum(v.calibrationShown) &&
        (v.fieldLimit === 'share' || v.fieldLimit === 'fixed') &&
        isNum(v.trimmed) &&
        isRec(v.byBand) &&
        BANDS.every((b) => isNum((v.byBand as Rec)[b])) &&
        isRec(v.byField) &&
        Object.entries(v.byField).every(
          ([f, c]) => isField(f) && isRec(c) && isNum(c.edge) && isNum(c.calibration),
        )
      );
  }
}
