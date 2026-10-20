// Contracts for the LLM judges. A judge reads one CardView (or, for stretch-defensibility, a Match and a Stretch pair)
// and returns one Verdict. Everything a judge may use is in the input; it has no other source.

import type { Band, DistanceHint, Field, Provenance } from "@/types";

export const JUDGE_IDS = [
  "bridge-groundedness",
  "bridge-quality",
  "stretch-defensibility",
  "lineage-groundedness",
  "reading-restraint",
  "rubric-fit",
] as const;
export type JudgeId = (typeof JUDGE_IDS)[number];

export type BinaryLabel = "pass" | "fail";
export interface FitScores {
  discernment: number;
  pattern: number;
  idiosyncrasy: number;
}
/** A calibration label, or a judge's result. Binary judges use pass or fail, bridge-quality a 1 to 5 integer, rubric-fit three. */
export type JudgeResult = BinaryLabel | number | FitScores;

export type JudgeKind = "binary" | "score" | "fit";
export const JUDGE_KIND: Readonly<Record<JudgeId, JudgeKind>> = {
  "bridge-groundedness": "binary",
  "bridge-quality": "score",
  "stretch-defensibility": "binary",
  "lineage-groundedness": "binary",
  "reading-restraint": "binary",
  "rubric-fit": "fit",
};

export interface SourceView {
  /** A url, or the source label when the source has no page of its own ("Qloo"). */
  ref: string;
  /** The retrieved text. Empty when only the reference was kept. */
  text: string;
}

export interface HopView {
  kind: "seed" | "theme" | "lineage" | "pick";
  label: string;
  /** Tag names (never ids), for theme hops. */
  tags?: string[];
  provenance: Provenance;
  /** The hop's source: its url, or its source label. */
  source?: string;
}

/** One pick's card as the judge sees it: names instead of ids, nothing numeric, nothing from outside the path. */
export interface CardView {
  seed: { label: string; field: Field; why: string };
  pick: { label: string; field: Field; band?: Band; /** Names of the tags returned for the pick. */ tags: string[] };
  hops: HopView[];
  sharedTags: string[];
  pickOnlyTags: string[];
  distance: DistanceHint[];
  /** The card's explanation: why this one, and what is different. */
  why: string;
  different: string;
  reading?: { text: string; source: string };
  provenance: { sourced: number; inferred: number };
  /** Retrieved text the card may lean on. */
  sources: SourceView[];
}

export interface ProfileView {
  seeds: { label: string; field: Field; why: string }[];
  /** Axis labels, in words. */
  axes: string[];
}

export type JudgeInput =
  | { judge: Exclude<JudgeId, "stretch-defensibility">; id: string; card: CardView }
  | { judge: "stretch-defensibility"; id: string; profile: ProfileView; match: CardView; stretch: CardView };

export interface Verdict {
  judge: JudgeId;
  id: string;
  /** False when the input lacked something the criterion needs. `result` is then null and the verdict never agrees with a label. */
  judgeable: boolean;
  result: JudgeResult | null;
  /** Quotes the judge gave. */
  evidence: string[];
  /** Quotes that are too short, or do not occur in the part of the input the judge may quote from. A pass with any of these is downgraded to fail ("no quote, no credit"). */
  evidenceMissing: string[];
  unsupportedClaims: string[];
  reason: string;
  /** rubric-fit only. */
  slop?: boolean;
  /** Set when the verdict was changed after the model replied, and why. */
  adjusted?: string;
}

export interface CalibrationItem {
  id: string;
  judge: JudgeId;
  input: JudgeInput;
  /** What a careful reader of the rubric says. pass or fail, a 1 to 5 score, or three scores. */
  expected: JudgeResult;
  /** rubric-fit only: whether the card is slop. The judge's slop flag is compared to it. */
  expectedSlop?: boolean;
  /** One line on why the label is what it is. Never sent to the model. */
  note: string;
}
