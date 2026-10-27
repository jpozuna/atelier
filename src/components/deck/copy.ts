import type { Field } from "@/types";
import { FIELD_LABEL } from "@/components/chart/marks";
import { isRestingCode, TOO_MANY_REQUESTS_CODE } from "@/lib/guard/resting";

// Wording of the picks screen: precise, plain, a little reserved. No exclamation marks, no praise, no scores.
// The server's own error text is never shown; the code picks one of these.

export { FIELD_LABEL };

const lower = (f: Field) => FIELD_LABEL[f].toLowerCase();

export const COPY = {
  title: "Beyond your list",
  lede: "Close picks first, then picks from your taste's edge, each with its path back to you.",
  gettingReady: "Getting ready",
  chartLabel: "Your taste, with picks around its edge",
  working: "Reading your taste across fields. Your suggestions appear here when they are ready.",
  ready: (count: number) => (count === 1 ? "One pick is ready." : `${count} picks are ready.`),

  noSession: "Your list is not here yet. Start with a few things you love, and your picks will follow.",
  noSessionLink: "Start with what you love",
  backToChart: "Back to your chart",

  // Calibration
  calibrationHeading: "Close to what you named",
  calibrationLede: "Close to something you named. If one is not you, set it aside. Only that field is looked at again.",
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
    "Stretch is distance from your profile's centre. Each links to something you shared; none predicts how much you will like it.",
  fieldsHeading: "Fields",
  fieldsHint: "Hide a field you do not want to see. It leaves the chart too, and showing it again needs no new look-up.",
  hidden: "Hidden",
  hideField: (f: Field) => `Hide ${lower(f)}`,
  hiddenAnnounce: (f: Field) => `${FIELD_LABEL[f]} is hidden.`,
  shownAnnounce: (f: Field) => `${FIELD_LABEL[f]} is shown.`,
  deckEmpty: (f: Field) => `Nothing connected closely enough in ${lower(f)} this time.`,
  noDegree: (degree: string) => `No pick at the ${degree.toLowerCase()} degree here.`,
  allHidden: "Every field is hidden. Show one to see its picks.",

  // The list
  listLabel: "Suggestions at the edge of your taste",
  sortLabel: "Sort by",
  sortField: "Field",
  sortStretch: "Stretch",
  stretchLabel: (word: string) => `${word.charAt(0).toUpperCase()}${word.slice(1)} stretch`,
  /** Said first inside the scrolling list, so a screen-reader user knows how many rows there are. */
  listSummary: (n: number) => (n === 1 ? "1 suggestion." : `${n} suggestions, in a list that scrolls.`),
  moreBelow: "More below",
  checkLabel: (name: string) => `Show ${name} on the chart`,
  onChart: (n: number) => (n === 1 ? "1 suggestion on the chart" : `${n} suggestions on the chart`),
  clear: "Clear",
  openOnChart: "Open, on the chart",
  clearLabel: "Clear the suggestions shown on the chart",
  cleared: "The chart is cleared.",
  addedAnnounce: (name: string, axis: string | null) => (axis ? `${name} is on the chart, beside ${axis}.` : `${name} is on the chart.`),
  beside: (axis: string) => `Beside ${axis}`,
  viewChart: "View chart",
  backToList: "Back to the list",
  chartBarLabel: "Suggestions on the chart",
  panelLabel: "Close picks and reasoning",
  removedAnnounce: (name: string) => `${name} is off the chart.`,

  // Tiles
  tileName: (name: string, field: string, degree: string) => `${name}, ${field}, ${degree}`,
  fromThrough: (seed: string | null, theme: string | null) =>
    seed && theme ? `From ${seed}, through ${theme}` : seed ? `From ${seed}` : theme ? `Through ${theme}` : "",

  // The reasoning area
  selectedLabel: "Reasoning for the selected suggestion",
  reasoningTitle: "Reasoning",
  reasoningLabel: "Reasoning",
  reasoningEmpty:
    "Select a suggestion in the list or on the chart to read why it was chosen and how it connects back to you. Tick several to see them together on the chart.",
  whereEdge: (axis: string | null, word: string) => (axis ? `On the chart: beside ${axis}, at ${word} stretch.` : `On the chart: at ${word} stretch.`),
  whereClose: (axis: string | null) => (axis ? `On the chart: beside ${axis}, very close to what you named.` : "On the chart: very close to what you named."),
  alsoShown: (n: number) => (n === 1 ? "One other suggestion is on the chart with it." : `${n} other suggestions are on the chart with it.`),
  sourcesHeading: "Sources",
  sourcedWord: "Sourced",
  sourceOf: (label: string) => `Source: ${label}`,
  viewSource: "View source",
  linkMissing: "Link unavailable.",
  readingFrom: "A reading is included, taken from retrieved text.",
  backToSuggestions: "Back to suggestions",
  chartRegion: "Chart",

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
