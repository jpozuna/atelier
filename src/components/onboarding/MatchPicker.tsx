import { forwardRef } from "react";
import type { Ref } from "react";
import type { Draft } from "./flow";
import { COPY } from "./copy";
import styles from "./Onboarding.module.css";

export type MatchPickerProps = {
  search: Draft["search"];
  /** Called with a chip id when the user picks one of several. */
  onChoose: (qlooId: string) => void;
  /** Called when the user says the clean match is not the one they meant. */
  onChange: () => void;
};

/**
 * Shows the outcome of a lookup. Clean: the match, with a way to change it. Ambiguous: up to five chips as a
 * radio group (arrow keys move, Tab leaves). Missing: a gentle retry note. Errors are shown by the form.
 * The ref goes to the first focusable thing, so focus can move to the result when it arrives.
 */
export const MatchPicker = forwardRef<HTMLElement, MatchPickerProps>(function MatchPicker({ search, onChoose, onChange }, ref) {
  if (search.kind === "clean") {
    return (
      <section className={styles.match} aria-labelledby="match-heading">
        <h3 id="match-heading" className={styles.matchHeading}>
          {COPY.confirmedHeading}
        </h3>
        <p className={styles.matchName}>{search.chip.label}</p>
        <button ref={ref as Ref<HTMLButtonElement>} type="button" className={styles.quiet} onClick={onChange}>
          {COPY.change}
        </button>
      </section>
    );
  }

  if (search.kind === "ambiguous") {
    return (
      <fieldset className={styles.chips} ref={ref as Ref<HTMLFieldSetElement>} tabIndex={-1}>
        <legend className={styles.chipsLegend}>{COPY.chooseHeading}</legend>
        <p className={styles.hint} id="chips-hint">
          {COPY.chooseHint}
        </p>
        <ul className={styles.chipList}>
          {search.chips.map((chip) => {
            const checked = search.chosenId === chip.qlooId;
            return (
              <li key={chip.qlooId}>
                <label className={`${styles.chip} ${checked ? styles.chipChecked : ""}`}>
                  <input
                    type="radio"
                    name="match"
                    className={styles.chipInput}
                    value={chip.qlooId}
                    checked={checked}
                    aria-describedby="chips-hint"
                    onChange={() => onChoose(chip.qlooId)}
                  />
                  <span className={styles.chipMark} aria-hidden="true" />
                  <span className={styles.chipText}>{chip.label}</span>
                </label>
              </li>
            );
          })}
        </ul>
      </fieldset>
    );
  }

  if (search.kind === "missing") {
    return (
      <p className={styles.note} id="match-missing">
        {COPY.missing}
      </p>
    );
  }

  return null;
});
