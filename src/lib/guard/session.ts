// Supabase session refresh for the proxy. A Server Component cannot write cookies, so an expired access token is only
// renewed here, on the way in, and the renewed cookies are put on both the request (so the page being rendered sees
// them) and the response (so the browser keeps them). This follows the T-06 contract in src/lib/db/server.ts:
// the headers @supabase/ssr hands to `setAll` (Cache-Control: private, no-store) are applied to the response, so a
// CDN never caches a response that carries a session cookie.
//
// Never throws and never blocks a request: no Supabase config, no session cookie, or an auth outage all mean
// "continue as a guest". Only the anon key is used here; the service role is never read in the proxy.

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { applyAuthHeaders } from "@/lib/db/server";

/** @supabase/ssr stores the session in `sb-<project>-auth-token`, split into `.0`, `.1`... when large. */
const SESSION_COOKIE = /^sb-.+-auth-token(\.\d+)?$/;

export type SessionEnv = Record<string, string | undefined>;

export function hasSessionCookie(request: NextRequest): boolean {
  return request.cookies.getAll().some((c) => SESSION_COOKIE.test(c.name));
}

/** Pass the request on, refreshing the Supabase session first when there is one. */
export async function refreshSession(request: NextRequest, env: SessionEnv = process.env): Promise<NextResponse> {
  let response = NextResponse.next({ request });
  const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey || !hasSessionCookie(request)) return response;

  let authHeaders: Record<string, string> | undefined;
  try {
    const supabase = createServerClient(url, anonKey, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(list, headers) {
          for (const { name, value } of list) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of list) response.cookies.set(name, value, options);
          if (headers && Object.keys(headers).length > 0) authHeaders = headers;
        },
      },
    });
    // getClaims verifies the token and renews it when it is about to expire. Do not run other code between creating
    // the client and this call.
    await supabase.auth.getClaims();
  } catch {
    // An auth outage must not take the demo down; the visitor continues as a guest.
  }
  if (authHeaders) applyAuthHeaders(response, authHeaders);
  return response;
}
