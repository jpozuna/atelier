// Request builders and response readers for the three routes onboarding calls. Pure: no fetch here, so the
// shapes are testable. Responses are checked at runtime and never trusted, and the server's own error text is
// never shown (copy.ts maps the error code to calm wording).

import { isAxis, isTraceEvent } from "@/types";
import type { Axis, Field, Profile, ProfileSeed, TraceEvent, WhyTag } from "./types";
import { MAX_CHIPS } from "./constants";
import { messageForError } from "./copy";
import { cleanWhyTags, isRec, readProfileShape } from "./check";
import type { Chip, SearchState } from "./flow";

export interface Req {
  url: string;
  init: { method: "POST"; headers: Record<string, string>; body: string };
}

const post = (url: string, body: unknown): Req => ({
  url,
  init: { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
});

export const RESOLVE_URL = "/api/seeds/resolve";
export const WHY_URL = "/api/profile/why";
export const PROFILE_URL = "/api/profile";

export const buildResolveRequest = (field: Field, query: string): Req => post(RESOLVE_URL, { field, query });
export const buildWhyRequest = (field: Field, why: string, seedId: string): Req => post(WHY_URL, { field, why, seedId });
export const buildProfileRequest = (seeds: readonly ProfileSeed[]): Req => post(PROFILE_URL, { seeds });

const isStr = (v: unknown): v is string => typeof v === "string" && v.length > 0;

/** The error code from `{ error: { code, message } }`, if the body has one. */
export function errorCode(body: unknown): string | undefined {
  if (!isRec(body) || !isRec(body.error)) return undefined;
  return typeof body.error.code === "string" ? body.error.code : undefined;
}

function toChip(v: unknown): Chip | null {
  if (!isRec(v) || !isStr(v.qlooId) || !isStr(v.name)) return null;
  const label = isStr(v.label) ? v.label : v.name;
  const chip: Chip = { qlooId: v.qlooId, name: v.name, label };
  if (typeof v.type === "string") chip.type = v.type;
  if (typeof v.year === "number") chip.year = v.year;
  if (typeof v.disambiguation === "string") chip.disambiguation = v.disambiguation;
  if (typeof v.imageUrl === "string" && v.imageUrl.startsWith("https://")) chip.imageUrl = v.imageUrl;
  return chip;
}

/** Read a /api/seeds/resolve response into the search state the form shows. Never throws. */
export function readResolve(status: number, body: unknown): Extract<SearchState, { kind: "clean" | "ambiguous" | "missing" | "error" }> {
  if (status !== 200 || !isRec(body)) {
    const code = errorCode(body);
    return { kind: "error", message: messageForError(code, status, "lookup"), code };
  }
  if (body.status === "clean") {
    const chip = toChip(body.entity);
    if (chip) return { kind: "clean", chip };
    return { kind: "error", message: messageForError(undefined, status, "lookup") };
  }
  if (body.status === "ambiguous") {
    const chips = (Array.isArray(body.candidates) ? body.candidates : [])
      .map(toChip)
      .filter((c): c is Chip => c !== null)
      .slice(0, MAX_CHIPS);
    // One usable candidate is still a choice for the user to confirm.
    if (chips.length > 0) return { kind: "ambiguous", chips, chosenId: null };
    return { kind: "missing" };
  }
  if (body.status === "missing") return { kind: "missing" };
  return { kind: "error", message: messageForError(undefined, status, "lookup") };
}

function firstMapWhy(body: unknown): TraceEvent | undefined {
  if (!isRec(body) || !Array.isArray(body.trace)) return undefined;
  return body.trace.find((e): e is TraceEvent => isTraceEvent(e) && e.kind === "map_why");
}

export type WhyRead = { ok: true; tags: WhyTag[]; event?: TraceEvent } | { ok: false; event?: TraceEvent };

/**
 * Read a /api/profile/why response. On any failure the seed is kept without `whyTags` (the profile build then
 * treats the why as never mapped). `tags: []` is a valid answer: nothing matched.
 */
export function readWhy(status: number, body: unknown): WhyRead {
  const event = firstMapWhy(body);
  if (status !== 200 || !isRec(body) || !Array.isArray(body.tags)) return event ? { ok: false, event } : { ok: false };
  const tags = cleanWhyTags(body.tags);
  if (!tags) return event ? { ok: false, event } : { ok: false };
  return event ? { ok: true, tags, event } : { ok: true, tags };
}

export interface ProfileResult {
  profile: Profile;
  axes: Axis[];
  trace: TraceEvent[];
}
export type ProfileRead = { ok: true; result: ProfileResult } | { ok: false; code?: string; message: string };

/** Read a /api/profile response. */
export function readProfile(status: number, body: unknown): ProfileRead {
  if (status !== 200 || !isRec(body)) {
    const code = errorCode(body);
    return { ok: false, code, message: messageForError(code, status, "profile") };
  }
  const { axes, trace } = body;
  const profile = readProfileShape(body.profile);
  if (!profile || !Array.isArray(axes) || !axes.every(isAxis)) {
    return { ok: false, message: messageForError(undefined, status, "profile") };
  }
  const events = Array.isArray(trace) ? trace.filter(isTraceEvent) : [];
  return { ok: true, result: { profile, axes: axes as Axis[], trace: events } };
}
