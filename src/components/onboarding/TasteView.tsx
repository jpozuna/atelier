"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Pick } from "@/types";
import { AttributeChart } from "@/components/chart";
import { PICKS_PATH, START_PATH } from "./constants";
import { COPY } from "./copy";
import { useHydrated } from "./hooks";
import { clearFlowSession, clearTasteSession, parseTasteSession, rawTasteSession } from "./session";
import styles from "./Onboarding.module.css";

/** No picks yet: they arrive on the next screen. A module-level array keeps the chart's highlight state stable. */
const NO_PICKS: Pick[] = [];

const subscribeNever = () => () => {};

/**
 * The screen after "See my taste": the chart from the stored /api/profile response and one next step.
 * Reads sessionStorage only; makes no calls.
 */
export function TasteView() {
  const hydrated = useHydrated();
  const raw = useSyncExternalStore(subscribeNever, rawTasteSession, () => null);
  const session = useMemo(() => parseTasteSession(raw), [raw]);
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const startOverRef = useRef<HTMLButtonElement>(null);
  const asked = useRef(false);

  // Move focus into the confirm step when it opens, and back to "Start over" when it is dismissed.
  useEffect(() => {
    if (confirming) {
      asked.current = true;
      confirmRef.current?.focus();
    } else if (asked.current) {
      asked.current = false;
      startOverRef.current?.focus();
    }
  }, [confirming]);

  if (!hydrated) {
    return (
      <p className={styles.note} role="status">
        {COPY.gettingReady}
      </p>
    );
  }

  if (!session) {
    return (
      <div className={styles.taste}>
        <h1 className={styles.title}>{COPY.tasteTitle}</h1>
        <p className={styles.lede}>{COPY.tasteMissing}</p>
        <Link className={styles.primaryLink} href={START_PATH}>
          {COPY.backToList}
        </Link>
      </div>
    );
  }

  const skipped = session.profile.skippedSeeds.length;
  const shortfall = session.profile.axisShortfall;

  return (
    <div className={styles.taste}>
      <header>
        <h1 className={styles.title}>{COPY.tasteTitle}</h1>
        <p className={styles.lede}>{COPY.tasteIntro}</p>
      </header>

      <AttributeChart axes={session.axes} picks={NO_PICKS} label={COPY.chartLabel} />

      {skipped > 0 ? <p className={styles.note}>{COPY.skippedNote(skipped)}</p> : null}
      {shortfall ? (
        <p className={styles.note}>{COPY.shortfall(shortfall.got)}</p>
      ) : null}

      <section className={styles.next} aria-labelledby="next-heading">
        <h2 id="next-heading" className={styles.nextHeading}>
          {COPY.afterHeading}
        </h2>
        <p className={styles.hint}>{COPY.nextStepHint}</p>
        <div className={styles.actions}>
          <Link className={styles.primaryLink} href={PICKS_PATH}>
            {COPY.nextStep}
          </Link>
          <Link className={styles.quietLink} href={START_PATH}>
            {COPY.backToList}
          </Link>
        </div>
        <div className={styles.startOver}>
          {confirming ? (
            <div role="group" aria-label={COPY.confirmStartOver} className={styles.confirm}>
              <p className={styles.note}>{COPY.confirmStartOver}</p>
              <button
                ref={confirmRef}
                type="button"
                className={styles.quiet}
                onClick={() => {
                  clearTasteSession();
                  clearFlowSession();
                  router.push(START_PATH);
                }}
              >
                {COPY.confirmYes}
              </button>
              <button
                type="button"
                className={styles.quiet}
                onClick={() => {
                  setConfirming(false);
                }}
              >
                {COPY.confirmNo}
              </button>
            </div>
          ) : (
            <button
              ref={startOverRef}
              type="button"
              className={styles.textButton}
              onClick={() => {
                setConfirming(true);
              }}
            >
              {COPY.startOver}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
