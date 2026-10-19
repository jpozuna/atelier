"use client";

import { useId, useState } from "react";
import type { FormEvent } from "react";
import type { Card, Field, Reaction, ReactionState } from "@/types";
import {
  FIELD_LABEL,
  REACTION_LABEL,
  buildReaction,
  offeredStates,
  pathToDisplaySteps,
  pickTitle,
  provenanceSummary,
  safeHref,
  whyHint,
} from "./helpers";
import styles from "./PickCard.module.css";

export type PickCardProps = {
  /** The card to show. Only its fields are used. Nothing is fetched. */
  card: Card;
  /** Defaults to the label of the final hop of the path. */
  title?: string;
  /** Shown as plain text next to the title. */
  field?: Field;
  /** Heading level of the title (section headings sit one level below). Default 3. */
  headingLevel?: 2 | 3 | 4 | 5;
  /** Called when the user saves a reaction. The parent persists it. */
  onReact?: (reaction: Reaction) => void;
  /** Fade the card in on mount. Respects prefers-reduced-motion through the tokens. Default false. */
  reveal?: boolean;
};

type HeadingTag = "h2" | "h3" | "h4" | "h5" | "h6";

/**
 * The four-part pick card, in this order: the path, why this one, what is different, provenance.
 * A reading, when present, follows, then the reaction area. No scores or rankings are shown.
 */
export function PickCard({ card, title, field, headingLevel = 3, onReact, reveal = false }: PickCardProps) {
  const uid = useId();
  const Title = `h${headingLevel}` as HeadingTag;
  const Section = `h${Math.min(headingLevel + 1, 6)}` as HeadingTag;
  const name = title ?? pickTitle(card);
  const steps = pathToDisplaySteps(card.path);
  const readingHref = card.reading ? safeHref(card.reading.sourceUrl) : undefined;

  return (
    <article
      className={reveal ? `${styles.card} ${styles.reveal}` : styles.card}
      aria-labelledby={`${uid}-title`}
    >
      <header className={styles.header}>
        <Title id={`${uid}-title`} className={styles.title}>
          {name}
        </Title>
        {field ? <p className={styles.field}>{FIELD_LABEL[field]}</p> : null}
      </header>

      <div className={styles.section}>
        <Section className={styles.sectionTitle}>
          The path back to you
        </Section>
        <ol className={styles.path}>
          {steps.map((s) => (
            <li
              key={s.key}
              className={styles.step}
              data-provenance={s.badge?.provenance}
              data-line={s.badge?.lineStyle}
            >
              <p className={styles.stepKind}>{s.kindLabel}</p>
              <p className={styles.stepLabel}>{s.label}</p>
              {s.badge ? (
                <p className={styles.stepProvenance}>
                  <span className={styles.badge} data-provenance={s.badge.provenance}>
                    {s.badge.label}
                  </span>
                  {s.href ? (
                    <a href={s.href} target="_blank" rel="noopener noreferrer" className={styles.link}>
                      View source<span className={styles.sr}> for {s.label} (opens in a new tab)</span>
                    </a>
                  ) : null}
                  {s.linkMissing ? <span className={styles.note}>Link unavailable.</span> : null}
                </p>
              ) : null}
            </li>
          ))}
        </ol>
        {card.path.anchor.thin ? (
          <p className={styles.note}>This pick is only loosely tied to the seed it starts from.</p>
        ) : null}
      </div>

      <div className={styles.section}>
        <Section className={styles.sectionTitle}>
          Why this one
        </Section>
        <p className={styles.prose}>{card.why}</p>
      </div>

      <div className={styles.section}>
        <Section className={styles.sectionTitle}>
          What is different
        </Section>
        <p className={styles.prose}>{card.different}</p>
      </div>

      <div className={styles.section}>
        <Section className={styles.sectionTitle}>
          Provenance
        </Section>
        <p className={styles.prose}>{provenanceSummary(card.path)}</p>
        <ul className={styles.legend}>
          <li data-provenance="sourced" data-line="solid">
            <span className={styles.badge} data-provenance="sourced">
              Sourced
            </span>{" "}
            is a connecting step taken from retrieved text, with a link.
          </li>
          <li data-provenance="inferred" data-line="dashed">
            <span className={styles.badge} data-provenance="inferred">
              Inferred
            </span>{" "}
            is a connecting step worked out from shared attributes, with no link.
          </li>
        </ul>
      </div>

      {card.reading ? (
        <div className={`${styles.section} ${styles.reading}`}>
          <Section className={styles.sectionTitle}>
            A reading
          </Section>
          <p className={styles.prose}>{card.reading.text}</p>
          <p className={styles.note}>Taken from retrieved text. It is one interpretation, not a fact about your taste.</p>
          {readingHref ? (
            <a href={readingHref} target="_blank" rel="noopener noreferrer" className={styles.link}>
              View source<span className={styles.sr}> for this reading (opens in a new tab)</span>
            </a>
          ) : null}
        </div>
      ) : null}

      <ReactionArea
        key={card.reaction ? `${card.reaction.state}|${card.reaction.at}` : "none"}
        reaction={card.reaction}
        onReact={onReact}
        headingTag={Section}
        uid={uid}
      />
    </article>
  );
}

function ReactionArea({
  reaction,
  onReact,
  headingTag: Heading,
  uid,
}: {
  reaction: Reaction | undefined;
  onReact?: (reaction: Reaction) => void;
  headingTag: HeadingTag;
  uid: string;
}) {
  const [state, setState] = useState<ReactionState | null>(reaction?.state ?? null);
  const [words, setWords] = useState(reaction?.words ?? "");
  const [saved, setSaved] = useState<ReactionState | null>(reaction?.state ?? null);
  const [error, setError] = useState(false);

  // `tried` is a follow-up owned by the revisit flow. It is shown only if the card already carries it.
  const options = offeredStates(reaction);

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!state) {
      setError(true);
      return;
    }
    setError(false);
    setSaved(state);
    onReact?.(buildReaction(state, words));
  }

  return (
    <div className={styles.section}>
      <Heading className={styles.sectionTitle}>
        Your reaction
      </Heading>
      <form onSubmit={submit} className={styles.form} noValidate>
        <fieldset className={styles.fieldset} aria-describedby={error ? `${uid}-err` : undefined}>
          <legend className={styles.legend2}>What will you do with it?</legend>
          <div className={styles.options}>
            {options.map((o) => (
              <label key={o} className={styles.option}>
                <input
                  type="radio"
                  name={`${uid}-state`}
                  value={o}
                  checked={state === o}
                  onChange={() => {
                    setState(o);
                    setSaved(null);
                    setError(false);
                  }}
                />
                <span>{REACTION_LABEL[o]}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className={styles.field2}>
          <label htmlFor={`${uid}-words`} className={styles.label}>
            Why, in your own words
          </label>
          <p id={`${uid}-hint`} className={styles.note}>
            {whyHint(state)}
          </p>
          <textarea
            id={`${uid}-words`}
            className={styles.textarea}
            rows={3}
            value={words}
            onChange={(e) => {
              setWords(e.target.value);
              setSaved(null);
            }}
            aria-describedby={`${uid}-hint`}
          />
        </div>

        <div className={styles.actions}>
          <button type="submit" className={styles.button}>
            Save reaction
          </button>
          <p role="status" className={styles.status}>
            {saved ? `Saved: ${REACTION_LABEL[saved]}.` : ""}
          </p>
        </div>
        {error ? (
          <p id={`${uid}-err`} role="alert" className={styles.error}>
            Choose one of the options before saving.
          </p>
        ) : null}
      </form>
    </div>
  );
}
