"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import styles from "./ReasoningPanel.module.css";
import { announcementText, buildSteps } from "./helpers";
import type { ReasoningStep, RenderContext } from "./helpers";

/** Minimum gap between spoken updates, so a burst of events reads as one update. */
const DEFAULT_ANNOUNCE_EVERY_MS = 1500;

export type ReasoningPanelProps = {
  /**
   * Trace events so far, in order. Append-only: pass the accumulated list on every render
   * (state that grows as events arrive from the stream). Cached Qloo calls in the list are ignored. Typed
   * `unknown[]` on purpose: an event that fails the `TraceEvent` contract renders a neutral line instead of throwing.
   */
  events: readonly unknown[];
  /** True while the run is still producing events. Drives the polite announcements and the "continues" note. */
  streaming?: boolean;
  /** Seed id -> what the user typed, so lines can name seeds. Ids are never displayed. Memoize it (or define it outside render). */
  seedNames?: RenderContext["seedNames"];
  /** Pick id -> display name, so lines can name picks. Ids are never displayed. Memoize it (or define it outside render). */
  pickNames?: RenderContext["pickNames"];
  /** Visible heading text. Default "Reasoning". */
  title?: string;
  /**
   * Render as a labelled region (`section`, named by the heading). Default true. Pass false when the panel sits
   * inside a container that is already a labelled "Reasoning" landmark (such as the Shell's side region), so
   * screen readers do not hear it twice. The heading still shows.
   */
  landmark?: boolean;
  /** Heading level, so the panel fits the page outline. Default 2. */
  headingLevel?: 2 | 3 | 4;
  /** Initial collapsed state when uncontrolled. Default open. */
  defaultOpen?: boolean;
  /** Controlled open state. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Minimum ms between spoken updates. */
  announceEveryMs?: number;
};

/** One step. Animates in once when it first appears; expanding a collapsed panel does not replay it. */
function StepItem({ step }: { step: ReasoningStep }) {
  const [entering, setEntering] = useState(true);
  const tone = step.tone === "quiet" ? styles.quiet : step.tone === "notice" ? styles.notice : "";
  return (
    <li
      className={`${styles.step} ${tone} ${entering ? styles.entering : ""}`}
      onAnimationEnd={() => setEntering(false)}
    >
      <span className={styles.label}>{step.label}</span>
      <span className={styles.text}>{step.text}</span>
      {step.detail ? <span className={styles.detail}>{step.detail}</span> : null}
    </li>
  );
}

/**
 * The visible reasoning: one plain line per step of the agent's trace. Streams in order, collapses,
 * and tells screen readers about new steps politely (latest step only, rate-limited).
 * Readable without the chart. Never shows ids, raw params, scores or call counts.
 */
export function ReasoningPanel({
  events,
  streaming = false,
  seedNames,
  pickNames,
  title = "Reasoning",
  landmark = true,
  headingLevel = 2,
  defaultOpen = true,
  open: openProp,
  onOpenChange,
  announceEveryMs = DEFAULT_ANNOUNCE_EVERY_MS,
}: ReasoningPanelProps) {
  const [openState, setOpenState] = useState(defaultOpen);
  const open = openProp ?? openState;
  const uid = useId();
  const listId = `${uid}-steps`;
  const Wrapper = landmark ? "section" : "div";
  const Heading = `h${headingLevel}` as "h2" | "h3" | "h4";

  const steps = useMemo(() => buildSteps(events, { seedNames, pickNames }), [events, seedNames, pickNames]);

  function toggle() {
    const next = !open;
    if (openProp === undefined) setOpenState(next);
    onOpenChange?.(next);
  }

  // Polite live region: only the latest step, at most once per interval. State is set inside a timer.
  // `closePending` is raised while streaming and cleared only when the closing line has actually been spoken,
  // so an effect re-run after streaming stops cannot drop it.
  const latest = steps.length ? steps[steps.length - 1].text : undefined;
  const [spoken, setSpoken] = useState("");
  const lastSpokenAt = useRef(0);
  const closePending = useRef(false);
  useEffect(() => {
    if (streaming) closePending.current = true;
    const text = announcementText(latest, streaming, closePending.current);
    if (!text) return;
    const wait = Math.max(0, announceEveryMs - (Date.now() - lastSpokenAt.current));
    const id = setTimeout(() => {
      lastSpokenAt.current = Date.now();
      if (!streaming) closePending.current = false;
      setSpoken(text);
    }, wait);
    return () => clearTimeout(id);
  }, [latest, streaming, announceEveryMs]);

  return (
    <Wrapper className={styles.panel} {...(landmark ? { "aria-labelledby": `${uid}-title` } : {})}>
      <div className={styles.head}>
        <Heading id={`${uid}-title`} className={styles.title}>
          {title}
        </Heading>
        <button
          type="button"
          className={styles.toggle}
          aria-expanded={open}
          aria-controls={listId}
          onClick={toggle}
        >
          {open ? "Hide" : "Show"}
          <span className="sr-only"> {title.toLowerCase()}</span>
        </button>
      </div>

      <div id={listId} hidden={!open}>
        {steps.length === 0 ? (
          <p className={styles.empty}>Steps appear here as Atelier works through what you shared.</p>
        ) : (
          <ol className={styles.steps}>
            {steps.map((s) => (
              <StepItem key={s.key} step={s} />
            ))}
          </ol>
        )}
        {streaming && steps.length > 0 ? <p className={styles.more}>More steps will follow.</p> : null}
      </div>

      {/* Visually hidden, polite. Holds one sentence at a time, so it never rereads the list. */}
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {spoken}
      </p>
    </Wrapper>
  );
}
