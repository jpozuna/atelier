"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useHydrated } from "@/components/onboarding/hooks";
import { clearCarry, loadCarry, restoreToSession } from "./carry";
import { COPY } from "./copy";
import { SAVED_PATH } from "./constants";
import { finishPending, offerTo, pendingCount, recordOffer } from "./finish";
import type { Notice } from "./finish";
import { fetchSessionUser } from "./request";
import { signInHref } from "./status";
import styles from "./Reactions.module.css";

type View = { kind: "checking" } | { kind: "guest" } | { kind: "confirm"; count: number } | { kind: "saving" } | { kind: Notice };

/**
 * Wrap a page a person lands on after signing in (/picks, /saved). When a guest asked to save and then signed in, their
 * onboarding and picks are put back into this tab (a magic link usually opens a new one) before the page reads them.
 * Nothing is saved until they say so: it asks "Save the N picks you chose before signing in?", and a waiting record that
 * was offered to one account is dropped if a different account turns up. With nothing waiting it renders its children
 * and does nothing. Children render after hydration, as the picks screen already does.
 */
export function PendingSave({ children, refreshOnSaved = false }: { children: ReactNode; refreshOnSaved?: boolean }) {
  const hydrated = useHydrated();
  const router = useRouter();
  // Reads the waiting record (deleting a stale one) and puts it back in this tab's storage before the children read it.
  // Safe to run twice.
  const pending = useMemo(() => {
    if (!hydrated) return null;
    const carry = loadCarry();
    if (!carry) return null;
    restoreToSession(carry);
    return carry;
  }, [hydrated]);

  const [view, setView] = useState<View | null>(null);
  const regionRef = useRef<HTMLDivElement>(null);
  const moveFocus = useRef(false);

  // Ask who is signed in, then offer. Runs once per waiting record.
  useEffect(() => {
    if (!pending) return;
    let cancelled = false;
    void (async () => {
      const userId = await fetchSessionUser();
      if (cancelled) return;
      if (!userId) return setView({ kind: "guest" });
      if (offerTo(pending, userId) === "forget") {
        clearCarry();
        return setView({ kind: "none" });
      }
      const count = pendingCount(pending);
      if (count === 0) {
        clearCarry();
        return setView({ kind: "none" });
      }
      recordOffer(pending, userId);
      setView({ kind: "confirm", count });
    })();
    return () => {
      cancelled = true;
    };
  }, [pending]);

  // After a button that disappears is pressed, focus goes to the status region, never to the page body.
  useEffect(() => {
    if (moveFocus.current) {
      moveFocus.current = false;
      regionRef.current?.focus();
    }
  }, [view]);

  async function save() {
    if (!pending) return;
    moveFocus.current = true;
    setView({ kind: "saving" });
    const notice = await finishPending(pending);
    moveFocus.current = true;
    setView({ kind: notice });
    if (notice === "saved" && refreshOnSaved) router.refresh();
  }

  function forget() {
    clearCarry();
    moveFocus.current = true;
    setView({ kind: "none" });
  }

  const current: View | null = !pending ? null : (view ?? { kind: "checking" });
  const show = current !== null && current.kind !== "checking" && current.kind !== "none";

  return (
    <>
      <div ref={regionRef} tabIndex={-1} role="status" aria-live="polite" className={show ? styles.pending : styles.pendingEmpty}>
        {current?.kind === "confirm" ? (
          <>
            <p className={styles.noticeText}>{COPY.pendingConfirm(current.count)}</p>
            <p className={styles.noticeText}>{COPY.pendingConfirmNote}</p>
            <button type="button" className={styles.button} onClick={() => void save()}>
              {COPY.pendingSave}
            </button>
            <button type="button" className={styles.linkButton} onClick={forget}>
              {COPY.pendingForget}
            </button>
          </>
        ) : null}
        {current?.kind === "guest" ? (
          <>
            <p className={styles.noticeText}>{COPY.pendingWaiting}</p>
            <Link className={styles.link} href={signInHref()}>
              {COPY.signInLink}
            </Link>
            <button type="button" className={styles.linkButton} onClick={forget}>
              {COPY.pendingForget}
            </button>
          </>
        ) : null}
        {current?.kind === "saving" ? <p className={styles.noticeText}>{COPY.saving}</p> : null}
        {current?.kind === "saved" ? (
          <>
            <p className={styles.noticeText}>{COPY.pendingSaved}</p>
            <Link className={styles.link} href={SAVED_PATH}>
              {COPY.seeSaved}
            </Link>
          </>
        ) : null}
        {current?.kind === "sign_in" ? (
          <>
            <p className={styles.noticeText}>{COPY.pendingWaiting}</p>
            <Link className={styles.link} href={signInHref()}>
              {COPY.signInLink}
            </Link>
          </>
        ) : null}
        {current?.kind === "failed" ? (
          <>
            <p className={styles.noticeText}>{COPY.saveFailed}</p>
            <button type="button" className={styles.linkButton} onClick={() => void save()}>
              {COPY.pendingRetry}
            </button>
          </>
        ) : null}
        {current?.kind === "not_ready" ? <p className={styles.noticeText}>{COPY.saveNotReady}</p> : null}
        {current?.kind === "too_many_seeds" ? <p className={styles.noticeText}>{COPY.saveTooManySeeds}</p> : null}
      </div>
      {children}
    </>
  );
}
