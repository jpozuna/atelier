// Building the POST /api/run request. Pure: no fetch here, so the shape is testable.
//
// Request (T-10): { seeds, profile, axes, exclude?, plan? }. The profile is passed in, so the run makes no profile
// call. `plan` is whatever an earlier result returned, sent back unchanged so a repeat replays the same Qloo
// requests from the server's cache (0 live calls). `exclude` is a list of entity ids already shown.
//
// `domains` limits a run to those fields: the route runs pools, re-queries and cards for them only, applies
// `exclude` to their pools only, and returns only them. A "not me" re-run sends it. The screen merges those fields
// into what it already has (`mergeRerun`) and keeps every other field as it was.
//
// `notMe` (T-27) is the entity ids the person has just set aside, a subset of `exclude`. The run ignores it: only
// the private run log reads it, to record exactly which picks were "not me" (and not merely shown).

import { FIELDS } from "@/types";
import type { Field } from "@/types";
import { RUN_MAX_EXCLUDE } from "@/lib/agent/config";
import { RUN_URL } from "./constants";
import type { PublicRunResult, RunInputs, RunPlan } from "./types";

export interface RunBody {
  seeds: RunInputs["seeds"];
  profile: RunInputs["profile"];
  axes: RunInputs["axes"];
  exclude?: string[];
  /** Entity ids newly set aside, a subset of `exclude`. Read only by the run log. */
  notMe?: string[];
  plan?: RunPlan;
  domains?: Field[];
}

export interface RunRequest {
  url: string;
  init: { method: "POST"; headers: Record<string, string>; body: string };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface RunOptions {
  exclude?: readonly string[];
  notMe?: readonly string[];
  plan?: RunPlan;
  domains?: readonly Field[];
}

/** Entity ids as the route wants them: UUIDs only, no repeats, at most RUN_MAX_EXCLUDE (the newest win). */
export function cleanExclude(ids: readonly string[]): string[] {
  const unique = [...new Set(ids.filter((id) => UUID.test(id)))];
  return unique.slice(-RUN_MAX_EXCLUDE);
}

export function buildRunBody(inputs: RunInputs, opts: RunOptions = {}): RunBody {
  const body: RunBody = { seeds: inputs.seeds, profile: inputs.profile, axes: inputs.axes };
  const exclude = cleanExclude(opts.exclude ?? []);
  if (exclude.length > 0) body.exclude = exclude;
  // Only ids that are really being excluded can be "not me": a subset, by construction.
  const notMe = cleanExclude(opts.notMe ?? []).filter((id) => exclude.includes(id));
  if (notMe.length > 0) body.notMe = notMe;
  if (opts.plan) body.plan = opts.plan;
  const domains = FIELDS.filter((f) => opts.domains?.includes(f));
  if (domains.length > 0) body.domains = domains;
  return body;
}

export function buildRunRequest(inputs: RunInputs, opts: RunOptions = {}, url: string = RUN_URL): RunRequest {
  return {
    url,
    init: { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(buildRunBody(inputs, opts)) },
  };
}

/**
 * What a "not me" re-run excludes: everything the person has set aside, plus every pick already shown in the
 * affected fields, so the replacement is new.
 */
export function rerunExclude(result: PublicRunResult | null, affected: readonly Field[], notMe: readonly string[]): string[] {
  const shown = (result?.domains ?? []).filter((d) => affected.includes(d.domain)).flatMap((d) => d.picks.map((p) => p.qlooId));
  return cleanExclude([...shown, ...notMe]);
}

/**
 * The body of a "not me" re-run: only the affected fields, everything shown there plus everything set aside as
 * `exclude`, the earlier plan, and `notMe` with the id set aside just now so the run log records exactly which pick
 * was "not me" (T-27). `asideAfter` is the full set-aside list including `pick`.
 */
export function notMeRerunBody(inputs: RunInputs, result: PublicRunResult | null, pick: { qlooId: string }, fields: readonly Field[], asideAfter: readonly string[]): RunBody {
  return buildRunBody(inputs, { exclude: rerunExclude(result, fields, asideAfter), notMe: [pick.qlooId], plan: result?.plan, domains: fields });
}
