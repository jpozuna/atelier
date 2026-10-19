'use client';

import { useState } from 'react';
import type { Pick } from '@/types';
import { AttributeChart } from './AttributeChart';
import { MOCK_AXES, MOCK_PICKS_30, MOCK_PICKS_6 } from './mock';
import styles from './ChartDemo.module.css';

/** Demo of the chart against synthetic data. Not wired to any route; the manager adds one. */
export function ChartDemo() {
  const [count, setCount] = useState<6 | 30>(6);
  const [chosen, setChosen] = useState<Pick | null>(null);
  const picks = count === 6 ? MOCK_PICKS_6 : MOCK_PICKS_30;

  return (
    <section className={styles.demo} aria-labelledby="chart-demo-title">
      <header className={styles.head}>
        <h1 id="chart-demo-title" className={styles.title}>
          Attribute chart, mock data
        </h1>
        <div role="group" aria-label="Number of suggestions" className={styles.toggle}>
          {([6, 30] as const).map((n) => (
            <button
              key={n}
              type="button"
              className={styles.toggleButton}
              aria-pressed={count === n}
              onClick={() => {
                setCount(n);
                setChosen(null);
              }}
            >
              {n === 6 ? 'Few suggestions' : 'Many suggestions'}
            </button>
          ))}
        </div>
      </header>
      <AttributeChart
        axes={MOCK_AXES}
        picks={picks}
        selectedId={chosen?.id ?? null}
        onSelect={setChosen}
        onClear={() => setChosen(null)}
      />
      <p className={styles.note} aria-live="polite">
        {chosen ? `onSelect received ${chosen.name}.` : 'onSelect has not fired yet.'}
      </p>
    </section>
  );
}
