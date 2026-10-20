// Invented seeds shared by the calibration sets. None of this is real data.

import type { Field } from "@/types";

export interface SeedSpec {
  label: string;
  field: Field;
  why: string;
}

export const FILM_A: SeedSpec = { label: "Fixture Film A", field: "film", why: "the long, patient takes make me feel time passing" };
export const MUSIC_B: SeedSpec = { label: "Fixture Band B", field: "music", why: "the layered, hypnotic repetition that builds slowly" };
export const BOOK_C: SeedSpec = { label: "Fixture Novel C", field: "books", why: "narrators who tell it sideways and never explain" };
export const FASHION_D: SeedSpec = { label: "Fixture Label D", field: "fashion", why: "plain cut and heavy fabric, nothing decorative" };
export const PLACE_E: SeedSpec = { label: "Fixture Cafe E", field: "food_places", why: "it is quiet and everything is made slowly" };
export const TV_F: SeedSpec = { label: "Fixture Series F", field: "tv", why: "a small cast stuck in one place, talking around the thing" };
