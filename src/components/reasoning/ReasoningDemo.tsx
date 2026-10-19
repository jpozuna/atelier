"use client";

import { useEffect, useState } from "react";
import { FIXTURE_PICK_NAMES, FIXTURE_SEED_NAMES, FIXTURE_TRACE } from "./fixture";
import { ReasoningPanel } from "./ReasoningPanel";
import styles from "./ReasoningDemo.module.css";

const STEP_MS = 1100;

/**
 * Demo of the reasoning panel on the synthetic fixture trace, streamed one event at a time.
 * Drop it on a dev route such as /dev/reasoning. Nothing here calls an API.
 */
export function ReasoningDemo() {
  const [run, setRun] = useState(0);
  const [shown, setShown] = useState(0);
  const total = FIXTURE_TRACE.length;
  const streaming = shown < total;

  useEffect(() => {
    if (shown >= total) return;
    const id = setTimeout(() => setShown((n) => n + 1), STEP_MS);
    return () => clearTimeout(id);
  }, [shown, total, run]);

  function replay() {
    setShown(0);
    setRun((n) => n + 1);
  }

  return (
    <div className={styles.layout}>
      <div className={styles.main}>
        <h1>Reasoning panel, mock trace</h1>
        <p className={styles.note}>
          The panel streams a synthetic trace in order. Collapse it with the button. At wide widths it sits beside
          the chart, and below it on narrow screens.
        </p>
        <div className={styles.controls}>
          <button type="button" className={styles.button} onClick={replay}>
            Replay
          </button>
          <button type="button" className={styles.button} onClick={() => setShown(total)} disabled={!streaming}>
            Show all
          </button>
        </div>
      </div>
      <aside className={styles.side} aria-label="Reasoning">
        <ReasoningPanel
          events={FIXTURE_TRACE.slice(0, shown)}
          streaming={streaming}
          seedNames={FIXTURE_SEED_NAMES}
          pickNames={FIXTURE_PICK_NAMES}
          landmark={false}
        />
      </aside>
    </div>
  );
}
