import { consumeNextPath, exchangeAuthCode, getSiteOrigin } from "@/lib/db/auth";
import { applyAuthHeaders, createUserClient } from "@/lib/db/server";
import { handleCallback } from "./handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /auth/callback?code=...  ->  303 to where the person was going. See handler.ts. */
export async function GET(request: Request): Promise<Response> {
  const headers: Record<string, string> = {};
  const client = await createUserClient({ onHeaders: (h) => Object.assign(headers, h) });
  const response = await handleCallback(request, {
    exchange: (code) => exchangeAuthCode(code, client),
    consumeNext: (fallback) => consumeNextPath(fallback),
    origin: getSiteOrigin,
  });
  // The session cookie is set while the code is exchanged; the headers it asked for go on this response.
  return applyAuthHeaders(response, headers);
}
