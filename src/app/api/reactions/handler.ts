// POST /api/reactions and PUT /api/reactions/<pickId>: save a pick with the person's reaction, and change it later.
// Kept out of the route files because a Next route file may export only handlers and route config.
//
// Only a signed-in person saves: a guest gets 401 `sign_in_required` and nothing is written. Every database call goes
// through the cookie-bound client (anon key plus the person's session), so row-level security applies: a person can
// only ever write and read their own rows. The service-role client is never used here. Qloo is never called: a saved
// pick is stored exactly as the run produced it (its path and card), and reopening it reads that and nothing else.
//
// What the browser sends is checked, rebuilt from the fields the contracts list, and its taste numbers are dropped:
// a public pick has none, and the path's explainability contribution is set to null whatever was sent (hard rule 7).
//
// Responses never carry database text, a key, or Qloo data: a fixed code and sentence per failure.

import { isAxis, isCard, isField, isBand, isOrigin, isPath, isSeed, REACTION_STATES } from "@/types";
import type { Card, Pick, ReactionState } from "@/types";
import { AuthRequiredError } from "@/lib/db/auth";
import type { AuthUser } from "@/lib/db/auth";
import { DbMappingError } from "@/lib/db/mappers";
import type { ReactionInput } from "@/lib/db/mappers";
import { DbLimitError, DbWriteError, saveProfileSnapshot, saveReaction, savePicks, saveSeeds } from "@/lib/db/saves";
import {
  MAX_TAG_NAME_CHARS,
  WHY_TAGS_PER_SEED,
  RUN_MAX_AXES,
  RUN_MAX_TAGS,
  MAX_ID_CHARS,
  MAX_REACTION_WORDS,
  MAX_SAVE_BODY_CHARS,
  MAX_SAVE_ITEMS,
  MAX_SEEDS_PER_USER,
} from "@/lib/agent/config";
import { REACTION_HOWS } from "@/lib/db/constants";
import { DbConfigError } from "@/lib/db/server";
import type { AtelierClient } from "@/lib/db/server";
import { readProfileShape } from "@/components/onboarding/check";
import { parsePlan } from "@/app/api/run/handler";
import { json, readJson } from "@/lib/profile/http";
import { cleanWhyTags } from "@/lib/profile/tags";
import type { ProfileSeed } from "@/lib/profile/types";
import type { SaveErrorCode, SnapshotWire } from "@/components/reactions/wire";

export interface ReactionsDeps {
  /** The cookie-bound client. The route passes one that collects the auth headers to put on the response. */
  createClient: () => Promise<AtelierClient>;
  /** Throws `AuthRequiredError` for a guest. */
  requireUser: (client: AtelierClient) => Promise<AuthUser>;
}

const MESSAGE: Record<SaveErrorCode, string> = {
  sign_in_required: "Sign in to save. Guests can explore but not save.",
  not_ready: "Saving is not switched on yet.",
  bad_request: "That could not be saved as sent.",
  seed_missing: "A pick must be saved with the seed it came from.",
  too_many_seeds: "Your account already keeps as many seeds as it can hold.",
  not_found: "That pick is not in your saved picks.",
  save_failed: "That did not save. Try again in a moment.",
};

const STATUS: Record<SaveErrorCode, number> = {
  sign_in_required: 401,
  not_ready: 503,
  bad_request: 400,
  seed_missing: 422,
  too_many_seeds: 422,
  not_found: 404,
  save_failed: 500,
};

function refuse(code: SaveErrorCode): Response {
  return json({ error: { code, message: MESSAGE[code] } }, STATUS[code]);
}

/** A thrown error as a fixed response. Never repeats what the database said. */
export function describeSaveError(err: unknown): Response {
  if (err instanceof AuthRequiredError) return refuse("sign_in_required");
  if (err instanceof DbConfigError) return refuse("not_ready");
  if (err instanceof DbMappingError) return refuse("bad_request");
  if (err instanceof DbLimitError) return refuse("too_many_seeds");
  // 23503 is a foreign-key failure: the pick's seed was not among the seeds sent.
  if (err instanceof DbWriteError && err.message.includes("23503")) return refuse("seed_missing");
  return refuse("save_failed");
}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const isId = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= MAX_ID_CHARS;
const isState = (v: unknown): v is ReactionState => typeof v === "string" && (REACTION_STATES as readonly string[]).includes(v);

/**
 * The person's words: a string, trimmed and capped, where "" means "clear them". Anything that is not a string is
 * absent, and absent keeps what is stored (the database merges).
 */
function readWords(v: unknown): string | undefined {
  return typeof v === "string" ? v.trim().slice(0, MAX_REACTION_WORDS) : undefined;
}

/** The profile, axes and plan kept with a save, or null when any part is not what the run produced. */
export function readSnapshot(v: unknown): SnapshotWire | null {
  if (!isRec(v)) return null;
  const profile = readProfileShape(v.profile);
  if (!profile || profile.tags.length > RUN_MAX_TAGS) return null;
  if (!Array.isArray(v.axes) || v.axes.length > RUN_MAX_AXES || !v.axes.every(isAxis)) return null;
  let plan: SnapshotWire["plan"] = null;
  if (v.plan !== null && v.plan !== undefined) {
    const parsed = parsePlan(v.plan);
    if (typeof parsed === "string") return null;
    plan = parsed;
  }
  return { profile, axes: v.axes, plan };
}

/** One seed as the run took it, with the tag ids its reason mapped to. Null when malformed. */
export function readSeed(v: unknown): { seed: ProfileSeed; tagIds: string[] } | null {
  if (!isSeed(v) || !isId(v.id)) return null;
  const raw = (v as unknown as Rec).whyTags;
  let tagIds: string[] = [];
  if (raw !== undefined) {
    const tags = cleanWhyTags(raw, WHY_TAGS_PER_SEED, MAX_TAG_NAME_CHARS);
    if (!tags) return null;
    tagIds = tags.map((t) => t.tag);
  }
  const { id, field, typed, why, qlooId, status } = v;
  return { seed: { id, field, typed, why, qlooId, status }, tagIds };
}

// The path as stored carries no explainability contribution, whatever the caller sent.
const publicPath = (p: Pick["path"]): Pick["path"] => ({ ...p, anchor: { ...p.anchor, contribution: null } });

/** One pick as a `Pick` for `savePicks`. The numbers the type asks for are placeholders: the mapper stores none of them. */
export function readSavePick(v: unknown): Pick | null {
  if (!isRec(v)) return null;
  if (!isId(v.id) || typeof v.name !== "string" || v.name.length === 0 || v.name.length > 300) return null;
  if (typeof v.qlooId !== "string" || v.qlooId.length > MAX_ID_CHARS) return null;
  if (!isField(v.field) || !isBand(v.band) || typeof v.llmBridged !== "boolean") return null;
  const origin = v.origin === undefined ? "unknown" : v.origin;
  if (!isOrigin(origin) || !isPath(v.path) || !isCard(v.card)) return null;
  const path = publicPath(v.path);
  const { why, different, provenance, reading } = v.card;
  const card: Card = { path: publicPath(v.card.path), why, different, provenance, ...(reading ? { reading } : {}) };
  return {
    id: v.id,
    qlooId: v.qlooId,
    name: v.name,
    field: v.field,
    band: v.band,
    llmBridged: v.llmBridged,
    origin,
    path,
    card,
    popularity: 0,
    reach: { tagDistance: 0, obscurity: 0, fieldUnfamiliarity: 0, reach: 0 },
    connection: 0,
  };
}

export interface ParsedSave {
  snapshot: SnapshotWire | null;
  seeds: ProfileSeed[];
  whyTagIds: Record<string, string[]>;
  items: { pick: Pick; reaction: ReactionInput }[];
}

/** The save body, or the code to refuse it with. */
export function parseSaveBody(body: unknown): ParsedSave | SaveErrorCode {
  if (!isRec(body) || !Array.isArray(body.seeds) || !Array.isArray(body.items)) return "bad_request";
  if (body.seeds.length > MAX_SEEDS_PER_USER || body.items.length < 1 || body.items.length > MAX_SAVE_ITEMS) return "bad_request";
  const seeds: ProfileSeed[] = [];
  const whyTagIds: Record<string, string[]> = {};
  for (const raw of body.seeds) {
    const r = readSeed(raw);
    if (!r) return "bad_request";
    seeds.push(r.seed);
    whyTagIds[r.seed.id] = r.tagIds;
  }
  if (new Set(seeds.map((s) => s.id)).size !== seeds.length) return "bad_request";
  let snapshot: SnapshotWire | null = null;
  if (body.snapshot !== undefined) {
    snapshot = readSnapshot(body.snapshot);
    if (!snapshot) return "bad_request";
  }
  const items: ParsedSave["items"] = [];
  const seen = new Set<string>();
  for (const raw of body.items) {
    if (!isRec(raw) || !isRec(raw.reaction) || !isState(raw.reaction.state)) return "bad_request";
    const pick = readSavePick(raw.pick);
    if (!pick || seen.has(pick.id)) return "bad_request";
    seen.add(pick.id);
    // Every pick has a stored path that starts at one of the person's seeds, and that seed is saved with it.
    if (!seeds.some((s) => s.id === pick.path.seedId)) return "seed_missing";
    const words = readWords(raw.reaction.words);
    items.push({ pick, reaction: { state: raw.reaction.state, ...(words !== undefined ? { words } : {}) } });
  }
  return { snapshot, seeds, whyTagIds, items };
}

export interface ParsedUpdate {
  reaction: ReactionInput;
  addSeed: { seed: ProfileSeed; tagIds: string[] } | null;
}

export function parseUpdateBody(body: unknown): ParsedUpdate | SaveErrorCode {
  if (!isRec(body) || !isState(body.state)) return "bad_request";
  if (body.tried !== undefined && typeof body.tried !== "boolean") return "bad_request";
  if (body.how !== undefined && body.how !== null && !(REACTION_HOWS as readonly unknown[]).includes(body.how)) return "bad_request";
  const words = readWords(body.words);
  // Only what the body carries is passed on: the database keeps the stored value for anything absent.
  const reaction: ReactionInput = {
    state: body.state,
    ...(words !== undefined ? { words } : {}),
    ...(typeof body.tried === "boolean" ? { tried: body.tried } : {}),
    ...(body.how !== undefined ? { how: body.how as ReactionInput["how"] } : {}),
  };
  let addSeed: ParsedUpdate["addSeed"] = null;
  if (body.addSeed !== undefined) {
    const r = readSeed(body.addSeed);
    if (!r || r.seed.status !== "clean" || !r.seed.qlooId) return "bad_request";
    addSeed = r;
  }
  return { reaction, addSeed };
}

function isJson(request: Request): boolean {
  return (request.headers.get("content-type") ?? "").toLowerCase().includes("application/json");
}

/** POST: save the seeds and picks of a run, with a reaction on each pick. Safe to repeat (upserts). */
export async function handleSave(request: Request, deps: ReactionsDeps): Promise<Response> {
  try {
    const client = await deps.createClient();
    const user = await deps.requireUser(client);
    // A form on another site cannot send application/json without a preflight, so this closes the simple-POST route.
    if (!isJson(request)) return refuse("bad_request");
    const raw = await readJson(request, MAX_SAVE_BODY_CHARS, "{seeds, items}");
    if (raw instanceof Response) return raw;
    const parsed = parseSaveBody(raw);
    if (typeof parsed === "string") return refuse(parsed);
    await saveSeeds(client, user, parsed.seeds, parsed.whyTagIds);
    if (parsed.snapshot) await saveProfileSnapshot(client, user, parsed.snapshot);
    await savePicks(client, user, parsed.items.map((i) => i.pick));
    for (const item of parsed.items) await saveReaction(client, user, item.pick.id, item.reaction);
    return json({ saved: parsed.items.length, userId: user.id }, 200);
  } catch (err) {
    return describeSaveError(err);
  }
}

/** PUT: change the reaction on a pick the person already saved, or record the follow-up (tried, how it went, why). */
export async function handleUpdate(request: Request, pickId: string, deps: ReactionsDeps): Promise<Response> {
  try {
    const client = await deps.createClient();
    const user = await deps.requireUser(client);
    if (!isJson(request)) return refuse("bad_request");
    if (!isId(pickId)) return refuse("bad_request");
    const raw = await readJson(request, MAX_SAVE_BODY_CHARS, "{state, words?, tried?, liked?, addSeed?}");
    if (raw instanceof Response) return raw;
    const parsed = parseUpdateBody(raw);
    if (typeof parsed === "string") return refuse(parsed);
    // Only the person's own pick: the query is filtered to them, and row-level security says the same.
    const found = await client.from("picks").select("id").eq("user_id", user.id).eq("id", pickId).maybeSingle();
    if (found.error) return refuse("save_failed");
    if (!found.data) return refuse("not_found");
    if (parsed.addSeed) await saveSeeds(client, user, [parsed.addSeed.seed], { [parsed.addSeed.seed.id]: parsed.addSeed.tagIds });
    await saveReaction(client, user, pickId, parsed.reaction);
    return json({ ok: true, userId: user.id }, 200);
  } catch (err) {
    return describeSaveError(err);
  }
}

/** PUT: keep the profile, axes and plan on the account (after a follow-up changed the plan). */
export async function handleSnapshot(request: Request, deps: ReactionsDeps): Promise<Response> {
  try {
    const client = await deps.createClient();
    const user = await deps.requireUser(client);
    if (!isJson(request)) return refuse("bad_request");
    const raw = await readJson(request, MAX_SAVE_BODY_CHARS, "{profile, axes, plan}");
    if (raw instanceof Response) return raw;
    const snapshot = readSnapshot(raw);
    if (!snapshot) return refuse("bad_request");
    await saveProfileSnapshot(client, user, snapshot);
    return json({ ok: true }, 200);
  } catch (err) {
    return describeSaveError(err);
  }
}

/** GET: who is signed in, for the page that offers a guest's waiting picks. A guest, or no Supabase here, is `null`. */
export async function handleSession(deps: ReactionsDeps): Promise<Response> {
  try {
    const client = await deps.createClient();
    const user = await deps.requireUser(client);
    return json({ userId: user.id }, 200);
  } catch (err) {
    if (err instanceof AuthRequiredError || err instanceof DbConfigError) return json({ userId: null }, 200);
    return refuse("save_failed");
  }
}
