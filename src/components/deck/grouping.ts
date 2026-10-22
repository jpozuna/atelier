// What the picks screen shows, derived from the run result. Pure: no React, no storage, no network.
//
//  - Calibration picks (very close to something the person named) come first: same field as their seed, then
//    another field. The person can set one aside ("not me").
//  - Edge picks are shown as one list (T-25); the per-field decks here are what the list and the field filter read.
//  - Hiding a field takes its deck, its calibration picks and its marks off the screen. The result is not touched,
//    so hiding and showing again make no call.
//  - Nothing here reads or produces a score, a rank or a percentage.

import { BANDS, FIELDS } from "@/types";
import type { Band, Field, Path, Pick } from "@/types";
import { BAND_CHART_REACH, CHART_NEUTRAL_CONNECTION, CHART_STRENGTH_CONNECTION } from "@/lib/agent/config";
import type { ProfileSeed, PublicDomain, PublicPick, PublicRunResult } from "./types";

export const EDGE_BANDS = ["moderate", "high", "extreme"] as const satisfies readonly Band[];
export type EdgeBand = (typeof EDGE_BANDS)[number];

/** Plain words for a degree. A word, not a measure. */
export const DEGREE_WORD: Record<Band, string> = {
  calibration: "Very close",
  moderate: "Moderate",
  high: "High",
  extreme: "Extreme",
};

export type CalibrationScope = "same_field" | "other_field";

export interface CalibrationItem {
  pick: PublicPick;
  /** Same field as the seed the path starts from, or another one. Null when the seed is not in the list. */
  scope: CalibrationScope | null;
  /** The seed's name as the path states it. */
  seedLabel: string | null;
}

export interface EdgeDeck {
  field: Field;
  status: PublicDomain["status"];
  /** A fixed sentence from the server when the field is thin, empty or unavailable. */
  note?: string;
  hidden: boolean;
  /** Moderate, high, then extreme: all three degrees together. Empty when hidden. */
  picks: PublicPick[];
  /** Degrees with no pick of their own in this field. */
  emptyBands: EdgeBand[];
}

export interface View {
  calibration: CalibrationItem[];
  decks: EdgeDeck[];
  /** Everything visible, calibration first. Unique by id. */
  picks: PublicPick[];
  byId: Map<string, PublicPick>;
}

const SCOPE_ORDER: Record<CalibrationScope, number> = { same_field: 0, other_field: 1 };

function calibrationItems(domains: readonly PublicDomain[], hidden: ReadonlySet<Field>, notMe: ReadonlySet<string>, seeds: readonly ProfileSeed[]): CalibrationItem[] {
  const fieldOfSeed = new Map(seeds.map((s) => [s.id, s.field] as const));
  const items: CalibrationItem[] = [];
  for (const d of domains) {
    if (hidden.has(d.domain)) continue;
    for (const pick of d.byBand.calibration) {
      if (notMe.has(pick.qlooId)) continue;
      const seedField = fieldOfSeed.get(pick.path.seedId);
      const seedHop = pick.path.hops.find((h) => h.kind === "seed");
      items.push({
        pick,
        scope: seedField === undefined ? null : seedField === pick.field ? "same_field" : "other_field",
        seedLabel: seedHop?.label ?? null,
      });
    }
  }
  const rank = (i: CalibrationItem) => (i.scope === null ? 2 : SCOPE_ORDER[i.scope]);
  // Stable: field order within a scope is kept.
  return items.map((item, index) => ({ item, index })).sort((a, b) => rank(a.item) - rank(b.item) || a.index - b.index).map((x) => x.item);
}

function edgeDeck(d: PublicDomain, hidden: boolean, notMe: ReadonlySet<string>): EdgeDeck {
  const deck: EdgeDeck = {
    field: d.domain,
    status: d.status,
    hidden,
    picks: hidden ? [] : EDGE_BANDS.flatMap((b) => d.byBand[b].filter((p) => !notMe.has(p.qlooId))),
    emptyBands: EDGE_BANDS.filter((b) => d.byBand[b].length === 0 || d.emptyBands.includes(b)),
  };
  if (d.note) deck.note = d.note;
  return deck;
}

/** Everything the screen renders from a result. Same inputs give the same view. */
export function buildView(result: PublicRunResult | null, opts: { hidden: readonly Field[]; notMe: readonly string[]; seeds: readonly ProfileSeed[] }): View {
  if (!result) return { calibration: [], decks: [], picks: [], byId: new Map() };
  const hidden = new Set(opts.hidden);
  const notMe = new Set(opts.notMe);
  const calibration = calibrationItems(result.domains, hidden, notMe, opts.seeds);
  const decks = result.domains.map((d) => edgeDeck(d, hidden.has(d.domain), notMe));
  const picks: PublicPick[] = [];
  const byId = new Map<string, PublicPick>();
  for (const p of [...calibration.map((c) => c.pick), ...decks.flatMap((d) => d.picks)]) {
    if (byId.has(p.id)) continue;
    byId.set(p.id, p);
    picks.push(p);
  }
  return { calibration, decks, picks, byId };
}
/**
 * A pick in the shape the chart takes. `/api/run` sends no reach, connection or popularity (hard rule 7), so the
 * chart's position comes from the pick's band. Its line weight comes from the pick's `strength` word (strong,
 * steady or light) mapped to a fixed weight, and is neutral for a pick with none (a calibration pick, or a result
 * stored before strength existed). The filler numbers are never displayed. They only place a mark and a line.
 */
export function toChartPick(p: PublicPick): Pick {
  const reach = BAND_CHART_REACH[p.band];
  return {
    id: p.id,
    qlooId: p.qlooId,
    name: p.name,
    field: p.field,
    popularity: 0,
    reach: { tagDistance: reach, obscurity: reach, fieldUnfamiliarity: reach, reach },
    connection: p.strength ? CHART_STRENGTH_CONNECTION[p.strength] ?? CHART_NEUTRAL_CONNECTION : CHART_NEUTRAL_CONNECTION,
    band: p.band,
    llmBridged: p.llmBridged,
    origin: p.origin,
    path: p.path as Path,
    card: p.card,
  };
}

const byBandOrder = (picks: PublicPick[]): PublicPick[] => BANDS.flatMap((b) => picks.filter((p) => p.band === b));

/**
 * A "not me" re-run answers for the affected fields only. Their calibration picks are refreshed (the ones set
 * aside go, new ones fill in, never more than the field had); their edge picks stay exactly as they were, so a
 * field never shows more edge picks than it did before and the edge total stays within the run's cap (T-23: at
 * most 20, no field above its share). Edge picks in the response are not merged in. Every other field keeps what
 * the person already has, whatever the response holds for it.
 */
export function mergeRerun(prev: PublicRunResult, incoming: PublicRunResult, affected: readonly Field[], notMe: readonly string[]): PublicRunResult {
  const aside = new Set(notMe);
  const refreshed = new Set<Field>();
  const domains = prev.domains.map((d): PublicDomain => {
    if (!affected.includes(d.domain)) return d;
    const next = incoming.domains.find((x) => x.domain === d.domain);
    if (!next || next.status === "unavailable") return d;
    refreshed.add(d.domain);
    const kept = d.byBand.calibration.filter((p) => !aside.has(p.qlooId));
    const have = new Set(d.picks.map((p) => p.qlooId));
    const fresh = next.byBand.calibration.filter((p) => !aside.has(p.qlooId) && !have.has(p.qlooId));
    const calibration = [...kept, ...fresh].slice(0, Math.max(d.byBand.calibration.length, 1));
    const byBand: Record<Band, PublicPick[]> = { ...d.byBand, calibration };
    const edgeCount = EDGE_BANDS.reduce((n, b) => n + byBand[b].length, 0);
    const out: PublicDomain = {
      ...d,
      byBand,
      picks: byBandOrder(BANDS.flatMap((b) => byBand[b])),
      status: edgeCount > 0 || calibration.length > 0 ? (d.status === "unavailable" || d.status === "empty" ? next.status : d.status) : next.status,
    };
    if (d.status === "unavailable" || d.status === "empty") {
      if (next.note) out.note = next.note;
      else delete out.note;
    }
    return out;
  });
  // The plan and the meta are merged per field too, so a partial plan can never be stored: a field that was not
  // refreshed keeps what the earlier run recorded for it.
  const mine = <T extends { domain: Field }>(prevList: readonly T[], nextList: readonly T[]): T[] => [
    ...prevList.filter((x) => !refreshed.has(x.domain)),
    ...nextList.filter((x) => refreshed.has(x.domain)),
  ];
  const plan: PublicRunResult["plan"] = {
    themes: FIELDS.flatMap((f) => mine(prev.plan.themes, incoming.plan.themes).filter((t) => t.domain === f)),
    requeries: mine(prev.plan.requeries, incoming.plan.requeries),
  };
  const meta: PublicRunResult["meta"] = {
    requeries: mine(prev.meta.requeries, incoming.meta.requeries),
    notRequeried: mine(prev.meta.notRequeried, incoming.meta.notRequeried),
  };
  return { domains, plan, meta };
}

/** Fields a "not me" on this pick affects. The pick came from one field's pool, so that is the one to refresh. */
export function affectedFields(pick: { field: Field }): Field[] {
  return [pick.field];
}

/** Add or remove a field from the hidden list, keeping field order. Pure; never touches the result. */
export function toggleHidden(hidden: readonly Field[], field: Field): Field[] {
  const set = new Set(hidden);
  if (set.has(field)) set.delete(field);
  else set.add(field);
  return FIELDS.filter((f) => set.has(f));
}

/** The seed and theme of a pick as its path states them, for the one-line hint on a tile. Null parts are omitted. */
export function pathHint(p: Pick["path"] | PublicPick["path"]): { seed: string | null; theme: string | null } {
  return {
    seed: p.hops.find((h) => h.kind === "seed")?.label ?? null,
    theme: p.hops.find((h) => h.kind === "theme")?.label ?? null,
  };
}
