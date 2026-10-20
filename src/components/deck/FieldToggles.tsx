"use client";

import type { Field } from "@/types";
import { COPY, FIELD_LABEL } from "./copy";
import styles from "./Deck.module.css";

/** The DOM id of a field's toggle, so hiding a field from its deck can hand focus to it. */
export const toggleDomId = (f: Field) => `field-toggle-${f}`;

export interface FieldTogglesProps {
  fields: readonly Field[];
  hidden: readonly Field[];
  onToggle: (field: Field) => void;
}

/** Show or hide a field. State is a word as well as a style, so it never rests on color alone. */
export function FieldToggles({ fields, hidden, onToggle }: FieldTogglesProps) {
  return (
    <div className={styles.toggles}>
      <h3 className={styles.togglesTitle} id="field-toggles-title">
        {COPY.fieldsHeading}
      </h3>
      <p className={styles.note}>{COPY.fieldsHint}</p>
      <div role="group" aria-labelledby="field-toggles-title" className={styles.toggleRow}>
        {fields.map((f) => {
          const isHidden = hidden.includes(f);
          return (
            <button key={f} id={toggleDomId(f)} type="button" className={styles.toggle} aria-pressed={!isHidden} onClick={() => onToggle(f)}>
              <span>{FIELD_LABEL[f]}</span>
              <span className={styles.toggleState}>{isHidden ? COPY.hidden : COPY.shown}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
