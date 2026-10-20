// Grouping profile tags into axes by Qloo tag type, weighted by affinity. Pure code. The axis set is
// reproducible: the same tags always give the same axes. Naming is a separate step (naming.ts).
//
// Only taste-analysis tags (they carry a Qloo affinity) create an axis and count toward its weight. A why tag
// of the same tag type joins as a member so the chart can show it, but adds nothing to the weight.

import type { ProfileTag } from "@/types";
import { MAX_AXES, MIN_TAGS_PER_AXIS } from "@/lib/agent/config";
import { byWeight } from "./tags";

export interface AxisGroup {
  id: string;
  tagType: string;
  /** Sum of the member taste-analysis tag weights. */
  rawWeight: number;
  tags: ProfileTag[];
}

export interface Grouped {
  /** At most MAX_AXES groups, heaviest first. */
  groups: AxisGroup[];
  /** Tag types dropped for having fewer than MIN_TAGS_PER_AXIS taste-analysis tags. */
  droppedTagTypes: string[];
  /** Tag types that had enough tags but fell outside the top MAX_AXES. */
  cutTagTypes: string[];
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "type";

export function groupIntoAxes(tags: readonly ProfileTag[]): Grouped {
  const byType = new Map<string, ProfileTag[]>();
  for (const t of tags) {
    const list = byType.get(t.tagType);
    if (list) list.push(t);
    else byType.set(t.tagType, [t]);
  }
  const droppedTagTypes: string[] = [];
  const full: Omit<AxisGroup, "id">[] = [];
  for (const [tagType, list] of byType) {
    const distinct = [...new Map(list.map((t) => [t.tag, t])).values()].sort(byWeight);
    const taste = distinct.filter((t) => t.source === "taste_analysis");
    if (taste.length < MIN_TAGS_PER_AXIS) {
      // A type held only by why tags is not an axis either; it is not a "thin taste type", so it is not listed.
      if (taste.length > 0) droppedTagTypes.push(tagType);
    } else full.push({ tagType, tags: distinct, rawWeight: taste.reduce((s, t) => s + t.weight, 0) });
  }
  full.sort((a, b) => b.rawWeight - a.rawWeight || a.tagType.localeCompare(b.tagType));
  const kept = full.slice(0, MAX_AXES);
  const used = new Set<string>();
  const groups = kept.map((g) => {
    let id = `axis-${slug(g.tagType)}`;
    for (let n = 2; used.has(id); n++) id = `axis-${slug(g.tagType)}-${n}`;
    used.add(id);
    return { id, ...g };
  });
  return { groups, droppedTagTypes: droppedTagTypes.sort(), cutTagTypes: full.slice(MAX_AXES).map((g) => g.tagType) };
}

/** Axis weight for the chart: the group's summed taste weight as a share of the heaviest axis (0 to 1). */
export function axisWeights(groups: readonly AxisGroup[]): Map<string, number> {
  const max = Math.max(0, ...groups.map((g) => g.rawWeight));
  return new Map(groups.map((g) => [g.id, max > 0 ? Math.round((g.rawWeight / max) * 10000) / 10000 : 0]));
}
