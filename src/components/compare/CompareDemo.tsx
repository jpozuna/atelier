"use client";

import { useMemo, useState } from "react";
import { FIXTURE_INPUTS, makeFixtureResult } from "@/components/deck/fixture";
import { CompareScreen } from "./CompareScreen";
import type { PlainSource } from "./request";
import type { PlainPick } from "./types";
import { atelierByField } from "./view";

type Scenario = "answers" | "fails" | "model_off";

const LABEL: Record<Scenario, string> = { answers: "The plain model answers", fails: "The model cannot be reached", model_off: "No model key set" };

const NAMES = ["Lantern Study", "Fallow Atlas", "Tin Orchard", "Quiet Almanac", "Gilt Chorus", "Hollow Ledger"];

/** A synthetic plain list: invented names, one plain line each, for the fields asked. */
function fakePicks(fields: readonly string[]): PlainPick[] {
  return fields.flatMap((field, fi) =>
    NAMES.slice(0, 3 + (fi % 3)).map((n, i): PlainPick => ({ field: field as PlainPick["field"], name: `${n} ${String.fromCharCode(65 + fi)}`, why: i % 2 ? "A slow, spare piece in the same quiet register." : "It leaves room around each part, as your list does." })),
  );
}

function demoSource(scenario: Scenario): PlainSource {
  return async (body) => {
    await new Promise((r) => setTimeout(r, 700));
    if (scenario === "answers") return { ok: true, picks: fakePicks(body.fields) };
    return { ok: false, code: scenario === "model_off" ? "model_off" : "upstream" };
  };
}

/** Dev preview: the comparison on a synthetic run, with a fake model. Pick a scenario to remount it. */
export function CompareDemo() {
  const [scenario, setScenario] = useState<Scenario>("answers");
  const atelier = useMemo(() => atelierByField(makeFixtureResult(), { hidden: [], notMe: [], seeds: FIXTURE_INPUTS.seeds }), []);
  const seeds = useMemo(() => FIXTURE_INPUTS.seeds.map((s) => ({ field: s.field, typed: s.typed, why: s.why })), []);
  return (
    <div>
      <fieldset style={{ marginBottom: "var(--space-6)", border: "none", padding: 0 }}>
        <legend>Scenario</legend>
        {(Object.keys(LABEL) as Scenario[]).map((s) => (
          <label key={s} style={{ marginRight: "var(--space-5)" }}>
            <input type="radio" name="scenario" checked={scenario === s} onChange={() => setScenario(s)} /> {LABEL[s]}
          </label>
        ))}
      </fieldset>
      <CompareScreen key={scenario} seeds={seeds} atelier={atelier} storageKey="demo" persist={false} source={demoSource(scenario)} />
    </div>
  );
}
