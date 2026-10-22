import type { FocusEvent, PointerEvent } from "react";

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
