// Trace fixtures are JSONL: one TraceEvent per line (schema in src/types/trace.ts). Blank lines are ignored.
// `qloo_call` events may also carry the T-03 extras (redacted params, source, ms, outcome, runLiveCalls).

import { isTraceEvent, type TraceEvent } from "@/types";
import type { QlooCallTraceEvent } from "@/lib/qloo/types";

export function parseTraceJsonl(text: string, label = "trace"): TraceEvent[] {
  const events: TraceEvent[] = [];
  text.split("\n").forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch {
      throw new Error(`${label}:${i + 1}: not valid JSON`);
    }
    if (!isTraceEvent(json)) throw new Error(`${label}:${i + 1}: not a TraceEvent (check kind and its fields against src/types/trace.ts)`);
    events.push(json);
  });
  return events;
}

export const isQlooCall = (e: TraceEvent): e is Extract<TraceEvent, { kind: "qloo_call" }> => e.kind === "qloo_call";

/** True when a qloo_call event has the T-03 extras (a params object). */
export function hasCallExtras(e: TraceEvent): e is QlooCallTraceEvent {
  return e.kind === "qloo_call" && typeof (e as { params?: unknown }).params === "object" && (e as { params?: unknown }).params !== null;
}

/**
 * A live attempt went over the network, whether or not it succeeded. Cache hits and shared in-flight calls are not
 * live. A refusal made before sending (param_invalid, budget, cache_miss, config) has source "none" and no status.
 * An attempt that failed after sending also has source "none", but carries the HTTP status when one came back.
 * A network failure with no status is caught by the client's running `runLiveCalls` count instead (see call-budget).
 */
export function isLiveCall(e: Extract<TraceEvent, { kind: "qloo_call" }>): boolean {
  if (e.cached) return false;
  const source = (e as { source?: string }).source;
  if (source === undefined) return true;
  if (source === "live") return true;
  return source === "none" && e.status !== undefined;
}
