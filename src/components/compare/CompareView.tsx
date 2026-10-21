"use client";

import { useMemo, useSyncExternalStore } from "react";
import { useHydrated } from "@/components/onboarding/hooks";
import { parseTasteSession, rawTasteSession } from "@/components/onboarding/session";
import { loadStored, sessionKey } from "@/components/deck/storage";
import { COPY } from "./copy";
import { CompareEmpty, CompareScreen } from "./CompareScreen";
import { compareKey } from "./storage";
import { atelierByField } from "./view";
import styles from "./Compare.module.css";

const subscribeNever = () => () => {};

/**
 * The /compare route's client side. It reads the taste session and the run the picks screen stored (sessionStorage,
 * after hydration). It makes no run and no Qloo call. With no stored run it points back to /picks.
 */
export function CompareView() {
  const hydrated = useHydrated();
  const raw = useSyncExternalStore(subscribeNever, rawTasteSession, () => null);
  const session = useMemo(() => parseTasteSession(raw), [raw]);

  const loaded = useMemo(() => {
    if (!hydrated || !session) return null;
    const key = sessionKey({ seeds: session.seeds, axes: session.axes });
    const stored = loadStored(key);
    if (!stored) return null;
    const atelier = atelierByField(stored.result, { hidden: stored.hidden, notMe: stored.notMe, seeds: session.seeds });
    if (atelier.size === 0) return null;
    return { key, atelier, seeds: session.seeds.map((s) => ({ field: s.field, typed: s.typed, why: s.why })) };
  }, [hydrated, session]);

  if (!hydrated) {
    return (
      <p className={styles.status} role="status">
        {COPY.gettingReady}
      </p>
    );
  }
  if (!loaded) return <CompareEmpty />;
  return <CompareScreen seeds={loaded.seeds} atelier={loaded.atelier} storageKey={compareKey(loaded.key, [...loaded.atelier.keys()])} />;
}
