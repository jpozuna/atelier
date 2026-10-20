import type { Metadata } from "next";
import Link from "next/link";
import { PendingSave, SavedList, SignOutButton } from "@/components/reactions";
import { COPY } from "@/components/reactions/copy";
import { signInHref } from "@/components/reactions/status";
import { SAVED_PATH } from "@/components/reactions/constants";
import styles from "@/components/reactions/Reactions.module.css";
import { loadSaved } from "../load";

export const metadata: Metadata = {
  title: "Saved | Atelier",
};

// Per person: reads the session cookie and the person's own rows.
export const dynamic = "force-dynamic";

export default async function SavedPage() {
  const saved = await loadSaved();

  if (saved.kind === "guest") {
    return (
      <div className={styles.state}>
        <h1 className={styles.pageTitle}>{COPY.savedGuestTitle}</h1>
        <p className={styles.lede}>{COPY.savedGuestBody}</p>
        <Link className={styles.link} href={signInHref(SAVED_PATH)}>
          {COPY.savedGuestLink}
        </Link>
      </div>
    );
  }
  if (saved.kind === "unavailable" || saved.kind === "failed") {
    return (
      <div className={styles.state}>
        <h1 className={styles.pageTitle}>{COPY.savedUnavailableTitle}</h1>
        <p className={styles.lede} role="status">
          {saved.kind === "unavailable" ? COPY.savedUnavailableBody : COPY.savedFailedBody}
        </p>
      </div>
    );
  }

  return (
    // A guest who signed in without a destination lands here: their waiting picks are offered, and the list refreshes once saved.
    <PendingSave refreshOnSaved>
      <div className={styles.groups}>
        <header>
          <h1 className={styles.pageTitle}>{COPY.savedTitle}</h1>
          <p className={styles.lede}>{COPY.savedLede}</p>
          <p className={styles.noticeText}>{saved.email ? COPY.signedInAs(saved.email) : COPY.signedIn}</p>
          <SignOutButton />
        </header>
        <SavedList items={saved.items} />
      </div>
    </PendingSave>
  );
}
