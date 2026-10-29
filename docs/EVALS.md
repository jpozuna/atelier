# Evals

Evals are written first, and the code scorers run in CI-safe synthetic form.

## Code scorers (`npm run evals`)

Thirteen scorers run over synthetic traces and run results, each with at least one passing and one failing case: repo hygiene, param validity, call budget, dial behavior, re-query logic, domain coverage, path presence, distinctive hop, reach margin, connection floor, provenance, card completeness and seed resolution. Repo hygiene scans the working tree and the added lines in git history for Qloo-shaped ids, tag ids, secrets and images.

## LLM judges (`npm run evals:judges`)

Six judges read a card and its path: bridge groundedness, bridge quality, stretch defensibility, lineage groundedness, reading restraint and rubric fit (discernment, pattern recognition, idiosyncrasy). Code checks each verdict: a judge must quote the card, and a quote that is not on the card voids the verdict. Each judge is calibrated against labeled synthetic cards, including cards that try to instruct the judge.

By default the run uses a fake model that replays the labels, which tests the plumbing and says nothing about agreement. A real run needs `ATELIER_JUDGES_LIVE=1` and `ANTHROPIC_API_KEY`, prints its model call count first, and is capped. It makes no Qloo calls.

## Live evals (`QLOO_LIVE=1 npm run evals:live`)

These spend Qloo calls, so they print the count first and are meant to be run locally with approval. Recordings go to `.qloo-private/evals/`. Suites live in `evals/live/`:

- a post-check entry that only prints instructions for the 7-call script in [SETUP.md](SETUP.md#the-picks-gate) and makes no call itself;
- a smoke run that makes one end-to-end run through the real client and then runs the code scorers over what it recorded (at most 9 Qloo calls, recorded privately).

## Measured agreement

3 of the 6 judges meet the 80% target. First real run, 2026-10-22, `claude-sonnet-5-5` at effort `low`, 71 calls:

| Judge | Agreement with labels | Meets target |
|---|---|---|
| Bridge groundedness | 11/11 (100%) | yes |
| Lineage groundedness | 11/11 (100%) | yes |
| Reading restraint | 12/12 (100%) | yes |
| Stretch defensibility | 10/13 (77%) | no |
| Bridge quality | 9/13 (69%) | no (orders high above low: 4.0 vs 1.8) |
| Rubric fit | 4/11 (36%) | no (orders high above low: 2.4 vs 1.0, but scores low overall) |

The three pass/fail groundedness judges can be relied on. The two 1-to-5 scoring judges rank good cards above bad ones but score lower than the labels, and stretch defensibility is just under the target. Treat those three as rough signals until they are recalibrated.

## Not yet verified

Written to be updated when each one is:

- Thresholds (connection floor, band edges, the too-obvious test) are starting values. They have not been tuned against recorded real pools.
- The model-text checks were calibrated on two replayed real runs on 2026-10-28 (refused card lines 13, then 3, then 0 on an offline recheck; see DECISIONS.md). They have not been checked across many profiles.
- The end-to-end run against live Qloo data and a real model.
- The magic-link round trip on the hosted project. (The migrations and RLS tests pass on a local stack and on the hosted database.)
- Browser, keyboard, phone-width and dark-theme review of the screens.

## Limitations in detail

- **No social layer.** There is no sharing, no finding people, no visibility settings and no compare-with-others overlay. The brief put social features out of scope for v1. There is also no taste history beyond saved picks and reactions.
- **Six fields.** Music, film, TV, books, food and places, and fashion. Architecture, cars and theater are out because Qloo has no entity type for them.
- **Lineage exists for only some fields.** Music (from Qloo's influence fields), film and TV (Qloo plus Wikidata), and fashion (similar brands plus Wikidata). Books and places have none, and their cards show no lineage hop. Fashion's source is similarity, not influence, and the hop says so. A hop sourced from Qloo shows "Source: Qloo" with no link, because Qloo has no per-entity page. Wikidata hops link to the item and credit Wikidata (CC0).
- **Readings come only from style descriptions** on film, TV and brands, shown as an excerpt and labeled a reading. Plot summaries, biographies and descriptions are not readings. Everything else gets no reading.
- **Some fields connect through fewer shared tags.** Food and places and fashion have their own tag vocabularies, so paths into and out of them have fewer shared tags to rest on. A field that cannot meet the connection floor is shown thin, with a note, and is never padded with popular or random picks.
- **Chart encoding in v1.** Position on the picks screen follows the pick's degree band, not a continuous distance, and every connection line has the same weight. The public run data deliberately carries no connection number.
- **Anchor seeds are coarse.** Qloo's explainability spreads credit across seeds, so the seed a path names is the top contributor, not a dominant one; a path says when the link is thin. Taste analysis is one call over all seeds, so there is no per-seed tag list.
- **The "why" is one short line.** Semantic tag search keeps the first concept of a long sentence.
- **Axes** are grouped by Qloo tag type. Model-written names are checked against the axis's tags; a label with words from no tag falls back to a plain label. Fewer than six axes are reported as such, not padded.
- **Follow-up** adds a liked pick as a seed and re-queries that field. It does not rebuild the profile tags and axes.
- **POST body params are confirmed for one key.** The popularity cap, the exclusion list and explainability were confirmed for all six types on 2026-10-28. A different key or a change in the API should be re-checked with `scripts/spike/04-post-check.mjs`, and the client still refuses any param that is not listed or confirmed.
