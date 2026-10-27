/*
 * T-32: the onboarding flow's request handling, driven without a browser. Vitest here is node-only with no DOM
 * library, so (as in src/components/chart/AttributeChart.hover.test.ts) this file replaces React's hooks with a tiny
 * in-memory implementation, calls the components as plain functions and walks the element tree they return. Event
 * handlers are called the way React would call them, taken from the latest render. There is one component instance,
 * as in the browser: the stored list is read into it after hydration, with no remount. `fetch` is a stub whose replies the test releases by hand, so the order requests finish in is under
 * test control. No network, no live calls. Fixtures are synthetic: invented names, placeholder ids.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

interface Slot {
  v?: unknown;
  deps?: readonly unknown[];
  cleanup?: (() => void) | void;
  ref?: { current: unknown };
}
interface Inst {
  slots: Slot[];
  i: number;
  dirty: boolean;
  effects: Array<{ slot: Slot; fn: () => (() => void) | void }>;
  fn: (props: never) => unknown;
  props: unknown;
  key: unknown;
  tree: unknown;
}

const h = vi.hoisted(() => ({
  cur: null as unknown as Inst | null,
  hydrated: false,
  nextId: 0,
  push: vi.fn(),
  prefetch: vi.fn(),
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const same = (a?: readonly unknown[], b?: readonly unknown[]) =>
    !!a && !!b && a.length === b.length && a.every((x, k) => Object.is(x, b[k]));
  const slot = (): { s: Slot; inst: Inst } => {
    const inst = h.cur!;
    const s = (inst.slots[inst.i] ??= {});
    inst.i += 1;
    return { s, inst };
  };
  const hooks = {
    useState<T>(init: T | (() => T)) {
      const { s, inst } = slot();
      if (!("v" in s)) s.v = typeof init === "function" ? (init as () => T)() : init;
      const set = (n: T | ((p: T) => T)) => {
        const next = typeof n === "function" ? (n as (p: T) => T)(s.v as T) : n;
        if (!Object.is(next, s.v)) {
          s.v = next;
          inst.dirty = true;
        }
      };
      return [s.v as T, set] as const;
    },
    useReducer<S, A, I>(reducer: (s: S, a: A) => S, arg: I, init?: (a: I) => S) {
      const { s, inst } = slot();
      if (!("v" in s)) s.v = init ? init(arg) : (arg as unknown as S);
      const dispatch = (a: A) => {
        const next = reducer(s.v as S, a);
        if (!Object.is(next, s.v)) {
          s.v = next;
          inst.dirty = true;
        }
      };
      return [s.v as S, dispatch] as const;
    },
    useRef<T>(init: T) {
      const { s } = slot();
      if (!s.ref) s.ref = { current: init };
      return s.ref;
    },
    useMemo<T>(fn: () => T, deps: readonly unknown[]) {
      const { s } = slot();
      if (!same(s.deps, deps)) {
        s.v = fn();
        s.deps = deps;
      }
      return s.v as T;
    },
    useEffect(fn: () => (() => void) | void, deps?: readonly unknown[]) {
      const { s, inst } = slot();
      if (!same(s.deps, deps) || deps === undefined) {
        s.deps = deps;
        inst.effects.push({ slot: s, fn });
      }
    },
  };
  return { ...actual, default: { ...actual, ...hooks }, ...hooks };
});

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: h.push, prefetch: h.prefetch }) }));

// The hydration flag and the seed ids are the only things taken from ./hooks; both are put under test control.
vi.mock("./hooks", () => ({
  useHydrated: () => h.hydrated,
  newSeedId: () => `seed-${(h.nextId += 1)}`,
}));

import { OnboardingFlow } from "./OnboardingFlow";
import { SeedList } from "./SeedList";
import { buildEntry } from "./flow";
import type { Entry } from "./flow";
import { chip, resolvedDraft, uid } from "./fixtures";
import { FLOW_STORAGE_KEY, TASTE_PATH, TASTE_STORAGE_KEY, WHY_TIMEOUT_MS } from "./constants";
import { COPY } from "./copy";
import { SESSION_VERSION } from "./session";
import type { Field, ProfileSeed, WhyTag } from "./types";

// ---- window and sessionStorage stand-ins, with a log of every call -------------------------------------------------

type Op = { op: "get" | "set" | "remove"; key: string; value?: string };
let ops: Op[] = [];
let data = new Map<string, string>();
const fakeStorage = {
  getItem: (k: string) => {
    ops.push({ op: "get", key: k });
    return data.get(k) ?? null;
  },
  setItem: (k: string, v: string) => {
    ops.push({ op: "set", key: k, value: v });
    data.set(k, v);
  },
  removeItem: (k: string) => {
    ops.push({ op: "remove", key: k });
    data.delete(k);
  },
};
beforeAll(() => {
  (globalThis as { window?: unknown }).window = { sessionStorage: fakeStorage };
});
afterAll(() => {
  delete (globalThis as { window?: unknown }).window;
});

// ---- fetch stub: every request waits until the test answers it -----------------------------------------------------

interface Call {
  url: string;
  body: Record<string, unknown>;
  signal?: AbortSignal;
  reply: (status: number, body: unknown) => void;
  fail: () => void;
}
let calls: Call[] = [];
const RESOLVE = "/api/seeds/resolve";
const WHY = "/api/profile/why";
const PROFILE = "/api/profile";

beforeEach(() => {
  calls = [];
  ops = [];
  data = new Map();
  h.hydrated = true;
  h.nextId = 0;
  h.push.mockClear();
  h.prefetch.mockClear();
  vi.stubGlobal(
    "fetch",
    (url: string, init: { body: string; signal?: AbortSignal }) =>
      new Promise((resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        calls.push({
          url,
          signal: init.signal,
          body: JSON.parse(init.body) as Record<string, unknown>,
          reply: (status, body) => resolve({ status, json: async () => body }),
          fail: () => reject(new Error("network down")),
        });
      }),
  );
});
afterEach(() => {
  live?.unmount();
  live = null;
  vi.unstubAllGlobals();
});

const callsTo = (url: string) => calls.filter((c) => c.url === url);
const whyFor = (id: string) => {
  const found = callsTo(WHY).filter((c) => c.body.seedId === id);
  expect(found).toHaveLength(1);
  return found[0];
};

// ---- mini renderer -------------------------------------------------------------------------------------------------

type El = { type: unknown; key?: unknown; props: Record<string, unknown> & { children?: ReactNode } };
const isEl = (n: unknown): n is El => typeof n === "object" && n !== null && "props" in n && "type" in n;

function findAll(node: unknown, pred: (el: El) => boolean): El[] {
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
function text(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  if (isEl(node) && typeof node.type === "string") return text(node.props.children);
  return "";
}

const newInst = (fn: Inst["fn"], key: unknown = null, props: unknown = {}): Inst => ({
  slots: [],
  i: 0,
  dirty: false,
  effects: [],
  fn,
  props,
  key,
  tree: null,
});
const renderInst = (inst: Inst) => {
  h.cur = inst;
  inst.i = 0;
  inst.dirty = false;
  try {
    inst.tree = inst.fn(inst.props as never);
  } finally {
    h.cur = null;
  }
};

function mount() {
  const root = newInst(OnboardingFlow as Inst["fn"]);
  const runEffects = (inst: Inst) => {
    const queued = inst.effects;
    inst.effects = [];
    for (const { slot, fn } of queued) {
      if (typeof slot.cleanup === "function") slot.cleanup();
      slot.cleanup = fn();
    }
  };
  /** Render, then effects, until nothing is dirty. */
  const settle = () => {
    for (let n = 0; n < 30; n += 1) {
      renderInst(root);
      runEffects(root);
      if (!root.dirty) return;
    }
    throw new Error("render did not settle");
  };
  settle();
  return {
    get tree() {
      return root.tree;
    },
    /** Re-render after something outside React changed (the hydration flag). */
    rerender: settle,
    /** Let pending promises run, then re-render until settled. */
    async flush() {
      // With fake timers a real wait would never end; advancing by zero lets pending promises run just the same.
      for (let n = 0; n < 3; n += 1) {
        if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(0);
        else await new Promise((r) => setTimeout(r, 0));
      }
      settle();
    },
    /** Run something synchronously (an event handler), then re-render. */
    act(fn: () => void) {
      fn();
      settle();
    },
    unmount() {
      for (const s of root.slots) if (typeof s.cleanup === "function") s.cleanup();
    },
  };
}
type Mounted = ReturnType<typeof mount>;
let live: Mounted | null = null;
const start = () => (live = mount());

// ---- reading the tree and driving the form -------------------------------------------------------------------------

const event = { preventDefault: () => {} };
const forms = (t: unknown) => findAll(t, (e) => e.type === "form");
const inputById = (t: unknown, id: string) => findAll(t, (e) => e.type === "input" && e.props.id === id)[0];
const buttons = (t: unknown) => findAll(t, (e) => e.type === "button");
const findButton = (t: unknown) => forms(t)[0] && findAll(forms(t)[0], (e) => e.type === "button" && e.props.type === "submit")[0];
const seeTasteButton = (t: unknown) => buttons(t).find((b) => b.props.type === "button" && b.props.onClick && b.props["aria-describedby"] === "ready-text")!;
const seedList = (t: unknown) => findAll(t, (e) => typeof e.props.onRemove === "function" && "entries" in e.props)[0];
const listEntries = (t: unknown) => seedList(t).props.entries as Entry[];
const listPending = (t: unknown) => seedList(t).props.pending as ReadonlySet<string>;
const entryById = (t: unknown, id: string) => listEntries(t).find((e) => e.seed.id === id);
const alerts = (t: unknown) => findAll(t, (e) => e.props.role === "alert").map(text);

const tagsFor = (n: number): WhyTag[] => [{ tag: `urn:tag:fixture:theme:t${n}`, name: `Invented theme ${n}`, tagType: "urn:tag:theme:media" }];
const whyBody = (n: number) => ({ tags: tagsFor(n), trace: [] });
const profileBody = {
  profile: {
    seedIds: [],
    skippedSeeds: [],
    fields: ["film"],
    tags: [],
    bridgeTagIds: [],
    droppedGenericCount: 0,
    droppedAxisTagTypes: [],
    naming: {},
  },
  axes: [],
  trace: [],
};
const chipBody = (n: number) => ({ status: "clean", entity: chip(n) });

/** Type a query and press Find; the resolve request stays open until the test answers it. */
async function find(m: Mounted, n: number, field: Field) {
  const select = findAll(m.tree, (e) => e.type === "select")[0];
  m.act(() => (select.props.onChange as (e: unknown) => void)({ target: { value: field } }));
  m.act(() => (inputById(m.tree, "query").props.onChange as (e: unknown) => void)({ target: { value: `invented ${n}` } }));
  const before = callsTo(RESOLVE).length;
  let done!: Promise<void>;
  m.act(() => {
    done = (forms(m.tree)[0].props.onSubmit as (e: unknown) => Promise<void>)(event);
  });
  expect(callsTo(RESOLVE)).toHaveLength(before + 1);
  return { reply: () => callsTo(RESOLVE)[before].reply(200, chipBody(n)), done };
}

/** Find a match for seed n and add it, leaving its why request in flight. Returns the seed id. */
async function addSeed(m: Mounted, n: number, field: Field, why = "It feels unhurried and exact") {
  const f = await find(m, n, field);
  f.reply();
  await f.done;
  await m.flush();
  m.act(() => (inputById(m.tree, "why").props.onChange as (e: unknown) => void)({ target: { value: why } }));
  m.act(() => (forms(m.tree)[1].props.onSubmit as (e: unknown) => void)(event));
  return `seed-${h.nextId}`;
}

const press = async (m: Mounted) => {
  let p!: Promise<void>;
  m.act(() => {
    p = (seeTasteButton(m.tree).props.onClick as () => Promise<void>)();
  });
  return p;
};

/** Three seeds across two fields: enough for "See my taste". Their whys are all still in flight. */
async function addThree(m: Mounted) {
  const ids = [await addSeed(m, 1, "film"), await addSeed(m, 2, "music"), await addSeed(m, 3, "books")];
  return ids;
}

// ---- tests ---------------------------------------------------------------------------------------------------------

describe("requests per seed", () => {
  it("makes exactly one resolve and one why per seed, then one profile request in all", async () => {
    const m = start();
    const ids = await addThree(m);
    expect(callsTo(RESOLVE)).toHaveLength(3);
    expect(callsTo(WHY)).toHaveLength(3);
    expect(callsTo(WHY).map((c) => c.body.seedId).sort()).toEqual([...ids].sort());
    expect(callsTo(PROFILE)).toHaveLength(0);

    ids.forEach((id, k) => whyFor(id).reply(200, whyBody(k + 1)));
    await m.flush();
    // Settling the whys, re-rendering and hydrating again make no new requests.
    expect(callsTo(WHY)).toHaveLength(3);
    expect(callsTo(RESOLVE)).toHaveLength(3);

    const p = press(m);
    await m.flush();
    expect(callsTo(PROFILE)).toHaveLength(1);
    callsTo(PROFILE)[0].reply(200, profileBody);
    await p;
    expect(calls).toHaveLength(7);
    expect(h.push).toHaveBeenCalledWith(TASTE_PATH);
  });

  it("makes no why request for a duplicate entity or an empty reason", async () => {
    const m = start();
    await addSeed(m, 1, "film");
    expect(callsTo(WHY)).toHaveLength(1);

    // The same entity again: refused on the list, no second why.
    const f = await find(m, 1, "film");
    f.reply();
    await f.done;
    await m.flush();
    m.act(() => (inputById(m.tree, "why").props.onChange as (e: unknown) => void)({ target: { value: "Again, still quiet" } }));
    m.act(() => (forms(m.tree)[1].props.onSubmit as (e: unknown) => void)(event));
    expect(callsTo(WHY)).toHaveLength(1);
    expect(listEntries(m.tree)).toHaveLength(1);
    expect(alerts(m.tree)).toContain(COPY.duplicate);

    // A new entity with a blank reason: refused by validation, no why.
    const g = await find(m, 2, "music");
    g.reply();
    await g.done;
    await m.flush();
    m.act(() => (inputById(m.tree, "why").props.onChange as (e: unknown) => void)({ target: { value: "   " } }));
    m.act(() => (forms(m.tree)[1].props.onSubmit as (e: unknown) => void)(event));
    expect(callsTo(WHY)).toHaveLength(1);
    expect(listEntries(m.tree)).toHaveLength(1);
  });
});

describe("adding a seed", () => {
  it("puts the seed on the list at once, marks it pending, and frees the form", async () => {
    const m = start();
    const id = await addSeed(m, 1, "film");
    // The why has not answered, yet the seed is listed, untagged, and flagged as being read.
    const e = entryById(m.tree, id)!;
    expect(e).toBeDefined();
    expect(e.whyMapped).toBe(false);
    expect(e.seed.whyTags).toBeUndefined();
    expect(listPending(m.tree).has(id)).toBe(true);
    // The draft is reset and the Find button is not busy, so the next seed can start now.
    expect((inputById(m.tree, "query").props as { value: string }).value).toBe("");
    expect(inputById(m.tree, "why")).toBeUndefined();
    expect(findButton(m.tree).props["aria-busy"]).toBe(false);

    // A second seed's resolve goes out while the first why is still open.
    const f = await find(m, 2, "music");
    expect(callsTo(WHY).filter((c) => c.body.seedId === id)).toHaveLength(1);
    f.reply();
    await f.done;
    expect(listEntries(m.tree)).toHaveLength(1);
  });

  it("clears the pending flag and keeps the tags when the why answers", async () => {
    const m = start();
    const id = await addSeed(m, 1, "film");
    whyFor(id).reply(200, whyBody(1));
    await m.flush();
    expect(listPending(m.tree).size).toBe(0);
    const e = entryById(m.tree, id)!;
    expect(e.whyMapped).toBe(true);
    expect(e.seed.whyTags).toEqual(tagsFor(1));
  });

  it("an answer of no tags still counts as mapped", async () => {
    const m = start();
    const id = await addSeed(m, 1, "film");
    whyFor(id).reply(200, { tags: [], trace: [] });
    await m.flush();
    const e = entryById(m.tree, id)!;
    expect(e.whyMapped).toBe(true);
    expect(e.seed.whyTags).toEqual([]);
  });
});

describe("whys that finish out of order", () => {
  it("attach each seed's own tags whichever answer arrives first", async () => {
    const m = start();
    const [a, b, c] = await addThree(m);
    // Three whys are open together.
    expect(callsTo(WHY)).toHaveLength(3);
    expect([...listPending(m.tree)].sort()).toEqual([a, b, c].sort());

    whyFor(c).reply(200, whyBody(3));
    await m.flush();
    expect(entryById(m.tree, c)!.seed.whyTags).toEqual(tagsFor(3));
    expect(entryById(m.tree, a)!.seed.whyTags).toBeUndefined();
    expect(entryById(m.tree, b)!.seed.whyTags).toBeUndefined();
    expect(listPending(m.tree).has(c)).toBe(false);
    expect(listPending(m.tree).has(a)).toBe(true);

    whyFor(a).reply(200, whyBody(1));
    await m.flush();
    whyFor(b).reply(200, whyBody(2));
    await m.flush();

    expect(entryById(m.tree, a)!.seed.whyTags).toEqual(tagsFor(1));
    expect(entryById(m.tree, b)!.seed.whyTags).toEqual(tagsFor(2));
    expect(entryById(m.tree, c)!.seed.whyTags).toEqual(tagsFor(3));
    expect(listPending(m.tree).size).toBe(0);
    // The list keeps the order the seeds were added in, not the order the answers came in.
    expect(listEntries(m.tree).map((e) => e.seed.id)).toEqual([a, b, c]);
    // An answer never changes the seed's own fields or matched entity.
    expect(listEntries(m.tree).map((e) => e.seed.qlooId)).toEqual([uid(1), uid(2), uid(3)]);
  });

  it("two answers landing in the same turn both keep their tags", async () => {
    const m = start();
    const [a, b] = [await addSeed(m, 1, "film"), await addSeed(m, 2, "music")];
    whyFor(b).reply(200, whyBody(2));
    whyFor(a).reply(200, whyBody(1));
    await m.flush();
    expect(entryById(m.tree, a)!.seed.whyTags).toEqual(tagsFor(1));
    expect(entryById(m.tree, b)!.seed.whyTags).toEqual(tagsFor(2));
  });
});

describe("removing a seed while its why is in flight", () => {
  it("does not bring it back when the answer arrives", async () => {
    const m = start();
    const [a, b, c] = await addThree(m);
    const onRemove = seedList(m.tree).props.onRemove as (id: string) => void;
    m.act(() => onRemove(b));
    expect(listEntries(m.tree).map((e) => e.seed.id)).toEqual([a, c]);

    whyFor(b).reply(200, whyBody(2));
    await m.flush();
    expect(entryById(m.tree, b)).toBeUndefined();
    expect(listEntries(m.tree).map((e) => e.seed.id)).toEqual([a, c]);
    expect(listPending(m.tree).has(b)).toBe(false);
    // Storage never holds it again either.
    const writes = ops.filter((o) => o.op === "set" && o.key === FLOW_STORAGE_KEY);
    expect(writes.at(-1)!.value).not.toContain(b);
  });

  it("does not bring it back when the answer is a failure", async () => {
    const m = start();
    const [a] = await addThree(m);
    m.act(() => (seedList(m.tree).props.onRemove as (id: string) => void)(a));
    whyFor(a).fail();
    await m.flush();
    expect(entryById(m.tree, a)).toBeUndefined();
    expect(listEntries(m.tree)).toHaveLength(2);
  });

  it("sends neither the seed nor its tags to the profile request", async () => {
    const m = start();
    const [a, b, c] = await addThree(m);
    const d = await addSeed(m, 4, "tv");
    m.act(() => (seedList(m.tree).props.onRemove as (id: string) => void)(b));
    // Its answer arrives late, after the person has pressed See my taste.
    [a, c, d].forEach((id) => whyFor(id).reply(200, whyBody(Number(id.slice(5)))));
    const p = press(m);
    await m.flush();
    whyFor(b).reply(200, whyBody(2));
    await m.flush();

    expect(callsTo(PROFILE)).toHaveLength(1);
    const sent = callsTo(PROFILE)[0].body.seeds as ProfileSeed[];
    expect(sent.map((s) => s.id)).toEqual([a, c, d]);
    expect(JSON.stringify(sent)).not.toContain(tagsFor(2)[0].tag);
    expect(sent.find((s) => s.id === a)!.whyTags).toEqual(tagsFor(1));
    callsTo(PROFILE)[0].reply(200, profileBody);
    await p;
  });
});

describe("See my taste waits for the whys", () => {
  it("sends no profile request until every pending why has answered, then sends one with all tags", async () => {
    const m = start();
    const [a, b, c] = await addThree(m);
    const p = press(m);
    await m.flush();
    // Building state shows at once, and no profile request has been made.
    expect(text(seeTasteButton(m.tree))).toBe(COPY.building);
    expect(seeTasteButton(m.tree).props["aria-busy"]).toBe(true);
    expect(callsTo(PROFILE)).toHaveLength(0);

    // Still waiting on b and c after a answers.
    whyFor(a).reply(200, whyBody(1));
    await m.flush();
    expect(callsTo(PROFILE)).toHaveLength(0);
    whyFor(c).reply(200, whyBody(3));
    await m.flush();
    expect(callsTo(PROFILE)).toHaveLength(0);
    whyFor(b).reply(200, whyBody(2));
    await m.flush();

    expect(callsTo(PROFILE)).toHaveLength(1);
    const sent = callsTo(PROFILE)[0].body.seeds as ProfileSeed[];
    expect(sent.map((s) => s.whyTags)).toEqual([tagsFor(1), tagsFor(2), tagsFor(3)]);
    expect(h.push).not.toHaveBeenCalled();
    callsTo(PROFILE)[0].reply(200, profileBody);
    await p;
    expect(h.push).toHaveBeenCalledTimes(1);
    expect(h.push).toHaveBeenCalledWith(TASTE_PATH);
    const saved = JSON.parse(data.get(TASTE_STORAGE_KEY)!) as { seeds: ProfileSeed[] };
    expect(saved.seeds.map((s) => s.id)).toEqual([a, b, c]);
  });

  it("all whys are already open together when it is pressed (it waits on them, it does not start them)", async () => {
    const m = start();
    await addThree(m);
    const before = callsTo(WHY).length;
    const p = press(m);
    await m.flush();
    expect(callsTo(WHY)).toHaveLength(before);
    expect(callsTo(WHY)).toHaveLength(3);
    callsTo(WHY).forEach((c, k) => c.reply(200, whyBody(k + 1)));
    await m.flush();
    callsTo(PROFILE)[0].reply(200, profileBody);
    await p;
  });

  it("goes straight to the profile request when no why is pending", async () => {
    const m = start();
    const ids = await addThree(m);
    ids.forEach((id, k) => whyFor(id).reply(200, whyBody(k + 1)));
    await m.flush();
    const p = press(m);
    expect(callsTo(PROFILE)).toHaveLength(1);
    callsTo(PROFILE)[0].reply(200, profileBody);
    await p;
  });

  it("does nothing, and makes no request, while the list is not ready", async () => {
    const m = start();
    await addSeed(m, 1, "film");
    await press(m);
    await m.flush();
    expect(callsTo(PROFILE)).toHaveLength(0);
    expect(text(seeTasteButton(m.tree))).toBe(COPY.seeTaste);
    expect(alerts(m.tree).length).toBeGreaterThan(0);
  });

  it("a pressed button is not pressed twice: a second press while building adds no request", async () => {
    const m = start();
    const ids = await addThree(m);
    const p = press(m);
    await m.flush();
    await press(m);
    ids.forEach((id, k) => whyFor(id).reply(200, whyBody(k + 1)));
    await m.flush();
    expect(callsTo(PROFILE)).toHaveLength(1);
    callsTo(PROFILE)[0].reply(200, profileBody);
    await p;
  });

  it("shows a calm error and frees the button when the profile request fails", async () => {
    const m = start();
    const ids = await addThree(m);
    ids.forEach((id, k) => whyFor(id).reply(200, whyBody(k + 1)));
    await m.flush();
    const p = press(m);
    callsTo(PROFILE)[0].fail();
    await p;
    await m.flush();
    expect(h.push).not.toHaveBeenCalled();
    expect(alerts(m.tree)).toContain(COPY.profileFailed);
    expect(text(seeTasteButton(m.tree))).toBe(COPY.seeTaste);
    expect(data.has(TASTE_STORAGE_KEY)).toBe(false);
  });
});

describe("a why that fails", () => {
  const failures: Array<[string, (c: Call) => void]> = [
    ["a network error", (c) => c.fail()],
    ["a server error", (c) => c.reply(500, { error: { code: "internal", message: "no" } })],
    ["a model timeout", (c) => c.reply(504, { error: { code: "timeout", message: "slow" } })],
    ["an empty body", (c) => c.reply(200, null)],
    ["a body with no tags array", (c) => c.reply(200, { trace: [] })],
    ["freeform tags the client refuses", (c) => c.reply(200, { tags: [{ tag: "words", name: "x", tagType: "t" }] })],
  ];

  it.each(failures)("leaves the seed on the list without tags after %s", async (_name, fail) => {
    const m = start();
    const [a, b] = [await addSeed(m, 1, "film"), await addSeed(m, 2, "music")];
    fail(whyFor(a));
    whyFor(b).reply(200, whyBody(2));
    await m.flush();
    const e = entryById(m.tree, a)!;
    expect(e).toBeDefined();
    expect(e.whyMapped).toBe(false);
    expect(e.seed.whyTags).toBeUndefined();
    expect(listPending(m.tree).size).toBe(0);
    // The other seed is unaffected.
    expect(entryById(m.tree, b)!.seed.whyTags).toEqual(tagsFor(2));
    expect(listEntries(m.tree)).toHaveLength(2);
  });

  it("does not stop See my taste: the profile request still goes, with that seed untagged", async () => {
    const m = start();
    const [a, b, c] = await addThree(m);
    const p = press(m);
    await m.flush();
    whyFor(a).fail();
    whyFor(b).reply(200, whyBody(2));
    whyFor(c).reply(500, { error: { code: "internal", message: "no" } });
    await m.flush();
    expect(callsTo(PROFILE)).toHaveLength(1);
    const sent = callsTo(PROFILE)[0].body.seeds as ProfileSeed[];
    expect(sent.map((s) => s.id)).toEqual([a, b, c]);
    expect("whyTags" in sent[0]).toBe(false);
    expect(sent[1].whyTags).toEqual(tagsFor(2));
    expect("whyTags" in sent[2]).toBe(false);
    callsTo(PROFILE)[0].reply(200, profileBody);
    await p;
    expect(h.push).toHaveBeenCalledWith(TASTE_PATH);
  });

  it("makes no second why request for the failed seed (no retry)", async () => {
    const m = start();
    const a = await addSeed(m, 1, "film");
    whyFor(a).fail();
    await m.flush();
    expect(callsTo(WHY)).toHaveLength(1);
  });
});

describe("storage and hydration", () => {
  const stored = (): Entry[] => [
    buildEntry(resolvedDraft("film", 7), "seed-a", tagsFor(7))!,
    buildEntry(resolvedDraft("music", 8), "seed-b", tagsFor(8))!,
  ];
  const putFlow = (entries: Entry[], field: Field = "music") =>
    data.set(FLOW_STORAGE_KEY, JSON.stringify({ version: SESSION_VERSION, field, entries }));
  const sets = () => ops.filter((o) => o.op === "set");

  it("writes nothing and clears nothing before the stored list is read", () => {
    putFlow(stored());
    const before = data.get(FLOW_STORAGE_KEY);
    h.hydrated = false;
    const m = start();
    expect(ops.filter((o) => o.op !== "get")).toEqual([]);
    expect(data.get(FLOW_STORAGE_KEY)).toBe(before);
    expect(listEntries(m.tree)).toEqual([]);
    // Nothing is prefetched yet either.
    expect(h.prefetch).not.toHaveBeenCalled();
  });

  it("keeps Find disabled and ignores a submit until hydration, then enables it", async () => {
    h.hydrated = false;
    const m = start();
    expect(findButton(m.tree).props.disabled).toBe(true);
    // Enter in the box is a form submit: it must not start a lookup.
    m.act(() => (inputById(m.tree, "query").props.onChange as (e: unknown) => void)({ target: { value: "invented 1" } }));
    await (forms(m.tree)[0].props.onSubmit as (e: unknown) => Promise<void>)(event);
    expect(calls).toHaveLength(0);

    h.hydrated = true;
    m.rerender();
    expect(findButton(m.tree).props.disabled).toBe(false);
  });

  it("restores the stored list after hydration and writes it back unchanged, never an empty list first", () => {
    putFlow(stored(), "music");
    h.hydrated = false;
    const m = start();
    h.hydrated = true;
    m.rerender();

    expect(listEntries(m.tree).map((e) => e.seed.id)).toEqual(["seed-a", "seed-b"]);
    expect(listEntries(m.tree)[0].seed.whyTags).toEqual(tagsFor(7));
    expect((findAll(m.tree, (e) => e.type === "select")[0].props as { value: string }).value).toBe("music");

    // It was read before anything was written, and every write holds the restored list.
    const firstGet = ops.findIndex((o) => o.op === "get" && o.key === FLOW_STORAGE_KEY);
    const firstSet = ops.findIndex((o) => o.op === "set");
    expect(firstGet).toBeGreaterThanOrEqual(0);
    expect(firstSet).toBeGreaterThan(firstGet);
    for (const w of sets().filter((o) => o.key === FLOW_STORAGE_KEY)) {
      const saved = JSON.parse(w.value!) as { entries: Entry[] };
      expect(saved.entries.map((e) => e.seed.id)).toEqual(["seed-a", "seed-b"]);
    }
    // Restoring does not drop the stored chart (the list did not change).
    expect(ops.some((o) => o.op === "remove" && o.key === TASTE_STORAGE_KEY)).toBe(false);
  });

  it("prefetches the taste screen once the flow is live, and not before", () => {
    h.hydrated = false;
    const m = start();
    expect(h.prefetch).not.toHaveBeenCalled();
    h.hydrated = true;
    m.rerender();
    expect(h.prefetch).toHaveBeenCalledWith(TASTE_PATH);
  });

  it("with nothing stored, keeps the same instance and what was typed before hydration", () => {
    h.hydrated = false;
    const m = start();
    m.act(() => (inputById(m.tree, "query").props.onChange as (e: unknown) => void)({ target: { value: "typed early" } }));
    h.hydrated = true;
    m.rerender();
    expect((inputById(m.tree, "query").props as { value: string }).value).toBe("typed early");
  });

  it.each([
    ["not JSON", "{"],
    ["a wrong version", JSON.stringify({ version: 99, field: "film", entries: [] })],
    ["an unknown field", JSON.stringify({ version: 1, field: "cars", entries: [] })],
  ])("treats a stored value that is %s as no list", (_n, raw) => {
    data.set(FLOW_STORAGE_KEY, raw);
    const m = start();
    expect(listEntries(m.tree)).toEqual([]);
  });

  it("saves the list after each change once live, and drops the stored chart when the list changes", async () => {
    data.set(TASTE_STORAGE_KEY, "stale");
    const m = start();
    const id = await addSeed(m, 1, "film");
    expect(data.has(TASTE_STORAGE_KEY)).toBe(false);
    whyFor(id).reply(200, whyBody(1));
    await m.flush();
    const last = sets().filter((o) => o.key === FLOW_STORAGE_KEY).at(-1)!;
    const saved = JSON.parse(last.value!) as { entries: Entry[] };
    expect(saved.entries).toHaveLength(1);
    expect(saved.entries[0].seed.whyTags).toEqual(tagsFor(1));
  });

  it("a stored list that is full replaces the form", () => {
    const entries = Array.from({ length: 10 }, (_, k) => buildEntry(resolvedDraft(k % 2 ? "film" : "music", 20 + k), `seed-${k}`, [])!);
    putFlow(entries);
    const m = start();
    expect(listEntries(m.tree)).toHaveLength(10);
    expect(forms(m.tree)).toHaveLength(0);
  });
});

// ---- review fixes --------------------------------------------------------------------------------------------------

const statuses = (t: unknown) => findAll(t, (e) => e.props.role === "status").map(text);
const addButton = (t: unknown) => findAll(forms(t)[1], (e) => e.type === "button" && e.props.type === "submit")[0];
const tasteRemoved = () => ops.some((o) => o.op === "remove" && o.key === TASTE_STORAGE_KEY);

describe("while the chart is being drawn", () => {
  it("marks Find and Add aria-disabled and ignores them, so no seed lands after the list is read", async () => {
    const m = start();
    const [a, b, c] = await addThree(m);
    // A match is chosen and a reason typed, ready to add, when See my taste is pressed.
    const f = await find(m, 4, "tv");
    f.reply();
    await f.done;
    await m.flush();
    m.act(() => (inputById(m.tree, "why").props.onChange as (e: unknown) => void)({ target: { value: "A late thought" } }));
    expect(addButton(m.tree).props["aria-disabled"]).toBe(false);
    const p = press(m);
    const submitAdd = forms(m.tree)[1].props.onSubmit as (e: unknown) => void;
    expect(findButton(m.tree).props["aria-disabled"]).toBe(true);
    expect(addButton(m.tree).props["aria-disabled"]).toBe(true);

    m.act(() => submitAdd(event));
    expect(listEntries(m.tree)).toHaveLength(3);
    const finds = callsTo(RESOLVE).length;
    m.act(() => void (forms(m.tree)[0].props.onSubmit as (e: unknown) => void)(event));
    expect(callsTo(RESOLVE)).toHaveLength(finds);

    [a, b, c].forEach((id, k) => whyFor(id).reply(200, whyBody(k + 1)));
    await m.flush();
    expect((callsTo(PROFILE)[0].body.seeds as ProfileSeed[]).map((x) => x.id)).toEqual([a, b, c]);
    expect(callsTo(WHY)).toHaveLength(3);
    callsTo(PROFILE)[0].reply(200, profileBody);
    await p;
  });

  it("frees them again when the profile request fails", async () => {
    const m = start();
    const ids = await addThree(m);
    ids.forEach((id, k) => whyFor(id).reply(200, whyBody(k + 1)));
    await m.flush();
    const p = press(m);
    await m.flush();
    callsTo(PROFILE)[0].reply(500, { error: { code: "internal", message: "no" } });
    await p;
    await m.flush();
    expect(findButton(m.tree).props["aria-disabled"]).toBe(false);
  });
});

describe("the stored chart and late reasons", () => {
  it("is not dropped by a reason that lands while the chart is being drawn", async () => {
    const m = start();
    const ids = await addThree(m);
    data.set(TASTE_STORAGE_KEY, "previous");
    ops = [];
    const p = press(m);
    ids.forEach((id, k) => whyFor(id).reply(200, whyBody(k + 1)));
    await m.flush();
    expect(tasteRemoved()).toBe(false);
    callsTo(PROFILE)[0].reply(200, profileBody);
    await p;
    // The chart saved after the profile answer is the one left behind.
    expect(tasteRemoved()).toBe(false);
    expect(data.get(TASTE_STORAGE_KEY)).not.toBe("previous");
  });

  it("is dropped when a reason lands outside a build and changes the tags", async () => {
    const m = start();
    const id = await addSeed(m, 1, "film");
    data.set(TASTE_STORAGE_KEY, "previous");
    ops = [];
    whyFor(id).reply(200, whyBody(1));
    await m.flush();
    expect(tasteRemoved()).toBe(true);
  });

  it("is kept when the answer leaves the tags as they were (a failed lookup on an untagged seed)", async () => {
    const m = start();
    const id = await addSeed(m, 1, "film");
    data.set(TASTE_STORAGE_KEY, "previous");
    ops = [];
    whyFor(id).fail();
    await m.flush();
    expect(tasteRemoved()).toBe(false);
  });
});

describe("a reload while a reason is being read", () => {
  it("marks the seed as pending, clears the mark on an answer and on a failure", async () => {
    const m = start();
    const a = await addSeed(m, 1, "film");
    const b = await addSeed(m, 2, "music");
    expect(entryById(m.tree, a)!.whyPending).toBe(true);
    whyFor(a).reply(200, whyBody(1));
    whyFor(b).fail();
    await m.flush();
    expect(entryById(m.tree, a)!.whyPending).toBeUndefined();
    expect(entryById(m.tree, b)!.whyPending).toBeUndefined();
    expect(entryById(m.tree, b)!.whyMapped).toBe(false);
  });

  it("restores the mark, makes no why request on return, and shows the plain note, not the failure note", async () => {
    const m0 = start();
    const id = await addSeed(m0, 1, "film");
    const saved = data.get(FLOW_STORAGE_KEY)!;
    live?.unmount();
    live = null;
    calls = [];

    data.set(FLOW_STORAGE_KEY, saved);
    const m = start();
    await m.flush();
    expect(callsTo(WHY)).toHaveLength(0);
    const e = entryById(m.tree, id)!;
    expect(e.whyPending).toBe(true);
    expect(listPending(m.tree).has(id)).toBe(false);

    const list = (SeedList as unknown as { render: (p: unknown, r: unknown) => unknown }).render(
      { entries: [e], pending: new Set<string>(), onRemove: () => {} },
      null,
    );
    expect(text(list)).toContain(COPY.interruptedNote);
    expect(text(list)).not.toContain(COPY.unmappedNote);
    // A lookup that failed in this visit still gets the failure note.
    const failed = { ...e, whyPending: undefined };
    const list2 = (SeedList as unknown as { render: (p: unknown, r: unknown) => unknown }).render(
      { entries: [failed], pending: new Set<string>(), onRemove: () => {} },
      null,
    );
    expect(text(list2)).toContain(COPY.unmappedNote);
  });

  it("keeps the note line when the reading clears, and has no per-item status role", () => {
    const e = buildEntry(resolvedDraft("film", 3), "seed-x", tagsFor(3))!;
    const render = (pending: string[], reserve: string[]) =>
      (SeedList as unknown as { render: (p: unknown, r: unknown) => unknown }).render(
        { entries: [e], pending: new Set(pending), reserve: new Set(reserve), onRemove: () => {} },
        null,
      );
    const notes = (t: unknown) => findAll(t, (x) => typeof x.props.className === "string" && x.props.className.includes("itemNote"));
    expect(notes(render(["seed-x"], ["seed-x"]))).toHaveLength(1);
    expect(notes(render([], ["seed-x"]))).toHaveLength(1);
    expect(notes(render([], []))).toHaveLength(0);
    expect(statuses(render(["seed-x"], ["seed-x"]))).toEqual([]);
  });
});

describe("a reason that never answers", () => {
  it("is cut off after WHY_TIMEOUT_MS and counts as unmapped, so See my taste goes ahead", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const m = start();
      const a = await addSeed(m, 1, "film");
      const b = await addSeed(m, 2, "music");
      const c = await addSeed(m, 3, "books");
      expect(whyFor(a).signal).toBeInstanceOf(AbortSignal);
      whyFor(b).reply(200, whyBody(2));
      whyFor(c).reply(200, whyBody(3));
      let p!: Promise<void>;
      m.act(() => {
        p = (seeTasteButton(m.tree).props.onClick as () => Promise<void>)();
      });
      await vi.advanceTimersByTimeAsync(WHY_TIMEOUT_MS - 1);
      expect(callsTo(PROFILE)).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(1);
      m.rerender();
      expect(whyFor(a).signal!.aborted).toBe(true);
      expect(callsTo(PROFILE)).toHaveLength(1);
      const sent = callsTo(PROFILE)[0].body.seeds as ProfileSeed[];
      expect("whyTags" in sent.find((x) => x.id === a)!).toBe(false);
      expect(entryById(m.tree, a)!.whyMapped).toBe(false);
      expect(entryById(m.tree, a)!.whyPending).toBeUndefined();
      callsTo(PROFILE)[0].reply(200, profileBody);
      await p;
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("a seed removed before its reason answers", () => {
  it("is not announced, and See my taste does not wait for it", async () => {
    const m = start();
    const [a, b, c] = await addThree(m);
    const d = await addSeed(m, 4, "tv");
    m.act(() => (seedList(m.tree).props.onRemove as (id: string) => void)(b));
    [a, c, d].forEach((id, k) => whyFor(id).reply(200, whyBody(k + 1)));
    await m.flush();
    const p = press(m);
    await m.flush();
    // b never answered, yet the profile request went.
    expect(callsTo(PROFILE)).toHaveLength(1);
    whyFor(b).reply(200, whyBody(2));
    await m.flush();
    expect(statuses(m.tree).join(" ")).not.toContain(COPY.added(chip(2).label));
    callsTo(PROFILE)[0].reply(200, profileBody);
    await p;
  });

  it("makes no unmapped announcement when its lookup then fails", async () => {
    const m = start();
    const [a] = await addThree(m);
    m.act(() => (seedList(m.tree).props.onRemove as (id: string) => void)(a));
    whyFor(a).fail();
    await m.flush();
    expect(statuses(m.tree).join(" ")).not.toContain("could not be read");
  });
});

describe("returning to a stored list", () => {
  it("restores it into the same instance and keeps what was typed, chosen and focused", async () => {
    putFlowFor(["seed-a", "seed-b"]);
    h.hydrated = false;
    const m = start();
    m.act(() => (inputById(m.tree, "query").props.onChange as (e: unknown) => void)({ target: { value: "typed early" } }));
    h.hydrated = true;
    m.rerender();
    expect(listEntries(m.tree).map((e) => e.seed.id)).toEqual(["seed-a", "seed-b"]);
    expect((inputById(m.tree, "query").props as { value: string }).value).toBe("typed early");
    // The field the person already touched is theirs; the stored one is not forced on them.
    expect((findAll(m.tree, (e) => e.type === "select")[0].props as { value: string }).value).toBe("music");
  });

  it("keeps the field the person chose before the list came back", () => {
    putFlowFor(["seed-a"]);
    h.hydrated = false;
    const m = start();
    const select = findAll(m.tree, (e) => e.type === "select")[0];
    m.act(() => (select.props.onChange as (e: unknown) => void)({ target: { value: "books" } }));
    m.act(() => (inputById(m.tree, "query").props.onChange as (e: unknown) => void)({ target: { value: "typed early" } }));
    h.hydrated = true;
    m.rerender();
    expect((findAll(m.tree, (e) => e.type === "select")[0].props as { value: string }).value).toBe("books");
  });
});

function putFlowFor(ids: string[]) {
  const entries = ids.map((id, k) => buildEntry(resolvedDraft("film", 40 + k), id, tagsFor(40 + k))!);
  data.set(FLOW_STORAGE_KEY, JSON.stringify({ version: SESSION_VERSION, field: "music", entries }));
}

describe("a quick double press of Add", () => {
  it("adds the seed once and shows no duplicate error", async () => {
    const m = start();
    const f = await find(m, 1, "film");
    f.reply();
    await f.done;
    await m.flush();
    m.act(() => (inputById(m.tree, "why").props.onChange as (e: unknown) => void)({ target: { value: "It feels unhurried and exact" } }));
    const submit = forms(m.tree)[1].props.onSubmit as (e: unknown) => void;
    m.act(() => {
      submit(event);
      submit(event);
    });
    expect(listEntries(m.tree)).toHaveLength(1);
    expect(callsTo(WHY)).toHaveLength(1);
    expect(alerts(m.tree)).not.toContain(COPY.duplicate);
  });
});
