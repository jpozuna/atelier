import type { Field } from './field';

export const SEED_STATUSES = ['clean', 'ambiguous', 'missing'] as const;
/** clean: one confident entity. ambiguous: several plausible entities. missing: /search 404 or no match. */
export type SeedStatus = (typeof SEED_STATUSES)[number];

export interface SeedCandidate {
  qlooId: string;
  label: string;
}

/** Something the user loves, with their one-line reason. */
export interface Seed {
  id: string;
  field: Field;
  /** What the user typed. */
  typed: string;
  /** The user's one-line "why". */
  why: string;
  /** Resolved Qloo entity id. Null unless `status` is `clean` or the user picked a candidate. */
  qlooId: string | null;
  status: SeedStatus;
  /** Present when `status` is `ambiguous`. */
  candidates?: SeedCandidate[];
}
