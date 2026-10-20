import { describe, expect, it } from "vitest";
import { applyAuthHeaders } from "@/lib/db/server";
import { handleCallback } from "./handler";
import type { CallbackDeps } from "./handler";

const ORIGIN = "https://atelier.example.test";

function deps(over: Partial<CallbackDeps> & { exchanged?: string[] } = {}): CallbackDeps {
  return {
    exchange: async (code) => {
      over.exchanged?.push(code);
      return { ok: true };
    },
    consumeNext: async (fallback) => fallback,
    origin: () => ORIGIN,
    ...over,
  };
}
const get = (query: string) => new Request(`http://internal.test/auth/callback${query}`);

describe("GET /auth/callback", () => {
  it("exchanges the code and sends the person on to the saved path", async () => {
    const exchanged: string[] = [];
    const res = await handleCallback(get("?code=abc"), deps({ exchanged, consumeNext: async () => "/picks" }));
    expect(exchanged).toEqual(["abc"]);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`${ORIGIN}/picks`);
  });

  it("falls back to the saved list when nothing was kept", async () => {
    const res = await handleCallback(get("?code=abc"), deps());
    expect(res.headers.get("location")).toBe(`${ORIGIN}/saved`);
  });

  it("uses the site origin from the server, not the request's host", async () => {
    const res = await handleCallback(new Request("http://evil.example.test/auth/callback?code=abc"), deps());
    expect(res.headers.get("location")?.startsWith(ORIGIN)).toBe(true);
  });

  it("never lets the response be cached, and lets the route add the session headers", async () => {
    const res = await handleCallback(get("?code=abc"), deps());
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    // The redirect's headers must be writable: applyAuthHeaders sets what the session client asked for.
    expect(() => applyAuthHeaders(res, { "Cache-Control": "private, no-store", Expires: "0" })).not.toThrow();
    expect(res.headers.get("expires")).toBe("0");
  });

  it("sends a missing code, a provider error or a failed exchange back to sign-in with a fixed message code", async () => {
    const cases: [string, Partial<CallbackDeps>][] = [
      ["", {}],
      ["?code=abc&error=access_denied&error_description=secret+words", {}],
      ["?code=abc", { exchange: async () => ({ ok: false }) }],
      ["?code=abc", { exchange: async () => Promise.reject(new Error("boom")) }],
    ];
    for (const [query, over] of cases) {
      const res = await handleCallback(get(query), deps({ ...over, consumeNext: async () => "/picks" }));
      expect(res.status).toBe(303);
      const location = new URL(res.headers.get("location")!);
      expect(location.pathname).toBe("/auth/sign-in");
      expect(location.searchParams.get("error")).toBe("link");
      // The person's destination survives, and nothing the provider said is repeated.
      expect(location.searchParams.get("next")).toBe("/picks");
      expect(location.search).not.toMatch(/secret|access_denied|boom/);
    }
  });

  it("falls back to the request's origin when SITE_URL is not usable", async () => {
    const res = await handleCallback(get("?code=abc"), deps({ origin: () => { throw new Error("no site url"); } }));
    expect(res.headers.get("location")).toBe("http://internal.test/saved");
  });
});
