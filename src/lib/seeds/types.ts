import type { SeedCandidate, SeedStatus } from "@/types";

/** What a chip needs and nothing more. Never the raw Qloo item. */
export interface SeedChip extends SeedCandidate {
  /** Qloo entity id (same as `qlooId`; `SeedCandidate.qlooId` is the contract field). */
  qlooId: string;
  name: string;
  /** Short entity type, for example `movie` or `tv_show`. */
  type: string;
  /** Display text: name plus year and/or disambiguation. */
  label: string;
  year?: number;
  disambiguation?: string;
  /** https URL only. */
  imageUrl?: string;
}

export type ResolveResult =
  | { status: Extract<SeedStatus, "clean">; entity: SeedChip; candidates: [] }
  | { status: Extract<SeedStatus, "ambiguous">; candidates: SeedChip[] }
  | { status: Extract<SeedStatus, "missing">; candidates: [] };

export interface PlacesLocation {
  /** "lat,lon", the format the spike used for filter.location. */
  location: string;
  /** Miles. */
  radius: number;
}
