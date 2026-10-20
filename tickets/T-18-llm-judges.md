# T-18: LLM judges in the eval harness

Status: done
Mode: inline
Kind: feature
Priority: P1
Depends on: T-04, T-10

## Goal
The judge rubrics run as scorers over recorded or synthetic runs: bridge groundedness, bridge quality, stretch defensibility, lineage groundedness, reading restraint and rubric fit.

## Owns
- evals/judges/

## Reads
- CLAUDE.md
- docs/DECISIONS.md
- .claude/skills/atelier-evals/references/judge-rubrics.md
- .claude/agents/bridge-judge.md
- evals/harness/

## Skills
- atelier-evals

## Done when
- [ ] Each judge has a rubric prompt, a structured output and a calibration set of synthetic good and bad cards
- [ ] `npm run evals:judges` runs them on synthetic fixtures and reports pass rates. The model comes from an env var
- [ ] Each judge agrees with its calibration labels on at least 80%
- [ ] No Qloo data is written to tracked files
- [ ] Repo checks in CLAUDE.md pass; no Qloo data or secrets in tracked files

## Specialists
- tests: yes
- qloo-param-auditor: no
- bridge-judge: yes
- design-reviewer: no
- research question: none

## Evals
- bridge-groundedness
- bridge-quality
- stretch-defensibility
- lineage-groundedness
- reading-restraint
- rubric-fit

## Qloo calls
- none

## Handoff

What changed (all under `evals/judges/`):
- `rubrics.ts`: rubric prompts. The criterion text is read at run time from `.claude/skills/atelier-evals/references/judge-rubrics.md` (same file `bridge-judge` uses; one source of truth), plus a per-judge addendum saying how it applies to Atelier's card, path and `pickOnlyTags`/`distance` shapes, and the forced tool `report_verdict` (structured output; result is pass/fail, an integer 1 to 5, or three 1 to 5 scores plus `slop` for rubric-fit; every reply carries `judgeable`, `evidence`, `unsupported_claims`, `reason`).
- `judge.ts`: one call per card through the existing `Llm` interface (`src/lib/agent/llm.ts`: forced tool call, key from `ANTHROPIC_API_KEY`, no caching, no retries). Code checks the reply: schema, scorer and card id, and that every evidence quote occurs in the input ("no quote, no credit"). A pass with a missing quote, or a groundedness/stretch pass with no evidence, is downgraded to fail. Lineage and reading passes may be vacuous.
- `view.ts`: `buildCardView(card, ctx)` turns a stored `Card` into the judge's `CardView` (tag ids to names, nothing numeric, `sourceLabel` kept). This is the adapter T-10 outputs or a private recording use to judge live cards later.
- `calibration/`: 10 synthetic labeled items per judge (60 total): 5 pass and 5 fail for the binary judges, two cards at each score 1 to 5 for bridge-quality, 5 strong and 5 weak (2 mixed) for rubric-fit; stretch items are Match/Stretch pairs. Names are "Fixture ...", sources are example.org or the label "Qloo", no tag ids or real ids.
- `fake.ts`: fake model that replays the labels (oracle). Plumbing only; it says nothing about real agreement.
- `run.ts`: runner, gate and report. `judgesGate` prints the expected call count first. Fake by default. Real only with `ATELIER_JUDGES_LIVE=1` and `ANTHROPIC_API_KEY` set, and refused over `MAX_JUDGE_CALLS_PER_RUN` (80). Model: `ATELIER_JUDGE_MODEL`, else `ATELIER_MODEL`, else `claude-sonnet-5-5`. The report states plainly when the model is fake.
- `judges.cli.test.ts` (entry for the npm script), `judges.test.ts` (33 tests, fake model only), `config.ts` (eval-only constants: `MIN_AGREEMENT` 0.8, `SCORE_TOLERANCE` 1, `JUDGE_MAX_TOKENS`, `MAX_JUDGE_CALLS_PER_RUN`).

Manager: add this exact line to `package.json` scripts (next to `evals:live`):
`"evals:judges": "ATELIER_EVALS_JUDGES=1 vitest run evals/judges/judges.cli.test.ts --reporter=verbose --passWithNoTests=false"`
Without that env var set, a plain `npm test` skips the CLI file (it is picked up by the vitest include but skipped), and `npm run evals:judges` fails rather than skipping if the env var is missing.

Calls and the 80% requirement:
- A REAL run makes exactly 60 model calls (10 per judge, one per calibration item, no retries), all to the Anthropic Messages API; there are no Qloo calls. The count is printed first by the runner. Run only after the user approves: `ATELIER_JUDGES_LIVE=1 npm run evals:judges`.
- The 80% agreement with the labels is NOT yet measured. The fake model scores 100% by construction. It must be measured on the first approved real run; a real run fails the test for any judge under 80% and writes the report to `.qloo-private/evals/judges-report.json` (gitignored). If a judge is under 80%, fix its rubric addendum or prompt (never the labels to fit), then re-run (another 60 calls). Disagreement ids and reasons are printed.
- Done-when item "each judge agrees on at least 80%" therefore stays open until that run; status is review pending it.

Known gaps and notes:
- Judges are not yet wired to run over recorded live runs; `buildCardView` is the adapter, to be used with a private recording (inputs from live runs must stay in `.qloo-private/`). The `evals:judges` script runs only synthetic calibration.
- Tolerance for scored judges is plus or minus 1 point; bridge-quality labels sit at 1 to 5 anchors.
- Judge model should ideally differ from the generator (`ATELIER_MODEL`); set `ATELIER_JUDGE_MODEL` to choose.
- Constants live in `evals/judges/config.ts`, not `src/lib/agent/config.ts` (not owned).
- Checks run: `tsc` and `eslint` clean for evals/judges; full `vitest run` passes. `npm run evals` currently fails on repo-hygiene findings in other workers' in-progress files (`src/app/api/reactions/handler.test.ts`, `src/lib/guard/bundle-scan.test.ts`), none in evals/judges; `tsc` also reports one error in `src/app/api/reactions/handler.test.ts` that is not mine.
