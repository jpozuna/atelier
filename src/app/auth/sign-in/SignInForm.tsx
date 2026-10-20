"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef } from "react";
import { stashFromSession } from "@/components/reactions/carry";
import { COPY } from "@/components/reactions/copy";
import { PICKS_PATH, SIGN_IN_PATH } from "@/components/reactions/constants";
import { requestSignIn } from "./actions";
import styles from "./SignIn.module.css";
import { INITIAL_SIGN_IN } from "./state";
import type { SignInReason } from "./state";

const REASON_TEXT: Record<SignInReason, string> = {
  invalid_email: COPY.invalidEmail,
  rate_limited: COPY.rateLimited,
  failed: COPY.sendFailed,
  unavailable: COPY.signInNotReady,
};

/**
 * Email only, no password: the person gets a link. `next` is where the link should bring them back to; it travels
 * in a cookie the server sets, not in the link. `linkFailed` is true after a link that did not work.
 */
export function SignInForm({ next, linkFailed }: { next: string; linkFailed: boolean }) {
  const [state, action, pending] = useActionState(requestSignIn, INITIAL_SIGN_IN);
  const sentTitle = useRef<HTMLHeadingElement>(null);
  const emailInput = useRef<HTMLInputElement>(null);
  const errorLine = useRef<HTMLParagraphElement>(null);

  // The button that was pressed goes away or stays, but focus never falls to the page: on success it moves to the new
  // heading, on a problem to the email field (when that is what is wrong) or to the message.
  useEffect(() => {
    if (state.status === "sent") sentTitle.current?.focus();
    else if (state.status === "error") (state.reason === "invalid_email" ? emailInput.current : errorLine.current)?.focus();
  }, [state]);

  if (state.status === "sent") {
    const again = next ? `${SIGN_IN_PATH}?next=${encodeURIComponent(next)}` : SIGN_IN_PATH;
    return (
      <section className={styles.panel} aria-labelledby="sent-title">
        <h1 id="sent-title" ref={sentTitle} tabIndex={-1} className={styles.title}>
          {COPY.sentTitle}
        </h1>
        <p className={styles.lede} role="status">
          {COPY.sent(state.email)}
        </p>
        <p>
          <a className={styles.link} href={again}>
            {COPY.sendAnother}
          </a>
        </p>
      </section>
    );
  }

  const error = state.status === "error" ? REASON_TEXT[state.reason] : linkFailed ? COPY.linkFailed : null;
  const email = state.status === "error" ? state.email : "";

  return (
    <section className={styles.panel} aria-labelledby="sign-in-title">
      <h1 id="sign-in-title" className={styles.title}>
        {COPY.signInTitle}
      </h1>
      <p className={styles.lede}>{COPY.signInLede}</p>
      <p className={styles.note}>{COPY.signInKeeps}</p>
      <form
        action={action}
        className={styles.form}
        onSubmit={() => {
          // A guest who came to save: keep the onboarding and picks where a new tab can find them.
          if (next === PICKS_PATH) stashFromSession();
        }}
      >
        <input type="hidden" name="next" value={next} />
        <div className={styles.field}>
          <label htmlFor="email" className={styles.label}>
            {COPY.emailLabel}
          </label>
          <input
            ref={emailInput}
            id="email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            required
            defaultValue={email}
            className={styles.input}
            aria-describedby={error ? "sign-in-error" : undefined}
            aria-invalid={state.status === "error" && state.reason === "invalid_email" ? true : undefined}
          />
        </div>
        <div className={styles.actions}>
          <button type="submit" className={styles.button} disabled={pending}>
            {pending ? COPY.sending : COPY.sendLink}
          </button>
          <Link className={styles.link} href={next || "/"}>
            {COPY.notNow}
          </Link>
        </div>
        {error ? (
          <p id="sign-in-error" ref={errorLine} tabIndex={-1} role="alert" className={styles.error}>
            {error}
          </p>
        ) : null}
      </form>
    </section>
  );
}
