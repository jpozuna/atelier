// How a saved reaction state maps to a run signal. Pure.

import type { ReactionState } from "@/types";
import type { RunSignal } from "./types";

const SIGNAL_OF: Record<ReactionState, RunSignal> = {
  later: "saved_later",
  will_try: "saved_try",
  explore: "saved_explore",
  not_interested: "not_interested",
  tried: "tried",
};

export function signalOfReaction(state: ReactionState): RunSignal {
  return SIGNAL_OF[state];
}
