# T-20: Deploy and free-demo hardening

Status: done
Mode: inline
Kind: feature
Priority: P0
Depends on: T-14

## Goal
A deployable demo that stays free and working through Nov 16: per-IP rate limits, guest path for judges, the Qloo reserve and an Anthropic cost cap, and a graceful offline state.

## Owns
- src/proxy.ts (Next 16 renamed middleware to proxy)
- src/lib/guard/
- vercel.json

## Reads
- CLAUDE.md
- docs/DECISIONS.md
- src/lib/qloo/
- src/app/api/

## Skills
- qloo-api

## Done when
- [x] `src/proxy.ts` refreshes the Supabase session on each request (T-06 helpers in src/lib/db/) and applies the auth Cache-Control headers, alongside the rate limits
- [x] Per-IP limits on `/api/seeds`, `/api/profile` and `/api/run` (for example 3 runs per hour per guest)
- [ ] (partial, see Known gap 1) When the Qloo reserve or the Anthropic daily cap is reached, the app shows a calm "demo is resting" state that serves cached runs, never an error page
- [x] The key and service role never reach the client bundle (checked by grepping the build output)
- [x] A deploy checklist in the handoff (env vars, Supabase project, `ATELIER_DEMO=1`). Deploying itself waits for the user's OK (hard rule 9)
- [x] Repo checks in CLAUDE.md pass; no Qloo data or secrets in tracked files

## Specialists
- tests: yes
- qloo-param-auditor: yes
- bridge-judge: no
- design-reviewer: no
- research question: none

## Evals
- call-budget
- repo-hygiene

## Qloo calls
- none new

## Handoff
Zero live Qloo and zero live Anthropic calls, no network, `.env` and `.qloo-private/` not read, nothing deployed, linked or pushed. `npm run typecheck`, `lint`, `test` (909 pass) and `build` pass; the build shows `ƒ Proxy (Middleware)`. No Qloo call added (qloo-param-auditor: nothing to audit).

### Files
`src/proxy.ts` (thin wrapper plus matcher), `src/lib/guard/`: `handler.ts` (`runProxy`), `policy.ts` (`decide`, `demoStatus`, `clientIp`), `store.ts` (counter interface plus in-memory store), `limits.ts` (tunables, `loadGuardConfig`), `session.ts` (Supabase refresh), `resting.ts` (client-safe contract), `bundle-scan.ts`, and a `*.test.ts` for each. `vercel.json` (security headers only).

### What the proxy does, in order
1. `GET /api/demo-status` is answered by the proxy itself (there is no route file): `{state:"open"}` or `{state:"resting", reason:"paused"|"daily_limit", retryAfterSeconds?}`. `no-store`. It never spends anything.
2. Guard on `POST /api/run`, `/api/profile`, `/api/profile/why`, `/api/seeds/resolve` (GET and other paths pass through). Active in production, off in dev and tests unless `ATELIER_GUARD=1` (`ATELIER_GUARD=0` turns it off in production). Per visitor (IP, rolling windows): run 3 an hour and 8 a day (`ATELIER_RUNS_PER_HOUR` overrides the first), profile 12 an hour, why 60 an hour, resolve 20 a minute and 90 an hour. Declared body size caps (413). Then two global rolling-24h meters charged at admission with the worst case of the route: model calls (run 8 = `LLM_MAX_CALLS_PER_RUN`, profile 1; daily cap 480, `ATELIER_DAILY_MODEL_CALLS`) and live Qloo calls (run 8 = 6 pools + `MAX_REQUERIES_PER_RUN`, profile 1, why 1, resolve 1; daily cap 480, `ATELIER_DAILY_QLOO_CALLS`). Admission is all-or-nothing: a refused request spends nothing. If either meter is full, every guarded route rests (so onboarding is never left half-working).
3. Supabase session refresh (T-06 contract): only when an `sb-*-auth-token` cookie exists and the Supabase env is set; `getClaims()` renews the token, cookies go on both request and response, and the headers `@supabase/ssr` supplies (Cache-Control: private, no-store) are applied with `applyAuthHeaders` from `src/lib/db/server.ts` (it builds in the proxy). Never throws; an auth outage means "continue as a guest". Only the anon key is read; the service role is never touched in the proxy. A refused request does no auth work.

### API error contract (for T-14 and the onboarding screens; constants in `@/lib/guard/resting`, client-safe)
All are JSON `{ error: { code, message, retryAfterSeconds? } }`, `Cache-Control: no-store`, fixed text, no address or key.
- `demo_resting`: HTTP 503, `Retry-After`, header `X-Atelier-Demo: resting`. The daily allowance is used up, or `ATELIER_REST=1` (manual pause).
- `too_many_requests`: HTTP 429, `Retry-After`. This visitor used their share; the demo is open for others. Not resting.
- `payload_too_large`: HTTP 413.
- `isRestingCode(code)` is true for `demo_resting`, `budget` (the Qloo client refusing a live call below `QLOO_RESERVE`, already returned by the routes as 503) and `lookups_off` (cache miss with live calls off). Screens should treat all three the same.
How the screens should show it (calm, never an error page, never a stack or status code):
- Wording: `RESTING_MESSAGE` ("The demo is resting for now. Picks already on your screen and anything you saved are still here. Come back a little later for a fresh run.") or their own words in that spirit. Show `retryAfterSeconds` only as "a little later" or "in about N minutes", never as a countdown to a refill.
- `/start`: on load, `GET /api/demo-status`; if resting, show a quiet notice at the top of the form and keep the form usable (the user can still type; a search that hits the code shows the same notice inline in place of the chip, not a red error). A `too_many_requests` on a lookup or "why" shows "A lot of searches just now. Try again in a minute." and keeps what was typed.
- `/taste`: a resting or 429 on `POST /api/profile` keeps the seeds and the last drawn chart (readTasteSession) and shows the notice with a retry button. Do not clear the session.
- `/picks`: resting on `POST /api/run` (a JSON 503 before streaming, like `busy`) keeps whatever result is already in the browser (`deck/storage.ts`) and shows the notice above the decks; with no stored result, show the notice in place of the decks with the profile chart still visible and a link to saved picks. `too_many_requests` says "You have used your runs for this hour" with the time. The run never retries by itself.
- "Serves cached runs": what rests is only the four POST routes. Picks already in the browser, saved profiles and picks from Supabase (T-17/T-18 routes), and every page keep working. The server-side Qloo cache keeps serving repeat requests that do not hit the proxy limit (see gap 1).

### Decisions I made (manager please check)
1. Durable counters: NOT built; IN-MEMORY store only (`createMemoryStore`, one per process on `globalThis`). It lives behind `CounterStore` (`consume`/`check` of `Hit[]`, all-or-nothing, async) so a durable store drops in. Why: the Next docs say a proxy should not rely on shared modules or globals, and on Vercel each instance counts alone (the real ceiling is cap times instances; one warm instance at demo traffic). A Supabase version needs a migration, which another ticket owns. Sketch if wanted: table `guard_counter(key text, at timestamptz, cost int)` with RLS on and no policies, plus an RPC `guard_consume(hits jsonb, now timestamptz)` that runs the same check and insert in one transaction, called with `createServiceClient()` in a `createSupabaseStore()` that falls back to the in-memory store when it errors.
2. The daily "Anthropic cap" is an estimate charged at admission (worst case 8 per run), not a count of real calls: model calls happen inside the routes, which the proxy cannot see (separate module graph). It is a hard upper bound per instance, and over-counts repeat runs (a repeat run that makes 0 live calls still pays 8). 480 a day is 60 runs a day (roughly 10 USD at current Sonnet pricing, my estimate, not measured). Raise `ATELIER_DAILY_MODEL_CALLS` if judges get turned away.
3. Qloo reserve: the guard cannot see `x-month-ratelimit-remaining` (the client does), so the monthly reserve stays in `src/lib/qloo/client.ts` and arrives as `budget`. The proxy adds only the daily Qloo estimate above. IMPORTANT: with `ATELIER_DEMO=1` the client ignores the reserve entirely, so the reserve could never put the demo to rest. Recommendation: in the deployed demo leave `ATELIER_DEMO` UNSET and set `QLOO_RESERVE` to a small floor (about 300) instead. That lets the demo spend the dev reserve and still stop calmly. Set `ATELIER_DEMO=1` only if you want no floor at all.
4. The vercel.json `functions` block is left out on purpose: a path pattern that matches no function fails the Vercel build and I cannot verify it offline. `maxDuration = 120` is already exported by `src/app/api/run/route.ts`, which Vercel honours. vercel.json carries only security headers (nosniff, referrer policy, frame deny, permissions policy). No CSP (Next's inline scripts need a nonce setup).
5. Tunables are in `src/lib/guard/limits.ts`, not `src/lib/agent/config.ts` (not mine). Proposed move: `RUNS_PER_HOUR_PER_IP=3`, `RUNS_PER_DAY_PER_IP=8`, `DAILY_MODEL_CALLS=480`, `DAILY_QLOO_CALLS=480`, `MAX_TRACKED_KEYS=5000`, the per-route `ipLimits` and `maxBodyBytes`.
6. Visitor identity is the IP (`x-real-ip`, else first `x-forwarded-for`; IPv6 reduced to /64; unreadable shares one "unknown" bucket). On Vercel those headers are set by the platform. Signed-in users get the same limits (a cookie or a client claim is not trusted for more).

### Key and service role out of the client bundle
`src/lib/guard/bundle-scan.test.ts` (run by `npm test`): after `npm run build` it scans `.next/static` and the prerendered `.next/server/app` pages for server-only names (`QLOO_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `x-api-key`, the Qloo and Anthropic hosts), key shapes (`sk-ant-`, `sb_secret_`, a JWT with role `service_role`) and, when the env is loaded, the real secret values. It is skipped when there is no build. Findings name the file and rule, never the text. It passed on this build (44 static files, 178 prerendered). It also checks that no `src/` file or `.env.example` line reads a secret through `NEXT_PUBLIC_*`. Before deploying, run it with values: `npm run build && node --env-file=.env node_modules/vitest/vitest.mjs run src/lib/guard/bundle-scan.test.ts` (you load `.env`; I did not).

### Deploy checklist (do nothing until the user says go: hard rule 9)
1. Supabase project: create it, run `supabase/migrations/` in order (qloo_cache, user tables with RLS). Auth: email sign-in on, "Confirm email" ON (magic links), anonymous sign-ins OFF. Site URL = the deployed origin; Redirect URLs allow-list `https://<origin>/auth/callback` exactly (no query string). Custom SMTP if the built-in email limit is too low for judging.
2. Vercel env vars (Production): `QLOO_BASE_URL=https://hackathon.api.qloo.com`, `QLOO_API_KEY`, `QLOO_MODE`, `QLOO_RESERVE`, `ANTHROPIC_API_KEY`, `ATELIER_MODEL=claude-sonnet-5-5`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (these two are public by design), `SUPABASE_SERVICE_ROLE_KEY` (server only, never `NEXT_PUBLIC_`), `SITE_URL=https://<origin>` (https, no path), `ATELIER_CONTACT` (Wikidata User-Agent), optional `ATELIER_PLACES_LOCATION`, `ATELIER_PLACES_RADIUS`. Guard: `ATELIER_RUNS_PER_HOUR` (default 3), `ATELIER_DAILY_MODEL_CALLS`, `ATELIER_DAILY_QLOO_CALLS`, `ATELIER_REST=1` as the manual pause (redeploy or edit the var; takes effect on the next cold start, so also redeploy). `ATELIER_GUARD` unset (on in production).
3. `ATELIER_DEMO`: leave UNSET and use `QLOO_RESERVE` about 300 (decision 3), or set `1` for no floor.
4. `QLOO_MODE` for the demo: `record` (live on a miss, then cached) so judges can type their own seeds; the guard and run caps bound the spend. `replay` is only for a frozen demo: every unseen seed would be `lookups_off`. Never `live` (no cache, burns the key). The key must be live through Nov 16 (hackathon key is deactivated after).
5. Cache adapter in production: MUST be Supabase (`createSupabaseQlooCache`, service role, private table). The routes today call `createQlooClient()` with the default file cache under `.qloo-private/cache`, which does not exist on Vercel and is not writable, so on Vercel `record` would never persist and `replay` would always miss. The routes (`src/app/api/{seeds/resolve,profile,profile/why,run}/route.ts`, not mine) or `createQlooClient`'s default (T-03) need to pick the Supabase adapter when `VERCEL` or `NODE_ENV=production`. Do this before deploy. The build also prints a Turbopack warning that `src/lib/qloo/cache-file.ts` traces the whole project; the same change fixes it.
6. Vercel plan and limits: `/api/run` needs `maxDuration` 120 (already exported). Confirm in the dashboard that the plan and Fluid compute allow it (older Hobby limits were 60 s). Region near the Supabase project.
7. Check the built output has no secrets (command above), then smoke test with `ATELIER_REST=1` locally (`ATELIER_GUARD=1 ATELIER_REST=1 npm run dev`: `curl -X POST localhost:3000/api/run` returns 503 `demo_resting`, `curl localhost:3000/api/demo-status`).
8. Before Nov 16: watch the Qloo monthly remaining (any response header `x-month-ratelimit-remaining`) and the Anthropic spend; raise or lower the daily caps.

### Known gaps
1. While resting, the proxy refuses ALL guarded POSTs, including repeat runs that would have been served from the Qloo cache and the in-memory model-reply cache. The proxy cannot tell a repeat (the `plan` in the body is client-supplied and a repeat can still make up to 6 explanation calls), so "serves cached runs" means what is already in the browser and in Supabase, plus the repeat requests made before the allowance runs out. A true server-side cache-only mode needs the routes to read a "resting" signal and run with `QLOO_MODE=replay` and no model; that is a follow-up in T-10 and T-03 territory.
2. In-memory counters: per instance, reset on a cold start (decision 1).
3. `ATELIER_REST` is read at process start (env); there is no runtime toggle.
4. The `demo-status` endpoint does not know about the Qloo monthly reserve (client state). `budget` covers it when a call is refused.
5. The mapping of `demo_resting` and `too_many_requests` into `messageForError` (`src/components/onboarding/copy.ts`) and the picks screen copy belongs to the UI tickets.
6. Suggested additions to `.env.example` (shared file, not edited): `ATELIER_RUNS_PER_HOUR`, `ATELIER_DAILY_MODEL_CALLS`, `ATELIER_DAILY_QLOO_CALLS`, `ATELIER_REST`, `ATELIER_GUARD`, `ATELIER_DEMO`.
