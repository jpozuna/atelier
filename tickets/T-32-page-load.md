# T-32: Faster page loads and onboarding steps in the browser

Status: todo
Mode: inline
Kind: fix
Priority: P1
Depends on: none

## Goal
Make first load and moving between pages (/, /start, /taste, /picks) and each onboarding step feel quick: smaller client bundles, no render-blocking font or script work, and no waterfalls of requests the browser waits on.

## Owns
- src/app/layout.tsx
- next.config.ts
- src/app/page.tsx, src/app/page.module.css
- src/app/(onboarding)/
- src/app/(picks)/picks/page.tsx
- src/components/onboarding/
- src/components/shell/

## Reads
- CLAUDE.md, docs/DECISIONS.md
- src/app/globals.css, src/styles/tokens.css (do not edit; note any needed change in the hand-off)
- src/components/deck/ and src/components/chart/ (T-30 and T-29 own them; do not edit)
- src/app/api/ routes the onboarding calls (T-31 owns them)

## Skills
- atelier-design

## Done when
- [ ] Hand-off has a before/after table from `npm run build` (first-load JS per route) and a local production run (`npm run build && npm start`) timing of each page's load
- [ ] Fonts load with `next/font` (no layout shift, no blocking external CSS); heavy client components the first paint does not need are split out or loaded lazily; links prefetch the next onboarding step
- [ ] Onboarding fires independent requests together (e.g. resolving several seeds at once, or the profile "why" alongside the profile) instead of one after another, with no change to the number of requests per seed (max 2 live Qloo calls per seed still holds)
- [ ] Each step shows immediate feedback (pending state within 100ms of the action) while a request runs
- [ ] No visual change beyond loading states. `npm test`, `npm run typecheck`, `npm run lint`, `npm run build` pass
- [ ] Zero live Qloo calls while measuring (replay/cache or synthetic only)

## Specialists
- tests: yes
- qloo-param-auditor: no
- bridge-judge: no
- design-reviewer: yes (loading states only)
- research question: none

## Evals
- call-budget, repo-hygiene

## Qloo calls
- none

## Handoff
