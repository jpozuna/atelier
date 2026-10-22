'use client';

import { useState } from 'react';
import type { Pick } from '@/types';
import { AttributeChart } from './AttributeChart';
import { MOCK_AXES, MOCK_PICKS_30, MOCK_PICKS_6 } from './mock';
import styles from './ChartDemo.module.css';

const NO_PICKS: Pick[] = [];

/**
 * Demo of the chart against synthetic data. Dev-only route `/dev/chart`.
 * "Select several" turns a click into add-or-remove, which is how a caller drives `selectedIds`. Choosing a
 * suggestion in a tag dialog goes through the same `onSelect`.
 */
export function ChartDemo() {
  const [count, setCount] = useState<0 | 6 | 30>(6);
  const [several, setSeveral] = useState(false);
  const [chosen, setChosen] = useState<readonly string[]>([]);
  const [last, setLast] = useState<Pick | null>(null);
  const picks = count === 0 ? NO_PICKS : count === 6 ? MOCK_PICKS_6 : MOCK_PICKS_30;

  const onSelect = (pick: Pick) => {
    setLast(pick);
    setChosen((cur) => {
      if (!several) return [pick.id];
      return cur.includes(pick.id) ? cur.filter((id) => id !== pick.id) : [...cur, pick.id];
    });
  };

  return (
    <section className={styles.demo} aria-labelledby="chart-demo-title">
      <header className={styles.head}>
        <h1 id="chart-demo-title" className={styles.title}>
          Attribute chart, mock data
        </h1>
        <div className={styles.controls}>
          <div role="group" aria-label="Number of suggestions" className={styles.toggle}>
            {([0, 6, 30] as const).map((n) => (
              <button
                key={n}
                type="button"
                className={styles.toggleButton}
                aria-pressed={count === n}
                onClick={() => {
                  setCount(n);
                  setChosen([]);
                  setLast(null);
                }}
              >
                {n === 0 ? 'No suggestions' : n === 6 ? 'Few suggestions' : 'Many suggestions'}
              </button>
            ))}
          </div>
          <div role="group" aria-label="Selection" className={styles.toggle}>
            <button
              type="button"
              className={styles.toggleButton}
              aria-pressed={several}
              onClick={() => setSeveral((v) => !v)}
            >
              Select several
            </button>
            <button type="button" className={styles.toggleButton} onClick={() => setChosen([])}>
              Clear selection
            </button>
          </div>
        </div>
      </header>
      <AttributeChart
        axes={MOCK_AXES}
        picks={picks}
        selectedIds={chosen}
        onSelect={onSelect}
        onClear={() => setChosen([])}
      />
      <p className={styles.note} aria-live="polite">
        {last ? `onSelect received ${last.name}. ${chosen.length} selected.` : 'onSelect has not fired yet.'}
      </p>
    </section>
  );
}
