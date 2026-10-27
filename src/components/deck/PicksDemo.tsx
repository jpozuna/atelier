"use client";

import { useMemo, useState } from "react";
import { FIXTURE_INPUTS, makeFixtureResult, makeFixtureTrace } from "./fixture";
import { domainSteps } from "./preview";
import { PicksScreen } from "./PicksScreen";
import type { RunSource } from "./source";
import styles from "./PicksDemo.module.css";

type Scenario = "run" | "slow" | "stopped" | "not_ready" | "failed";

const LABEL: Record<Scenario, string> = {
  run: "A run that finishes",
  slow: "A slow run",
  stopped: "A run that stops partway",
  not_ready: "Picks not enabled",
  failed: "A run that fails",
};

/**
 * A synthetic source: the fixture trace one event at a time, then the picks one field at a time (`domain` events, as the
 * server sends them), then the result (or the chosen failure). A "stopped" run delivers two fields and then fails.
 */
function demoSource(scenario: Scenario): RunSource {
  return (body, handlers) => {
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const after = (ms: number, fn: () => void) => timers.push(setTimeout(() => !cancelled && fn(), ms));
    const partial = Array.isArray(body.domains) && body.domains.length > 0;
    const trace = partial ? makeFixtureTrace().slice(0, 4) : makeFixtureTrace();
    const step = scenario === "slow" ? 900 : 260;
    trace.forEach((event, i) => after(step * (i + 1), () => handlers.onMessage({ type: "trace", event })));
    // Fields arrive one at a time after the steps: a re-run only the fields it refreshes, a stopped run only two.
    const final = makeFixtureResult(partial ? "again" : "first");
    const noPicks = scenario === "failed" || scenario === "not_ready";
    const order = noPicks ? [] : partial ? body.domains : scenario === "stopped" ? final.domains.slice(0, 2).map((d) => d.domain) : undefined;
    const fields = domainSteps(final, step * (trace.length + 1), step * 2, order);
    fields.forEach(({ at, message }) => after(at, () => handlers.onMessage(message)));
    const end = step * (trace.length + 1) + step * 2 * fields.length;
    after(end, () => {
      if (scenario === "not_ready") handlers.onMessage({ type: "error", error: { code: "picks_not_enabled" } });
      else if (scenario === "failed" || scenario === "stopped") handlers.onMessage({ type: "error", error: { code: "upstream" } });
      else handlers.onMessage({ type: "result", result: final });
      handlers.onMessage({ type: "done" });
      handlers.onEnd();
    });
    return {
      cancel: () => {
        cancelled = true;
        timers.forEach(clearTimeout);
      },
    };
  };
}

/**
 * Dev preview of the picks screen on a synthetic run. Nothing here calls an API or reads storage. Pick a scenario
 * to remount the screen with it. Use a dev-only route such as /dev/picks.
 */
export function PicksDemo() {
  const [scenario, setScenario] = useState<Scenario>("run");
  const [round, setRound] = useState(0);
  const source = useMemo(() => demoSource(scenario), [scenario]);
  return (
    <div className={styles.demo}>
      <div role="group" aria-label="Preview scenario" className={styles.controls}>
        {(Object.keys(LABEL) as Scenario[]).map((s) => (
          <button
            key={s}
            type="button"
            className={styles.button}
            aria-pressed={scenario === s}
            onClick={() => {
              setScenario(s);
              setRound((n) => n + 1);
            }}
          >
            {LABEL[s]}
          </button>
        ))}
      </div>
      <PicksScreen key={`${scenario}-${round}`} inputs={FIXTURE_INPUTS} source={source} persist={false} />
    </div>
  );
}
