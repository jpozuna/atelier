// Supabase clients for server code. Two kinds, never mixed up:
//   createUserClient    anon key + the visitor's session cookie. Subject to RLS. Use for anything a user does.
//   createServiceClient service role. Bypasses RLS. Use only for qloo_cache and trusted server jobs.
// The service-role key is read here and nowhere else, and never from a NEXT_PUBLIC_* variable.

import "server-only";

import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import type { Database } from "./database.types";

export type AtelierClient = SupabaseClient<Database>;

/** Missing or unusable Supabase configuration. The message names the variable, never a value. */
export class DbConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DbConfigError";
  }
}

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new DbConfigError(`${name} is not set. Copy .env.example to .env and fill in the Supabase values.`);
  return v;
}

export interface UserClientOptions {
  /**
   * Receives the response headers @supabase/ssr asks for alongside a cookie write (Cache-Control: private, no-store,
   * so a CDN never caches a response that carries a session cookie). Called from `setAll`, which can run lazily
   * during any auth call, so apply what it collects to your response AFTER the client has been used. Not called
   * when no cookie is written. Use `applyAuthHeaders(response, headers)`.
   */
  onHeaders?: (headers: Record<string, string>) => void;
}

/** Set the headers collected through `onHeaders` on a Response (a Route Handler's return value). */
export function applyAuthHeaders(response: Response, headers: Record<string, string>): Response {
  for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
  return response;
}

/**
 * Cookie-bound client for a request (Next 16: async `cookies()`).
 *
 * Where it may be used: in a Route Handler or Server Action it can read and write the session cookie. In a Server
 * Component cookies are read-only, so a refreshed session is NOT persisted there (the write is swallowed). Session
 * refresh therefore needs a Next 16 proxy (proxy.ts) that creates a client over the request and response; that is a
 * future ticket. The `/auth/callback` route handler and that proxy must set the headers `onHeaders` receives
 * (`Cache-Control: private, no-store`) on the response they return, or the session cookie could be cached.
 */
export async function createUserClient(options: UserClientOptions = {}): Promise<AtelierClient> {
  const store = await cookies();
  return createServerClient<Database>(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"), {
    cookies: {
      getAll: () => store.getAll(),
      setAll(list, headers) {
        try {
          for (const { name, value, options: cookieOptions } of list) store.set(name, value, cookieOptions);
        } catch {
          // Called from a Server Component, where cookies are read-only. Safe to ignore: a Route Handler or
          // Server Action refreshes the session cookie on the next request that can write it.
        }
        if (headers && Object.keys(headers).length > 0) options.onHeaders?.(headers);
      },
    },
  });
}

/** Service-role client with no session. Never hand it to code that acts for a user. */
export function createServiceClient(): AtelierClient {
  return createClient<Database>(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
