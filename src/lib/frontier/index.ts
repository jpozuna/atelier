// Frontier: build one pool per domain, score it for reach and connection, bucket it into bands, and select picks.
// All in code. The model never scores; it only decides what to do with these signals.
//
//   const pool = await buildPool(domain, ctx, exclusions, { insights: client.insights, emit });  // ONE call
//   const scored = scorePool(pool, ctx);                                                          // no calls
//   const sel = selectBands(scored, { bands: ["calibration", ...EDGE_BANDS] });                    // no calls

export { buildPool, redactForTrace, seedOnAxis, seedSignals, toCandidate } from "./pool";
export { scorePool, tagRarity, withPoolRarity } from "./score";
export { bandsForDial, bucket, EDGE_BANDS, selectBands } from "./bands";
export { median, percentiles } from "./stats";
export {
  DIALS,
  FrontierInputError,
  type BandSelection,
  type Dial,
  type Exclusions,
  type FrontierContext,
  type FrontierPick,
  type InsightsFn,
  type Pool,
  type PoolDeps,
  type PoolOptions,
  type PoolSignals,
  type ScoreOptions,
  type ScoredCandidate,
  type ScoredPool,
  type SelectOptions,
  type TraceSink,
} from "./types";
