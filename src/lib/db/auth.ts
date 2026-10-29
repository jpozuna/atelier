// Server auth helpers.
//
// Where to call what: `sendMagicLink` and `signOut` write cookies, so call them from a Route Handler or Server
// Action only. `getSessionState`, `getCurrentUser` and `requireUser` only read, so they also work in Server
// Components, but a Server Component cannot persist a refreshed session: that needs a Next 16 proxy (future ticket).
//
// A guest is a visitor with no Supabase session: they can run onboarding and see picks, because those paths never touch
// the database. The first save gives a guest an anonymous account (`ensureUser()`): no email, kept by the session
// cookie in that browser. Everything after that calls `requireUser()`, which treats an anonymous account as a user.
// Signing in by magic link (email, no password) stays available for anyone who wants their saves on another device.

import "server-only";

import { cookies } from "next/headers";
import { AUTH_CALLBACK_PATH, NEXT_PATH_COOKIE } from "./constants";
import { createUserClient, DbConfigError, type AtelierClient } from "./server";

export interface AuthUser {
  id: string;
  email: string | null;
  /** An anonymous account made by the first save: no email, lives in this browser only. */
  anonymous?: true;
}

export type SessionState = { kind: "guest" } | { kind: "user"; user: AuthUser };

/** Thrown by `requireUser` for a guest. Route handlers map it to 401. */
export class AuthRequiredError extends Error {
  readonly status = 401;
  constructor(message = "Sign in to save. Guests can explore but not save.") {
    super(message);
    this.name = "AuthRequiredError";
  }
}

type ClientSource = AtelierClient | undefined;
const resolve = (client: ClientSource): Promise<AtelierClient> | AtelierClient => client ?? createUserClient();

/**
 * Who is calling. Verified with `getClaims()` (the JWT is checked, the cookie alone is not trusted). A missing or
 * expired session is a guest; an anonymous session is a user marked `anonymous`. Never throws for auth failures.
 */
export async function getSessionState(client?: AtelierClient): Promise<SessionState> {
  const supabase = await resolve(client);
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (error || !claims || typeof claims.sub !== "string" || claims.sub.length === 0) return { kind: "guest" };
  const user: AuthUser = { id: claims.sub, email: typeof claims.email === "string" ? claims.email : null };
  if (claims.is_anonymous === true) user.anonymous = true;
  return { kind: "user", user };
}

/** The signed-in user, or null for a guest. */
export async function getCurrentUser(client?: AtelierClient): Promise<AuthUser | null> {
  const state = await getSessionState(client);
  return state.kind === "user" ? state.user : null;
}

/** The signed-in user. Throws `AuthRequiredError` for a guest. Call this before any save. */
export async function requireUser(client?: AtelierClient): Promise<AuthUser> {
  const user = await getCurrentUser(client);
  if (!user) throw new AuthRequiredError();
  return user;
}

/**
 * The person saving: the current user, or for a guest a new anonymous account, so saving never needs an email. RUN
 * THIS ONLY IN A ROUTE HANDLER OR SERVER ACTION: it writes the session cookie, and the same client then carries the new
 * session for the writes that follow. Throws `AuthRequiredError` when Supabase refuses (anonymous sign-ins switched
 * off, or its rate limit), so the guest is asked to sign in as before.
 */
export async function ensureUser(client?: AtelierClient): Promise<AuthUser> {
  const supabase = await resolve(client);
  const user = await getCurrentUser(supabase);
  if (user) return user;
  const { data, error } = await supabase.auth.signInAnonymously();
  const id = data?.user?.id;
  if (error || !id) throw new AuthRequiredError();
  return { id, email: null, anonymous: true };
}

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type MagicLinkResult = { ok: true } | { ok: false; reason: "invalid_email" | "rate_limited" | "failed" };

/**
 * Keep a post-login redirect on this site. Accepts only an absolute path ("/saved"), never "//host" or a scheme,
 * and falls back otherwise.
 */
export function safeNextPath(next: string | null | undefined, fallback = "/"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return fallback;
  if (/[\u0000-\u001f]/.test(next)) return fallback;
  return next;
}

/**
 * The site origin magic links return to, from the SITE_URL env var (never from the request, so a forged Host or
 * Origin header cannot redirect a sign-in elsewhere). Must be an origin: https, or http on localhost/127.0.0.1,
 * with no credentials. A path, query or hash on the value is dropped. Throws `DbConfigError` if missing or invalid.
 */
export function getSiteOrigin(): string {
  const raw = process.env.SITE_URL?.trim();
  if (!raw) throw new DbConfigError("SITE_URL is not set. Add the site's origin (for example http://localhost:3000) to .env.");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new DbConfigError("SITE_URL is not a valid URL.");
  }
  const localHost = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.username || url.password || !(url.protocol === "https:" || (url.protocol === "http:" && localHost))) {
    throw new DbConfigError("SITE_URL must be https (http only for localhost) and carry no credentials.");
  }
  return url.origin;
}

/** The slice of Next's cookie store these helpers use, so tests can pass a fake. */
export interface CookieJar {
  get(name: string): { value: string } | undefined;
  set(name: string, value: string, options?: Record<string, unknown>): unknown;
  delete(name: string): unknown;
}

export interface MagicLinkDeps {
  client?: AtelierClient;
  /** Default: Next's `cookies()`. */
  cookies?: CookieJar;
}

/**
 * Send a magic-link email. RUN THIS ONLY IN A ROUTE HANDLER OR SERVER ACTION: the PKCE sign-in stores a code
 * verifier cookie, and a Server Component cannot write cookies (the link would then fail to complete).
 *
 * The link goes to the fixed callback `${SITE_URL}/auth/callback` with no query string, so it matches a Supabase
 * redirect allow-list entry exactly whatever the user was doing. The post-sign-in path travels in a short-lived
 * httpOnly cookie instead (`NEXT_PATH_COOKIE`); the callback reads it with `consumeNextPath()`. PKCE also means the
 * link must be opened in the same browser that asked for it.
 *
 * A new address creates the account on first click. The result never says whether the address already had one.
 */
export async function sendMagicLink(
  input: { email: string; next?: string | null },
  deps: MagicLinkDeps = {},
): Promise<MagicLinkResult> {
  const email = input.email.trim().toLowerCase();
  if (!EMAIL_SHAPE.test(email)) return { ok: false, reason: "invalid_email" };

  const origin = getSiteOrigin();
  const next = safeNextPath(input.next, "");
  const jar = deps.cookies ?? (await cookies());
  if (next) {
    jar.set(NEXT_PATH_COOKIE, next, { httpOnly: true, sameSite: "lax", secure: origin.startsWith("https:"), path: "/" });
  } else {
    jar.delete(NEXT_PATH_COOKIE);
  }

  const supabase = await resolve(deps.client);
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: new URL(AUTH_CALLBACK_PATH, origin).toString(), shouldCreateUser: true },
  });
  if (!error) return { ok: true };
  const rateLimited = error.status === 429 || error.code === "over_email_send_rate_limit";
  return { ok: false, reason: rateLimited ? "rate_limited" : "failed" };
}

/** For the callback route: the saved post-sign-in path (validated again), and clear the cookie. */
export async function consumeNextPath(fallback = "/", jarOverride?: CookieJar): Promise<string> {
  const jar = jarOverride ?? (await cookies());
  const value = jar.get(NEXT_PATH_COOKIE)?.value;
  if (value !== undefined) jar.delete(NEXT_PATH_COOKIE);
  return safeNextPath(value, fallback);
}

/** Finish a magic-link (PKCE) sign-in from the callback route: swaps the `code` query param for a session cookie. */
export async function exchangeAuthCode(code: string, client?: AtelierClient): Promise<{ ok: boolean }> {
  if (!code) return { ok: false };
  const supabase = await resolve(client);
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  return { ok: !error };
}

/** End the session (clears the cookie through the client's cookie adapter). */
export async function signOut(client?: AtelierClient): Promise<void> {
  const supabase = await resolve(client);
  await supabase.auth.signOut();
}
