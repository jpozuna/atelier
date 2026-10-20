import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

type Opts = { cookies: { getAll(): { name: string; value: string }[]; setAll(l: { name: string; value: string; options?: object }[], h?: Record<string, string>): void } };
const ssr = vi.hoisted(() => ({ calls: 0, refresh: true, throws: false }));

vi.mock("@supabase/ssr", () => ({
  createServerClient: (_url: string, _key: string, opts: Opts) => ({
    auth: {
      async getClaims() {
        ssr.calls++;
        if (ssr.throws) throw new Error("auth outage");
        if (ssr.refresh) opts.cookies.setAll([{ name: "sb-proj-auth-token", value: "renewed", options: { path: "/" } }], { "Cache-Control": "private, no-store" });
        return { data: null, error: null };
      },
    },
  }),
}));

import { hasSessionCookie, refreshSession } from "./session";

const ENV = { NEXT_PUBLIC_SUPABASE_URL: "https://synthetic.example", NEXT_PUBLIC_SUPABASE_ANON_KEY: "synthetic-anon-key" };
const req = (cookie?: string) => new NextRequest("http://localhost/saved", { headers: cookie ? { cookie } : {} });

beforeEach(() => {
  ssr.calls = 0;
  ssr.refresh = true;
  ssr.throws = false;
});

describe("hasSessionCookie", () => {
  it("matches the session cookie and its chunks, not the PKCE verifier or other cookies", () => {
    expect(hasSessionCookie(req("sb-abc-auth-token=1"))).toBe(true);
    expect(hasSessionCookie(req("sb-abc-auth-token.0=1; sb-abc-auth-token.1=2"))).toBe(true);
    expect(hasSessionCookie(req("sb-abc-auth-token-code-verifier=1"))).toBe(false);
    expect(hasSessionCookie(req("theme=dark"))).toBe(false);
    expect(hasSessionCookie(req())).toBe(false);
  });
});

describe("refreshSession", () => {
  it("passes a guest straight through without touching Supabase", async () => {
    const res = await refreshSession(req(), ENV);
    expect(ssr.calls).toBe(0);
    expect(res.headers.get("x-middleware-next")).toBe("1");
    expect(res.headers.get("cache-control")).toBeNull();
  });

  it("does nothing when Supabase is not configured", async () => {
    await refreshSession(req("sb-proj-auth-token=old"), {});
    expect(ssr.calls).toBe(0);
  });

  it("renews the cookie on the response and applies the auth Cache-Control header", async () => {
    const res = await refreshSession(req("sb-proj-auth-token=old"), ENV);
    expect(ssr.calls).toBe(1);
    expect(res.cookies.get("sb-proj-auth-token")?.value).toBe("renewed");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("sets no cache header when nothing was renewed", async () => {
    ssr.refresh = false;
    const res = await refreshSession(req("sb-proj-auth-token=old"), ENV);
    expect(res.headers.get("cache-control")).toBeNull();
  });

  it("never fails the request on an auth outage", async () => {
    ssr.throws = true;
    const res = await refreshSession(req("sb-proj-auth-token=old"), ENV);
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });
});
