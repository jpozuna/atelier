'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { Axis, Field, Pick, PathHop } from '@/types';
import { FIELDS } from '@/types';
import { CHART_STRENGTH_CONNECTION } from '@/lib/agent/config';
import { FOCUS_RING_EXTRA, NODE_LABEL_OFFSET, connectionStroke, layoutChart, navOrder, nextNavIndex, shapePath } from './geometry';
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
  className?: string;
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

function FieldMark({ field, size }: { field: Field; size: number }) {
  const box = size * 2 + 6;
  return (
    <svg width={box} height={box} viewBox={`${-box / 2} ${-box / 2} ${box} ${box}`} aria-hidden="true" focusable="false">
      <path d={markPath(field, size)} className={styles.legendMark} />
    </svg>
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
  onSelect,
  onClear,
  label = 'Your taste profile, with suggestions beyond its edge',
  showConnectionWeight = true,
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
  const [pinnedAxis, setPinnedAxis] = useState<string | null>(null);
  const [stopId, setStopId] = useState<string | null>(null);

  const nodeRefs = useRef(new Map<string, SVGGElement>());

  const order = useMemo(() => navOrder(layout.picks), [layout.picks]);
  const byId = useMemo(() => new Map(layout.picks.map((p) => [p.id, p])), [layout.picks]);
  // The one tab stop among the nodes: the last one used, else the selection, else the first.
  const tabStop = [stopId, ...selectedPicks.map((p) => p.id)].find((id): id is string => !!id && byId.has(id)) ?? order[0] ?? null;

  // Emphasised: everything selected, plus the one under the pointer or focus. A selection is never hidden by a hover.
  const emphasisIds = new Set<string>();
  for (const id of [...selectedSet, hoverPick, focusPick]) if (id && byId.has(id)) emphasisIds.add(id);
  const activeAnchors = new Set<number>();
  for (const id of emphasisIds) for (const ai of byId.get(id)!.anchorIndexes) activeAnchors.add(ai);

  // Hover and focus only emphasise an axis. The tag chips need a steady home, so they show for the pinned axis only.
  const activeAxisId = hoverAxis ?? focusAxis ?? pinnedAxis;
  const pinnedAxisObj = axes.find((a) => a.id === pinnedAxis) ?? null;

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
  };

  /** Click, Enter or Space: pin the axis, or close the panel if this axis is already pinned. */
  const toggleAxis = (axis: Axis) => {
    if (pinnedAxis === axis.id) closeAxes();
    else {
      setPinnedAxis(axis.id);
      setHoverAxis(null);
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
  const presentFields = FIELDS.filter((f) => picks.some((p) => p.field === f));
  const hasPicks = picks.length > 0;
  // Line weight means something only when there are suggestions to draw lines to.
  const weightShown = showConnectionWeight && hasPicks;
  const showPickHint = hasPicks && selectedPicks.length === 0;
  const showAxisHint = pinnedAxisObj === null;
  const narrow = layout.axes.some((g) => g.marker !== null);
  const titleId = `${uid}-title`;
  const descId = `${uid}-desc`;
  const listId = `${uid}-list`;
  const { cx, cy, rProfile, rOuter, nodeRadius, hitRadius } = layout;

  return (
    <figure className={`${styles.chart} ${className ?? ''}`}>
      <figcaption className={styles.key}>
        {presentFields.length > 0 ? (
          <ul className={styles.legendList} aria-label="Key">
            {presentFields.map((f) => (
              <li key={f} className={styles.legendItem}>
                <FieldMark field={f} size={6} />
                <span>{FIELD_LABEL[f]}</span>
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
                onPointerEnter={() => setHoverAxis(axis.id)}
                onPointerLeave={() => setHoverAxis(null)}
                onFocus={() => setFocusAxis(axis.id)}
                onBlur={() => setFocusAxis(null)}
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
              const labelled = g.id === hoverPick || g.id === focusPick || (selectedPicks.length === 1 && selected);
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
      </div>

      <p className="sr-only" role="status">
        {selectedPicks.length === 1
          ? `Selected ${selectedPicks[0].name}. Path: ${hopText(selectedPicks[0].path.hops)}.`
          : selectedPicks.length > 1
            ? `Selected ${selectedPicks.length} suggestions: ${selectedPicks.map((p) => p.name).join(', ')}.`
            : ''}
      </p>

      {showPickHint || showAxisHint ? (
        <p className={styles.hint}>
          {showPickHint ? 'Select a suggestion to see its path back to you.' : ''}
          {showPickHint && showAxisHint ? ' ' : ''}
          {showAxisHint ? (narrow ? 'Select a letter to see its axis and tags.' : 'Select an axis to see its tags.') : ''}
        </p>
      ) : null}

      {pinnedAxisObj || selectedPicks.length > 0 ? (
        <div className={styles.readout}>
          {pinnedAxisObj ? (
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
          ) : null}
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
