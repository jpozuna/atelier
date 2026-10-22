'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import type { Pick } from '@/types';
import { FIELD_LABEL } from './marks';
import { tagMembers } from './tagMembers';
import styles from './AttributeChart.module.css';

export interface TagChipProps {
  /** The axis tag: its id (matched against theme hops) and its display name. */
  tag: { tag: string; name: string };
  /** Every suggestion in this run. The list is computed from these alone: no network, no storage. */
  picks: readonly Pick[];
  /** Ids of the suggestions already selected. They are marked in the list; the caller's `onSelect` decides toggling. */
  selectedIds?: ReadonlySet<string>;
  /** Called when a suggestion is chosen in the dialog. The dialog closes first, so the caller may move focus. */
  onChoose: (pick: Pick) => void;
}

/**
 * An axis tag as a rounded chip. It is a button that opens a modal dialog listing the seeds and suggestions in this
 * run whose path has the tag on its theme hop. A native <dialog> opened with showModal() traps focus, closes on
 * Escape and hands focus back to the chip.
 */
export function TagChip({ tag, picks, selectedIds, onChoose }: TagChipProps) {
  const uid = useId();
  const chipRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const members = useMemo(() => (open ? tagMembers(tag.tag, picks) : null), [open, tag.tag, picks]);
  const titleId = `${uid}-title`;

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    // Leaving the page or unmounting the chip while the dialog is open must not leave the page inert.
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, [open]);

  const requestClose = () => dialogRef.current?.close();

  // The browser fires `close` for Escape and for close(). Browsers hand focus back to the chip on their own; this
  // only steps in when focus was lost to the page body, and never when the caller has already moved it.
  const onClosed = () => {
    setOpen(false);
    const active = document.activeElement;
    if (!active || active === document.body) chipRef.current?.focus();
  };

  const onBackdrop = (e: MouseEvent<HTMLDialogElement>) => {
    if (e.target === e.currentTarget) requestClose();
  };

  const choose = (pick: Pick) => {
    requestClose();
    onChoose(pick);
  };

  return (
    <>
      <button
        ref={chipRef}
        type="button"
        className={styles.chip}
        aria-haspopup="dialog"
        onClick={(e) => {
          // Some browsers do not focus a button on click; focus it so the dialog hands focus back to this chip.
          e.currentTarget.focus();
          setOpen(true);
        }}
      >
        {tag.name}
      </button>
      {open ? (
        <dialog ref={dialogRef} className={styles.dialog} aria-labelledby={titleId} onClose={onClosed} onClick={onBackdrop}>
          <div className={styles.dialogBody}>
            <header className={styles.dialogHead}>
              <div>
                <p className={styles.dialogKicker}>Shared theme</p>
                <h3 id={titleId} className={styles.dialogTitle}>
                  {tag.name}
                </h3>
              </div>
              <button type="button" className={styles.dialogClose} onClick={requestClose}>
                Close
              </button>
            </header>

            <section aria-labelledby={`${uid}-yours`}>
              <h4 id={`${uid}-yours`} className={styles.dialogGroup}>
                Yours
              </h4>
              {members && members.seeds.length > 0 ? (
                <ul className={styles.dialogList}>
                  {members.seeds.map((seed) => (
                    <li key={seed.id} className={styles.dialogSeed}>
                      {seed.label}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={styles.dialogEmpty}>None of your seeds run through this theme in this run.</p>
              )}
            </section>

            <section aria-labelledby={`${uid}-suggested`}>
              <h4 id={`${uid}-suggested`} className={styles.dialogGroup}>
                Suggestions
              </h4>
              {members && members.picks.length > 0 ? (
                <ul className={styles.dialogList}>
                  {members.picks.map((pick) => {
                    const selected = selectedIds?.has(pick.id) ?? false;
                    return (
                      <li key={pick.id}>
                        <button
                          type="button"
                          className={styles.dialogPick}
                          aria-pressed={selected}
                          onClick={() => choose(pick)}
                        >
                          <span className={styles.dialogPickName}>{pick.name}</span>
                          <span className={styles.dialogPickMeta}>
                            {selected ? <span className={styles.dialogSelected}>Selected</span> : null}
                            <span className={styles.fieldTag}>{FIELD_LABEL[pick.field]}</span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className={styles.dialogEmpty}>No suggestion in this run runs through this theme.</p>
              )}
            </section>
          </div>
        </dialog>
      ) : null}
    </>
  );
}
