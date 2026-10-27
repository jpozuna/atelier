"use client";

import type { Ref } from "react";
import type { Axis, Card, Reaction } from "@/types";
import { PickCard } from "@/components/card";
import { SaveNotice } from "@/components/reactions";
import type { ReactionSaver } from "@/components/reactions";
import { COPY } from "./copy";
import { placement, sourcesOf } from "./reasoning";
import type { Sources } from "./reasoning";
import type { PublicPick } from "./types";
import styles from "./ReasoningArea.module.css";

export interface ReasoningAreaProps {
  /** The suggestion being read, or null. */
  selected: PublicPick | null;
  /** Its card, with the person's reaction merged in. */
  card: Card | null;
  axes: readonly Axis[];
  /** How many other suggestions are on the chart with this one. */
  alsoShown: number;
  saver: { status: ReactionSaver["status"] };
  onReact: (id: string, reaction: Reaction) => void;
  /** Back to the suggestions: the screen puts focus back on the row or node the card came from. */
  onClose: () => void;
  /** Scroll the chart into view and focus it. */
  onViewChart: () => void;
  /** The wrapper around the card, so the screen can move focus to its title. */
  cardRef: Ref<HTMLDivElement>;
}

/**
 * The reasoning for the selected suggestion, and nothing else: where it sits on the chart (words only), the
 * card's explanation and path, and its retrieved sources, if any. Everything comes from the stored path. The
 * streamed steps are not shown here. It takes the place of the close picks in the screen's side panel (below the
 * chart on a phone), and the panel scrolls, not this. "Back to suggestions" leads and ends it.
 */
export function ReasoningArea({ selected, card, axes, alsoShown, saver, onReact, onClose, onViewChart, cardRef }: ReasoningAreaProps) {
  if (!selected || !card) {
    return (
      <section className={styles.area} aria-label={COPY.reasoningLabel}>
        <h2 className={styles.title}>{COPY.reasoningTitle}</h2>
        <p className={styles.quiet}>{COPY.reasoningEmpty}</p>
      </section>
    );
  }
  const where = placement(selected, axes);
  const whereText = where.stretch ? COPY.whereEdge(where.axis, where.stretch) : COPY.whereClose(where.axis);
  return (
    <section className={styles.area} aria-label={COPY.selectedLabel}>
      <div className={styles.body}>
        <button type="button" className={styles.back} onClick={onClose}>
          {COPY.backToSuggestions}
        </button>
        <div className={styles.whereRow}>
          <p className={styles.where}>{whereText}</p>
          <button type="button" className={styles.view} onClick={onViewChart}>
            {COPY.viewChart}
          </button>
        </div>
        {alsoShown > 0 ? <p className={styles.quiet}>{COPY.alsoShown(alsoShown)}</p> : null}
        <div ref={cardRef} className={styles.cardWrap}>
          <PickCard key={selected.id} card={card} title={selected.name} field={selected.field} headingLevel={2} parentConfirms onReact={(r) => onReact(selected.id, r)} />
        </div>
        <SourcesBlock sources={sourcesOf(selected)} />
        <SaveNotice saver={saver} />
        <button type="button" className={styles.back} onClick={onClose}>
          {COPY.backToSuggestions}
        </button>
      </div>
    </section>
  );
}

/**
 * What was retrieved for this pick: sourced steps with their provenance word, step kind and link, and a reading
 * when one was retrieved. Nothing inferred is listed or counted here, and when nothing was retrieved the block is
 * not drawn at all.
 */
export function SourcesBlock({ sources }: { sources: Sources }) {
  const { sourced, reading } = sources;
  if (sourced.length === 0 && !reading) return null;
  return (
    <section className={styles.sources} aria-labelledby="sources-heading">
      <h3 id="sources-heading" className={styles.sourcesTitle}>
        {COPY.sourcesHeading}
      </h3>
      {sourced.length > 0 ? (
        <ul className={styles.sourceList}>
          {sourced.map((s, i) => (
            <li key={`${i}-${s.label}`} className={styles.sourceItem}>
              <span className={styles.badge} data-provenance="sourced">
                {COPY.sourcedWord}
              </span>
              <span className={styles.kind}>{s.kindLabel}</span>
              <span className={styles.sourceText}>{s.label}</span>
              {s.href ? (
                <a href={s.href} target="_blank" rel="noopener noreferrer" className={styles.link}>
                  {COPY.viewSource}
                  <span className="sr-only"> for {s.label} (opens in a new tab)</span>
                </a>
              ) : s.sourceLabel ? (
                <span className={styles.note}>{COPY.sourceOf(s.sourceLabel)}</span>
              ) : s.linkMissing ? (
                <span className={styles.note}>{COPY.linkMissing}</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {reading ? (
        <p className={styles.reading}>
          <span className={styles.note}>
            {COPY.readingFrom}
            {reading.sourceLabel ? ` ${COPY.sourceOf(reading.sourceLabel)}` : ""}
          </span>
          {reading.href ? (
            <a href={reading.href} target="_blank" rel="noopener noreferrer" className={styles.link}>
              {COPY.viewSource}
              <span className="sr-only"> for this reading (opens in a new tab)</span>
            </a>
          ) : null}
        </p>
      ) : null}
    </section>
  );
}
