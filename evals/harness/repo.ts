// The real RepoSource: reads the working tree and git history with read-only git commands. It lists tracked files
// plus untracked files that are not ignored (a new file becomes tracked at the next commit, so it is scanned now).

import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { RepoSource } from "./types";

const MAX_FILE_BYTES = 2_000_000;

function git(root: string, args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
}

export function repoRoot(cwd = process.cwd()): string {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8" }).trim();
}

export function gitRepoSource(root = repoRoot()): RepoSource {
  return {
    listFiles() {
      return git(root, ["ls-files", "--cached", "--others", "--exclude-standard", "-z"])
        .split("\0")
        .filter(Boolean)
        .sort();
    },
    read(path) {
      try {
        const abs = join(root, path);
        if (statSync(abs).size > MAX_FILE_BYTES) return null;
        const buf = readFileSync(abs);
        if (buf.includes(0)) return null;
        return buf.toString("utf8");
      } catch {
        return null;
      }
    },
    historyAdded() {
      const r = spawnSync("git", ["log", "--all", "-p", "-U0", "--no-color", "--no-ext-diff", "--format=@@@%h"], {
        cwd: root,
        encoding: "utf8",
        maxBuffer: 1024 * 1024 * 1024,
      });
      if (r.status !== 0 || typeof r.stdout !== "string") return null;
      const out: { path: string; commit: string; line: string }[] = [];
      let commit = "";
      let path = "";
      for (const line of r.stdout.split("\n")) {
        if (line.startsWith("@@@")) commit = line.slice(3);
        else if (line.startsWith("diff --git ")) path = line.slice(line.lastIndexOf(" b/") + 3);
        else if (line.startsWith("+") && !line.startsWith("+++")) out.push({ path, commit, line: line.slice(1) });
      }
      return out;
    },
    isIgnored(path) {
      return spawnSync("git", ["check-ignore", "-q", path], { cwd: root }).status === 0;
    },
  };
}
