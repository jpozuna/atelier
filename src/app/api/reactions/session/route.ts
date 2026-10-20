import { requireUser } from "@/lib/db/auth";
import { applyAuthHeaders, createUserClient } from "@/lib/db/server";
import { handleSession } from "../handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/reactions/session  ->  { userId } (null for a guest). Reads the cookie; spends nothing. */
export async function GET(): Promise<Response> {
  const headers: Record<string, string> = {};
  const response = await handleSession({
    createClient: () => createUserClient({ onHeaders: (h) => Object.assign(headers, h) }),
    requireUser,
  });
  return applyAuthHeaders(response, headers);
}
