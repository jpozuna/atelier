// Every sentence of the save, saved-list, follow-up and sign-in screens. Plain, a little reserved. No exclamation
// marks, no scores or ranks, no claim of a taste of the app's own (hard rule 7). copy.test.ts checks this.

import { REACTION_LABEL } from "@/components/card/helpers";
import type { Field, ReactionState } from "@/types";

const FIELD_WORD: Record<Field, string> = {
  music: "music",
  film: "film",
  tv: "TV",
  books: "books",
  food_places: "food and places",
  fashion: "fashion",
};

export const fieldWord = (f: Field): string => FIELD_WORD[f];

/**
 * The saved list's groups. A fixed, neutral order (the order the card offers its states), with no group above another.
 * Headings use the card's own labels, so one vocabulary runs through the card and the list.
 */
export const GROUP_ORDER = ["later", "will_try", "explore", "not_interested", "tried"] as const satisfies readonly ReactionState[];

export const GROUP_COPY: Record<(typeof GROUP_ORDER)[number], { title: string; gloss: string }> = {
  later: { title: REACTION_LABEL.later, gloss: "Not right now, still of interest." },
  will_try: { title: REACTION_LABEL.will_try, gloss: "A weaker pull, but you said you would." },
  explore: { title: REACTION_LABEL.explore, gloss: "You said yes to these." },
  not_interested: { title: REACTION_LABEL.not_interested, gloss: "You said these do not fit. Your reasons are kept." },
  tried: { title: REACTION_LABEL.tried, gloss: "You tried these." },
};

export const COPY = {
  // Saving from the picks screen.
  saving: "Saving.",
  saved: "Saved to your account.",
  seeSaved: "See what you have saved",
  signInToKeep: "To keep this, sign in. Your picks and what you wrote stay where they are.",
  signInLink: "Sign in with an emailed link",
  saveFailed: "That did not save. Try again in a moment.",
  saveNotReady: "Saving is not switched on yet.",
  saveSeedMissing: "That pick could not be saved with the seeds it came from.",
  saveTooManySeeds: "Your account already keeps as many of the things you love as it can hold, so this could not be added.",
  pendingWaiting: "You have picks waiting to be saved. Sign in to keep them.",
  pendingForget: "Forget the waiting picks",
  pendingConfirm: (n: number) => (n === 1 ? "Save the pick you chose before signing in?" : `Save the ${n} picks you chose before signing in?`),
  pendingConfirmNote: "They will be saved to the account you just signed in to. Say no if this is not your account.",
  pendingSave: "Save them",
  pendingSaved: "Your picks were saved to your account.",
  pendingRetry: "Try again",

  // The saved list.
  savedTitle: "Saved",
  savedPickTitle: "Saved pick",
  savedLede: "The picks you kept, grouped by what you chose for each. Each opens its stored card, and nothing is looked up again.",
  savedEmptyTitle: "Nothing saved yet",
  savedEmptyBody: "Save a pick from your picks and it will wait here.",
  savedEmptyLink: "Go to your picks",
  savedGuestTitle: "Sign in to see what you saved",
  savedGuestBody: "Saving needs an account. Sign in with an emailed link; there is no password.",
  savedGuestLink: "Sign in",
  savedUnavailableTitle: "Saved picks are not available yet",
  savedUnavailableBody: "Saving is not switched on on this server yet. Your picks are still in this tab.",
  savedFailedBody: "Your saved picks did not load. Try again in a moment.",
  savedNotSorted: "Not sorted yet",
  savedNotSortedGloss: "Kept, with no reaction yet.",
  signedInAs: (email: string) => `Signed in as ${email}.`,
  signedIn: "Signed in.",
  savedInBrowser: "Kept in this browser. No account needed.",
  signOut: "Sign out",
  allSaved: "All saved picks",
  yourWords: "In your words",
  likedWord: "You liked it.",
  mixedWord: "It was mixed.",
  notForMeWord: "It was not for you.",
  fromThrough: (seed: string | null, theme: string | null): string => (seed && theme ? `From ${seed}, through ${theme}` : seed ? `From ${seed}` : ""),

  // The follow-up on a saved pick.
  followHeading: "After you try it",
  followLede: "Say whether you tried it and how it went. Only this pick's field is looked at again.",
  triedLegend: "Did you try it?",
  triedYes: "Yes, I tried it",
  triedNotYet: "Not yet",
  notYetNote: "Come back when you have. Nothing changes until then.",
  howLegend: "How was it?",
  required: "Required",
  howLiked: "I liked it",
  howMixed: "Mixed",
  howNot: "It was not for me",
  whyLabel: "Why, in your own words",
  whyHint: "Optional. What stood out, or what did not fit.",
  submit: "Save what happened",
  update: "Update",
  unchanged: "Nothing has changed since you last saved this.",
  savedOnly: "Saved.",
  pickHow: "Choose how it was before saving.",
  followSaving: "Saving what you said.",
  followFailed: "That did not save. Try again in a moment.",
  followSignIn: "Your session has ended. Sign in again to save this.",
  followSignInLink: "Sign in",
  lookingAgain: (f: Field) => `Looking again at ${fieldWord(f)} with what you said.`,
  looked: (f: Field) => `Saved. ${cap(fieldWord(f))} has been looked at again with this in mind.`,
  lookedNothing: (f: Field) => `Saved. ${cap(fieldWord(f))} was looked at again and nothing new came back.`,
  lookedFailed: (f: Field) => `Saved. The new look at ${fieldWord(f)} did not come through. You can try again from your picks.`,
  lookedNoProfile: "Saved. The profile this pick came from is not on this device, so nothing was looked at again.",
  startAgain: "Start from your taste",
  addedSeed: "It will count as one of the things you love next time you look past the edge.",
  followDoneTitle: "Saved",
  lookedResting: "Saved. The demo is resting for now, so the field was not looked at again. Come back a little later.",
  lookedTooMany: "Saved. You have used your share of runs for now, so the field was not looked at again. Try again a little later.",
  furtherHeading: (f: Field) => `Further out in ${fieldWord(f)}`,
  furtherLede: "New picks from that field, found with your answer in mind. Each opens with its path back to you.",
  furtherNone: "No new picks in that field.",
  showPath: "Show path and reasons",
  hidePath: "Hide",

  // Sign in.
  signInTitle: "Sign in",
  signInLede: "Saving needs an account. Sign in with an emailed link, then confirm, and what you chose is saved. There is no password.",
  signInKeeps: "Your taste profile and picks stay as they are.",
  emailLabel: "Email address",
  sendLink: "Send the link",
  sending: "Sending.",
  sentTitle: "Check your email",
  sent: (email: string) => `A link is on its way to ${email}. Open it in this browser and it will bring you back. It works for one hour. If it does not arrive, look in your spam folder.`,
  sendAnother: "Use a different address",
  invalidEmail: "That does not look like an email address.",
  rateLimited: "A link was sent a moment ago. Wait a little and try again.",
  sendFailed: "The link could not be sent. Try again in a moment.",
  signInNotReady: "Signing in is not switched on yet.",
  linkFailed: "That link did not work. It may have expired, or been opened in a different browser. Send a new one.",
  alreadySignedIn: "You are signed in.",
  notNow: "Not now",
  continue: "Continue",
} as const;

function cap(s: string): string {
  return s.length > 0 ? s[0]!.toUpperCase() + s.slice(1) : s;
}
