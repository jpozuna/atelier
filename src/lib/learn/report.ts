// The run-log report: which reasoning moves led to picks the person kept and which led to "not me". Pure counting over
// stored runs and signals; no I/O, no Qloo call, no model call. Plain counts only: no share, no score, no ranking.
//
// A pick is KEPT when the person's latest stance on it is a save (saved_explore, saved_later, saved_try), SET ASIDE when
// it is not_me or not_interested, otherwise only SHOWN. `tried` says nothing about liking and is skipped. A not_me from
// a re-run's `exclude` list (source "exclude") is inferred, since that list also holds picks that were only shown: it
// never sets a stance (it cannot overwrite a save) and is counted apart as `shownAgain`, a pick that came back in a
// re-run's exclude list.
//
// Moves are read from `trace.audit.picks` of each stored run (written by pickRecordsOf): the pick's theme tags, the axis
// that led its field, the re-query reason behind its pool and its band. A run logged before that has none; its picks
// count under `unrecorded` only.
//
// Self-contained on purpose (only erased type imports), so scripts/runlog-report.ts can load it with plain Node. The
// report holds Qloo tag ids and so belongs under .qloo-private/ only.

export interface ReportRun {
  id: string;
  outcome?: string;
  keptPickIds?: string[];
  trace?: { audit?: unknown };
}

export interface ReportSignal {
  runId: string;
  pickId: string;
  signal: string;
  source?: string;
  createdAt?: string;
}

export interface MoveCounts {
  /** Picks shown with this move. */
  shown: number;
  /** Of those, kept (saved). */
  kept: number;
  /** Of those, set aside by the person (exact). */
  setAside: number;
  /** Of those, listed in a re-run's exclude list (inferred, not a stance). Can overlap kept or setAside. */
  shownAgain: number;
}

export interface Report {
  runs: { total: number; ok: number; failed: number; withPickRecords: number; thatLearned: number };
  picks: MoveCounts & { unrecorded: number };
  byTheme: Record<string, MoveCounts>;
  byAxis: Record<string, MoveCounts>;
  /** Re-query reason of the pick's field, or "none". */
  byRequery: Record<string, MoveCounts>;
  byBand: Record<string, MoveCounts>;
  byField: Record<string, MoveCounts>;
}

const SAVED = ["saved_explore", "saved_later", "saved_try"];
const TURNED_DOWN = ["not_me", "not_interested"];

type Stance = "kept" | "setAside";

interface Rec {
  pickId: string;
  domain: string;
  band: string;
  themeTags: string[];
  axisId: string | null;
  requeryReason: string | null;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

function recordsOf(audit: unknown): Rec[] | null {
  if (!isObj(audit) || !Array.isArray(audit.picks)) return null;
  const out: Rec[] = [];
  for (const p of audit.picks) {
    if (!isObj(p)) continue;
    const pickId = str(p.pickId);
    if (!pickId) continue;
    out.push({
      pickId,
      domain: str(p.domain) ?? "unknown",
      band: str(p.band) ?? "unknown",
      themeTags: Array.isArray(p.themeTags) ? p.themeTags.filter((t): t is string => typeof t === "string") : [],
      axisId: str(p.axisId),
      requeryReason: str(p.requeryReason),
    });
  }
  return out;
}

const zero = (): MoveCounts => ({ shown: 0, kept: 0, setAside: 0, shownAgain: 0 });

function bump(map: Record<string, MoveCounts>, key: string, stance: Stance | null, again: boolean): void {
  const c = (map[key] ??= zero());
  c.shown += 1;
  if (stance) c[stance] += 1;
  if (again) c.shownAgain += 1;
}

const sorted = (m: Record<string, MoveCounts>): Record<string, MoveCounts> => Object.fromEntries(Object.entries(m).sort((a, b) => b[1].shown - a[1].shown || (a[0] < b[0] ? -1 : 1)));

const time = (iso: string | undefined): number => {
  const t = Date.parse(iso ?? "");
  return Number.isFinite(t) ? t : 0;
};

/** The latest exact stance per (run, pick), and the picks an exclude-source signal names. Signals in any order (ties: file order). */
function stances(signals: readonly ReportSignal[]): { stance: Map<string, Stance>; again: Set<string> } {
  const ordered = signals.map((s, i) => ({ s, i })).sort((a, b) => time(a.s.createdAt) - time(b.s.createdAt) || a.i - b.i);
  const stance = new Map<string, Stance>();
  const again = new Set<string>();
  for (const { s } of ordered) {
    const key = `${s.runId}\u0000${s.pickId}`;
    if (s.source === "exclude") {
      if (TURNED_DOWN.includes(s.signal)) again.add(key);
      continue;
    }
    if (SAVED.includes(s.signal)) stance.set(key, "kept");
    else if (TURNED_DOWN.includes(s.signal)) stance.set(key, "setAside");
  }
  return { stance, again };
}

export function buildReport(runs: readonly ReportRun[], signals: readonly ReportSignal[]): Report {
  const { stance, again } = stances(signals);
  const report: Report = {
    runs: { total: runs.length, ok: 0, failed: 0, withPickRecords: 0, thatLearned: 0 },
    picks: { ...zero(), unrecorded: 0 },
    byTheme: {},
    byAxis: {},
    byRequery: {},
    byBand: {},
    byField: {},
  };
  for (const run of runs) {
    if (run.outcome === "failed") report.runs.failed += 1;
    else report.runs.ok += 1;
    const audit = run.trace?.audit;
    if (isObj(audit) && isObj(audit.learned)) report.runs.thatLearned += 1;
    const recs = recordsOf(audit);
    if (!recs) {
      report.picks.unrecorded += (run.keptPickIds ?? []).length;
      continue;
    }
    report.runs.withPickRecords += 1;
    for (const r of recs) {
      const key = `${run.id}\u0000${r.pickId}`;
      const st = stance.get(key) ?? null;
      const back = again.has(key);
      report.picks.shown += 1;
      if (st) report.picks[st] += 1;
      if (back) report.picks.shownAgain += 1;
      for (const t of r.themeTags) bump(report.byTheme, t, st, back);
      bump(report.byAxis, r.axisId ?? "none", st, back);
      bump(report.byRequery, r.requeryReason ?? "none", st, back);
      bump(report.byBand, r.band, st, back);
      bump(report.byField, r.domain, st, back);
    }
  }
  return { ...report, byTheme: sorted(report.byTheme), byAxis: sorted(report.byAxis), byRequery: sorted(report.byRequery), byBand: sorted(report.byBand), byField: sorted(report.byField) };
}

function table(title: string, m: Record<string, MoveCounts>): string[] {
  const rows = Object.entries(m);
  if (rows.length === 0) return [`${title}: nothing recorded`, ""];
  const w = Math.max(...rows.map(([k]) => k.length), 4);
  return [title, `  ${"move".padEnd(w)}  shown  kept  set-aside  shown-again`, ...rows.map(([k, c]) => `  ${k.padEnd(w)}  ${String(c.shown).padStart(5)}  ${String(c.kept).padStart(4)}  ${String(c.setAside).padStart(9)}  ${String(c.shownAgain).padStart(11)}`), ""];
}

/** The report as plain text for a terminal. */
export function formatReport(r: Report): string {
  return [
    `runs: ${r.runs.total} (${r.runs.ok} finished, ${r.runs.failed} failed); ${r.runs.withPickRecords} with pick records; ${r.runs.thatLearned} learned from earlier signals`,
    `picks shown: ${r.picks.shown}; kept ${r.picks.kept}; set aside ${r.picks.setAside}; shown again ${r.picks.shownAgain}; in runs without pick records ${r.picks.unrecorded}`,
    "",
    ...table("by band", r.byBand),
    ...table("by field", r.byField),
    ...table("by re-query reason", r.byRequery),
    ...table("by axis", r.byAxis),
    ...table("by theme tag", r.byTheme),
  ].join("\n");
}
