# T-17: Save, revisit and follow-up

Status: todo
Mode: inline
Kind: feature
Priority: P1
Depends on: T-06, T-14

## Goal
Users with an account can save picks in one of the save states, give a reason for "not for me", come back later, say whether they tried a pick and how it went, and see the edges of their profile move.

## Owns
- src/app/(saved)/
- src/app/api/reactions/
- src/components/reactions/

## Reads
- CLAUDE.md
- docs/DECISIONS.md
- src/lib/db/
- src/components/card/
- .claude/skills/atelier-design/SKILL.md

## Skills
- atelier-design
- atelier-agent-loop

## Done when
- [ ] Saving asks a guest to create an account (magic link) and keeps their onboarding
- [ ] The saved list groups picks by state, and each opens its stored card (no Qloo call)
- [ ] Follow-up asks: tried it? how was it? why? On submit, re-run only the domains affected (at most 3 live calls)
- [ ] RLS: only the owner sees their picks and reactions
- [ ] Repo checks in CLAUDE.md pass; no Qloo data or secrets in tracked files

## Specialists
- tests: yes
- qloo-param-auditor: no
- bridge-judge: no
- design-reviewer: yes
- research question: none

## Evals
- call-budget

## Qloo calls
- via /api/run only

## Handoff
(Worker fills in.)
