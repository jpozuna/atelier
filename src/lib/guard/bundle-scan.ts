// Checks that no server secret reached anything a browser can fetch. Used by bundle-scan.test.ts against `.next/`
// after a build. Node only; no app code imports it.
//
// It looks for (1) the names of server-only variables and the Qloo and Anthropic hosts, which only server code mentions,
// (2) key shapes (Anthropic keys, Supabase secret keys, a JWT whose role is service_role), and (3) the actual values of
// the secrets, when the caller passes them. A finding names the file and the rule, never the matched text.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** Strings that mean server-only code was bundled for the browser. Compared case-insensitively. */
export const FORBIDDEN_STRINGS: readonly string[] = [
  "QLOO_API_KEY",
  "QLOO_BASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "ANTHROPIC_API_KEY",
  "x-api-key",
  "hackathon.api.qloo.com",
  "api.anthropic.com",
];

/** Server-side variables whose VALUES must never appear (checked only when set and long enough to be meaningful). */
export const SECRET_ENV_NAMES: readonly string[] = ["QLOO_API_KEY", "SUPABASE_SERVICE_ROLE_KEY", "ANTHROPIC_API_KEY"];

const MIN_SECRET_CHARS = 12;
const MAX_FILE_BYTES = 25_000_000;
const SCANNED_EXT = /\.(?:js|mjs|cjs|css|html|rsc|json|txt|map|meta)$/;

const KEY_SHAPES: readonly { rule: string; re: RegExp }[] = [
  { rule: "anthropic-key-shape", re: /sk-ant-[A-Za-z0-9_-]{20,}/ },
  { rule: "supabase-secret-key-shape", re: /sb_secret_[A-Za-z0-9_-]{10,}/ },
];
const JWT = /eyJ[A-Za-z0-9_-]{8,}\.(eyJ[A-Za-z0-9_-]{8,})\.[A-Za-z0-9_-]{8,}/g;

export interface Finding {
  file: string;
  rule: string;
}

function walk(dir: string, out: string[]): void {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(full, out);
    else if (st.size <= MAX_FILE_BYTES && SCANNED_EXT.test(name)) out.push(full);
  }
}

function jwtRole(payloadB64: string): string | undefined {
  try {
    const parsed = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as { role?: unknown };
    return typeof parsed.role === "string" ? parsed.role : undefined;
  } catch {
    return undefined;
  }
}

/** Findings for one file's text. `secrets` maps a variable name to its value; unset or short values are skipped. */
export function scanText(text: string, secrets: Record<string, string | undefined> = {}): string[] {
  const rules: string[] = [];
  const lower = text.toLowerCase();
  for (const s of FORBIDDEN_STRINGS) if (lower.includes(s.toLowerCase())) rules.push(`forbidden-string:${s}`);
  for (const { rule, re } of KEY_SHAPES) if (re.test(text)) rules.push(rule);
  for (const m of text.matchAll(JWT)) if (jwtRole(m[1]) === "service_role") rules.push("service-role-jwt");
  for (const [name, value] of Object.entries(secrets)) {
    if (value && value.length >= MIN_SECRET_CHARS && text.includes(value)) rules.push(`secret-value:${name}`);
  }
  return [...new Set(rules)];
}

/** Scan every text file under the given directories. Missing directories are skipped. */
export function scanDirs(dirs: readonly string[], secrets: Record<string, string | undefined> = {}): Finding[] {
  const files: string[] = [];
  for (const d of dirs) walk(d, files);
  const findings: Finding[] = [];
  for (const file of files) {
    for (const rule of scanText(readFileSync(file, "utf8"), secrets)) findings.push({ file, rule });
  }
  return findings;
}

/** The secrets in the current environment, by name. */
export function secretsFromEnv(env: Record<string, string | undefined>): Record<string, string | undefined> {
  return Object.fromEntries(SECRET_ENV_NAMES.map((n) => [n, env[n]]));
}
