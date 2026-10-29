import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  AuthRequiredError,
  consumeNextPath,
  exchangeAuthCode,
  getCurrentUser,
  getSessionState,
  getSiteOrigin,
  ensureUser,
  requireUser,
  safeNextPath,
  sendMagicLink,
  signOut,
} from "./auth";
import { NEXT_PATH_COOKIE } from "./constants";
import { DbConfigError } from "./server";
import { createFakeAuthClient, createFakeJar } from "./testing";

const USER_A = "00000000-0000-4000-8000-000000000011";

describe("session state", () => {
  it("is a guest with no session", async () => {
    const { client } = createFakeAuthClient({ claims: null });
    expect(await getSessionState(client)).toEqual({ kind: "guest" });
    expect(await getCurrentUser(client)).toBeNull();
  });

  it("is a guest when the JWT does not verify", async () => {
    const { client } = createFakeAuthClient({ claimsError: true });
    expect(await getSessionState(client)).toEqual({ kind: "guest" });
  });

  it("is a guest for claims without a subject", async () => {
    expect((await getSessionState(createFakeAuthClient({ claims: { email: "x@example.com" } }).client)).kind).toBe("guest");
  });

  it("is a user marked anonymous for an anonymous Supabase session", async () => {
    const { client } = createFakeAuthClient({ claims: { sub: USER_A, is_anonymous: true } });
    expect(await getSessionState(client)).toEqual({ kind: "user", user: { id: USER_A, email: null, anonymous: true } });
  });

  it("is a user with a verified subject", async () => {
    const { client } = createFakeAuthClient({ claims: { sub: USER_A, email: "reader@example.com" } });
    expect(await getSessionState(client)).toEqual({ kind: "user", user: { id: USER_A, email: "reader@example.com" } });
    expect(await requireUser(client)).toEqual({ id: USER_A, email: "reader@example.com" });
  });

  it("requireUser rejects a guest with a 401 AuthRequiredError", async () => {
    const { client } = createFakeAuthClient({ claims: null });
    const err = await requireUser(client).catch((e) => e);
    expect(err).toBeInstanceOf(AuthRequiredError);
    expect(err.status).toBe(401);
  });
});

describe("ensureUser", () => {
  it("returns the current user without making an account", async () => {
    const fake = createFakeAuthClient({ claims: { sub: USER_A, email: "reader@example.com" }, anonymous: { id: "other" } });
    expect(await ensureUser(fake.client)).toEqual({ id: USER_A, email: "reader@example.com" });
    expect(fake.anonymousSignInCount()).toBe(0);
  });

  it("gives a guest an anonymous account", async () => {
    const fake = createFakeAuthClient({ claims: null, anonymous: { id: USER_A } });
    expect(await ensureUser(fake.client)).toEqual({ id: USER_A, email: null, anonymous: true });
    expect(fake.anonymousSignInCount()).toBe(1);
  });

  it("falls back to asking the guest to sign in when Supabase refuses", async () => {
    const fake = createFakeAuthClient({ claims: null });
    const err = await ensureUser(fake.client).catch((e) => e);
    expect(err).toBeInstanceOf(AuthRequiredError);
    expect(err.status).toBe(401);
  });
});

describe("site origin", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("comes from SITE_URL, reduced to an origin", () => {
    vi.stubEnv("SITE_URL", "https://atelier.example/some/path?x=1#h");
    expect(getSiteOrigin()).toBe("https://atelier.example");
    vi.stubEnv("SITE_URL", "http://localhost:3000/");
    expect(getSiteOrigin()).toBe("http://localhost:3000");
  });

  it.each(["", "nope", "javascript:alert(1)", "http://atelier.example", "https://user:pw@atelier.example", "ftp://localhost"])(
    "rejects %j with a config error",
    (v) => {
      vi.stubEnv("SITE_URL", v);
      expect(() => getSiteOrigin()).toThrow(DbConfigError);
    },
  );
});

describe("magic link", () => {
  beforeEach(() => vi.stubEnv("SITE_URL", "http://localhost:3000"));
  afterEach(() => vi.unstubAllEnvs());

  it("sends a link to the fixed callback from SITE_URL, with no query string", async () => {
    const f = createFakeAuthClient();
    const jar = createFakeJar();
    const res = await sendMagicLink({ email: "  Reader@Example.com ", next: "/saved" }, { client: f.client, cookies: jar });
    expect(res).toEqual({ ok: true });
    expect(f.otpCalls).toEqual([
      { email: "reader@example.com", options: { emailRedirectTo: "http://localhost:3000/auth/callback", shouldCreateUser: true } },
    ]);
  });

  it("carries next in an httpOnly cookie, and consumeNextPath reads it once", async () => {
    const f = createFakeAuthClient();
    const jar = createFakeJar();
    await sendMagicLink({ email: "a@example.com", next: "/saved?tab=1" }, { client: f.client, cookies: jar });
    expect(jar.store.get(NEXT_PATH_COOKIE)).toBe("/saved?tab=1");
    expect(jar.options.get(NEXT_PATH_COOKIE)).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/", secure: false });
    expect(await consumeNextPath("/", jar)).toBe("/saved?tab=1");
    expect(jar.store.has(NEXT_PATH_COOKIE)).toBe(false);
    expect(await consumeNextPath("/home", jar)).toBe("/home");
  });

  it("marks the cookie secure on https and drops a stale or unsafe next", async () => {
    vi.stubEnv("SITE_URL", "https://atelier.example");
    const f = createFakeAuthClient();
    const jar = createFakeJar();
    await sendMagicLink({ email: "a@example.com", next: "/saved" }, { client: f.client, cookies: jar });
    expect(jar.options.get(NEXT_PATH_COOKIE)).toMatchObject({ secure: true });
    await sendMagicLink({ email: "a@example.com", next: "//evil.example" }, { client: f.client, cookies: jar });
    expect(jar.store.has(NEXT_PATH_COOKIE)).toBe(false);
  });

  it("revalidates a tampered cookie when consuming it", async () => {
    const jar = createFakeJar();
    jar.store.set(NEXT_PATH_COOKIE, "https://evil.example");
    expect(await consumeNextPath("/home", jar)).toBe("/home");
  });

  it("rejects a bad email before calling Supabase, and throws when SITE_URL is missing", async () => {
    const f = createFakeAuthClient();
    const jar = createFakeJar();
    expect(await sendMagicLink({ email: "not an email" }, { client: f.client, cookies: jar })).toEqual({ ok: false, reason: "invalid_email" });
    vi.stubEnv("SITE_URL", "");
    await expect(sendMagicLink({ email: "a@example.com" }, { client: f.client, cookies: jar })).rejects.toThrow(DbConfigError);
    expect(f.otpCalls).toHaveLength(0);
  });

  it("maps provider errors to a small reason without echoing the message", async () => {
    const jar = createFakeJar();
    const limited = createFakeAuthClient({ otpError: { status: 429, code: "over_email_send_rate_limit", message: "rate" } });
    expect(await sendMagicLink({ email: "a@example.com" }, { client: limited.client, cookies: jar })).toEqual({ ok: false, reason: "rate_limited" });
    const other = createFakeAuthClient({ otpError: { status: 500, message: "boom for a@example.com" } });
    expect(await sendMagicLink({ email: "a@example.com" }, { client: other.client, cookies: jar })).toEqual({ ok: false, reason: "failed" });
  });
});

describe("callback and sign-out", () => {
  it("exchanges a code and reports failure", async () => {
    const ok = createFakeAuthClient();
    expect(await exchangeAuthCode("code-1", ok.client)).toEqual({ ok: true });
    expect(ok.exchangeCalls).toEqual(["code-1"]);
    expect(await exchangeAuthCode("code-2", createFakeAuthClient({ exchangeError: true }).client)).toEqual({ ok: false });
    const none = createFakeAuthClient();
    expect(await exchangeAuthCode("", none.client)).toEqual({ ok: false });
    expect(none.exchangeCalls).toHaveLength(0);
  });

  it("signs out", async () => {
    const f = createFakeAuthClient();
    await signOut(f.client);
    expect(f.signedOutCount()).toBe(1);
  });
});

describe("safeNextPath", () => {
  it("keeps same-site absolute paths", () => {
    expect(safeNextPath("/saved?tab=1", "/")).toBe("/saved?tab=1");
  });
  it.each(["//evil.example", "https://evil.example", "saved", "/\\evil", "/ok\nSet-Cookie: x", "", null, undefined])(
    "rejects %j",
    (v) => expect(safeNextPath(v as string | null | undefined, "/home")).toBe("/home"),
  );
});
