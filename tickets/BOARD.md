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
| T-02 | Shared contracts and agent constants | feature | P0 | inline | T-01 | done |
| T-03 | Qloo client, registry, cache and budget guard | feature | P0 | inline | T-01 | done |
| T-04 | Eval harness and first scorers | feature | P0 | inline | T-02, T-03 | done |
| T-05 | Seed resolution | feature | P0 | inline | T-03 | done |
| T-06 | Supabase schema, auth and private cache | feature | P0 | inline | T-02, T-03 | done |
| T-07 | Profile and axes | feature | P0 | inline | T-05 | done |
| T-08 | Frontier scoring, bands and dial | feature | P0 | inline | T-07 | done |
| T-09 | Reference layer | feature | P1 | inline | T-02 | done |
| T-10 | Agent loop | feature | P0 | inline | T-08, T-09 | done |
| T-11 | Design tokens and shell | feature | P0 | inline | T-01 | done |
| T-12 | Onboarding | feature | P0 | inline | T-05, T-07, T-11 | done |
| T-13 | Attribute chart | feature | P0 | inline | T-02, T-11 | done |
| T-14 | Calibration and edge picks screen | feature | P0 | inline | T-10, T-13, T-15, T-16 | done |
| T-15 | Pick card | feature | P0 | inline | T-02, T-11 | done |
| T-16 | Reasoning panel | feature | P0 | inline | T-02, T-11 | done |
| T-17 | Save, revisit and follow-up | feature | P1 | inline | T-06, T-14 | done |
| T-18 | LLM judges | feature | P1 | inline | T-04, T-10 | review (measured 2026-10-22: 3 of 6 judges meet 80%) |
| T-19 | Remaining code scorers | feature | P0 | inline | T-04, T-10 | done |
| T-20 | Deploy and free-demo hardening | feature | P0 | inline | T-14 | done |
| T-21 | README, demo script, Devpost text | docs | P0 | inline | T-14 | review (TODOs wait on live run and deploy) |
| T-22 | Qloo vs plain-LLM side-by-side | feature | P2 | inline | T-10 | done (cut by T-26) |
| T-23 | Edge cap of 20, balanced by stretch and field | feature | P0 | inline | none | todo |
| T-24 | Chart rework: legend placement, tag chips, multi-select, tighter layout | feature | P0 | inline | none | todo |
| T-25 | Picks screen as a suggestion list with final reasoning | feature | P0 | inline | T-24 | todo |
| T-26 | Cut the plain-model comparison and the trace panel | polish | P0 | inline | T-25 | todo |
| T-27 | Private run log for learning from reasoning | feature | P1 | inline | none | done |
| T-28 | Suggestions learn from the run log | feature | P2 | inline | T-23, T-27 | todo |

## Demo feedback round (planned 2026-10-22)

From the user's walkthrough on synthetic data. Must land before the Oct 25 freeze.

| Wave | Target | Tickets (parallel) |
|---|---|---|
| A | Oct 22-23 | T-23 edge cap, T-24 chart, T-27 run log |
| B | Oct 23-24 | T-25 suggestion list (needs T-23, T-24), T-28 learning (needs T-23, T-27) |
| C | Oct 24 | T-26 cut compare and trace |

Cut line for this round: T-23, T-24, T-25 and T-26 are P0. If time runs short, T-28 drops first and then T-27; neither changes what a demo viewer sees. Within T-24, the tag dialog drops before multi-select.

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
