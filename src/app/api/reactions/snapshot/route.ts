import { requireUser } from "@/lib/db/auth";
import { applyAuthHeaders, createUserClient } from "@/lib/db/server";
import { handleSnapshot } from "../handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** PUT /api/reactions/snapshot  { profile, axes, plan }  ->  { ok }. See ../handler.ts. */
export async function PUT(request: Request): Promise<Response> {
  const headers: Record<string, string> = {};
  const response = await handleSnapshot(request, {
    createClient: () => createUserClient({ onHeaders: (h) => Object.assign(headers, h) }),
    requireUser,
  });
  return applyAuthHeaders(response, headers);
}
