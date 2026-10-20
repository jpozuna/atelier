"use client";

import type { CSSProperties } from "react";
import { markPath } from "@/components/chart/marks";
import { COPY, FIELD_LABEL } from "./copy";
import { DEGREE_WORD, pathHint } from "./grouping";
import type { PublicPick } from "./types";
import styles from "./Deck.module.css";

/** The DOM id of a pick's tile, so the card's Close can hand focus back to it. */
export const tileDomId = (pickId: string) => `tile-${pickId}`;

export interface PickTileProps {
  pick: PublicPick;
  selected: boolean;
  onSelect: (id: string) => void;
  /** Milliseconds before the tile turns over. Omit for no reveal. */
  revealDelayMs?: number;
  /** A line above the title, such as the calibration scope. */
  kicker?: string | null;
  /** When given, a "Not me" button follows the tile. */
  onNotMe?: (pick: PublicPick) => void;
  /** A re-run is in progress: "Not me" waits. */
  notMeBusy?: boolean;
}

/**
 * One pick, face up: its mark, degree, name and a one-line hint at the path. Choosing it opens the full card
 * above. There is no score or rank here, only words.
 */
export function PickTile({ pick, selected, onSelect, revealDelayMs, kicker, onNotMe, notMeBusy }: PickTileProps) {
  const hint = pathHint(pick.path);
  const hintId = `${tileDomId(pick.id)}-hint`;
  const revealing = revealDelayMs !== undefined;
  const style = revealing ? ({ "--reveal-delay": `${revealDelayMs}ms` } as CSSProperties) : undefined;
  return (
    <li className={revealing ? `${styles.item} ${styles.reveal}` : styles.item} style={style}>
      <button
        id={tileDomId(pick.id)}
        type="button"
        className={styles.tile}
        aria-current={selected ? "true" : undefined}
        aria-label={COPY.tileName(pick.name, FIELD_LABEL[pick.field], DEGREE_WORD[pick.band])}
        aria-describedby={hintId}
        onClick={() => onSelect(pick.id)}
      >
        <span className={styles.tileHead}>
          <svg className={styles.mark} viewBox="-10 -10 20 20" aria-hidden="true" focusable="false">
            <path d={markPath(pick.field, 7)} />
          </svg>
          <span className={styles.fieldWord}>{FIELD_LABEL[pick.field]}</span>
          <span className={styles.degree}>{DEGREE_WORD[pick.band]}</span>
        </span>
        {kicker ? <span className={styles.kicker}>{kicker}</span> : null}
        <span className={styles.name}>{pick.name}</span>
        <span id={hintId} className={styles.hint}>{COPY.fromThrough(hint.seed, hint.theme)}</span>
      </button>
      {onNotMe ? (
        <button type="button" className={styles.notMe} aria-label={COPY.notMeLabel(pick.name)} aria-disabled={notMeBusy || undefined} onClick={() => onNotMe(pick)}>
          {COPY.notMe}
        </button>
      ) : null}
    </li>
  );
}
