import type { FocusEvent, PointerEvent } from "react";
import type { Field } from "@/types";
import type { RunMessage } from "./sse";
import type { PublicRunResult } from "./types";

/**
 * Props that make a row preview its node on the chart while the mouse is over it or it has keyboard focus, and
 * stop when either ends. The chart has no hover prop for this, so the screen passes the previewed id through the
 * chart's `selectedIds` for as long as it lasts. A touch tap does not preview (a tap would leave it stuck).
 */
export function previewProps(id: string, onPreview: ((id: string | null) => void) | undefined) {
  if (!onPreview) return {};
  return {
    onPointerEnter: (e: PointerEvent) => {
      if (e.pointerType === "mouse") onPreview(id);
    },
    onPointerLeave: (e: PointerEvent) => {
      if (e.pointerType === "mouse") onPreview(null);
    },
    onFocus: () => onPreview(id),
    onBlur: (e: FocusEvent) => {
      // Moving between the row's own controls keeps the preview.
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onPreview(null);
    },
  };
}

/** One timed step of a synthetic stream. */
export interface DomainStep {
  /** Milliseconds after the stream opens. */
  at: number;
  message: RunMessage;
}

/**
 * The `domain` events of a synthetic run, one field at a time, `stepMs` apart from `startMs`, so the early arrival can
 * be seen on /picks/preview. `order` is the completion order (default: the result's own); fields missing from the result
 * are skipped. Pure: the caller sets the timers (PicksDemo, T-34).
 */
export function domainSteps(result: PublicRunResult, startMs: number, stepMs: number, order?: readonly Field[]): DomainStep[] {
  const fields = order ?? result.domains.map((d) => d.domain);
  const steps: DomainStep[] = [];
  for (const field of fields) {
    const domain = result.domains.find((d) => d.domain === field);
    if (domain) steps.push({ at: startMs + stepMs * steps.length, message: { type: "domain", domain } });
  }
  return steps;
}
