# Scoring: reach, connection, bands, axes

Everything here is a PROPOSAL to implement and tune against the spike's real data. Constants live in `src/lib/agent/config.ts`. The dial-behavior and reach-margin scorers are what keep tuning honest.

## Inputs per candidate

From `/v2/insights` and entity detail (confirm availability in the spike): tags, popularity (0 to 1), affinity, domain. From the profile: weighted tags (with fields) and the domains of the user's seeds.

## Reach (how far from the profile center), 0 to 1

```
reach = 0.45 * tagDistance + 0.35 * obscurity + 0.20 * fieldUnfamiliarity
```

- `tagDistance` = 1 - weightedOverlap(candidateTags, profileTags), where each profile tag counts by its profile weight. High when the candidate shares few of the user's weighted tags.
- `obscurity` = 1 - popularity. If popularity bunches near 1 for a type (spike check), use the candidate's percentile rank within the returned pool instead of the raw number.
- `fieldUnfamiliarity` = 1 - (share of the user's seeds that are in the candidate's field). High for fields the user has few seeds in.

Weights are starting points. Reach is a position on the frontier, not a quality score.

## Connection (how defensible the link is), 0 to 1

For each candidate, find its best path back to a seed: shared tags, optionally one lineage hop.

```
connection = min(1, sum over sharedTags of (profileWeight(tag) * rarity(tag))) / norm
```

- `rarity(tag)` = how unusual the tag is in the candidate pool (inverse frequency, scaled 0 to 1). A shared tag that half the pool also has is generic. A shared tag that few candidates have is distinctive.
- A path counts as **distinctive** if at least one shared tag has rarity at or above `DISTINCTIVE_RARITY`, or the path has a sourced lineage hop. A candidate with no distinctive path cannot clear the floor, whatever its tag overlap.
- `connection >= CONNECTION_FLOOR` for every shown pick at every dial setting.

## Anchoring with explainability

If `feature.explainability` is confirmed for a type, each result reports which input entities contributed and by how much (0 to 1, entities at or above 0.1 always listed). Use it three ways:

- The **anchor seed** of the path is the top contributor. Store `anchor.contribution`.
- If the top contribution is below `MIN_ANCHOR_CONTRIBUTION`, the pick is only loosely tied to any one seed. It can still pass if its shared tags are distinctive, but flag it as a thin anchor.
- Contributions can be summed across seeds on one axis to show which axis a pick came from.

Explainability covers input entities, not tags. Shared tags still come from tag overlap, and `distinctive` is still decided by tag rarity or a sourced lineage hop.

## Emphasis without per-seed weights

Insights goes by POST, so each seed carries a `weight`. To emphasize an axis, weight the seeds that sit on it higher, and leave out seeds far from it. For tag signals, `operator.signal.interests.tags` decides whether results need all the tags (intersection, the default) or any of them (union, highest-affinity tag scores). Use union to explore a theme, intersection to demand several shared tags.

## Other levers (test in the spike)

- `bias.trends`: starts as `off`, so Stretch is not pulled toward the popular. It defaults to `medium`.
- `bias.content_based` (0 to 1, default 0.5): if it shifts how far results sit from the profile, it can be a second reach lever next to the popularity ceiling. Keep any dial mapping in `config.ts`.
- `signal.interests.tags.weight` and `signal.interests.entities.weight`: when a query carries both seed entities and a theme's tags, these set which signal dominates.
- Backfill: padded results (cross-domain or content-based) are not primary candidates. Count them separately, and do not let them satisfy `MIN_PICKS_PER_FIELD` unless they independently clear the connection floor.

## Bands

Computed as quantiles of reach within the pool of floor-clearing candidates, so they adapt to how far the pool reaches:

| Band | Reach quantile (starting point) |
|---|---|
| calibration | lowest 25% (very close; same-domain and different-domain) |
| moderate | 25% to 60% |
| high | 60% to 85% |
| extreme | top 15% |

Match uses calibration and moderate. Stretch uses high and extreme. The edge screen shows moderate, high and extreme together.

Required invariants (the evals check these):
- Stretch picks are less popular than Match picks for the same profile.
- Reach margin: the median reach of the next band up exceeds the one below it by at least `MIN_REACH_MARGIN`.
- Seeds and already shown picks never appear.
- Every shown pick clears `CONNECTION_FLOOR`.

## Axes (open decision: this is a proposal)

Goal: about 6 to 8 axes, each grounded in tags, comparable across fields.

1. Collect profile tags from taste analysis over the seeds (`filter.type=urn:tag`, `signal.interests.entities`), per field and overall, plus tags matched from the words of each "why" (`/v2/tags`, `filter.query`). Record each tag's `types`. A tag whose `types` span both the seed's entity type and a candidate's entity type is a bridge tag: prefer bridge tags when carrying a theme across domains with `signal.interests.tags`. If tags are not scored, weight by seed and candidate-pool frequency.
2. Group tags into axes using a method that can be explained and reproduced: co-occurrence of tags across the user's seeds and their near candidates, plus tag-type grouping from `/v2/tags/types`. Use the LLM only to name an axis from its tags and to merge near-duplicates, and require every axis label to be justified by listed tags.
3. Drop tags too generic to say anything (appear in most of the pool). Drop axes with fewer than 2 distinct tags.
4. Persist the axis-tag membership so the chart can show "what is this axis made of".

Risk to settle in the spike: tags may not be comparable across fields (tag ids carry a kind and namespace, such as `urn:tag:<kind>:<namespace>:<value>`, which may differ by entity type; the `types` field on each tag shows where it applies). If they are not, cross-domain paths need a bridging step (shared tag types, taste analysis over mixed seeds, or LLM-bridged links labeled `inferred`).

## Fallbacks

- Empty frontier: relax reach one band, never connection. Say so in the trace and the UI.
- Fewer than `MIN_PICKS_PER_FIELD` clear the floor: show what clears, say it is thin, offer to widen the profile with another seed.
- Field with no Qloo coverage: label picks LLM-bridged, `inferred` throughout, no distinctive-hop claim.
