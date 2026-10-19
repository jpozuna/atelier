---
name: atelier-agent-loop
description: "The core logic of Atelier's agent: resolving seeds, building the taste profile and axes, querying Qloo per domain, scoring reach and connection, applying the Develop/Match/Stretch dial, re-querying, fetching references, and generating path-based explanations and cards. Use whenever building or changing agent loop code, tool definitions, scoring, the dial, paths, cards, explanations, the reasoning trace, or the profile and axes. Also use when someone asks what a pick, path, frontier, reach, connection or bridge is."
---

# Atelier agent loop

Atelier does not recommend what is closest to the user. It suggests what sits at the frontier of their taste: far enough to be unfamiliar, connected enough to be defensible. The product's value is the connection path and the explanation, not the list.

Principle: **code computes, the model chooses and explains.** Reach, connection, popularity checks and exclusions are computed deterministically so they can be tested. The LLM decides which themes to carry across domains, whether results warrant a re-query given the computed signals, and writes the explanation from the stored path. This split is what makes the evals meaningful and the agent defensible as an agent: it plans and reacts to real Qloo results.

## Loop

1. **Resolve seeds** (`/search`, scoped with `types` to the seed's field). Each seed is `resolved`, `ambiguous` or `missing`. A 404 "No results" means `missing`; it is not an error. Ambiguous and missing seeds are flagged to the user, never silently guessed. Keep the user's "why" with each seed.
2. **Extract tags.** Taste analysis: `filter.type=urn:tag` with the seeds' entity ids as `signal.interests.entities`, run per field so tag namespaces stay comparable (confirm params in the `qloo-api` skill; they are reference-only for `urn:tag` until the spike). Each returned tag says which entity types it applies to, which shows the cross-domain bridge tags directly. If tags come back unscored, weight them by how many seeds and near candidates carry them. Also map the words of each "why" to real tag ids with `/v2/tags` (`filter.query`, optionally beta `feature.semantic_search`). Tag ids come only from Qloo; the model may name an axis but never invent a tag. Produce weighted tags with the fields they appear in.
3. **Build the profile and axes.** Cluster tags into about 6 to 8 cross-domain axes. Each axis keeps its underlying tags, so the chart can show what it is made of. Approach is an open decision (`docs/DECISIONS.md`); see `references/scoring.md` for the proposal. Axes must be grounded: no axis without tags, no label that is not derivable from them.
4. **Choose themes** to carry across domains. The model picks among computed candidates; it cannot invent a theme with no tags behind it.
5. **Query `/v2/insights` per domain**, using the `qloo-api` skill for params. Exclude all seeds and all picks already shown. Request explainability (`feature.explainability`) once the spike confirms it works for the type. Set `bias.trends` explicitly (it defaults to `medium`). There are no per-seed weights on GET, so choose which seeds go into each query by their place on the axis being explored. Results may include backfill: do not count padded entries as primary candidates.
6. **Score candidates** for reach and connection (`references/scoring.md`).
7. **Fetch references** (lineage, readings) for finalists. Sourced and inferred stay separate.
8. **Review and re-query** if needed (below).
9. **Assemble paths and cards**, then **explain** from the path only.

Every step emits a trace event (`references/path-and-card-schema.md`). The UI shows these as visible reasoning, and the evals read them.

## Dial

One dial over one profile. The connection floor never drops at any setting.

| Setting | Behavior |
|---|---|
| Develop | The profile is forming. The agent asks questions and maps tastes before suggesting anything. Everyone starts here (DECISIONS.md). |
| Match | Low reach, cross-domain. Stays near the profile center but moves across fields. |
| Stretch | High reach: low popularity, less tag overlap, a field the user has little in. Still connected. |

The edge-pick screen shows three degrees at once: moderate, high, extreme (reach bands). Calibration recs (very close, same-domain and different-domain) come first so the user can correct the profile before seeing edges.

## Re-query logic

Re-query when the computed signals say the results are poor. Do not re-query when they are fine. Use these reason codes, and log one per re-query:

- `too_obvious`: results are mostly high-popularity, high tag overlap, or from the same creator or franchise as a seed.
- `too_weak`: fewer than the minimum primary (non-backfilled) candidates clear the connection floor, or the result set is mostly backfill.
- `empty`: no results for the domain.
- `weak_connection`: candidates are far enough but have no distinctive shared tag and no lineage hop.

Actions, in the order to try: tighten `filter.popularity.max`; carry a different theme (switch from entity signals to `signal.interests.tags` for one shared theme); add `filter.exclude.tags` for dominant generic tags; add more exclusions. Maximum 2 re-queries per domain per run. After that, return what clears the floor, even if short, and say so. Never lower the connection floor to fill a gap. If the frontier is empty, relax reach first (move to the next lower band), and tell the user the band was relaxed.

## Paths and explanations

Every pick stores a path: seed, shared theme (tags), optional lineage hop, pick. Each hop carries provenance: `sourced` (with a source link) or `inferred`. The explanation is generated from that path and nothing else.

**Anchor.** The path's seed is the input entity that drove the pick. When explainability is available, use the entity with the highest contribution (Qloo reports 0 to 1) and store the score. When it is not, pick the seed with the strongest tag overlap and label the anchor `tag_overlap`. Never choose the anchor for how good the story sounds.

- Name only tags and hops that are in the path. A tag in the explanation that is not in `path.sharedTags` or a hop is a groundedness failure.
- Say what the connection is, what is different about the pick, and what it might teach. Not "you'll like this because it's similar".
- The agent has no taste of its own. Do not write "I love" or "this is great". Describe what the graph and the sources show.
- Lineage and symbolism: only from retrieved text, labeled as a reading, omitted when nothing was retrieved. Never merge sourced and inferred in one sentence.

## Where this lives

`src/lib/agent/` (loop, tools, `config.ts` for tunable constants), `src/lib/profile/` (axes), `src/lib/frontier/` (reach, connection, dial), `src/lib/refs/` (references). Tunable numbers live only in `config.ts`, never inline, so tuning is one reviewed change.

## Before you change scoring or the dial

Read `references/scoring.md`, and run or update the scorers named in the `atelier-evals` skill (dial behavior, reach margin, connection floor, re-query logic). A change to scoring with no eval change is a red flag.
