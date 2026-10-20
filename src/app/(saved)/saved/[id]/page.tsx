import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { SavedCard } from "@/components/reactions";
import { COPY } from "@/components/reactions/copy";
import { signInHref } from "@/components/reactions/status";
import styles from "@/components/reactions/Reactions.module.css";
import { savedHref } from "@/components/reactions/groups";
import { loadFollowUpSource, loadSaved } from "../../load";

export const dynamic = "force-dynamic";

// The page and its title read the same rows once.
const load = cache(() => loadSaved());

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const saved = await load();
  const item = saved.kind === "ok" ? saved.items.find((p) => p.id === id) : undefined;
  return { title: item ? `${item.name} | Atelier` : "Saved pick | Atelier" };
}

/** A saved pick opens its stored card. The card is read from the saved row: no Qloo call, no model call. */
export default async function SavedPickPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const saved = await load();

  if (saved.kind === "guest") {
    return (
      <div className={styles.state}>
        <h1 className={styles.pageTitle}>{COPY.savedGuestTitle}</h1>
        <p className={styles.lede}>{COPY.savedGuestBody}</p>
        <Link className={styles.link} href={signInHref(savedHref(id))}>
          {COPY.savedGuestLink}
        </Link>
      </div>
    );
  }
  if (saved.kind !== "ok") {
    return (
      <div className={styles.state}>
        <h1 className={styles.pageTitle}>{COPY.savedUnavailableTitle}</h1>
        <p className={styles.lede} role="status">
          {saved.kind === "unavailable" ? COPY.savedUnavailableBody : COPY.savedFailedBody}
        </p>
      </div>
    );
  }

  const item = saved.items.find((p) => p.id === id);
  if (!item) notFound();
  // What the follow-up looks again with comes from the account, so it works on any device.
  const source = await loadFollowUpSource(saved, item.field);
  return <SavedCard item={item} qlooId={item.qlooId} llmBridged={item.llmBridged} source={source} />;
}
