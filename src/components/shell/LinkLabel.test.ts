/*
 * LinkLabel: the "pending" wording waits LINK_PENDING_DELAY_MS before it shows, both wordings share one cell, and the
 * live span carries no aria-busy. Node-only Vitest with no DOM, so React's state and effect hooks are replaced with a
 * tiny in-memory version and the component is called as a function. No network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

const h = vi.hoisted(() => ({
  navigating: false,
  slots: [] as Array<{ v?: unknown; deps?: readonly unknown[]; cleanup?: (() => void) | void }>,
  i: 0,
  dirty: false,
  effects: [] as Array<{ slot: { cleanup?: (() => void) | void }; fn: () => (() => void) | void }>,
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const hooks = {
    useState<T>(init: T) {
      const s = (h.slots[h.i] ??= { v: init });
      h.i += 1;
      return [
        s.v as T,
        (n: T) => {
          if (!Object.is(n, s.v)) {
            s.v = n;
            h.dirty = true;
          }
        },
      ] as const;
    },
    useEffect(fn: () => (() => void) | void, deps?: readonly unknown[]) {
      const s = (h.slots[h.i] ??= {});
      h.i += 1;
      const same = !!s.deps && !!deps && s.deps.length === deps.length && deps.every((x, k) => Object.is(x, s.deps![k]));
      if (!same) {
        s.deps = deps;
        h.effects.push({ slot: s, fn });
      }
    },
  };
  return { ...actual, default: { ...actual, ...hooks }, ...hooks };
});
vi.mock("next/link", () => ({ useLinkStatus: () => ({ pending: h.navigating }) }));

import { LinkLabel, LINK_PENDING_DELAY_MS } from "./LinkLabel";

type El = { type: unknown; props: Record<string, unknown> & { children?: ReactNode } };
const isEl = (n: unknown): n is El => typeof n === "object" && n !== null && "props" in n;
function find(node: unknown, pred: (e: El) => boolean): El[] {
  const out: El[] = [];
  const walk = (n: unknown) => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!isEl(n)) return;
    if (pred(n)) out.push(n);
    walk(n.props.children);
  };
  walk(node);
  return out;
}
const text = (n: unknown): string =>
  typeof n === "string" ? n : Array.isArray(n) ? n.map(text).join("") : isEl(n) ? text(n.props.children) : "";

function render() {
  for (let n = 0; n < 10; n += 1) {
    h.i = 0;
    h.dirty = false;
    const tree = (LinkLabel as unknown as (p: { children: string; pending: string }) => unknown)({ children: "Begin", pending: "Opening" });
    const queued = h.effects;
    h.effects = [];
    for (const { slot, fn } of queued) {
      if (typeof slot.cleanup === "function") slot.cleanup();
      slot.cleanup = fn();
    }
    if (!h.dirty) return tree;
  }
  throw new Error("did not settle");
}
const live = (t: unknown) => find(t, (e) => e.props["aria-live"] === "polite")[0];

beforeEach(() => {
  vi.useFakeTimers();
  h.navigating = false;
  h.slots = [];
  h.effects = [];
});
afterEach(() => vi.useRealTimers());

describe("LinkLabel", () => {
  it("shows the usual text, and no aria-busy on the live span", () => {
    const t = render();
    expect(text(live(t))).toBe("Begin");
    expect("aria-busy" in live(t).props).toBe(false);
  });

  it("waits LINK_PENDING_DELAY_MS before it says Opening, so a fast navigation never flashes", () => {
    render();
    h.navigating = true;
    expect(text(live(render()))).toBe("Begin");
    vi.advanceTimersByTime(LINK_PENDING_DELAY_MS - 1);
    expect(text(live(render()))).toBe("Begin");
    vi.advanceTimersByTime(1);
    expect(text(live(render()))).toBe("Opening");
  });

  it("never shows Opening when the navigation ends before the delay, and resets afterwards", () => {
    render();
    h.navigating = true;
    render();
    vi.advanceTimersByTime(LINK_PENDING_DELAY_MS / 2);
    h.navigating = false;
    expect(text(live(render()))).toBe("Begin");
    vi.advanceTimersByTime(LINK_PENDING_DELAY_MS * 2);
    expect(text(live(render()))).toBe("Begin");
  });

  it("lays both wordings out in one cell, hidden from assistive tech, so the width does not change", () => {
    const t = render();
    const sizers = find(t, (e) => e.props["aria-hidden"] === "true");
    expect(sizers.map(text)).toEqual(["Begin", "Opening"]);
  });
});
