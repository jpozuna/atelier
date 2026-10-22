import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createRunLog } from "./index";
import { RunLogDbError, RUN_TABLE, SIGNAL_TABLE, createSupabaseRunLogStore, type RunLogClient } from "./store-supabase";

// A tiny stand-in for the supabase-js builder: only the calls this store makes. Synthetic data only.
type Row = Record<string, unknown>;
interface Call {
  table: string;
  op: string;
  arg?: unknown;
  opts?: unknown;
  filters: [string, string, unknown][];
}

function fakeClient(fail?: { message: string; code?: string }) {
  const tables: Record<string, Row[]> = { [RUN_TABLE]: [], [SIGNAL_TABLE]: [] };
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      const call: Call = { table, op: "select", filters: [] };
      calls.push(call);
      let order: { col: string; asc: boolean } | null = null;
      let limit = Infinity;
      let single = false;
      const rows = tables[table]!;
      const run = (): { data: unknown; error: unknown } => {
        if (fail) return { data: null, error: fail };
        if (call.op === "insert") {
          rows.push(call.arg as Row);
          return { data: null, error: null };
        }
        if (call.op === "upsert") {
          const key = String((call.opts as { onConflict: string }).onConflict).split(",");
          for (const r of call.arg as Row[]) {
            const at = rows.findIndex((x) => key.every((k) => x[k] === r[k]));
            if (at >= 0) rows[at] = r;
            else rows.push(r);
          }
          return { data: null, error: null };
        }
        let out = rows.filter((r) =>
          call.filters.every(([op, col, val]) => {
            const v = r[col];
            if (op === "eq") return v === val;
            if (op === "in") return (val as unknown[]).includes(v);
            if (op === "ov") return (v as string[]).some((x) => (val as string[]).includes(x));
            if (op === "cs") return (val as string[]).every((x) => (v as string[]).includes(x));
            return false;
          }),
        );
        if (order) out = [...out].sort((a, b) => (String(a[order!.col]) < String(b[order!.col]) ? -1 : 1) * (order!.asc ? 1 : -1));
        out = out.slice(0, limit);
        return { data: single ? (out[0] ?? null) : out, error: null };
      };
      const b: Record<string, unknown> = {
        insert(row: Row) {
          call.op = "insert";
          call.arg = row;
          return b;
        },
        upsert(rowsIn: Row[], opts: unknown) {
          call.op = "upsert";
          call.arg = rowsIn;
          call.opts = opts;
          return b;
        },
        select(cols: string) {
          call.arg = cols;
          return b;
        },
        eq(c: string, v: unknown) {
          call.filters.push(["eq", c, v]);
          return b;
        },
        in(c: string, v: unknown) {
          call.filters.push(["in", c, v]);
          return b;
        },
        overlaps(c: string, v: unknown) {
          call.filters.push(["ov", c, v]);
          return b;
        },
        contains(c: string, v: unknown) {
          call.filters.push(["cs", c, v]);
          return b;
        },
        order(col: string, o: { ascending: boolean }) {
          order = { col, asc: o.ascending };
          return b;
        },
        limit(n: number) {
          limit = n;
          return b;
        },
        maybeSingle() {
          single = true;
          return b;
        },
        then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) {
          return Promise.resolve(run()).then(res, rej);
        },
      };
      return b;
    },
  };
  return { client: client as unknown as RunLogClient, tables, calls };
}

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const entry = (over = {}) => ({
  seeds: [{ id: "s1", field: "film", typed: "Invented Film", why: "quiet", qlooId: id(1) }],
  tagIds: ["urn:tag:genre:invented"],
  userId: id(91),
  events: [],
  result: { domains: [{ picks: [{ id: `pick-${id(10)}`, qlooId: id(10) }] }], plan: { themes: [], requeries: [] }, meta: {}, audit: {} },
  ...over,
});

describe("supabase run log store", () => {
  it("writes the run to run_log in snake_case columns, and reads it back", async () => {
    const db = fakeClient();
    const store = createSupabaseRunLogStore({ client: db.client });
    await createRunLog(store).recordRun(entry());
    const row = db.tables[RUN_TABLE]![0]!;
    expect(Object.keys(row).sort()).toEqual(
      ["created_at", "error_code", "id", "input", "kept_entity_ids", "kept_pick_ids", "outcome", "plan", "profile_hash", "trace", "user_id"].sort(),
    );
    expect(row.kept_entity_ids).toEqual([id(10)]);
    const found = await store.selectRuns({ userId: id(91), pickId: `pick-${id(10)}` });
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ userId: id(91), outcome: "ok", keptEntityIds: [id(10)] });
    expect(found[0]).not.toHaveProperty("trace");
    expect((await store.getRun(found[0]!.id))?.trace).toEqual({ events: [], meta: {}, audit: {} });
  });

  it("asks for the summary columns only when listing runs", async () => {
    const db = fakeClient();
    const store = createSupabaseRunLogStore({ client: db.client });
    await store.selectRuns({ profileHash: "a".repeat(64), entityIds: [id(10)] });
    const call = db.calls.at(-1)!;
    expect(String(call.arg)).not.toMatch(/trace|input/);
    expect(call.filters.map((f) => f[0])).toEqual(["eq", "ov"]);
  });

  it("upserts signals on the unique key, so a repeat with a new why updates the row", async () => {
    const db = fakeClient();
    const store = createSupabaseRunLogStore({ client: db.client });
    const log = createRunLog(store);
    await log.recordRun(entry());
    const item = { userId: id(91), items: [{ pickId: `pick-${id(10)}`, signals: ["saved_later" as const], words: "later" }] };
    await log.recordReactions(item);
    await log.recordReactions({ ...item, items: [{ ...item.items[0]!, words: "later, on a quiet weekend" }] });
    expect(db.tables[SIGNAL_TABLE]).toHaveLength(1);
    expect(db.tables[SIGNAL_TABLE]![0]!.why).toBe("later, on a quiet weekend");
    const upsert = db.calls.find((c) => c.op === "upsert")!;
    expect(upsert.opts).toEqual({ onConflict: "run_id,pick_id,signal,user_id" });
    expect(db.tables[SIGNAL_TABLE]![0]).toMatchObject({ signal: "saved_later", why: "later, on a quiet weekend", source: "reaction", entity_id: id(10) });
    expect((await store.selectSignals({ userId: id(91) }))[0]).toMatchObject({ signal: "saved_later", pickId: `pick-${id(10)}` });
  });

  it("throws a RunLogDbError that carries the code and message and never a row", async () => {
    const db = fakeClient({ code: "42P01", message: "relation does not exist" });
    const store = createSupabaseRunLogStore({ client: db.client });
    const err = await store.insertRun({ id: id(1) } as never).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RunLogDbError);
    expect(String((err as Error).message)).toBe("run log insert run failed: 42P01 relation does not exist");
  });

  it("does nothing for an empty signal list", async () => {
    const db = fakeClient();
    await createSupabaseRunLogStore({ client: db.client }).insertSignals([]);
    expect(db.calls).toEqual([]);
  });
});
