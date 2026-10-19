/*
 * Pure geometry and layout for the attribute chart. No React, no DOM, so it is unit-testable in the node
 * environment. All lengths are in px: the SVG viewBox equals the rendered width, so 1 unit is 1 px and touch
 * targets can be sized honestly.
 *
 * Encodings (hard rule 7: nothing here produces a number for the user):
 *  - profile shape: radius along each axis follows the axis weight, relative to the heaviest axis
 *  - pick radius: reach (a position on the frontier), always outside the profile ring
 *  - pick line weight: connection strength
 */
import type { Axis, Pick } from '@/types';
import { CONNECTION_FLOOR, CONNECTION_NORM } from '@/lib/agent/config';

export const TAU = Math.PI * 2;

export interface Point {
  x: number;
  y: number;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function clamp01(v: number): number {
  return Number.isFinite(v) ? clamp(v, 0, 1) : 0;
}

/** Angle of axis `i` of `n`, starting at 12 o'clock and going clockwise (SVG y points down). */
export function axisAngle(i: number, n: number): number {
  return -Math.PI / 2 + (n > 0 ? i / n : 0) * TAU;
}

export function polar(cx: number, cy: number, r: number, angle: number): Point {
  return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
}

/** Radius along each axis from its weight, relative to the heaviest axis. */
export function profileRadii(weights: number[], rMin: number, rMax: number): number[] {
  const max = Math.max(0, ...weights.map((w) => (Number.isFinite(w) ? w : 0)));
  return weights.map((w) => {
    if (max <= 0 || !Number.isFinite(w)) return rMin;
    return rMin + clamp01(w / max) * (rMax - rMin);
  });
}

export interface StrokeRange {
  min: number;
  max: number;
}

export const DEFAULT_STROKE_RANGE: StrokeRange = { min: 1, max: 4 };

/**
 * Highest value `Pick.connection` can take. Config defines connection = min(1, sum(weight * rarity)) / CONNECTION_NORM,
 * so the ceiling is 1 / CONNECTION_NORM. Deriving it keeps the scale right when the norm is tuned.
 */
export const CONNECTION_CEILING = 1 / CONNECTION_NORM;

/** Line weight from connection strength. Floor-clearing picks span the range; below the floor it clamps to min. */
export function connectionStroke(
  connection: number,
  range: StrokeRange = DEFAULT_STROKE_RANGE,
  floor: number = CONNECTION_FLOOR,
  ceiling: number = CONNECTION_CEILING,
): number {
  const span = ceiling - floor;
  const t = span > 0 ? clamp01((connection - floor) / span) : 1;
  return range.min + t * (range.max - range.min);
}

/** Axes a pick connects to, via the tag ids its path shares with each axis. Strongest first. */
export function anchorAxes(pick: Pick, axes: Axis[]): { index: number; hits: number }[] {
  const wanted = new Set<string>(pick.path.sharedTags);
  for (const hop of pick.path.hops) {
    if (hop.kind === 'theme') for (const t of hop.tags ?? []) wanted.add(t);
  }
  const out: { index: number; hits: number }[] = [];
  axes.forEach((axis, index) => {
    let hits = 0;
    for (const tag of axis.tags) if (wanted.has(tag.tag)) hits += 1;
    if (hits > 0) out.push({ index, hits });
  });
  out.sort((a, b) => b.hits - a.hits || axes[b.index].weight - axes[a.index].weight || a.index - b.index);
  return out;
}

/** Greedy word wrap for axis labels. A single long word is never split. */
export function wrapLabel(label: string, maxChars: number): string[] {
  const words = label.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [''];
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    if (line === '') line = word;
    else if ((line + ' ' + word).length <= maxChars) line += ' ' + word;
    else {
      lines.push(line);
      line = word;
    }
  }
  lines.push(line);
  return lines;
}

export type TextAnchor = 'start' | 'middle' | 'end';

export interface LabelLine {
  text: string;
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Rough text width for layout. Deliberately generous, so labels fit rather than clip. */
export function estimateTextWidth(text: string, fontSize: number): number {
  return text.length * fontSize * 0.58;
}

/** Breathing room between the widest label and the viewBox edge. */
export const LABEL_EDGE_PAD = 10;

export interface AxisGeom {
  id: string;
  index: number;
  label: string;
  angle: number;
  /** Profile vertex: where the shape reaches along this axis. */
  vertex: Point;
  /** End of the axis spoke (the profile ring). */
  tip: Point;
  textAnchor: TextAnchor;
  lines: LabelLine[];
  /** Estimated bounds of the label text. */
  box: Rect;
  /** Pointer and focus target around the label, at least 44 by 44. */
  hit: Rect;
}

export interface PickGeom {
  id: string;
  pick: Pick;
  /** Index into `axes` of the axis the pick sits beside. */
  axisIndex: number;
  /** Axes the path touches, strongest first. The first is `axisIndex`. */
  anchorIndexes: number[];
  angle: number;
  radius: number;
  x: number;
  y: number;
  strokeWidth: number;
}

export interface ChartLayout {
  size: number;
  compact: boolean;
  cx: number;
  cy: number;
  /** Radius of the profile ring: the largest the shape can be. */
  rProfile: number;
  /** Outer limit of pick nodes. */
  rOuter: number;
  nodeRadius: number;
  hitRadius: number;
  labelFontSize: number;
  axes: AxisGeom[];
  shape: Point[];
  /** Picks placed on the chart, in input order. */
  picks: PickGeom[];
  /** Picks left off the chart because their reach is missing or not a number. They still belong in the text list. */
  skipped: Pick[];
  /** Radius range for pick nodes: reach 0 sits at `nodeInnerR`, reach 1 at `nodeOuterR`. */
  nodeInnerR: number;
  nodeOuterR: number;
  /** Smallest centre-to-centre distance between two nodes after layout (Infinity with fewer than two). */
  minSeparation: number;
}

export interface LayoutInput {
  axes: Axis[];
  picks: Pick[];
  width: number;
}

export const COMPACT_BELOW = 520;
export const MIN_WIDTH = 280;
export const MAX_WIDTH = 860;

/** Index of the axis a pick belongs beside; falls back to the heaviest axis when its path touches none. */
function primaryAxis(pick: Pick, axes: Axis[]): { primary: number; anchors: number[] } {
  const anchors = anchorAxes(pick, axes).map((a) => a.index);
  if (anchors.length > 0) return { primary: anchors[0], anchors: anchors.slice(0, 3) };
  let best = 0;
  axes.forEach((a, i) => {
    if (a.weight > axes[best].weight) best = i;
  });
  return { primary: best, anchors: [] };
}

function chord(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Spread picks around their axis, then nudge apart by angle only, so radius (reach) is never altered.
 * Deterministic: same input, same output.
 */
function relaxAngles(angles: number[], radii: number[], cx: number, cy: number, minDist: number): number[] {
  const a = angles.slice();
  const n = a.length;
  for (let iter = 0; iter < 120; iter += 1) {
    let moved = false;
    for (let i = 0; i < n; i += 1) {
      for (let j = i + 1; j < n; j += 1) {
        const pi = polar(cx, cy, radii[i], a[i]);
        const pj = polar(cx, cy, radii[j], a[j]);
        const d = chord(pi, pj);
        if (d >= minDist) continue;
        const dr = radii[i] - radii[j];
        const arcNeeded = Math.sqrt(Math.max(minDist * minDist - dr * dr, 0));
        const rAvg = Math.max((radii[i] + radii[j]) / 2, 1);
        let dTheta = a[j] - a[i];
        // Wrap to (-PI, PI]
        dTheta = Math.atan2(Math.sin(dTheta), Math.cos(dTheta));
        const sign = dTheta === 0 ? (j > i ? 1 : -1) : Math.sign(dTheta);
        const shift = (arcNeeded - Math.abs(dTheta) * rAvg) / 2 / rAvg + 1e-4;
        a[i] -= sign * shift;
        a[j] += sign * shift;
        moved = true;
      }
    }
    if (!moved) break;
  }
  return a;
}

export function layoutChart({ axes, picks, width }: LayoutInput): ChartLayout {
  const size = clamp(Number.isFinite(width) ? width : 640, MIN_WIDTH, MAX_WIDTH);
  const compact = size < COMPACT_BELOW;
  const cx = size / 2;
  const cy = size / 2;
  const nodeRadius = size < 360 ? 6 : compact ? 7 : 8;
  const hitRadius = 22; // 44 px touch target
  const labelFontSize = compact ? 13 : 15; // matches --text-xs and --text-sm at a 16px root
  const n = axes.length;

  // Labels first: the widest wrapped line sets how much room the rim must leave on each side.
  const wrapped = axes.map((axis) => wrapLabel(axis.label, compact ? 10 : 16));
  const widest = Math.max(0, ...wrapped.flat().map((l) => estimateTextWidth(l, labelFontSize)));
  const labelGap = compact ? 12 : 20;
  const rOuter = Math.max(size / 2 - labelGap - widest - LABEL_EDGE_PAD, 48);
  const rProfile = rOuter * (compact ? 0.42 : 0.52);

  const radii = profileRadii(
    axes.map((a) => a.weight),
    rProfile * 0.22,
    rProfile,
  );
  const lh = labelFontSize * 1.25;
  const axisGeoms: AxisGeom[] = axes.map((axis, index) => {
    const angle = axisAngle(index, n);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const lines = wrapped[index];
    const textAnchor: TextAnchor = cos > 0.3 ? 'start' : cos < -0.3 ? 'end' : 'middle';
    const anchorPt = polar(cx, cy, rOuter + labelGap, angle);
    // Vertical placement: above the anchor at the top, below at the bottom, centred at the sides.
    const blockH = (lines.length - 1) * lh;
    let firstY: number;
    if (sin < -0.5) firstY = anchorPt.y - blockH;
    else if (sin > 0.5) firstY = anchorPt.y + labelFontSize * 0.8;
    else firstY = anchorPt.y - blockH / 2 + labelFontSize * 0.35;
    const textW = Math.max(...lines.map((l) => estimateTextWidth(l, labelFontSize)));
    const boxX = textAnchor === 'start' ? anchorPt.x : textAnchor === 'end' ? anchorPt.x - textW : anchorPt.x - textW / 2;
    const boxY = firstY - labelFontSize * 0.9;
    const boxH = blockH + labelFontSize * 1.2;
    const hitW = Math.max(hitRadius * 2, textW + 16);
    const hitH = Math.max(hitRadius * 2, boxH + 12);
    let hit: Rect = { x: boxX + textW / 2 - hitW / 2, y: boxY + boxH / 2 - hitH / 2, w: hitW, h: hitH };
    // Safety net: slide the label back inside the viewBox if the estimate ran long.
    const dx = hit.x < 0 ? -hit.x : hit.x + hit.w > size ? size - (hit.x + hit.w) : 0;
    const dy = hit.y < 0 ? -hit.y : hit.y + hit.h > size ? size - (hit.y + hit.h) : 0;
    hit = { ...hit, x: hit.x + dx, y: hit.y + dy };
    return {
      id: axis.id,
      index,
      label: axis.label,
      angle,
      vertex: polar(cx, cy, radii[index], angle),
      tip: polar(cx, cy, rProfile, angle),
      textAnchor,
      lines: lines.map((text, k) => ({ text, x: anchorPt.x + dx, y: firstY + dy + k * lh })),
      box: { x: boxX + dx, y: boxY + dy, w: textW, h: boxH },
      hit,
    };
  });

  // Picks: radius from reach, angle from the anchor axis, then relaxed.
  const gap = nodeRadius + (compact ? 6 : 10);
  const innerR = rProfile + gap;
  const outerR = Math.max(rOuter - nodeRadius, innerR);
  const placeable = picks.filter((p) => Number.isFinite(p.reach?.reach));
  const skipped = picks.filter((p) => !Number.isFinite(p.reach?.reach));
  const meta = placeable.map((pick) => ({ pick, ...primaryAxis(pick, axes) }));
  const pickRadius = meta.map((m) => innerR + clamp01(m.pick.reach.reach) * (outerR - innerR));

  const groups = new Map<number, number[]>();
  meta.forEach((m, i) => {
    const g = groups.get(m.primary) ?? [];
    g.push(i);
    groups.set(m.primary, g);
  });
  const startAngles = new Array<number>(meta.length).fill(0);
  const half = n > 0 ? (Math.PI / n) * 0.8 : 0;
  for (const [axisIndex, members] of groups) {
    const ordered = members.slice().sort((a, b) => pickRadius[a] - pickRadius[b] || a - b);
    const base = axisAngle(axisIndex, n);
    ordered.forEach((pickIdx, k) => {
      const offset = ordered.length === 1 ? 0 : -half + (2 * half * k) / (ordered.length - 1);
      startAngles[pickIdx] = base + offset;
    });
  }
  const minDist = nodeRadius * 2 + (compact ? 2 : 4);
  const angles = relaxAngles(startAngles, pickRadius, cx, cy, minDist);

  const pickGeoms: PickGeom[] = meta.map((m, i) => {
    const pt = polar(cx, cy, pickRadius[i], angles[i]);
    return {
      id: m.pick.id,
      pick: m.pick,
      axisIndex: m.primary,
      anchorIndexes: m.anchors.length > 0 ? m.anchors : [m.primary],
      angle: angles[i],
      radius: pickRadius[i],
      x: pt.x,
      y: pt.y,
      strokeWidth: connectionStroke(m.pick.connection),
    };
  });

  let minSeparation = Infinity;
  for (let i = 0; i < pickGeoms.length; i += 1) {
    for (let j = i + 1; j < pickGeoms.length; j += 1) {
      minSeparation = Math.min(minSeparation, chord(pickGeoms[i], pickGeoms[j]));
    }
  }

  return {
    size,
    compact,
    cx,
    cy,
    rProfile,
    rOuter,
    nodeRadius,
    hitRadius,
    labelFontSize,
    axes: axisGeoms,
    shape: axisGeoms.map((a) => a.vertex),
    picks: pickGeoms,
    skipped,
    nodeInnerR: innerR,
    nodeOuterR: outerR,
    minSeparation,
  };
}

/** SVG path data for the profile polygon. Fewer than three axes draw a spoke or a point, never a fill. */
export function shapePath(points: Point[]): string {
  if (points.length === 0) return '';
  const f = (v: number) => Math.round(v * 100) / 100;
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${f(p.x)} ${f(p.y)}`).join(' ');
  return points.length >= 3 ? `${d} Z` : d;
}

/** Keyboard order for picks: clockwise from 12 o'clock, inner to outer when angles tie. */
export function navOrder(picks: PickGeom[]): string[] {
  const turn = (a: number) => (((a + Math.PI / 2) % TAU) + TAU) % TAU;
  return picks
    .slice()
    .sort((a, b) => turn(a.angle) - turn(b.angle) || a.radius - b.radius || (a.id < b.id ? -1 : 1))
    .map((p) => p.id);
}

/** Next focus index for an arrow/Home/End key over `count` items. Returns null for keys it does not handle. */
export function nextNavIndex(key: string, index: number, count: number): number | null {
  if (count <= 0) return null;
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return (index + 1) % count;
    case 'ArrowLeft':
    case 'ArrowUp':
      return (index - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}
