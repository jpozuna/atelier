// Runtime checks for data read from the network or from sessionStorage. Pure. Nothing read is trusted.
// The tag checks match the server's (src/lib/profile/tags.ts) so the client never keeps what the server would refuse.

import { isField, isProfileTag } from "@/types";
import { MAX_TAG_ID_CHARS, MAX_TAG_NAME_CHARS, WHY_TAGS_PER_SEED } from "@/lib/agent/config";
import type { Profile, WhyTag } from "./types";

const TAG_PREFIX = "urn:tag:";
const TAG_TYPE_RE = /^urn:tag:[^:\s]+:[^:\s]+$/;

export const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isStrArr = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === "string");

export const isTagId = (v: unknown): v is string =>
  typeof v === "string" && v.startsWith(TAG_PREFIX) && v.length > TAG_PREFIX.length && v.length <= MAX_TAG_ID_CHARS;
export const isTagType = (v: unknown): v is string => typeof v === "string" && TAG_TYPE_RE.test(v);

/** Why tags as the server accepts them (at most 5, name trimmed and at most 120). Null when anything is malformed. */
export function cleanWhyTags(raw: unknown): WhyTag[] | null {
  if (!Array.isArray(raw) || raw.length > WHY_TAGS_PER_SEED) return null;
  const out: WhyTag[] = [];
  for (const t of raw) {
    if (!isRec(t) || !isTagId(t.tag) || typeof t.name !== "string" || !isTagType(t.tagType)) return null;
    const name = t.name.trim();
    if (!name || name.length > MAX_TAG_NAME_CHARS) return null;
    out.push({ tag: t.tag, name, tagType: t.tagType });
  }
  return out;
}

/** A profile as POST /api/profile returns it, checked field by field. Null when it would not be safe to render. */
export function readProfileShape(v: unknown): Profile | null {
  if (!isRec(v)) return null;
  if (!isStrArr(v.seedIds) || !isStrArr(v.bridgeTagIds) || !isStrArr(v.droppedAxisTagTypes)) return null;
  if (!Array.isArray(v.fields) || !v.fields.every(isField)) return null;
  if (!Array.isArray(v.skippedSeeds) || !v.skippedSeeds.every((s) => isRec(s) && typeof s.id === "string" && typeof s.reason === "string")) {
    return null;
  }
  if (!Array.isArray(v.tags) || !v.tags.every(isProfileTag)) return null;
  if (!isNum(v.droppedGenericCount)) return null;
  if (v.axisShortfall !== undefined && !(isRec(v.axisShortfall) && isNum(v.axisShortfall.wanted) && isNum(v.axisShortfall.got))) return null;
  if (!isRec(v.naming) || !Object.values(v.naming).every((n) => n === "model" || n === "fallback")) return null;
  return v as unknown as Profile;
}
