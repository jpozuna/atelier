// Reading the /api/run stream. Pure: no fetch, no React. Responses are checked at runtime and never trusted.
//
// Wire format (T-10): `event: <name>` then `data: <one line of JSON>`, then a blank line. A `: keepalive` comment
// line arrives every 12 s and is skipped. The HTTP status is 200 even when the run fails, so the `error` event is
// what says so.
//
// What the browser receives is already stripped of everything numeric about taste (hard rule 7). The readers here
// accept exactly that shape and keep nothing else, so a stray field cannot reach the screen.

import { isBand, isCard, isField, isPath, isTraceEvent } from "@/types";
import type { Band, Field, TraceEvent } from "@/types";
import { BANDS, FIELDS } from "@/types";
import { MAX_NOTE_CHARS } from "@/lib/agent/config";
import type { PublicDomain, PublicPick, PublicRunResult, RunPlan } from "./types";

export interface SseMessage {
  event: string;
  data: string;
}

/**
 * Split buffered text into complete messages. `rest` is the unfinished tail: pass it back with the next chunk.
 * Handles CRLF and lone CR line ends, comment lines, a missing space after the colon and multi-line data.
 */
export function feedSse(buffer: string, chunk: string): { messages: SseMessage[]; rest: string } {
  // A lone CR at the end of the chunk may be the first half of a CRLF: hold it until the next chunk shows which.
  const joined = buffer + chunk;
  const hold = joined.endsWith("\r") ? "\r" : "";
  const text = (hold ? joined.slice(0, -1) : joined).replace(/\r\n?/g, "\n");
  const blocks = text.split("\n\n");
  const rest = (blocks.pop() ?? "") + hold;
  const messages: SseMessage[] = [];
  for (const block of blocks) {
    let event = "message";
    const data: string[] = [];
    let any = false;
    for (const line of block.split("\n")) {
      if (line === "" || line.startsWith(":")) continue;
      const colon = line.indexOf(":");
      const field = colon === -1 ? line : line.slice(0, colon);
      let value = colon === -1 ? "" : line.slice(colon + 1);
      if (value.startsWith(" ")) value = value.slice(1);
      if (field === "event") {
        event = value;
        any = true;
      } else if (field === "data") {
        data.push(value);
        any = true;
      }
    }
    if (any) messages.push({ event, data: data.join("\n") });
  }
  return { messages, rest };
}

/** Why a run did not produce picks. The code is the server's; the wording on screen is ours (never the server's text). */
export interface RunErrorInfo {
  code: string;
}

export type RunMessage =
  | { type: "trace"; event: TraceEvent }
  | { type: "result"; result: PublicRunResult }
  | { type: "error"; error: RunErrorInfo }
  | { type: "done" };

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const STATUSES = ["ok", "thin", "empty", "unavailable"] as const;

/** A pick as the server sends it: identity, path and a complete card. Anything else is dropped. */
export function readPick(v: unknown): PublicPick | null {
  if (!isRec(v)) return null;
  if (!isStr(v.id) || !isStr(v.qlooId) || !isStr(v.name) || !isField(v.field) || !isBand(v.band)) return null;
  if (typeof v.llmBridged !== "boolean") return null;
  if (!isPath(v.path) || !isCard(v.card)) return null;
  return {
    id: v.id,
    qlooId: v.qlooId,
    name: v.name,
    field: v.field,
    band: v.band,
    llmBridged: v.llmBridged,
    origin: v.origin === "primary" || v.origin === "backfill" ? v.origin : "unknown",
    path: v.path,
    card: v.card,
  } as PublicPick;
}

function readPicks(v: unknown): PublicPick[] {
  return Array.isArray(v) ? v.map(readPick).filter((p): p is PublicPick => p !== null) : [];
}

function readDomain(v: unknown): PublicDomain | null {
  if (!isRec(v) || !isField(v.domain) || !(STATUSES as readonly unknown[]).includes(v.status)) return null;
  const byBandRaw = isRec(v.byBand) ? v.byBand : {};
  const byBand = Object.fromEntries(BANDS.map((b) => [b, readPicks(byBandRaw[b])])) as Record<Band, PublicPick[]>;
  // `picks` is the same picks, lowest band first. Rebuild it from the bands so the two can never disagree.
  const picks = BANDS.flatMap((b) => byBand[b]);
  const out: PublicDomain = {
    domain: v.domain,
    status: v.status as PublicDomain["status"],
    picks,
    byBand,
    emptyBands: Array.isArray(v.emptyBands) ? v.emptyBands.filter(isBand) : [],
    thin: v.thin === true,
  };
  if (typeof v.note === "string" && v.note.length > 0 && v.note.length <= MAX_NOTE_CHARS) out.note = v.note;
  return out;
}

function readPlan(v: unknown): RunPlan | null {
  if (!isRec(v) || !Array.isArray(v.themes) || !Array.isArray(v.requeries)) return null;
  // Opaque to the screen: it goes back to the server unchanged, and the server validates it.
  return { themes: v.themes, requeries: v.requeries } as unknown as RunPlan;
}

/** The result event. Null when it is not usable (no domains at all, or no plan to send back). */
export function readResult(v: unknown): PublicRunResult | null {
  if (!isRec(v) || !Array.isArray(v.domains)) return null;
  const plan = readPlan(v.plan);
  if (!plan) return null;
  const seen = new Set<Field>();
  const domains: PublicDomain[] = [];
  for (const raw of v.domains) {
    const d = readDomain(raw);
    if (!d || seen.has(d.domain)) continue;
    seen.add(d.domain);
    domains.push(d);
  }
  domains.sort((a, b) => FIELDS.indexOf(a.domain) - FIELDS.indexOf(b.domain));
  if (domains.length === 0) return null;
  const meta = isRec(v.meta) ? v.meta : {};
  return {
    domains,
    plan,
    meta: {
      requeries: Array.isArray(meta.requeries) ? (meta.requeries as PublicRunResult["meta"]["requeries"]) : [],
      notRequeried: Array.isArray(meta.notRequeried) ? (meta.notRequeried as PublicRunResult["meta"]["notRequeried"]) : [],
    },
  };
}

/** One message to what the screen understands. Null for an unknown or malformed message, which is skipped. */
export function readMessage(m: SseMessage): RunMessage | null {
  let value: unknown = null;
  if (m.data) {
    try {
      value = JSON.parse(m.data);
    } catch {
      return null;
    }
  }
  switch (m.event) {
    case "trace":
      return isTraceEvent(value) ? { type: "trace", event: value } : null;
    case "result": {
      const result = readResult(value);
      return result ? { type: "result", result } : null;
    }
    case "error":
      return isRec(value) && isStr(value.code) ? { type: "error", error: { code: value.code } } : { type: "error", error: { code: "internal" } };
    case "done":
      return { type: "done" };
    default:
      return null;
  }
}

/** The error code of a non-200 JSON body (`{ error: { code, message } }`), or `http_<status>`. */
export function codeFromErrorBody(status: number, body: unknown): string {
  if (isRec(body) && isRec(body.error) && isStr(body.error.code)) return body.error.code;
  return `http_${status}`;
}
