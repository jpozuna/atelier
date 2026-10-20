# T-20: Deploy and free-demo hardening

Status: todo
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
- [ ] `src/proxy.ts` refreshes the Supabase session on each request (T-06 helpers in src/lib/db/) and applies the auth Cache-Control headers, alongside the rate limits
- [ ] Per-IP limits on `/api/seeds`, `/api/profile` and `/api/run` (for example 3 runs per hour per guest)
- [ ] When the Qloo reserve or the Anthropic daily cap is reached, the app shows a calm "demo is resting" state that serves cached runs, never an error page
- [ ] The key and service role never reach the client bundle (checked by grepping the build output)
- [ ] A deploy checklist in the handoff (env vars, Supabase project, `ATELIER_DEMO=1`). Deploying itself waits for the user's OK (hard rule 9)
- [ ] Repo checks in CLAUDE.md pass; no Qloo data or secrets in tracked files

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
(Worker fills in.)
