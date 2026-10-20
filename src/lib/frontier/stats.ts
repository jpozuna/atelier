// Small numeric helpers. Pure.

export const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

export function median(xs: readonly number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/**
 * Mid-rank percentile of each value among all values, 0 to 1: (count below + half the ties) / n. Equal values get
 * the same percentile, so a pool whose popularity bunches near 1 does not spread by noise.
 */
export function percentiles(values: readonly number[]): number[] {
  const n = values.length;
  if (n === 0) return [];
  const sorted = [...values].sort((a, b) => a - b);
  const first = new Map<number, number>();
  const count = new Map<number, number>();
  sorted.forEach((v, i) => {
    if (!first.has(v)) first.set(v, i);
    count.set(v, (count.get(v) ?? 0) + 1);
  });
  return values.map((v) => (first.get(v)! + 0.5 * count.get(v)!) / n);
}
