"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Field } from "@/types";
import { PICKS_PATH } from "@/components/onboarding/constants";
import type { PublicPick } from "@/components/deck/types";
import { CompareCard } from "./CompareCard";
import { COPY, canRetry, failedFor, isCalm } from "./copy";
import { buildCompareBody, fetchPlainPicks } from "./request";
import type { PlainSource } from "./request";
import { loadStoredCompare, saveStoredCompare } from "./storage";
import { buildRows } from "./view";
import type { PlainPick } from "./types";
import styles from "./Compare.module.css";

export interface CompareScreenProps {
  /** The user's own words: what they typed and why, per seed. Nothing else about the profile is sent anywhere. */
  seeds: readonly { field: Field; typed: string; why: string }[];
  /** Atelier's shown picks by field, from the stored run. */
  atelier: ReadonlyMap<Field, PublicPick[]>;
  /** Names this ask (`compareKey`) in sessionStorage. With `persist` false it is unused. */
  storageKey: string;
  /** Where the plain list comes from. Default: POST /api/compare. */
  source?: PlainSource;
  /** Keep the plain list in sessionStorage so a revisit makes no model call. Default true. */
  persist?: boolean;
}

type Phase = { name: "idle" } | { name: "asking" } | { name: "done" } | { name: "failed"; code: string };

/** Where focus goes once the screen has re-rendered after an ask: the first plain list, or the message. */
type FocusNext = "list" | "message";

export const FIRST_PLAIN_ID = "compare-plain-first";

/**
 * Side by side for one profile. Left: Atelier's stored picks with their paths. Right: a plain model's list, every item
 * labeled ungrounded. Nothing is asked of the model until the person asks, and a list once received is kept.
 */
export function CompareScreen({ seeds, atelier, storageKey, source = fetchPlainPicks, persist = true }: CompareScreenProps) {
  const [restored] = useState(() => (persist ? loadStoredCompare(storageKey) : null));
  const [plain, setPlain] = useState<PlainPick[] | null>(restored);
  const [phase, setPhase] = useState<Phase>(restored ? { name: "done" } : { name: "idle" });
  const abort = useRef<AbortController | null>(null);
  const focusNext = useRef<FocusNext | null>(null);
  const firstPlainHeading = useRef<HTMLHeadingElement | null>(null);
  const statusRef = useRef<HTMLParagraphElement | null>(null);
  const alertRef = useRef<HTMLParagraphElement | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  // After an ask ends, focus goes to a stable target: the first plain list's heading, or the message.
  useEffect(() => {
    const target = focusNext.current;
    focusNext.current = null;
    if (target === "list") firstPlainHeading.current?.focus();
    else if (target === "message") (alertRef.current ?? statusRef.current)?.focus();
  }, [phase]);

  const rows = useMemo(() => buildRows(atelier, plain), [atelier, plain]);
  const fields = useMemo(() => [...atelier.keys()], [atelier]);
  const asking = phase.name === "asking";

  async function ask() {
    if (asking) return; // aria-disabled keeps the button focusable, so the handler guards instead
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setPhase({ name: "asking" });
    const result = await source(buildCompareBody(seeds, fields), controller.signal);
    if (controller.signal.aborted) return;
    focusNext.current = result.ok ? "list" : "message";
    if (!result.ok) {
      setPhase({ name: "failed", code: result.code });
      return;
    }
    setPlain(result.picks);
    setPhase({ name: "done" });
    if (persist) saveStoredCompare(storageKey, result.picks);
  }

  const failedCode = phase.name === "failed" ? phase.code : null;
  const calmFailure = failedCode !== null && isCalm(failedCode);
  const hardFailure = failedCode !== null && !calmFailure;
  // One live region, always rendered: progress, the result, or a calm (resting, off) message.
  const status = asking ? COPY.askingStatus : calmFailure ? failedFor(failedCode) : phase.name === "done" && plain ? COPY.readyStatus : "";
  const offered = !plain && (failedCode === null || canRetry(failedCode));

  return (
    <div className={styles.page}>
      <header className={styles.intro}>
        <h1 className={styles.title}>{COPY.title}</h1>
        <p className={styles.lede}>{COPY.lede}</p>
      </header>

      <section className={styles.difference} aria-labelledby="compare-difference">
        <h2 id="compare-difference" className={styles.smallHeading}>
          {COPY.differenceHeading}
        </h2>
        {COPY.difference.map((t) => (
          <p key={t} className={styles.prose}>
            {t}
          </p>
        ))}
      </section>

      <section className={styles.ask} aria-labelledby="compare-ask">
        <h2 id="compare-ask" className={styles.smallHeading}>
          {COPY.askHeading}
        </h2>
        {!plain && failedCode !== "model_off" ? <p className={styles.prose}>{COPY.askBody}</p> : null}
        {hardFailure ? (
          <p ref={alertRef} tabIndex={-1} className={styles.problem} role="alert">
            {failedFor(failedCode)}
          </p>
        ) : null}
        {offered ? (
          <button type="button" className={styles.button} onClick={() => void ask()} aria-disabled={asking}>
            {failedCode !== null ? COPY.retry : COPY.askButton}
          </button>
        ) : null}
        <div className={styles.statusLine}>
          <p ref={statusRef} tabIndex={-1} className={calmFailure ? `${styles.status} ${styles.calm}` : styles.status} role="status">
            {status}
          </p>
          {plain ? (
            <a className={styles.jump} href={`#${FIRST_PLAIN_ID}`}>
              {COPY.jumpToPlain}
            </a>
          ) : null}
        </div>
      </section>

      {rows.map((row, i) => (
        <section key={row.field} className={styles.row} aria-labelledby={`compare-${row.field}`}>
          <h2 id={`compare-${row.field}`} className={styles.fieldHeading}>
            {COPY.fieldHeading(row.field)}
          </h2>
          <div className={styles.pair}>
            <div className={styles.side}>
              <h3 className={styles.sideHeading}>{COPY.atelierHeading}</h3>
              <p className={styles.sideNote}>{COPY.atelierNote}</p>
              <ul className={styles.list}>
                {row.atelier.map((p) => (
                  <li key={p.id}>
                    <CompareCard pick={p} />
                  </li>
                ))}
              </ul>
            </div>
            <div className={styles.side}>
              <h3 id={i === 0 ? FIRST_PLAIN_ID : undefined} ref={i === 0 ? firstPlainHeading : undefined} tabIndex={-1} className={styles.sideHeading}>
                {COPY.plainHeading}
              </h3>
              <p className={styles.sideNote}>{COPY.plainNote}</p>
              <PlainList picks={row.plain} />
            </div>
          </div>
        </section>
      ))}

      <p>
        <Link className={styles.link} href={PICKS_PATH}>
          {COPY.backToPicks}
        </Link>
      </p>
    </div>
  );
}

/** Shown when there is no stored run to read: calm, with the way back to the picks. */
export function CompareEmpty() {
  return (
    <div className={styles.state}>
      <h1 className={styles.title}>{COPY.noRunTitle}</h1>
      <p className={styles.lede}>{COPY.noRun}</p>
      <Link className={styles.link} href={PICKS_PATH}>
        {COPY.noRunLink}
      </Link>
    </div>
  );
}

/** The plain model's items for one field. Every item says in words that it is ungrounded. Null before it is asked. */
export function PlainList({ picks }: { picks: readonly PlainPick[] | null }) {
  if (picks === null) return <p className={styles.sideNote}>{COPY.notAsked}</p>;
  if (picks.length === 0) return <p className={styles.sideNote}>{COPY.emptyField}</p>;
  return (
    <ul className={styles.list}>
      {picks.map((p) => (
        <li key={`${p.field}-${p.name}`} className={styles.plainItem}>
          <h4 className={styles.plainName}>{p.name}</h4>
          <p className={styles.plainWhy}>{p.why}</p>
          <p className={styles.ungrounded}>{COPY.ungrounded}</p>
        </li>
      ))}
    </ul>
  );
}
