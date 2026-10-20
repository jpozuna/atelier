"use client";

import Link from "next/link";
import { useState } from "react";
import { PickCard } from "@/components/card";
import type { ReactionHow } from "@/lib/db/constants";
import type { Reaction } from "@/types";
import { FollowUp } from "./FollowUp";
import type { FollowUpSource } from "./follow-up";
import { COPY } from "./copy";
import { SAVED_PATH } from "./constants";
import { putReaction, reactionUpdate } from "./request";
import { savedHref } from "./groups";
import type { SavedItem } from "./groups";
import type { SaveStatus } from "./status";
import { SaveNotice } from "./SaveNotice";
import styles from "./Reactions.module.css";

export interface SavedCardProps {
  item: SavedItem;
  /** The entity id, for the follow-up (a pick tried and liked can become a seed). Null for a bridged pick. */
  qlooId: string | null;
  llmBridged: boolean;
  /** What the account holds to look again with. Null when there is no stored profile yet. */
  source: FollowUpSource | null;
}

/**
 * A saved pick's stored card, opened with no lookup: the card is read from the database row, never rebuilt. A change in
 * the card's reaction area sends the state (and words, if any) and nothing about the follow-up, so it cannot wipe what
 * the person said after trying the pick. Below it the follow-up asks whether they tried it.
 */
export function SavedCard({ item, qlooId, llmBridged, source }: SavedCardProps) {
  const [reaction, setReaction] = useState<Reaction | undefined>(item.card.reaction);
  const [how, setHow] = useState<ReactionHow | null>(item.how);
  const [tried, setTried] = useState(item.tried);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const card = reaction ? { ...item.card, reaction } : item.card;

  function react(next: Reaction) {
    setStatus("saving");
    void putReaction(item.id, reactionUpdate(next)).then((outcome) => {
      if (outcome.kind === "saved") setReaction(next);
      setStatus(outcome.kind);
    });
  }

  return (
    <div className={styles.detail}>
      <p>
        <Link className={styles.link} href={SAVED_PATH}>
          {COPY.allSaved}
        </Link>
      </p>
      <PickCard
        card={card}
        title={item.name}
        field={item.field}
        headingLevel={1}
        reactionMode="states"
        parentConfirms
        onReact={react}
      />
      <SaveNotice saver={{ status }} next={savedHref(item.id)} showSavedLink={false} />
      {reaction?.state !== "not_interested" ? (
        <FollowUp
          pick={{ id: item.id, qlooId, field: item.field, name: item.name, llmBridged }}
          tried={tried}
          how={how}
          reaction={reaction}
          source={source}
          onSaved={(r, h) => {
            setReaction(r);
            setHow(h);
            setTried(true);
          }}
        />
      ) : null}
    </div>
  );
}
