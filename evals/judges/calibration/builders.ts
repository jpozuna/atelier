// Compact builders for the synthetic calibration sets. Everything here is invented: names say "Fixture", tag ids are
// in the `fixture` kind, source urls use example.org, and ids follow the synthetic pattern. No Qloo data.

import type { Band, Card, DistanceHint, Field, PathHop, Provenance } from "@/types";
import type { CalibrationItem, CardView, JudgeId, JudgeResult, ProfileView, SourceView } from "../types";
import type { JudgeInput } from "../types";
import { buildCardView } from "../view";

export interface CardSpec {
  seed: { label: string; field: Field; why: string };
  pick: { label: string; field: Field; tags: string[]; band?: Band };
  /** The shared theme, as tag names. Becomes the theme hop and the shared tags. */
  theme: string[];
  pickOnly?: string[];
  distance?: DistanceHint[];
  lineage?: { label: string; provenance?: Provenance; source?: string };
  why: string;
  different: string;
  reading?: { text: string; source: string };
  sources?: SourceView[];
}

/** A url source is a sourceUrl. A label (a source with no page of its own, such as "Qloo") is a placeholder url plus the label, as in the app. */
const NO_PAGE_URL = "https://example.org/fixture/no-page";
const sourceFields = (src: string): { sourceUrl: string; sourceLabel?: string } =>
  src.startsWith("http") ? { sourceUrl: src } : { sourceUrl: NO_PAGE_URL, sourceLabel: src };

const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const tagId = (name: string): string => `urn:tag:fixture:theme:${slug(name)}`;

let seedCounter = 0;
const syntheticId = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** A CardView built through the real Card and Path types, so the view adapter is exercised too. */
export function card(spec: CardSpec): CardView {
  seedCounter += 1;
  const names = [...spec.theme, ...(spec.pickOnly ?? [])];
  const tagNames: Record<string, string> = Object.fromEntries(names.map((n) => [tagId(n), n]));
  const hops: PathHop[] = [
    { kind: "seed", label: spec.seed.label, provenance: "inferred" },
    { kind: "theme", label: spec.theme.join(", "), tags: spec.theme.map(tagId), provenance: "inferred" },
  ];
  if (spec.lineage) {
    const provenance = spec.lineage.provenance ?? "sourced";
    hops.push({
      kind: "lineage",
      label: spec.lineage.label,
      provenance,
      ...(provenance === "sourced" && spec.lineage.source ? sourceFields(spec.lineage.source) : {}),
    });
  }
  hops.push({ kind: "pick", label: spec.pick.label, provenance: "inferred" });
  const sourced = hops.filter((h) => h.provenance === "sourced").length;
  const c: Card = {
    path: {
      seedId: syntheticId(seedCounter),
      anchor: { contribution: null, source: "tag_overlap" },
      hops,
      sharedTags: spec.theme.map(tagId),
      distinctive: true,
      pickOnlyTags: (spec.pickOnly ?? []).map(tagId),
      distance: spec.distance ?? [],
    },
    why: spec.why,
    different: spec.different,
    provenance: { sourced, inferred: hops.length - sourced },
    ...(spec.reading ? { reading: { text: spec.reading.text, ...sourceFields(spec.reading.source) } } : {}),
  };
  return buildCardView(c, {
    seed: spec.seed,
    pick: { label: spec.pick.label, field: spec.pick.field, band: spec.pick.band, tags: spec.pick.tags },
    tagNames,
    sources: spec.sources,
  });
}

/** Single-card judges. */
export function cardItem(judge: Exclude<JudgeId, "stretch-defensibility">, id: string, c: CardView, expected: JudgeResult, note: string, expectedSlop?: boolean): CalibrationItem {
  return { id, judge, input: { judge, id, card: c } as JudgeInput, expected, note, ...(expectedSlop === undefined ? {} : { expectedSlop }) };
}

export function pairItem(id: string, profile: ProfileView, match: CardView, stretch: CardView, expected: "pass" | "fail", note: string): CalibrationItem {
  return { id, judge: "stretch-defensibility", input: { judge: "stretch-defensibility", id, profile, match, stretch }, expected, note };
}
