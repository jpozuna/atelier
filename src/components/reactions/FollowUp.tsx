"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { PickCard } from "@/components/card";
import { fetchRunSource } from "@/components/deck/source";
import type { RunHandle } from "@/components/deck/source";
import { DEGREE_WORD, EDGE_BANDS } from "@/components/deck/grouping";
import type { ReactionHow } from "@/lib/db/constants";
import { isRestingCode, TOO_MANY_REQUESTS_CODE } from "@/lib/guard/resting";
import type { PublicPick, PublicRunResult } from "@/lib/agent/types";
import type { ProfileSeed } from "@/lib/profile/types";
import type { Reaction } from "@/types";
import { answerChanged, planFollowUp, snapshotAfter } from "./follow-up";
import type { FollowUpSource, TriedPick } from "./follow-up";
import { COPY } from "./copy";
import { savedHref } from "./groups";
import { buildSaveBody, postSave, putReaction, putSnapshot, toWireItem, trimWords } from "./request";
import type { SaveStatus } from "./status";
import { SaveNotice } from "./SaveNotice";
import { signInHref, statusMessage } from "./status";
import styles from "./Reactions.module.css";

type Phase = "form" | "saving" | "looking" | "done";
type FormError = "none" | "pick_how" | "failed" | "sign_in" | "not_ready" | "too_many_seeds";
type Done =
  | { kind: "no_profile" }
  | { kind: "saved_only" }
  | { kind: "resting" }
  | { kind: "too_many" }
  | { kind: "failed" }
  | { kind: "looked"; picks: PublicPick[]; seeds: ProfileSeed[]; addedSeed: boolean };

const HOWS: readonly (readonly [ReactionHow, string])[] = [
  ["liked", COPY.howLiked],
  ["mixed", COPY.howMixed],
  ["not_liked", COPY.howNot],
];

export interface FollowUpProps {
  pick: TriedPick;
  /** The stored follow-up answer, if any. Nothing is preselected when `how` is null. */
  tried: boolean;
  how: ReactionHow | null;
  reaction: Reaction | undefined;
  /** What the account holds to look again with, read on the server. Null: the answer is saved and nothing is looked at again. */
  source: FollowUpSource | null;
  /** Called once the answer is saved, so the card above shows the new reaction. */
  onSaved: (reaction: Reaction, how: ReactionHow) => void;
}

/**
 * "Tried it? How was it? Why?" On submit the answer is saved (and a liked pick saved as a seed), then only this pick's
 * field is looked at again with the account's stored plan: one pool plus at most the loop's re-query cap, so at most 3
 * live Qloo calls, all through POST /api/run. Pressing it again costs nothing unless how it went changed. The new picks
 * are shown here, each with its path, and can be saved like any other.
 *
 * Focus never falls to the page: controls that are busy stay focusable (aria-disabled, guarded), an error moves focus to
 * the first radio or the message, and a finished look moves it to the result heading.
 */
export function FollowUp({ pick, tried: storedTried, how: storedHow, reaction, source, onSaved }: FollowUpProps) {
  const uid = useId();
  const answered = storedTried && storedHow !== null;
  const [tried, setTried] = useState<"yes" | "not_yet" | null>(storedTried ? "yes" : null);
  const [how, setHow] = useState<ReactionHow | null>(storedHow);
  const [words, setWords] = useState(reaction?.state === "tried" ? (reaction.words ?? "") : "");
  const [phase, setPhase] = useState<Phase>("form");
  const [error, setError] = useState<FormError>("none");
  const [note, setNote] = useState("");
  const [done, setDone] = useState<Done | null>(null);
  const [doneCount, setDoneCount] = useState(0);
  // True once an answer is saved (or was already stored): the button then reads "Update".
  const [submitted, setSubmitted] = useState(answered);
  const last = useRef<{ how: ReactionHow; words: string } | null>(answered ? { how: storedHow, words: reaction?.state === "tried" ? (reaction.words ?? "") : "" } : null);
  const handle = useRef<RunHandle | null>(null);
  const firstHow = useRef<HTMLInputElement | null>(null);
  const errorLine = useRef<HTMLParagraphElement>(null);
  const doneHeading = useRef<HTMLHeadingElement>(null);

  // A run in flight is cancelled if the person leaves the page.
  useEffect(
    () => () => {
      handle.current?.cancel();
    },
    [],
  );

  // Focus follows what just happened.
  useEffect(() => {
    if (error === "pick_how") firstHow.current?.focus();
    else if (error !== "none") errorLine.current?.focus();
  }, [error]);
  useEffect(() => {
    if (doneCount > 0) doneHeading.current?.focus();
  }, [doneCount]);

  const busy = phase === "saving" || phase === "looking";

  function finish(result: Done) {
    setDone(result);
    setPhase("done");
    setDoneCount((n) => n + 1);
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy || tried !== "yes") return;
    if (!how) {
      setError("pick_how");
      return;
    }
    setError("none");
    const next = { how, words: trimWords(words) ?? "" };
    const { changed, howChanged } = answerChanged(last.current, next);
    if (!changed) {
      setNote(COPY.unchanged);
      return;
    }
    setNote("");
    const plan = planFollowUp(source, pick, next);

    setPhase("saving");
    // The answer, and a liked pick as a seed, are saved BEFORE any run, so the account is never behind what was looked at.
    const saved = await putReaction(pick.id, { state: "tried", tried: true, how, words: next.words, ...(plan?.addSeed ? { addSeed: plan.addSeed } : {}) });
    if (saved.kind !== "saved") {
      setPhase("form");
      setError(saved.kind === "sign_in" ? "sign_in" : saved.kind === "not_ready" ? "not_ready" : saved.kind === "too_many_seeds" ? "too_many_seeds" : "failed");
      return;
    }
    last.current = next;
    setSubmitted(true);
    onSaved({ state: "tried", ...(next.words ? { words: next.words } : {}), at: new Date().toISOString() }, how);

    if (!howChanged) return finish({ kind: "saved_only" });
    if (!plan || !source) return finish({ kind: "no_profile" });

    setPhase("looking");
    let result: PublicRunResult | null = null;
    let code: string | null = null;
    handle.current = fetchRunSource()(plan.body, {
      onMessage: (m) => {
        if (m.type === "result") result = m.result;
        if (m.type === "error") code = m.error.code;
      },
      onEnd: () => {
        handle.current = null;
        const field = (result as PublicRunResult | null)?.domains.find((d) => d.domain === pick.field);
        if (!result || !field || field.status === "unavailable") {
          const c = code as string | null;
          finish({ kind: isRestingCode(c) ? "resting" : c === TOO_MANY_REQUESTS_CODE ? "too_many" : "failed" });
          return;
        }
        // The new plan is kept on the account (best effort: the answer and seed are already saved).
        void putSnapshot(snapshotAfter(source, (result as PublicRunResult).plan));
        const picks = EDGE_BANDS.flatMap((b) => field.byBand[b]);
        finish({ kind: "looked", picks, seeds: plan.body.seeds, addedSeed: plan.addSeed !== null });
      },
    });
  }

  const errorText =
    error === "failed"
      ? COPY.followFailed
      : error === "not_ready"
        ? COPY.saveNotReady
        : error === "too_many_seeds"
          ? COPY.saveTooManySeeds
          : error === "sign_in"
            ? COPY.followSignIn
            : "";
  const hasDone = phase === "done" && done !== null;

  return (
    <section className={styles.follow} aria-labelledby={`${uid}-h`}>
      <h2 id={`${uid}-h`} className={styles.followTitle}>
        {COPY.followHeading}
      </h2>
      <p className={styles.lede}>{COPY.followLede}</p>

      <form onSubmit={submit} className={styles.followForm} noValidate>
        <fieldset className={styles.fieldset} aria-disabled={busy || undefined}>
          <legend className={styles.legend}>{COPY.triedLegend}</legend>
          <div className={styles.options}>
            <label className={styles.option}>
              <input type="radio" name={`${uid}-tried`} checked={tried === "yes"} onChange={() => !busy && setTried("yes")} />
              <span>{COPY.triedYes}</span>
            </label>
            <label className={styles.option}>
              <input type="radio" name={`${uid}-tried`} checked={tried === "not_yet"} onChange={() => !busy && setTried("not_yet")} />
              <span>{COPY.triedNotYet}</span>
            </label>
          </div>
        </fieldset>

        {tried === "not_yet" ? <p className={styles.note}>{COPY.notYetNote}</p> : null}

        {tried === "yes" ? (
          <>
            <fieldset
              className={styles.fieldset}
              role="radiogroup"
              aria-required="true"
              aria-invalid={error === "pick_how" || undefined}
              aria-describedby={error === "pick_how" ? `${uid}-how-err` : undefined}
              aria-disabled={busy || undefined}
            >
              <legend className={styles.legend}>
                {COPY.howLegend} <span className={styles.required}>{COPY.required}</span>
              </legend>
              <div className={styles.options}>
                {HOWS.map(([value, label], i) => (
                  <label key={value} className={styles.option}>
                    <input
                      ref={i === 0 ? firstHow : undefined}
                      type="radio"
                      name={`${uid}-how`}
                      required
                      checked={how === value}
                      onChange={() => {
                        if (busy) return;
                        setHow(value);
                        setError("none");
                      }}
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
              {error === "pick_how" ? (
                <p id={`${uid}-how-err`} className={styles.error}>
                  {COPY.pickHow}
                </p>
              ) : null}
            </fieldset>

            <div className={styles.field}>
              <label htmlFor={`${uid}-why`} className={styles.label}>
                {COPY.whyLabel}
              </label>
              <p id={`${uid}-why-hint`} className={styles.note}>
                {COPY.whyHint}
              </p>
              <textarea
                id={`${uid}-why`}
                className={styles.textarea}
                rows={3}
                value={words}
                readOnly={busy}
                onChange={(e) => !busy && setWords(e.target.value)}
                aria-describedby={`${uid}-why-hint`}
              />
            </div>

            <div className={styles.actions}>
              <button type="submit" className={styles.button} aria-disabled={busy || undefined}>
                {submitted ? COPY.update : COPY.submit}
              </button>
            </div>
          </>
        ) : null}

        {errorText ? (
          <p ref={errorLine} tabIndex={-1} role="alert" className={styles.error}>
            {errorText}
            {error === "sign_in" ? (
              <>
                {" "}
                <Link className={styles.link} href={signInHref(savedHref(pick.id))}>
                  {COPY.followSignInLink}
                </Link>
              </>
            ) : null}
          </p>
        ) : null}
      </form>

      <div role="status" aria-live="polite" className={styles.followStatus}>
        {note ? <p className={styles.noticeText}>{note}</p> : null}
        {phase === "saving" ? <p className={styles.noticeText}>{COPY.followSaving}</p> : null}
        {phase === "looking" ? <p className={styles.noticeText}>{COPY.lookingAgain(pick.field)}</p> : null}
        {hasDone ? (
          <div className={styles.followDone}>
            <h3 ref={doneHeading} tabIndex={-1} className={styles.followDoneTitle}>
              {COPY.followDoneTitle}
            </h3>
            {done.kind === "no_profile" ? (
              <p className={styles.noticeText}>
                {COPY.lookedNoProfile}{" "}
                <Link className={styles.link} href="/start">
                  {COPY.startAgain}
                </Link>
              </p>
            ) : null}
            {done.kind === "saved_only" ? <p className={styles.noticeText}>{COPY.savedOnly}</p> : null}
            {done.kind === "resting" ? <p className={styles.noticeText}>{COPY.lookedResting}</p> : null}
            {done.kind === "too_many" ? <p className={styles.noticeText}>{COPY.lookedTooMany}</p> : null}
            {done.kind === "failed" ? <p className={styles.noticeText}>{COPY.lookedFailed(pick.field)}</p> : null}
            {done.kind === "looked" ? (
              <p className={styles.noticeText}>
                {done.picks.length > 0 ? COPY.looked(pick.field) : COPY.lookedNothing(pick.field)}
                {done.addedSeed ? ` ${COPY.addedSeed}` : ""}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      {hasDone && done.kind === "looked" && done.picks.length > 0 ? <FurtherPicks field={pick.field} picks={done.picks} seeds={done.seeds} /> : null}
    </section>
  );
}

/** The new picks of the field, one column, each opening to its card. Saving one stores it with the seeds the look used. */
function FurtherPicks({ field, picks, seeds }: { field: PublicPick["field"]; picks: readonly PublicPick[]; seeds: readonly ProfileSeed[] }) {
  const [status, setStatus] = useState<Record<string, SaveStatus>>({});
  const [reactions, setReactions] = useState<Record<string, Reaction>>({});

  function react(p: PublicPick, r: Reaction) {
    setReactions((x) => ({ ...x, [p.id]: r }));
    setStatus((x) => ({ ...x, [p.id]: "saving" }));
    void postSave(buildSaveBody(seeds, [toWireItem(p, r)])).then((outcome) => setStatus((x) => ({ ...x, [p.id]: outcome.kind })));
  }

  return (
    <div className={styles.further}>
      <h3 className={styles.furtherTitle}>{COPY.furtherHeading(field)}</h3>
      <p className={styles.lede}>{COPY.furtherLede}</p>
      <ul className={styles.itemsSingle}>
        {picks.map((p) => {
          const r = reactions[p.id];
          const card = r ? { ...p.card, reaction: r } : p.card;
          return (
            <li key={p.id} className={styles.item}>
              <details className={styles.details}>
                <summary className={styles.summary}>
                  <span className={styles.summaryMain}>
                    <span className={styles.itemName}>{p.name}</span>
                    <span className={styles.itemMeta}>{DEGREE_WORD[p.band]}</span>
                  </span>
                  <span className={styles.toggle}>
                    <span className={styles.chevron} aria-hidden="true" />
                    <span className={styles.showText}>{COPY.showPath}</span>
                    <span className={styles.hideText}>{COPY.hidePath}</span>
                  </span>
                </summary>
                <PickCard card={card} title={p.name} field={p.field} headingLevel={4} onReact={(next) => react(p, next)} />
                <p className={styles.noticeText} role="status">
                  {statusMessage(status[p.id] ?? "idle")}
                </p>
              </details>
            </li>
          );
        })}
      </ul>
      {Object.values(status).some((s) => s === "sign_in") ? <SaveNotice saver={{ status: "sign_in" }} next="/saved" /> : null}
    </div>
  );
}
