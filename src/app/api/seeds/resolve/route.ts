import { createQlooClient } from "@/lib/qloo/client";
import { handleResolve } from "@/lib/seeds/handler";

// Server-side only: the Qloo client (and its key) never reach the browser. File cache needs the Node runtime.
export const runtime = "nodejs";

/** POST /api/seeds/resolve  { field, query }  ->  { status, entity?, candidates } */
export async function POST(request: Request): Promise<Response> {
  return handleResolve(request, { createClient: () => createQlooClient() });
}
