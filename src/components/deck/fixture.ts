// Synthetic run for the dev preview and the tests. Every name is invented and every id is shaped
// 00000000-0000-4000-8000-0000000000NN. Nothing here came from Qloo, and no number about taste appears anywhere.
//
// Id plan (so nothing collides with the chart mock, which uses tag ids 01 to 21): seed ids 22 to 27, seed entity
// ids 28 to 33, replacement calibration picks 34 to 39, shown picks 71 to 99.

import { BANDS, FIELDS } from "@/types";
import type { Band, Field, TraceEvent } from "@/types";
import { MOCK_AXES } from "@/components/chart/mock";
import type { PathHop } from "@/types";
import type { ProfileSeed, Profile, PublicDomain, PublicPick, PublicRunResult, RunInputs, RunPlan } from "./types";

export const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const SEED_NAMES: Record<Field, string> = {
  music: "Paper Lanterns",
  film: "The Glass Orchard",
  tv: "Night Ledger",
  books: "Salt Atlas",
  food_places: "Harbour Table",
  fashion: "Indigo Thread",
};

export const FIXTURE_SEEDS: ProfileSeed[] = FIELDS.map((field, i) => ({
  id: uid(22 + i),
  field,
  typed: SEED_NAMES[field],
  why: "It leaves room around each part.",
  qlooId: uid(28 + i),
  status: "clean",
}));

const profile = (): Profile => ({
  seedIds: FIXTURE_SEEDS.map((s) => s.id),
  skippedSeeds: [],
  fields: [...FIELDS],
  tags: MOCK_AXES.flatMap((a) => a.tags),
  bridgeTagIds: [],
  droppedGenericCount: 0,
  droppedAxisTagTypes: [],
  naming: {},
});

export const FIXTURE_INPUTS: RunInputs = { seeds: FIXTURE_SEEDS, profile: profile(), axes: MOCK_AXES };

const ADJ = ["Amber", "Brindle", "Cinder", "Dovetail", "Ember", "Fallow", "Gilt", "Hollow", "Ivory", "Juniper"];
const NOUN = ["Study", "Harbour", "Ledger", "Orchard", "Vessel", "Atlas", "Cabinet", "Almanac", "Chorus", "Lantern"];
export const fixtureName = (i: number) => `${ADJ[i % 10]} ${NOUN[(i * 7 + Math.floor(i / 10)) % 10]}`;

const THEMES = ["Quiet rooms and slow mornings", "Visible labor and worn materials", "Grey shoreline and fog", "Elegy and faded photographs", "Daily practice and looping forms", "Spare composition and negative space"];
const FIELD_PHRASE: Record<Field, string> = {
  music: "a recording",
  film: "a film",
  tv: "a series",
  books: "a book",
  food_places: "a place to eat",
  fashion: "a label",
};

interface Spec {
  /** Entity number (71 to 99 for shown picks). */
  n: number;
  field: Field;
  band: Band;
  /** Index into FIELDS of the seed the path starts from. */
  seedField: Field;
  lineage?: "qloo" | "wikidata";
}

function makePick({ n, field, band, seedField, lineage }: Spec): PublicPick {
  const seed = FIXTURE_SEEDS[FIELDS.indexOf(seedField)];
  const axis = MOCK_AXES[n % MOCK_AXES.length];
  const tagId = axis.tags[0].tag;
  const name = fixtureName(n);
  const theme = THEMES[n % THEMES.length];
  const hops: PathHop[] = [
    { kind: "seed", label: seed.typed, provenance: "inferred" },
    { kind: "theme", label: theme, tags: [tagId], provenance: "inferred" },
  ];
  if (lineage === "qloo") hops.push({ kind: "lineage", label: `Qloo lists ${name} as having influenced ${seed.typed}.`, provenance: "sourced", sourceUrl: "https://example.org/mock/qloo", sourceLabel: "Qloo" });
  if (lineage === "wikidata") hops.push({ kind: "lineage", label: `${name} is based on a work in the same tradition as ${seed.typed}.`, provenance: "sourced", sourceUrl: "https://example.org/mock/wikidata" });
  hops.push({ kind: "pick", label: name, provenance: "inferred" });
  const path = {
    seedId: seed.id,
    anchor: { contribution: null, source: "tag_overlap" as const },
    hops,
    sharedTags: [tagId],
    distinctive: lineage !== undefined,
    distance: field === seedField ? [] : (["other_field" as const]),
  };
  return {
    id: `pick-${uid(n)}`,
    qlooId: uid(n),
    name,
    field,
    band,
    llmBridged: false,
    origin: "unknown",
    path,
    card: {
      path,
      why: `You said ${seed.typed} works because it leaves room around each part. ${name} shares the theme ${theme.toLowerCase()}, which is the same instinct in ${FIELD_PHRASE[field]}.`,
      different: `It sits in ${FIELD_PHRASE[field]}, and the experience runs through a different form than ${seed.typed}.`,
      provenance: { sourced: lineage ? 1 : 0, inferred: 1 },
    },
  };
}

// Calibration: one same-field pick and, for some fields, one from another field. Edges: three degrees.
const SPECS: Spec[] = [
  { n: 71, field: "music", band: "calibration", seedField: "music" },
  { n: 72, field: "music", band: "calibration", seedField: "film" },
  { n: 73, field: "music", band: "moderate", seedField: "tv" },
  { n: 74, field: "music", band: "high", seedField: "books", lineage: "qloo" },
  { n: 75, field: "music", band: "high", seedField: "fashion" },
  { n: 76, field: "music", band: "extreme", seedField: "food_places" },
  { n: 77, field: "film", band: "calibration", seedField: "film" },
  { n: 78, field: "film", band: "moderate", seedField: "music" },
  { n: 79, field: "film", band: "high", seedField: "books", lineage: "wikidata" },
  { n: 80, field: "film", band: "extreme", seedField: "fashion" },
  { n: 81, field: "tv", band: "calibration", seedField: "film" },
  { n: 82, field: "tv", band: "moderate", seedField: "tv" },
  { n: 83, field: "tv", band: "high", seedField: "music" },
  { n: 84, field: "books", band: "calibration", seedField: "books" },
  { n: 85, field: "books", band: "calibration", seedField: "tv" },
  { n: 86, field: "books", band: "moderate", seedField: "film" },
  { n: 87, field: "books", band: "moderate", seedField: "music" },
  { n: 88, field: "books", band: "high", seedField: "fashion" },
  { n: 89, field: "books", band: "extreme", seedField: "food_places", lineage: "qloo" },
  { n: 90, field: "food_places", band: "calibration", seedField: "food_places" },
  { n: 91, field: "food_places", band: "moderate", seedField: "books" },
  { n: 92, field: "food_places", band: "high", seedField: "music" },
  { n: 93, field: "food_places", band: "extreme", seedField: "film", lineage: "wikidata" },
];

const NOTES: Partial<Record<Field, string>> = {
  tv: "Only a few shows connected closely enough to your list, so this deck is short.",
  fashion: "Nothing could be fetched for fashion this time.",
};

/**
 * A run result. With `variant: "again"` each field's calibration pick is a different one (what a "not me"
 * re-run brings back), and the shown edge picks are unchanged.
 */
export function makeFixtureResult(variant: "first" | "again" = "first"): PublicRunResult {
  const again = variant === "again";
  const domains: PublicDomain[] = FIELDS.map((field, fi): PublicDomain => {
    const specs = SPECS.filter((s) => s.field === field).map((s) => (again && s.band === "calibration" ? { ...s, n: 34 + fi } : s));
    const picks = specs.map(makePick);
    const byBand = Object.fromEntries(BANDS.map((b) => [b, picks.filter((p) => p.band === b)])) as Record<Band, PublicPick[]>;
    const unavailable = field === "fashion";
    const thin = field === "tv";
    return {
      domain: field,
      status: unavailable ? "unavailable" : thin ? "thin" : "ok",
      picks: BANDS.flatMap((b) => byBand[b]),
      byBand,
      emptyBands: BANDS.filter((b) => byBand[b].length === 0 && !unavailable),
      thin,
      ...(NOTES[field] ? { note: NOTES[field] } : {}),
    };
  });
  return { domains, plan: FIXTURE_PLAN, meta: { requeries: [], notRequeried: [] } };
}

export const FIXTURE_PLAN: RunPlan = {
  themes: FIELDS.map((domain, i) => ({ domain, axisId: MOCK_AXES[i % MOCK_AXES.length].id, reason: "A theme the seeds share." })),
  requeries: [],
};

const T0 = Date.UTC(2026, 9, 20, 12, 0, 0);
const at = (n: number) => new Date(T0 + n * 1200).toISOString();

type WithoutTime<E> = E extends unknown ? Omit<E, "t"> : never;

/** The events of a run as the browser receives them: public, so `score` has no popularity summary. */
export function makeFixtureTrace(): TraceEvent[] {
  const events: TraceEvent[] = [];
  let i = 0;
  const push = (e: WithoutTime<TraceEvent>) => events.push({ ...e, t: at(i++) } as TraceEvent);
  FIELDS.forEach((field, fi) => {
    const axis = MOCK_AXES[fi % MOCK_AXES.length];
    push({ kind: "choose_theme", say: "Chose a theme", themeTags: [axis.tags[0].tag], reason: `The shared theme runs through ${axis.label.toLowerCase()}.` });
    push({ kind: "qloo_call", say: "Asked for insights", endpoint: "/v2/insights", method: "POST", cached: false, entityType: field, status: 200 });
    push({ kind: "query_insights", say: "Queried a field", domain: field, endpoint: "/v2/insights", params: { "filter.popularity.max": "limited" }, resultCount: 50, explainability: true, primaryCount: 50, backfillCount: 0 });
    push({ kind: "score", say: "Scored a pool", domain: field, scored: 50, clearedFloor: 20 });
    if (field === "tv") push({ kind: "requery", say: "Asked again for less familiar results", domain: field, reason: "too_obvious", paramChanges: { "filter.popularity.max": "tightened" } });
    if (field === "tv") push({ kind: "relax", say: "Showing a nearer degree", relaxed: "reach_band", from: "extreme", to: "high", reason: "Nothing connected strongly enough." });
  });
  push({ kind: "fetch_refs", say: "Looked for lineage", pickIds: [], sourcedCount: 2, inferredCount: 0 });
  for (const p of makeFixtureResult().domains.flatMap((d) => d.picks).slice(0, 6)) push({ kind: "explain", say: "Wrote a card", pickId: p.id });
  return events;
}
