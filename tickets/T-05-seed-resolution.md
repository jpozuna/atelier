# T-05: Seed resolution

Status: done
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
Zero live Qloo calls (no .env read, no QLOO_LIVE, mode never set to live). 24 tests in src/lib/seeds on synthetic fixtures with the T-03 fake fetch; typecheck, lint and the full test run (230) pass.

### Route: `POST /api/seeds/resolve`
Request: `{ "field": "music"|"film"|"tv"|"books"|"food_places"|"fashion", "query": string }`. Query is whitespace-collapsed, then must be 2 to 100 chars. Body over 2000 chars is rejected.

Response 200 (always `Cache-Control: no-store`):
```ts
{ status: "clean", entity: SeedChip, candidates: [] }
{ status: "ambiguous", candidates: SeedChip[] }   // 1 to 5, no `entity`
{ status: "missing", candidates: [] }
SeedChip = { qlooId, name, type /* "movie", "tv_show", ... */, label /* "Name (2001, disambiguation)" */, year?, disambiguation?, imageUrl? /* https only */ }
```
`SeedChip` extends the shared `SeedCandidate` (`qlooId`, `label`), so a chip can be stored as `Seed.candidates` and `entity.qlooId` goes into `Seed.qlooId`. For ambiguous, the onboarding UI should set `Seed.status` from `status`, keep `candidates`, and set `qlooId` only when the user picks one.

Errors: `{ error: { code, message } }` with 400 `bad_request`; 503 `lookups_off` (replay cache miss, message names `QLOO_MODE=replay`); 503 `budget`; 503 `rate_limited`; 502 `upstream` (HTTP, network or parse failure); 500 `config` (bad places env or Qloo config); 500 `internal`. Messages are fixed strings; no Qloo text, ids beyond chips, or key is ever returned.

### Behavior
- One `/search` call per resolve: `{ query, types: [<one type>], take: 10 }` plus, for `food_places` only, `filter.location` ("lat,lon") and `filter.radius` (miles). A repeat (any case or spacing) is a client cache hit, 0 live calls (tested with `client.stats().liveCalls`). Replay cold cache sends nothing.
- Field map (src/lib/seeds/field-types.ts, typed against `ATELIER_SEARCH_TYPES`): music artist, film movie, tv tv_show, books book, food_places place, fashion brand.
- Rules: items not of the field's type, with no name or id, or duplicate ids are dropped first. One exact-name match is `clean` (exact = same after removing accents, case, punctuation, "&"->"and", and a leading the/a/an). Two or more exact matches, or none but results, is `ambiguous` (exact matches first, then Qloo's order, max 5). Empty outcome (200 empty or the "No results" 404), or nothing usable left, is `missing`.

### Contracts and things for the manager
- **New env vars for .env.example** (both optional): `ATELIER_PLACES_LOCATION="40.7128,-74.0060"` (lat,lon, default New York) and `ATELIER_PLACES_RADIUS=20` (miles, above 0 to 100). Malformed values give a 500 `config`, not a silent fallback.
- **Tunable numbers**: take 10, max 5 candidates, query length 2..100, body cap, default city and radius live in `src/lib/seeds/constants.ts` because I cannot edit the shared `src/lib/agent/config.ts`. Move them there if you want every number in one file.
- Only `client.search` is used. Qloo calls added: `/search` GET with `query`, `types`, `take`, `filter.location`, `filter.radius` (all in the registry's /search list; `types` limited to the six Atelier types by the client). For qloo-param-auditor: nothing else is sent.
- `src/lib/seeds/handler.ts` holds the logic (route.ts must export only handlers); `route.ts` just creates one client per request.
- `resolveSeed(client, {field, query}, env?)` in `src/lib/seeds/resolve.ts` is reusable server-side (it takes any object with `search`).

### Known gaps
- /search item property names for release year are undocumented (the spike lists only insights fields). `chip.ts` tries release_year, release_date, publication_year, publication_date, first_air_date, year, founded, launch_year, and the image from `properties.image` (string or `{url}`). A live look (with the user's OK) can confirm names; until then chips may show only `disambiguation`.
- The "lat,lon" format for `filter.location` follows the spike script; not re-verified live.
- Entity-type scoping is also checked in code against `item.types`, in case Qloo returns other types.
- Short queries of 2 chars are allowed ("Up"); the UI should still debounce and call on submit only (skill budget table).
