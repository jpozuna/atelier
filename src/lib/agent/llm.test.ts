import { describe, expect, it } from "vitest";
import { ANTHROPIC_URL, cacheKey, createAnthropicLlm, createLlm, createLlmCache, disabledLlm, limitCalls, LlmError, type ModelTool } from "./llm";
import { CHOOSE_THEMES_TOOL, DECIDE_REQUERIES_TOOL, WRITE_CARDS_TOOL } from "./tools";

const KEY = "synthetic-anthropic-key-0001";
const tool: ModelTool = { name: "t", description: "d", input_schema: { type: "object" } };
const req = { tool, system: "sys", user: JSON.stringify({ a: 1 }), maxTokens: 100 };

const ok = (input: unknown, extra: Record<string, unknown> = {}) =>
  new Response(JSON.stringify({ stop_reason: "tool_use", content: [{ type: "tool_use", id: "x", name: "t", input }], ...extra }), { status: 200 });

function fetcher(respond: (n: number) => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return respond(calls.length);
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe("createAnthropicLlm", () => {
  it("forces the tool, sends the key only as a header and the model from the option", async () => {
    const f = fetcher(() => ok({ done: true }));
    const llm = createAnthropicLlm({ apiKey: KEY, model: "claude-sonnet-5-5", fetch: f.fn });
    expect(await llm.call(req)).toEqual({ done: true });
    const c = f.calls[0]!;
    expect(c.url).toBe(ANTHROPIC_URL);
    expect(c.init.method).toBe("POST");
    expect(c.init.redirect).toBe("error");
    expect(c.init.signal).toBeInstanceOf(AbortSignal);
    const headers = c.init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe(KEY);
    expect(headers["anthropic-version"]).toBeTruthy();
    const body = JSON.parse(String(c.init.body));
    expect(body.model).toBe("claude-sonnet-5-5");
    expect(body.tools).toEqual([tool]);
    expect(body.tool_choice).toEqual({ type: "tool", name: "t" });
    expect(body.max_tokens).toBe(100);
    expect(JSON.stringify(body)).not.toContain(KEY);
    expect(llm.stats()).toEqual({ calls: 1, cacheHits: 0, failures: 0 });
  });

  it("serves the same input from the cache with no second request", async () => {
    const f = fetcher(() => ok({ n: 1 }));
    const llm = createAnthropicLlm({ apiKey: KEY, model: "m", fetch: f.fn, cache: createLlmCache() });
    await llm.call(req);
    const again = await llm.call(req);
    expect(again).toEqual({ n: 1 });
    expect(f.calls).toHaveLength(1);
    expect(llm.stats()).toEqual({ calls: 1, cacheHits: 1, failures: 0 });
    // A different input, model or tool is a different key.
    expect(cacheKey("m", req)).not.toBe(cacheKey("m2", req));
    expect(cacheKey("m", req)).not.toBe(cacheKey("m", { ...req, user: "{}" }));
    expect(cacheKey("m", req)).not.toBe(cacheKey("m", { ...req, tool: { ...tool, name: "u" } }));
  });

  it("returns a copy from the cache, so a caller cannot change what is remembered", async () => {
    const f = fetcher(() => ok({ list: [1] }));
    const llm = createAnthropicLlm({ apiKey: KEY, model: "m", fetch: f.fn, cache: createLlmCache() });
    const first = (await llm.call(req)) as { list: number[] };
    first.list.push(2);
    expect(await llm.call(req)).toEqual({ list: [1] });
  });

  it("never caches a failure", async () => {
    const f = fetcher((n) => (n === 1 ? new Response("{}", { status: 500 }) : ok({ fine: true })));
    const llm = createAnthropicLlm({ apiKey: KEY, model: "m", fetch: f.fn, cache: createLlmCache() });
    await expect(llm.call(req)).rejects.toBeInstanceOf(LlmError);
    expect(await llm.call(req)).toEqual({ fine: true });
    expect(llm.stats()).toEqual({ calls: 2, cacheHits: 0, failures: 1 });
  });

  it("errors carry the status only: never the response body or the key", async () => {
    const f = fetcher(() => new Response(JSON.stringify({ error: { message: `bad key ${KEY} and a secret detail` } }), { status: 401 }));
    const llm = createAnthropicLlm({ apiKey: KEY, model: "m", fetch: f.fn });
    const err = await llm.call(req).catch((e: unknown) => e as LlmError);
    expect(err).toBeInstanceOf(LlmError);
    expect((err as LlmError).kind).toBe("http");
    expect((err as LlmError).message).toBe("model call returned http 401");
    expect(JSON.stringify(err)).not.toContain(KEY);
    expect(String((err as LlmError).stack)).not.toContain(KEY);
  });

  it("fails on a reply with no tool call, a cut-off reply, and a non-JSON reply", async () => {
    const cases: [Response, string][] = [
      [new Response(JSON.stringify({ content: [{ type: "text", text: "hello" }] }), { status: 200 }), "shape"],
      [ok({ x: 1 }, { stop_reason: "max_tokens" }), "truncated"],
      [new Response("not json", { status: 200 }), "shape"],
      [new Response(JSON.stringify({ content: [{ type: "tool_use", name: "other", input: {} }] }), { status: 200 }), "shape"],
      [new Response(JSON.stringify({ content: [{ type: "tool_use", name: "t", input: [1] }] }), { status: 200 }), "shape"],
    ];
    for (const [response, kind] of cases) {
      const llm = createAnthropicLlm({ apiKey: KEY, model: "m", fetch: fetcher(() => response.clone()).fn });
      await expect(llm.call(req)).rejects.toMatchObject({ kind });
    }
  });

  it("maps a timeout and a network failure to LlmError", async () => {
    const timeout = createAnthropicLlm({
      apiKey: KEY,
      model: "m",
      timeoutMs: 5,
      fetch: ((_u: string, init: RequestInit) => new Promise((_res, rej) => init.signal!.addEventListener("abort", () => rej(init.signal!.reason)))) as unknown as typeof fetch,
    });
    await expect(timeout.call(req)).rejects.toMatchObject({ kind: "timeout" });
    const down = createAnthropicLlm({ apiKey: KEY, model: "m", fetch: (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch });
    await expect(down.call(req)).rejects.toMatchObject({ kind: "network" });
  });

  it("stops before sending when the run was cancelled", async () => {
    const f = fetcher(() => ok({}));
    const llm = createAnthropicLlm({ apiKey: KEY, model: "m", fetch: f.fn });
    const ac = new AbortController();
    ac.abort();
    await expect(llm.call({ ...req, signal: ac.signal })).rejects.toMatchObject({ kind: "aborted" });
    expect(f.calls).toHaveLength(0);
  });
});

describe("createLlm", () => {
  it("is disabled with no key, so the loop never calls out", async () => {
    expect(createLlm({}).enabled).toBe(false);
    expect(createLlm({ ANTHROPIC_API_KEY: "  " }).enabled).toBe(false);
    await expect(disabledLlm.call(req)).rejects.toMatchObject({ kind: "disabled" });
  });

  it("uses ATELIER_MODEL, defaulting to claude-sonnet-5-5", async () => {
    for (const [env, expected] of [
      [{ ANTHROPIC_API_KEY: KEY }, "claude-sonnet-5-5"],
      [{ ANTHROPIC_API_KEY: KEY, ATELIER_MODEL: "custom-model" }, "custom-model"],
    ] as const) {
      const f = fetcher(() => ok({}));
      await createLlm(env, { fetch: f.fn }).call(req);
      expect(JSON.parse(String(f.calls[0]!.init.body)).model).toBe(expected);
    }
  });

  it("the cache is bounded and drops the oldest entry", () => {
    const c = createLlmCache(2);
    c.set("a", { v: 1 });
    c.set("b", { v: 2 });
    c.set("c", { v: 3 });
    expect(c.size()).toBe(2);
    expect(c.get("a")).toBeUndefined();
    expect(c.get("c")).toEqual({ v: 3 });
  });
});

describe("limitCalls", () => {
  it("refuses the call over the cap and sends nothing; every call counts, cache hits included", async () => {
    const f = fetcher(() => ok({ n: 1 }));
    const llm = limitCalls(createAnthropicLlm({ apiKey: KEY, model: "m", fetch: f.fn, cache: createLlmCache() }), 2);
    await llm.call(req);
    await llm.call(req); // a cache hit, but it counts
    await expect(llm.call({ ...req, user: "{}" })).rejects.toMatchObject({ kind: "budget" });
    expect(f.calls).toHaveLength(1);
    expect(llm.enabled).toBe(true);
    // The cap is per wrapper, so a new run on the same client starts at zero.
    const next = limitCalls(createAnthropicLlm({ apiKey: KEY, model: "m", fetch: f.fn }), 1);
    await next.call(req);
  });
});

describe("tool definitions", () => {
  it("are valid object schemas with unique names and a forced single call shape", () => {
    const tools = [CHOOSE_THEMES_TOOL, DECIDE_REQUERIES_TOOL, WRITE_CARDS_TOOL];
    expect(new Set(tools.map((t) => t.name)).size).toBe(3);
    for (const t of tools) {
      expect(t.input_schema.type).toBe("object");
      expect(Array.isArray(t.input_schema.required)).toBe(true);
      expect(t.description.length).toBeGreaterThan(20);
    }
  });
});
