# Board

Planned 2026-10-19. Feature freeze Oct 25. Target submit Oct 29. All tickets run inline (`ticket-worker` subagents), at most 3 at once.

## Waves (dependency order; tickets in one wave run in parallel)

| Wave | Target | Tickets |
|---|---|---|
| 1 | Oct 19 | T-01 scaffold |
| 2 | Oct 19-20 | T-02 contracts, T-03 Qloo client, T-11 tokens and shell |
| 3 | Oct 20-21 | T-04 eval harness, T-05 seed resolution, T-13 chart (mock data) |
| 4 | Oct 21 | T-06 Supabase, T-07 profile and axes, T-15 card |
| 5 | Oct 22 | T-08 frontier, T-09 references, T-12 onboarding |
| 6 | Oct 23 | T-10 agent loop, T-16 reasoning panel |
| 7 | Oct 24 | T-14 picks screen, T-19 code scorers |
| 8 | Oct 25 (freeze) | T-20 deploy hardening, T-17 save and revisit, T-18 LLM judges |
| after freeze | Oct 26-29 | T-21 submission docs, fixes and polish, `/submission-check` |
| optional | if time | T-22 Qloo vs LLM |

## Tickets

| ID | Title | Kind | Pri | Mode | Depends on | Status |
|---|---|---|---|---|---|---|
| T-01 | Scaffold | feature | P0 | inline | none | done |
| T-02 | Shared contracts and agent constants | feature | P0 | inline | T-01 | todo |
| T-03 | Qloo client, registry, cache and budget guard | feature | P0 | inline | T-01 | todo |
| T-04 | Eval harness and first scorers | feature | P0 | inline | T-02, T-03 | todo |
| T-05 | Seed resolution | feature | P0 | inline | T-03 | todo |
| T-06 | Supabase schema, auth and private cache | feature | P0 | inline | T-02, T-03 | todo |
| T-07 | Profile and axes | feature | P0 | inline | T-05 | todo |
| T-08 | Frontier scoring, bands and dial | feature | P0 | inline | T-07 | todo |
| T-09 | Reference layer | feature | P1 | inline | T-02 | todo |
| T-10 | Agent loop | feature | P0 | inline | T-08, T-09 | todo |
| T-11 | Design tokens and shell | feature | P0 | inline | T-01 | todo |
| T-12 | Onboarding | feature | P0 | inline | T-05, T-07, T-11 | todo |
| T-13 | Attribute chart | feature | P0 | inline | T-02, T-11 | todo |
| T-14 | Calibration and edge picks screen | feature | P0 | inline | T-10, T-13, T-15, T-16 | todo |
| T-15 | Pick card | feature | P0 | inline | T-02, T-11 | todo |
| T-16 | Reasoning panel | feature | P0 | inline | T-02, T-11 | todo |
| T-17 | Save, revisit and follow-up | feature | P1 | inline | T-06, T-14 | todo |
| T-18 | LLM judges | feature | P1 | inline | T-04, T-10 | todo |
| T-19 | Remaining code scorers | feature | P0 | inline | T-04, T-10 | todo |
| T-20 | Deploy and free-demo hardening | feature | P0 | inline | T-14 | todo |
| T-21 | README, demo script, Devpost text | docs | P0 | inline | T-14 | todo |
| T-22 | Qloo vs plain-LLM side-by-side | feature | P2 | inline | T-10 | todo |

## Cut line

Must land by the Oct 25 freeze: every P0 feature (T-01 to T-08, T-10 to T-16, T-19, T-20). T-21 is docs and can land after the freeze.

If time runs short, drop in this order:
1. T-22 Qloo vs LLM
2. T-18 LLM judges (the `bridge-judge` agent still spot-checks by hand)
3. T-17 save and revisit (guests still get the full flow; accounts stay in the schema)
4. T-09 references (T-10 runs with its stub; cards show no lineage hop)

## Needs from the user

- **By T-06 (wave 4):** a Supabase project. Copy its URL, anon key and service role key into `.env`.
- **By T-07 (wave 4):** an Anthropic API key in `.env` (`ANTHROPIC_API_KEY`). It's needed for naming axes and for the agent.
- **Before T-03 relies on POST filters:** your OK for the 6-call check (`scripts/spike/04-post-check.mjs`).
- **Live Qloo calls:** every live call during building or testing gets a dry-run count first and needs your OK (hard rule 10).
