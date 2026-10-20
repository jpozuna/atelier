// Static checks on supabase/migrations/*.sql. There is no database in CI, so these read the SQL as text: they
// catch a table without RLS, a policy open to anon, a qloo_cache grant, or a value list that drifted from
// src/types. They do not prove the SQL applies; `supabase db reset` does, and rls.live.test.ts proves the policies.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BANDS, FIELDS, ORIGINS, QLOO_ENDPOINTS, REACTION_STATES, SEED_STATUSES } from "@/types";
import { CACHE_TABLE, REACTION_HOWS, USER_TABLES } from "./constants";

const ROOT = join(__dirname, "..", "..", "..", "supabase");
const MIGRATIONS = join(ROOT, "migrations");

const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
const raw = files.map((f) => readFileSync(join(MIGRATIONS, f), "utf8")).join("\n");
// Comments removed, whitespace collapsed, lower-cased: the checks below match statements, not formatting.
const sql = raw
  .replace(/--[^\n]*/g, "")
  .replace(/\s+/g, " ")
  .toLowerCase();
const statements = sql.split(";").map((s) => s.trim()).filter(Boolean);

const tables = [...sql.matchAll(/create table public\.(\w+)/g)].map((m) => m[1]);
const policies = statements
  .filter((s) => s.startsWith("create policy"))
  .map((s) => {
    const m = s.match(/^create policy (\w+) on public\.(\w+) for (\w+) to ([\w, ]+?) (?:using|with check) /);
    return { text: s, name: m?.[1], table: m?.[2], command: m?.[3], roles: m?.[4] };
  });

const listIn = (re: RegExp): string[] => {
  const m = raw.match(re);
  if (!m) throw new Error(`pattern not found: ${re}`);
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
};

describe("migration files", () => {
  it("exist and are named by timestamp", () => {
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) expect(f).toMatch(/^\d{14}_[a-z0-9_]+\.sql$/);
  });

  it("create exactly the six tables", () => {
    expect(tables.sort()).toEqual([CACHE_TABLE, ...USER_TABLES].sort());
  });

  it("enable RLS on every table", () => {
    for (const t of tables) expect(sql, t).toContain(`alter table public.${t} enable row level security`);
  });

  it("parse every policy (so the checks below are not vacuous)", () => {
    expect(policies.length).toBeGreaterThan(0);
    for (const p of policies) expect(p.name && p.table && p.command && p.roles, p.text).toBeTruthy();
  });

  it("give user tables owner-only policies for authenticated users", () => {
    for (const t of USER_TABLES) {
      const own = policies.filter((p) => p.table === t);
      expect(own.map((p) => p.command), t).toContain("select");
      expect(own.map((p) => p.command), t).toContain("insert");
      expect(own.map((p) => p.command), t).toContain("update");
      for (const p of own) {
        expect(p.roles, p.text).toBe("authenticated");
        const col = t === "profiles" ? "id" : "user_id";
        expect(p.text, p.text).toContain(`${col} = (select auth.uid())`);
        // Inserts and updates must also check the row they write.
        if (p.command === "insert") expect(p.text).toMatch(/with check \(/);
        if (p.command === "update") expect(p.text).toMatch(/using \(.*\) with check \(/);
      }
    }
  });

  it("never write a policy that is open to anon, public or everyone", () => {
    for (const p of policies) {
      expect(p.roles, p.text).not.toMatch(/anon|public/);
      expect(p.text, p.text).not.toMatch(/(using|with check) \(\s*true\s*\)/);
    }
  });

  it("give qloo_cache no policy and no grant to anon or authenticated", () => {
    expect(policies.filter((p) => p.table === CACHE_TABLE)).toEqual([]);
    expect(sql).toMatch(/revoke all on [^;]*public\.qloo_cache[^;]* from public, anon, authenticated/);
    const grants = statements.filter((s) => s.startsWith("grant "));
    for (const g of grants) {
      if (g.includes(CACHE_TABLE)) expect(g, g).toMatch(/ to service_role$/);
      expect(g, g).not.toMatch(/ to (.*\b)?(anon|public)\b/);
    }
    expect(grants.some((g) => g.includes(CACHE_TABLE) && g.endsWith("to service_role"))).toBe(true);
  });

  it("grant authenticated only what the user tables need, and never truncate or references", () => {
    for (const g of statements.filter((s) => s.startsWith("grant ") && s.endsWith(" to authenticated"))) {
      expect(g, g).not.toMatch(/\b(all|truncate|references|trigger)\b/);
    }
  });

  it("key the user tables by user so ownership cannot be crossed", () => {
    for (const t of ["seeds", "picks", "reactions"]) {
      expect(sql, t).toMatch(new RegExp(`create table public\\.${t} \\( user_id uuid not null references public\\.profiles \\(id\\) on delete cascade`));
      expect(sql, t).toMatch(new RegExp(`create table public\\.${t} [^;]*primary key \\( ?user_id,`));
    }
    expect(sql).toMatch(/create table public\.profile_snapshots \( user_id uuid primary key references public\.profiles \(id\) on delete cascade/);
    expect(sql).toContain("foreign key (user_id, seed_id) references public.seeds (user_id, id)");
    expect(sql).toContain("foreign key (user_id, pick_id) references public.picks (user_id, id)");
  });

  it("keeps one profile snapshot per user, with derived JSON only and no delete or anon access", () => {
    const body = statements.find((x) => x.startsWith("create table public.profile_snapshots ")) ?? "";
    expect(body).toContain("profile jsonb not null");
    expect(body).toContain("axes jsonb not null");
    expect(body).toMatch(/plan jsonb check \(plan is null or/);
    expect(policies.filter((p) => p.table === "profile_snapshots").map((p) => p.command).sort()).toEqual(["insert", "select", "update"]);
    expect(sql).toMatch(/grant select, insert, update on public\.profile_snapshots to authenticated;/);
  });

  it("stores how a tried pick went as an optional how, with no liked column, and only once tried", () => {
    const body = statements.find((x) => x.startsWith("create table public.reactions ")) ?? "";
    expect(body).not.toMatch(/\bliked\b boolean/);
    expect(body).toMatch(/ how text check \(how in \(/);
    expect(body).not.toMatch(/ how text not null/);
    expect(body).not.toMatch(/ how text [^,]*default/);
    expect(body).toContain("check (how is null or tried)");
  });

  it("keeps CHECK helpers out of the exposed schema, and grants them only to the roles that insert", () => {
    expect(sql).not.toMatch(/create function public\.all_tag_ids/);
    expect(sql).toContain("create function private.all_tag_ids");
    expect(sql).toMatch(/revoke all on function private\.all_tag_ids\(text\[\]\) from public, anon;/);
    expect(sql).toMatch(/grant execute on function private\.all_tag_ids\(text\[\]\) to authenticated, service_role;/);
    expect(sql).toMatch(/revoke all on schema private from public, anon;/);
    // Every function left in public is a trigger function with its EXECUTE revoked.
    const publicFns = [...sql.matchAll(/create function public\.(\w+)\(\) returns (\w+)/g)];
    expect(publicFns.length).toBeGreaterThan(0);
    for (const [, name, returns] of publicFns) {
      expect(returns, name).toBe("trigger");
      expect(sql, name).toMatch(new RegExp(`revoke all on function public\\.${name}\\(\\) from public, anon, authenticated`));
    }
  });

  it("stores Qloo ids as text, and requires one on every pick that is not llm-bridged", () => {
    expect(sql).toMatch(/create table public\.seeds [^;]*qloo_id text,/);
    expect(sql).toMatch(/create table public\.picks [^;]*qloo_id text,/);
    expect(sql).not.toMatch(/qloo_id uuid/);
    expect(sql).toContain("check (llm_bridged or (qloo_id is not null and length(qloo_id) > 0))");
  });

  it("security-definer functions pin their search_path", () => {
    for (const s of statements.filter((x) => x.startsWith("create function") && x.includes("security definer"))) {
      expect(s).toContain("set search_path = ''");
    }
  });

  it("do not store raw Qloo JSON or scores in user tables", () => {
    for (const t of USER_TABLES) {
      const body = statements.find((s) => s.startsWith(`create table public.${t} `)) ?? "";
      expect(body, t).not.toMatch(/\b(raw|response|popularity|reach|connection|score|rank)\w* /);
    }
  });
});

describe("value lists mirror src/types", () => {
  it("fields, bands, origins, reaction states, seed statuses and endpoints", () => {
    const fields = listIn(/create table public\.seeds[\s\S]*?field in \(([^)]*)\)/);
    expect(fields).toEqual([...FIELDS]);
    expect(listIn(/create table public\.picks[\s\S]*?field in \(([^)]*)\)/)).toEqual([...FIELDS]);
    expect(listIn(/band in \(([^)]*)\)/)).toEqual([...BANDS]);
    expect(listIn(/origin in \(([^)]*)\)/)).toEqual([...ORIGINS]);
    expect(listIn(/create table public\.reactions[\s\S]*?how in \(([^)]*)\)/)).toEqual([...REACTION_HOWS]);
    expect(listIn(/create table public\.reactions[\s\S]*?state in \(([^)]*)\)/)).toEqual([...REACTION_STATES]);
    expect(listIn(/status text not null check \(status in \(([^)]*)\)\)/)).toEqual([...SEED_STATUSES]);
    expect(listIn(/endpoint in \(([^)]*)\)/)).toEqual([...QLOO_ENDPOINTS]);
  });

  it("never allow the legacy recommendation endpoints", () => {
    expect(sql).not.toMatch(/\/recommendations|\/recs/);
  });
});

describe("supabase/config.toml", () => {
  const toml = readFileSync(join(ROOT, "config.toml"), "utf8");
  it("requires email confirmation, which closes the password pre-hijack path", () => {
    expect(toml).toMatch(/^enable_confirmations = true$/m);
  });
  it("keeps anonymous sign-ins off, so a guest is a visitor with no session", () => {
    expect(toml).toMatch(/^enable_anonymous_sign_ins = false$/m);
  });
  it("allows the magic-link callback and holds no secrets", () => {
    expect(toml).toContain("/auth/callback");
    expect(toml).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}/);
    expect(toml).not.toMatch(/service_role|secret\s*=\s*"(?!env\()/i);
  });
});
