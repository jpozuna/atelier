import { forwardRef } from "react";
import type { Entry } from "./flow";
import { COPY, FIELD_LABEL } from "./copy";
import styles from "./Onboarding.module.css";

export type SeedListProps = {
  entries: readonly Entry[];
  /** True while a seed is being added or the chart is being drawn: removal waits. */
  busy?: boolean;
  /** Seeds whose reason is still being read into themes. */
  pending?: ReadonlySet<string>;
  /** Seeds added in this visit. Their note line keeps its space once the reading clears, so the list never reflows. */
  reserve?: ReadonlySet<string>;
  onRemove: (id: string) => void;
};

/**
 * The line under a seed about its reason. "Reading" is shown while the lookup runs (announced once, by the flow's
 * own live region, not here). A seed added in this visit keeps an empty line of that height afterwards.
 */
function note(e: Entry, pending: ReadonlySet<string> | undefined, reserve: ReadonlySet<string> | undefined) {
  const held = reserve?.has(e.seed.id) ?? false;
  const cls = held ? `${styles.itemNote} ${styles.itemNoteHeld}` : styles.itemNote;
  if (pending?.has(e.seed.id)) return <p className={cls}>{COPY.readingWhy}</p>;
  if (e.whyMapped) return held ? <p className={cls} /> : null;
  return <p className={cls}>{e.whyPending ? COPY.interruptedNote : COPY.unmappedNote}</p>;
}

/** The user's list so far: field, matched name, their why, and a way to remove it. */
export const SeedList = forwardRef<HTMLHeadingElement, SeedListProps>(function SeedList({ entries, busy = false, pending, reserve, onRemove }, headingRef) {
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
                {note(e, pending, reserve)}
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
