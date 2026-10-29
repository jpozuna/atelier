// Small name helpers shared by the loop, signals and explanations. Pure.

import type { PathHop } from "@/types";

/**
 * Who a sourced hop came from, read from the hop alone: its label when it has one (Qloo-sourced hops carry
 * "Qloo"), else the host of its link. Returns null when neither is usable, and the caller omits the sentence.
 */
export function sourceNameOfHop(hop: PathHop): string | null {
  if (hop.sourceLabel && hop.sourceLabel.trim()) return hop.sourceLabel.trim();
  if (!hop.sourceUrl) return null;
  try {
    const host = new URL(hop.sourceUrl).hostname.toLowerCase();
    if (host.endsWith("wikidata.org")) return "Wikidata";
    if (host.endsWith("qloo.com")) return "Qloo";
  } catch {
    return null;
  }
  return null;
}
