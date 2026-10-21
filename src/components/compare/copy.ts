import type { Field } from "@/types";
import { FIELD_LABEL } from "@/components/chart/marks";
import { UNGROUNDED_LABEL } from "./constants";

// Wording of the comparison: precise, plain, a little reserved. No exclamation marks, no praise, no scores, and no
// claim about which list is better. The server's own error text is never shown; the code picks one of these.

export { FIELD_LABEL };

export const COPY = {
  title: "Grounded and ungrounded",
  lede:
    "The same list, answered two ways. On the left, the picks Atelier made from your list, each with its path back to something you named. On the right, a plain model given only your list and your reasons.",
  gettingReady: "Getting ready",

  noRunTitle: "There is nothing to compare yet",
  noRun: "This view sets Atelier's picks beside a plain model's, so it needs a run to read. Make your picks first, then come back.",
  noRunLink: "Go to your picks",

  differenceHeading: "What differs",
  difference: [
    "Each Atelier pick keeps a stored path: the seed you named, a theme you share, sometimes a lineage step, then the pick. The explanation is written from that path, and each connecting step says whether it is sourced or inferred.",
    "The plain model saw only what you typed and why. It names picks and gives one line of reasoning, but it has no link to the taste graph and no source to show, so there is no path to check.",
    "This page does not say which list suits you better. That is yours to judge.",
  ],

  atelierHeading: "Atelier, with paths",
  atelierNote: "Taken from your stored run. Nothing is fetched again.",
  plainHeading: "Plain model, ungrounded",
  plainNote: "Written by a model from your list and reasons alone.",
  ungrounded: UNGROUNDED_LABEL,

  askHeading: "The plain model's side",
  askBody: "One model call is made for this list of yours, then kept, so looking again costs nothing. Nothing from Atelier's picks is sent.",
  askButton: "Ask a plain model",
  askingStatus: "Asking a plain model. This can take a few seconds.",
  readyStatus: "The plain model's list is ready.",
  retry: "Try again",

  notAsked: "Not asked yet.",
  jumpToPlain: "Jump to the plain model's list",
  emptyField: "Nothing came back for this field.",
  noAtelierInField: "Atelier has no pick here.",
  fieldHeading: (f: Field) => FIELD_LABEL[f],

  errorModelOff: "The plain-model side is not available here, so only Atelier's picks are shown.",
  errorBusy: "The comparison is resting for now. Atelier's picks are still here; try the plain model's side later.",
  errorUnusable: "The plain model gave nothing that could be shown. You can try again.",
  errorUpstream: "The plain model could not be reached. You can try again.",
  errorBadRequest: "The list could not be sent. Go back to your picks and return.",
  errorNetwork: "Could not reach the server. Check your connection and try again.",
  backToPicks: "Back to your picks",
} as const;

/** The sentence for a failed ask. A code is one of the route's, or `network`. Anything else gets the generic one. */
export function failedFor(code: string | null): string {
  switch (code) {
    case "model_off":
      return COPY.errorModelOff;
    case "too_many_requests":
    case "http_429":
    case "http_503":
    case "demo_resting":
      return COPY.errorBusy;
    case "unusable":
      return COPY.errorUnusable;
    case "bad_request":
      return COPY.errorBadRequest;
    case "network":
      return COPY.errorNetwork;
    default:
      return COPY.errorUpstream;
  }
}

/** A resting or limited state is calm (muted, announced politely). Real failures are not (an alert). */
export function isCalm(code: string | null): boolean {
  return code === "model_off" || code === "too_many_requests" || code === "demo_resting" || code === "http_429" || code === "http_503";
}

/** Whether trying again can help. Not when the model is off or the request itself is wrong. */
export function canRetry(code: string | null): boolean {
  return code !== "model_off" && code !== "bad_request";
}
