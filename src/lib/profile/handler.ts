// The POST /api/profile request handler. Kept out of route.ts because a Next route file may export only
// handlers and route config. Validates input, builds the profile, and maps failures to safe JSON errors.
// It makes ONE Qloo call (taste analysis) and no /v2/tags calls: why tags arrive on the seeds.
// It never returns raw Qloo JSON, Qloo error text, or any key.

import type { TraceEvent } from "@/types";
import { isSeed } from "@/types";
import type { QlooCallTraceEvent } from "@/lib/qloo/types";
import { buildProfile, ProfileInputError, type ProfileClient } from "./build";
import { MAX_BODY_CHARS, MAX_SEEDS, MAX_TAG_NAME_CHARS, WHY_TAGS_PER_SEED } from "./constants";
import { fail, json, qlooErrorResponse, readJson } from "./http";
import type { NameCache, AxisNamer } from "./naming";
import { cleanWhyTags } from "./tags";
import type { ProfileSeed } from "./types";

export interface ProfileHandlerDeps {
  /** One client per request. It must report its calls to `onTrace`. */
  createClient: (onTrace: (e: QlooCallTraceEvent) => void) => ProfileClient & { stats?: () => { liveCalls: number; cacheHits: number } };
  createNamer: () => AxisNamer;
  /** Process-wide, so a repeat build makes no model call. */
  nameCache?: NameCache;
  now?: () => Date;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Map a thrown error to a status and a fixed, safe message. */
export function errorResponse(err: unknown): Response {
  if (err instanceof ProfileInputError) {
    return fail(
      422,
      err.code,
      err.code === "no_usable_seeds" ? "Add at least one seed that has been matched to an entity." : "The taste graph returned nothing usable for these seeds. Try adding another seed.",
    );
  }
  return qlooErrorResponse(err);
}

function parseSeeds(body: unknown): ProfileSeed[] | string {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "Body must be JSON: {seeds: Seed[]}.";
  const seeds = (body as Record<string, unknown>).seeds;
  if (!Array.isArray(seeds) || seeds.length < 1) return "seeds must be a non-empty array.";
  if (seeds.length > MAX_SEEDS) return `At most ${MAX_SEEDS} seeds.`;
  const out: ProfileSeed[] = [];
  for (const s of seeds) {
    if (!isSeed(s)) return "Each seed must be {id, field, typed, why, qlooId, status, whyTags?}.";
    if (s.qlooId !== null && !UUID.test(s.qlooId)) return "qlooId must be an entity id.";
    const raw = (s as unknown as Record<string, unknown>).whyTags;
    if (raw === undefined) {
      out.push({ ...s });
      continue;
    }
    const whyTags = cleanWhyTags(raw, WHY_TAGS_PER_SEED, MAX_TAG_NAME_CHARS);
    if (!whyTags) return `whyTags must be at most ${WHY_TAGS_PER_SEED} items of {tag (urn:tag:...), name, tagType (urn:tag:<kind>:<namespace>)}.`;
    out.push({ ...s, whyTags });
  }
  if (new Set(out.map((s) => s.id)).size !== out.length) return "Seed ids must be unique.";
  return out;
}

export async function handleProfile(request: Request, deps: ProfileHandlerDeps): Promise<Response> {
  const body = await readJson(request, MAX_BODY_CHARS, "{seeds: Seed[]}");
  if (body instanceof Response) return body;
  const seeds = parseSeeds(body);
  if (typeof seeds === "string") return fail(400, "bad_request", seeds);

  const trace: TraceEvent[] = [];
  try {
    const client = deps.createClient((e) => trace.push(e));
    const { profile, axes } = await buildProfile(seeds, {
      client,
      namer: deps.createNamer(),
      nameCache: deps.nameCache,
      emit: (e) => trace.push(e),
      now: deps.now,
    });
    const stats = client.stats?.();
    return json({ profile, axes, trace, ...(stats ? { calls: { live: stats.liveCalls, cached: stats.cacheHits } } : {}) }, 200);
  } catch (err) {
    return errorResponse(err);
  }
}
