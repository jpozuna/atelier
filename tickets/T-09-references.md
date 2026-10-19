# T-09: Reference layer: lineage and readings

Status: todo
Mode: inline
Kind: feature
Priority: P1
Depends on: T-02

## Goal
`getReferences(entity)` returns sourced lineage hops and readings with provenance, from Qloo's own lineage fields and Wikidata, and returns nothing when nothing is retrieved.

## Owns
- src/lib/refs/

## Reads
- CLAUDE.md
- docs/DECISIONS.md
- docs/spike-report.md (question 3)
- src/types/

## Skills
- atelier-agent-loop
- atelier-evals

## Done when
- [ ] Lineage sources: music influence fields (`influenced_by`, `artists_influenced`, `genres_influenced`), film and TV `influenced_other_media`, fashion `similar_brands`, all read from data already fetched (no extra Qloo call), plus Wikidata (CC0) by `wikidata_id` for film, TV and fashion
- [ ] Books and places return no lineage. Readings appear only when retrieved text supports them, labeled "a reading". Sourced and inferred are never merged in one hop
- [ ] Every sourced hop carries a source link and license note. Wikidata calls are cached and limited to finalists (at most 6 per run)
- [ ] Tests run on synthetic fixtures for each domain, including the empty case
- [ ] Repo checks in CLAUDE.md pass; no Qloo data or secrets in tracked files

## Specialists
- tests: yes
- qloo-param-auditor: no
- bridge-judge: yes
- design-reviewer: no
- research question: What is Wikidata's rate limit and User-Agent policy for anonymous SPARQL or wbgetentities calls from a demo server?

## Evals
- provenance
- lineage-groundedness (judge, T-18)

## Qloo calls
- none (reuses insights data; Wikidata is external)

## Handoff
(Worker fills in.)
