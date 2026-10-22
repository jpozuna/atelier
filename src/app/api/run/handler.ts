// POST /api/run request handler: validates the body, then streams the run as server-sent events. Kept out of
// route.ts because a Next route file may export only handlers and route config.
//
// Request  (JSON, at most RUN_MAX_BODY_CHARS):
//   { seeds: ProfileSeed[], profile: Profile, axes: Axis[], exclude?: string[], plan?: RunPlan, domains?: Field[] }
//   `domains` (non-empty, unique, valid fields) limits the run to those fields: pools, re-queries, refs and cards for
//   them only, `exclude` applies to their pools only, and the result's `domains` holds only them (the client merges them
//   into the result it already has, replacing the entries of the same field). The returned `plan` still covers all fields.
//   `plan` is the one a previous result returned: with it a repeat replays the same Qloo requests (0 live calls).
//   i.e. what the picks screen reads from readTasteSession() plus an optional list of entity ids already shown.
//   The profile is passed in, so the run makes no profile call.
//
// Response 200, `text/event-stream`. Each message is `event: <name>` then `data: <one line of JSON>`:
//   trace   a TraceEvent (every one passes isTraceEvent), as it happens
//   result  PublicRunResult once, at the end: { domains: DomainResult[], plan, meta: {requeries, notRequeried} }, picks with complete cards
//   (a `: keepalive` comment line is sent every SSE_HEARTBEAT_MS; SSE clients ignore it)
//   error   { code, message } if the run fails after streaming began (no result follows)
//   done    {} last, always
// Response 400/422/503 (JSON `{ error: {code, message} }`) when the body is refused before streaming begins.
//
// Never returns raw Qloo JSON, Qloo error text, model text beyond the cards, or any key. Nothing numeric about taste
// leaves the server (hard rule 7): see public.ts for what is stripped from events and picks.

import type { Axis, Field, TraceEvent } from "@/types";
import { isAxis, isProfileTag, isSeed, isTraceEvent } from "@/types";
import { QlooBudgetError, QlooCacheMissError, QlooConfigError, QlooError, QlooHttpError, QlooParamError } from "@/lib/qloo/errors";
import {
  MAX_TAG_NAME_CHARS,
  WHY_TAGS_PER_SEED,
  RUN_MAX_AXES,
  RUN_MAX_BODY_CHARS,
  RUN_MAX_CONCURRENT,
  RUN_MAX_EXCLUDE,
  RUN_MAX_PLAN_ID_CHARS,
  MAX_REQUERIES_PER_RUN,
  MAX_SEEDS_PER_USER,
  RUN_MAX_TAGS,
  SCHEMA_REASON_MAX,
  SSE_HEARTBEAT_MS,
} from "@/lib/agent/config";
import { fail, json, readJson, type ErrorCode } from "@/lib/profile/http";
import { cleanWhyTags } from "@/lib/profile/tags";
import type { Profile, ProfileSeed } from "@/lib/profile/types";
import { RunInputError, runAgent } from "@/lib/agent/loop";
import { publicTrace, toPublicResult } from "@/lib/agent/public";
import type { RunDeps, RunInput, RunPlan } from "@/lib/agent/types";
import { FIELDS } from "@/types";
import { runInBackground, type RunEntry, type RunLog } from "@/lib/runlog";
import { LEARN_READ_TIMEOUT_MS } from "@/lib/agent/config";
import { applyAdjustment, isEmptyAdjustment, learningEnabled, planAdjustment, readLearnSignals, withPickRecords, type Adjustment } from "@/lib/learn";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TAG_ID = /^urn:tag:\S+$/;

export type RunErrorCode = ErrorCode | "picks_not_enabled" | "busy";

export interface RunHandlerDeps {
  /** One set of per-request dependencies: a Qloo client (reporting its calls to `onTrace`), one refs context, a model client. */
  createRunDeps: (onTrace: (event: TraceEvent) => void) => Omit<RunDeps, "emit" | "now" | "signal">;
  now?: () => Date;
  /** Runs in progress, shared across requests by the route. */
  active?: { count: number };
  maxConcurrent?: number;
  /** Milliseconds between keepalive comment lines. Default SSE_HEARTBEAT_MS. */
  heartbeatMs?: number;
  /**
   * The private run log (src/lib/runlog). Absent: nothing is logged. A run is written after the response stream has
   * ended, fire-and-forget: a slow or failing log never delays or fails a run, and nothing about it reaches the browser.
   */
  runLog?: RunLog;
  /** The signed-in person's id, or null for a guest. Started when the request arrives, awaited only for the log. Never throws the run. */
  getUserId?: () => Promise<string | null>;
  /** Hands the log write to the host so it can finish after the response (the route passes Next's `after`). */
  afterResponse?: (done: Promise<unknown>) => void;
  /**
   * Learn from the signed-in person's past exact signals in the run log before the run (T-28; guests get none): turned-down picks join `exclude`, and the
   * profile weights of themes behind turned-down or saved picks lean down or up. Default: `learningEnabled()` (on only
   * when Qloo calls can be made, never in replay, because a learned `exclude` is a new request). Needs `runLog`; without
   * signals the input is exactly the request's.
   */
  learn?: boolean;
}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);

const isDomain = (v: unknown): boolean => typeof v === "string" && (FIELDS as readonly string[]).includes(v);

/** A plan as a previous result returned it. Shape only: the loop keeps just what the run can honour. */
export function parsePlan(raw: unknown): RunPlan | string {
  if (!isRec(raw) || !Array.isArray(raw.themes) || !Array.isArray(raw.requeries)) return "plan must be {themes, requeries}.";
  if (raw.themes.length > FIELDS.length || raw.requeries.length > MAX_REQUERIES_PER_RUN) return "plan is too large.";
  const themes: RunPlan["themes"] = [];
  for (const t of raw.themes) {
    if (!isRec(t) || !isDomain(t.domain) || typeof t.axisId !== "string" || t.axisId.length > RUN_MAX_PLAN_ID_CHARS) return "Each plan theme must be {domain, axisId, reason}.";
    const reason = typeof t.reason === "string" ? t.reason.slice(0, SCHEMA_REASON_MAX) : "";
    themes.push({ domain: t.domain as RunPlan["themes"][number]["domain"], axisId: t.axisId, reason });
  }
  const requeries: RunPlan["requeries"] = [];
  for (const r of raw.requeries) {
    if (!isRec(r) || !isDomain(r.domain) || !isRec(r.action)) return "Each plan requery must be {domain, action}.";
    const a = r.action;
    const domain = r.domain as RunPlan["requeries"][number]["domain"];
    if (a.kind === "tighten_popularity" && typeof a.popularityMax === "number" && Number.isFinite(a.popularityMax)) requeries.push({ domain, action: { kind: "tighten_popularity", popularityMax: a.popularityMax } });
    else if (a.kind === "lean_axis" && typeof a.axisId === "string" && a.axisId.length <= RUN_MAX_PLAN_ID_CHARS) requeries.push({ domain, action: { kind: "lean_axis", axisId: a.axisId } });
    else return "Each plan requery action must be tighten_popularity or lean_axis.";
  }
  return { themes, requeries };
}

/** The body as a RunInput, or a one-line reason it was refused. */
export function parseRunBody(body: unknown): RunInput | string {
  if (!isRec(body)) return "Body must be JSON: {seeds, profile, axes, exclude?, plan?, domains?}.";

  const rawSeeds = body.seeds;
  if (!Array.isArray(rawSeeds) || rawSeeds.length < 1) return "seeds must be a non-empty array.";
  if (rawSeeds.length > MAX_SEEDS_PER_USER) return `At most ${MAX_SEEDS_PER_USER} seeds.`;
  const seeds: ProfileSeed[] = [];
  for (const s of rawSeeds) {
    if (!isSeed(s)) return "Each seed must be {id, field, typed, why, qlooId, status, whyTags?}.";
    if (s.qlooId !== null && !UUID.test(s.qlooId)) return "qlooId must be an entity id.";
    const whyRaw = (s as unknown as Rec).whyTags;
    if (whyRaw === undefined) {
      seeds.push({ ...s });
      continue;
    }
    const whyTags = cleanWhyTags(whyRaw, WHY_TAGS_PER_SEED, MAX_TAG_NAME_CHARS);
    if (!whyTags) return "whyTags must be at most 5 items of {tag, name, tagType}.";
    seeds.push({ ...s, whyTags });
  }
  if (new Set(seeds.map((s) => s.id)).size !== seeds.length) return "Seed ids must be unique.";

  const p = body.profile;
  if (!isRec(p) || !Array.isArray(p.tags) || !Array.isArray(p.fields) || !Array.isArray(p.seedIds)) return "profile must be the object POST /api/profile returned.";
  if (p.tags.length > RUN_MAX_TAGS) return "Too many profile tags.";
  if (!p.tags.every((t) => isProfileTag(t) && TAG_ID.test(t.tag) && t.tag.length <= 300)) return "Every profile tag must be a real tag with an id like urn:tag:...";
  const tags = p.tags as Profile["tags"];
  const profile: Profile = {
    seedIds: p.seedIds.filter((x): x is string => typeof x === "string"),
    skippedSeeds: [],
    fields: p.fields as Profile["fields"],
    tags,
    bridgeTagIds: tags.filter((t) => t.bridge).map((t) => t.tag),
    droppedGenericCount: typeof p.droppedGenericCount === "number" ? p.droppedGenericCount : 0,
    droppedAxisTagTypes: [],
    naming: {},
  };

  const rawAxes = body.axes;
  if (!Array.isArray(rawAxes) || rawAxes.length > RUN_MAX_AXES) return `axes must be an array of at most ${RUN_MAX_AXES}.`;
  if (!rawAxes.every((a) => isAxis(a) && a.tags.every((t) => TAG_ID.test(t.tag)))) return "Every axis must have a label, a justification and at least 2 real tags.";
  const axes = rawAxes as Axis[];

  let exclude: string[] | undefined;
  if (body.exclude !== undefined) {
    if (!Array.isArray(body.exclude) || body.exclude.length > RUN_MAX_EXCLUDE || !body.exclude.every((x) => typeof x === "string" && UUID.test(x))) {
      return `exclude must be an array of at most ${RUN_MAX_EXCLUDE} entity ids.`;
    }
    exclude = body.exclude as string[];
  }
  let plan: RunPlan | undefined;
  if (body.plan !== undefined) {
    const parsed = parsePlan(body.plan);
    if (typeof parsed === "string") return parsed;
    plan = parsed;
  }
  let domains: Field[] | undefined;
  if (body.domains !== undefined) {
    const d = body.domains;
    if (!Array.isArray(d) || d.length < 1 || d.length > FIELDS.length || !d.every(isDomain) || new Set(d).size !== d.length) {
      return `domains must be a non-empty list of distinct fields (${FIELDS.join(", ")}).`;
    }
    domains = d as Field[];
  }
  return { seeds, profile, axes, ...(exclude ? { exclude } : {}), ...(plan ? { plan } : {}), ...(domains ? { domains } : {}) };
}

/**
 * The optional `notMe` list of a run request: entity ids the person newly set aside, a subset of `exclude`. Only the run
 * log reads it (it makes the "not me" signal exact); the run itself ignores it. Absent is fine. A string is the reason
 * it was refused.
 */
export function parseNotMe(body: unknown, exclude: readonly string[] | undefined): string[] | string | undefined {
  if (!isRec(body) || body.notMe === undefined) return undefined;
  const n = body.notMe;
  if (!Array.isArray(n) || n.length > RUN_MAX_EXCLUDE || !n.every((x) => typeof x === "string" && UUID.test(x))) {
    return `notMe must be an array of at most ${RUN_MAX_EXCLUDE} entity ids.`;
  }
  const allowed = new Set(exclude ?? []);
  if (!n.every((x) => allowed.has(x))) return "notMe must be part of exclude.";
  return n as string[];
}

/** A fixed, safe code and sentence for a failure. Never carries Qloo text, model text or a key. */
export function describeRunError(err: unknown): { status: number; code: RunErrorCode; message: string } {
  if (err instanceof RunInputError) return { status: 422, code: "no_usable_seeds", message: err.message };
  if (err instanceof QlooParamError && err.issues.some((i) => i.reason === "body_unconfirmed")) {
    return {
      status: 503,
      code: "picks_not_enabled",
      message: "Live picks are not switched on yet: the taste graph query options are still being confirmed. Try again once they are.",
    };
  }
  if (err instanceof QlooCacheMissError) return { status: 503, code: "lookups_off", message: "Lookups are unavailable right now." };
  if (err instanceof QlooBudgetError) return { status: 503, code: "budget", message: "Lookups are paused to protect the monthly call budget." };
  if (err instanceof QlooHttpError && err.kind === "rate_limited") return { status: 503, code: "rate_limited", message: "The taste graph is busy. Try again in a moment." };
  if (err instanceof QlooHttpError && (err.kind === "unauthorized" || err.kind === "forbidden")) {
    return { status: 500, code: "config", message: "The picks service is not configured on the server." };
  }
  if (err instanceof QlooHttpError && err.kind === "bad_request") return { status: 500, code: "rejected", message: "The taste graph rejected the request." };
  if (err instanceof QlooConfigError || err instanceof QlooParamError) return { status: 500, code: "config", message: "The picks service is not configured on the server." };
  if (err instanceof QlooError) return { status: 502, code: "upstream", message: "The taste graph could not be reached. Try again." };
  return { status: 500, code: "internal", message: "Something went wrong." };
}

const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-store, no-transform",
  "X-Accel-Buffering": "no",
};

/** Resolves with `p`, or rejects after `ms`. The late value is dropped. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("timeout")), ms);
  });
  return Promise.race([p, limit]).finally(() => clearTimeout(timer));
}

/** What the signed-in person's past signals ask of this run. Null for a guest (no learning) or when nothing applies. */
async function learnFrom(input: RunInput, log: RunLog, userId: Promise<string | null>): Promise<Adjustment | null> {
  const who = await userId;
  if (!who) return null;
  const signals = await readLearnSignals({ userId: who }, { store: log.store });
  if (signals.length === 0) return null;
  return planAdjustment(input, signals);
}

export async function handleRun(request: Request, deps: RunHandlerDeps): Promise<Response> {
  if (request.signal?.aborted) return json({ error: { code: "cancelled", message: "The request was cancelled." } }, 499);
  const body = await readJson(request, RUN_MAX_BODY_CHARS, "{seeds, profile, axes, exclude?, plan?, domains?}");
  if (body instanceof Response) return body;
  const input = parseRunBody(body);
  if (typeof input === "string") return fail(400, "bad_request", input);
  const notMe = parseNotMe(body, input.exclude);
  if (typeof notMe === "string") return fail(400, "bad_request", notMe);
  if (!input.seeds.some((s) => s.qlooId)) return fail(422, "no_usable_seeds", "Add at least one seed that has been matched to an entity.");

  const active = deps.active ?? { count: 0 };
  if (active.count >= (deps.maxConcurrent ?? RUN_MAX_CONCURRENT)) return json({ error: { code: "busy" satisfies RunErrorCode, message: "Several runs are in progress. Try again in a moment." } }, 503);

  // Dependencies are built before streaming so a configuration failure is a real HTTP status.
  let sink: (event: TraceEvent) => void = () => {};
  let runDeps: Omit<RunDeps, "emit" | "now" | "signal">;
  try {
    runDeps = deps.createRunDeps((e) => sink(e));
  } catch (err) {
    const d = describeRunError(err);
    return json({ error: { code: d.code, message: d.message } }, d.status);
  }

  // The person is looked up now, while the request is in scope, and awaited only when the log is written.
  const log = deps.runLog && deps.runLog.store.kind !== "off" ? deps.runLog : undefined;
  const userId: Promise<string | null> = log && deps.getUserId ? Promise.resolve().then(deps.getUserId).catch(() => null) : Promise.resolve(null);
  // Every event as emitted, unredacted, for the private log. Server side only.
  const logged: TraceEvent[] = [];

  const encoder = new TextEncoder();
  const abort = new AbortController();
  request.signal?.addEventListener("abort", () => abort.abort(), { once: true });
  active.count += 1;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      };
      // Only well-formed events leave the server: the panel renders from their structured fields.
      sink = (e) => {
        if (isTraceEvent(e)) {
          if (log) logged.push(e);
          send("trace", publicTrace(e));
        }
      };
      const heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(": keepalive\n\n"));
        } catch {
          closed = true;
        }
      }, deps.heartbeatMs ?? SSE_HEARTBEAT_MS);
      let outcome: Pick<RunEntry, "result" | "errorCode"> = { result: null, errorCode: "internal" };
      let learned: Adjustment | null = null;
      try {
        let runInput = input;
        if (log && (deps.learn ?? learningEnabled())) {
          // Reading the log makes no Qloo call. A slow or failing log means the run goes ahead as the request says.
          const adjustment = await withTimeout(learnFrom(input, log, userId), LEARN_READ_TIMEOUT_MS).catch(() => null);
          if (adjustment && !isEmptyAdjustment(adjustment)) {
            runInput = applyAdjustment(input, adjustment);
            learned = adjustment;
          }
        }
        const result = await runAgent(runInput, { ...runDeps, emit: sink, now: deps.now, signal: abort.signal });
        // The log keeps what each pick was built on (audit.picks); the browser gets the public result of the run itself.
        outcome = { result: withPickRecords(result, learned), errorCode: null };
        send("result", toPublicResult(result));
      } catch (err) {
        outcome = { result: null, errorCode: abort.signal.aborted ? "cancelled" : describeRunError(err).code };
        if (!abort.signal.aborted) {
          const d = describeRunError(err);
          send("error", { code: d.code, message: d.message });
        }
      } finally {
        clearInterval(heartbeat);
        send("done", {});
        active.count -= 1;
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            // already closed by the client
          }
        }
        // After the stream has ended: one log row per finished or failed run. Never awaited, never throws.
        if (log) {
          runInBackground(
            async () =>
              log.recordRun({
                seeds: input.seeds.map((s) => ({ id: s.id, field: s.field, typed: s.typed, why: s.why, qlooId: s.qlooId })),
                tagIds: input.profile.tags.map((t) => t.tag),
                exclude: input.exclude,
                notMe: notMe ?? undefined,
                domains: input.domains,
                userId: await userId,
                events: logged,
                ...outcome,
              }),
            deps.afterResponse,
          );
        }
      }
    },
    cancel() {
      abort.abort();
    },
  });
  return new Response(stream, { status: 200, headers: SSE_HEADERS });
}
