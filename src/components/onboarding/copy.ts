import type { Field } from "@/types";
import { FIELD_LABEL } from "@/components/chart/marks";
import { isRestingCode, TOO_MANY_REQUESTS_CODE } from "@/lib/guard/resting";

// Calm, plain wording (atelier-design). No exclamation marks, no scores, no praise.

export { FIELD_LABEL };

/** What to type, per field, for the label and the placeholder. */
export const FIELD_PROMPT: Record<Field, { noun: string; example: string }> = {
  music: { noun: "an artist or band", example: "A band you return to" },
  film: { noun: "a film", example: "A film you can rewatch" },
  tv: { noun: "a TV show", example: "A series you finished" },
  books: { noun: "a book", example: "A book you underlined" },
  food_places: { noun: "a restaurant, cafe or place", example: "A place you go back to" },
  fashion: { noun: "a fashion brand", example: "A label you notice" },
};

export const COPY = {
  title: "What do you love?",
  intro:
    "It takes a few minutes. Name a few things you love, in at least two fields, and say in a line why. Your answers draw the chart of your taste. Nothing here is a score.",
  firstHeading: "Start with something you love",
  nextHeading: "Add another",
  fieldLabel: "Field",
  queryLabel: (noun: string) => `Name ${noun}`,
  whyLabel: "Why do you love it?",
  whyHint: "One short line. The reason matters more than the name.",
  find: "Find it",
  finding: "Looking",
  change: "Not this one",
  confirmedHeading: "Matched to",
  chooseHeading: "Which did you mean?",
  chooseHint: "Choose one of these.",
  missing: "We could not find that. Check the spelling, or try a shorter or fuller name.",
  lookupBusy: "Lookups are busy for a moment. Please try again shortly.",
  resting: "The demo is resting for now. Your list and chart are kept here; try again later.",
  tooMany: "A lot of searches just now. Try again in a minute.",
  lookupFailed: "Something went wrong while looking that up. Please try again.",
  profileFailed: "Something went wrong while drawing your chart. Please try again.",
  queryShort: (min: number) => `Type at least ${min} characters.`,
  queryLong: (max: number) => `Keep it to ${max} characters or fewer.`,
  whyRequired: "Add a line on why you love it.",
  whyShort: (min: number) => `Say a little more, at least ${min} characters.`,
  whyLong: (max: number) => `Keep it to ${max} characters or fewer.`,
  needMatch: "Find it and choose the match first.",
  duplicate: "That one is already on your list.",
  atMax: (max: number) => `Your list is full at ${max}. Remove one to make room.`,
  add: "Add to my list",
  added: (name: string) => `Added ${name}.`,
  addedUnmapped: (name: string) =>
    `Added ${name}. The reason could not be read into themes just now, so this one counts on its name alone.`,
  removed: (name: string) => `Removed ${name}.`,
  listHeading: "Your list",
  listEmpty: "Nothing yet. What you add will appear here.",
  remove: (name: string) => `Remove ${name}`,
  removeVisible: "Remove",
  seeTaste: "See my taste",
  building: "Drawing your chart",
  profileEmpty: "A chart could not be drawn from these. Try adding something else.",
  profileNoEntities: "None of these could be matched to something a chart can be drawn from. Try adding another.",
  tasteTitle: "Your taste",
  tasteIntro:
    "These are the themes running through what you love. Open an axis to see what it is made of. The chart is drawn from your list, and the reasoning shows how.",
  tasteMissing: "There is no chart to show yet. Start by adding what you love.",
  backToList: "Back to my list",
  startOver: "Start over",
  confirmStartOver: "Clear your list and your chart?",
  confirmYes: "Yes, start over",
  confirmNo: "Keep them",
  gettingReady: "Getting ready",
  chartHeading: "Your chart",
  chartLabel: "Your taste, drawn as an attribute chart",
  afterHeading: "Next",
  opening: "Opening",
  readingWhy: "Reading your reason",
  interruptedNote: "Your reason wasn't read before you left. Remove and re-add this seed to try again.",
  unmappedNote: "This reason could not be read into themes, so it counts on the name alone.",
  shortfall: (got: number) =>
    `Fewer themes than usual came through, so the chart has ${got} axes. Adding something from another field can fill it out.`,
  readyNow: "You can see your taste now, or add more first.",
  readyFull: (max: number) => `Your list is full at ${max}. You can see your taste now.`,
  fullNeedsField: (max: number) =>
    `Your list is full at ${max}. Remove one and add one from another field to see your taste.`,
  needFirst: (seeds: number, fields: number) => `Add ${seeds} things across at least ${fields} fields to see your taste.`,
  needMore: (needed: number, moreFields: number) => {
    const things = needed === 1 ? "thing" : "things";
    const extra =
      moreFields === 0
        ? ""
        : moreFields === 1
          ? needed === 1
            ? ", in a different field,"
            : ", one of them in a different field,"
          : `, ${moreFields} of them in other fields,`;
    return `Add ${needed} more ${things}${extra} to see your taste.`;
  },
  matchedTo: (label: string) => `Matched to ${label}.`,
  nextStep: "Look past the edge",
  nextStepHint: "Next come suggestions from other fields, each with its path back to what you love.",
  skippedNote: (n: number) =>
    n === 1 ? "One item could not be used for the chart." : `${n} items could not be used for the chart.`,
} as const;

/** Map an API error code to calm copy. The server's own message is never shown. */
export function messageForError(code: string | undefined, status: number | undefined, kind: "lookup" | "profile"): string {
  // Resting (demo_resting, budget, lookups_off) and a visitor over their share are calm states, not failures.
  if (isRestingCode(code)) return COPY.resting;
  if (code === TOO_MANY_REQUESTS_CODE || (code === undefined && status === 429)) return COPY.tooMany;
  if (code === "rate_limited") return COPY.lookupBusy;
  if (code === "no_usable_seeds") return COPY.profileNoEntities;
  if (code === "empty_profile") return COPY.profileEmpty;
  if (status === 503) return COPY.lookupBusy;
  return kind === "lookup" ? COPY.lookupFailed : COPY.profileFailed;
}

/** True for the two calm states (resting, too many requests): shown as a quiet note, not a red error. */
export function isCalmError(code: string | undefined): boolean {
  return isRestingCode(code) || code === TOO_MANY_REQUESTS_CODE;
}
