/*
 * T-33: the chart key as a field filter, driven without a browser. Same approach as AttributeChart.hover.test.ts:
 * React's hooks are replaced by a tiny in-memory implementation, the component is called as a function, and the
 * element tree it returns is walked. Fixtures are the synthetic chart mocks (invented names, placeholder ids).
 */
import { describe, expect, it, vi } from 'vitest';
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
import { FIELD_LABEL } from './marks';
import styles from './AttributeChart.module.css';
import { MOCK_AXES, MOCK_PICKS_6 } from './mock';
import { FIELDS } from '@/types';
import type { Field } from '@/types';

type El = { type: unknown; props: Record<string, unknown> & { children?: ReactNode } };
const isEl = (n: unknown): n is El => typeof n === 'object' && n !== null && 'props' in n && 'type' in n;
// Function components without hooks (the key's toggle and mark) are called, so the walk sees their DOM elements.
function walk(node: unknown, visit: (el: El) => void): void {
  if (Array.isArray(node)) return node.forEach((c) => walk(c, visit));
  if (!isEl(node)) return;
  if (typeof node.type === 'function') return walk((node.type as (p: unknown) => unknown)(node.props), visit);
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
  if (isEl(node)) {
    if (typeof node.type === 'function') return text((node.type as (p: unknown) => unknown)(node.props));
    return text(node.props.children);
  }
  return '';
}

/** Render once (no state in play for the key) and return the tree. */
function render(props: Partial<AttributeChartProps> = {}) {
  h.slots = [];
  h.effects = [];
  h.dirty = false;
  h.refCount = 0;
  h.width = 0;
  h.i = 0;
  return AttributeChart({ axes: MOCK_AXES, picks: MOCK_PICKS_6, ...props });
}

const keyList = (tree: unknown) => findAll(tree, (el) => el.type === 'ul' && el.props['aria-label'] === 'Key')[0];
const keyItems = (tree: unknown) => (keyList(tree) ? findAll(keyList(tree), (el) => el.type === 'li') : []);
const keyButtons = (tree: unknown) => (keyList(tree) ? findAll(keyList(tree), (el) => el.type === 'button') : []);
const labels = (tree: unknown) => keyItems(tree).map((li) => text(li));

const fieldsOf = (picks: typeof MOCK_PICKS_6): Field[] => [...new Set(picks.map((p) => p.field))];

describe('chart key: read-only without onToggleField', () => {
  it('renders plain list items with no buttons', () => {
    const tree = render();
    expect(keyItems(tree).length).toBeGreaterThan(1);
    expect(findAll(keyList(tree), (el) => el.type === 'button')).toHaveLength(0);
    expect(keyButtons(tree)).toHaveLength(0);
  });

  it('keeps each entry as just the mark svg and a label span: no button, no sr-only', () => {
    const tree = render();
    for (const li of keyItems(tree)) {
      const kids = ([] as unknown[]).concat(li.props.children).filter(isEl);
      // The entry's children are a fragment holding the mark and the label.
      const flat = kids.flatMap((k) => (k.type === Symbol.for('react.fragment') ? ([] as unknown[]).concat(k.props.children).filter(isEl) : [k]));
      expect(flat).toHaveLength(2);
      expect(typeof flat[0].type === 'function' ? (flat[0].type as (p: unknown) => El)(flat[0].props).type : flat[0].type).toBe('svg');
      expect(flat[1].type).toBe('span');
      expect(findAll(li, (el) => el.type === 'button')).toHaveLength(0);
      expect(findAll(li, (el) => String(el.props.className ?? '').includes('sr-only'))).toHaveLength(0);
    }
  });

  it('ignores hiddenFields and fieldsInKey when there is no onToggleField', () => {
    const plain = labels(render());
    const present = fieldsOf(MOCK_PICKS_6);
    const absent = (['music', 'film', 'tv', 'books', 'food_places', 'fashion'] as Field[]).filter((f) => !present.includes(f));
    const tree = render({ hiddenFields: present, fieldsInKey: absent });
    expect(labels(tree)).toEqual(plain);
    expect(text(keyList(tree))).not.toContain('hidden');
  });
});

describe('chart key: toggles with onToggleField', () => {
  it('makes each entry a button with its label and aria-pressed true when shown', () => {
    const tree = render({ onToggleField: () => {} });
    const buttons = findAll(keyList(tree), (el) => el.type === 'button');
    expect(buttons.length).toBe(fieldsOf(MOCK_PICKS_6).length);
    for (const b of buttons) {
      expect(b.props.type).toBe('button');
      expect(b.props['aria-pressed']).toBe(true);
    }
    expect(buttons.map((b) => text(b))).toEqual(fieldsOf(MOCK_PICKS_6).map((f) => FIELD_LABEL[f]));
  });

  it('shows a hidden field as aria-pressed false, with "hidden" in its accessible name', () => {
    const [first, ...rest] = fieldsOf(MOCK_PICKS_6);
    const tree = render({ hiddenFields: [first], onToggleField: () => {} });
    const buttons = findAll(keyList(tree), (el) => el.type === 'button');
    expect(buttons[0].props['aria-pressed']).toBe(false);
    expect(text(buttons[0])).toBe(`${FIELD_LABEL[first]}, hidden`);
    buttons.slice(1).forEach((b, i) => {
      expect(b.props['aria-pressed']).toBe(true);
      expect(text(b)).toBe(FIELD_LABEL[rest[i]]);
    });
  });

  it('calls onToggleField with its own field from each button, found by label', () => {
    const calls: Field[] = [];
    const tree = render({ onToggleField: (f) => calls.push(f) });
    const buttons = findAll(keyList(tree), (el) => el.type === 'button');
    for (const f of fieldsOf(MOCK_PICKS_6)) {
      const button = buttons.find((b) => text(b) === FIELD_LABEL[f])!;
      expect(button).toBeDefined();
      calls.length = 0;
      (button.props.onClick as () => void)();
      expect(calls).toEqual([f]);
    }
  });

  it('lists entries in the chart\'s field order, whatever order the picks arrive in', () => {
    const reversed = [...MOCK_PICKS_6].reverse();
    expect(fieldsOf(reversed)).not.toEqual(FIELDS.filter((f) => fieldsOf(reversed).includes(f)));
    const tree = render({ picks: reversed, onToggleField: () => {} });
    const ids = keyButtons(tree).map((b) => b.props.id);
    expect(ids).toEqual(FIELDS.filter((f) => fieldsOf(reversed).includes(f)).map((f) => `chart-key-${f}`));
  });

  it('gives each button the id chart-key-{field}', () => {
    const tree = render({ onToggleField: () => {} });
    const buttons = keyButtons(tree);
    expect(buttons.map((b) => b.props.id)).toEqual(
      FIELDS.filter((f) => fieldsOf(MOCK_PICKS_6).includes(f)).map((f) => `chart-key-${f}`),
    );
  });

  it('draws a hidden field\'s mark with a different class than a shown one', () => {
    const [first, second] = FIELDS.filter((f) => fieldsOf(MOCK_PICKS_6).includes(f));
    const tree = render({ hiddenFields: [first], onToggleField: () => {} });
    const [hiddenBtn, shownBtn] = keyButtons(tree);
    const markClass = (b: El) => findAll(b, (el) => el.type === 'path')[0].props.className;
    expect(hiddenBtn.props.id).toBe(`chart-key-${first}`);
    expect(shownBtn.props.id).toBe(`chart-key-${second}`);
    expect(markClass(hiddenBtn)).toBe(styles.legendMarkHidden);
    expect(markClass(shownBtn)).toBe(styles.legendMark);
    expect(markClass(hiddenBtn)).not.toBe(markClass(shownBtn));
  });

  it('keeps a field whose picks are all hidden in the key via fieldsInKey, so it can be shown again', () => {
    const [first, ...rest] = fieldsOf(MOCK_PICKS_6);
    const visible = MOCK_PICKS_6.filter((p) => p.field !== first);
    const without = render({ picks: visible, hiddenFields: [first], onToggleField: () => {} });
    expect(text(keyList(without))).not.toContain(FIELD_LABEL[first]);
    expect(findAll(keyList(without), (el) => el.type === 'button')).toHaveLength(rest.length);

    const calls: Field[] = [];
    const withKey = render({
      picks: visible,
      hiddenFields: [first],
      fieldsInKey: fieldsOf(MOCK_PICKS_6),
      onToggleField: (f) => calls.push(f),
    });
    const buttons = findAll(keyList(withKey), (el) => el.type === 'button');
    expect(buttons).toHaveLength(rest.length + 1);
    const entry = buttons.find((b) => text(b).startsWith(FIELD_LABEL[first]))!;
    expect(entry.props['aria-pressed']).toBe(false);
    expect(text(entry)).toBe(`${FIELD_LABEL[first]}, hidden`);
    (entry.props.onClick as () => void)();
    expect(calls).toEqual([first]);
  });

  it('adds no "Fields" label or extra row to the key', () => {
    const tree = render({ onToggleField: () => {}, fieldsInKey: fieldsOf(MOCK_PICKS_6) });
    expect(text(keyList(tree))).not.toMatch(/\bFields\b/);
    expect(findAll(tree, (el) => el.type === 'figcaption')).toHaveLength(1);
    expect(findAll(tree, (el) => el.type === 'ul' && el.props['aria-label'] === 'Key')).toHaveLength(1);
  });
});
