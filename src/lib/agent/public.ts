// What leaves the server (hard rule 7: nothing numeric about taste reaches the browser). Stored server-side traces
// and the internal RunResult may keep these numbers for evals; the stream and the HTTP result never do.
//
//  - picks lose `reach`, `connection` and `popularity`, and their path anchor loses the explainability
//    `contribution` (the anchor keeps its `source` and `thin`);
//  - `score` events lose the pool popularity summary;
//  - any `filter.popularity.*` value in `query_insights.params`, `requery.paramChanges` or a `qloo_call` event's
//    params is replaced by a word;
//  - the result carries no model counts or fallback list, and no Qloo call counts.
// The shared guards (`isTraceEvent`, `isPath`) are run on the full event BEFORE stripping, on the server.

import type { Band, Path, Pick as AtelierPick, TraceEvent } from "@/types";
import type { DomainResult, PublicPath, PublicPick, PublicRunResult, RunResult } from "./types";

const isPopularityKey = (k: string): boolean => k.startsWith("filter.popularity");

function maskPopularity(params: Record<string, unknown>, word: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(params).map(([k, v]) => [k, isPopularityKey(k) ? word : v]));
}

/** A trace event for the browser. Returns a new object; the input is not changed. */
export function publicTrace(e: TraceEvent): TraceEvent {
  switch (e.kind) {
    case "score": {
      const { popularity: _popularity, ...rest } = e;
      void _popularity;
      return rest as unknown as TraceEvent;
    }
    case "query_insights":
      return { ...e, params: maskPopularity(e.params, "limited") };
    case "requery":
      return { ...e, paramChanges: maskPopularity(e.paramChanges, "tightened") };
    case "qloo_call": {
      const params = (e as { params?: Record<string, unknown> }).params;
      return params ? ({ ...e, params: maskPopularity(params, "limited") } as TraceEvent) : e;
    }
    default:
      return e;
  }
}

function publicPath(path: Path): PublicPath {
  return { ...path, anchor: { contribution: null, source: path.anchor.source, ...(path.anchor.thin ? { thin: true } : {}) } };
}

function publicPick(p: AtelierPick): PublicPick {
  const { reach: _reach, connection: _connection, popularity: _popularity, ...rest } = p;
  void _reach;
  void _connection;
  void _popularity;
  const path = publicPath(p.path);
  return { ...rest, path, card: { ...p.card, path } };
}

/** The result for the browser. */
export function toPublicResult(result: RunResult): PublicRunResult {
  return {
    domains: result.domains.map((d): DomainResult<PublicPick> => ({
      ...d,
      picks: d.picks.map(publicPick),
      byBand: Object.fromEntries(Object.entries(d.byBand).map(([b, ps]) => [b, ps.map(publicPick)])) as Record<Band, PublicPick[]>,
    })),
    plan: result.plan,
    meta: { requeries: result.meta.requeries, notRequeried: result.meta.notRequeried },
  };
}
