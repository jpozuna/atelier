// Aggregates the private run log into counts of kept versus set-aside picks per theme tag, axis, re-query reason, band and
// field, so tuning is based on evidence. Reads `.qloo-private/runlog/runs.jsonl` and `signals.jsonl` (the file store's
// output) and writes `.qloo-private/runlog/report.json` and `report.txt`, and nothing anywhere else. Makes no Qloo call
// and no model call: it only reads two local files.
//
//   node --experimental-strip-types scripts/runlog-report.ts --dry-run   say what it would read and write, write nothing
//   node --experimental-strip-types scripts/runlog-report.ts             write the report
//
// The report holds Qloo tag ids: it stays under `.qloo-private/` (gitignored). Never copy it to a tracked path. A log kept
// in Supabase is not read here; export it to the same two files first (also under `.qloo-private/runlog/`).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const dir = resolve(process.cwd(), ".qloo-private", "runlog");
const dryRun = process.argv.includes("--dry-run");
const unknown = process.argv.slice(2).filter((a) => a !== "--dry-run");
if (unknown.length > 0) {
  console.error(`unknown argument(s): ${unknown.join(" ")} (only --dry-run)`);
  process.exit(2);
}

function readLines(file: string): unknown[] {
  if (!existsSync(file)) return [];
  const rows: unknown[] = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      // a torn or hand-edited line is skipped
    }
  }
  return rows;
}

const runsFile = join(dir, "runs.jsonl");
const signalsFile = join(dir, "signals.jsonl");
const runs = readLines(runsFile) as Array<{ id: string }>;
const rawSignals = readLines(signalsFile) as Array<{ runId: string; pickId: string; signal: string; userId: string | null }>;

// The file store appends, and the last line per (run, pick, signal, user) wins.
const latest = new Map<string, (typeof rawSignals)[number]>();
for (const s of rawSignals) {
  const key = JSON.stringify([s.runId, s.pickId, s.signal, s.userId]);
  latest.delete(key);
  latest.set(key, s);
}
const signals = [...latest.values()];

console.log(`read ${runs.length} run(s) from ${runsFile} and ${signals.length} signal(s) from ${signalsFile}`);
console.log(`would write ${join(dir, "report.json")} and ${join(dir, "report.txt")}`);
console.log("Qloo calls: 0 (reads two local files)");

if (dryRun) {
  console.log("--dry-run: nothing written");
} else {
  // Loaded by file URL at run time so plain Node can read the TypeScript module (no alias, no extension rewrite).
  const mod = (await import(new URL("../src/lib/learn/report.ts", import.meta.url).href)) as typeof import("../src/lib/learn/report");
  const report = mod.buildReport(runs as never, signals as never);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  writeFileSync(join(dir, "report.txt"), `${mod.formatReport(report)}\n`, "utf8");
  console.log(`wrote report.json and report.txt in ${dir}`);
}
