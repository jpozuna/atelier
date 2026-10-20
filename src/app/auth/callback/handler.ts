// GET /auth/callback: the page the magic link lands on. Swaps the one-time `code` for a session cookie, then sends the
// person where they were going (the path `sendMagicLink` kept in an httpOnly cookie, checked again as a site-relative
// path), or back to sign-in with a fixed message when the link did not work. Kept out of route.ts because a Next
// route file may export only handlers and route config.
//
// The response carries the session cookie, so it must never be cached: the headers @supabase/ssr asks for are applied
// by route.ts, and `Cache-Control: private, no-store` is set here whatever happens.

import { SAVED_PATH, SIGN_IN_PATH } from "@/components/reactions/constants";

export interface CallbackDeps {
  exchange: (code: string) => Promise<{ ok: boolean }>;
  /** The saved post-sign-in path (and clears it), or the fallback. */
  consumeNext: (fallback: string) => Promise<string>;
  /** The site's own origin (SITE_URL), so a forged Host header cannot send the person elsewhere. */
  origin: () => string;
}

function redirect(url: string): Response {
  return new Response(null, { status: 303, headers: { Location: url, "Cache-Control": "private, no-store" } });
}

export async function handleCallback(request: Request, deps: CallbackDeps): Promise<Response> {
  const url = new URL(request.url);
  let origin: string;
  try {
    origin = deps.origin();
  } catch {
    origin = url.origin;
  }
  const code = url.searchParams.get("code");
  // The provider reports a bad or expired link as `error` parameters. They are never repeated back.
  const providerError = url.searchParams.get("error") ?? url.searchParams.get("error_code");

  let ok = false;
  if (code && !providerError) {
    try {
      ok = (await deps.exchange(code)).ok;
    } catch {
      ok = false;
    }
  }
  if (ok) return redirect(new URL(await deps.consumeNext(SAVED_PATH), origin).toString());

  const back = new URL(SIGN_IN_PATH, origin);
  back.searchParams.set("error", "link");
  const next = await deps.consumeNext("").catch(() => "");
  if (next) back.searchParams.set("next", next);
  return redirect(back.toString());
}
