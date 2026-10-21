import { PickCard } from "@/components/card";
import type { PublicPick } from "@/components/deck/types";

/**
 * One Atelier pick, read only: the card as the picks screen shows it (path, why this one, what is different,
 * provenance, a reading when there is one), with no reaction area, because this view compares and does not collect.
 */
export function CompareCard({ pick, headingLevel = 4 }: { pick: PublicPick; headingLevel?: 3 | 4 }) {
  return <PickCard readOnly card={pick.card} title={pick.name} headingLevel={headingLevel} />;
}
