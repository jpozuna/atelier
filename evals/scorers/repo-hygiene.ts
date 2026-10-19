// repo-hygiene: no Qloo response data and no secrets in tracked files (CLAUDE.md hard rule 3). Scans every file git
// tracks (and untracked files that are not ignored, which the next commit would track) and the lines added across
// git history. Fails on:
//   uuid          a UUID (dashed, or 32 hex characters without dashes) that is not the synthetic pattern
//                 00000000-0000-4000-8000-0000000000NN. Case-insensitive; a hyphen next to it does not hide it
//   tag-id        a urn:tag: id (also URL-encoded as urn%3Atag%3A) with a value part
//                 (urn:tag:<kind>:<namespace>:<value>) that is not synthetic or allowed
//   api-key       a hack_ key, an sk-ant- key, a JWT, or a non-placeholder value assigned to QLOO_API_KEY,
//                 ANTHROPIC_API_KEY or SUPABASE_SERVICE_ROLE_KEY (placeholders such as your-... pass), or a
//                 20+ character value after X-Api-Key
//   raw-json      a JSON file shaped like a Qloo response whose name, title or label values are not invented (or,
//                 outside evals/fixtures/, at all)
//   private-path  a tracked path under .qloo-private/ or a *.recording.json, or .qloo-private/ not ignored by git
//   image         a tracked png, jpg, jpeg, webp or gif outside an allow-listed prefix (screenshots of picks are banned)
// Files that cannot be scanned (binary, over 2 MB, unreadable) are listed as a WARNING note, which does not fail.
// Reasons name the file, line and rule only. They never print the matched value.

import type { RepoScorer, RepoSource, ScorerResult } from "../harness/types";

// Hex adjacency is kept (a longer hex run is a hash, not an id), but a hyphen next to the id does not hide it.
const UUID_RE = /(?<![0-9a-fA-F])[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?![0-9a-fA-F])/gi;
const DASHLESS_UUID_RE = /(?<![0-9a-fA-F])[0-9a-f]{32}(?![0-9a-fA-F])/gi;
const SYNTHETIC_UUID = /^00000000-0000-4000-8000-0000000000\d\d$/;
const SYNTHETIC_DASHLESS = /^000000000000400080000000000000\d\d$/;
const TAG_RE = /urn:tag:([A-Za-z0-9_.-]+):([A-Za-z0-9_.-]+):([A-Za-z0-9][^\s"'`<>,)\]}]*)/g;
const HACK_RE = /(?<![A-Za-z0-9])hack_[A-Za-z0-9_-]{8,}/i;
const ANTHROPIC_KEY_RE = /sk-ant-[A-Za-z0-9_-]{20,}/;
const JWT_RE = /eyJ[\w-]+\.eyJ[\w-]+\.[\w-]+/;
// Env-style assignment of a secret. Group 1 is the separator, group 2 an opening quote (if any), group 3 the value.
const SECRET_ASSIGN_RE = /(?:QLOO_API_KEY|ANTHROPIC_API_KEY|SUPABASE_SERVICE_ROLE_KEY)["']?\s*([:=])\s*(["'`]?)([^\s"'`,;)}\]]*)/g;
const HEADER_KEY_RE = /X-Api-Key["']?\s*[:=]\s*["']?([A-Za-z0-9_-]{20,})/gi;
const KEY_PLACEHOLDER = /^(your|synthetic|test|fixture|example|placeholder|changeme|x{3,}|\*{3,}|\.{3}|<|\$|process\.|env\.|import\.meta|undefined$|null$)/i;
const ENVELOPE_RE = /"(?:entity_id|tag_id|explainability)"\s*:|"results"\s*:\s*\{\s*"(?:entities|tags)"/;
const NAME_RE = /"(?:name|title|label)"\s*:\s*"([^"]*)"/g;
const IMAGE_RE = /\.(png|jpe?g|webp|gif)$/i;
const INVENTED_NAME = /\b(fixture|invented|synthetic)\b/i;

export const ALLOW_PATH = "evals/harness/hygiene-allow.txt";
export const FIXTURE_DIR = "evals/fixtures/";

export type Rule = "uuid" | "tag-id" | "api-key" | "raw-json" | "private-path" | "image";
export interface Finding {
  rule: Rule;
  /** 1-based line, or 0 for a whole-file finding. */
  line: number;
}

/** Allow-list entries `image:<path prefix>` let images under that prefix be tracked. Everything else is a tag id. */
export const IMAGE_ALLOW_PREFIX = "image:";

export function parseAllowList(text: string | null): Set<string> {
  const out = new Set<string>();
  for (const raw of (text ?? "").split("\n")) {
    const line = raw.trim();
    if (line && !line.startsWith("#")) out.add(line);
  }
  return out;
}

/** The rules that look at one line at a time. Used for files and for lines added in history. */
export function scanLine(rawText: string, allow: ReadonlySet<string>): Rule[] {
  const rules = new Set<Rule>();
  // URL-encoded colons (urn%3Atag%3A...) are decoded so an encoded tag id is still seen.
  const text = rawText.replace(/%3A/gi, ":");
  for (const m of text.matchAll(UUID_RE)) if (!SYNTHETIC_UUID.test(m[0])) rules.add("uuid");
  for (const m of text.matchAll(DASHLESS_UUID_RE)) if (!SYNTHETIC_DASHLESS.test(m[0])) rules.add("uuid");
  for (const m of text.matchAll(TAG_RE)) {
    const [, kind, ns, rawValue] = m;
    const value = rawValue.replace(/[.:;]+$/, "");
    const full = `urn:tag:${kind}:${ns}:${value}`;
    if (kind === "fixture" || ns === "fixture" || ns === "synthetic" || allow.has(full)) continue;
    rules.add("tag-id");
  }
  if (HACK_RE.test(text) || ANTHROPIC_KEY_RE.test(text) || JWT_RE.test(text)) rules.add("api-key");
  for (const m of text.matchAll(HEADER_KEY_RE)) if (!KEY_PLACEHOLDER.test(m[1])) rules.add("api-key");
  for (const m of text.matchAll(SECRET_ASSIGN_RE)) {
    const [, sep, quote, value] = m;
    if (!value || KEY_PLACEHOLDER.test(value)) continue;
    // `NAME: identifier` with no quote is a code expression (an object field, a type), not a literal secret.
    if (sep === ":" && !quote && !/^[A-Za-z0-9_-]{20,}$/.test(value)) continue;
    rules.add("api-key");
  }
  return [...rules];
}

export const isPrivatePath = (path: string) => path.startsWith(".qloo-private/") || path.endsWith(".recording.json");

/** Scan one file's text. Pure; no I/O. */
export function scanFile(path: string, text: string, allow: ReadonlySet<string>): Finding[] {
  const findings: Finding[] = [];
  if (isPrivatePath(path)) findings.push({ rule: "private-path", line: 0 });
  text.split("\n").forEach((line, i) => {
    for (const rule of scanLine(line, allow)) findings.push({ rule, line: i + 1 });
  });
  if (/\.jsonl?$/.test(path) && ENVELOPE_RE.test(text)) {
    if (!path.startsWith(FIXTURE_DIR)) {
      findings.push({ rule: "raw-json", line: 0 });
    } else {
      // Every name, title and label value must follow the invented-name convention.
      const names = [...text.matchAll(NAME_RE)].map((m) => m[1]).filter((n) => n !== "");
      if (names.some((n) => !INVENTED_NAME.test(n))) findings.push({ rule: "raw-json", line: 0 });
    }
  }
  return findings;
}

const MAX_REASONS = 20;

export function scoreRepoHygiene(source: RepoSource, opts: { allow?: ReadonlySet<string>; history?: boolean } = {}): ScorerResult {
  const allow = opts.allow ?? parseAllowList(source.read(ALLOW_PATH));
  const reasons: string[] = [];
  const files = source.listFiles();
  let scanned = 0;
  const skipped: string[] = [];
  const imageOk = (path: string) => [...allow].some((e) => e.startsWith(IMAGE_ALLOW_PREFIX) && path.startsWith(e.slice(IMAGE_ALLOW_PREFIX.length).trim()));

  for (const path of files) {
    if (isPrivatePath(path)) reasons.push(`${path}: private-path (recordings and spike output belong in .qloo-private/, untracked)`);
    const isImage = IMAGE_RE.test(path);
    if (isImage && !imageOk(path)) reasons.push(`${path}: image (screenshots can show Qloo picks; keep images out of the repo or allow-list the path as ${IMAGE_ALLOW_PREFIX}<prefix>)`);
    const text = source.read(path);
    if (text === null) {
      if (!isImage) skipped.push(path);
      continue;
    }
    scanned++;
    for (const f of scanFile(path, text, allow)) {
      if (f.rule === "private-path") continue; // reported above
      reasons.push(`${path}${f.line ? `:${f.line}` : ""}: ${f.rule}`);
    }
  }

  if (!source.isIgnored(".qloo-private/probe.json")) reasons.push(".qloo-private/ is not ignored by git (add it to .gitignore)");

  let historyLines = 0;
  if (opts.history !== false) {
    const added = source.historyAdded();
    if (added === null) {
      reasons.push("git history could not be read, so it was not checked");
    } else {
      const seen = new Set<string>();
      for (const a of added) {
        historyLines++;
        const rules: Rule[] = scanLine(a.line, allow);
        if (isPrivatePath(a.path)) rules.push("private-path");
        for (const rule of rules) {
          const key = `${a.commit}|${a.path}|${rule}`;
          if (seen.has(key)) continue;
          seen.add(key);
          reasons.push(`history ${a.commit} ${a.path}: ${rule}`);
        }
      }
    }
  }

  if (reasons.length) {
    const shown = reasons.slice(0, MAX_REASONS);
    if (reasons.length > MAX_REASONS) shown.push(`...and ${reasons.length - MAX_REASONS} more`);
    return { pass: false, reasons: shown };
  }
  const notes = [`${scanned} file(s) scanned${opts.history === false ? "" : `, ${historyLines} added history line(s) scanned`}`];
  if (skipped.length) {
    const shown = skipped.slice(0, 10).join(", ");
    notes.push(`WARNING: ${skipped.length} file(s) not scanned (binary, over 2 MB or unreadable): ${shown}${skipped.length > 10 ? ", ..." : ""}`);
  }
  return { pass: true, reasons: notes };
}

export const repoHygiene: RepoScorer = {
  kind: "repo",
  name: "repo-hygiene",
  description: "No non-synthetic UUIDs, tag ids with values, keys or raw Qloo JSON in tracked files or history; .qloo-private/ untracked.",
  score: (source) => scoreRepoHygiene(source),
};
