// What the comparison shows, from the stored run. Pure: no React, no storage, no network.
// The left side is Atelier's edge picks (moderate, high, extreme) as the person last saw them: fields they hid and picks
// they set aside stay off. Calibration picks are very close to the list by design, so they are not part of this view.
// Nothing here reads or produces a score, a rank or a percentage.

import { FIELDS } from "@/types";
import type { Field } from "@/types";
import { buildView } from "@/components/deck/grouping";
import type { ProfileSeed, PublicPick, PublicRunResult } from "@/components/deck/types";
import type { PlainPick } from "./types";

export interface FieldRow {
  field: Field;
  atelier: PublicPick[];
  /** Absent until the plain model has answered. */
  plain: PlainPick[] | null;
}

/** Atelier's shown edge picks by field, in field order, only fields that have at least one. */
export function atelierByField(result: PublicRunResult, opts: { hidden: readonly Field[]; notMe: readonly string[]; seeds: readonly ProfileSeed[] }): Map<Field, PublicPick[]> {
  const view = buildView(result, opts);
  const out = new Map<Field, PublicPick[]>();
  for (const f of FIELDS) {
    const picks = view.decks.find((d) => d.field === f)?.picks ?? [];
    if (picks.length > 0) out.set(f, picks);
  }
  return out;
}

/** One row per field Atelier shows, with the plain list's items for that field once there is one. */
export function buildRows(atelier: ReadonlyMap<Field, PublicPick[]>, plain: readonly PlainPick[] | null): FieldRow[] {
  return FIELDS.filter((f) => atelier.has(f)).map((field) => ({
    field,
    atelier: atelier.get(field) ?? [],
    plain: plain ? plain.filter((p) => p.field === field) : null,
  }));
}
