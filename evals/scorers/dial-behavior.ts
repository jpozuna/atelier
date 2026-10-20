// dial-behavior: for the same profile, the median popularity of Stretch picks is lower than that of Match picks (per
// domain, since popularity is ranked within one pool). Every insights call excludes all seeds and all picks already
// shown, and no seed or excluded id appears in the results. Which bands are Match and Stretch comes from the
// frontier's own `bandsForDial`, never copied here.
//
// Evidence, in order of strength:
//   result.audit   the seed ids and the exclude list actually sent per queried domain. Each domain that has picks must
//                  have been queried with an exclude list that covers every seed and every already-shown pick, and
//                  none of its picks may be in that list or be a seed. This is how exclusion is verified now.
//   trace          the insights params carry ids as counts ("[5 ids]"), so a call is checked by count (and against the
//                  audit list length when there is one), or id by id when it lists them. While the registry has not
//                  confirmed `filter.exclude.entities` for POST bodies the client refuses to send it, so a call
//                  without it is not a failure in that state; once confirmed, every insights call must send it.
//   result.seeds / result.exclude   extras a fixture may carry; they widen the forbidden set.
// With a result but no audit the exclusion evidence is "not verifiable" (a failure on a live case, a note on a
// synthetic legacy one), unless result.seeds and result.exclude let the results check run, which it then does.
//
// A domain with no Match picks or no Stretch picks with a known popularity (0 means unknown) has nothing to compare.
// A result-bearing case in which no domain could be compared fails: the check would otherwise pass on nothing.

import { median } from "@/lib/frontier/stats";
import { bandsForDial } from "@/lib/frontier/bands";
import { REGISTRY } from "@/lib/qloo/registry";
import type { CaseInput, ScorerResult, TraceScorer } from "../harness/types";
import { finish, isNum, isStr, nonEmpty, pickLabel, withResult } from "./_shared";

interface IdList {
  count: number;
  ids: string[] | null;
}

function idList(v: unknown): IdList | null {
  if (v === undefined || v === null) return null;
  if (Array.isArray(v)) return { count: v.length, ids: v.filter(isStr) };
  if (isStr(v)) {
    const m = /^\[(\d+) ids?\]$/.exec(v);
    if (m) return { count: Number(m[1]), ids: null };
    if (v === "[id]") return { count: 1, ids: null };
    const ids = v.split(",").map((s) => s.trim()).filter(Boolean);
    return { count: ids.length, ids };
  }
  return { count: 0, ids: [] };
}

export function scoreDialBehavior(input: CaseInput): ScorerResult {
  return withResult(input, (r) => {
    const reasons: string[] = [];
    const unverified: string[] = [];
    const match = new Set<string>(bandsForDial("match"));
    const stretch = new Set<string>(bandsForDial("stretch"));

    let compared = 0;
    for (const d of r.domains) {
      const known = (bands: Set<string>) => d.picks.filter((p) => isStr(p.band) && bands.has(p.band) && isNum(p.popularity) && p.popularity > 0).map((p) => p.popularity as number);
      const m = median(known(match));
      const s = median(known(stretch));
      if (m === null || s === null) continue;
      compared++;
      if (!(s < m)) reasons.push(`${d.domain}: median popularity of Stretch picks (${s.toFixed(2)}) is not below Match picks (${m.toFixed(2)})`);
    }
    if (compared === 0) reasons.push("no domain has both Match and Stretch picks with a known popularity, so the dial cannot be compared and this check would pass on nothing");

    const audit = r.audit;
    const gateOpen = (REGISTRY.post.confirmedBodyParams as readonly string[]).includes("filter.exclude.entities");
    const seedIds = new Set<string>([...(audit?.seedIds ?? []), ...(r.seeds ?? []).map((s) => s.qlooId).filter(nonEmpty)]);
    const shown = new Set(r.exclude);
    const haveSeeds = audit?.seedIds != null || r.seeds !== null;
    if (!audit) unverified.push("the result has no audit block, so the exclude list each domain was queried with is unknown");
    else if (audit.seedIds === null) unverified.push("the audit block lists no seedIds");

    // Audit: each domain with picks was queried with an exclude list covering every seed and shown pick.
    if (audit) {
      for (const d of r.domains) {
        if (d.picks.length === 0) continue;
        const sent = audit.exclude[d.domain];
        if (!sent) {
          reasons.push(`${d.domain}: has picks but the audit lists no exclude list for it`);
          continue;
        }
        const have = new Set(sent);
        const missingSeeds = [...seedIds].filter((id) => !have.has(id)).length;
        const missingShown = [...shown].filter((id) => !have.has(id)).length;
        if (missingSeeds > 0) reasons.push(`${d.domain}: the exclude list sent leaves out ${missingSeeds} seed(s)`);
        if (missingShown > 0) reasons.push(`${d.domain}: the exclude list sent leaves out ${missingShown} already shown pick(s)`);
      }
    }

    // Trace: counts (or ids) on each call.
    let calls = 0;
    for (const e of input.trace) {
      if (e.kind !== "query_insights") continue;
      calls++;
      const excluded = idList(e.params["filter.exclude.entities"]);
      const sentSeeds = idList(e.params["signal.interests.entities"]);
      const required = haveSeeds ? new Set([...seedIds, ...shown]) : null;
      const need = required ? required.size : (sentSeeds?.count ?? 0) + shown.size;
      if (excluded === null) {
        if (need > 0 && gateOpen) reasons.push(`${e.domain}: an insights call sends no filter.exclude.entities, so seeds and shown picks can come back`);
        continue;
      }
      const audited = audit?.exclude[e.domain];
      if (audited && excluded.count !== audited.length) reasons.push(`${e.domain}: the call excludes ${excluded.count} id(s) but the audit says ${audited.length} were sent`);
      if (excluded.ids && required) {
        const have = new Set(excluded.ids);
        const missing = [...required].filter((id) => !have.has(id)).length;
        if (missing > 0) reasons.push(`${e.domain}: an insights call leaves ${missing} seed(s) or shown pick(s) out of filter.exclude.entities`);
      } else if (excluded.count < need) {
        reasons.push(`${e.domain}: an insights call excludes ${excluded.count} id(s) but there are ${need} seed(s) and shown pick(s) to exclude`);
      }
    }

    // Results: nothing excluded comes back.
    for (const d of r.domains) {
      const forbidden = new Set([...seedIds, ...shown, ...(audit?.exclude[d.domain] ?? [])]);
      for (const p of d.picks) {
        if (isStr(p.qlooId) && forbidden.has(p.qlooId)) reasons.push(`${pickLabel(d.domain, p)}: a seed or an already shown pick appears in the results (an excluded id came back)`);
      }
    }

    const how = gateOpen ? "" : "; call-level exclusion is not required until the registry confirms filter.exclude.entities for POST bodies";
    // Without any seed list, the results check above had nothing to compare against.
    if (!haveSeeds && !audit) unverified.push("no seed list in the result, so a returned seed cannot be detected");
    return finish(input, reasons, unverified, `${compared} domain(s) compared (Stretch below Match), ${calls} insights call(s) checked for exclusions, no seed or excluded id returned${how}`);
  });
}

export const dialBehavior: TraceScorer = {
  kind: "trace",
  name: "dial-behavior",
  description: "Stretch picks are less popular than Match picks per domain; every domain is queried excluding all seeds and shown picks; none of them come back.",
  score: scoreDialBehavior,
};
