// Static checks on the files this ticket owns: no Qloo call, no service-role client, no key in client code.
// Qloo is reached only through POST /api/run (the follow-up); a saved pick opens from its stored row.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const OWNED = ["src/components/reactions", "src/app/(saved)", "src/app/api/reactions", "src/app/auth"];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

/** Comments may name a route or a key in words; only code counts. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const source = OWNED.flatMap((d) => files(join(ROOT, d)))
  .filter((p) => /\.(ts|tsx)$/.test(p) && !/\.test\.ts$/.test(p) && !p.endsWith("testing.ts"))
  .map((p) => ({ path: relative(ROOT, p), text: stripComments(readFileSync(p, "utf8")) }));

describe("owned files", () => {
  it("has files to check", () => {
    expect(source.length).toBeGreaterThan(20);
  });

  it("never reaches Qloo directly: no client, registry, host or key", () => {
    for (const f of source) {
      expect(f.text, f.path).not.toMatch(/@\/lib\/qloo|QLOO_|qloo\.com|X-Api-Key/i);
    }
  });

  it("never uses the service-role client or key: row-level security always applies", () => {
    for (const f of source) {
      expect(f.text, f.path).not.toMatch(/createServiceClient|SERVICE_ROLE/);
    }
  });

  it("puts no secret in client code or a NEXT_PUBLIC variable", () => {
    for (const f of source) {
      expect(f.text, f.path).not.toMatch(/process\.env\.NEXT_PUBLIC|ANTHROPIC|API_KEY/);
    }
  });

  it("keeps the components folder free of server-only modules", () => {
    for (const f of source.filter((s) => s.path.startsWith("src/components/reactions"))) {
      expect(f.text, f.path).not.toMatch(/@\/lib\/db\/(auth|server|saves)|from "server-only"|next\/headers/);
    }
  });

  it("calls the run route only from the follow-up", () => {
    const callers = source.filter((f) => /fetchRunSource|["'`]\/api\/run["'`]/.test(f.text)).map((f) => f.path);
    expect(callers).toEqual(["src/components/reactions/FollowUp.tsx"]);
  });
});
