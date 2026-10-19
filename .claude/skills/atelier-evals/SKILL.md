---
name: atelier-evals
description: "How Atelier's evals work: the scorer list (code checks and LLM judges), the trace format they read, the synthetic-fixture rule that keeps Qloo data out of the repo, and the eval-first workflow for agent changes. Use whenever adding or changing agent behavior, writing or running a scorer or judge, creating fixtures, checking repo hygiene, tuning the dial or scoring constants, measuring progress, or when someone says eval, scorer, judge, benchmark, regression or \"how do we know it works\"."
---

# Atelier evals

The hackathon rewards a multi-step agent that plans and reacts to Qloo calls, and the product's value is explanations that are grounded and teach something. Neither is visible from "it looks good." The evals make them checkable and give the user a way to track progress without reading code.

## Shape

- The agent loop writes a **trace** (JSONL events, schema in `atelier-agent-loop/references/path-and-card-schema.md`) and a **result** (picks with paths and cards).
- A **scorer** is a pure function over a trace and result (plus the registry and config) that returns pass or fail and the reasons. Code scorers need no model. Judges call a model with a fixed rubric.
- One runner executes all scorers over a set of **cases**. A case is a seed set, a dial setting and expectations. Results are a table of scorer by case.

Full list with exact pass/fail definitions: `references/scorers.md`. Judge rubrics with anchors: `references/judge-rubrics.md` (the `bridge-judge` agent uses the same file).

## Where it lives

`evals/` holds scorers, judge prompts, synthetic fixtures, cases and the runner. Eval ticket owners own `evals/`. Scorers read `src/lib/qloo/registry.ts` and `src/lib/agent/config.ts` and never copy their values.

## The fixture rule (hackathon constraint)

No Qloo response data in the public repo. So:

- **Committed fixtures are synthetic**: invented names ("Fixture Artist A"), IDs shaped `00000000-0000-4000-8000-0000000000NN`, invented tags, in the same JSON shape as real responses so the same parsing code runs on both. There is one envelope per endpoint (insights `results.entities`, search flat `results` array, tags `results.tags`, tag insights `results.tags`), so keep one synthetic fixture shape for each.
- **Live recordings and eval runs** go in `.qloo-private/` (gitignored). They exist only on the user's machine or the server.
- **CI-safe evals** run on synthetic fixtures. **Live evals** run locally against the real API and write to `.qloo-private/`. Only a scores-only summary (numbers, pass/fail, no entity names or tags) may be copied into a committed file.
- Judge inputs built from live runs are private too. Judge anchors in `references/judge-rubrics.md` are illustrative and invented.

## Eval-first workflow

When a ticket adds or changes agent behavior:

1. Name the scorer that checks it (the ticket's `Evals` field). If none exists, write it in the same ticket or a dependency.
2. Write the case or fixture that would fail without the behavior.
3. Implement, then run the scorers. A failing scorer is a finding, not noise.
4. Changing a scoring constant (`config.ts`) means re-running the dial-behavior, reach-margin and connection-floor scorers and recording the before and after.
5. Never weaken a scorer to make a ticket pass. If a scorer is wrong, fix it in its own reviewed change and say why.

## Progress tracking

The runner prints a table of scorer by case and a one-line total. Keep a scores-only history (date, git sha, pass counts per scorer) in `evals/history.md`. That file may be committed because it contains no Qloo data. The user can read it at any time to see whether the product is getting better.

## Judges: rules

- Judge only from the provided data: the card, the path, the tags actually returned, the sources actually retrieved. No outside knowledge about the pick.
- Groundedness is strict: if a claimed connection cannot be found in the provided data, it fails, even if it is true in the world.
- Judges return structured output: a score, a pass or fail where defined, and quoted evidence. No rewriting the card.
- Calibrate by running the judge on the anchor examples first. If it disagrees with an anchor, fix the rubric or the prompt before trusting results.
- Judge at most a small sample per run (cost). Sample across dial settings and fields.
