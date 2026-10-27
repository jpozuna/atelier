"use client";

import type { ReactNode } from "react";
import { markPath } from "@/components/chart/marks";
import { COPY, FIELD_LABEL } from "./copy";
import { previewProps } from "./preview";
import { groupSuggestions, stretchWord } from "./suggestions";
import { tileDomId } from "./PickTile";
import type { PublicPick } from "./types";
import type { Field } from "@/types";
import styles from "./SuggestionList.module.css";

/** The DOM id of a row's checkbox. */
export const checkDomId = (pickId: string) => `check-${pickId}`;

export interface SuggestionListProps {
  /** Already filtered (hidden fields are absent) and in field order. */
  picks: readonly PublicPick[];
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
  /** A row is hovered or focused (id), or no longer is (null). */
  onPreview?: (id: string | null) => void;
  /** The heading, at the left of the first row (the count and Clear sit at its right while anything is on the chart). */
  heading?: ReactNode;
  /** One line under the heading. */
  lede?: ReactNode;
  /** Quiet lines between the lede and the rows, such as which fields are still coming. */
  status?: ReactNode;
  /** Notes after the rows, such as why a field has none. */
  notice?: ReactNode;
}

/**
 * The edge suggestions as one compact list under a heading per field. A row is a button that opens the suggestion's
 * reasoning (with where it sits and its stretch as a word), plus a checkbox that puts it on the chart. There is no
 * score, rank or sort. It is the first thing in the screen's right column, which scrolls as a whole, so the list has
 * no scrolling box of its own. `ChartBar` is the bottom bar for phones.
 */
export function SuggestionList({ picks, selectedId, checked, chartCount, axisOf, onOpen, onCheck, onClear, onPreview, heading, lede, status, notice }: SuggestionListProps) {
  const ticked = new Set(checked);
  const groups = groupSuggestions(picks, "field");
  return (
    <div className={styles.wrap}>
      <div className={styles.toolbar}>
        {heading}
        {chartCount > 0 ? (
          <p className={styles.count}>
            <span>{COPY.onChart(chartCount)}</span>
            <button type="button" className={styles.clear} aria-label={COPY.clearLabel} onClick={onClear}>
              {COPY.clear}
            </button>
          </p>
        ) : null}
      </div>
      {lede}
      {status}
      <div className={styles.groups} role="group" aria-label={COPY.listLabel}>
        {picks.length > 0 ? <p className="sr-only">{COPY.listSummary(picks.length)}</p> : null}
        {groups.map((g) => {
          const headingId = `group-${g.key}`;
          return (
            <section key={g.key} className={styles.group} aria-labelledby={headingId}>
              <h3 id={headingId} className={styles.groupTitle}>
                <svg className={styles.mark} viewBox="-10 -10 20 20" aria-hidden="true" focusable="false">
                  <path d={markPath(g.key as Field, 7)} />
                </svg>
                {FIELD_LABEL[g.key as Field]}
              </h3>
              <ul className={styles.list}>
                {g.picks.map((p) => {
                  const word = stretchWord(p.band);
                  const axis = axisOf.get(p.id) ?? null;
                  const detail = [axis ? COPY.beside(axis) : null, word ? COPY.stretchLabel(word) : null];
                  return (
                    <li key={p.id} className={styles.row} data-selected={p.id === selectedId ? "true" : undefined} {...previewProps(p.id, onPreview)}>
                      <label className={styles.check}>
                        <input id={checkDomId(p.id)} type="checkbox" className={styles.checkbox} checked={ticked.has(p.id)} aria-label={COPY.checkLabel(p.name)} onChange={() => onCheck(p.id)} />
                      </label>
                      <button id={tileDomId(p.id)} type="button" className={styles.open} aria-current={p.id === selectedId ? "true" : undefined} onClick={() => onOpen(p.id)}>
                        <span className={styles.text}>
                          <span className={styles.name}>{p.name}</span>
                          <span className={styles.detail}>{detail.filter(Boolean).join(" · ")}</span>
                          {/* The open pick is on the chart even when unticked, so the row says so (to a screen reader; sighted, the
                              fill and edge say it) and the checkbox and the count agree. The row's height never changes. */}
                          {p.id === selectedId && !ticked.has(p.id) ? <span className="sr-only">{COPY.openOnChart}</span> : null}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
        {notice}
      </div>
    </div>
  );
}

export interface ChartBarProps {
  /** How many suggestions the chart shows as selected. */
  chartCount: number;
  onViewChart: () => void;
  onClear: () => void;
}

/**
 * Below 64rem: a bar that sticks to the bottom of the screen while anything is on the chart, so the chart is one tap
 * away and Clear is reachable wherever the person is on the page. The screen places it at the end of its layout, not
 * in the list's slot, so it stays with them past the list. From 64rem it is not drawn (the toolbar has the count).
 */
export function ChartBar({ chartCount, onViewChart, onClear }: ChartBarProps) {
  if (chartCount <= 0) return null;
  return (
    <div className={styles.bar} role="group" aria-label={COPY.chartBarLabel}>
      <span className={styles.barCount}>{COPY.onChart(chartCount)}</span>
      <button type="button" className={styles.barButton} onClick={onViewChart}>
        {COPY.viewChart}
      </button>
      <button type="button" className={styles.barButton} aria-label={COPY.clearLabel} onClick={onClear}>
        {COPY.clear}
      </button>
    </div>
  );
}
