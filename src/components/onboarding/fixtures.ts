// Synthetic data for onboarding tests. Invented names and ids shaped 00000000-0000-4000-8000-0000000000NN.
import type { Chip, Draft } from "./flow";
import { initialDraft } from "./flow";
import type { Field } from "./types";

export const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export const chip = (n: number): Chip => ({ qlooId: uid(n), name: `Invented ${n}`, label: `Invented ${n} (2001)`, type: "movie" });

export const resolvedDraft = (field: Field, n: number, why = "It feels unhurried and exact"): Draft => ({
  ...initialDraft(field),
  query: `invented ${n}`,
  searchedQuery: `invented ${n}`,
  search: { kind: "clean", chip: chip(n) },
  why,
});
