"use client";

import Link from "next/link";
import { stashFromSession } from "./carry";
import { COPY } from "./copy";
import { SAVED_PATH } from "./constants";
import type { SaveStatus } from "./status";
import { signInHref, statusMessage } from "./status";
import styles from "./Reactions.module.css";

/**
 * The one line under a card after a reaction: saving, saved, or what to do next. A polite live region, always in the
 * DOM so a change is announced. `next` is where a sign-in should bring the person back to.
 */
export function SaveNotice({ saver, next, showSavedLink = true }: { saver: { status: SaveStatus }; next?: string; showSavedLink?: boolean }) {
  const status = saver.status;
  const message = statusMessage(status);
  return (
    <div className={styles.notice} role="status" aria-live="polite">
      {message ? <p className={styles.noticeText}>{message}</p> : null}
      {status === "sign_in" ? (
        <Link
          className={styles.link}
          href={signInHref(next)}
          // The tab's latest reactions go with the person to the sign-in leg.
          onClick={() => void stashFromSession()}
        >
          {COPY.signInLink}
        </Link>
      ) : null}
      {status === "saved" && showSavedLink ? (
        <Link className={styles.link} href={SAVED_PATH}>
          {COPY.seeSaved}
        </Link>
      ) : null}
    </div>
  );
}
