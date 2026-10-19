import { describe, expect, it } from 'vitest';
import { isAxis, isPath } from '@/types';
import type { Pick } from '@/types';
import { CONNECTION_FLOOR, CONNECTION_NORM } from '@/lib/agent/config';
import {
  anchorAxes,
  axisAngle,
  CONNECTION_CEILING,
  DEFAULT_STROKE_RANGE,
  connectionStroke,
  estimateTextWidth,
  layoutChart,
  navOrder,
  nextNavIndex,
  polar,
  profileRadii,
  shapePath,
  wrapLabel,
} from './geometry';
import { FIELD_SHAPE, markPath } from './marks';
import { MOCK_AXES, MOCK_PICKS_30, MOCK_PICKS_6, makeMockPicks } from './mock';
import { FIELDS } from '@/types';

describe('mock data', () => {
  it('is synthetic and valid', () => {
    expect(MOCK_AXES.length).toBeGreaterThanOrEqual(6);
    expect(MOCK_AXES.length).toBeLessThanOrEqual(8);
    for (const a of MOCK_AXES) expect(isAxis(a)).toBe(true);
    for (const p of MOCK_PICKS_30) {
      expect(isPath(p.path)).toBe(true);
      expect(p.qlooId).toMatch(/^00000000-0000-4000-8000-0000000000\d\d$/);
    }
  });
});

describe('axis geometry', () => {
  it('starts at the top and goes clockwise', () => {
    expect(axisAngle(0, 4)).toBeCloseTo(-Math.PI / 2);
    const p = polar(0, 0, 10, axisAngle(1, 4));
    expect(p.x).toBeCloseTo(10);
    expect(p.y).toBeCloseTo(0);
  });

  it('scales radii by the heaviest axis and handles zero weights', () => {
    const r = profileRadii([10, 5, 0], 10, 110);
    expect(r[0]).toBeCloseTo(110);
    expect(r[1]).toBeCloseTo(60);
    expect(r[2]).toBeCloseTo(10);
    expect(profileRadii([0, 0], 10, 110)).toEqual([10, 10]);
  });

  it('wraps labels on word boundaries and never splits a word', () => {
    expect(wrapLabel('Ritual and repetition', 12)).toEqual(['Ritual and', 'repetition']);
    expect(wrapLabel('Extraordinarily', 5)).toEqual(['Extraordinarily']);
    expect(wrapLabel('', 5)).toEqual(['']);
  });

  it('draws a closed shape for three or more points only', () => {
    expect(shapePath([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }])).toMatch(/Z$/);
    expect(shapePath([{ x: 0, y: 0 }, { x: 1, y: 0 }])).not.toMatch(/Z$/);
    expect(shapePath([])).toBe('');
  });
});

describe('connection stroke', () => {
  it('increases with connection and clamps', () => {
    const lo = connectionStroke(CONNECTION_FLOOR);
    const mid = connectionStroke((CONNECTION_FLOOR + CONNECTION_NORM) / 2);
    const hi = connectionStroke(CONNECTION_NORM);
    expect(lo).toBeLessThan(mid);
    expect(mid).toBeLessThan(hi);
    expect(connectionStroke(0)).toBe(lo);
    expect(connectionStroke(5)).toBe(hi);
  });
});

describe('anchor axes', () => {
  it('finds axes by shared tag ids, strongest first', () => {
    const pick = makeMockPicks(1)[0];
    const [first] = anchorAxes(pick, MOCK_AXES);
    const axis = MOCK_AXES[first.index];
    expect(axis.tags.some((t) => pick.path.sharedTags.includes(t.tag))).toBe(true);
  });

  it('returns nothing when the path shares no tag with any axis', () => {
    const pick = { ...makeMockPicks(1)[0], path: { ...makeMockPicks(1)[0].path, sharedTags: ['nope'], hops: [] } };
    expect(anchorAxes(pick, MOCK_AXES)).toEqual([]);
  });
});

describe('layoutChart', () => {
  for (const [name, picks] of [['6 picks', MOCK_PICKS_6], ['30 picks', MOCK_PICKS_30]] as const) {
    it(`places ${name} outside the profile ring, ordered by reach`, () => {
      const layout = layoutChart({ axes: MOCK_AXES, picks, width: 640 });
      expect(layout.picks).toHaveLength(picks.length);
      for (const g of layout.picks) {
        expect(g.radius).toBeGreaterThan(layout.rProfile + layout.nodeRadius);
        expect(g.radius).toBeLessThanOrEqual(layout.rOuter);
        const r = Math.hypot(g.x - layout.cx, g.y - layout.cy);
        expect(r).toBeCloseTo(g.radius, 5);
      }
      const byReach = layout.picks.slice().sort((a, b) => a.pick.reach.reach - b.pick.reach.reach);
      for (let i = 1; i < byReach.length; i += 1) {
        expect(byReach[i].radius).toBeGreaterThanOrEqual(byReach[i - 1].radius);
      }
    });

    it(`keeps nodes from overlapping with ${name} on a wide chart`, () => {
      const layout = layoutChart({ axes: MOCK_AXES, picks, width: 640 });
      expect(layout.minSeparation).toBeGreaterThanOrEqual(layout.nodeRadius * 2);
    });
  }

  it('is deterministic', () => {
    const a = layoutChart({ axes: MOCK_AXES, picks: MOCK_PICKS_30, width: 640 });
    const b = layoutChart({ axes: MOCK_AXES, picks: MOCK_PICKS_30, width: 640 });
    expect(a).toEqual(b);
  });

  it('adapts at phone width and keeps labels and nodes inside the box', () => {
    const wide = layoutChart({ axes: MOCK_AXES, picks: MOCK_PICKS_6, width: 800 });
    const phone = layoutChart({ axes: MOCK_AXES, picks: MOCK_PICKS_6, width: 360 });
    expect(wide.compact).toBe(false);
    expect(phone.compact).toBe(true);
    expect(phone.size).toBe(360);
    expect(phone.hitRadius * 2).toBeGreaterThanOrEqual(44);
    for (const g of phone.picks) {
      expect(g.x).toBeGreaterThan(0);
      expect(g.x).toBeLessThan(phone.size);
      expect(g.y).toBeGreaterThan(0);
      expect(g.y).toBeLessThan(phone.size);
    }
  });

  it('keeps the shape inside the profile ring and one vertex per axis', () => {
    const layout = layoutChart({ axes: MOCK_AXES, picks: [], width: 640 });
    expect(layout.shape).toHaveLength(MOCK_AXES.length);
    for (const v of layout.shape) {
      expect(Math.hypot(v.x - layout.cx, v.y - layout.cy)).toBeLessThanOrEqual(layout.rProfile + 1e-6);
    }
    expect(layout.minSeparation).toBe(Infinity);
  });

  it('survives no axes', () => {
    const layout = layoutChart({ axes: [], picks: [], width: 640 });
    expect(layout.axes).toEqual([]);
    expect(shapePath(layout.shape)).toBe('');
  });
});

describe('axis labels', () => {
  const long = MOCK_AXES.map((a, i) => (i === 0 ? { ...a, label: 'Domesticity and quiet interiors' } : a));
  for (const width of [320, 375, 860]) {
    for (const [name, axes] of [['mock axes', MOCK_AXES], ['a long label', long]] as const) {
      it(`keeps every label and its hit area inside the viewBox at ${width}px with ${name}`, () => {
        const layout = layoutChart({ axes, picks: MOCK_PICKS_6, width });
        expect(layout.size).toBe(width);
        for (const g of layout.axes) {
          for (const r of [g.box, g.hit]) {
            expect(r.x).toBeGreaterThanOrEqual(0);
            expect(r.y).toBeGreaterThanOrEqual(0);
            expect(r.x + r.w).toBeLessThanOrEqual(layout.size);
            expect(r.y + r.h).toBeLessThanOrEqual(layout.size);
          }
          // Text lines sit within the (shifted) box horizontally.
          for (const l of g.lines) {
            const w = estimateTextWidth(l.text, layout.labelFontSize);
            const left = g.textAnchor === 'start' ? l.x : g.textAnchor === 'end' ? l.x - w : l.x - w / 2;
            expect(left).toBeGreaterThanOrEqual(0);
            expect(left + w).toBeLessThanOrEqual(layout.size);
          }
        }
      });
    }
  }

  it('does not need the safety shift for the mock axes (labels fit by layout, not by clamping)', () => {
    for (const width of [320, 375, 860]) {
      const layout = layoutChart({ axes: MOCK_AXES, picks: [], width });
      for (const g of layout.axes) expect(g.lines[0].x).toBeGreaterThan(0);
      expect(layout.rOuter).toBeGreaterThan(layout.rProfile);
    }
  });
});

const withReach = (pick: Pick, reach: number): Pick => ({ ...pick, reach: { ...pick.reach, reach } });
const withConnection = (pick: Pick, connection: number): Pick => ({ ...pick, connection });

describe('layout exactness', () => {
  it('keeps radius exactly innerR + reach * (outerR - innerR) after relaxation', () => {
    const layout = layoutChart({ axes: MOCK_AXES, picks: MOCK_PICKS_30, width: 640 });
    for (const g of layout.picks) {
      const expected = layout.nodeInnerR + g.pick.reach.reach * (layout.nodeOuterR - layout.nodeInnerR);
      expect(g.radius).toBe(expected);
      expect(Math.hypot(g.x - layout.cx, g.y - layout.cy)).toBeCloseTo(expected, 6);
    }
  });

  it('maps connection to stroke width exactly at floor, midpoint and ceiling', () => {
    const [base] = MOCK_PICKS_6;
    const mid = (CONNECTION_FLOOR + CONNECTION_CEILING) / 2;
    const picks = [
      { ...withConnection(base, CONNECTION_FLOOR), id: 'a' },
      { ...withConnection(base, mid), id: 'b' },
      { ...withConnection(base, CONNECTION_CEILING), id: 'c' },
    ];
    const layout = layoutChart({ axes: MOCK_AXES, picks, width: 640 });
    const { min, max } = DEFAULT_STROKE_RANGE;
    expect(layout.picks[0].strokeWidth).toBeCloseTo(min, 10);
    expect(layout.picks[1].strokeWidth).toBeCloseTo((min + max) / 2, 10);
    expect(layout.picks[2].strokeWidth).toBeCloseTo(max, 10);
  });

  it('derives the connection ceiling from CONNECTION_NORM', () => {
    expect(CONNECTION_CEILING).toBe(1 / CONNECTION_NORM);
    expect(connectionStroke(CONNECTION_CEILING)).toBe(DEFAULT_STROKE_RANGE.max);
    // A tuned norm moves the ceiling: with norm 2 the top of the scale is 0.5.
    expect(connectionStroke(0.5, DEFAULT_STROKE_RANGE, CONNECTION_FLOOR, 1 / 2)).toBe(DEFAULT_STROKE_RANGE.max);
  });
});

describe('unusual input', () => {
  it('leaves picks with missing or NaN reach off the chart but reports them', () => {
    const [a, b, c] = MOCK_PICKS_6;
    const bad = withReach(b, Number.NaN);
    const missing = { ...c, reach: undefined } as unknown as Pick;
    const layout = layoutChart({ axes: MOCK_AXES, picks: [a, bad, missing], width: 640 });
    expect(layout.picks.map((g) => g.id)).toEqual([a.id]);
    expect(layout.skipped.map((p) => p.id)).toEqual([bad.id, missing.id]);
    expect(layout.picks.every((g) => g.radius > layout.nodeInnerR - 1e-9 || g.pick.reach.reach === 0)).toBe(true);
  });

  it('places many picks that all belong to one axis without overlap', () => {
    const [base] = MOCK_PICKS_6;
    const sharedTags = [MOCK_AXES[0].tags[0].tag];
    const picks = Array.from({ length: 12 }, (_, i) => ({
      ...withReach(base, 0.1 + (i % 4) * 0.2),
      id: `one-${i}`,
      path: { ...base.path, sharedTags, hops: [] },
    }));
    const layout = layoutChart({ axes: MOCK_AXES, picks, width: 640 });
    expect(new Set(layout.picks.map((g) => g.axisIndex))).toEqual(new Set([0]));
    expect(layout.minSeparation).toBeGreaterThanOrEqual(layout.nodeRadius * 2);
  });

  it('lays out picks when there are no axes', () => {
    const layout = layoutChart({ axes: [], picks: MOCK_PICKS_6, width: 640 });
    expect(layout.picks).toHaveLength(6);
    for (const g of layout.picks) {
      expect(Number.isFinite(g.x)).toBe(true);
      expect(Number.isFinite(g.y)).toBe(true);
    }
  });

  it('breaks anchor ties by axis weight, then by axis order', () => {
    const [base] = MOCK_PICKS_6;
    const tagA = MOCK_AXES[0].tags[0].tag;
    const tagB = MOCK_AXES[1].tags[0].tag;
    const pick = { ...base, path: { ...base.path, sharedTags: [tagA, tagB], hops: [] } };
    const heavierSecond = [
      { ...MOCK_AXES[0], weight: 1 },
      { ...MOCK_AXES[1], weight: 5 },
    ];
    expect(anchorAxes(pick, heavierSecond).map((a) => a.index)).toEqual([1, 0]);
    const equal = [
      { ...MOCK_AXES[0], weight: 3 },
      { ...MOCK_AXES[1], weight: 3 },
    ];
    expect(anchorAxes(pick, equal).map((a) => a.index)).toEqual([0, 1]);
    // More hits beats weight.
    const twoHits = { ...pick, path: { ...pick.path, sharedTags: [tagA, MOCK_AXES[0].tags[1].tag, tagB] } };
    expect(anchorAxes(twoHits, heavierSecond)[0].index).toBe(0);
  });
});

describe('compact width', () => {
  it('keeps about ten picks from overlapping at 320px', () => {
    const layout = layoutChart({ axes: MOCK_AXES, picks: makeMockPicks(10), width: 320 });
    expect(layout.compact).toBe(true);
    expect(layout.picks).toHaveLength(10);
    expect(layout.minSeparation).toBeGreaterThanOrEqual(layout.nodeRadius * 2);
  });
});

describe('keyboard navigation', () => {
  it('wraps arrows and handles Home and End', () => {
    expect(nextNavIndex('ArrowRight', 2, 3)).toBe(0);
    expect(nextNavIndex('ArrowLeft', 0, 3)).toBe(2);
    expect(nextNavIndex('Home', 2, 3)).toBe(0);
    expect(nextNavIndex('End', 0, 3)).toBe(2);
    expect(nextNavIndex('a', 0, 3)).toBeNull();
    expect(nextNavIndex('ArrowRight', 0, 0)).toBeNull();
  });

  it('orders every pick once', () => {
    const layout = layoutChart({ axes: MOCK_AXES, picks: MOCK_PICKS_30, width: 640 });
    const order = navOrder(layout.picks);
    expect(new Set(order).size).toBe(30);
  });
});

describe('field marks', () => {
  it('gives each field a distinct shape', () => {
    const paths = FIELDS.map((f) => markPath(f, 8));
    expect(new Set(paths).size).toBe(FIELDS.length);
    expect(new Set(Object.values(FIELD_SHAPE)).size).toBe(FIELDS.length);
  });
});
