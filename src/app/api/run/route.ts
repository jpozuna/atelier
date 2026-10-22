import { createQlooClient } from "@/lib/qloo/client";
import { createLlm, createLlmCache } from "@/lib/agent/llm";
import { createRefsContext } from "@/lib/refs";
import { activeRegistry } from "@/lib/qloo/synthetic";
import { prepareInsights } from "@/lib/qloo/validate";
import { handleRun } from "./handler";

// Server-side only: the Qloo key and the Anthropic key never reach the browser. The Qloo file cache needs Node.
export const runtime = "nodejs";
// A run streams for tens of seconds (six pools, model calls, a few lookups). Never statically optimised or cached.
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// One in-memory cache of model replies per server process, so a repeat run of the same profile makes no model call.
const llmCache = createLlmCache();
const active = { count: 0 };

/**
 * POST /api/run  { seeds, profile, axes, exclude?, plan?, domains? }  ->  server-sent events: trace*, then result (or error), then done.
 * Per request: one Qloo client, one refs context, one model client.
 */
export async function POST(request: Request): Promise<Response> {
  return handleRun(request, {
    createRunDeps: (onTrace) => {
      const client = createQlooClient({ onTrace });
      return {
        insights: (params, opts) => client.insights(params, opts),
        // Checked before any model call: a request the client would refuse (a closed POST body gate) costs no model spend.
        preflight: (params, opts) => void prepareInsights(params, activeRegistry(), { purpose: opts.purpose }),
        refs: createRefsContext(),
        llm: createLlm(process.env, { cache: llmCache }),
        qlooStats: () => {
          const s = client.stats();
          return { liveCalls: s.liveCalls, cacheHits: s.cacheHits };
        },
      };
    },
    active,
  });
}
