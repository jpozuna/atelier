"use client";

import { markPath } from "@/components/chart/marks";
import { COPY, FIELD_LABEL } from "./copy";
import { DEGREE_WORD, pathHint } from "./grouping";
import { previewProps } from "./preview";
import type { PublicPick } from "./types";
import styles from "./Deck.module.css";

/** The DOM id of a pick's row, so Close can hand focus back to it. */
export const tileDomId = (pickId: string) => `tile-${pickId}`;

export interface PickTileProps {
  pick: PublicPick;
  selected: boolean;
  onSelect: (id: string) => void;
  /** A line under the name, such as the calibration scope. */
  kicker?: string | null;
  /** When given, a "Not me" button follows the row. */
  onNotMe?: (pick: PublicPick) => void;
  /** A re-run is in progress: "Not me" waits. */
  notMeBusy?: boolean;
  /** Called with the pick's id while the row is hovered or focused, and with null when that ends. */
  onPreview?: (id: string | null) => void;
}

/**
 * One calibration pick as a compact row: its mark, name, field and what it is close to. Choosing it opens its
 * reasoning. There is no score or rank here, only words.
 */
export function PickTile({ pick, selected, onSelect, kicker, onNotMe, notMeBusy, onPreview }: PickTileProps) {
  const hint = pathHint(pick.path);
  const hintId = `${tileDomId(pick.id)}-hint`;
  return (
    <li className={styles.item} data-selected={selected ? "true" : undefined} {...previewProps(pick.id, onPreview)}>
      <button
        id={tileDomId(pick.id)}
        type="button"
        className={styles.tile}
        aria-current={selected ? "true" : undefined}
        aria-label={COPY.tileName(pick.name, FIELD_LABEL[pick.field], DEGREE_WORD[pick.band])}
        aria-describedby={hintId}
        onClick={() => onSelect(pick.id)}
      >
        <svg className={styles.mark} viewBox="-10 -10 20 20" aria-hidden="true" focusable="false">
          <path d={markPath(pick.field, 7)} />
        </svg>
        <span className={styles.tileText}>
          <span className={styles.name}>{pick.name}</span>
          <span className={styles.kicker}>{[FIELD_LABEL[pick.field], kicker].filter(Boolean).join(" · ")}</span>
        </span>
        <span id={hintId} className="sr-only">
          {COPY.fromThrough(hint.seed, hint.theme)}
        </span>
      </button>
      {onNotMe ? (
        <button type="button" className={styles.notMe} aria-label={COPY.notMeLabel(pick.name)} aria-disabled={notMeBusy || undefined} onClick={() => onNotMe(pick)}>
          {COPY.notMe}
        </button>
      ) : null}
    </li>
  );
}
