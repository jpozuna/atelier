import { useSyncExternalStore } from "react";

const subscribeNever = () => () => {};

/**
 * False during the server render and hydration, true afterwards. Lets a client component read sessionStorage
 * without a hydration mismatch and without setting state inside an effect.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
}

/** A unique id for a new seed. Uses the browser's UUID where available. */
let counter = 0;
export function newSeedId(): string {
  const c = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  counter += 1;
  return `seed-${Date.now().toString(36)}-${counter}`;
}
