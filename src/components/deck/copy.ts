import type { Field } from "@/types";
import { FIELD_LABEL } from "@/components/chart/marks";
import { isRestingCode, TOO_MANY_REQUESTS_CODE } from "@/lib/guard/resting";

// Wording of the picks screen: precise, plain, a little reserved. No exclamation marks, no praise, no scores.
// The server's own error text is never shown; the code picks one of these.

export { FIELD_LABEL };

const lower = (f: Field) => FIELD_LABEL[f].toLowerCase();

export const COPY = {
  title: "Beyond your list",
  lede:
    "Close picks come first: set aside any that are not you. Then picks from the edge of your taste, each with its path back to something you shared.",
  gettingReady: "Getting ready",
  chartLabel: "Your taste, with picks around its edge",
  working: "Reading your taste across fields. The steps appear here as they happen.",
  latestStep: "Latest step",
  lastStep: "Last step",
  stepsLabel: "Reasoning steps",
  readAllSteps: "Read all steps",
  ready: (count: number) => (count === 1 ? "One pick is ready." : `${count} picks are ready.`),

  noSession: "Your list is not here yet. Start with a few things you love, and your picks will follow.",
  noSessionLink: "Start with what you love",
  backToChart: "Back to your chart",

  // Calibration
  calibrationHeading: "Close to what you named",
  calibrationLede:
    "Some of these are in the same field as something you shared, and some are in another. If one is not you, set it aside. Only that field is looked at again, and the rest stay as they are.",
  sameField: (seed: string | null) => (seed ? `Same field as ${seed}` : "Same field as something you shared"),
  otherField: (seed: string | null) => (seed ? `A different field from ${seed}` : "A different field from something you shared"),
  notMe: "Not me",
  notMeLabel: (name: string) => `Not me: set aside ${name}`,
  settingAside: (name: string) => `${name} is set aside. Looking for a replacement.`,
  setAsideOnly: (name: string) => `${name} is set aside. Enough re-runs for now, so no replacement is looked for. Carry on with what is here.`,
  notMeWaiting: "Not me is unavailable while picks are still being found. Try again once the steps finish.",
  rerunning: "Looking again at that field.",
  rerunFailed: "A replacement could not be found just now. The pick you set aside stays set aside.",
  calibrationEmpty: "No close picks are left in the fields you are showing.",

  // Edge
  edgeHeading: "At the edge of your taste",
  edgeLede:
    "Moderate, high and extreme are three degrees of distance from the centre of your profile. Each one is connected to something you shared, and none is a measure of how much you will like it.",
  fieldsHeading: "Fields",
  fieldsHint: "Hide a field you do not want to see. It leaves the chart too, and showing it again needs no new look-up.",
  shown: "Shown",
  hidden: "Hidden",
  hideField: (f: Field) => `Hide ${lower(f)}`,
  hiddenAnnounce: (f: Field) => `${FIELD_LABEL[f]} is hidden.`,
  shownAnnounce: (f: Field) => `${FIELD_LABEL[f]} is shown.`,
  deckEmpty: (f: Field) => `Nothing connected closely enough in ${lower(f)} this time.`,
  noDegree: (degree: string) => `No pick at the ${degree.toLowerCase()} degree here.`,
  allHidden: "Every field is hidden. Show one to see its picks.",

  // Tiles
  tileName: (name: string, field: string, degree: string) => `${name}, ${field}, ${degree}`,
  fromThrough: (seed: string | null, theme: string | null) =>
    seed && theme ? `From ${seed}, through ${theme}` : seed ? `From ${seed}` : theme ? `Through ${theme}` : "",

  // Selected card
  selectedLabel: "Selected pick",
  noneSelected: "Select a mark on the chart or a card below to read its path.",
  close: "Close",
  chartRegion: "Chart",

  // Reasoning
  reasoningTitle: "Reasoning",
  reasoningLabel: "Reasoning",

  // States
  notReadyTitle: "Picks aren't ready yet",
  notReadyBody:
    "Your chart is ready, and picks at the edge of it will appear here once they are switched on. Nothing is wrong with your list, and nothing was lost.",
  failedTitle: "The picks did not arrive",
  failedBody: "Something interrupted the run before it could finish. Your list and chart are untouched.",
  failedBusy: "Several runs are in progress. Try again in a moment.",
  failedLimit: "The taste graph is busy. Try again in a moment.",
  retry: "Try again",

  // The demo is resting (daily allowance, monthly reserve, or paused by hand) or this visitor has used their share.
  restingTitle: "The demo is resting",
  restingBody: "The demo is resting for now. Your list and chart are kept here; try again later.",
  tooManyTitle: "A lot of runs just now",
  tooManyBody: "You have used your runs for now. Your list and chart are kept here; try again a little later.",
  restingRerun: "The demo is resting for now, so no replacement could be looked for. The pick you set aside stays set aside.",
  tooManyRerun: "A lot of runs just now, so no replacement could be looked for. The pick you set aside stays set aside. Try again a little later.",
} as const;

const isTooMany = (code: string | null) => code === TOO_MANY_REQUESTS_CODE || code === "http_429";

/** One of the calm sentences for a run that failed, by the server's error code. */
export function failedBodyFor(code: string | null): string {
  if (isRestingCode(code)) return COPY.restingBody;
  if (isTooMany(code)) return COPY.tooManyBody;
  switch (code) {
    case "busy":
      return COPY.failedBusy;
    case "rate_limited":
      return COPY.failedLimit;
    default:
      return COPY.failedBody;
  }
}

/** The heading above a failed run: resting and too many are calm states, not a failure. */
export function failedTitleFor(code: string | null): string {
  if (isRestingCode(code)) return COPY.restingTitle;
  if (isTooMany(code)) return COPY.tooManyTitle;
  return COPY.failedTitle;
}

/** The note under the decks when a "not me" re-run failed. */
export function rerunFailedFor(code: string | null): string {
  if (isRestingCode(code)) return COPY.restingRerun;
  if (isTooMany(code)) return COPY.tooManyRerun;
  return COPY.rerunFailed;
}
