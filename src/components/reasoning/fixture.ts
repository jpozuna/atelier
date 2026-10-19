import type { TraceEvent } from "@/types";

/**
 * Synthetic trace for building and testing the reasoning panel. Invented names and ids only
 * (ids shaped 00000000-0000-4000-8000-0000000000NN). Not Qloo data.
 */

export const FIXTURE_SEED_NAMES: Record<string, string> = {
  "00000000-0000-4000-8000-000000000001": "Fixture Album A",
  "00000000-0000-4000-8000-000000000002": "Fixture Film B",
  "00000000-0000-4000-8000-000000000003": "Fixture Novel C",
};

export const FIXTURE_PICK_NAMES: Record<string, string> = {
  "00000000-0000-4000-8000-000000000011": "Fixture Pick X",
  "00000000-0000-4000-8000-000000000012": "Fixture Pick Y",
};

const T0 = Date.UTC(2026, 9, 19, 12, 0, 0);
const at = (n: number) => new Date(T0 + n * 1500).toISOString();

const SEED_A = "00000000-0000-4000-8000-000000000001";
const SEED_B = "00000000-0000-4000-8000-000000000002";
const SEED_C = "00000000-0000-4000-8000-000000000003";
const PICK_X = "00000000-0000-4000-8000-000000000011";
const PICK_Y = "00000000-0000-4000-8000-000000000012";
const TAG_1 = "00000000-0000-4000-8000-000000000021";
const TAG_2 = "00000000-0000-4000-8000-000000000022";

/** Covers every event kind, a cached call, a repeated call, each re-query reason, a relaxed band and an ambiguous seed. */
export const FIXTURE_TRACE: TraceEvent[] = [
  { t: at(0), kind: "qloo_call", say: "Searching for the first seed", endpoint: "/search", method: "GET", cached: false, status: 200 },
  { t: at(1), kind: "qloo_call", say: "Searching for the second seed", endpoint: "/search", method: "GET", cached: false, status: 200 },
  { t: at(2), kind: "qloo_call", say: "Searching for the third seed (cached)", endpoint: "/search", method: "GET", cached: true },
  { t: at(3), kind: "resolve_seed", say: "Resolved the first seed", seedId: SEED_A, status: "clean", candidateCount: 1 },
  { t: at(4), kind: "resolve_seed", say: "The second seed is ambiguous", seedId: SEED_B, status: "ambiguous", candidateCount: 3 },
  { t: at(5), kind: "resolve_seed", say: "The third seed was not found", seedId: SEED_C, status: "missing", candidateCount: 0 },
  { t: at(6), kind: "extract_tags", say: "Read tags for music", field: "music", tagCount: 14 },
  { t: at(7), kind: "build_axes", say: "Built axes", axisIds: ["axis-1", "axis-2"], tagCounts: { "axis-1": 6, "axis-2": 8 } },
  { t: at(8), kind: "map_why", say: "Mapped the why", seedId: SEED_A, tagIds: [TAG_1, TAG_2], semanticSearch: true },
  {
    t: at(9),
    kind: "choose_theme",
    say: "Chose a theme",
    themeTags: [TAG_1],
    reason: "Your reason mentions slow, patient pacing, and that theme is shared by entries outside music.",
  },
  { t: at(10), kind: "qloo_call", say: "Asking for insights", endpoint: "/v2/insights", method: "POST", cached: false, entityType: "film", status: 200 },
  {
    t: at(11),
    kind: "query_insights",
    say: "Queried film",
    domain: "film",
    endpoint: "/v2/insights",
    params: { "signal.interests.tags": TAG_1, "filter.type": "film" },
    resultCount: 50,
    explainability: true,
    primaryCount: 50,
    backfillCount: 0,
  },
  { t: at(12), kind: "score", say: "Scored film", domain: "film", scored: 50, clearedFloor: 9, popularity: { min: 0.1, median: 0.7, max: 0.95 } },
  { t: at(13), kind: "requery", say: "Asking again", domain: "film", reason: "too_obvious", paramChanges: { "filter.popularity.max": 0.4 } },
  { t: at(14), kind: "qloo_call", say: "Asking for insights again", endpoint: "/v2/insights", method: "POST", cached: false, entityType: "film", status: 200 },
  {
    t: at(15),
    kind: "query_insights",
    say: "Queried film again",
    domain: "film",
    endpoint: "/v2/insights",
    params: { "filter.popularity.max": 0.4 },
    resultCount: 40,
    explainability: true,
    primaryCount: 40,
    backfillCount: 0,
  },
  { t: at(16), kind: "score", say: "Scored film again", domain: "film", scored: 40, clearedFloor: 12, popularity: { min: 0.05, median: 0.3, max: 0.4 } },
  { t: at(17), kind: "requery", say: "Books came back thin", domain: "books", reason: "too_weak", paramChanges: { "signal.interests.tags": TAG_2 } },
  { t: at(18), kind: "requery", say: "Nothing in food", domain: "food_places", reason: "empty", paramChanges: { "filter.popularity.max": 0.6 } },
  { t: at(19), kind: "requery", say: "Fashion shared nothing distinctive", domain: "fashion", reason: "weak_connection", paramChanges: { "filter.exclude.tags": [TAG_1] } },
  { t: at(20), kind: "score", say: "Nothing cleared in extreme", domain: "tv", scored: 30, clearedFloor: 0, popularity: { min: 0.2, median: 0.5, max: 0.8 } },
  { t: at(21), kind: "relax", say: "Relaxed extreme to high", relaxed: "reach_band", from: "extreme", to: "high", reason: "The extreme band was empty once the connection floor was applied." },
  { t: at(22), kind: "fetch_refs", say: "Fetched references", pickIds: [PICK_X, PICK_Y], sourcedCount: 1, inferredCount: 1, sourceUrls: ["https://example.invalid/fixture-source"] },
  { t: at(23), kind: "explain", say: "Explained a pick", pickId: PICK_X },
  { t: at(24), kind: "explain", say: "Explained a pick", pickId: PICK_Y },
];
