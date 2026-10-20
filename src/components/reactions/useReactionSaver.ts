"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Reaction } from "@/types";
import type { PublicRunResult, RunInputs } from "@/components/deck/types";
import { stashFromSession } from "./carry";
import { buildSaveBody, postSave, toWireItem } from "./request";
import type { SaveStatus } from "./status";

export interface ReactionSaver {
  /** Save one pick with the reaction the person just gave it. Call it next to the screen's own state update. */
  save: (pickId: string, reaction: Reaction) => void;
  status: SaveStatus;
}

/**
 * Saving from the picks screen. A signed-in person's reaction is stored (their seeds, the profile snapshot, then the pick
 * with its path and card, then the reaction). The snapshot goes with the first save of a run, and again only when the
 * run's plan changes. A guest gets `sign_in`: nothing is stored, and their onboarding and picks are copied where a magic
 * link opened in another tab can find them. The screen keeps its own copy of the reaction either way.
 */
export function useReactionSaver({ inputs, result }: { inputs: RunInputs; result: PublicRunResult | null }): ReactionSaver {
  const [status, setStatus] = useState<SaveStatus>("idle");
  const latest = useRef({ inputs, result });
  const snapshotSent = useRef<string | null>(null);
  useEffect(() => {
    latest.current = { inputs, result };
  });

  const save = useCallback((pickId: string, reaction: Reaction) => {
    const { inputs: current, result: run } = latest.current;
    const pick = run?.domains.flatMap((d) => d.picks).find((p) => p.id === pickId);
    if (!pick) return;
    setStatus("saving");
    const snapshot = { profile: current.profile, axes: current.axes, plan: run?.plan ?? null };
    const key = JSON.stringify(snapshot.plan);
    const send = snapshotSent.current !== key;
    void postSave(buildSaveBody(current.seeds, [toWireItem(pick, reaction)], send ? snapshot : undefined)).then((outcome) => {
      if (outcome.kind === "sign_in") stashFromSession();
      else if (outcome.kind === "saved" && send) snapshotSent.current = key;
      setStatus(outcome.kind);
    });
  }, []);

  return { save, status };
}
