import type { QlooEndpoint, QlooErrorKindName } from "./types";

/** Base class. `kind` is the stable discriminator; never include the API key in a message. */
export class QlooError extends Error {
  readonly kind: QlooErrorKindName;
  readonly endpoint?: QlooEndpoint;
  /** HTTP status when the error came from a response. */
  readonly status?: number;
  readonly retryable: boolean;

  constructor(
    kind: QlooErrorKindName,
    message: string,
    opts: { endpoint?: QlooEndpoint; status?: number; retryable?: boolean; cause?: unknown } = {},
  ) {
    super(message, opts.cause === undefined ? undefined : { cause: opts.cause });
    this.name = "QlooError";
    this.kind = kind;
    this.endpoint = opts.endpoint;
    this.status = opts.status;
    this.retryable = opts.retryable ?? false;
  }
}

/** Missing key, bad QLOO_MODE, or a base URL that is not the hackathon host. */
export class QlooConfigError extends QlooError {
  constructor(message: string) {
    super("config", message);
    this.name = "QlooConfigError";
  }
}

export type ParamIssueReason =
  | "unknown" // not listed or confirmed for this type
  | "ignored" // the spike showed it changes nothing for this type
  | "rejected" // the API rejects it for this type
  | "atelier_refused" // valid for the type, but Atelier does not send it (registry allowlist)
  | "body_unconfirmed" // body-borne on POST, pending the 04-post-check result
  | "bad_value"
  | "not_an_id" // freeform string where an entity or tag id is required
  | "missing_required";

export interface ParamIssue {
  param: string;
  reason: ParamIssueReason;
  detail: string;
}

/** Thrown before any request is built or sent. */
export class QlooParamError extends QlooError {
  readonly issues: readonly ParamIssue[];
  constructor(endpoint: QlooEndpoint, issues: readonly ParamIssue[]) {
    super("param_invalid", `Qloo ${endpoint}: refused before sending. ${issues.map((i) => `${i.param} (${i.reason}: ${i.detail})`).join("; ")}`, {
      endpoint,
    });
    this.name = "QlooParamError";
    this.issues = issues;
  }
}

/** QLOO_MODE=replay (or a failed cache read) and nothing stored for this request. */
export class QlooCacheMissError extends QlooError {
  readonly requestKey: string;
  constructor(endpoint: QlooEndpoint, requestKey: string, cause?: unknown) {
    super("cache_miss", `Qloo ${endpoint}: cache miss in replay mode (key ${requestKey.slice(0, 12)}). Run with QLOO_MODE=record to fill it.`, {
      endpoint,
      cause,
    });
    this.name = "QlooCacheMissError";
    this.requestKey = requestKey;
  }
}

export type BudgetReason = "run_limit" | "reserve";

/** A live call was refused by the budget guard. Nothing was sent. */
export class QlooBudgetError extends QlooError {
  readonly reason: BudgetReason;
  constructor(endpoint: QlooEndpoint, reason: BudgetReason, message: string) {
    super("budget", message, { endpoint });
    this.name = "QlooBudgetError";
    this.reason = reason;
  }
}

/** A non-2xx response from Qloo. `kind` says which: bad_request (400), unauthorized (401), forbidden (403),
 *  not_found (404), rate_limited (429, after retries), server_error (500 and other 5xx), gateway_timeout (504). */
export class QlooHttpError extends QlooError {
  /** Messages from `errors[]` (insights), `error` (search 400) or the flat `{code, reason, message}` shape. */
  readonly messages: readonly string[];
  /** True when the body was HTML (gateway 504). */
  readonly html: boolean;
  /** Seconds, from Retry-After, on a 429. */
  readonly retryAfter?: number;
  constructor(
    kind: QlooErrorKindName,
    endpoint: QlooEndpoint,
    status: number,
    messages: readonly string[],
    opts: { html?: boolean; retryAfter?: number; retryable?: boolean } = {},
  ) {
    super(kind, `Qloo ${endpoint} returned ${status}${messages.length ? `: ${messages.join("; ")}` : opts.html ? " (HTML body)" : ""}`, {
      endpoint,
      status,
      retryable: opts.retryable,
    });
    this.name = "QlooHttpError";
    this.messages = messages;
    this.html = opts.html ?? false;
    this.retryAfter = opts.retryAfter;
  }
}

/** fetch failed or timed out. */
export class QlooNetworkError extends QlooError {
  constructor(endpoint: QlooEndpoint, message: string, cause?: unknown) {
    super("network", `Qloo ${endpoint}: ${message}`, { endpoint, retryable: true, cause });
    this.name = "QlooNetworkError";
  }
}

/** A 200 whose body does not match the endpoint's envelope. */
export class QlooParseError extends QlooError {
  constructor(endpoint: QlooEndpoint, message: string) {
    super("parse", `Qloo ${endpoint}: ${message}`, { endpoint });
    this.name = "QlooParseError";
  }
}
