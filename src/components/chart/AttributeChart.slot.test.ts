/*
 * T-29: the `aboveStage` slot, checked in real server-rendered markup (real React, no DOM needed).
 * Fixtures are the synthetic chart mocks.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// T-36: the pinned axis is client state, so its panel cannot appear in a server render. While `h.on` is set, React's
// hooks are a tiny in-memory stand-in so the component can be called as a function and its element tree walked.
// Otherwise every hook is React's own, and the server-render tests above run as they always did.
// If AttributeChart gains a new hook type (useReducer, useLayoutEffect, useSyncExternalStore, ...), extend the stand-in
// below to cover it, or the stand-in tests will fall through to React's real hook and fail outside a render.
const h = vi.hoisted(() => ({ on: false, slots: [] as Array<{ v?: unknown; deps?: readonly unknown[] }>, i: 0 }));
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  const same = (a?: readonly unknown[], b?: readonly unknown[]) =>
    !!a && !!b && a.length === b.length && a.every((x, k) => Object.is(x, b[k]));
  const slot = () => (h.slots[h.i++] ??= {});
  const hooks: Record<string, (...a: never[]) => unknown> & { useMemo: (fn: () => unknown, deps: readonly unknown[]) => unknown } = {
    useState: (init: unknown) => {
      if (!h.on) return actual.useState(init as never);
      const s = slot();
      if (!('v' in s)) s.v = typeof init === 'function' ? (init as () => unknown)() : init;
      return [s.v, (n: unknown) => void (s.v = typeof n === 'function' ? (n as (p: unknown) => unknown)(s.v) : n)];
    },
    useRef: (init: unknown) => {
      if (!h.on) return actual.useRef(init as never);
      const s = slot();
      if (!('v' in s)) s.v = { current: init };
      return s.v;
    },
    useMemo: (fn: () => unknown, deps: readonly unknown[]) => {
      if (!h.on) return actual.useMemo(fn, deps);
      const s = slot();
      if (!same(s.deps, deps)) {
        s.v = fn();
        s.deps = deps;
      }
      return s.v;
    },
    useCallback: (fn: unknown, deps: readonly unknown[]) => (h.on ? hooks.useMemo(() => fn, deps) : actual.useCallback(fn as never, deps)),
    useId: () => (h.on ? ':t:' : actual.useId()),
    useEffect: (fn: () => void, deps?: readonly unknown[]) => {
      if (!h.on) return actual.useEffect(fn, deps);
      h.i += 1;
    },
  };
  return { ...actual, default: { ...actual, ...hooks }, ...hooks };
});

import { AttributeChart } from './AttributeChart';
import type { AttributeChartProps } from './AttributeChart';
import { MOCK_AXES, MOCK_PICKS_6 } from './mock';

const render = (extra: Partial<AttributeChartProps> = {}) =>
  renderToStaticMarkup(createElement(AttributeChart, { axes: MOCK_AXES, picks: MOCK_PICKS_6, ...extra }));

const slot = createElement('div', { 'data-testid': 'above-slot' }, 'Fixture suggestion list');

describe('aboveStage', () => {
  it('renders after the key and before the plot', () => {
    const html = render({ aboveStage: slot });
    const keyEnd = html.indexOf('</figcaption>');
    const at = html.indexOf('data-testid="above-slot"');
    const plot = html.indexOf('<svg', keyEnd); // the key holds its own small marks, so search after it
    expect(keyEnd).toBeGreaterThan(-1);
    expect(at).toBeGreaterThan(keyEnd);
    expect(plot).toBeGreaterThan(at);
    expect(html).toContain('Fixture suggestion list');
    expect(html.split('data-testid="above-slot"')).toHaveLength(2); // exactly once
  });

  it('puts the slot inside the figure, as a sibling of the key and the plot', () => {
    const html = render({ aboveStage: slot });
    expect(html).toMatch(/<\/figcaption><div[^>]*><div data-testid="above-slot">/);
    expect(html).toMatch(/Fixture suggestion list<\/div><\/div><div[^>]*><svg/);
  });

  it('renders nothing extra when omitted: the plot follows the key directly', () => {
    const html = render();
    expect(html).toMatch(/<\/figcaption><div[^>]*><svg/);
    expect(html).not.toContain('above-slot');
  });

  it('treats null, false and undefined like omitted', () => {
    const omitted = render();
    expect(render({ aboveStage: null })).toBe(omitted);
    expect(render({ aboveStage: false })).toBe(omitted);
    expect(render({ aboveStage: undefined })).toBe(omitted);
  });

  it('keeps everything else identical apart from the slot wrapper', () => {
    const withSlot = render({ aboveStage: slot });
    const omitted = render();
    const stripped = withSlot.replace(/<div class="[^"]*"><div data-testid="above-slot">Fixture suggestion list<\/div><\/div>/, '');
    expect(stripped).toBe(omitted);
  });

  it('works on an empty chart (no picks) and with no key content', () => {
    const html = render({ picks: [], aboveStage: slot });
    expect(html.indexOf('</figcaption>')).toBeLessThan(html.indexOf('data-testid="above-slot"'));
    expect(html.indexOf('data-testid="above-slot"')).toBeLessThan(html.indexOf('<svg', html.indexOf('</figcaption>')));
  });
});

describe('server render, before any hover', () => {
  it('has no hover card and no per-axis aria-describedby', () => {
    const html = render();
    expect(html).not.toContain('role="tooltip"');
    // The svg group itself is described by its own <desc>; no axis button carries aria-describedby.
    const axisButtons = html.match(/<g[^>]*aria-label="[^"]* axis\. Show its tags"[^>]*>/g) ?? [];
    expect(axisButtons).toHaveLength(MOCK_AXES.length);
    for (const tag of axisButtons) expect(tag).not.toContain('aria-describedby');
  });
});

// ---- axisInfoAbove -----------------------------------------------------------------------------------------------

type El = { type: unknown; props: Record<string, unknown> & { children?: ReactNode } };
const isEl = (n: unknown): n is El => typeof n === 'object' && n !== null && 'props' in n && 'type' in n;
const kids = (n: unknown): unknown[] => (Array.isArray(n) ? n.flatMap(kids) : n === null || n === undefined || typeof n === 'boolean' ? [] : [n]);
function textOf(node: unknown): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  return isEl(node) && typeof node.type === 'string' ? textOf(node.props.children) : '';
}
function findAll(node: unknown, pred: (el: El) => boolean, out: El[] = []): El[] {
  if (Array.isArray(node)) node.forEach((c) => findAll(c, pred, out));
  else if (isEl(node)) {
    if (pred(node)) out.push(node);
    findAll(node.props.children, pred, out);
  }
  return out;
}

/** Mount the chart in the stand-in, press the first axis, and return the figure's direct children in order. */
function pinnedFigure(extra: Partial<AttributeChartProps>): El[] {
  h.on = true;
  h.i = 0;
  h.slots = [];
  try {
    const props = { axes: MOCK_AXES, picks: MOCK_PICKS_6, ...extra };
    const first = (AttributeChart as unknown as (p: AttributeChartProps) => El)(props);
    h.i = 0;
    const axis = findAll(first, (el) => el.type === 'g' && String(el.props['aria-label'] ?? '').startsWith(`${MOCK_AXES[0]!.label} axis.`))[0]!;
    (axis.props.onClick as () => void)();
    h.i = 0;
    const tree = (AttributeChart as unknown as (p: AttributeChartProps) => El)(props);
    return kids(tree.props.children).filter(isEl);
  } finally {
    h.on = false;
    h.slots = [];
  }
}

describe('axisInfoAbove', () => {
  const heading = `${MOCK_AXES[0]!.label} is made of`;
  const at = (parts: El[], pred: (el: El) => boolean) => parts.findIndex((el) => pred(el));
  const hasHeading = (el: El) => textOf(el).includes(heading);
  const isStage = (el: El) => findAll(el, (c) => c.type === 'svg').length > 0 && !hasHeading(el);

  it('is off by default: the pinned axis shows in the readout after the plot', () => {
    const parts = pinnedFigure({});
    const panel = at(parts, hasHeading);
    expect(panel).toBeGreaterThan(at(parts, isStage));
    expect(findAll(parts[panel], (el) => 'tag' in el.props)).toHaveLength(MOCK_AXES[0]!.tags.length); // one chip per tag
  });

  it('puts the panel after the key and before the plot when set, and not in the readout', () => {
    const parts = pinnedFigure({ axisInfoAbove: true });
    const panels = parts.filter(hasHeading);
    expect(panels).toHaveLength(1);
    const panel = at(parts, hasHeading);
    expect(panel).toBeGreaterThan(at(parts, (el) => el.type === 'figcaption'));
    expect(panel).toBeLessThan(at(parts, isStage));
    expect(findAll(parts[panel], (el) => 'tag' in el.props)).toHaveLength(MOCK_AXES[0]!.tags.length); // one chip per tag
  });

  it('keeps the aria-controls target on the panel wherever it sits', () => {
    for (const above of [false, true]) {
      const parts = pinnedFigure({ axisInfoAbove: above });
      const ids = findAll(parts, (el) => typeof el.props.id === 'string' && String(el.props.id).endsWith('-axisinfo'));
      expect(ids).toHaveLength(1);
    }
  });

  it('keeps the default markup unchanged: false and undefined render the same, with the axis hint under the plot', () => {
    const html = render();
    expect(render({ axisInfoAbove: false })).toBe(html);
    expect(html).not.toContain('Select an axis to see its tags.</p></div>');
    expect(html.indexOf('Select an axis to see its tags.')).toBeGreaterThan(html.indexOf('</svg>'));
  });

  it('holds the slot while nothing is pinned, with the axis hint in it and not under the plot', () => {
    const html = render({ axisInfoAbove: true });
    const hint = 'Select an axis to see its tags.';
    expect(html.split(hint)).toHaveLength(2); // once
    const keyEnd = html.indexOf('</figcaption>');
    expect(html.indexOf(hint)).toBeGreaterThan(keyEnd);
    expect(html.indexOf(hint)).toBeLessThan(html.indexOf('<svg', keyEnd)); // before the plot
    expect(html).toContain('Select a suggestion to see its path back to you.'); // the pick hint stays below
  });

  it('keeps the slot while pinned, so the plot stays put', () => {
    const parts = pinnedFigure({ axisInfoAbove: true });
    const slotIdx = parts.findIndex((el) => findAll(el, (c) => typeof c.props.id === 'string' && String(c.props.id).endsWith('-axisinfo')).length > 0);
    expect(slotIdx).toBeGreaterThan(-1);
    expect(textOf(parts)).not.toContain('Select an axis to see its tags.');
  });
});
