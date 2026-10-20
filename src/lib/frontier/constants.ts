// Frontier tunables that are not in src/lib/agent/config.ts yet. config.ts is manager-owned, so these are
// proposed there under the same names (see the T-08 Handoff). Reach weights, band edges, the connection floor,
// the pool size and the popularity ceiling already live in config.ts and are imported from it, never copied.
// No Qloo data here.

/** Seed weight (insights `signal.interests.entities` weight) for seeds that sit on the axis being explored. */
export const SEED_WEIGHT_ON_AXIS = 1;

/**
 * Seed weight for seeds off the axis being explored. Seeds are still sent (the client requires every sent seed
 * to be excluded, and dropping a seed would hide it from the explainability anchor), only leaned away from.
 * Applies only when at least one seed is on the axis; otherwise every seed weighs SEED_WEIGHT_ON_AXIS.
 */
export const SEED_WEIGHT_OFF_AXIS = 0.3;

/**
 * Added to the connection sum when a sourced lineage hop that touches a seed is supplied. Large enough to clear
 * CONNECTION_FLOOR (0.3) on its own, so lineage counts as real evidence, but a pick still needs a shared tag
 * to have a path at all (the path contract is seed, theme, optional lineage, pick).
 */
export const LINEAGE_CONNECTION_WEIGHT = 0.4;

/** Technical tolerance so a reach difference of exactly MIN_REACH_MARGIN survives floating-point rounding. */
export const REACH_EPSILON = 1e-9;

/** Obscurity given to a candidate whose popularity is unknown (0 or missing): neutral, neither obscure nor popular. */
export const NEUTRAL_OBSCURITY = 0.5;
