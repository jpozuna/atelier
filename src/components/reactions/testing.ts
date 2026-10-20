// Test helpers for this folder: a fake Web Storage and synthetic onboarding and picks records. Synthetic data only.
// Not imported by production code.

import { vi } from "vitest";
import { PICKS_STORAGE_KEY } from "@/components/deck/constants";
import { FIXTURE_INPUTS, makeFixtureResult } from "@/components/deck/fixture";
import { serializeStored, sessionKey } from "@/components/deck/storage";
import type { StoredPicks } from "@/components/deck/storage";
import { TASTE_STORAGE_KEY } from "@/components/onboarding/constants";
import type { Reaction } from "@/types";

export function fakeStorage() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

/** A document whose `cookie` behaves like the browser's: set one cookie at a time, read them all, Max-Age=0 deletes. */
export function fakeDocument(initial: Record<string, string> = {}) {
  const jar = new Map(Object.entries(initial));
  return {
    jar,
    get cookie() {
      return [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    },
    set cookie(line: string) {
      const [pair, ...attrs] = line.split(";").map((p) => p.trim());
      const [name, ...rest] = pair.split("=");
      if (attrs.some((a) => /^max-age=0$/i.test(a))) jar.delete(name);
      else jar.set(name, rest.join("="));
    },
  };
}

/** Installs a fake `window` (sessionStorage, localStorage) and `document` (cookies). Call `vi.unstubAllGlobals()` afterwards. */
export function installStorages(cookies: Record<string, string> = {}) {
  const session = fakeStorage();
  const local = fakeStorage();
  const doc = fakeDocument(cookies);
  vi.stubGlobal("window", { sessionStorage: session, localStorage: local });
  vi.stubGlobal("document", doc);
  return { session, local, doc };
}

export const TOKEN = "tok-session-1";

export const tasteRaw = (): string =>
  JSON.stringify({ version: 1, seeds: FIXTURE_INPUTS.seeds, profile: FIXTURE_INPUTS.profile, axes: FIXTURE_INPUTS.axes, trace: [] });

export const picksRaw = (reactions: Record<string, Reaction>, extra: Partial<StoredPicks> = {}): string =>
  serializeStored({ version: 1, key: sessionKey(FIXTURE_INPUTS), result: makeFixtureResult(), events: [], notMe: [], hidden: [], reactions, reruns: 0, ...extra });

export function fillSession(session: ReturnType<typeof fakeStorage>, reactions: Record<string, Reaction>) {
  session.setItem(TASTE_STORAGE_KEY, tasteRaw());
  session.setItem(PICKS_STORAGE_KEY, picksRaw(reactions));
}

export const AT = "2026-10-20T12:00:00.000Z";
