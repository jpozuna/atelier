// Turns a stored Card (and what the run knew around it) into the CardView a judge reads. Tag ids become names, and
// nothing numeric goes in: no contribution, popularity or reach. The same adapter serves live runs (inputs built from
// a private recording) and the synthetic calibration sets.

import type { Band, Card, Field } from "@/types";
import type { CardView, SourceView } from "./types";

export interface CardViewContext {
  seed: { label: string; field: Field; why: string };
  pick: { label: string; field: Field; band?: Band; tags: readonly string[] };
  /** Tag id to the tag's name, for every id the path carries. */
  tagNames: Readonly<Record<string, string>>;
  /** Retrieved text the card may lean on. */
  sources?: readonly SourceView[];
}

export function buildCardView(card: Card, ctx: CardViewContext): CardView {
  const name = (id: string): string => ctx.tagNames[id] ?? id;
  const sourceOf = (h: { sourceUrl?: string; sourceLabel?: string }): string | undefined => h.sourceLabel ?? h.sourceUrl;
  const view: CardView = {
    seed: { ...ctx.seed },
    pick: { label: ctx.pick.label, field: ctx.pick.field, ...(ctx.pick.band ? { band: ctx.pick.band } : {}), tags: [...ctx.pick.tags] },
    hops: card.path.hops.map((h) => ({
      kind: h.kind,
      label: h.label,
      ...(h.tags ? { tags: h.tags.map(name) } : {}),
      provenance: h.provenance,
      ...(sourceOf(h) ? { source: sourceOf(h) } : {}),
    })),
    sharedTags: card.path.sharedTags.map(name),
    pickOnlyTags: (card.path.pickOnlyTags ?? []).map(name),
    distance: [...(card.path.distance ?? [])],
    why: card.why,
    different: card.different,
    provenance: { ...card.provenance },
    sources: (ctx.sources ?? []).map((s) => ({ ...s })),
  };
  if (card.reading) view.reading = { text: card.reading.text, source: card.reading.sourceLabel ?? card.reading.sourceUrl };
  return view;
}
