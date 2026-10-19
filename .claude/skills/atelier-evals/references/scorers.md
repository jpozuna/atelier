# Scorers

Type: C = code, J = LLM judge. Inputs: T = trace, R = result (picks, paths, cards), G = config, Reg = registry. Thresholds named in CAPS live in `config.ts`.

## Code scorers

| Scorer | Pass when | Inputs |
|---|---|---|
| `param-validity` | Every `query_insights` event's params exist in the registry for that call's entity type with status `listed` or `confirmed` (never `reference-only` or POST-only). `filter.type` present. `take` is at most 50. Popularity bounds are within 0 to 1 and min <= max. No param is sent that the registry does not list. Calls to `/search` and `/v2/tags` are checked against their own endpoint param lists, and tag-insight calls (`filter.type=urn:tag`) send only params the registry marks listed or confirmed. `filter.type` is in the supported list. No legacy path (`/recommendations`, `/recs`). Tag params hold ids, not freeform strings. A 200 with empty `entities` is not counted as success. | T, Reg |
| `seed-resolution` | Every seed ends `resolved`, `ambiguous` or `missing`. Resolved seeds have a Qloo id. Ambiguous and missing seeds are flagged in the result, and the agent did not silently pick a candidate. A 404 "No results" from `/search` yields `missing`, never an error or a guess. A 429 is retried with backoff, not treated as `missing`. | T, R |
| `dial-behavior` | For the same profile, median popularity of Stretch picks is lower than Match picks. Every insights call excludes all seeds and all picks already shown (`filter.exclude.entities`). No seed or shown pick appears in results. | T, R |
| `requery-logic` | A `requery` event exists exactly when the preceding `score` signals match a reason code (`too_obvious`, `too_weak`, `empty`, `weak_connection`). No more than 2 re-queries per domain. Re-queries change at least one param. A result set that is mostly backfill counts as `too_weak`. `CONNECTION_FLOOR` is never lowered during a run. Includes negative cases: a good result set must produce no re-query. | T, G |
| `domain-coverage` | Each locked domain has at least `MIN_PICKS_PER_FIELD` picks, with no more than one pick per creator or franchise. LLM-bridged domains are labeled `llmBridged`. Thin domains are reported as thin, not padded. Backfilled picks do not count toward the minimum unless they clear the connection floor on their own. | R |
| `path-presence` | Every pick has a path from a seed to the pick, with non-empty `sharedTags` or a lineage hop. | R |
| `distinctive-hop` | Every pick's path is `distinctive`: at least one shared tag with rarity >= `DISTINCTIVE_RARITY`, or a sourced lineage hop. | R, G |
| `reach-margin` | Median reach of each band exceeds the band below by at least `MIN_REACH_MARGIN`. | R, G |
| `connection-floor` | Every shown pick has `connection >= CONNECTION_FLOOR` at every dial setting. | R, G |
| `provenance` | Every hop has provenance. `sourced` hops have a `sourceUrl` that was actually retrieved in the trace (`fetch_refs`). `card.provenance` counts equal the hop counts. | T, R |
| `card-completeness` | Every card has path, why, different and provenance. `reading` exists only when sourced and is marked as a reading. No card contains a taste score or ranking. | R |
| `groundedness-precheck` | Every tag mentioned in `why` or `different` is in `path.sharedTags` or a hop's tags. Cheap guard that runs before the judge. | R |
| `anchor-grounding` | When explainability came back, every path's anchor seed is the top contributor for that pick, and `anchor.contribution` matches the trace. When it did not, the anchor is labeled `tag_overlap`. No anchor is chosen any other way. | T, R |
| `repo-hygiene` | No Qloo response data in tracked files: no UUIDs other than the synthetic pattern, no `urn:tag:` ids outside `evals/hygiene-allow.txt`, no raw response JSON, no API key patterns, `.qloo-private/` untracked. Also checks that git history has none of these. | git |
| `budget` (optional) | A run stays under `MAX_QLOO_CALLS_PER_RUN` and `MAX_LLM_TOKENS_PER_RUN`, and under the latency target. Protects the "free and working through Nov 16" requirement. | T |

## Judge scorers

| Scorer | Question | Scale |
|---|---|---|
| `bridge-groundedness` | Does the explanation's stated connection actually appear in the returned tags, sources or path? | pass / fail, with the unsupported claims listed |
| `bridge-quality` | Is the explanation specific and does it teach something, rather than "you'll like this because it's similar"? | 1 to 5, pass at 4+ |
| `stretch-defensibility` | Is the Stretch pick further out than the Match pick for this profile, yet plausibly connected rather than random? | pass / fail, with a one-line reason |
| `lineage-groundedness` | Does every lineage claim appear in a retrieved source? | pass / fail |
| `reading-restraint` | Are symbolic readings labeled as readings, hedged as readings, and omitted when no text supports them? | pass / fail |
| `rubric-fit` | Does the pick and explanation exercise discernment, pattern recognition and idiosyncrasy, and avoid taste slop? | three 1 to 5 scores, pass at 3+ each |

Rubrics and anchors: `judge-rubrics.md`.

## Cases

Start with three profiles built from invented seeds and synthetic fixtures: a coherent one (clear center), a scattered one (little overlap), and a thin one (two seeds, one field). Add edge cases: an ambiguous seed, a missing seed, an empty frontier, a field with no coverage. For live runs, the user supplies real seeds privately; those cases live in `.qloo-private/`.
