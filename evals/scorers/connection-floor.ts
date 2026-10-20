// connection-floor: every shown pick has connection >= CONNECTION_FLOOR, at every dial setting. The result's picks
// and its `byBand` lists are both read, so a pick shown at any dial setting is checked. A pick with no stored
// connection fails: read the server-side result, not the public one (the browser never receives connection).

import { CONNECTION_FLOOR } from "@/lib/agent/config";
import type { CaseInput, ScorerResult, TraceScorer } from "../harness/types";
import { isNum, pickLabel, withResult } from "./_shared";

export function scoreConnectionFloor(input: CaseInput): ScorerResult {
  return withResult(input, (r) => {
    const reasons: string[] = [];
    let checked = 0;
    for (const d of r.domains) {
      for (const p of d.picks) {
        checked++;
        const who = pickLabel(d.domain, p);
        if (!isNum(p.connection)) reasons.push(`${who}: no stored connection to check against the floor`);
        else if (p.connection < CONNECTION_FLOOR) reasons.push(`${who}: connection ${p.connection.toFixed(2)} is under the floor of ${CONNECTION_FLOOR}`);
      }
    }
    if (reasons.length) return { pass: false, reasons };
    return { pass: true, reasons: [`${checked} pick(s) at or above the connection floor of ${CONNECTION_FLOOR}`] };
  });
}

export const connectionFloor: TraceScorer = {
  kind: "trace",
  name: "connection-floor",
  description: `Every shown pick has connection of at least ${CONNECTION_FLOOR} at every dial setting.`,
  score: scoreConnectionFloor,
};
