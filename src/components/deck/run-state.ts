// The state of a run as the screen sees it. A pure reducer over the messages of the stream, so the whole life of
// a run (streaming, result, not enabled yet, failure, interruption, a "not me" re-run) is testable without React.

import type { Field, TraceEvent } from "@/types";
import { MAX_TRACE_EVENTS } from "@/lib/agent/config";
import { mergeRerun } from "./grouping";
import type { RunMessage } from "./sse";
import type { PublicRunResult } from "./types";

export type RunPhase =
  /** Waiting for a run to start. */
  | "idle"
  /** A stream is open. */
  | "running"
  /** There is a result to show. */
  | "done"
  /** The picks switch is closed on the server. A calm state, not an error. */
  | "not_ready"
  /** The run failed and there is nothing to show. */
  | "failed";

export interface RunState {
  phase: RunPhase;
  events: TraceEvent[];
  result: PublicRunResult | null;
  /** The server's error code for `not_ready` and `failed`, or for a failed re-run. Never shown as text. */
  errorCode: string | null;
  /** A "not me" re-run that did not finish: the picks already on screen stay. */
  rerunError: string | null;
  /** Pick ids that arrived with the latest result and were not on screen before: only these take the reveal. Empty for a restored result. */
  freshIds: string[];
  /** Fields a "not me" re-run is refreshing. Empty for a full run. */
  refreshing: Field[];
  /** Entity ids set aside when the re-run started, so the merge drops them. */
  aside: string[];
  /** The current stream has delivered its result event. */
  received: boolean;
}

export type RunAction =
  | { type: "start"; refresh?: { fields: readonly Field[]; aside: readonly string[] } }
  | { type: "message"; message: RunMessage }
  /** The stream closed (reader finished or the connection dropped) without a `done` event. */
  | { type: "closed" };

export const initialRunState = (restored?: { result: PublicRunResult; events: TraceEvent[] }): RunState =>
  restored
    ? { phase: "done", events: restored.events, result: restored.result, errorCode: null, rerunError: null, freshIds: [], refreshing: [], aside: [], received: true }
    : { phase: "idle", events: [], result: null, errorCode: null, rerunError: null, freshIds: [], refreshing: [], aside: [], received: false };

function fail(state: RunState, code: string): RunState {
  // A failed re-run keeps everything on screen. A failed full run has nothing to show.
  if (state.result && state.refreshing.length > 0) return { ...state, phase: "done", rerunError: code, refreshing: [], aside: [] };
  return { ...state, phase: code === "picks_not_enabled" ? "not_ready" : "failed", errorCode: code, refreshing: [], aside: [] };
}

function finish(state: RunState): RunState {
  if (state.phase !== "running") return state;
  if (state.received) return { ...state, phase: "done" };
  return fail(state, "incomplete");
}

export function runReducer(state: RunState, action: RunAction): RunState {
  switch (action.type) {
    case "start": {
      const refresh = action.refresh;
      if (refresh && state.result) {
        return { ...state, phase: "running", errorCode: null, rerunError: null, refreshing: [...refresh.fields], aside: [...refresh.aside], received: false };
      }
      return { ...initialRunState(), phase: "running" };
    }
    case "message": {
      if (state.phase !== "running") return state; // anything after the end of a run (or before one starts) is ignored
      const m = action.message;
      switch (m.type) {
        case "trace":
          return { ...state, events: [...state.events, m.event].slice(-MAX_TRACE_EVENTS) };
        case "result": {
          const result = state.refreshing.length > 0 && state.result ? mergeRerun(state.result, m.result, state.refreshing, state.aside) : m.result;
          const before = new Set((state.result?.domains ?? []).flatMap((d) => d.picks.map((p) => p.id)));
          const freshIds = result.domains.flatMap((d) => d.picks.map((p) => p.id)).filter((id) => !before.has(id));
          return { ...state, result, received: true, freshIds, refreshing: [], aside: [] };
        }
        case "error":
          return fail(state, m.error.code);
        case "done":
          return finish(state);
      }
      return state;
    }
    case "closed":
      return finish(state);
  }
}

/** True while events can still arrive. */
export const isStreaming = (s: RunState): boolean => s.phase === "running";
