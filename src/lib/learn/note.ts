// A short, words-only note of past signals for the planner prompt, for example "set aside: two picks themed quiet
// melancholy". No digits, no scores, no ranking: counts are the words one, two, three or several. Code builds it; the
// model only reads it. Tag names come from the person's own profile (by id), never from the log.

import { LEARN_NOTE_THEMES_MAX } from "@/lib/agent/config";
import { SAVED, TURNED_DOWN, type LearnSignal } from "./types";

const COUNT_WORD = ["none", "one", "two", "three"] as const;
const countWord = (n: number): string => (n >= COUNT_WORD.length ? "several" : COUNT_WORD[n]!);

/** One line per kind that has themes, most repeated theme first (ties by name). Empty when there is nothing to say. */
export function pastSignalsNote(signals: readonly LearnSignal[], tagNames: ReadonlyMap<string, string>): string[] {
  const lines: string[] = [];
  for (const [label, names] of [["set aside", TURNED_DOWN], ["saved", SAVED]] as const) {
    // One count per pick and theme: the same pick given twice is one pick.
    const seen = new Set<string>();
    const perTheme = new Map<string, number>();
    for (const s of signals) {
      if (!names.includes(s.signal) || s.source === "exclude") continue;
      const pick = s.entityId ?? s.pickKey;
      for (const t of s.themeTags) {
        const name = tagNames.get(t)?.trim();
        if (!name || seen.has(`${pick}|${t}`)) continue;
        seen.add(`${pick}|${t}`);
        perTheme.set(name, (perTheme.get(name) ?? 0) + 1);
      }
    }
    const top = [...perTheme].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, LEARN_NOTE_THEMES_MAX);
    for (const [name, n] of top) lines.push(`${label}: ${countWord(n)} ${n === 1 ? "pick" : "picks"} themed ${name}`);
  }
  return lines;
}
