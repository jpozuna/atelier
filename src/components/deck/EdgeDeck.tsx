"use client";

import { COPY, FIELD_LABEL } from "./copy";
import { DEGREE_WORD } from "./grouping";
import type { EdgeDeck as EdgeDeckData } from "./grouping";
import { PickTile } from "./PickTile";
import styles from "./Deck.module.css";

export interface EdgeDeckProps {
  deck: EdgeDeckData;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onHide: () => void;
  /** Pick id to reveal delay in ms. Omit for no reveal. */
  delays?: ReadonlyMap<string, number>;
}

/**
 * One field's picks at the edge: moderate, high and extreme together, in a single deck. The deck is a list of
 * tiles; the card opens above when one is chosen.
 */
export function EdgeDeck({ deck, selectedId, onSelect, onHide, delays }: EdgeDeckProps) {
  const headingId = `deck-${deck.field}`;
  const label = FIELD_LABEL[deck.field];
  const missing = deck.picks.length > 0 ? deck.emptyBands : [];
  return (
    <section className={styles.deck} aria-labelledby={headingId}>
      <header className={styles.deckHead}>
        <h3 id={headingId} className={styles.deckTitle}>
          {label}
        </h3>
        <button type="button" className={styles.quiet} onClick={onHide}>
          {COPY.hideField(deck.field)}
        </button>
      </header>
      {deck.note ? <p className={styles.note}>{deck.note}</p> : null}
      {deck.picks.length > 0 ? (
        <ul className={styles.tiles}>
          {deck.picks.map((p) => (
            <PickTile key={p.id} pick={p} selected={p.id === selectedId} onSelect={onSelect} revealDelayMs={delays?.get(p.id)} />
          ))}
        </ul>
      ) : deck.note ? null : (
        <p className={styles.note}>{COPY.deckEmpty(deck.field)}</p>
      )}
      {missing.length > 0 ? (
        <ul className={styles.missing}>
          {missing.map((b) => (
            <li key={b}>{COPY.noDegree(DEGREE_WORD[b])}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
