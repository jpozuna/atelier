import { createQlooClient } from "@/lib/qloo/client";
import { createAxisNamer } from "@/lib/profile/anthropic-namer";
import { handleProfile } from "@/lib/profile/handler";
import { createNameCache } from "@/lib/profile/naming";

// Server-side only: the Qloo client (and its key) and the Anthropic key never reach the browser. The file cache
// needs the Node runtime.
export const runtime = "nodejs";

// One in-memory cache per server process, so a repeat build makes no model call.
const nameCache = createNameCache();

/** POST /api/profile  { seeds: Seed[] (each with optional whyTags) }  ->  { profile, axes, trace, calls? } */
export async function POST(request: Request): Promise<Response> {
  return handleProfile(request, {
    createClient: (onTrace) => createQlooClient({ onTrace }),
    createNamer: () => createAxisNamer(),
    nameCache,
  });
}
