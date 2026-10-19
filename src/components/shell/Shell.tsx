import Link from "next/link";
import type { ReactNode } from "react";
import styles from "./Shell.module.css";

export type ShellProps = {
  /** The main region: the chart, a deck, a form. */
  children: ReactNode;
  /** Optional side region, for the reasoning panel. Omit and the main region takes the full width. */
  side?: ReactNode;
  /** Accessible name of the side region. */
  sideLabel?: string;
};

/**
 * The app frame: skip link, text wordmark, main region and an optional side region.
 * The wordmark is a plain text placeholder; the logo is designed by the user.
 * On narrow screens the side region follows the main region instead of shrinking beside it.
 */
export function Shell({ children, side, sideLabel = "Reasoning" }: ShellProps) {
  return (
    <div className={styles.shell}>
      <a className={styles.skip} href="#main">
        Skip to main content
      </a>
      <header className={styles.header}>
        <Link href="/" className={styles.wordmark}>
          Atelier
        </Link>
      </header>
      <div className={side ? `${styles.body} ${styles.withSide}` : styles.body}>
        <main id="main" className={styles.main} tabIndex={-1}>
          {children}
        </main>
        {side ? (
          <aside className={styles.side} aria-label={sideLabel}>
            {side}
          </aside>
        ) : null}
      </div>
    </div>
  );
}
