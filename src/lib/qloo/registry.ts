// Param registry for /v2/insights, seeded from the Entity Type Parameter Guide and updated with the
// 2026-10-18 spike (docs/spike-report.md). Generated from
// .claude/skills/qloo-api/references/registry.seed.json, then extended by hand with the Atelier allowlist
// (ATELIER_REFUSED_INSIGHTS_PARAMS, ATELIER_SEARCH_TYPES) at the bottom. Names and rules only, no Qloo response data.
//
// Manager-only after the spike: do not add a row from memory. A param is sendable for a type only if it is
// `listed` or `confirmed` for that type and is not `ignored` or `rejected`. Everything else is refused by
// src/lib/qloo/validate.ts before any request is built.

export const INSIGHTS_COMMON_PARAMS = [
  "filter.type",
  "bias.trends",
  "filter.exclude.entities",
  "filter.parents.types",
  "filter.popularity.min",
  "filter.popularity.max",
  "filter.exclude.tags",
  "operator.exclude.tags",
  "filter.external.exists",
  "operator.filter.external.exists",
  "filter.results.entities",
  "filter.results.entities.query",
  "filter.tags",
  "operator.filter.tags",
  "offset",
  "signal.demographics.age",
  "signal.demographics.audiences",
  "signal.demographics.audiences.weight",
  "signal.demographics.gender",
  "signal.interests.entities",
  "signal.interests.tags",
  "take",
] as const;

export const ENTITY_TYPE_KEYS = ["artist", "book", "brand", "destination", "movie", "person", "place", "podcast", "tv_show", "video_game"] as const;
export type EntityTypeKey = (typeof ENTITY_TYPE_KEYS)[number];

export interface EntityTypeEntry {
  /** filter.type value for this type. */
  readonly urn: string;
  /** Named for this type in the Entity Type Parameter Guide. */
  readonly listed: readonly string[];
  /** Promoted by a with/without test in the spike (or listed and shown to work). */
  readonly confirmed: readonly string[];
  /** Listed or documented, but the spike showed it changes nothing for this type. Refused. */
  readonly ignored: readonly string[];
  /** Param (or param=value) that the API rejects for this type, with the reason. Refused. */
  readonly rejected: Readonly<Record<string, string>>;
  /** Signals that must be present for this type (destination needs seeds). */
  readonly requiredSignals: readonly string[];
}

export const INSIGHTS_TYPES: Readonly<Record<EntityTypeKey, EntityTypeEntry>> = {
  artist: {
    urn: "urn:entity:artist",
    listed: [...INSIGHTS_COMMON_PARAMS, ...[]],
    confirmed: [
      "feature.explainability",
      "page",
      "signal.location.query",
      "backfill.cross_domain.take",
      "backfill.content_based.take",
      "bias.content_based",
      "filter.exists",
    ],
    ignored: [
      "sort_by",
    ],
    rejected: {},
    requiredSignals: [],
  },
  book: {
    urn: "urn:entity:book",
    listed: [...INSIGHTS_COMMON_PARAMS, ...[
      "filter.publication_year.min",
      "filter.publication_year.max",
    ]],
    confirmed: [
      "feature.explainability",
      "page",
      "signal.location.query",
      "backfill.cross_domain.take",
      "backfill.content_based.take",
    ],
    ignored: [
      "sort_by",
      "bias.content_based",
      "filter.exists",
    ],
    rejected: {
      "bias.trends": "400 for any value except off: book does not support trending",
    },
    requiredSignals: [],
  },
  brand: {
    urn: "urn:entity:brand",
    listed: [...INSIGHTS_COMMON_PARAMS, ...[]],
    confirmed: [
      "feature.explainability",
      "page",
      "signal.location.query",
      "backfill.cross_domain.take",
      "backfill.content_based.take",
      "filter.exists",
    ],
    ignored: [
      "sort_by",
      "bias.content_based",
    ],
    rejected: {},
    requiredSignals: [],
  },
  destination: {
    urn: "urn:entity:destination",
    listed: [...INSIGHTS_COMMON_PARAMS, ...[
      "filter.geocode.name",
      "filter.geocode.admin1_region",
      "filter.geocode.admin2_region",
      "filter.geocode.country_code",
      "filter.location",
      "filter.location.radius",
      "filter.location.geohash",
      "filter.exclude.location.geohash",
    ]],
    confirmed: [],
    ignored: [],
    rejected: {},
    requiredSignals: [
      "signal.interests.entities",
    ],
  },
  movie: {
    urn: "urn:entity:movie",
    listed: [...INSIGHTS_COMMON_PARAMS, ...[
      "filter.content_rating",
      "filter.release_year.min",
      "filter.release_year.max",
      "filter.release_country",
      "operator.filter.release_country",
      "filter.rating.min",
      "filter.rating.max",
    ]],
    confirmed: [
      "feature.explainability",
      "page",
      "signal.location.query",
      "backfill.cross_domain.take",
      "backfill.content_based.take",
      "bias.content_based",
      "operator.signal.interests.tags",
      "signal.interests.tags.weight",
      "signal.interests.entities.weight",
    ],
    ignored: [
      "sort_by",
      "filter.exists",
    ],
    rejected: {},
    requiredSignals: [],
  },
  person: {
    urn: "urn:entity:person",
    listed: [...INSIGHTS_COMMON_PARAMS, ...[
      "filter.date_of_birth.min",
      "filter.date_of_birth.max",
      "filter.date_of_death.min",
      "filter.date_of_death.max",
      "filter.gender",
    ]],
    confirmed: [],
    ignored: [],
    rejected: {},
    requiredSignals: [],
  },
  place: {
    urn: "urn:entity:place",
    listed: [...INSIGHTS_COMMON_PARAMS, ...[
      "bias.quality",
      "filter.address",
      "filter.external.tripadvisor.rating.count.max",
      "filter.external.tripadvisor.rating.count.min",
      "filter.external.tripadvisor.rating.max",
      "filter.external.tripadvisor.rating.min",
      "filter.geocode.name",
      "filter.geocode.admin1_region",
      "filter.geocode.admin2_region",
      "filter.geocode.country_code",
      "filter.hotel_class.max",
      "filter.hotel_class.min",
      "filter.hours",
      "filter.location",
      "filter.location.geohash",
      "filter.exclude.location.geohash",
      "filter.location.radius",
      "filter.price_level.min",
      "filter.price_level.max",
      "filter.price_range.from",
      "filter.price_range.to",
      "filter.properties.business_rating.min",
      "filter.properties.business_rating.max",
      "filter.properties.resy.rating.min",
      "filter.properties.resy.rating.max",
      "filter.references_brand",
      "filter.resy.rating_count.min",
      "filter.resy.rating_count.max",
      "filter.resy.rating.party.min",
      "filter.resy.rating.party.max",
      "sort_by",
    ]],
    confirmed: [
      "feature.explainability",
      "page",
      "signal.location.query",
      "backfill.cross_domain.take",
      "backfill.content_based.take",
      "bias.content_based",
    ],
    ignored: [
      "sort_by",
      "filter.exists",
    ],
    rejected: {
      "filter.exists=properties.description": "500 System Error",
    },
    requiredSignals: [],
  },
  podcast: {
    urn: "urn:entity:podcast",
    listed: [...INSIGHTS_COMMON_PARAMS, ...[]],
    confirmed: [],
    ignored: [],
    rejected: {},
    requiredSignals: [],
  },
  tv_show: {
    urn: "urn:entity:tv_show",
    listed: [...INSIGHTS_COMMON_PARAMS, ...[
      "filter.content_rating",
      "filter.finale_year.max",
      "filter.finale_year.min",
      "filter.latest_known_year.max",
      "filter.latest_known_year.min",
      "filter.release_year.max",
      "filter.release_year.min",
      "filter.release_country",
      "operator.filter.release_country",
      "filter.rating.max",
      "filter.rating.min",
    ]],
    confirmed: [
      "feature.explainability",
      "page",
      "signal.location.query",
      "backfill.cross_domain.take",
      "backfill.content_based.take",
      "bias.content_based",
    ],
    ignored: [
      "sort_by",
      "filter.exists",
    ],
    rejected: {},
    requiredSignals: [],
  },
  video_game: {
    urn: "urn:entity:video_game",
    listed: [...INSIGHTS_COMMON_PARAMS, ...[]],
    confirmed: [],
    ignored: [],
    rejected: {},
    requiredSignals: [],
  },
};

/** Tag insights (taste analysis): GET or POST /v2/insights with filter.type=urn:tag. */
export const TAG_INSIGHTS = {
  urn: "urn:tag",
  listed: [
    "filter.type",
    "diversify.by",
    "diversify.take",
    "offset",
    "take",
  ],
  confirmed: [
    "signal.interests.entities",
    "filter.parents.types",
    "filter.tag.types",
  ],
  /** At least one of these must be present. Only entity seeds are confirmed for urn:tag. */
  requiredOneOf: ["signal.interests.entities"],
} as const;

/** /search (GET). `types` is documented in the Search Entities OpenAPI. */
export const SEARCH_ENDPOINT = {
  path: "/search",
  params: [
    "types",
    "query",
    "filter.location",
    "filter.radius",
    "filter.exists",
    "filter.tags",
    "filter.rating",
    "filter.popularity",
    "filter.address",
    "operator.filter.tags",
    "page",
    "take",
    "sort_by",
  ],
  /** Search-enum entity types (no destination; video games are `videogame`). */
  types: [
    "urn:entity:artist",
    "urn:entity:book",
    "urn:entity:brand",
    "urn:entity:locality",
    "urn:entity:movie",
    "urn:entity:person",
    "urn:entity:place",
    "urn:entity:podcast",
    "urn:entity:tv_show",
    "urn:entity:videogame",
    "urn:heatmap",
    "urn:entity:audience",
  ],
  legacyTypes: [
    "urn:entity:actor",
    "urn:entity:album",
    "urn:entity:author",
    "urn:entity:director",
    "urn:entity:locality",
  ],
  sortBy: ["match", "distance", "popularity"],
  /** Spike: 100 is OK, 199 is a 400. */
  takeMax: 100,
} as const;

/** /v2/tags (GET). feature.semantic_search, feature.typo_tolerance and filter.parents.types were confirmed by the spike. */
export const TAGS_ENDPOINT = {
  path: "/v2/tags",
  params: [
    "feature.typo_tolerance",
    "feature.semantic_search",
    "filter.results.tags",
    "filter.parents.types",
    "filter.popularity.min",
    "filter.popularity.max",
    "filter.query",
    "filter.tag.types",
    "page",
    "take",
  ],
  confirmed: [
    "feature.semantic_search",
    "feature.typo_tolerance",
    "filter.parents.types",
  ],
  takeMax: 50,
} as const;

/** /entities (GET). */
export const ENTITIES_ENDPOINT = {
  path: "/entities",
  params: [
    "entity_ids",
    "external.facebook.ids",
    "external.goodreads.ids",
    "external.goodreads_author.ids",
    "external.igdb.ids",
    "external.imdb.ids",
    "external.instagram.ids",
    "external.isbn10.ids",
    "external.isbn13.ids",
    "external.itunes.ids",
    "external.lastfm.ids",
    "external.library_of_congress.ids",
    "external.metacritic.ids",
    "external.michelin.ids",
    "external.musicbrainz.ids",
    "external.resy.ids",
    "external.rottentomatoes.ids",
    "external.soundcloud.ids",
    "external.spotify.ids",
    "external.tablet.ids",
    "external.twitch.ids",
    "external.twitter.ids",
    "external.wikidata.ids",
  ],
} as const;

export const INSIGHTS_PATH = "/v2/insights" as const;

/**
 * Params that the spike showed working in a POST body: weighted seeds, filter.type and take (movie).
 * Every other body-borne param stays refused until the manager records the result of
 * scripts/spike/04-post-check.mjs by adding it to `confirmedBodyParams`.
 */
export const POST_BODY = {
  baseline: ["filter.type", "signal.interests.entities", "take"],
  /**
   * EMPTY BY DEFAULT. Pending the 6-call check (docs/DECISIONS.md). Once the check passes, the manager adds
   * "filter.popularity.max", "filter.exclude.entities" and "feature.explainability" here (and any other
   * body-borne param it verifies, for example "signal.interests.tags", "filter.tags", "offset").
   */
  confirmedBodyParams: [] as string[],
} as const;

/** Limited value restrictions for params that are only partly usable. */
export const ALLOWED_VALUES: Readonly<Record<string, readonly string[]>> = {
  // properties.description is ignored everywhere and a 500 for place.
  "filter.exists": ["properties.image"],
};

export interface Registry {
  readonly types: Readonly<Record<EntityTypeKey, EntityTypeEntry>>;
  readonly tagInsights: typeof TAG_INSIGHTS;
  readonly post: { readonly baseline: readonly string[]; readonly confirmedBodyParams: readonly string[] };
}

export const REGISTRY: Registry = { types: INSIGHTS_TYPES, tagInsights: TAG_INSIGHTS, post: POST_BODY };

export type ParamStatus = "listed" | "confirmed" | "ignored" | "rejected" | "unknown";

/** Status of one param for one entity type. ignored and rejected win over listed. */
export function paramStatus(type: EntityTypeKey, param: string, registry: Registry = REGISTRY): ParamStatus {
  const e = registry.types[type];
  if (Object.keys(e.rejected).some((k) => k === param)) return "rejected";
  if (e.ignored.includes(param)) return "ignored";
  if (e.confirmed.includes(param)) return "confirmed";
  if (e.listed.includes(param)) return "listed";
  return "unknown";
}

export function entityTypeKeyFromUrn(urn: unknown): EntityTypeKey | null {
  for (const k of ENTITY_TYPE_KEYS) if (INSIGHTS_TYPES[k].urn === urn) return k;
  return null;
}

/**
 * Atelier allowlist, applied on top of the seed. These are listed or documented but Atelier does not send them on
 * entity-type /v2/insights calls (decisions in the agent-loop skill and DECISIONS.md). Refused before sending.
 * `filter.parents.types` stays allowed for urn:tag and /v2/tags, which have their own param lists.
 */
export const ATELIER_REFUSED_INSIGHTS_PARAMS: Readonly<Record<string, string>> = {
  "operator.exclude.tags": "Atelier relies on the default (union) exclude; the operator's name is disputed across the docs",
  "operator.filter.exclude.tags": "Atelier relies on the default (union) exclude; the operator's name is disputed across the docs",
  "filter.parents.types": "means audience urns or parent entity types depending on the doc; not used on entity insights",
  "filter.external.exists": "not used by Atelier",
  "operator.filter.external.exists": "not used by Atelier",
  "filter.results.entities.query": "not used by Atelier (use filter.results.entities with ids)",
  "bias.trends": "the agent loop does not send trending bias (it defaults to medium server-side; the spike showed off equals the default)",
};

/** Prefixes refused on entity-type insights. Demographics are not used by Atelier. */
export const ATELIER_REFUSED_INSIGHTS_PREFIXES: readonly string[] = ["signal.demographics."];

/** Why Atelier refuses this param on entity-type insights, or null if the allowlist does not touch it. */
export function atelierRefusal(param: string): string | null {
  if (ATELIER_REFUSED_INSIGHTS_PARAMS[param]) return ATELIER_REFUSED_INSIGHTS_PARAMS[param];
  if (ATELIER_REFUSED_INSIGHTS_PREFIXES.some((p) => param.startsWith(p))) return "demographics are not used by Atelier";
  return null;
}

/** /search `types` Atelier may use: its six domains. */
export const ATELIER_SEARCH_TYPES = [
  "urn:entity:artist",
  "urn:entity:movie",
  "urn:entity:tv_show",
  "urn:entity:book",
  "urn:entity:place",
  "urn:entity:brand",
] as const;
