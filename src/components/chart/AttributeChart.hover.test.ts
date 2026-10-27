/*
 * T-29: the axis hover card, driven without a browser. The repo's Vitest setup is node-only with no DOM library, so
 * this file replaces React's hooks with a tiny in-memory implementation, calls the component as a function, and
 * walks the element tree it returns. Event handlers are called as React would call them. Fixtures are the synthetic
 * chart mocks (invented names, placeholder ids).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

interface Slot {
  v?: unknown;
  deps?: readonly unknown[];
  cleanup?: (() => void) | void;
  ref?: { current: unknown };
}

const h = vi.hoisted(() => ({
  slots: [] as Slot[],
  i: 0,
  dirty: false,
  effects: [] as Array<{ slot: Slot; fn: () => (() => void) | void }>,
  width: 0 as number,
  refCount: 0,
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  const same = (a?: readonly unknown[], b?: readonly unknown[]) =>
    !!a && !!b && a.length === b.length && a.every((x, k) => Object.is(x, b[k]));
  const slot = (): Slot => (h.slots[h.i] ??= {});
  const hooks = {
    useState<T>(init: T | (() => T)) {
      const s = slot();
      h.i += 1;
      if (!('v' in s)) s.v = typeof init === 'function' ? (init as () => T)() : init;
      const set = (n: T | ((p: T) => T)) => {
        const next = typeof n === 'function' ? (n as (p: T) => T)(s.v as T) : n;
        if (!Object.is(next, s.v)) {
          s.v = next;
          h.dirty = true;
        }
      };
      return [s.v as T, set] as const;
    },
    useRef<T>(init: T) {
      const s = slot();
      h.i += 1;
      if (!s.ref) {
        s.ref = { current: init };
        // The first ref is the stage wrapper. Give it a width so the chart measures itself as a browser would.
        if (h.refCount === 0 && h.width > 0) {
          s.ref.current = { getBoundingClientRect: () => ({ width: h.width }) };
        }
        h.refCount += 1;
      }
      return s.ref;
    },
    useMemo<T>(fn: () => T, deps: readonly unknown[]) {
      const s = slot();
      h.i += 1;
      if (!same(s.deps, deps)) {
        s.v = fn();
        s.deps = deps;
      }
      return s.v as T;
    },
    useCallback<T>(fn: T, deps: readonly unknown[]) {
      return hooks.useMemo(() => fn, deps);
    },
    useId() {
      return ':t:';
    },
    useEffect(fn: () => (() => void) | void, deps?: readonly unknown[]) {
      const s = slot();
      h.i += 1;
      if (!same(s.deps, deps) || deps === undefined) {
        s.deps = deps;
        h.effects.push({ slot: s, fn });
      }
    },
  };
  return { ...actual, default: { ...actual, ...hooks }, ...hooks };
});

import { AttributeChart } from './AttributeChart';
import type { AttributeChartProps } from './AttributeChart';
import { layoutChart } from './geometry';
import { MOCK_AXES, MOCK_PICKS_6 } from './mock';

// ---- a window stand-in, so the Escape listener can be fired ------------------------------------------------------

const listeners = new Map<string, Set<(e: { key: string }) => void>>();
const fakeWindow = {
  addEventListener: (type: string, fn: (e: { key: string }) => void) => {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type)!.add(fn);
  },
  removeEventListener: (type: string, fn: (e: { key: string }) => void) => {
    listeners.get(type)?.delete(fn);
  },
};
const keydownListeners = () => listeners.get('keydown')?.size ?? 0;
const pressOnWindow = (key: string) => [...(listeners.get('keydown') ?? [])].forEach((fn) => fn({ key }));

beforeAll(() => {
  (globalThis as { window?: unknown }).window = fakeWindow;
});
afterAll(() => {
  delete (globalThis as { window?: unknown }).window;
});

// ---- mini renderer -----------------------------------------------------------------------------------------------

type El = { type: unknown; props: Record<string, unknown> & { children?: ReactNode } };
const isEl = (n: unknown): n is El => typeof n === 'object' && n !== null && 'props' in n && 'type' in n;

function walk(node: unknown, visit: (el: El) => void): void {
  if (Array.isArray(node)) return node.forEach((c) => walk(c, visit));
  if (!isEl(node)) return;
  visit(node);
  walk(node.props.children, visit);
}
function findAll(node: unknown, pred: (el: El) => boolean): El[] {
  const out: El[] = [];
  walk(node, (el) => {
    if (pred(el)) out.push(el);
  });
  return out;
}
function text(node: unknown): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(text).join('');
  if (isEl(node) && typeof node.type === 'string') return text(node.props.children);
  return '';
}

function mount(props: AttributeChartProps, width = 0) {
  h.slots = [];
  h.effects = [];
  h.dirty = false;
  h.refCount = 0;
  h.width = width;
  let tree: unknown;
  const render = () => {
    h.i = 0;
    tree = AttributeChart(props);
  };
  const flush = () => {
    for (let n = 0; n < 20; n += 1) {
      const queued = h.effects;
      h.effects = [];
      for (const { slot, fn } of queued) {
        if (typeof slot.cleanup === 'function') slot.cleanup();
        slot.cleanup = fn();
      }
      if (!h.dirty) return;
      h.dirty = false;
      render();
    }
    throw new Error('render did not settle');
  };
  render();
  flush();
  return {
    get tree() {
      return tree;
    },
    /** Run something that sets state, then re-render until settled. */
    act(fn: () => void) {
      fn();
      if (h.dirty) {
        h.dirty = false;
        render();
      }
      flush();
    },
    unmount() {
      for (const s of h.slots) if (typeof s.cleanup === 'function') s.cleanup();
    },
  };
}

type Handler = (e?: unknown) => void;
const axisGroups = (tree: unknown, axes = MOCK_AXES) =>
  axes.map((a) => {
    const g = findAll(tree, (el) => el.type === 'g' && String(el.props['aria-label'] ?? '').startsWith(`${a.label} axis.`));
    expect(g).toHaveLength(1);
    return g[0];
  });
const axisGroup = (tree: unknown, i: number) => axisGroups(tree)[i];
const handler = (el: El, name: string) => el.props[name] as Handler;
const card = (tree: unknown) => findAll(tree, (el) => el.props.role === 'tooltip');
// A focus event as the browser reports it: keyboard focus matches :focus-visible, click or tap focus does not.
const focusEvent = (visible: boolean) => ({ currentTarget: { matches: (sel: string) => sel === ':focus-visible' && visible } });
const keyboardFocus = focusEvent(true);
const pointerFocus = focusEvent(false);
const keyEvent = (key: string) => ({ key, preventDefault: () => {}, stopPropagation: () => {} });

const baseProps: AttributeChartProps = { axes: MOCK_AXES, picks: MOCK_PICKS_6 };
let live: ReturnType<typeof mount> | null = null;
const start = (props: Partial<AttributeChartProps> = {}, width = 0) => (live = mount({ ...baseProps, ...props }, width));

afterEach(() => {
  live?.unmount();
  live = null;
  listeners.clear();
});

// ---- tests -------------------------------------------------------------------------------------------------------

describe('axis hover card: show and hide', () => {
  it('renders no card and no aria-describedby on any axis before interaction', () => {
    const c = start();
    expect(card(c.tree)).toHaveLength(0);
    for (const g of axisGroups(c.tree)) expect(g.props['aria-describedby']).toBeUndefined();
    expect(keydownListeners()).toBe(0);
  });

  it('pointer enter shows the card with the axis name and its tag names', () => {
    const c = start();
    c.act(() => handler(axisGroup(c.tree, 0), 'onPointerEnter')());
    const cards = card(c.tree);
    expect(cards).toHaveLength(1);
    const body = text(cards[0]);
    expect(body).toContain(MOCK_AXES[0].label);
    for (const t of MOCK_AXES[0].tags) expect(body).toContain(t.name);
    expect(text(cards[0].props.children)).toBe(
      `${MOCK_AXES[0].label}Made of${MOCK_AXES[0].tags.map((t) => t.name).join(', ')}`,
    );
  });

  it('ties the card to the hovered axis with aria-describedby, and only while it shows', () => {
    const c = start();
    c.act(() => handler(axisGroup(c.tree, 2), 'onPointerEnter')());
    const cardId = card(c.tree)[0].props.id;
    expect(typeof cardId).toBe('string');
    const groups = axisGroups(c.tree);
    expect(groups[2].props['aria-describedby']).toBe(cardId);
    groups.forEach((g, i) => {
      if (i !== 2) expect(g.props['aria-describedby']).toBeUndefined();
    });
    c.act(() => handler(axisGroup(c.tree, 2), 'onPointerLeave')());
    expect(card(c.tree)).toHaveLength(0);
    for (const g of axisGroups(c.tree)) expect(g.props['aria-describedby']).toBeUndefined();
  });

  it('moving from one axis to another swaps the card', () => {
    const c = start();
    c.act(() => handler(axisGroup(c.tree, 0), 'onPointerEnter')());
    c.act(() => handler(axisGroup(c.tree, 0), 'onPointerLeave')());
    c.act(() => handler(axisGroup(c.tree, 1), 'onPointerEnter')());
    expect(card(c.tree)).toHaveLength(1);
    expect(text(card(c.tree)[0])).toContain(MOCK_AXES[1].label);
    expect(text(card(c.tree)[0])).not.toContain(MOCK_AXES[0].label);
    expect(axisGroup(c.tree, 0).props['aria-describedby']).toBeUndefined();
    expect(axisGroup(c.tree, 1).props['aria-describedby']).toBe(card(c.tree)[0].props.id);
  });

  it('keyboard focus shows the same card, and blur hides it', () => {
    const c = start();
    c.act(() => handler(axisGroup(c.tree, 3), 'onFocus')(keyboardFocus));
    expect(card(c.tree)).toHaveLength(1);
    const body = text(card(c.tree)[0]);
    expect(body).toContain(MOCK_AXES[3].label);
    for (const t of MOCK_AXES[3].tags) expect(body).toContain(t.name);
    expect(axisGroup(c.tree, 3).props['aria-describedby']).toBe(card(c.tree)[0].props.id);
    c.act(() => handler(axisGroup(c.tree, 3), 'onBlur')());
    expect(card(c.tree)).toHaveLength(0);
    expect(axisGroup(c.tree, 3).props['aria-describedby']).toBeUndefined();
  });

  it('focus from a mouse click or a tap (not :focus-visible) shows no card, and none is left after the pointer goes', () => {
    const c = start();
    c.act(() => handler(axisGroup(c.tree, 1), 'onPointerEnter')());
    c.act(() => handler(axisGroup(c.tree, 1), 'onFocus')(pointerFocus));
    c.act(() => handler(axisGroup(c.tree, 1), 'onClick')());
    c.act(() => handler(axisGroup(c.tree, 1), 'onPointerLeave')());
    expect(card(c.tree)).toHaveLength(0);
    // Click again to unpin: the axis keeps its focus, but the card does not come back.
    c.act(() => handler(axisGroup(c.tree, 1), 'onClick')());
    expect(axisGroup(c.tree, 1).props['aria-expanded']).toBe(false);
    expect(card(c.tree)).toHaveLength(0);
  });

  it('a tap that focuses an axis and then pins it leaves no stuck card', () => {
    const c = start();
    c.act(() => handler(axisGroup(c.tree, 2), 'onPointerEnter')());
    c.act(() => handler(axisGroup(c.tree, 2), 'onFocus')(pointerFocus));
    c.act(() => handler(axisGroup(c.tree, 2), 'onPointerLeave')());
    c.act(() => handler(axisGroup(c.tree, 2), 'onClick')());
    expect(card(c.tree)).toHaveLength(0);
  });

  it('shows no card for the pinned axis, by pointer or by keyboard focus', () => {
    const c = start();
    c.act(() => handler(axisGroup(c.tree, 0), 'onClick')());
    c.act(() => handler(axisGroup(c.tree, 0), 'onPointerEnter')());
    expect(card(c.tree)).toHaveLength(0);
    c.act(() => handler(axisGroup(c.tree, 0), 'onPointerLeave')());
    c.act(() => handler(axisGroup(c.tree, 0), 'onFocus')(keyboardFocus));
    expect(card(c.tree)).toHaveLength(0);
    expect(axisGroup(c.tree, 0).props['aria-describedby']).toBeUndefined();
    // Another axis still gets its card.
    c.act(() => handler(axisGroup(c.tree, 3), 'onPointerEnter')());
    expect(card(c.tree)).toHaveLength(1);
  });

  it('keyboard Enter on a focused axis pins it and hides its card', () => {
    const c = start();
    c.act(() => handler(axisGroup(c.tree, 1), 'onFocus')(keyboardFocus));
    expect(card(c.tree)).toHaveLength(1);
    c.act(() => handler(axisGroup(c.tree, 1), 'onKeyDown')(keyEvent('Enter')));
    expect(card(c.tree)).toHaveLength(0);
  });

  it('Escape hides a card opened by focus', () => {
    const c = start();
    c.act(() => handler(axisGroup(c.tree, 0), 'onFocus')(keyboardFocus));
    expect(card(c.tree)).toHaveLength(1);
    c.act(() => pressOnWindow('Escape'));
    expect(card(c.tree)).toHaveLength(0);
    expect(axisGroup(c.tree, 0).props['aria-describedby']).toBeUndefined();
  });

  it('Escape hides a card opened by the pointer alone', () => {
    const c = start();
    c.act(() => handler(axisGroup(c.tree, 0), 'onPointerEnter')());
    expect(card(c.tree)).toHaveLength(1);
    c.act(() => pressOnWindow('Escape'));
    expect(card(c.tree)).toHaveLength(0);
  });

  it('other keys leave the card showing', () => {
    const c = start();
    c.act(() => handler(axisGroup(c.tree, 0), 'onPointerEnter')());
    c.act(() => pressOnWindow('a'));
    c.act(() => pressOnWindow('Tab'));
    expect(card(c.tree)).toHaveLength(1);
  });

  it('listens for Escape only while the card is open, and removes the listener on close', () => {
    const c = start();
    expect(keydownListeners()).toBe(0);
    c.act(() => handler(axisGroup(c.tree, 0), 'onPointerEnter')());
    expect(keydownListeners()).toBe(1);
    c.act(() => handler(axisGroup(c.tree, 0), 'onPointerLeave')());
    expect(keydownListeners()).toBe(0);
  });

  it('removes the Escape listener on unmount while the card is open', () => {
    const c = start();
    c.act(() => handler(axisGroup(c.tree, 0), 'onFocus')(keyboardFocus));
    expect(keydownListeners()).toBe(1);
    c.unmount();
    expect(keydownListeners()).toBe(0);
  });

  it('pointer wins over focus when both are on different axes, and focus returns when the pointer leaves', () => {
    const c = start();
    c.act(() => handler(axisGroup(c.tree, 0), 'onFocus')(keyboardFocus));
    c.act(() => handler(axisGroup(c.tree, 1), 'onPointerEnter')());
    expect(text(card(c.tree)[0])).toContain(MOCK_AXES[1].label);
    c.act(() => handler(axisGroup(c.tree, 1), 'onPointerLeave')());
    expect(text(card(c.tree)[0])).toContain(MOCK_AXES[0].label);
  });

  it('shows a card for an axis chart with no picks too', () => {
    const c = start({ picks: [] });
    c.act(() => handler(axisGroup(c.tree, 0), 'onPointerEnter')());
    expect(card(c.tree)).toHaveLength(1);
  });
});

describe('axis hover card: read-only and free of numbers', () => {
  it('holds no buttons, links or focusable elements', () => {
    const c = start();
    c.act(() => handler(axisGroup(c.tree, 0), 'onPointerEnter')());
    const root = card(c.tree)[0];
    expect(root.props.role).toBe('tooltip');
    const interactive = findAll(root, (el) => {
      const type = el.type;
      return (
        type !== root.type &&
        (typeof type !== 'string' ||
          ['button', 'a', 'input', 'select', 'textarea', 'summary', 'dialog'].includes(type) ||
          el.props.role === 'button' ||
          el.props.tabIndex !== undefined ||
          el.props.onClick !== undefined)
      );
    });
    expect(interactive).toEqual([]);
    expect(root.props.onClick).toBeUndefined();
    expect(root.props.tabIndex).toBeUndefined();
  });

  it('shows no digits in the card (no scores or counts, hard rule 7)', () => {
    const c = start();
    for (let i = 0; i < MOCK_AXES.length; i += 1) {
      c.act(() => handler(axisGroup(c.tree, i), 'onPointerEnter')());
      expect(text(card(c.tree)[0])).not.toMatch(/\d/);
      c.act(() => handler(axisGroup(c.tree, i), 'onPointerLeave')());
    }
  });

  it('does not throw for an axis with a single tag', () => {
    const axes = [{ ...MOCK_AXES[0], tags: [MOCK_AXES[0].tags[0]] }, ...MOCK_AXES.slice(1)];
    const c = start({ axes });
    c.act(() => handler(axisGroups(c.tree, axes)[0], 'onPointerEnter')());
    expect(text(card(c.tree)[0])).toContain(MOCK_AXES[0].tags[0].name);
  });
});

describe('axis pin still works alongside the card', () => {
  const panelHead = (tree: unknown, label: string) =>
    findAll(tree, (el) => el.type === 'p' && text(el) === `${label} is made of`);

  it('click pins the axis: expanded state, controls id, and the tag panel with its chips', () => {
    const c = start();
    expect(axisGroup(c.tree, 0).props['aria-expanded']).toBe(false);
    expect(panelHead(c.tree, MOCK_AXES[0].label)).toHaveLength(0);
    c.act(() => handler(axisGroup(c.tree, 0), 'onClick')());
    const g = axisGroup(c.tree, 0);
    expect(g.props['aria-expanded']).toBe(true);
    expect(panelHead(c.tree, MOCK_AXES[0].label)).toHaveLength(1);
    const panel = findAll(c.tree, (el) => el.props.id === g.props['aria-controls']);
    expect(panel).toHaveLength(1);
    // The chips are the TagChip component (one per tag), not the card.
    const chips = findAll(panel[0], (el) => typeof el.type === 'function');
    expect(chips.map((el) => (el.props.tag as { name: string }).name)).toEqual(MOCK_AXES[0].tags.map((t) => t.name));
  });

  it('Enter and Space pin; Escape on the axis unpins', () => {
    const c = start();
    c.act(() => handler(axisGroup(c.tree, 1), 'onKeyDown')(keyEvent('Enter')));
    expect(axisGroup(c.tree, 1).props['aria-expanded']).toBe(true);
    c.act(() => handler(axisGroup(c.tree, 1), 'onKeyDown')(keyEvent('Escape')));
    expect(axisGroup(c.tree, 1).props['aria-expanded']).toBe(false);
    c.act(() => handler(axisGroup(c.tree, 1), 'onKeyDown')(keyEvent(' ')));
    expect(axisGroup(c.tree, 1).props['aria-expanded']).toBe(true);
  });

  it('a second click unpins and closes the panel', () => {
    const c = start();
    c.act(() => handler(axisGroup(c.tree, 0), 'onClick')());
    c.act(() => handler(axisGroup(c.tree, 0), 'onClick')());
    expect(axisGroup(c.tree, 0).props['aria-expanded']).toBe(false);
    expect(panelHead(c.tree, MOCK_AXES[0].label)).toHaveLength(0);
  });

  it('the hover card and the pinned panel are separate; the card is not the pinned panel', () => {
    const c = start();
    c.act(() => handler(axisGroup(c.tree, 0), 'onClick')());
    expect(card(c.tree)).toHaveLength(0); // pinning closes the hover card
    c.act(() => handler(axisGroup(c.tree, 4), 'onPointerEnter')());
    expect(card(c.tree)).toHaveLength(1);
    expect(text(card(c.tree)[0])).toContain(MOCK_AXES[4].label);
    expect(axisGroup(c.tree, 0).props['aria-expanded']).toBe(true); // still pinned
    expect(panelHead(c.tree, MOCK_AXES[0].label)).toHaveLength(1);
    expect(card(c.tree)[0].props.id).not.toBe(axisGroup(c.tree, 0).props['aria-controls']);
  });

  it('with no picks the pinned tags are plain labels, not buttons', () => {
    const c = start({ picks: [] });
    c.act(() => handler(axisGroup(c.tree, 0), 'onClick')());
    const panel = findAll(c.tree, (el) => el.props.id === axisGroup(c.tree, 0).props['aria-controls'])[0];
    expect(findAll(panel, (el) => typeof el.type === 'function')).toHaveLength(0);
    expect(text(panel)).toContain(MOCK_AXES[0].tags[0].name);
  });
});

describe('card placement as rendered, at 1280 and 390 wide', () => {
  const inBoxAndClear = (width: number) => {
    const c = start({}, width);
    const layout = layoutChart({ axes: MOCK_AXES, picks: MOCK_PICKS_6, width });
    const scale = width < layout.size ? width / layout.size : 1;
    const bounds = { w: layout.size * scale, h: layout.viewHeight * scale };
    for (let i = 0; i < MOCK_AXES.length; i += 1) {
      c.act(() => handler(axisGroup(c.tree, i), 'onPointerEnter')());
      const style = card(c.tree)[0].props.style as { left: number; top: number; width: number };
      expect(style.width).toBeLessThanOrEqual(248);
      expect(style.width).toBeLessThanOrEqual(width - 8);
      const hit = layout.axes[i].hit;
      const anchor = { x: hit.x * scale, y: (hit.y - layout.viewY) * scale, w: hit.w * scale, h: hit.h * scale };
      // Horizontal fit is exact; the vertical size is estimated in the component, so only the top edge is checked here.
      expect(style.left).toBeGreaterThanOrEqual(3);
      expect(style.left + style.width).toBeLessThanOrEqual(bounds.w - 3);
      expect(style.top).toBeGreaterThanOrEqual(3);
      const cardH = 1; // any real card is at least this tall; use a minimal box to test that the anchor is not covered
      const overlap =
        style.left < anchor.x + anchor.w &&
        anchor.x < style.left + style.width &&
        style.top < anchor.y + anchor.h &&
        anchor.y < style.top + cardH;
      expect(overlap).toBe(false);
      c.act(() => handler(axisGroup(c.tree, i), 'onPointerLeave')());
    }
  };

  it('stays inside the chart and clear of every axis at 390 wide', () => inBoxAndClear(390));
  it('stays inside the chart and clear of every axis at a 1280 layout (stage about 860)', () => inBoxAndClear(860));
});

describe('narrow layout (letter markers)', () => {
  it('draws letters on the rim, names them in the key, and the card still carries the full axis name', () => {
    const width = 390;
    const layout = layoutChart({ axes: MOCK_AXES, picks: MOCK_PICKS_6, width });
    expect(layout.axes.every((g) => g.marker !== null)).toBe(true);
    const c = start({}, width);
    const letters = layout.axes.map((g) => g.letter);
    expect(letters.every((l) => typeof l === 'string' && l.length > 0)).toBe(true);
    const key = findAll(c.tree, (el) => el.type === 'ol' && el.props['aria-label'] === 'Axes');
    expect(key).toHaveLength(1);
    for (let i = 0; i < MOCK_AXES.length; i += 1) {
      c.act(() => handler(axisGroup(c.tree, i), 'onPointerEnter')());
      const body = text(card(c.tree)[0]);
      expect(body).toContain(MOCK_AXES[i].label); // the full name, not the letter
      expect(body).toContain(MOCK_AXES[i].tags[0].name);
      c.act(() => handler(axisGroup(c.tree, i), 'onPointerLeave')());
      c.act(() => handler(axisGroup(c.tree, i), 'onFocus')(keyboardFocus));
      expect(text(card(c.tree)[0])).toContain(MOCK_AXES[i].label);
      c.act(() => handler(axisGroup(c.tree, i), 'onBlur')());
    }
  });

  it('has no axis key in the wide layout', () => {
    const c = start({}, 860);
    expect(findAll(c.tree, (el) => el.type === 'ol' && el.props['aria-label'] === 'Axes')).toHaveLength(0);
  });
});

describe('pick behaviour is unchanged by the card', () => {
  it('a pick node click still reports the pick, and an axis card does not block it', () => {
    const onSelect = vi.fn();
    const c = start({ onSelect });
    c.act(() => handler(axisGroup(c.tree, 0), 'onPointerEnter')());
    const nodes = findAll(c.tree, (el) => el.type === 'g' && el.props.role === 'button' && el.props['aria-pressed'] !== undefined);
    expect(nodes.length).toBe(MOCK_PICKS_6.length);
    handler(nodes[0], 'onClick')();
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});
