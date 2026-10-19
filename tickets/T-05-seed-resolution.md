# T-05: Seed resolution

Status: todo
Mode: inline
Kind: feature
Priority: P0
Depends on: T-03

## Goal
Turn a typed thing plus its field into a resolved Qloo entity, or a short list of candidates when ambiguous, so onboarding can show entity chips.

## Owns
- src/lib/seeds/
- src/app/api/seeds/

## Reads
- CLAUDE.md
- docs/DECISIONS.md
- docs/spike-report.md (probes 1 and 23)
- src/lib/qloo/
- src/types/

## Skills
- qloo-api

## Done when
- [ ] `POST /api/seeds/resolve` with `{field, query}` returns `{status: clean | ambiguous | missing, entity?, candidates[]}`. It makes at most one `/search` call (`take` at most 10), and a repeated query makes 0 live calls
- [ ] Ambiguity rules: several exact-name matches, or no exact match but results, mean `ambiguous`, with up to 5 candidates (name, year or disambiguation, type). An empty 200 means `missing`
- [ ] Places add a location (the default is a configurable city) so local results resolve
- [ ] Field-to-type mapping: music artist, film movie, TV tv_show, books book, food and places place, fashion brand
- [ ] The route runs server-side only and never returns raw Qloo JSON beyond the fields the chips need
- [ ] Tests run on synthetic fixtures for clean, ambiguous and missing
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

## Qloo calls
- /search GET: query, types, take, filter.location, filter.radius

## Handoff
(Worker fills in.)
