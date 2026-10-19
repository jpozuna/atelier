// Numbers for the reference layer. config.ts is manager-owned, so they live here until the manager moves them
// (CLAUDE.md: tunable numbers go in config.ts only). Proposed config.ts names are in the Handoff of T-09.

export interface RefsLimits {
  /** Wikidata entities looked up in one run (finalists only). Cache hits do not count. From the ticket: at most 6. */
  WIKIDATA_MAX_LOOKUPS_PER_RUN: number;
  /** Related items kept per Wikidata property (all are matchable against seeds; only MAX_NAMES_PER_HOP are shown). */
  WIKIDATA_MAX_TARGETS_PER_PROPERTY: number;
  /** Ids per labels request. wbgetentities allows 50 for anonymous clients. */
  WIKIDATA_MAX_LABEL_IDS: number;
  /** One request. */
  WIKIDATA_TIMEOUT_MS: number;
  /** All Wikidata work in one run, counted from its first request. Past it, no more requests. */
  WIKIDATA_RUN_DEADLINE_MS: number;
  /** `maxlag` sent with every request (seconds). Wikimedia asks for 5 on automated clients. */
  WIKIDATA_MAXLAG_SECONDS: number;
  /** Pause after a 429, 503 or maxlag error that carries no Retry-After. */
  WIKIDATA_DEFAULT_RETRY_MS: number;
  /** Longest pause a Retry-After can impose on this process. */
  WIKIDATA_MAX_RETRY_MS: number;
  /** In-memory cache lifetime for a Wikidata response. Wikidata is CC0, so caching it is allowed. */
  WIKIDATA_CACHE_TTL_MS: number;
  /** Related names shown in one lineage hop label: seed matches first, then source order (never popularity or taste). */
  MAX_NAMES_PER_HOP: number;
  /** A reading excerpt is cut at a sentence end at or before this length, else at a word with an ellipsis. */
  READING_MAX_CHARS: number;
  /** Retrieved text shorter than this is not offered as a reading. */
  READING_MIN_CHARS: number;
}

export const REFS_LIMITS: RefsLimits = {
  WIKIDATA_MAX_LOOKUPS_PER_RUN: 6,
  WIKIDATA_MAX_TARGETS_PER_PROPERTY: 10,
  WIKIDATA_MAX_LABEL_IDS: 50,
  WIKIDATA_TIMEOUT_MS: 8000,
  WIKIDATA_RUN_DEADLINE_MS: 12000,
  WIKIDATA_MAXLAG_SECONDS: 5,
  WIKIDATA_DEFAULT_RETRY_MS: 60 * 1000,
  WIKIDATA_MAX_RETRY_MS: 10 * 60 * 1000,
  WIKIDATA_CACHE_TTL_MS: 7 * 24 * 60 * 60 * 1000,
  MAX_NAMES_PER_HOP: 3,
  READING_MAX_CHARS: 280,
  READING_MIN_CHARS: 40,
};

export const WIKIDATA_API_URL = "https://www.wikidata.org/w/api.php";
export const WIKIDATA_ENTITY_URL = "https://www.wikidata.org/wiki/";

/**
 * Wikimedia requires a User-Agent with real contact info (an unidentified client is capped at about 10 requests a
 * minute). ATELIER_CONTACT supplies it. There is no fallback: without a real contact, Wikidata is skipped.
 */
export const USER_AGENT_PRODUCT = "AtelierHackathonDemo/0.1";

/**
 * Qloo exposes no public page per entity. This constant only satisfies the non-empty `sourceUrl` contract on a
 * Qloo-sourced hop or reading. The UI must NOT render it as a link: it shows `sourceLabel`, "Source: Qloo".
 */
export const QLOO_SOURCE_URL = "https://www.qloo.com/";

export const SOURCE_LABELS = { qloo: "Qloo", wikidata: "Wikidata" } as const;

export const LICENSES = {
  wikidata: "Data from Wikidata (CC0)",
  qloo: "Qloo data, shown under the hackathon API terms",
} as const;
