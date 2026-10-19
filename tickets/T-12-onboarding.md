# T-12: Onboarding: field, thing, why, repeat

Status: todo
Mode: inline
Kind: feature
Priority: P0
Depends on: T-05, T-07, T-11

## Goal
A 5 to 10 minute onboarding where the user picks a field, types a thing, picks the right entity chip and writes one line on why they love it, repeating across fields, then lands on their chart.

## Owns
- src/app/(onboarding)/
- src/components/onboarding/

## Reads
- CLAUDE.md
- docs/DECISIONS.md
- .claude/skills/atelier-design/SKILL.md
- src/app/api/seeds/
- src/app/api/profile/
- src/components/shell/

## Skills
- atelier-design

## Done when
- [ ] Field dropdown with the six locked domains. Search fires on submit only (or debounced, min 3 characters), never per keystroke
- [ ] Ambiguous results show up to 5 chips to choose from. Missing shows a gentle retry. Clean auto-selects with a chance to change it
- [ ] The "why" line is required, one line, and saved with the seed
- [ ] "Add another" repeats the flow. "See my taste" needs at least 3 seeds across at least 2 fields and calls `/api/profile`
- [ ] Keyboard-only completion works. Screen-reader labels on every control
- [ ] Works as a guest (no account)
- [ ] Repo checks in CLAUDE.md pass; no Qloo data or secrets in tracked files

## Specialists
- tests: no
- qloo-param-auditor: no
- bridge-judge: no
- design-reviewer: yes
- research question: none

## Evals
- seed-resolution
- call-budget

## Qloo calls
- via /api/seeds and /api/profile only

## Handoff
(Worker fills in.)
