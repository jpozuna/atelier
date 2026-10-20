"use client";

import { signOutAction } from "@/app/auth/actions";
import { clearLocalWork } from "./carry";
import { COPY } from "./copy";
import styles from "./Reactions.module.css";

/** Ends the session and forgets what this browser holds of the person's work: the waiting record, and this tab's onboarding and picks. */
export function SignOutButton() {
  return (
    <form action={signOutAction} onSubmit={() => clearLocalWork()}>
      <button type="submit" className={styles.linkButton}>
        {COPY.signOut}
      </button>
    </form>
  );
}
