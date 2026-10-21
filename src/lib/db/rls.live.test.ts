// RLS and constraint check against a REAL Supabase database. Skipped unless SUPABASE_RLS_TEST=1, so `npm test` and CI
// stay offline. It creates two throwaway users with invented emails and deletes them (and their rows) afterwards.
//
//   supabase start && supabase db reset
//   supabase status -o env        (prints API_URL, ANON_KEY and SERVICE_ROLE_KEY for the local stack)
//   Export them under the names this file reads: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and
//   the service-role variable from .env.example, then:
//   SUPABASE_RLS_TEST=1 npx vitest run src/lib/db/rls.live.test.ts
//
// It refuses a non-local URL unless SUPABASE_RLS_TEST_ALLOW_REMOTE=1 (then it runs against your hosted project; it
// only touches rows it creates). Data is synthetic. No Qloo calls.

import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CACHE_ENTRY_VERSION } from "@/lib/qloo/cache";
import type { Database } from "./database.types";
import { pickToRow, reactionToRow, seedToRow } from "./mappers";
import { createSupabaseQlooCache } from "./qloo-cache";
import { syntheticPick, syntheticSeed } from "./testing";
import { createSupabaseStore, storedKey } from "@/lib/guard/store-supabase";
import { createMemoryStore, type Hit } from "@/lib/guard/store";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const enabled = process.env.SUPABASE_RLS_TEST === "1" && !!url && !!anonKey && !!serviceKey;
const local = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(url);
const allowed = local || process.env.SUPABASE_RLS_TEST_ALLOW_REMOTE === "1";

type Db = SupabaseClient<Database>;
const noSession = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };

describe.skipIf(!enabled)("RLS against a real database", () => {
  let admin: Db;
  let anon: Db;
  let a: Db;
  let b: Db;
  let aId = "";
  let bId = "";
  const run = randomUUID().slice(0, 8);
  const password = `pw-${randomUUID()}`;
  const cacheKey = "e".repeat(64);
  // A synthetic visitor key unique to this run, hashed exactly as the guard sends it.
  const guardKey = `ip:rls-${run}:test-hour`;

  async function makeUser(label: string): Promise<{ id: string; client: Db }> {
    const email = `rls-${label}-${run}@example.test`;
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error || !created.data.user) throw new Error(`createUser failed: ${created.error?.message}`);
    const client = createClient<Database>(url, anonKey, noSession);
    const signedIn = await client.auth.signInWithPassword({ email, password });
    if (signedIn.error) throw new Error(`signIn failed: ${signedIn.error.message}`);
    return { id: created.data.user.id, client };
  }

  beforeAll(async () => {
    if (!allowed) throw new Error("Refusing to run against a non-local URL. Set SUPABASE_RLS_TEST_ALLOW_REMOTE=1 to override.");
    admin = createClient<Database>(url, serviceKey, noSession);
    anon = createClient<Database>(url, anonKey, noSession);
    ({ id: aId, client: a } = await makeUser("a"));
    ({ id: bId, client: b } = await makeUser("b"));
  });

  afterAll(async () => {
    if (!admin) return;
    await admin.from("qloo_cache").delete().eq("key", cacheKey);
    await admin.from("guard_counters").delete().eq("key", storedKey(guardKey));
    // Deleting the auth user cascades to profiles, seeds, picks, reactions and profile snapshots.
    for (const id of [aId, bId]) if (id) await admin.auth.admin.deleteUser(id);
  });

  it("creates a profile row with each account", async () => {
    const { data } = await admin.from("profiles").select("id").in("id", [aId, bId]);
    expect((data ?? []).map((r) => r.id).sort()).toEqual([aId, bId].sort());
  });

  it("lets user A save a seed, a pick with its path, and a reaction", async () => {
    const s = await a.from("seeds").insert(seedToRow(aId, syntheticSeed(1), ["urn:tag:fixture:theme:invented"]));
    expect(s.error).toBeNull();
    const p = await a.from("picks").insert(pickToRow(aId, syntheticPick(1, "seed-1")));
    expect(p.error).toBeNull();
    const r = await a.from("reactions").insert(reactionToRow(aId, "pick-1", { state: "explore", words: "curious" }));
    expect(r.error).toBeNull();
    const mine = await a.from("picks").select("id, path").eq("id", "pick-1");
    expect(mine.data).toHaveLength(1);
  });

  it("hides user A's rows from user B on every user table", async () => {
    for (const table of ["seeds", "picks", "reactions"] as const) {
      const { data, error } = await b.from(table).select("*");
      expect(error, table).toBeNull();
      expect(data, table).toEqual([]);
    }
    const profiles = await b.from("profiles").select("id");
    expect((profiles.data ?? []).map((r) => r.id)).toEqual([bId]);
    // Asking for A's pick by id still returns nothing.
    const direct = await b.from("picks").select("*").eq("user_id", aId).eq("id", "pick-1");
    expect(direct.data).toEqual([]);
  });

  it("does not let user B change or delete user A's rows", async () => {
    await b.from("picks").update({ name: "tampered" }).eq("user_id", aId).eq("id", "pick-1");
    await b.from("reactions").update({ state: "later" }).eq("user_id", aId);
    await b.from("seeds").delete().eq("user_id", aId);
    await b.from("picks").delete().eq("user_id", aId);
    const pick = await admin.from("picks").select("name").eq("user_id", aId).eq("id", "pick-1").single();
    expect(pick.data?.name).toBe("Invented Pick 1");
    const reaction = await admin.from("reactions").select("state").eq("user_id", aId).single();
    expect(reaction.data?.state).toBe("explore");
    const seeds = await admin.from("seeds").select("id").eq("user_id", aId);
    expect(seeds.data).toHaveLength(1);
  });

  it("does not let a user write rows for someone else, or point at someone else's seed", async () => {
    const asA = await b.from("seeds").insert(seedToRow(aId, syntheticSeed(2)));
    expect(asA.error).not.toBeNull();
    const reverse = await a.from("seeds").insert(seedToRow(bId, syntheticSeed(3)));
    expect(reverse.error).not.toBeNull();
    // B's own pick that names A's seed: the composite foreign key (user_id, seed_id) has no match.
    const crossSeed = await b.from("picks").insert(pickToRow(bId, syntheticPick(9, "seed-1")));
    expect(crossSeed.error).not.toBeNull();
    // A reaction for a pick that is not the user's own.
    const crossReaction = await b.from("reactions").insert(reactionToRow(bId, "pick-1", { state: "later" }));
    expect(crossReaction.error).not.toBeNull();
  });

  it("keeps a profile snapshot per user, owner-only", async () => {
    const mineRow = { user_id: aId, profile: { seedIds: [] }, axes: [], plan: null };
    const ok = await a.from("profile_snapshots").insert(mineRow);
    expect(ok.error).toBeNull();
    const upd = await a.from("profile_snapshots").update({ axes: [{ id: "axis-1" }] }).eq("user_id", aId);
    expect(upd.error).toBeNull();
    const seenByB = await b.from("profile_snapshots").select("*");
    expect(seenByB.data).toEqual([]);
    const forA = await b.from("profile_snapshots").insert({ ...mineRow, user_id: aId });
    expect(forA.error).not.toBeNull();
    const del = await a.from("profile_snapshots").delete().eq("user_id", aId);
    void del; // delete is not granted to users; the row must still be there
    const still = await admin.from("profile_snapshots").select("user_id").eq("user_id", aId);
    expect(still.data).toHaveLength(1);
  });

  it("only accepts a how once the pick was tried", async () => {
    const untried = await a.from("reactions").update({ how: "mixed" }).eq("user_id", aId).eq("pick_id", "pick-1");
    expect(untried.error).not.toBeNull();
    const tried = await a.from("reactions").update({ state: "tried", tried: true, how: "mixed" }).eq("user_id", aId).eq("pick_id", "pick-1");
    expect(tried.error).toBeNull();
    const bad = await a.from("reactions").update({ how: "great" as never }).eq("user_id", aId).eq("pick_id", "pick-1");
    expect(bad.error).not.toBeNull();
    await a.from("reactions").update({ state: "explore", tried: false, how: null }).eq("user_id", aId).eq("pick_id", "pick-1");
  });

  it("gives a guest (anon key, no session) nothing", async () => {
    for (const table of ["profiles", "seeds", "picks", "reactions", "profile_snapshots", "qloo_cache", "guard_counters"] as const) {
      const { data, error } = await anon.from(table).select("*");
      expect(data ?? [], table).toEqual([]);
      void error; // permission denied or an empty list are both acceptable; leaking rows is not
    }
    const write = await anon.from("seeds").insert(seedToRow(aId, syntheticSeed(4)));
    expect(write.error).not.toBeNull();
  });

  it("enforces the stored-path and card shape", async () => {
    const noPath = pickToRow(aId, syntheticPick(5, "seed-1"));
    const bad = await a.from("picks").insert({ ...noPath, path: { hops: [] }, card: { path: { hops: [] } } });
    expect(bad.error?.code).toBe("23514");
    const withReaction = pickToRow(aId, syntheticPick(6, "seed-1"));
    const leaked = await a.from("picks").insert({ ...withReaction, card: { ...(withReaction.card as object), reaction: { state: "later" } } });
    expect(leaked.error?.code).toBe("23514");
    // A pick needs a Qloo id unless the model bridged it (no Qloo coverage for its field).
    const noId = pickToRow(aId, syntheticPick(8, "seed-1"));
    const missing = await a.from("picks").insert({ ...noId, qloo_id: null });
    expect(missing.error?.code).toBe("23514");
    const bridged = pickToRow(aId, syntheticPick(8, "seed-1", { llmBridged: true, qlooId: "" }));
    expect((await a.from("picks").insert(bridged)).error).toBeNull();
    const badTag = await a.from("seeds").insert({ ...seedToRow(aId, syntheticSeed(7)), why_tag_ids: ["freeform words"] });
    expect(badTag.error?.code).toBe("23514");
  });

  it("keeps qloo_cache closed to anon and authenticated, open to the service role", async () => {
    const row = { key: cacheKey, endpoint: "/search", method: "GET", status: 200, body: { invented: true }, version: CACHE_ENTRY_VERSION };
    for (const [name, client] of [["anon", anon], ["authenticated", a]] as const) {
      const read = await client.from("qloo_cache").select("*");
      expect(read.data ?? [], name).toEqual([]);
      const write = await client.from("qloo_cache").insert(row);
      expect(write.error, name).not.toBeNull();
    }
    const cache = createSupabaseQlooCache({ client: admin });
    await cache.set({ v: CACHE_ENTRY_VERSION, key: cacheKey, endpoint: "/search", method: "GET", status: 200, body: { invented: true }, createdAt: new Date().toISOString() });
    expect((await cache.get(cacheKey))?.body).toEqual({ invented: true });
    const stillClosed = await a.from("qloo_cache").select("*");
    expect(stillClosed.data ?? []).toEqual([]);
  });

  it("keeps guard_counters and guard_consume closed to anon and authenticated", async () => {
    const hits = [{ key: storedKey(guardKey), cost: 1, limit: 3, windowMs: 3_600_000 }];
    for (const [name, client] of [["anon", anon], ["authenticated", a]] as const) {
      const read = await client.from("guard_counters").select("*");
      expect(read.data ?? [], name).toEqual([]);
      const write = await client.from("guard_counters").insert({ key: storedKey(guardKey), at_ms: 0, cost: 1 });
      expect(write.error, name).not.toBeNull();
      const call = await client.rpc("guard_consume", { hits, now_ms: Date.now(), do_commit: true });
      expect(call.error, name).not.toBeNull();
    }
    const raw = await admin.from("guard_counters").insert({ key: "ip:203.0.113.9:run-hour", at_ms: 0, cost: 1 });
    expect(raw.error?.code).toBe("23514");
  });

  it("admits exactly the limit across concurrent callers, all-or-nothing, with check never committing", async () => {
    const store = createSupabaseStore(
      async (hits, now, commit, signal) => {
        const { data, error } = await admin.rpc("guard_consume", { hits: hits as never, now_ms: now, do_commit: commit }).abortSignal(signal);
        if (error) throw new Error(error.message);
        return data;
      },
      { fallback: createMemoryStore(), timeoutMs: 10_000, onFallback: (r) => { throw new Error(`fell back: ${r}`); } },
    );
    const now = Date.now();
    const h: Hit = { key: guardKey, cost: 1, limit: 3, windowMs: 3_600_000 };
    expect((await store.check([h], now)).ok).toBe(true);
    const results = await Promise.all(Array.from({ length: 20 }, () => store.consume([h], now)));
    expect(results.filter((r) => r.ok)).toHaveLength(3);
    const refused = results.find((r) => !r.ok);
    expect(refused).toMatchObject({ ok: false, index: 0, key: guardKey });
    // A second hit that cannot fit stops the first from being charged.
    const meter: Hit = { key: "global:rls_test", cost: 5, limit: 1, windowMs: 1000 };
    const before = await admin.from("guard_counters").select("cost").eq("key", storedKey(guardKey));
    expect(await store.consume([{ ...h, limit: 100 }, meter], now)).toMatchObject({ ok: false, index: 1, key: "global:rls_test", retryAfterMs: 1000 });
    const after = await admin.from("guard_counters").select("cost").eq("key", storedKey(guardKey));
    expect(after.data).toHaveLength(before.data?.length ?? -1);
  });

  it("cascades: deleting a seed keeps the pick and its path", async () => {
    const del = await a.from("seeds").delete().eq("id", "seed-1");
    expect(del.error).toBeNull();
    const pick = await a.from("picks").select("seed_id, path").eq("id", "pick-1").single();
    expect(pick.data?.seed_id).toBeNull();
    expect(pick.data?.path).toBeTruthy();
  });
});
