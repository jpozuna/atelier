"use client";

import { markPath } from "@/components/chart/marks";
import { COPY, FIELD_LABEL } from "./copy";
import { previewProps } from "./preview";
import { SUGGESTION_SORTS, groupSuggestions, stretchWord } from "./suggestions";
import type { SuggestionSort } from "./suggestions";
import { tileDomId } from "./PickTile";
import type { PublicPick } from "./types";
import type { Field } from "@/types";
import styles from "./SuggestionList.module.css";

/** The DOM id of a row's checkbox. */
export const checkDomId = (pickId: string) => `check-${pickId}`;

const SORT_LABEL: Record<SuggestionSort, string> = { field: COPY.sortField, stretch: COPY.sortStretch };

export interface SuggestionListProps {
  /** Already filtered (hidden fields are absent) and sorted. */
  picks: readonly PublicPick[];
  sort: SuggestionSort;
  onSort: (sort: SuggestionSort) => void;
  /** The suggestion being read in the reasoning area. */
  selectedId: string | null;
  /** The ticked suggestions, shown together on the chart. */
  checked: readonly string[];
  /** How many suggestions the chart shows as selected (ticked, plus the one being read). */
  chartCount: number;
  /** The axis the chart puts each suggestion beside, by pick id. Missing or null: the row says nothing about an axis. */
  axisOf: ReadonlyMap<string, string | null>;
  /** A row was chosen. */
  onOpen: (id: string) => void;
  /** A checkbox was toggled. Ticking only adds to or removes from the chart: it never opens the reasoning. */
  onCheck: (id: string) => void;
  onClear: () => void;
  /** Scroll the chart into view (the bottom bar, below 64rem). */
  onViewChart: () => void;
  /** A row is hovered or focused (id), or no longer is (null). */
  onPreview?: (id: string | null) => void;
}

/**
 * The edge suggestions as one compact list under headings: by field (each row then says where it sits and its
 * stretch) or by stretch (each row then says its field and where it sits). A row is a button that opens the
 * suggestion's reasoning, plus a checkbox that puts it on the chart. There is no score, rank or sort by one.
 * Below 64rem a bar sticks to the bottom while anything is on the chart, so the chart is one tap away.
 */
export function SuggestionList({ picks, sort, onSort, selectedId, checked, chartCount, axisOf, onOpen, onCheck, onClear, onViewChart, onPreview }: SuggestionListProps) {
  const ticked = new Set(checked);
  const groups = groupSuggestions(picks, sort);
  const heading = (key: string) => (sort === "field" ? FIELD_LABEL[key as Field] : COPY.stretchLabel(key));
  return (
    <div className={styles.wrap}>
      <div className={styles.toolbar}>
        <div role="group" aria-labelledby="sort-label" className={styles.sort}>
          <span id="sort-label" className={styles.sortLabel}>
            {COPY.sortLabel}
          </span>
          {SUGGESTION_SORTS.map((s) => (
            <button key={s} type="button" className={styles.sortButton} aria-pressed={sort === s} onClick={() => onSort(s)}>
              {SORT_LABEL[s]}
            </button>
          ))}
        </div>
        {chartCount > 0 ? (
          <p className={styles.count}>
            <span>{COPY.onChart(chartCount)}</span>
            <button type="button" className={styles.clear} aria-label={COPY.clearLabel} onClick={onClear}>
              {COPY.clear}
            </button>
          </p>
        ) : null}
      </div>
      {groups.map((g) => {
        const headingId = `group-${g.key}`;
        return (
          <section key={g.key} className={styles.group} aria-labelledby={headingId}>
            <h3 id={headingId} className={styles.groupTitle}>
              {sort === "field" ? (
                <svg className={styles.mark} viewBox="-10 -10 20 20" aria-hidden="true" focusable="false">
                  <path d={markPath(g.key as Field, 7)} />
                </svg>
              ) : null}
              {heading(g.key)}
            </h3>
            <ul className={styles.list}>
              {g.picks.map((p) => {
                const word = stretchWord(p.band);
                const axis = axisOf.get(p.id) ?? null;
                const detail =
                  sort === "field"
                    ? [axis ? COPY.beside(axis) : null, word ? COPY.stretchLabel(word) : null]
                    : [FIELD_LABEL[p.field], axis ? COPY.beside(axis) : null];
                return (
                  <li key={p.id} className={styles.row} data-selected={p.id === selectedId ? "true" : undefined} {...previewProps(p.id, onPreview)}>
                    <label className={styles.check}>
                      <input id={checkDomId(p.id)} type="checkbox" className={styles.checkbox} checked={ticked.has(p.id)} aria-label={COPY.checkLabel(p.name)} onChange={() => onCheck(p.id)} />
                    </label>
                    <button id={tileDomId(p.id)} type="button" className={styles.open} aria-current={p.id === selectedId ? "true" : undefined} onClick={() => onOpen(p.id)}>
                      {sort === "stretch" ? (
                        <svg className={styles.mark} viewBox="-10 -10 20 20" aria-hidden="true" focusable="false">
                          <path d={markPath(p.field, 7)} />
                        </svg>
                      ) : null}
                      <span className={styles.text}>
                        <span className={styles.name}>{p.name}</span>
                        <span className={styles.detail}>{detail.filter(Boolean).join(" · ")}</span>
                        {/* The open pick is on the chart even when unticked, so the row says so and the checkbox and the count agree. */}
                        {p.id === selectedId && !ticked.has(p.id) ? <span className={styles.detail}>{COPY.openOnChart}</span> : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
      {chartCount > 0 ? (
        <div className={styles.bar} role="group" aria-label={COPY.chartBarLabel}>
          <span className={styles.barCount}>{COPY.onChart(chartCount)}</span>
          <button type="button" className={styles.barButton} onClick={onViewChart}>
            {COPY.viewChart}
          </button>
          <button type="button" className={styles.barButton} aria-label={COPY.clearLabel} onClick={onClear}>
            {COPY.clear}
          </button>
        </div>
      ) : null}
    </div>
  );
}
