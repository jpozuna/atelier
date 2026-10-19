import type { Card, Field, HopKind, Path, Provenance, Reaction, ReactionState } from "@/types";

/** Provenance is always named in words. Line style (solid, dashed) is an extra cue only. */
export const PROVENANCE_LABEL: Record<Provenance, string> = {
  sourced: "Sourced",
  inferred: "Inferred",
};

export const HOP_KIND_LABEL: Record<HopKind, string> = {
  seed: "Your seed",
  theme: "Shared theme",
  lineage: "Lineage, a reading",
  pick: "This pick",
};

export const FIELD_LABEL: Record<Field, string> = {
  music: "Music",
  film: "Film",
  tv: "TV",
  books: "Books",
  food_places: "Food and places",
  fashion: "Fashion",
};

/** Provenance badge, shown only on theme and lineage hops. */
export interface StepBadge {
  provenance: Provenance;
  label: string;
  /** CSS line style cue, from the design tokens. An extra cue; the word is the primary one. */
  lineStyle: "solid" | "dashed";
}

export interface DisplayStep {
  key: string;
  kind: HopKind;
  kindLabel: string;
  label: string;
  /** Absent on seed and pick hops: the user's own seed and the entity itself are not sourced or inferred claims. */
  badge?: StepBadge;
  /** Present only for sourced theme or lineage hops with a usable http(s) link. */
  href?: string;
  /** True when a sourced hop has no usable link. The UI says so rather than hiding it. */
  linkMissing: boolean;
  /** A source with no page of its own (e.g. Qloo): shown as "Source: <label>" text, never as a link. */
  sourceLabel?: string;
}

/** Only http and https links are rendered as links. */
export function safeHref(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}

/** Only theme and lineage hops make a claim that has provenance. */
export function hasProvenance(kind: HopKind): boolean {
  return kind === "theme" || kind === "lineage";
}

/**
 * Turns the stored path into the steps the card draws: seed, theme, [lineage], pick. No reordering, no merging.
 * A lineage hop is always sourced (hard rule 6). An inferred lineage hop is a contract violation: it is omitted,
 * never drawn as lineage, and warned about in development.
 */
export function pathToDisplaySteps(path: Path): DisplayStep[] {
  const steps: DisplayStep[] = [];
  path.hops.forEach((hop, i) => {
    if (hop.kind === "lineage" && hop.provenance !== "sourced") {
      if (process.env.NODE_ENV !== "production") {
        console.warn(`PickCard: omitted lineage hop "${hop.label}" because it is not sourced (contract violation).`);
      }
      return;
    }
    const base = { key: `${i}-${hop.kind}`, kind: hop.kind, kindLabel: HOP_KIND_LABEL[hop.kind], label: hop.label };
    if (!hasProvenance(hop.kind)) {
      steps.push({ ...base, linkMissing: false });
      return;
    }
    const sourceLabel = hop.provenance === "sourced" && hop.sourceLabel?.trim() ? hop.sourceLabel.trim() : undefined;
    const href = hop.provenance === "sourced" && !sourceLabel ? safeHref(hop.sourceUrl) : undefined;
    steps.push({
      ...base,
      badge: {
        provenance: hop.provenance,
        label: PROVENANCE_LABEL[hop.provenance],
        lineStyle: hop.provenance === "sourced" ? "solid" : "dashed",
      },
      href,
      linkMissing: hop.provenance === "sourced" && !href && !sourceLabel,
      ...(sourceLabel ? { sourceLabel } : {}),
    });
  });
  return steps;
}

/** Counts theme and lineage hops only, from the path itself. Never from a stored summary that could drift. */
export function countProvenance(path: Path): { sourced: number; inferred: number } {
  let sourced = 0;
  let inferred = 0;
  for (const hop of path.hops) {
    if (!hasProvenance(hop.kind)) continue;
    if (hop.kind === "lineage" && hop.provenance !== "sourced") continue; // omitted from display
    if (hop.provenance === "sourced") sourced += 1;
    else inferred += 1;
  }
  return { sourced, inferred };
}

export function provenanceSummary(path: Path): string {
  const { sourced, inferred } = countProvenance(path);
  return `Connecting steps: ${sourced} sourced, ${inferred} inferred.`;
}

/** The title defaults to the final (pick) hop of the path. */
export function pickTitle(card: Card): string {
  const last = card.path.hops[card.path.hops.length - 1];
  return last ? last.label : "Untitled pick";
}

/** The four save states offered on a card. `tried` is a later follow-up (T-17), not a save state. */
export const SAVE_STATES = ["later", "will_try", "explore", "not_interested"] as const;
export type SaveState = (typeof SAVE_STATES)[number];

/** The save states to offer. `tried` appears only when the card already carries it. */
export function offeredStates(reaction: Reaction | undefined): ReactionState[] {
  return reaction?.state === "tried" ? [...SAVE_STATES, "tried"] : [...SAVE_STATES];
}

export const REACTION_LABEL: Record<ReactionState, string> = {
  later: "Save for later",
  will_try: "I will try it",
  explore: "Explore further",
  not_interested: "Not for me",
  tried: "I tried it",
};

export function whyHint(state: ReactionState | null): string {
  if (state === "not_interested") return "Say what did not fit.";
  if (state === "tried") return "Say how it went.";
  return "Optional. A sentence in your own words is enough.";
}

/** Builds the emitted reaction. Empty or whitespace-only words are omitted. */
export function buildReaction(state: ReactionState, words: string, now: Date = new Date()): Reaction {
  const trimmed = words.trim();
  return trimmed ? { state, words: trimmed, at: now.toISOString() } : { state, at: now.toISOString() };
}
