import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { scanDirs, scanText, secretsFromEnv } from "./bundle-scan";

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (role: string) => `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ iss: "supabase", role })}.${"s".repeat(20)}`;

describe("scanText", () => {
  it("passes ordinary client code", () => {
    expect(scanText('fetch("/api/run",{method:"POST"});const a="NEXT_PUBLIC_SUPABASE_URL";')).toEqual([]);
  });
  it("flags server-only names and hosts, without echoing text", () => {
    const rules = scanText("process.env.QLOO_API_KEY; fetch('https://hackathon.api.qloo.com/search',{headers:{'X-Api-Key':k}})");
    expect(rules).toEqual(expect.arrayContaining(["forbidden-string:QLOO_API_KEY", "forbidden-string:x-api-key", "forbidden-string:hackathon.api.qloo.com"]));
  });
  it("flags a service-role JWT but not an anon JWT", () => {
    expect(scanText(`k="${jwt("service_role")}"`)).toContain("service-role-jwt");
    expect(scanText(`k="${jwt("anon")}"`)).toEqual([]);
  });
  it("flags key shapes", () => {
    expect(scanText(`k="sk-ant-${"a".repeat(30)}"`)).toContain("anthropic-key-shape");
    expect(scanText(`k="sb_secret_${"a".repeat(20)}"`)).toContain("supabase-secret-key-shape");
  });
  it("flags a secret value, ignores unset and short values", () => {
    const secret = "synthetic-secret-value-0001";
    expect(scanText(`x="${secret}"`, { QLOO_API_KEY: secret })).toContain("secret-value:QLOO_API_KEY");
    expect(scanText(`x="${secret}"`, { QLOO_API_KEY: undefined })).toEqual([]);
    expect(scanText("x=abc", { QLOO_API_KEY: "abc" })).toEqual([]);
  });
});

describe("scanDirs", () => {
  it("finds a planted secret in a synthetic build directory and skips missing directories", () => {
    const root = mkdtempSync(join(tmpdir(), "atelier-scan-"));
    mkdirSync(join(root, "static", "chunks"), { recursive: true });
    writeFileSync(join(root, "static", "chunks", "ok.js"), "console.log('hello')");
    writeFileSync(join(root, "static", "chunks", "bad.js"), "const k='ANTHROPIC_API_KEY'");
    const findings = scanDirs([join(root, "static"), join(root, "missing")]);
    expect(findings).toHaveLength(1);
    expect(findings[0].file.endsWith("bad.js")).toBe(true);
    expect(JSON.stringify(findings)).not.toContain("hello");
  });
});

// The check that matters: what `next build` put where a browser can fetch it. Skipped when there is no build
// (run `npm run build` first). To also check the real secret VALUES, run with the env loaded, for example
// `node --env-file=.env node_modules/vitest/vitest.mjs run src/lib/guard/bundle-scan.test.ts` (values are compared in
// memory and never printed).
const NEXT = join(process.cwd(), ".next");
const hasBuild = existsSync(join(NEXT, "BUILD_ID")) && existsSync(join(NEXT, "static"));

function htmlAndRscDirs(): string[] {
  // Prerendered pages and their RSC payloads are served to browsers too. Server chunks are not.
  const app = join(NEXT, "server", "app");
  return existsSync(app) ? [app] : [];
}

describe.skipIf(!hasBuild)("production build output", () => {
  it("keeps server secrets out of .next/static and prerendered pages", () => {
    const findings = scanDirs([join(NEXT, "static"), ...htmlAndRscDirs()].filter((d) => existsSync(d)), secretsFromEnv(process.env));
    expect(findings).toEqual([]);
  });
});

// Source rule behind the build check: no secret is ever exposed through a NEXT_PUBLIC_ variable.
const SRC = join(process.cwd(), "src");
const GUARD_DIR = join(SRC, "lib", "guard");
const PUBLIC_SECRET = new RegExp(["NEXT_PUBLIC_[A-Z_]*(?:", "QLOO", "|", "ANTHROPIC", "|", "SERVICE_ROLE", "|", "SECRET", ")"].join(""));

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (full === GUARD_DIR) continue;
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.(?:ts|tsx|js|mjs)$/.test(name)) out.push(full);
  }
  return out;
}

describe("source", () => {
  it("never reads a secret through a NEXT_PUBLIC_ variable", () => {
    const offenders = sourceFiles(SRC).filter((f) => PUBLIC_SECRET.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});
