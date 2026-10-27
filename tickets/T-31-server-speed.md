# T-31: Faster onboarding and picks on the server

Status: todo
Mode: inline
Kind: fix
Priority: P1
Depends on: none

## Goal
Cut the wall-clock time of seed lookup, the profile build and the picks run (`/api/seeds/resolve`, `/api/profile`, `/api/profile/why`, `/api/run`) without changing what they return or how many Qloo calls they make.

## Owns
- src/lib/agent/loop.ts
- src/lib/agent/llm.ts
- src/lib/agent/explain.ts
- src/lib/agent/prompts.ts
- src/lib/profile/ (handler, naming, build, why; and their tests)
- src/app/api/run/
- src/app/api/profile/
- src/app/api/seeds/
- scripts/perf/ (new: timing script; output goes to .qloo-private/perf/, never committed)

## Reads
- CLAUDE.md (hard rules 1, 8, 10), docs/DECISIONS.md
- src/lib/agent/config.ts (manager-only: propose any concurrency or token-limit changes in the hand-off; do not edit)
- src/lib/qloo/client.ts, cache.ts, cache-select.ts (do not edit)
- src/components/onboarding/OnboardingFlow.tsx (how the client calls these routes; T-32 owns it)

## Skills
- atelier-agent-loop, qloo-api, atelier-evals

## Done when
- [ ] Zero live Qloo calls: timing runs use `QLOO_MODE=replay`/cache or synthetic data with a stubbed LLM that adds a fixed delay per call. If any step would need a live call, stop and report the dry-run count instead
- [ ] A timing script under scripts/perf/ prints per-stage times (LLM calls, Qloo calls, total) for each route, and the hand-off has a before/after table
- [ ] Every await chain that does not depend on the previous result runs in parallel (e.g. theme choice vs. pool prefetch, references vs. explanations, why-text vs. axis naming), and LLM calls use prompt caching and sensible `max_tokens` where safe
- [ ] `/api/run` streams the first picks as soon as they are ready rather than at the end, if it does not already (the client already reads a stream)
- [ ] Same outputs: call counts per run unchanged or lower (call-budget scorer green), path and explanation contracts unchanged, all evals green
- [ ] `npm test`, `npm run typecheck`, `npm run lint`, `npm run evals` pass

## Specialists
- tests: yes
- qloo-param-auditor: yes (only if any Qloo call is touched)
- bridge-judge: yes (only if prompts.ts or explain.ts change)
- design-reviewer: no
- research question: none

## Evals
- call-budget, path-complete, explanation-grounded, frontier-only, repo-hygiene (and every scorer in `npm run evals`)

## Qloo calls
- none new. Existing calls may be reordered or run concurrently within the 5/second limit in src/lib/qloo/limits.ts; params unchanged

## Handoff
