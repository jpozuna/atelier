"use client";

import { useEffect, useState } from "react";
import { useLinkStatus } from "next/link";
import type { ReactNode } from "react";
import { LINK_PENDING_DELAY_MS } from "@/lib/agent/config";
import styles from "./Shell.module.css";

/** How long a navigation runs before the "pending" wording appears. The number lives in config.ts. */
export { LINK_PENDING_DELAY_MS };

export type LinkLabelProps = {
  /** The link's usual text. */
  children: ReactNode;
  /** What it says while the next page is loading. */
  pending: string;
};

/**
 * The text of a `next/link`, swapped for a plain "pending" wording while the page it points to is loading, so a
 * slow connection shows that the click landed. Render it inside the Link. Announced politely to screen readers.
 * Both wordings are laid out in the same cell (the unseen one hidden from sight and from assistive tech), so the
 * link keeps one width.
 */
export function LinkLabel({ children, pending }: LinkLabelProps) {
  const { pending: navigating } = useLinkStatus();
  const [late, setLate] = useState(false);
  useEffect(() => {
    if (!navigating) return;
    const timer = setTimeout(() => setLate(true), LINK_PENDING_DELAY_MS);
    return () => {
      clearTimeout(timer);
      setLate(false);
    };
  }, [navigating]);

  return (
    <span className={styles.linkLabel}>
      <span className={styles.linkSizer} aria-hidden="true">
        {children}
      </span>
      <span className={styles.linkSizer} aria-hidden="true">
        {pending}
      </span>
      <span aria-live="polite">{navigating && late ? pending : children}</span>
    </span>
  );
}
