# Operations

How Atelier spends its Qloo calls, how it caches, and how the public demo protects itself so it stays free and working through judging.

## Call budget and caching

The hackathon key allows 10,000 calls a month and 5 per second, and has to last through judging. So:

- Onboarding makes at most 2 live calls per seed (the search and its "why" tags), for at most 10 seeds.
- Building the profile makes 1 call.
- A run makes at most 12 live calls (a typical run is 6 pools plus at most 2 re-queries). The client refuses the thirteenth.
- A repeat view makes 0: the browser keeps the result and the run plan, and the same requests replay from the cache.
- A "not me" re-run looks at one field only (one pool plus at most 2 re-queries).
- At most 4 requests are in flight, starts are spaced to stay under 5 per second, and 429s back off and retry.
- Every response is cached after the client strips bulky fields. Locally the cache is a file under `.qloo-private/cache`. In production it is a private Supabase table, `qloo_cache`, that no browser role can read.
- Below `QLOO_RESERVE` remaining monthly calls, live calls are refused.
- Dev and evals run from cache or replay by default. Any live script prints its call count first.

## The demo guard

The deployed demo is free and has to survive judging, so a proxy (`src/proxy.ts`) guards the four routes that spend calls: `/api/run`, `/api/profile`, `/api/profile/why` and `/api/seeds/resolve`. It is on in production.

- Per-visitor limits by IP and declared body-size caps. For runs the limit is 3 an hour and 8 a day; a first run, a "Not me" re-run and a follow-up each count as a run.
- Two daily allowances charged at the worst case of each request: model calls (480 a day by default) and live Qloo calls. When either is used up, the demo shows a calm "resting" state instead of an error. Picks already on screen and anything you saved still show.
- `GET /api/demo-status` reports open or resting without spending anything.
- The monthly reserve (`QLOO_RESERVE`) is enforced by the Qloo client and reaches the screens as the same resting state.
- Counters are in Supabase (`guard_counters`) in production, and fall back to memory, per server instance, when the database is unreachable.
- Security headers are set in `vercel.json`. A test scans the built client bundle for server-only names and key shapes.

The hackathon key is active through the end of judging and deactivated after the hackathon closes. After that, live Qloo calls fail by design, and the demo can only show what is already cached or saved.

## Deployed settings

The public demo runs on Vercel (Production) with `QLOO_MODE=record`, `QLOO_RESERVE=300`, `QLOO_BASE_URL` set to the hackathon host, `ATELIER_MODEL` and `ATELIER_CONTACT` set (model-named axes and Wikidata lineage), `ATELIER_DEMO` unset (so the reserve can rest the demo) and `QLOO_CACHE` unset (so the cache is the private Supabase table). Record mode calls Qloo only on a miss, so repeat views of a profile cost nothing.

## Testing the demo

Open https://atelier-ten-teal.vercel.app. No account is needed. Start at `/start`, add at least 3 seeds across 2 fields, each with a one-line reason, choose See my taste, then Look past the edge. Signing in (an email link, opened in the same browser) is only for saving picks.

Each visitor gets 3 runs an hour and 8 a day (a first run, a "Not me" re-run and a follow-up each count as one), so avoid retakes. If a daily allowance or the monthly reserve is used up, the demo shows its calm "resting" state and comes back later.
