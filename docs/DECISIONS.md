# Decisions

Append new decisions at the bottom of "Decided". Move items out of "Open" when they are settled. The manager (orchestrate skill) maintains this file.

## Decided
- Name: Atelier. Branding: serif, classy, refined, distant, minimal. The user designs the logo; agents use a text wordmark placeholder.
- Accounts are in scope for saving and revisiting a profile. Account creation is part of profile creation.
- Everyone starts with questions, whatever their place in the journey.
- Onboarding: pick a field from a preset dropdown, type a thing, answer a one-line "why do you love it" (Qloo entity chips help on this screen), then pick another field and repeat as many times and as deep as the user wants. Aim for 5-10 minutes.
- Before creating an account a user can do onboarding, see the chart and reasoning, get a few very close calibration recs (same-domain and different-domain) and correct them, then get edge recs in degrees (moderate, high, extreme). Saving requires an account.
- Match means cross-domain match.
- Edge picks show all three degrees at once, with an option to hide undesirable fields. Pick cards come in decks by field and pop onto the screen like a card-pack opening.
- After recs the user can save a pick as "not right now but still interested", "not that interested but I'll still try it" or "yes I want to explore this", or say it does not interest them (which opens a why box). Guiding resources are high-level starting points, not authority. After exploring, the user is asked whether they tried it, how they liked it and why; then profile and recs change. The profile center changes little; the edges change, possibly a lot.
- Social and discovery screens (visibility settings, find people, compare overlay) are out of scope for v1, nice to have.
- Stack (confirmed 2026-10-19): Next.js (App Router) + TypeScript, Supabase for auth and DB, Anthropic API for the agent.
- No code is hand-written by the user; agents build it, so the stack must be well documented and well represented in LLM training data.
- Domains locked (2026-10-19, after the spike): music (artist), film (movie), TV (tv_show), books (book), food and places (place), fashion (brand). Architecture, cars and theater are out: Qloo has no type for them (docs/spike-report.md).
- `/v2/insights` is called by POST with a JSON body, seeds as `[{id, weight}]` (2026-10-19). Seed ids stay out of URLs, and per-seed weights are available. `/search`, `/v2/tags` and `/entities` stay GET. Body-borne filters are pending a 6-call check (`scripts/spike/04-post-check.mjs`).
- Call budget (2026-10-19): the key allows 10,000 calls a month and 5 per second, through judging. At most 12 live calls per new profile run and 0 per repeat view; one insights pool per domain bucketed in code; at most 2 re-queries per run; replay by default in dev and evals; a dry-run count and the user's OK before any live script. Hard rule 10 in CLAUDE.md.
- Semantic tag search (`feature.semantic_search`) maps the words of a "why" to tags, on submit only, deduped by name.
- Input process (2026-10-19): seeds plus reasons. No pairwise choices in v1.
- Axes (2026-10-19): grouped by Qloo tag type (`subtype` from taste analysis: theme, style, emotional_tone, aesthetic_property, ambience and so on), weighted by `query.affinity`. The LLM only names an axis from its listed tags and merges near-duplicates.
- Runtime model (2026-10-19): Claude Sonnet 5.5 (`claude-sonnet-5-5`) via `ATELIER_MODEL`.
- Reference layer (2026-10-19, default): Qloo's own lineage fields (music influence fields, `influenced_other_media`, `similar_brands`) plus Wikidata (CC0) for film, TV and fashion. No lineage for books or places. Wikipedia text only with CC BY-SA attribution.
- Card provenance display (2026-10-19): only theme and lineage hops carry a Sourced/Inferred badge. The seed hop is the user's own and the pick hop is the entity, so neither is badged. Lineage hops are always sourced (hard rule 6).
- Reasoning panel wording (2026-10-19): the panel writes each line from the trace event's structured fields; `say` is informational and shown only for unknown event kinds. T-10 must emit complete structured fields, and any model-written reason text must not restate the main line or use internal terms (connection floor, band edges, reach).
- Readings (2026-10-19): a card's "reading" comes only from Qloo's `style_description` (film, TV, brands), excerpted and labeled "a reading". Plot summaries, biographies and descriptions are not readings. Otherwise the reading is omitted.
- Qloo-sourced hops (2026-10-19): Qloo has no per-entity page, so Qloo-sourced lineage hops and readings show "Source: Qloo" with no deep link. Wikidata hops link to the Wikidata item and credit "Data from Wikidata (CC0)". Wikidata is skipped when `ATELIER_CONTACT` is unset (its User-Agent policy requires contact info).
- Generic tags (2026-10-19): taste-analysis tag popularity bunches near 1 (cached spike data: median 0.998), so generic tags are found by rank within the pool, never by an absolute popularity cutoff.
- Budget split (2026-10-19): onboarding and the run are budgeted separately. Onboarding: at most 2 live calls per seed (search plus its "why" tags, made on submit and cached), at most 10 seeds. Run: profile build (1 taste-analysis call, reusing the onboarding why tags), one pool per domain (6), at most 2 re-queries, so 9 typical and 12 at most. `/v2/tags` item `type` uses the same `urn:tag:<kind>:<ns>` format as taste-analysis `subtype` (checked against cached spike data).
- Nothing numeric about taste leaves the server (2026-10-20, rule 7): `/api/run` strips popularity summaries from `score` events, `filter.popularity.*` values from `query_insights`/`requery` params, and `path.anchor.contribution` before anything reaches the browser. Stored server-side traces may keep them.
- Explanation inputs (2026-10-20): besides the path's seed, theme tags, lineage and pick, the explainer gets (a) up to 3 of the pick's own Qloo tags the seed side lacks (`Path.pickOnlyTags`), (b) plain distance words computed in code (`Path.distance`: other_field, farther_from_tags, less_familiar; never numbers), and (c) the seed's "why" in the user's own words. Themes are described only in the words of their tags; no invented techniques, moods, eras or forms.
- Repeat runs (2026-10-20): `/api/run` returns the run plan (themes and seed weights per domain) and accepts it back, so a repeat view replays the same Qloo requests from cache (0 live calls) without depending on the model-reply cache.
- `bias.trends` is never sent (2026-10-20): the spike showed `off` equals the default and books reject other values.

## Open
- Concrete use case: reference board for a creative project?
- Qloo-vs-plain-LLM side-by-side as demo and eval?
