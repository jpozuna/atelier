# Proposed ticket breakdown (starting point)

Adapt before use. Several tickets depend on the API spike (`docs/spike-report.md`) and on open decisions in `docs/DECISIONS.md`; those are marked. P0 = needed for the demo to make sense. Keep the cut line honest: if time runs short, drop from the bottom of P1 and P2 first.

| ID | Ticket | Kind | Pri | Depends on | Waits on |
|---|---|---|---|---|---|
| T-01 | Scaffold: Next.js + TS, lint, test runner, `.env.example`, `.gitignore` additions, open-source LICENSE, CLAUDE.md Commands filled in | feature | P0 | none | stack confirmed |
| T-02 | Shared contracts in `src/types/`: Seed, ProfileTag, Axis, Candidate, Path, Card, Pick, TraceEvent (start from `atelier-agent-loop/references/path-and-card-schema.md`) | feature | P0 | T-01 | |
| T-03 | Qloo client + registry: typed GET client, param validation that throws on anything not `listed` or `confirmed` (seed the registry from `qloo-api/references/registry.seed.json`), private server-side cache interface | feature | P0 | T-01 | spike (promote reference-only params) |
| T-04 | Eval harness: trace recorder, runner, synthetic fixtures, scorers `repo-hygiene` and `param-validity` first | feature | P0 | T-02, T-03 | |
| T-05 | Seed resolution via `/search` (scoped `types`, 404 = missing, 429 backoff): ambiguous and missing flagged, entity chips data | feature | P0 | T-03 | |
| T-06 | Supabase schema and auth: profiles, seeds with reasons, picks with stored paths, reactions; RLS on every table | feature | P0 | T-01, T-02 | |
| T-07 | Profile and axes: tags (taste analysis `urn:tag` per field, plus tags matched from each "why") to 6-8 grounded axes, using bridge tags | feature | P0 | T-05 | spike, open decision on clustering |
| T-08 | Frontier scoring and dial: reach, connection, bands, floor, fallback order | feature | P0 | T-07 | spike |
| T-09 | Reference layer: `get_references`, sourced vs inferred, license-safe sources | feature | P1 | T-02 | spike, source licenses |
| T-10 | Agent loop: tool definitions, plan, re-query with reason codes, explanation from path only | feature | P0 | T-08, T-09 (stub allowed) | runtime model decision |
| T-11 | Design tokens and shell layout (wordmark placeholder, serif type, light chrome) | feature | P0 | T-01 | |
| T-12 | Onboarding flow: field dropdown, thing, one-line why, entity chips, repeat, 5-10 min | feature | P0 | T-05, T-11 | input-process decision |
| T-13 | Attribute chart with nodes beyond the edge, path highlight (build against mock data first) | feature | P0 | T-02, T-11 | |
| T-14 | Calibration recs and edge recs in three degrees, decks by field, quiet card reveal | feature | P0 | T-10, T-13 | |
| T-15 | Card UI: path, why this one, what is different, provenance, reaction in the user's words | feature | P0 | T-13 | |
| T-16 | Reasoning panel: trace events rendered as readable steps | feature | P0 | T-10 | |
| T-17 | Save, revisit, and post-rec flow (save states, why box, tried-it follow-up) | feature | P1 | T-06, T-15 | |
| T-18 | LLM judges in the eval harness (groundedness, quality, defensibility, lineage, restraint, rubric fit) | feature | P1 | T-10, T-04 | |
| T-19 | Remaining code scorers (dial behavior, re-query, coverage, path, reach margin, connection floor, provenance, card completeness) | feature | P0 | T-10, T-04 | |
| T-20 | Deploy and free-demo hardening: rate limits, private cache, key handling, cost cap, guest path for judges | feature | P0 | T-14 | deploy approval |
| T-21 | README, license check, demo video script, Devpost text | docs | P0 | most | run `/submission-check` |
| T-22 | Qloo-vs-plain-LLM side-by-side (demo and eval) | feature | P2 | T-10 | open decision |

Parallel groups once T-02 and T-03 exist: {T-05, T-06, T-11}, then {T-07, T-12, T-13}, then {T-08, T-09, T-15}. The chart (T-13) can start on mock data before the agent exists, which keeps the design work unblocked during the spike.
