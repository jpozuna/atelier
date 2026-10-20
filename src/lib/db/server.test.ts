import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const store = {
  all: [{ name: "sb-session", value: "synthetic" }],
  set: vi.fn(),
};
vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => store.all, set: store.set }),
}));

const created: { url: string; key: string; options: { cookies: { getAll(): unknown; setAll(l: unknown[], headers?: Record<string, string>): void } } }[] = [];
vi.mock("@supabase/ssr", () => ({
  createServerClient: (url: string, key: string, options: never) => {
    created.push({ url, key, options });
    return { kind: "user" };
  },
}));

import { applyAuthHeaders, createServiceClient, createUserClient, DbConfigError } from "./server";

afterEach(() => {
  vi.unstubAllEnvs();
  created.length = 0;
  store.set.mockReset();
});

describe("createServiceClient", () => {
  it("throws a config error naming the variable, never a value", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    expect(() => createServiceClient()).toThrow(DbConfigError);
    expect(() => createServiceClient()).toThrow(/SUPABASE_SERVICE_ROLE_KEY is not set/);
  });

  it("builds a client when both values are present", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "synthetic-service-key");
    expect(typeof createServiceClient().from).toBe("function");
  });
});

describe("createUserClient", () => {
  it("uses the anon key and the request cookies, and tolerates read-only cookie stores", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "synthetic-anon-key");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "synthetic-service-key");
    await createUserClient();
    expect(created).toHaveLength(1);
    expect(created[0].key).toBe("synthetic-anon-key");
    expect(created[0].options.cookies.getAll()).toEqual(store.all);
    created[0].options.cookies.setAll([{ name: "a", value: "b", options: {} }]);
    expect(store.set).toHaveBeenCalledWith("a", "b", {});
    store.set.mockImplementation(() => {
      throw new Error("read-only");
    });
    expect(() => created[0].options.cookies.setAll([{ name: "a", value: "b", options: {} }])).not.toThrow();
  });

  it("hands the Cache-Control headers from setAll to onHeaders, even if the cookie write is refused", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "synthetic-anon-key");
    const seen: Record<string, string>[] = [];
    await createUserClient({ onHeaders: (h) => seen.push(h) });
    const cookies = created[0].options.cookies;
    cookies.setAll([{ name: "a", value: "b", options: {} }], { "Cache-Control": "private, no-store" });
    store.set.mockImplementation(() => {
      throw new Error("read-only");
    });
    cookies.setAll([{ name: "a", value: "b", options: {} }], { "Cache-Control": "private, no-store" });
    cookies.setAll([], {});
    cookies.setAll([]);
    expect(seen).toEqual([{ "Cache-Control": "private, no-store" }, { "Cache-Control": "private, no-store" }]);
  });

  it("applyAuthHeaders sets them on a Response", () => {
    const res = applyAuthHeaders(new Response("ok"), { "Cache-Control": "private, no-store" });
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("throws a config error when the anon key is missing", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    await expect(createUserClient()).rejects.toThrow(/NEXT_PUBLIC_SUPABASE_ANON_KEY is not set/);
  });
});
