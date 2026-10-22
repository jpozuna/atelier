import { getRunLog } from "@/lib/runlog";
import { after } from "next/server";
import { requireUser } from "@/lib/db/auth";
import { applyAuthHeaders, createUserClient } from "@/lib/db/server";
import { handleSave } from "./handler";

// Per-person and cookie-bound: never cached, always Node (the Supabase client needs it).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/reactions  { seeds, items: [{ pick, reaction }] }  ->  { saved, userId }. See handler.ts. */
export async function POST(request: Request): Promise<Response> {
  const headers: Record<string, string> = {};
  const response = await handleSave(request, {
    createClient: () => createUserClient({ onHeaders: (h) => Object.assign(headers, h) }),
    requireUser,
    runLog: getRunLog(),
    afterResponse: (done) => after(done),
  });
  return applyAuthHeaders(response, headers);
}
