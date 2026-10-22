// Static checks on supabase/migrations/20261022000000_run_log.sql. There is no database in CI, so this reads the SQL as
// text: run_log and run_signal must be locked to the service role, like qloo_cache.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RUN_SIGNALS, SIGNAL_SOURCES } from "./types";

const FILE = join(__dirname, "..", "..", "..", "supabase", "migrations", "20261022000000_run_log.sql");
const raw = readFileSync(FILE, "utf8");
const sql = raw.replace(/--[^\n]*/g, "").replace(/\s+/g, " ").toLowerCase();
const statements = sql.split(";").map((s) => s.trim()).filter(Boolean);

const listIn = (re: RegExp): string[] => {
  const m = raw.match(re);
  if (!m) throw new Error(`pattern not found: ${re}`);
  return [...m[1]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!);
};

describe("run log migration", () => {
  it("creates run_log and run_signal and enables RLS on both", () => {
    for (const t of ["run_log", "run_signal"]) {
      expect(sql).toContain(`create table public.${t} (`);
      expect(sql).toContain(`alter table public.${t} enable row level security`);
    }
  });

  it("has no policy at all, so no anon or authenticated role can read or write", () => {
    expect(statements.filter((s) => s.startsWith("create policy"))).toEqual([]);
  });

  it("revokes every grant from public, anon and authenticated, and grants only the service role", () => {
    expect(sql).toContain("revoke all on public.run_log, public.run_signal from public, anon, authenticated");
    const grants = statements.filter((s) => s.startsWith("grant "));
    expect(grants.length).toBeGreaterThan(0);
    for (const g of grants) expect(g, g).toMatch(/ to service_role$/);
  });

  it("limits the purge function to the service role and pins its search_path", () => {
    expect(sql).toContain("revoke all on function public.purge_run_log(timestamptz) from public, anon, authenticated");
    expect(sql).toContain("grant execute on function public.purge_run_log(timestamptz) to service_role");
    const fn = raw.match(/create function public\.purge_run_log[\s\S]*?\$\$;/)?.[0] ?? "";
    expect(fn).toContain("set search_path = ''");
    expect(fn).toContain("public.run_log");
  });

  it("stores the unredacted trace, the plan, the profile hash and parallel kept lists", () => {
    const body = statements.find((s) => s.startsWith("create table public.run_log ")) ?? "";
    for (const col of ["profile_hash text not null", "user_id uuid", "trace jsonb not null", "plan jsonb", "kept_pick_ids text[]", "kept_entity_ids text[]"]) {
      expect(body, col).toContain(col);
    }
    expect(body).toContain("cardinality(kept_pick_ids) = cardinality(kept_entity_ids)");
  });

  it("deletes signals with their run and with their person", () => {
    expect(sql).toMatch(/run_id uuid not null references public\.run_log \(id\) on delete cascade/);
    expect(sql).toMatch(/user_id uuid references public\.profiles \(id\) on delete cascade/);
  });

  it("keeps the signal and source lists in step with the types", () => {
    expect(listIn(/signal in \(([^)]*)\)/)).toEqual([...RUN_SIGNALS]);
    expect(listIn(/source in \(([^)]*)\)/)).toEqual([...SIGNAL_SOURCES]);
  });

  it("never mentions the legacy recommendation endpoints", () => {
    expect(sql).not.toMatch(/\/recommendations|\/recs/);
  });
});
