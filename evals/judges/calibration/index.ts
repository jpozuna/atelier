// The calibration sets, one per judge. Synthetic only: invented names, fixture tag ids, example.org sources.

import { JUDGE_IDS, type CalibrationItem, type JudgeId } from "../types";
import { BRIDGE_GROUNDEDNESS } from "./bridge-groundedness";
import { BRIDGE_QUALITY } from "./bridge-quality";
import { LINEAGE_GROUNDEDNESS } from "./lineage-groundedness";
import { READING_RESTRAINT } from "./reading-restraint";
import { RUBRIC_FIT } from "./rubric-fit";
import { STRETCH_DEFENSIBILITY } from "./stretch-defensibility";

export const CALIBRATION: Readonly<Record<JudgeId, readonly CalibrationItem[]>> = {
  "bridge-groundedness": BRIDGE_GROUNDEDNESS,
  "bridge-quality": BRIDGE_QUALITY,
  "stretch-defensibility": STRETCH_DEFENSIBILITY,
  "lineage-groundedness": LINEAGE_GROUNDEDNESS,
  "reading-restraint": READING_RESTRAINT,
  "rubric-fit": RUBRIC_FIT,
};

export const allCalibrationItems = (judges: readonly JudgeId[] = JUDGE_IDS): CalibrationItem[] => judges.flatMap((j) => [...CALIBRATION[j]]);
