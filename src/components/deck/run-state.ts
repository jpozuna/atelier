// The state of a run as the screen sees it. A pure reducer over the messages of the stream, so the whole life of
// a run (streaming, result, not enabled yet, failure, interruption, a "not me" re-run) is testable without React.

import { FIELDS } from "@/types";
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
  /** Final only: the result event of the current stream, or the one restored from storage. Storage saves this and never `partial`. */
  result: PublicRunResult | null;
  /**
   * Picks that arrived early, one `domain` event per field, while the stream is open (or after it broke). Same shape as
   * `result`, but its `plan` and `meta` are empty (full run) or the ones of `result` (re-run): never save it or send it back
   * to the server. Full run: just the fields that have arrived. Re-run: `result` with each arrived field merged in (the
   * same rules as `mergeRerun`). Cleared on the `result` event, on `start` and when a re-run fails or is cut (the stored `result`
   * is shown again); a failed or cut full run keeps it. A picks' `explain` trace events may not have
   * arrived yet, so nothing here assumes them.
   */
  partial: PublicRunResult | null;
  /** Fields whose `domain` event has arrived in the current stream, in arrival order. */
  arrived: Field[];
  /** The server's error code for `not_ready` and `failed`, or for a failed re-run. Never shown as text. */
  errorCode: string | null;
  /** A "not me" re-run that did not finish: the picks already on screen stay. */
  rerunError: string | null;
  /**
   * Pick ids that arrived in the current stream (by `domain` or `result`) and were not in `result` before it: only these take
   * the reveal. Empty for a restored result. Grows as `domain` events arrive; the final `result` keeps the ids already listed.
   */
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
    ? { phase: "done", events: restored.events, result: restored.result, partial: null, arrived: [], errorCode: null, rerunError: null, freshIds: [], refreshing: [], aside: [], received: true }
    : { phase: "idle", events: [], result: null, partial: null, arrived: [], errorCode: null, rerunError: null, freshIds: [], refreshing: [], aside: [], received: false };

/** Ids of the picks in `next` that `base` (the result already on screen before this stream) does not have. */
function newIds(next: PublicRunResult, base: PublicRunResult | null): string[] {
  const before = new Set((base?.domains ?? []).flatMap((d) => d.picks.map((p) => p.id)));
  return next.domains.flatMap((d) => d.picks.map((p) => p.id)).filter((id) => !before.has(id));
}

function fail(state: RunState, code: string): RunState {
  // A failed or cut re-run falls back to the stored result: `partial`, `arrived` and the fresh ids of the early merge are
  // cleared, so what is on screen is what is saved and what a later "not me" sends. (The old result's picks were already
  // revealed, so `freshIds` goes back to empty.) A failed full run has nothing to show except what already arrived: `partial`
  // and `arrived` are kept (the picks stay visible; the error code is set as always).
  if (state.result && state.refreshing.length > 0) {
    return { ...state, phase: "done", rerunError: code, partial: null, arrived: [], freshIds: [], refreshing: [], aside: [] };
  }
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
        return { ...state, phase: "running", partial: null, arrived: [], errorCode: null, rerunError: null, refreshing: [...refresh.fields], aside: [...refresh.aside], received: false };
      }
      return { ...initialRunState(), phase: "running" };
    }
    case "message": {
      if (state.phase !== "running") return state; // anything after the end of a run (or before one starts) is ignored
      const m = action.message;
      switch (m.type) {
        case "trace":
          return { ...state, events: [...state.events, m.event].slice(-MAX_TRACE_EVENTS) };
        case "domain": {
          if (state.received) return state; // the final result is in: a late domain event must not shrink the view
          const field = m.domain.domain;
          if (state.arrived.includes(field)) return state; // each field once
          if (state.refreshing.length > 0 && state.result) {
            if (!state.refreshing.includes(field)) return state; // a re-run only touches the fields it refreshes
            const base = state.partial ?? state.result;
            const one: PublicRunResult = { domains: [m.domain], plan: { themes: [], requeries: [] }, meta: { requeries: [], notRequeried: [] } };
            // mergeRerun replaces the plan and meta of a refreshed field with the incoming ones: keep the result's own.
            const partial: PublicRunResult = { ...mergeRerun(base, one, [field], state.aside), plan: state.result.plan, meta: state.result.meta };
            return { ...state, partial, arrived: [...state.arrived, field], freshIds: newIds(partial, state.result) };
          }
          const domains = [...(state.partial?.domains ?? []), m.domain].sort((a, b) => FIELDS.indexOf(a.domain) - FIELDS.indexOf(b.domain));
          const partial: PublicRunResult = { domains, plan: { themes: [], requeries: [] }, meta: { requeries: [], notRequeried: [] } };
          return { ...state, partial, arrived: [...state.arrived, field], freshIds: newIds(partial, state.result) };
        }
        case "result": {
          const result = state.refreshing.length > 0 && state.result ? mergeRerun(state.result, m.result, state.refreshing, state.aside) : m.result;
          return { ...state, result, partial: null, arrived: [], received: true, freshIds: newIds(result, state.result), refreshing: [], aside: [] };
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

/**
 * Fields still expected in the open stream: a full run expects every field, a re-run the fields it refreshes, minus the ones
 * whose `domain` event has arrived. Empty when no stream is open (after a failure, the missing fields are the ones not in
 * `arrived`; the screen decides what to say about them).
 */
export function pendingFields(s: RunState): Field[] {
  if (s.phase !== "running") return [];
  const expected = s.refreshing.length > 0 ? s.refreshing : FIELDS;
  return expected.filter((f) => !s.arrived.includes(f));
}

/** What to draw: the early picks while they are the newest, else the final result. See the T-35 hand-off. */
export const shownResult = (s: RunState): PublicRunResult | null => s.partial ?? s.result;
