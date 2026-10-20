import { forwardRef } from "react";
import type { Entry } from "./flow";
import { COPY, FIELD_LABEL } from "./copy";
import styles from "./Onboarding.module.css";

export type SeedListProps = {
  entries: readonly Entry[];
  /** True while a seed is being added or the chart is being drawn: removal waits. */
  busy?: boolean;
  onRemove: (id: string) => void;
};

/** The user's list so far: field, matched name, their why, and a way to remove it. */
export const SeedList = forwardRef<HTMLHeadingElement, SeedListProps>(function SeedList({ entries, busy = false, onRemove }, headingRef) {
  return (
    <section className={styles.list} aria-labelledby="list-heading">
      <h2 id="list-heading" ref={headingRef} tabIndex={-1} className={styles.listHeading}>
        {COPY.listHeading}
      </h2>
      {entries.length === 0 ? (
        <p className={styles.note}>{COPY.listEmpty}</p>
      ) : (
        <ol className={styles.items}>
          {entries.map((e) => (
            <li key={e.seed.id} className={styles.item}>
              <div className={styles.itemBody}>
                <p className={styles.itemField}>{FIELD_LABEL[e.seed.field]}</p>
                <p className={styles.itemName}>{e.matchedLabel}</p>
                <p className={styles.itemWhy}>{e.seed.why}</p>
                {e.whyMapped ? null : (
                  <p className={styles.itemNote}>{COPY.unmappedNote}</p>
                )}
              </div>
              <button
                type="button"
                className={styles.quiet}
                aria-label={COPY.remove(e.matchedLabel)}
                aria-disabled={busy}
                onClick={() => onRemove(e.seed.id)}
              >
                {COPY.removeVisible}
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
});
