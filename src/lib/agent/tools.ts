// The model's tools. The model never scores or searches: code builds pools, scores them and flags poor results, then
// the model is forced to answer through one of these three tools, and code validates the answer before using it.
//
//   choose_themes      which axis of the profile each domain should carry (so which seeds lead that domain)
//   decide_requeries   what to do about domains that code flagged with a reason code (or to leave them)
//   write_cards        the `why` and `different` lines for each pick, from its stored path only
//
// Each parser accepts only what code offered: a theme must be an axis that has tags behind it for that domain, a
// re-query action must be one of the actions code computed as possible, a card must be for a pick that was sent.
// Anything else is dropped here, and the caller falls back to deterministic code for it.

import type { Field, RequeryReason } from "@/types";
import { FIELDS } from "@/types";
import type { ModelTool } from "./llm";
import type { PlanAction as RequeryAction } from "./types";
import { SCHEMA_DIFFERENT_MAX, SCHEMA_REASON_MAX, SCHEMA_WHY_MAX } from "@/lib/agent/config";

const DOMAIN_ENUM = [...FIELDS];

export const CHOOSE_THEMES_TOOL: ModelTool = {
  name: "choose_themes",
  description:
    "For each domain, choose ONE axis of the user's taste profile to carry into that domain, from the options given for that domain. " +
    "Give a short reason that adds information (why this axis suits this domain), without repeating the axis name.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["themes"],
    properties: {
      themes: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["domain", "axisId", "reason"],
          properties: {
            domain: { type: "string", enum: DOMAIN_ENUM },
            axisId: { type: "string" },
            reason: { type: "string", maxLength: SCHEMA_REASON_MAX },
          },
        },
      },
    },
  },
};

export const DECIDE_REQUERIES_TOOL: ModelTool = {
  name: "decide_requeries",
  description:
    "Code flagged some domains because their results were poor. Choose at most the allowed number of re-queries. " +
    "For each, pick one of the actions offered for that domain, or skip it. Do not invent actions or axes.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["decisions"],
    properties: {
      decisions: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["domain", "action"],
          properties: {
            domain: { type: "string", enum: DOMAIN_ENUM },
            action: { type: "string", enum: ["tighten_popularity", "lean_axis", "skip"] },
            axisId: { type: "string" },
          },
        },
      },
    },
  },
};

export const WRITE_CARDS_TOOL: ModelTool = {
  name: "write_cards",
  description:
    "For each pick (identified by its short `ref`), write `why` (what the connection is and what following it could show) and `different` (what changes between the seed and the pick). " +
    "Use only the path given for that pick.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["cards"],
    properties: {
      cards: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["ref", "why", "different"],
          properties: {
            ref: { type: "string" },
            why: { type: "string", maxLength: SCHEMA_WHY_MAX },
            different: { type: "string", maxLength: SCHEMA_DIFFERENT_MAX },
          },
        },
      },
    },
  },
};

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isField = (v: unknown): v is Field => isStr(v) && (FIELDS as readonly string[]).includes(v);

// ---- choose_themes --------------------------------------------------------------------------------------------

/** One axis offered for a domain: it has tags that apply to that domain's entity type. */
export interface AxisOption {
  id: string;
  label: string;
  tagNames: string[];
}

export interface ThemeChoice {
  domain: Field;
  axisId: string;
  /** Model-written, not yet checked by `checkText`. */
  reason: string;
}

/** Valid choices only: a known domain, an axis offered for it, at most one per domain (the first). */
export function parseThemes(raw: unknown, offered: Readonly<Record<Field, readonly AxisOption[]>>): ThemeChoice[] {
  const list = isRec(raw) && Array.isArray(raw.themes) ? raw.themes : [];
  const out: ThemeChoice[] = [];
  const seen = new Set<Field>();
  for (const t of list) {
    if (!isRec(t) || !isField(t.domain) || !isStr(t.axisId) || seen.has(t.domain)) continue;
    if (!offered[t.domain].some((a) => a.id === t.axisId)) continue;
    seen.add(t.domain);
    out.push({ domain: t.domain, axisId: t.axisId, reason: isStr(t.reason) ? t.reason : "" });
  }
  return out;
}

// ---- decide_requeries -----------------------------------------------------------------------------------------

/** What code computed as possible for one flagged domain. */
export interface RequeryOptions {
  reason: RequeryReason;
  /** New `filter.popularity.max`, or null when tightening is not possible (or would not help: `empty`). */
  tightenTo: number | null;
  /** Axis ids whose focus would change the seed weights of the query. */
  axisIds: string[];
}

export type { RequeryAction };

export interface RequeryDecision {
  domain: Field;
  action: RequeryAction;
}

/** Valid decisions only: a flagged domain, an action code offered, at most one per domain, at most `limit` in all. */
export function parseDecisions(raw: unknown, options: ReadonlyMap<Field, RequeryOptions>, limit: number): RequeryDecision[] {
  const list = isRec(raw) && Array.isArray(raw.decisions) ? raw.decisions : [];
  const out: RequeryDecision[] = [];
  const seen = new Set<Field>();
  for (const d of list) {
    if (out.length >= limit) break;
    if (!isRec(d) || !isField(d.domain) || seen.has(d.domain)) continue;
    const opt = options.get(d.domain);
    if (!opt) continue;
    if (d.action === "tighten_popularity" && opt.tightenTo !== null) {
      seen.add(d.domain);
      out.push({ domain: d.domain, action: { kind: "tighten_popularity", popularityMax: opt.tightenTo } });
    } else if (d.action === "lean_axis" && isStr(d.axisId) && opt.axisIds.includes(d.axisId)) {
      seen.add(d.domain);
      out.push({ domain: d.domain, action: { kind: "lean_axis", axisId: d.axisId } });
    } else if (d.action === "skip") {
      seen.add(d.domain);
    }
  }
  return out;
}

/** Flagged domains the model answered with an action that was not offered (or no valid axis), so it was dropped. */
export function invalidDecisionDomains(raw: unknown, options: ReadonlyMap<Field, RequeryOptions>): Field[] {
  const list = isRec(raw) && Array.isArray(raw.decisions) ? raw.decisions : [];
  const out = new Set<Field>();
  for (const d of list) {
    if (!isRec(d) || !isField(d.domain)) continue;
    const opt = options.get(d.domain);
    if (!opt || d.action === "skip") continue;
    const valid =
      (d.action === "tighten_popularity" && opt.tightenTo !== null) || (d.action === "lean_axis" && isStr(d.axisId) && opt.axisIds.includes(d.axisId));
    if (!valid) out.add(d.domain);
  }
  return [...out];
}

// ---- write_cards ----------------------------------------------------------------------------------------------

export interface CardLines {
  why: string;
  different: string;
}

/** Lines by `ref` (the short label a pick was sent under), for refs that were sent. Not yet checked by `checkText`. The first entry per ref wins. */
export function parseCards(raw: unknown, sentRefs: ReadonlySet<string>): Map<string, CardLines> {
  const list = isRec(raw) && Array.isArray(raw.cards) ? raw.cards : [];
  const out = new Map<string, CardLines>();
  for (const c of list) {
    if (!isRec(c) || !isStr(c.ref) || !sentRefs.has(c.ref) || out.has(c.ref)) continue;
    if (!isStr(c.why) || !isStr(c.different)) continue;
    out.set(c.ref, { why: c.why, different: c.different });
  }
  return out;
}
