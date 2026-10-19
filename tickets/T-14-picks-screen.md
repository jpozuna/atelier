# T-14: Calibration and edge picks screen

Status: todo
Mode: inline
Kind: feature
Priority: P0
Depends on: T-10, T-13, T-15, T-16

## Goal
The picks screen: calibration picks first for the user to correct, then edge picks in three degrees shown together, dealt as decks by field with a quiet card-pack reveal, with fields that can be hidden.

## Owns
- src/app/(picks)/
- src/components/deck/

## Reads
- CLAUDE.md
- docs/DECISIONS.md
- .claude/skills/atelier-design/SKILL.md
- src/app/api/run/
- src/components/chart/
- src/components/card/
- src/components/reasoning/

## Skills
- atelier-design
- atelier-agent-loop

## Done when
- [ ] Calibration picks (same-field and cross-field) come first. The user can mark one "not me", which re-runs only the affected domains
- [ ] Edge picks show moderate, high and extreme together, in decks by field. Hiding a field hides its deck without new calls
- [ ] The reveal animates calmly and respects reduced motion
- [ ] The chart, the deck and the reasoning panel (streamed from `/api/run`) are on one screen. Selecting a chart node opens its card and vice versa
- [ ] Works as a guest
- [ ] Lays out the reasoning panel itself (two columns at 64rem and up, collapsible and stacked below on narrow screens). The root layout's Shell has no side region, and T-14 does not edit the root layout
- [ ] On narrow screens, where the reasoning panel stacks below, new steps are visible without hunting (auto-scroll within the panel, or a "latest step" line near the top)
- [ ] Passes a stable, memoized `picks` array to `AttributeChart` (T-13 resets hover and focus when the array identity changes)
- [ ] Repo checks in CLAUDE.md pass; no Qloo data or secrets in tracked files

## Specialists
- tests: no
- qloo-param-auditor: no
- bridge-judge: yes
- design-reviewer: yes
- research question: none

## Evals
- call-budget
- card-completeness

## Qloo calls
- via /api/run only

## Handoff
(Worker fills in.)
