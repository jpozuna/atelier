# T-09: Reference layer: lineage and readings

Status: done
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
- [x] Lineage sources: music influence fields (`influenced_by`, `artists_influenced`, `genres_influenced`), film and TV `influenced_other_media`, fashion `similar_brands`, all read from data already fetched (no extra Qloo call), plus Wikidata (CC0) by `wikidata_id` for film, TV and fashion
- [x] Books and places return no lineage. Readings appear only when retrieved text supports them, labeled "a reading". Sourced and inferred are never merged in one hop
- [x] Every sourced hop carries a source link and license note. Wikidata calls are cached and limited to finalists (at most 6 per run)
- [x] Tests run on synthetic fixtures for each domain, including the empty case
- [x] Repo checks in CLAUDE.md pass; no Qloo data or secrets in tracked files

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

Status after review fixes: review. Files: `src/lib/refs/` (`index.ts` API, `lineage.ts`, `wikidata.ts`, `reading.ts`, `limits.ts`, `types.ts`, `testing.ts`, `refs.test.ts`, 47 tests). Zero network calls anywhere; `fetch` is injected. No refs file has a typecheck error (current tsc errors, if any, are in other workers' files). Lint clean, `npm test` and `npm run evals` green.

**For T-08 and T-10: create ONE refs context per run (`createRefsContext()`) when the run starts, and call `getReferences` for finalists only, reusing that context.** The per-run cap (6 finalists), the serial request queue, the 12 s deadline and the run-level block all live in the context. A new context per pick would defeat them (the process-wide `blockedUntil` and the cache would still apply).

**API** (server-only, `import ... from "@/lib/refs"`):
- `createRefsContext({ fetch?, contact?, cache?, block?, limits?, now? }): RefsContext`. The cache defaults to a shared in-memory TTL cache (7 days). `block` defaults to a process-wide `{ until }` (module-level `blockedUntil`); tests pass their own, or call `resetSharedBlock()`.
- `getReferences(entity: RefsEntity, ctx, { seedNames? }): Promise<References>`. `RefsEntity = { qlooId, name, field, properties?, external? }`, built from an insights item already fetched. Makes NO Qloo call. Never throws for Wikidata trouble. `seedNames` (resolved seed names) puts seed-matching related names first in a hop label.
- `References = { qlooId, field, lineage: LineageRef[], reading?: Reading, sourceUrls: string[], wikidata: ok|cached|not_applicable|no_id|no_contact|budget_exhausted|unavailable }`.
  - `LineageRef = { source: "qloo"|"wikidata", relation, names, allNames, hop: PathHop, license, sourceLabel? }`. `names` is what the label shows (max 3: seed matches first, then source order). **`allNames` is the full related list; match seeds against `allNames`.** `hop` is ready for `Path.hops` (`kind: lineage`, `provenance: sourced`, `sourceUrl` set).
  - `Reading = { label: "a reading", text, sourceUrl, source, sourceLabel?, license }`, assignable to `CardReading`.
- `lineageTouchingSeeds(refs, seedNames)`: hops whose `allNames` include a seed name (case and punctuation folded).
- `refsTraceFields(all)`: `{ sourcedCount, inferredCount: 0, sourceUrls }` for `fetch_refs`. Refs never emit inferred hops.

**UI contract (T-15 and T-16):** for `source === "qloo"` (hop or reading), render "Source: Qloo" from `sourceLabel` with NO link. `sourceUrl` is `https://www.qloo.com/`, kept only to satisfy the non-empty contract. Qloo license note: "Qloo data, shown under the hackathon API terms". For Wikidata, link `hop.sourceUrl` (the item page) and show the credit "Data from Wikidata (CC0)" (the `license` field).

**Sources by field**: music reads `influenced_by`, `artists_influenced`, `genres_influenced` (Qloo only). Film and TV read `influenced_other_media` plus Wikidata P144, P737, P941. Fashion reads `similar_brands` plus Wikidata P737, P941. Books and places: nothing, no Wikidata call. All Qloo fields are list[str] (confirmed from cached spike data); the code also tolerates objects with name/title/label.

**Readings (manager decision)**: only from `style_description` on movie, tv_show and brand (exact key allowlist in `reading.ts`, no suffix matching). Never from biography, description or plot_summary. Music, books and places have none. The text is an excerpt: markup stripped, whitespace collapsed, cut at a sentence end at or before 280 characters (no cut at common abbreviations or single-letter initials; closing quotes and brackets stay with the sentence), else a word cut with an ellipsis. At most one reading. The explainer must use only `reading.text` and label it a reading.

**Wikidata policy (researcher-verified, now implemented)**:
- User-Agent `AtelierHackathonDemo/0.1 (<ATELIER_CONTACT>)`. The contact must be an email or URL and not a placeholder (the `.env.example` value `your-contact-email-or-project-url` counts as a placeholder). Otherwise status `no_contact`, no request, no contactless fallback. Qloo-sourced hops still return.
- `maxlag=5` on every request. A 200 body with error code `maxlag` is a failure.
- 429, 503 and maxlag set a process-wide `blockedUntil` from `Retry-After` (seconds or HTTP date; default 60 s; capped at 10 min), so the next run does not retry at once. They also block the rest of the run. A timeout, network failure or other error blocks the rest of the run only.
- Requests are serial (a queue). One request has an 8 s timeout. All Wikidata work in a run has a 12 s deadline from its first request.
- Per finalist: one claims request, then labels in batches of at most 50 ids. Up to 10 related items per property are kept. An item with no English label is dropped.
- Cap 6 finalists per run (at most 12 requests). Cache hits are free and cached results are re-labelled for the caller's seeds.

**Proposed `config.ts` names** (numbers live in `src/lib/refs/limits.ts` for now; moving them is a one-file change): `WIKIDATA_MAX_LOOKUPS_PER_RUN = 6`, `WIKIDATA_MAX_TARGETS_PER_PROPERTY = 10`, `WIKIDATA_MAX_LABEL_IDS = 50`, `WIKIDATA_TIMEOUT_MS = 8000`, `WIKIDATA_RUN_DEADLINE_MS = 12000`, `WIKIDATA_MAXLAG_SECONDS = 5`, `WIKIDATA_DEFAULT_RETRY_MS = 60000`, `WIKIDATA_MAX_RETRY_MS = 600000`, `WIKIDATA_CACHE_TTL_MS = 7d`, `REFS_MAX_NAMES_PER_HOP = 3`, `READING_MAX_CHARS = 280`, `READING_MIN_CHARS = 40`.

**src/types**: no change required. Optional: `properties?` and `external?` on `Candidate` so T-08 can feed `getReferences`, and `license?` / `sourceLabel?` on `PathHop` so a card can render provenance from the path alone (today they travel on `LineageRef`).

**Known gaps**:
- The Wikidata cache is in-memory only (lost on restart). The `blockedUntil` is per process, so serverless instances each start unblocked.
- Fashion `similar_brands` is similarity, not influence; the label says "Listed as a similar brand to ...".
- No bridge-judge or lineage-groundedness run yet (T-18).
