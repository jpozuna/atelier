"use client";

import { useState } from "react";
import type { Reaction } from "@/types";
import { MOCK_CARDS } from "./mock";
import { PickCard } from "./PickCard";
import { REACTION_LABEL } from "./helpers";

/** Demo of the pick card on synthetic data. Nothing here is persisted. */
export function CardDemo() {
  const [last, setLast] = useState<string>("");

  function onReact(title: string, r: Reaction) {
    setLast(`${title}: ${REACTION_LABEL[r.state]}${r.words ? `, "${r.words}"` : ""}`);
  }

  return (
    <div style={{ display: "grid", gap: "var(--space-7)", justifyItems: "start" }}>
      <h1>Pick card, mock data</h1>
      <p role="status" style={{ margin: 0, fontFamily: "var(--font-ui)", color: "var(--color-text-muted)" }}>
        {last ? `Emitted ${last}` : "Nothing emitted yet."}
      </p>
      {MOCK_CARDS.map((m, i) => (
        <PickCard
          key={m.id}
          card={m.card}
          title={m.title}
          field={m.field}
          headingLevel={2}
          reveal={i === 0}
          onReact={(r) => onReact(m.title, r)}
        />
      ))}
    </div>
  );
}
