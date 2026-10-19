import { createQlooClient } from "@/lib/qloo/client";
import { handleWhy } from "@/lib/profile/why-handler";

// Server-side only: the Qloo client (and its key) never reach the browser. The file cache needs the Node runtime.
export const runtime = "nodejs";

/** POST /api/profile/why  { field, why, seedId? }  ->  { tags: WhyTag[], trace, calls? } */
export async function POST(request: Request): Promise<Response> {
  return handleWhy(request, { createClient: (onTrace) => createQlooClient({ onTrace }) });
}
