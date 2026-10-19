# T-16: Reasoning panel

Status: todo
Mode: inline
Kind: feature
Priority: P0
Depends on: T-02, T-11

## Goal
A side panel that turns streamed TraceEvents into short readable steps (what the agent looked at, what it decided and why, including re-queries), so the reasoning is visible.

## Owns
- src/components/reasoning/

## Reads
- CLAUDE.md
- docs/DECISIONS.md
- .claude/skills/atelier-design/SKILL.md
- .claude/skills/atelier-evals/SKILL.md (trace format)
- src/types/

## Skills
- atelier-design

## Done when
- [ ] Each TraceEvent type has a one-line human rendering. Re-queries show their reason code in words. Cached calls are not shown as separate steps
- [ ] Never shows ids, raw params, scores or the API key
- [ ] Streams in order, can be collapsed, and is announced politely to screen readers
- [ ] Built against a synthetic trace fixture
- [ ] Repo checks in CLAUDE.md pass; no Qloo data or secrets in tracked files

## Specialists
- tests: yes
- qloo-param-auditor: no
- bridge-judge: no
- design-reviewer: yes
- research question: none

## Evals
- none

## Qloo calls
- none

## Handoff
(Worker fills in.)
