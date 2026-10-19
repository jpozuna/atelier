import type { Field } from "@/types";
import type { ATELIER_SEARCH_TYPES } from "@/lib/qloo/registry";

type SearchType = (typeof ATELIER_SEARCH_TYPES)[number];

/** Field -> Qloo entity type for /search `types` (docs/DECISIONS.md: music artist, film movie, TV tv_show, books book,
 *  food and places place, fashion brand). Typed against the registry's allowed search types. */
export const FIELD_SEARCH_TYPE: Readonly<Record<Field, SearchType>> = {
  music: "urn:entity:artist",
  film: "urn:entity:movie",
  tv: "urn:entity:tv_show",
  books: "urn:entity:book",
  food_places: "urn:entity:place",
  fashion: "urn:entity:brand",
};

/** Fields whose search is scoped to a location so local results resolve (spike probe 1). */
export const LOCATION_FIELDS: ReadonlySet<Field> = new Set<Field>(["food_places"]);
