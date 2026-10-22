// Whether a run may learn from the log. Learning adds entity ids to `exclude`, which changes the Qloo request body, so a
// run that learned is a new request: it cannot come from the replay cache. In replay mode (the default, and the public
// demo) that would be a cache miss and a failed run, so learning is off there unless forced.
//
//   ATELIER_LEARN=off   never
//   ATELIER_LEARN=on    always (the caller accepts the cache misses)
//   unset               on when Qloo calls can be made: QLOO_MODE=live or record, or the local synthetic Qloo
//                       (QLOO_SYNTHETIC=1, never on Vercel). Off in replay.

export function learningEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const flag = env.ATELIER_LEARN?.trim().toLowerCase();
  if (flag === "off") return false;
  if (flag === "on") return true;
  if (env.QLOO_SYNTHETIC === "1" && !env.VERCEL) return true;
  const mode = env.QLOO_MODE?.trim().toLowerCase();
  return mode === "live" || mode === "record";
}
