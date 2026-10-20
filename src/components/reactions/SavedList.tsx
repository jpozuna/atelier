import Link from "next/link";
import { FIELD_LABEL } from "@/components/card/helpers";
import { COPY } from "./copy";
import { groupSaved, outcomeWord, pathLine, savedHref } from "./groups";
import type { SavedItem } from "./groups";
import styles from "./Reactions.module.css";

/**
 * The saved picks, grouped by the state the person chose. Each name opens its stored card; nothing here fetches.
 * The person's own words are shown as they wrote them. No counts that rank, no scores.
 */
export function SavedList({ items }: { items: readonly SavedItem[] }) {
  const groups = groupSaved(items);
  if (groups.length === 0) {
    return (
      <div className={styles.state}>
        <h2 className={styles.stateTitle}>{COPY.savedEmptyTitle}</h2>
        <p className={styles.lede}>{COPY.savedEmptyBody}</p>
        <Link className={styles.link} href="/picks">
          {COPY.savedEmptyLink}
        </Link>
      </div>
    );
  }
  return (
    <div className={styles.groups}>
      {groups.map((g) => (
        <section key={g.key} className={styles.group} aria-labelledby={`group-${g.key}`}>
          <h2 id={`group-${g.key}`} className={styles.groupTitle}>
            {g.title}
          </h2>
          <p className={styles.groupGloss}>{g.gloss}</p>
          <ul className={styles.items}>
            {g.items.map((item) => {
              const outcome = outcomeWord(item);
              const line = pathLine(item.card);
              const words = item.card.reaction?.words;
              return (
                <li key={item.id} className={styles.item}>
                  <h3 className={styles.itemName}>
                    <Link className={styles.itemLink} href={savedHref(item.id)}>
                      {item.name}
                    </Link>
                  </h3>
                  <p className={styles.itemMeta}>
                    {FIELD_LABEL[item.field]}
                    {outcome ? ` · ${outcome}` : ""}
                  </p>
                  {line ? <p className={styles.itemPath}>{line}</p> : null}
                  {words ? (
                    <p className={styles.itemWords}>
                      <span className={styles.sr}>{COPY.yourWords}: </span>
                      {words}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
