"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { START_PATH } from "@/components/onboarding/constants";
import { useHydrated } from "@/components/onboarding/hooks";
import { parseTasteSession, rawTasteSession } from "@/components/onboarding/session";
import { COPY } from "./copy";
import { PicksScreen } from "./PicksScreen";
import styles from "./PicksScreen.module.css";

const subscribeNever = () => () => {};

/**
 * The /picks route's client side. Reads the taste session onboarding stored (sessionStorage, after hydration)
 * and hands it to the screen. With no session it sends the person to the start of onboarding.
 */
export function PicksView() {
  const hydrated = useHydrated();
  const raw = useSyncExternalStore(subscribeNever, rawTasteSession, () => null);
  const session = useMemo(() => parseTasteSession(raw), [raw]);
  const inputs = useMemo(() => (session ? { seeds: session.seeds, profile: session.profile, axes: session.axes } : null), [session]);
  const router = useRouter();

  useEffect(() => {
    if (hydrated && !session) router.replace(START_PATH);
  }, [hydrated, session, router]);

  if (!hydrated) {
    return (
      <p className={styles.working} role="status">
        {COPY.gettingReady}
      </p>
    );
  }

  if (!inputs) {
    return (
      <div className={styles.state}>
        <h1 className={styles.sectionTitle}>{COPY.title}</h1>
        <p className={styles.sectionLede}>{COPY.noSession}</p>
        <Link className={styles.linkPlain} href={START_PATH}>
          {COPY.noSessionLink}
        </Link>
      </div>
    );
  }

  return <PicksScreen inputs={inputs} />;
}
