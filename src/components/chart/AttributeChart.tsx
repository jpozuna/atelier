'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import type { Axis, Field, Pick, PathHop } from '@/types';
import { FIELDS } from '@/types';
import { CHART_STRENGTH_CONNECTION } from '@/lib/agent/config';
import {
  FOCUS_RING_EXTRA,
  NODE_LABEL_OFFSET,
  connectionStroke,
  estimateTextWidth,
  layoutChart,
  navOrder,
  nextNavIndex,
  shapePath,
} from './geometry';
import type { AxisGeom, PickGeom } from './geometry';
import { FIELD_LABEL, markPath } from './marks';
import { resolveSelection } from './selection';
import { TagChip } from './TagChip';
import styles from './AttributeChart.module.css';

export interface AttributeChartProps {
  /** The profile's axes (6 to 8 read best). Order sets position, clockwise from the top. */
  axes: Axis[];
  /** Suggestions to place beyond the edge. Reads well with 6 and with 30. */
  picks: Pick[];
  /** Controlled selection of one suggestion. Omit to let the chart hold it. */
  selectedId?: string | null;
  /**
   * Controlled selection of several suggestions at once. When non-empty it wins over `selectedId`: every listed
   * suggestion is emphasised together (its path lines are drawn) and the rest are dimmed. The chart never builds
   * this set itself; the caller decides what a click adds or removes in `onSelect`.
   */
  selectedIds?: readonly string[];
  /**
   * A suggestion the caller is previewing, such as a list row under the mouse: emphasised and named like a hovered
   * node, but never a selection, so the readout below the plot does not open and the page height does not change.
   */
  previewId?: string | null;
  /**
   * Called when a node, a list button or a suggestion in a tag dialog is chosen. The chart sets nothing for a
   * controlled caller: it only reports the pick.
   */
  onSelect?: (pick: Pick) => void;
  /** Called when the selection is cleared with Escape. */
  onClear?: () => void;
  /** Accessible name for the chart. */
  label?: string;
  /**
   * Whether line weight encodes connection strength (and the legend says so). Pass false when every pick has the
   * same line weight, so the key never claims what the picture does not show.
   */
  showConnectionWeight?: boolean;
  /**
   * Content drawn after the key and before the plot, as wide as the key. Omit it and nothing extra is rendered.
   * The picks screen puts its suggestion list here.
   */
  aboveStage?: ReactNode;
  /**
   * Draw the pinned axis's "is made of" panel after the key and before the plot, instead of in the readout below
   * the plot. Default false. The taste screen sets it so the tags sit above the chart; the picks screen does not.
   */
  axisInfoAbove?: boolean;
  /**
   * Fields the caller has hidden (it has already taken their picks out of `picks`). Each key entry for one of these
   * reads as hidden: hollow dashed mark, struck label and "hidden" in its accessible name. Used only with `onToggleField`.
   */
  hiddenFields?: readonly Field[];
  /**
   * Fields to list in the key even when no pick in `picks` has them, so a field whose picks are all hidden can be
   * shown again. Listed in the chart's own field order. Used only with `onToggleField`. A hidden field left out of
   * this list drops out of the key and loses focus, so the caller should include every hidden field.
   */
  fieldsInKey?: readonly Field[];
  /**
   * Makes each key entry a button (aria-pressed: pressed means shown) that calls this with its field. Omit it and the
   * key is the plain, read-only list. The chart keeps no hidden state itself.
   */
  onToggleField?: (field: Field) => void;
  className?: string;
}

export interface CardBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type CardSide = 'right' | 'left' | 'above' | 'below';

/** Width the axis card aims for, the gap to the axis it describes, and the margin it keeps from the chart's edges. */
export const AXIS_CARD_WIDTH = 248;
export const AXIS_CARD_GAP = 8;
export const AXIS_CARD_EDGE = 4;
const CARD_PAD = 12;
const CARD_NAME_SIZE = 20; // --text-lg
const CARD_TAGS_SIZE = 15; // --text-sm
const CARD_NAME_LINE = 26; // times --leading-snug
const CARD_TAGS_LINE = 20; // times --leading-snug, rounded up
const CARD_KICKER = 20;

/**
 * A close, slightly generous guess at the card's size (the card is placed before it is drawn), from its text.
 * Width is capped by the room the chart has. Never smaller than the real card, so a placement that fits the guess
 * fits the card.
 */
export function estimateCardSize(name: string, tagNames: readonly string[], maxWidth: number): { w: number; h: number } {
  const w = Math.max(1, Math.min(AXIS_CARD_WIDTH, maxWidth));
  const inner = Math.max(1, w - CARD_PAD * 2);
  const lines = (text: string, size: number) => Math.max(1, Math.ceil((estimateTextWidth(text, size) * 1.08) / inner));
  const nameLines = lines(name, CARD_NAME_SIZE);
  const tagLines = tagNames.length > 0 ? lines(tagNames.join(', '), CARD_TAGS_SIZE) : 0;
  const h = CARD_PAD * 2 + nameLines * CARD_NAME_LINE + (tagNames.length > 0 ? CARD_KICKER + tagLines * CARD_TAGS_LINE : 0) + 4;
  return { w, h };
}

/**
 * Where the axis card goes, in the chart's own box. It prefers the side of the axis that faces away from the
 * centre, then the other sides in turn, and takes the first where the card fits wholly inside the box (both
 * dimensions) without touching the axis. Along the side it sits on it slides to stay inside. When `avoid` is given (a
 * disc, the plot area), sides that keep the card off the disc win over sides that cover it, as long as the card
 * fits; the narrow layout uses this to put the card outside the rim before it overlays the plot. If no side has room
 * it takes the one with the least overflow and clamps it. Pure, so it can be tested.
 */
export function placeAxisCard(
  anchor: CardBox,
  card: { w: number; h: number },
  bounds: { w: number; h: number },
  gap = AXIS_CARD_GAP,
  edge = AXIS_CARD_EDGE,
  avoid?: { x: number; y: number; r: number },
): { x: number; y: number; side: CardSide } {
  const clampTo = (v: number, lo: number, hi: number) => (hi < lo ? lo : Math.min(hi, Math.max(lo, v)));
  const cx = anchor.x + anchor.w / 2;
  const cy = anchor.y + anchor.h / 2;
  const slideX = clampTo(cx - card.w / 2, edge, bounds.w - card.w - edge);
  const slideY = clampTo(cy - card.h / 2, edge, bounds.h - card.h - edge);
  // How far the card is too big for the box across the side it sits on (0 when it can fit).
  const tooWide = Math.max(0, card.w + edge * 2 - bounds.w);
  const tooTall = Math.max(0, card.h + edge * 2 - bounds.h);

  // Position of a side, and how far past the box it overshoots in either dimension (0 when it fits).
  const at = (side: CardSide): { x: number; y: number; over: number } => {
    switch (side) {
      case 'right': {
        const x = anchor.x + anchor.w + gap;
        return { x, y: slideY, over: Math.max(0, x + card.w - (bounds.w - edge)) + tooTall };
      }
      case 'left': {
        const x = anchor.x - gap - card.w;
        return { x, y: slideY, over: Math.max(0, edge - x) + tooTall };
      }
      case 'below': {
        const y = anchor.y + anchor.h + gap;
        return { x: slideX, y, over: Math.max(0, y + card.h - (bounds.h - edge)) + tooWide };
      }
      default: {
        const y = anchor.y - gap - card.h;
        return { x: slideX, y, over: Math.max(0, edge - y) + tooWide };
      }
    }
  };

  const coversDisc = (x: number, y: number): boolean => {
    if (!avoid) return false;
    const nx = Math.min(x + card.w, Math.max(x, avoid.x));
    const ny = Math.min(y + card.h, Math.max(y, avoid.y));
    return Math.hypot(nx - avoid.x, ny - avoid.y) < avoid.r;
  };

  const dx = (cx - bounds.w / 2) / Math.max(1, bounds.w);
  const dy = (cy - bounds.h / 2) / Math.max(1, bounds.h);
  const outH: CardSide = dx >= 0 ? 'right' : 'left';
  const inH: CardSide = dx >= 0 ? 'left' : 'right';
  const outV: CardSide = dy >= 0 ? 'below' : 'above';
  const inV: CardSide = dy >= 0 ? 'above' : 'below';
  const order: CardSide[] = Math.abs(dx) >= Math.abs(dy) ? [outH, outV, inH, inV] : [outV, outH, inV, inH];

  const spots = order.map((side) => ({ side, ...at(side) }));
  const fitting = spots.filter((p) => p.over === 0);
  const chosen = fitting.find((p) => !coversDisc(p.x, p.y)) ?? fitting[0];
  if (chosen) return { x: chosen.x, y: chosen.y, side: chosen.side };

  const best = spots.reduce((a, b) => (b.over < a.over ? b : a));
  return {
    x: clampTo(best.x, edge, bounds.w - card.w - edge),
    y: clampTo(best.y, edge, bounds.h - card.h - edge),
    side: best.side,
  };
}

/**
 * Whether focus on an element came from the keyboard. A mouse click or a touch tap focuses an axis too, but does not
 * match `:focus-visible`. Where the selector is not supported (old browsers), treat focus as keyboard: a click then
 * pins the axis, which hides the card anyway.
 */
function focusIsVisible(el: Element): boolean {
  try {
    return el.matches(':focus-visible');
  } catch {
    return true;
  }
}

const INITIAL_WIDTH = 640;

function useElementWidth(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(INITIAL_WIDTH);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Measure at once, so a phone does not wait for the observer's first callback with the desktop-sized guess.
    const first = Math.round(el.getBoundingClientRect().width);
    if (first > 0) setWidth(first);
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) setWidth(Math.round(w));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

function hopText(hops: PathHop[]): string {
  return hops.map((h) => h.label).join(', then ');
}

const BRIDGED_NOTE = 'Bridged by the agent, no Qloo link.';

/** Only theme and lineage hops carry a sourced or inferred cue (docs/DECISIONS.md). Seed and pick hops carry none. */
function carriesCue(hop: PathHop): boolean {
  return hop.kind === 'theme' || hop.kind === 'lineage';
}

function PathTrail({ pick }: { pick: Pick }) {
  return (
    <>
      <ol className={styles.trail} aria-label={`Path to ${pick.name}`}>
        {pick.path.hops.map((hop, i) => {
          const cue = carriesCue(hop) ? hop.provenance : null;
          const word = cue === 'sourced' ? 'Sourced' : 'Inferred';
          return (
            <li key={`${hop.kind}-${i}`} className={styles.hop} data-kind={hop.kind}>
              {i > 0 ? <span className={styles.link} aria-hidden="true" /> : null}
              <span
                className={styles.hopBox}
                data-provenance={cue ?? undefined}
                aria-label={cue ? `${hop.label}, ${word.toLowerCase()}` : undefined}
              >
                <span className={styles.hopLabel}>{hop.label}</span>
                {cue ? <span className={styles.hopCue}>{word}</span> : null}
              </span>
            </li>
          );
        })}
      </ol>
      {pick.llmBridged ? <p className={styles.bridged}>{BRIDGED_NOTE}</p> : null}
    </>
  );
}

function FieldMark({ field, size, hollow = false }: { field: Field; size: number; hollow?: boolean }) {
  const box = size * 2 + 6;
  return (
    <svg width={box} height={box} viewBox={`${-box / 2} ${-box / 2} ${box} ${box}`} aria-hidden="true" focusable="false">
      <path d={markPath(field, size)} className={hollow ? styles.legendMarkHidden : styles.legendMark} />
    </svg>
  );
}

/**
 * One key entry as a toggle. Pressed means the field is shown. Hidden is drawn as a hollow dashed mark and a struck
 * label, and the word "hidden" joins the accessible name, so state never rests on color alone. The DOM id lets a
 * caller hand focus back to it.
 */
function KeyToggle({ field, hidden, onToggle }: { field: Field; hidden: boolean; onToggle: (field: Field) => void }) {
  return (
    <button
      type="button"
      id={`chart-key-${field}`}
      className={styles.keyToggle}
      aria-pressed={!hidden}
      onClick={() => onToggle(field)}
    >
      <FieldMark field={field} size={6} hollow={hidden} />
      <span className={styles.keyToggleLabel}>{FIELD_LABEL[field]}</span>
      {hidden ? <span className="sr-only">, hidden</span> : null}
    </button>
  );
}

/** Three labelled sample bars at the widths the chart draws for a light, a steady and a strong connection. */
function WeightSamples() {
  const samples = [
    { name: 'light', c: CHART_STRENGTH_CONNECTION.light },
    { name: 'steady', c: CHART_STRENGTH_CONNECTION.steady },
    { name: 'strong', c: CHART_STRENGTH_CONNECTION.strong },
  ];
  return (
    <span className={styles.samples}>
      {samples.map(({ name, c }) => (
        <span key={name} className={styles.sample}>
          <svg width={28} height={12} viewBox="0 0 28 12" aria-hidden="true" focusable="false">
            <line x1={3} y1={6} x2={25} y2={6} strokeWidth={connectionStroke(c)} className={styles.sampleLine} />
          </svg>
          {name}
        </span>
      ))}
    </span>
  );
}

export function AttributeChart({
  axes,
  picks,
  selectedId: selectedIdProp,
  selectedIds: selectedIdsProp,
  previewId = null,
  onSelect,
  onClear,
  label ='Your taste profile, with suggestions beyond its edge',
  showConnectionWeight = true,
  aboveStage,
  axisInfoAbove = false,
  hiddenFields,
  fieldsInKey,
  onToggleField,
  className,
}: AttributeChartProps) {
  const uid = useId();
  const [wrapRef, width] = useElementWidth();
  const layout = useMemo(() => layoutChart({ axes, picks, width }), [axes, picks, width]);

  const [innerSelected, setInnerSelected] = useState<string | null>(null);
  const controlled = selectedIdProp !== undefined || selectedIdsProp !== undefined;
  const picksById = useMemo(() => new Map(picks.map((p) => [p.id, p])), [picks]);
  // Which picks count as selected: see selection.ts for the precedence.
  const selectedPicks: Pick[] = resolveSelection(picks, {
    selectedId: selectedIdProp,
    selectedIds: selectedIdsProp,
    innerId: innerSelected,
  }).map((id) => picksById.get(id)!);
  const selectedSet = new Set(selectedPicks.map((p) => p.id));
  const hasSelection = selectedPicks.length > 0;

  // Hover and focus are tied to the `picks` array they were set against, so a new array drops them.
  const [hoverState, setHoverState] = useState<{ picks: Pick[]; id: string } | null>(null);
  const [focusState, setFocusState] = useState<{ picks: Pick[]; id: string } | null>(null);
  const hoverPick = hoverState && hoverState.picks === picks ? hoverState.id : null;
  const focusPick = focusState && focusState.picks === picks ? focusState.id : null;
  const [hoverAxis, setHoverAxis] = useState<string | null>(null);
  const [focusAxis, setFocusAxis] = useState<string | null>(null);
  // Focus that came from the keyboard (:focus-visible). Only this opens the card: a click or a tap also focuses the
  // axis, and the card must not stay behind after the pointer has gone.
  const [keyFocusAxis, setKeyFocusAxis] = useState<string | null>(null);
  const [pinnedAxis, setPinnedAxis] = useState<string | null>(null);
  const [stopId, setStopId] = useState<string | null>(null);

  const nodeRefs = useRef(new Map<string, SVGGElement>());

  const order = useMemo(() => navOrder(layout.picks), [layout.picks]);
  const byId = useMemo(() => new Map(layout.picks.map((p) => [p.id, p])), [layout.picks]);
  // The one tab stop among the nodes: the last one used, else the selection, else the first.
  const tabStop = [stopId, ...selectedPicks.map((p) => p.id)].find((id): id is string => !!id && byId.has(id)) ?? order[0] ?? null;

  // Emphasised: everything selected, plus the one under the pointer or focus, plus the caller's preview. A selection is
  // never hidden by a hover.
  const emphasisIds = new Set<string>();
  for (const id of [...selectedSet, hoverPick, focusPick, previewId]) if (id && byId.has(id)) emphasisIds.add(id);
  const activeAnchors = new Set<number>();
  for (const id of emphasisIds) for (const ai of byId.get(id)!.anchorIndexes) activeAnchors.add(ai);

  // Hover and focus only emphasise an axis. The tag chips need a steady home, so they show for the pinned axis only.
  const activeAxisId = hoverAxis ?? focusAxis ?? pinnedAxis;
  const pinnedAxisObj = axes.find((a) => a.id === pinnedAxis) ?? null;
  // The small card with an axis's name and tags: shown for the axis under the pointer, else the one with keyboard
  // focus. Never for the pinned axis, whose tag chips already show the same thing.
  const cardCandidate = hoverAxis ?? keyFocusAxis;
  const cardAxisId = cardCandidate !== null && cardCandidate !== pinnedAxis ? cardCandidate : null;
  const cardId = `${uid}-axiscard`;

  const choose = useCallback(
    (pick: Pick) => {
      if (!controlled) setInnerSelected(pick.id);
      onSelect?.(pick);
    },
    [controlled, onSelect],
  );

  const clear = useCallback(() => {
    if (!hasSelection) return;
    if (!controlled) setInnerSelected(null);
    onClear?.();
  }, [controlled, onClear, hasSelection]);

  useEffect(() => {
    if (layout.skipped.length > 0 && process.env.NODE_ENV !== 'production') {
      console.warn(`AttributeChart: ${layout.skipped.length} pick(s) have no usable reach and are not drawn.`);
    }
  }, [layout.skipped.length]);

  // Escape hides the card even when only the pointer is over the axis.
  const cardOpen = cardAxisId !== null;
  useEffect(() => {
    if (!cardOpen) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setHoverAxis(null);
      setFocusAxis(null);
      setKeyFocusAxis(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cardOpen]);

  const onNodeKeyDown = (e: KeyboardEvent<SVGGElement>, geom: PickGeom) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      choose(geom.pick);
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setHoverState(null);
      setFocusState(null);
      clear();
      return;
    }
    const idx = order.indexOf(geom.id);
    const next = nextNavIndex(e.key, idx, order.length);
    if (next !== null) {
      e.preventDefault();
      const id = order[next];
      setStopId(id);
      nodeRefs.current.get(id)?.focus();
    }
  };

  const closeAxes = () => {
    setPinnedAxis(null);
    setHoverAxis(null);
    setFocusAxis(null);
    setKeyFocusAxis(null);
  };

  /** Click, Enter or Space: pin the axis, or close the panel if this axis is already pinned. */
  const toggleAxis = (axis: Axis) => {
    if (pinnedAxis === axis.id) closeAxes();
    else {
      setPinnedAxis(axis.id);
      setHoverAxis(null);
      setKeyFocusAxis(null);
    }
  };

  const onAxisKeyDown = (e: KeyboardEvent<SVGGElement>, axis: Axis) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggleAxis(axis);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeAxes();
    }
  };

  // The text list holds every pick: placed ones in chart order, then any the chart could not place.
  const listPicks = [...order.map((id) => byId.get(id)!.pick), ...layout.skipped];
  // Extra key entries (and the hidden state) apply only when the key is interactive; otherwise it is as it always was.
  const presentFields = FIELDS.filter(
    (f) => picks.some((p) => p.field === f) || (onToggleField !== undefined && fieldsInKey?.includes(f) === true),
  );
  const hasPicks = picks.length > 0;
  // Line weight means something only when there are suggestions to draw lines to.
  const weightShown = showConnectionWeight && hasPicks;
  const showPickHint = hasPicks && selectedPicks.length === 0;
  const showAxisHint = pinnedAxisObj === null;
  const narrow = layout.axes.some((g) => g.marker !== null);
  const axisHintText = narrow ? 'Select a letter to see its axis and tags.' : 'Select an axis to see its tags.';
  // With `axisInfoAbove` the axis hint lives in the slot above the plot, so the line below keeps only the pick hint.
  const showAxisHintBelow = showAxisHint && !axisInfoAbove;
  const titleId = `${uid}-title`;
  const descId = `${uid}-desc`;
  const listId = `${uid}-list`;
  const { cx, cy, rProfile, rOuter, nodeRadius, hitRadius } = layout;

  // The card sits in the stage's box. The drawing is as wide as the stage down to a floor, below which it scales.
  const cardIndex = cardAxisId ? axes.findIndex((a) => a.id === cardAxisId) : -1;
  const cardAxis = cardIndex >= 0 ? axes[cardIndex] : null;
  const cardGeom = cardIndex >= 0 ? layout.axes[cardIndex] : undefined;
  let cardStyle: { left: number; top: number; width: number } | null = null;
  let cardSide: CardSide = 'below';
  if (cardAxis && cardGeom) {
    const scale = width < layout.size ? width / layout.size : 1;
    const bounds = { w: layout.size * scale, h: layout.viewHeight * scale };
    const anchor = {
      x: cardGeom.hit.x * scale,
      y: (cardGeom.hit.y - layout.viewY) * scale,
      w: cardGeom.hit.w * scale,
      h: cardGeom.hit.h * scale,
    };
    const size = estimateCardSize(cardAxis.label, cardAxis.tags.map((t) => t.name), bounds.w - AXIS_CARD_EDGE * 2);
    // Narrow, the plot fills the column: keep the card off the ring when there is room, else let it overlay the plot.
    const ring = narrow ? { x: cx * scale, y: (cy - layout.viewY) * scale, r: rOuter * scale } : undefined;
    const spot = placeAxisCard(anchor, size, bounds, AXIS_CARD_GAP, AXIS_CARD_EDGE, ring);
    cardSide = spot.side;
    cardStyle = { left: Math.round(spot.x), top: Math.round(spot.y), width: size.w };
  }

  // The pinned axis's tags. Drawn in the readout below the plot, or above the plot when `axisInfoAbove` is set.
  const axisPanel = pinnedAxisObj ? (
    <div className={styles.panel} id={`${uid}-axisinfo`}>
      <p className={styles.panelHead}>{pinnedAxisObj.label} is made of</p>
      <ul className={styles.chipList}>
        {pinnedAxisObj.tags.map((t) => (
          <li key={t.tag}>
            {hasPicks ? (
              <TagChip tag={t} picks={picks} selectedIds={selectedSet} onChoose={choose} />
            ) : (
              // Nothing to list yet, so the tag is a label, not a button.
              <span className={`${styles.chip} ${styles.chipStatic}`}>{t.name}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  ) : null;

  return (
    <figure className={`${styles.chart} ${className ?? ''}`}>
      <figcaption className={styles.key}>
        {presentFields.length > 0 ? (
          <ul className={onToggleField ? `${styles.legendList} ${styles.legendListToggles}` : styles.legendList} aria-label="Key">
            {presentFields.map((f) => (
              <li key={f} className={styles.legendItem}>
                {onToggleField ? (
                  <KeyToggle field={f} hidden={hiddenFields?.includes(f) === true} onToggle={onToggleField} />
                ) : (
                  <>
                    <FieldMark field={f} size={6} />
                    <span>{FIELD_LABEL[f]}</span>
                  </>
                )}
              </li>
            ))}
          </ul>
        ) : null}
        <p className={styles.legendNote}>
          <span>Farther out is less familiar.{weightShown ? ' A heavier line is a stronger connection.' : ''}</span>
          {weightShown ? <WeightSamples /> : null}
        </p>
        {narrow ? (
          <ol className={styles.axisKey} aria-label="Axes">
            {layout.axes.map((g) => (
              <li key={g.id} className={styles.axisKeyItem}>
                <span className={styles.axisKeyLetter} aria-hidden="true">
                  {g.letter}
                </span>
                <span>{g.label}</span>
              </li>
            ))}
          </ol>
        ) : null}
      </figcaption>

      {aboveStage ? <div className={styles.above}>{aboveStage}</div> : null}

      {axisInfoAbove ? (
        // Always present while `axisInfoAbove` is set and one row tall, so pinning or unpinning never moves the plot.
        <div className={styles.axisAbove}>
          {axisPanel ?? <p className={styles.axisHint}>{axisHintText}</p>}
        </div>
      ) : null}

      <div ref={wrapRef} className={styles.stage}>
        <svg
          className={styles.svg}
          width={layout.size}
          height={layout.viewHeight}
          viewBox={`0 ${layout.viewY} ${layout.size} ${layout.viewHeight}`}
          role="group"
          aria-labelledby={titleId}
          aria-describedby={descId}
          data-compact={layout.compact || undefined}
        >
          <title id={titleId}>{label}</title>
          <desc id={descId}>
            Axes are arranged around a ring, and the filled shape shows how far your taste reaches along each. Suggestions
            sit outside the ring. The farther out, the less familiar.
            {weightShown ? ' A heavier line to the shape means a stronger connection.' : ''} A text version
            follows the chart.
          </desc>

          {/* Guides: three hairline rings, an outer limit, and the spokes. */}
          <g className={styles.guides} aria-hidden="true">
            {[1 / 3, 2 / 3, 1].map((k) => (
              <circle key={k} cx={cx} cy={cy} r={rProfile * k} className={k === 1 ? styles.ringEdge : styles.ring} />
            ))}
            <circle cx={cx} cy={cy} r={rOuter} className={styles.ringLimit} />
          </g>

          {/* Profile shape. */}
          <path d={shapePath(layout.shape)} className={styles.shape} aria-hidden="true" />

          {/* Connection lines, behind the nodes. Weight is the encoding, so lines are never dimmed; the active
              pick's lines are drawn last, in the accent color. */}
          <g aria-hidden="true">
            {[...layout.picks].sort((x, y) => Number(emphasisIds.has(x.id)) - Number(emphasisIds.has(y.id))).map((g) => {
              const active = emphasisIds.has(g.id);
              const targets = active ? g.anchorIndexes : g.anchorIndexes.slice(0, 1);
              return targets.map((ai) => {
                const v = layout.axes[ai]?.vertex;
                if (!v) return null;
                return (
                  <line
                    key={`${g.id}-${ai}`}
                    x1={g.x}
                    y1={g.y}
                    x2={v.x}
                    y2={v.y}
                    className={active ? styles.lineActive : styles.line}
                    style={{ strokeWidth: g.strokeWidth }}
                  />
                );
              });
            })}
          </g>

          {/* Axes. */}
          {layout.axes.map((g: AxisGeom, i) => {
            const axis = axes[i];
            const pinned = pinnedAxis === axis.id;
            const emphasised = activeAxisId === axis.id || activeAnchors.has(i);
            return (
              <g
                key={axis.id}
                className={styles.axis}
                data-emphasised={emphasised || undefined}
                role="button"
                tabIndex={0}
                aria-expanded={pinned}
                aria-controls={pinned ? `${uid}-axisinfo` : undefined}
                aria-label={`${axis.label} axis. ${pinned ? 'Showing' : 'Show'} its tags`}
                aria-describedby={cardStyle && cardAxisId === axis.id ? cardId : undefined}
                onPointerEnter={() => setHoverAxis(axis.id)}
                onPointerLeave={() => setHoverAxis(null)}
                onFocus={(e) => {
                  setFocusAxis(axis.id);
                  if (focusIsVisible(e.currentTarget)) setKeyFocusAxis(axis.id);
                }}
                onBlur={() => {
                  setFocusAxis(null);
                  setKeyFocusAxis(null);
                }}
                onClick={() => toggleAxis(axis)}
                onKeyDown={(e) => onAxisKeyDown(e, axis)}
              >
                <line x1={cx} y1={cy} x2={g.tip.x} y2={g.tip.y} className={styles.spoke} />
                {emphasised ? <circle cx={g.vertex.x} cy={g.vertex.y} r={4} className={styles.vertex} /> : null}
                <rect
                  x={g.hit.x}
                  y={g.hit.y}
                  width={g.hit.w}
                  height={g.hit.h}
                  rx={4}
                  className={styles.axisHit}
                />
                {g.marker ? <circle cx={g.marker.x} cy={g.marker.y} r={g.marker.r} className={styles.axisMarker} /> : null}
                <text
                  className={`${styles.axisLabel} ${layout.compact ? styles.axisLabelCompact : ''} ${g.marker ? styles.axisLetter : ''}`}
                  textAnchor={g.textAnchor}
                >
                  {g.lines.map((l, k) => (
                    <tspan key={k} x={l.x} y={l.y}>
                      {l.text}
                    </tspan>
                  ))}
                </text>
              </g>
            );
          })}

          {/* Pick nodes. */}
          <g>
            {layout.picks.map((g, i) => {
              const active = emphasisIds.has(g.id);
              const selected = selectedSet.has(g.id);
              // Names on the chart only for the node under the pointer or focus, and for a sole selection. With
              // several selected the readout names each, so their labels cannot collide.
              const labelled =
                g.id === hoverPick || g.id === focusPick || g.id === previewId || (selectedPicks.length === 1 && selected);
              const { pick } = g;
              return (
                <g key={g.id} className={styles.nodeDim} data-dim={(emphasisIds.size > 0 && !active) || undefined}>
                <g className={styles.nodeWrap} style={{ ['--i' as string]: Math.min(i, 30) }}>
                  <g
                    ref={(el) => {
                      if (el) nodeRefs.current.set(g.id, el);
                      else nodeRefs.current.delete(g.id);
                    }}
                    className={styles.node}
                    data-active={active || undefined}
                    data-selected={selected || undefined}
                    transform={`translate(${g.x} ${g.y})`}
                    role="button"
                    tabIndex={g.id === tabStop ? 0 : -1}
                    aria-pressed={selected}
                    aria-label={`${pick.name}, ${FIELD_LABEL[pick.field]}. Path: ${hopText(pick.path.hops)}.${pick.llmBridged ? ` ${BRIDGED_NOTE}` : ''}`}
                    onPointerEnter={() => setHoverState({ picks, id: g.id })}
                    onPointerLeave={() => setHoverState(null)}
                    onFocus={() => {
                      setFocusState({ picks, id: g.id });
                      setStopId(g.id);
                    }}
                    onBlur={() => setFocusState(null)}
                    onClick={() => choose(pick)}
                    onKeyDown={(e) => onNodeKeyDown(e, g)}
                  >
                    <circle r={hitRadius} className={styles.hit} />
                    <circle r={nodeRadius + FOCUS_RING_EXTRA} className={styles.focusRing} />
                    <circle r={nodeRadius + 5} className={styles.selectedRing} />
                    <path d={markPath(pick.field, nodeRadius)} className={styles.mark} />
                    {labelled ? (
                      <text
                        className={styles.nodeLabel}
                        y={-(nodeRadius + NODE_LABEL_OFFSET)}
                        textAnchor={g.x > cx + rOuter * 0.4 ? 'end' : g.x < cx - rOuter * 0.4 ? 'start' : 'middle'}
                      >
                        {pick.name}
                      </text>
                    ) : null}
                  </g>
                </g>
                </g>
              );
            })}
          </g>
        </svg>
        {cardAxis && cardStyle ? (
          <div id={cardId} role="tooltip" className={styles.axisCard} data-side={cardSide} style={cardStyle}>
            <p className={styles.axisCardName}>{cardAxis.label}</p>
            <p className={styles.axisCardKicker}>Made of</p>
            <p className={styles.axisCardTags}>{cardAxis.tags.map((t) => t.name).join(', ')}</p>
          </div>
        ) : null}
      </div>

      <p className="sr-only" role="status">
        {selectedPicks.length === 1
          ? `Selected ${selectedPicks[0].name}. Path: ${hopText(selectedPicks[0].path.hops)}.`
          : selectedPicks.length > 1
            ? `Selected ${selectedPicks.length} suggestions: ${selectedPicks.map((p) => p.name).join(', ')}.`
            : ''}
      </p>

      {showPickHint || showAxisHintBelow ? (
        <p className={styles.hint}>
          {showPickHint ? 'Select a suggestion to see its path back to you.' : ''}
          {showPickHint && showAxisHintBelow ? ' ' : ''}
          {showAxisHintBelow ? axisHintText : ''}
        </p>
      ) : null}

      {(pinnedAxisObj && !axisInfoAbove) || selectedPicks.length > 0 ? (
        <div className={styles.readout}>
          {pinnedAxisObj && !axisInfoAbove ? axisPanel : null}
          {selectedPicks.map((pick) => (
            <div key={pick.id} className={styles.panel}>
              <p className={styles.panelHead}>
                {pick.name}
                <span className={styles.fieldTag}>{FIELD_LABEL[pick.field]}</span>
              </p>
              <PathTrail pick={pick} />
            </div>
          ))}
        </div>
      ) : null}

      <details className={styles.text} id={listId}>
        <summary className={styles.summary}>Read this chart as a list</summary>
        <h3 className={styles.listHead}>Axes</h3>
        <ul className={styles.textList}>
          {axes.map((axis) => (
            <li key={axis.id}>
              <strong>{axis.label}</strong>
              <span className={styles.muted}>: {axis.tags.map((t) => t.name).join(', ')}</span>
            </li>
          ))}
        </ul>
        <h3 className={styles.listHead}>Suggestions</h3>
        {picks.length === 0 ? (
          <p className={styles.hint}>No suggestions yet.</p>
        ) : (
          <ul className={styles.textList}>
            {listPicks.map((pick) => {
              const id = pick.id;
              return (
                <li key={id}>
                  <button
                    type="button"
                    className={styles.listButton}
                    aria-pressed={selectedSet.has(id)}
                    onClick={() => choose(pick)}
                  >
                    {pick.name}
                  </button>
                  <span className={styles.muted}>
                    {' '}
                    ({FIELD_LABEL[pick.field]}). Path: {hopText(pick.path.hops)}.
                    {pick.llmBridged ? ` ${BRIDGED_NOTE}` : ''}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </details>
    </figure>
  );
}
