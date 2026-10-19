# T-07: Profile and axes from taste analysis

Status: todo
Mode: inline
Kind: feature
Priority: P0
Depends on: T-05

## Goal
Build the taste profile from resolved seeds and their reasons: one taste-analysis call gives scored tags, each "why" maps to tags, and tags group into 6 to 8 axes by tag type, each listing its tags.

## Owns
- src/lib/profile/
- src/app/api/profile/

## Reads
- CLAUDE.md
- docs/DECISIONS.md
- docs/spike-report.md (probes 7, 15, 22, 24)
- .claude/skills/atelier-agent-loop/references/scoring.md (Axes)
- src/lib/qloo/
- src/types/

## Skills
- atelier-agent-loop
- qloo-api
- atelier-evals

## Done when
- [ ] A profile build makes exactly 1 taste-analysis call with all seeds (`take=50`), plus 1 semantic `/v2/tags` call per new "why" (cached, deduped by tag name)
- [ ] Tags are grouped into axes by `subtype` (tag type), weighted by `query.affinity`. Generic tags are dropped (present in most of the pool), axes with fewer than 2 tags are dropped, and 6 to 8 axes are kept. Each axis stores its member tags
- [ ] Axis names come from an LLM call that sees only that axis's tags, and the label must be justified by listed tags (stored with the axis). No tag is invented: every tag id comes from Qloo
- [ ] Bridge tags (a tag whose `types` include another domain's entity type) are flagged for T-08 and T-10
- [ ] `POST /api/profile` returns the profile and axes and emits TraceEvents for each step
- [ ] Tests run on synthetic fixtures. A scorer or test shows every axis has at least 2 Qloo tag ids and no label word missing from its tags without a justification
- [ ] Repo checks in CLAUDE.md pass; no Qloo data or secrets in tracked files

## Specialists
- tests: yes
- qloo-param-auditor: yes
- bridge-judge: no
- design-reviewer: no
- research question: none

## Evals
- param-validity
- call-budget
- domain-coverage

## Qloo calls
- /v2/insights (urn:tag): signal.interests.entities, take
- /v2/tags GET: filter.query, feature.semantic_search, filter.parents.types, take

## Handoff
(Worker fills in.)
