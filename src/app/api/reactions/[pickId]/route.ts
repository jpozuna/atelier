import { requireUser } from "@/lib/db/auth";
import { applyAuthHeaders, createUserClient } from "@/lib/db/server";
import { handleUpdate } from "../handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** PUT /api/reactions/<pickId>  { state, words?, tried?, liked?, addSeed? }  ->  { ok, userId }. See ../handler.ts. */
export async function PUT(request: Request, context: { params: Promise<{ pickId: string }> }): Promise<Response> {
  const { pickId } = await context.params;
  const headers: Record<string, string> = {};
  const response = await handleUpdate(request, pickId, {
    createClient: () => createUserClient({ onHeaders: (h) => Object.assign(headers, h) }),
    requireUser,
  });
  return applyAuthHeaders(response, headers);
}
