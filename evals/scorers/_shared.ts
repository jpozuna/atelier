// Readers and helpers shared by the result-reading scorers in evals/scorers/. They are lenient on purpose: a
// malformed result becomes a reason, never an exception. Cases carry a server-side result (picks keep popularity,
// reach and connection; public results strip them, so scorers never read those).
//
// Result shape the scorers read (a RunResult from src/lib/agent/types.ts, plus optional extras fixtures may carry):
//   domains[]   { domain, status, thin, picks[], byBand? }   picks are full Pick objects with their Card
//   audit       RunAudit: { seedIds (Qloo entity ids), exclude per domain, tagRarity per domain }, server-side only
//   seeds[]     extra: the run's seeds (id, typed, status, qlooId, candidates?). A live RunResult has none.
//   exclude[]   extra: entity ids shown by earlier runs (RunInput.exclude)
//   tagRarity   legacy extra, superseded by audit.tagRarity
//
// Checks that need the audit block cannot run when it is absent. Such a check says "not verifiable". On a case
// marked `live` that is a failure (a broken live run must not pass because the evidence is missing). On a synthetic
// legacy case it passes with a note, so older fixtures keep working. See `finish`.

import type { CaseInput, ScorerResult } from "../harness/types";

export type Obj = Record<string, unknown>;
export const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
export const isStr = (v: unknown): v is string => typeof v === "string";
export const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
export const nonEmpty = (v: unknown): v is string => isStr(v) && v.trim().length > 0;
export const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
export const strs = (v: unknown): string[] => list(v).filter(nonEmpty);

/** Lower-case, punctuation to single spaces, for comparing names and labels. */
export const fold = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** True for a case recorded from a live run (`live: true` in cases.json). */
export const isLive = (input: CaseInput): boolean => (input as CaseInput & { live?: boolean }).live === true;

export interface ResultDomain {
  domain: string;
  status: string | undefined;
  thin: boolean;
  /** `picks` plus any pick that appears only under `byBand`, once each. */
  picks: Obj[];
}

export interface AuditView {
  /** Qloo entity ids of the seeds sent as signals. Null when the audit lacks the field. */
  seedIds: string[] | null;
  /** `filter.exclude.entities` per queried domain. */
  exclude: Record<string, string[]>;
  tagRarity: Record<string, Record<string, number>>;
}

export interface ResultView {
  seeds: Obj[] | null;
  exclude: string[];
  domains: ResultDomain[];
  /** Null when the result has no audit block. */
  audit: AuditView | null;
  /** Legacy `result.tagRarity`, per domain. */
  legacyTagRarity: Obj;
}

export const pickLabel = (domain: string, pick: Obj): string => `${domain}/${nonEmpty(pick.id) ? pick.id : nonEmpty(pick.qlooId) ? pick.qlooId : "unnamed pick"}`;

function readAudit(v: unknown): AuditView | null {
  if (!isObj(v)) return null;
  const exclude: Record<string, string[]> = {};
  if (isObj(v.exclude)) for (const [d, ids] of Object.entries(v.exclude)) exclude[d] = strs(ids);
  const tagRarity: Record<string, Record<string, number>> = {};
  if (isObj(v.tagRarity)) {
    for (const [d, map] of Object.entries(v.tagRarity)) {
      if (!isObj(map)) continue;
      const m: Record<string, number> = {};
      for (const [tagId, r] of Object.entries(map)) if (isNum(r)) m[tagId] = r;
      tagRarity[d] = m;
    }
  }
  return { seedIds: Array.isArray(v.seedIds) ? strs(v.seedIds) : null, exclude, tagRarity };
}

/** Read a case's result. Returns a reason string when the result is not usable at all. */
export function readResult(result: unknown): ResultView | string {
  if (!isObj(result) || !Array.isArray(result.domains)) return "the case result is not a run result (expected an object with a domains array)";
  const domains: ResultDomain[] = [];
  for (const raw of result.domains) {
    if (!isObj(raw) || !nonEmpty(raw.domain)) return "a result domain has no domain name";
    const picks: Obj[] = list(raw.picks).filter(isObj);
    const seen = new Set<Obj>(picks);
    const key = (p: Obj) => `${String(p.id)}|${String(p.qlooId)}`;
    const keys = new Set(picks.map(key));
    if (isObj(raw.byBand)) {
      for (const band of Object.values(raw.byBand)) {
        for (const p of list(band).filter(isObj)) {
          if (seen.has(p) || keys.has(key(p))) continue;
          picks.push(p);
          seen.add(p);
          keys.add(key(p));
        }
      }
    }
    domains.push({ domain: raw.domain, status: isStr(raw.status) ? raw.status : undefined, thin: raw.thin === true, picks });
  }
  return {
    // Synthetic fixtures list seeds at the top level; live results carry them in the server-side audit block.
    seeds: Array.isArray(result.seeds)
      ? result.seeds.filter(isObj)
      : isObj(result.audit) && Array.isArray(result.audit.seeds)
        ? result.audit.seeds.filter(isObj)
        : null,
    exclude: strs(result.exclude),
    domains,
    audit: readAudit(result.audit),
    legacyTagRarity: isObj(result.tagRarity) ? result.tagRarity : {},
  };
}

export const totalPicks = (r: ResultView): number => r.domains.reduce((n, d) => n + d.picks.length, 0);

/**
 * Run `check` on the case's result. A case with no result has nothing for a result scorer to read (the trace-only
 * cases are not run results), so it passes with a note saying so. A case WITH a result must hold at least one pick:
 * a result with none would pass every pick check by having nothing to check.
 */
export function withResult(input: CaseInput, check: (r: ResultView) => ScorerResult): ScorerResult {
  if (input.result === undefined) return { pass: true, reasons: ["no result in this case; nothing to check"] };
  const r = readResult(input.result);
  if (typeof r === "string") return { pass: false, reasons: [r] };
  if (totalPicks(r) === 0) return { pass: false, reasons: ["the result has no picks at all, so this check would pass on nothing"] };
  return check(r);
}

/**
 * Close a check. `unverified` lists evidence the case does not carry (for example no audit block). On a live case each
 * item fails as "not verifiable"; on a synthetic legacy case they only add a note to the pass.
 */
export function finish(input: CaseInput, reasons: string[], unverified: string[], okNote: string): ScorerResult {
  const out = [...reasons];
  if (isLive(input)) for (const u of unverified) out.push(`not verifiable: ${u}`);
  if (out.length) return { pass: false, reasons: out };
  return { pass: true, reasons: [unverified.length ? `${okNote}; not verifiable here (legacy synthetic case): ${unverified.join("; ")}` : okNote] };
}
