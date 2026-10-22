# T-26: Cut the plain-model comparison and the trace panel

Status: todo
Mode: inline
Kind: polish
Priority: P0
Depends on: T-25

## Goal
Remove the Qloo-vs-plain-LLM comparison (T-22) and the user-facing step-by-step reasoning trace from the product, so nothing links to them, nothing serves them, and the build stays green.

## Owns
- src/app/(compare)/ (delete)
- src/app/api/compare/ (delete)
- src/components/compare/ (delete)
- src/components/reasoning/ (delete, unless T-27 or evals still need a pure helper; then keep only that file and say so)
- src/app/dev/reasoning/ (delete)
- src/components/onboarding/TasteView.tsx (drop the ReasoningPanel)
- src/lib/guard/limits.ts, src/lib/guard/policy.test.ts (drop the /api/compare route policy)

## Reads
- CLAUDE.md, docs/DECISIONS.md
- tickets/T-22-qloo-vs-llm.md, tickets/T-16-reasoning-panel.md
- src/lib/agent/config.ts (the manager removes the `GUARD_COMPARE_*` and Compare constants at accept; list them in the hand-off)

## Skills
- none

## Done when
- [ ] `grep -rn "compare" src` finds no route, link, component or guard for the comparison
- [ ] `/compare` and `/api/compare` return 404. `/taste` shows no trace panel
- [ ] No file outside Owns imports a deleted module. Repo checks and `npm run evals` pass
- [ ] Hand-off lists every config constant that is now unused, plus README lines that mention compare (the manager edits both)

## Specialists
- tests: no
- qloo-param-auditor: no
- bridge-judge: no
- design-reviewer: yes (TasteView only)
- research question: none

## Evals
- call-budget, repo-hygiene

## Qloo calls
- none

## Handoff
