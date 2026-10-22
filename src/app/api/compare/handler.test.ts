// Synthetic only: a fake model, no network, no Qloo. Every name is invented.

import { describe, expect, it } from "vitest";
import { LlmError, createAnthropicLlm, disabledLlm } from "@/lib/agent/llm";
import type { Llm, LlmRequest } from "@/lib/agent/llm";
import { COMPARE_PICKS_PER_FIELD } from "@/lib/agent/config";
import type { PlainPick } from "@/components/compare/types";
import { MESSAGES, createCompareCache, handleCompare, inputHash } from "./handler";
import type { CompareHandlerDeps } from "./handler";
import { COMPARE_TOOL } from "./prompt";

const post = (body: unknown, init: RequestInit = {}) =>
  new Request("http://localhost/api/compare", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body), ...init });

const good = { seeds: [{ field: "music", typed: "Invented Work 1", why: "It leaves room around each part." }, { field: "film", typed: "Invented Work 2", why: "Slow and warm." }], fields: ["music", "books"] };

const reply = {
  picks: [
    { name: "Fixture Song", field: "music", why: "Quiet and spare, like your first pick." },
    { name: "Fixture Book", field: "books", why: "A patient book with room in it." },
    { name: "Fixture Rated", field: "books", why: "Rated 9 by many." },
  ],
};

function fakeLlm(output: Record<string, unknown> | LlmError = reply) {
  const calls: LlmRequest[] = [];
  const llm: Llm = {
    enabled: true,
    stats: () => ({ calls: calls.length, cacheHits: 0, failures: 0 }),
    async call(req) {
      calls.push(req);
      if (output instanceof LlmError) throw output;
      return structuredClone(output);
    },
  };
  return { llm, calls };
}

function deps(llm: Llm, extra: Partial<CompareHandlerDeps> = {}): CompareHandlerDeps {
  return { llm, model: "fixture-model", cache: createCompareCache(10), inflight: new Map(), ...extra };
}

describe("POST /api/compare", () => {
  it("makes one forced-tool call and returns names with one plain line, nothing else", async () => {
    const { llm, calls } = fakeLlm();
    const res = await handleCompare(post(good), deps(llm));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { picks: PlainPick[] };
    expect(body.picks.map((p) => p.name)).toEqual(["Fixture Song", "Fixture Book"]); // the "Rated 9" pick is dropped
    for (const p of body.picks) expect(Object.keys(p).sort()).toEqual(["field", "name", "why"]);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.tool.name).toBe(COMPARE_TOOL.name);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("sends the model only the user's words and the fields, as JSON data", async () => {
    const { llm, calls } = fakeLlm();
    const noisy = { ...good, seeds: good.seeds.map((s, i) => ({ ...s, id: `seed-${i}`, qlooId: "00000000-0000-4000-8000-000000000001", whyTags: [{ tag: "urn:tag:fixture:a", name: "Fixture Tag" }] })) };
    await handleCompare(post(noisy), deps(llm));
    const user = calls[0]!.user;
    expect(JSON.parse(user)).toEqual({
      list: [
        { field: "music", name: "Invented Work 1", reason: "It leaves room around each part." },
        { field: "film", name: "Invented Work 2", reason: "Slow and warm." },
      ],
      fields: ["music", "books"],
      picksPerField: COMPARE_PICKS_PER_FIELD,
    });
    expect(user + calls[0]!.system).not.toMatch(/00000000-0000-4000|urn:tag|Fixture Tag|qloo/i);
  });

  it("serves the same profile from its cache: a second request makes no model call", async () => {
    const { llm, calls } = fakeLlm();
    const d = deps(llm);
    await handleCompare(post(good), d);
    const again = await handleCompare(post({ ...good, fields: ["books", "music"] }), d); // same ask, fields in another order
    expect(again.status).toBe(200);
    expect(calls).toHaveLength(1);
    const other = await handleCompare(post({ ...good, fields: ["music"] }), d);
    expect(other.status).toBe(200);
    expect(calls).toHaveLength(2);
  });

  it("shares one call between identical concurrent requests", async () => {
    const { llm, calls } = fakeLlm();
    const d = deps(llm);
    const [a, b] = await Promise.all([handleCompare(post(good), d), handleCompare(post(good), d)]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(calls).toHaveLength(1);
  });

  it("refuses without a key, with a fixed message, and sends nothing", async () => {
    const res = await handleCompare(post(good), deps(disabledLlm));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: { code: "model_off", message: MESSAGES.model_off } });
  });

  it("refuses an unreadable or oversized request before any call", async () => {
    const { llm, calls } = fakeLlm();
    const d = deps(llm);
    for (const body of ["{", "[]", { seeds: [], fields: ["music"] }, { ...good, fields: ["pottery"] }, "x".repeat(20_001)]) {
      const res = await handleCompare(post(body), d);
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe("bad_request");
    }
    expect((await handleCompare(post(good, { headers: { "content-length": "999999" } }), d)).status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("fails calmly when the model fails, and does not cache the failure", async () => {
    const failing = fakeLlm(new LlmError("http", "model call returned http 500"));
    const d = deps(failing.llm);
    const res = await handleCompare(post(good), d);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: { code: "upstream", message: MESSAGES.upstream } });
    expect(d.cache.size()).toBe(0);
    await handleCompare(post(good), d);
    expect(failing.calls).toHaveLength(2);
  });

  it("says unusable when nothing in the reply passes", async () => {
    const { llm } = fakeLlm({ picks: [{ name: "Fixture Rated", field: "music", why: "Rated 9 of 10." }] });
    const d = deps(llm);
    const res = await handleCompare(post(good), d);
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("unusable");
    expect(d.cache.size()).toBe(0);
  });

  it("sends no request signal to the shared call, and clears its in-flight entry on success and failure", async () => {
    const { llm, calls } = fakeLlm();
    const d = deps(llm);
    const controller = new AbortController();
    await handleCompare(post(good, { signal: controller.signal }), d);
    expect(calls[0]!.signal).toBeUndefined();
    expect(d.inflight!.size).toBe(0);
    const failing = fakeLlm(new LlmError("timeout", "model call timed out"));
    const d2 = deps(failing.llm);
    await handleCompare(post(good), d2);
    expect(d2.inflight!.size).toBe(0);
  });

  it("a model client that throws at once leaves nothing in flight and no unhandled rejection", async () => {
    const llm: Llm = { enabled: true, stats: () => ({ calls: 0, cacheHits: 0, failures: 0 }), call: () => { throw new Error("sync"); } };
    const d = deps(llm);
    expect((await handleCompare(post(good), d)).status).toBe(502);
    expect(d.inflight!.size).toBe(0);
  });

  it("never leaks an error body from the model", async () => {
    const { llm } = fakeLlm(new LlmError("shape", "secret detail sk-ant-fixture"));
    const res = await handleCompare(post(good), deps(llm));
    expect(JSON.stringify(await res.json())).not.toContain("sk-ant");
  });
});

describe("through the real model client with a fake endpoint", () => {
  it("sends one request asking for the tool, and puts no key or Qloo data in the body", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const fakeFetch = (async (url: string, init: RequestInit) => {
      seen.push({ url, init });
      return Response.json({ stop_reason: "tool_use", content: [{ type: "tool_use", name: COMPARE_TOOL.name, input: reply }] });
    }) as unknown as typeof fetch;
    const llm = createAnthropicLlm({ apiKey: "fixture-key", model: "fixture-model", fetch: fakeFetch });
    const res = await handleCompare(post(good), deps(llm));
    expect(res.status).toBe(200);
    expect(seen).toHaveLength(1);
    const sent = JSON.parse(seen[0]!.init.body as string);
    expect(sent.tool_choice).toEqual({ type: "auto", disable_parallel_tool_use: true });
    expect(sent.tools.map((t: { name: string }) => t.name)).toEqual([COMPARE_TOOL.name]);
    expect(sent.model).toBe("fixture-model");
    expect(seen[0]!.init.body).not.toContain("fixture-key");
  });
});

describe("inputHash", () => {
  it("changes with the model, the words and the fields, and not with anything else", () => {
    const ask = { seeds: [{ field: "music" as const, typed: "A", why: "b" }], fields: ["music" as const] };
    const base = inputHash("m", ask);
    expect(inputHash("m", { ...ask })).toBe(base);
    const two = { seeds: [{ field: "music" as const, typed: "A", why: "b" }, { field: "film" as const, typed: "B", why: "c" }], fields: ["music" as const] };
    expect(inputHash("m", { ...two, seeds: [...two.seeds].reverse() })).toBe(inputHash("m", two));
    expect(inputHash("n", ask)).not.toBe(base);
    expect(inputHash("m", { ...ask, fields: ["film"] })).not.toBe(base);
    expect(inputHash("m", { ...ask, seeds: [{ ...ask.seeds[0]!, why: "c" }] })).not.toBe(base);
  });
});
