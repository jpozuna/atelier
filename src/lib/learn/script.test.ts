// scripts/runlog-report.ts on synthetic files in a temporary directory: --dry-run writes nothing, a real run writes
// only report.json and report.txt under .qloo-private/runlog/ of its working directory, and neither makes a Qloo call.

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const script = resolve(__dirname, "../../../scripts/runlog-report.ts");
const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

function work(): { cwd: string; log: string } {
  const cwd = mkdtempSync(join(tmpdir(), "atelier-report-"));
  dirs.push(cwd);
  const log = join(cwd, ".qloo-private", "runlog");
  mkdirSync(log, { recursive: true });
  const picks = [{ pickId: "p1", domain: "film", band: "high", themeTags: ["t1"], axisId: "axis-a", requeryReason: null }, { pickId: "p2", domain: "music", band: "extreme", themeTags: ["t1"], axisId: "axis-b", requeryReason: "too_weak" }];
  writeFileSync(join(log, "runs.jsonl"), `${JSON.stringify({ id: "r1", outcome: "ok", keptPickIds: ["p1", "p2"], trace: { audit: { picks } } })}\nnot json\n`);
  const sig = (pickId: string, signal: string, why: string | null) => JSON.stringify({ runId: "r1", pickId, signal, source: "reaction", userId: "u", why, createdAt: "2026-10-22T10:00:00.000Z" });
  writeFileSync(join(log, "signals.jsonl"), [sig("p1", "saved_later", null), sig("p2", "saved_later", null), sig("p2", "not_interested", "words")].join("\n") + "\n");
  return { cwd, log };
}

const run = (cwd: string, ...args: string[]) => spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", script, ...args], { cwd, encoding: "utf8", env: { ...process.env } });

describe("scripts/runlog-report.ts", () => {
  it("--dry-run says what it would do and writes nothing", () => {
    const { cwd, log } = work();
    const before = readdirSync(log).sort();
    const out = run(cwd, "--dry-run");
    expect(out.status, out.stderr).toBe(0);
    expect(out.stdout).toContain("read 1 run(s)");
    expect(out.stdout).toContain("3 signal(s)");
    expect(out.stdout).toContain("Qloo calls: 0");
    expect(out.stdout).toContain("nothing written");
    expect(readdirSync(log).sort()).toEqual(before);
  });

  it("writes only the two report files, under .qloo-private/runlog/", () => {
    const { cwd, log } = work();
    const out = run(cwd);
    expect(out.status, out.stderr).toBe(0);
    expect(readdirSync(log).sort()).toEqual(["report.json", "report.txt", "runs.jsonl", "signals.jsonl"]);
    expect(readdirSync(cwd).sort()).toEqual([".qloo-private"]);
    const report = JSON.parse(readFileSync(join(log, "report.json"), "utf8"));
    expect(report.picks).toMatchObject({ shown: 2, kept: 1, setAside: 1 });
    expect(report.byTheme.t1).toEqual({ shown: 2, kept: 1, setAside: 1, shownAgain: 0 });
    expect(readFileSync(join(log, "report.txt"), "utf8")).toContain("by theme tag");
  });

  it("works with no log yet, and refuses an unknown argument", () => {
    const cwd = mkdtempSync(join(tmpdir(), "atelier-report-"));
    dirs.push(cwd);
    expect(run(cwd, "--dry-run").stdout).toContain("read 0 run(s)");
    expect(run(cwd, "--out", "x").status).toBe(2);
  });
});
