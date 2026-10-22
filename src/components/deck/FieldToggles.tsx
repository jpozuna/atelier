"use client";

import type { Field } from "@/types";
import { COPY, FIELD_LABEL } from "./copy";
import styles from "./Deck.module.css";

/** The DOM id of a field's toggle, so hiding a field can hand focus to it. */
export const toggleDomId = (f: Field) => `field-toggle-${f}`;

export interface FieldTogglesProps {
  fields: readonly Field[];
  hidden: readonly Field[];
  onToggle: (field: Field) => void;
}

/**
 * Show or hide a field: one wrapping row. A hidden field says "Hidden" and has a dashed edge, so state never rests
 * on color alone; a shown field is the plain, filled one.
 */
export function FieldToggles({ fields, hidden, onToggle }: FieldTogglesProps) {
  return (
    <div role="group" aria-labelledby="field-toggles-title" aria-describedby="field-toggles-hint" className={styles.toggleRow}>
      <span className={styles.togglesTitle} id="field-toggles-title">
        {COPY.fieldsHeading}
      </span>
      <span className="sr-only" id="field-toggles-hint">
        {COPY.fieldsHint}
      </span>
      {fields.map((f) => {
        const isHidden = hidden.includes(f);
        return (
          <button key={f} id={toggleDomId(f)} type="button" className={styles.toggle} aria-pressed={!isHidden} onClick={() => onToggle(f)}>
            <span>{FIELD_LABEL[f]}</span>
            {isHidden ? <span className={styles.toggleState}>{COPY.hidden}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
