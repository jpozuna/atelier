'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { Axis, Field, Pick, PathHop } from '@/types';
import { FIELDS } from '@/types';
import { layoutChart, navOrder, nextNavIndex, shapePath } from './geometry';
import type { AxisGeom, PickGeom } from './geometry';
import { FIELD_LABEL, markPath } from './marks';
import styles from './AttributeChart.module.css';

export interface AttributeChartProps {
  /** The profile's axes (6 to 8 read best). Order sets position, clockwise from the top. */
  axes: Axis[];
  /** Suggestions to place beyond the edge. Reads well with 6 and with 30. */
  picks: Pick[];
  /** Controlled selection. Omit to let the chart hold it. */
  selectedId?: string | null;
  /** Called when a node is chosen by click, Enter or Space. */
  onSelect?: (pick: Pick) => void;
  /** Called when the selection is cleared with Escape. */
  onClear?: () => void;
  /** Accessible name for the chart. */
  label?: string;
  className?: string;
}

const INITIAL_WIDTH = 640;

function useElementWidth(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(INITIAL_WIDTH);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
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

export function AttributeChart({
  axes,
  picks,
  selectedId: selectedIdProp,
  onSelect,
  onClear,
  label = 'Your taste profile, with suggestions beyond its edge',
  className,
}: AttributeChartProps) {
  const uid = useId();
  const [wrapRef, width] = useElementWidth();
  const layout = useMemo(() => layoutChart({ axes, picks, width }), [axes, picks, width]);

  const [innerSelected, setInnerSelected] = useState<string | null>(null);
  const controlled = selectedIdProp !== undefined;
  const selectedId = controlled ? selectedIdProp : innerSelected;

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
  const tabStop = [stopId, selectedId].find((id): id is string => !!id && byId.has(id)) ?? order[0] ?? null;

  const activePickId = [hoverPick, focusPick, selectedId].find((id): id is string => !!id && byId.has(id)) ?? null;
  const activeGeom = activePickId ? byId.get(activePickId)! : null;
  const selectedPick = selectedId ? (picks.find((p) => p.id === selectedId) ?? null) : null;
  const shownPick = activeGeom?.pick ?? selectedPick;
  const activeAnchors = new Set(activeGeom ? activeGeom.anchorIndexes : []);

  const activeAxisId = hoverAxis ?? focusAxis ?? pinnedAxis;
  const activeAxis = axes.find((a) => a.id === activeAxisId) ?? null;

  const choose = useCallback(
    (pick: Pick) => {
      if (!controlled) setInnerSelected(pick.id);
      onSelect?.(pick);
    },
    [controlled, onSelect],
  );

  const clear = useCallback(() => {
    if (!selectedId) return;
    if (!controlled) setInnerSelected(null);
    onClear?.();
  }, [controlled, onClear, selectedId]);

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
  const titleId = `${uid}-title`;
  const descId = `${uid}-desc`;
  const listId = `${uid}-list`;
  const { cx, cy, rProfile, rOuter, nodeRadius, hitRadius } = layout;

  return (
    <figure className={`${styles.chart} ${className ?? ''}`}>
      <div ref={wrapRef} className={styles.stage}>
        <svg
          className={styles.svg}
          width={layout.size}
          height={layout.size}
          viewBox={`0 0 ${layout.size} ${layout.size}`}
          role="group"
          aria-labelledby={titleId}
          aria-describedby={descId}
          data-compact={layout.compact || undefined}
        >
          <title id={titleId}>{label}</title>
          <desc id={descId}>
            Axes are arranged around a ring, and the filled shape shows how far your taste reaches along each. Suggestions
            sit outside the ring. The farther out, the less familiar. A heavier line to the shape means a stronger
            connection. A text version follows the chart.
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
            {[...layout.picks].sort((x, y) => Number(x.id === activePickId) - Number(y.id === activePickId)).map((g) => {
              const active = g.id === activePickId;
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
                aria-controls={`${uid}-axisinfo`}
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
                <text
                  className={`${styles.axisLabel} ${layout.compact ? styles.axisLabelCompact : ''}`}
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
              const active = g.id === activePickId;
              const selected = g.id === selectedId;
              const { pick } = g;
              return (
                <g key={g.id} className={styles.nodeDim} data-dim={(activePickId && !active) || undefined}>
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
                    <circle r={nodeRadius + 11} className={styles.focusRing} />
                    <circle r={nodeRadius + 5} className={styles.selectedRing} />
                    <path d={markPath(pick.field, nodeRadius)} className={styles.mark} />
                    {active ? (
                      <text
                        className={styles.nodeLabel}
                        y={-(nodeRadius + 12)}
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
        {selectedPick ? `Selected ${selectedPick.name}. Path: ${hopText(selectedPick.path.hops)}.` : ''}
      </p>

      <div className={styles.readout}>
        <div className={styles.panel} id={`${uid}-axisinfo`}>
          {activeAxis ? (
            <>
              <p className={styles.panelHead}>{activeAxis.label} is made of</p>
              <ul className={styles.tagList}>
                {activeAxis.tags.map((t) => (
                  <li key={t.tag}>{t.name}</li>
                ))}
              </ul>
            </>
          ) : (
            <p className={styles.hint}>Select an axis to see its tags.</p>
          )}
        </div>
        <div className={styles.panel}>
          {shownPick ? (
            <>
              <p className={styles.panelHead}>
                {shownPick.name}
                <span className={styles.fieldTag}>{FIELD_LABEL[shownPick.field]}</span>
              </p>
              <PathTrail pick={shownPick} />
            </>
          ) : (
            <p className={styles.hint}>Select a suggestion to see its path back to you.</p>
          )}
        </div>
      </div>

      <figcaption className={styles.legend}>
        <ul className={styles.legendList} aria-label="Key">
          {presentFields.map((f) => (
            <li key={f} className={styles.legendItem}>
              <FieldMark field={f} size={6} />
              <span>{FIELD_LABEL[f]}</span>
            </li>
          ))}
        </ul>
        <p className={styles.legendNote}>Farther out is less familiar. A heavier line is a stronger connection.</p>
      </figcaption>

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
                    aria-pressed={id === selectedId}
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
