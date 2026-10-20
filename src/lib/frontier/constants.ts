// Frontier constants that are not tunable. The tunables (seed weights, lineage weight, neutral obscurity, reach
// weights, band edges, the connection floor, the pool size and the popularity ceiling) live in
// src/lib/agent/config.ts. No Qloo data here.

/** Technical tolerance so a reach difference of exactly MIN_REACH_MARGIN survives floating-point rounding. */
export const REACH_EPSILON = 1e-9;
