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
- `/v2/insights` is called by POST with a JSON body, seeds as `[{id, weight}]` (2026-10-19). Seed ids stay out of URLs, and per-seed weights are available. `/search`, `/v2/tags` and `/entities` stay GET. Body-borne filters are pending a 7-call check (6 entity types plus taste analysis by POST) (`scripts/spike/04-post-check.mjs`).
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
- Deployed demo guard (2026-10-20): `ATELIER_DEMO` stays unset in production so the Qloo reserve can rest the demo; `QLOO_RESERVE` about 300 there. Per-IP limits (3 runs an hour, 8 a day) and daily worst-case allowances (480 model calls, 480 live Qloo calls) lead to a calm `demo_resting` state. While resting, the server does not answer from cache; picks already in the browser and saved work still show. Counters are in memory per instance (durable counters are a sketch in T-20's handoff).
- Qloo vs plain LLM (2026-10-20): build T-22 as a demo and eval view. The plain-LLM side gets only the user's seeds and reasons (their own words), makes one cached model call per profile, and is labeled ungrounded on every pick. The Atelier side uses the stored run (0 live Qloo calls).
- Demo feedback round (2026-10-22): edge suggestions are capped at 20 (moderate, high and extreme split about evenly, strongest connection first, no field above 40%, never padded). Calibration is separate, at most 6. The cut is made in code before refs and explanations.
- Suggestion list replaces decks (2026-10-22): this overrides "pick cards come in decks by field and pop onto the screen like a card-pack opening". Picks are a sortable list (by field or stretch) with field filters and multi-select onto one chart. Stretch is shown to the user as low, medium or high.
- Connection strength (2026-10-22): each edge pick carries a public word, `strong`, `steady` or `light` (thirds of the shown picks by connection, computed in code), used only for chart line weight. It is never shown as a number, word or sort key (rule 7). The chart is enlarged so line weight reads.
- Reasoning trace leaves the UI (2026-10-22): the picks screen shows only the selected pick's final reasoning, its place on the chart, and its sources. The full trace is stored privately server-side (run log, T-27) with user signals so suggestions can learn from it (T-28).
- Tag chips (2026-10-22): clicking a tag lists the seeds and suggestions in the current run that share it, with 0 Qloo calls.
- Qloo vs plain LLM is cut (2026-10-22, T-26).
- Cap balance details (2026-10-22, T-23): the strict 40% share (floor of 0.4 x shown) applies when it shows at least as many picks as a fixed limit of 8 per field (floor of 0.4 x 20); otherwise the fixed limit applies, as it does for single-field follow-ups. So two full fields plus one thin field show about 17, not 5. Every field with an eligible edge pick shows at least one. A field emptied only by the cap gets "More from X was held back to keep the mix balanced", never "nothing connected".
- Run log (2026-10-22, T-27): every run's unredacted trace and the person's signals (not me, saves, not interested, tried) are stored service-role-only (Supabase `run_log`, `run_signal`; locally `.qloo-private/runlog/`). Purge after judging (Nov 16) with `select public.purge_run_log(now());`. The picks screen sends `notMe` so set-asides are exact.
- Learning (2026-10-22, T-28): only for signed-in people, only from explicit signals (exact not_me, saves, not interested); a pick merely shown again never counts. Off in replay mode (the public demo), because a learned exclusion list changes the Qloo request and would miss the cache. `ATELIER_LEARN=on|off` overrides. The planner note of past signals is built but not wired.
- Picks layout (2026-10-22, T-25): from 64rem, chart and the open pick's reasoning on the left, calibration and the suggestion list on the right (sticky, scrolls inside). Ticking only puts a pick on the chart; clicking a row opens its reasoning. Below 64rem a sticky bar offers "View chart" and "Clear".

## Open
- Concrete use case: reference board for a creative project?

## 2026-10-27: no feature freeze

The Oct 25 feature freeze is removed. Building and testing run until Oct 29, 10 am ET; after that, only fixes for the submission.

## 2026-10-27: UI tweaks and speed round (T-29 to T-32)

- Picks screen: the edge suggestion list sits above the chart, under its key, and stays open (the user chose this over collapsing it, so on a 1280x800 screen the profile shape is one short scroll down). An opened suggestion's reasoning shows in the right column with "Back to suggestions".
- Axis hover card: shows on pointer hover and keyboard focus only, never for the pinned axis.
- Speed: explanation calls run 6 at a time, axis naming 8 at a time. `/api/run` sends a `domain` event per field as soon as its cards are ready; a client must not assume that field's `explain` trace events have arrived yet. The deck does not read `domain` yet (follow-up).
- Onboarding: a reason lookup cut off by a reload is not retried (that would spend an extra Qloo call); the seed shows a note to re-add it.
- Not done: prompt caching (prompts are near the minimum cacheable length).

## 2026-10-27: calmer picks screen and early picks (T-33 to T-35)

- Supersedes the list-above-chart layout from T-30. The chart has the left column; the edge suggestions are the first thing in the right column, close picks below. The user found the list above the chart easy to miss and the two menus too much.
- The chart key is the only field filter. The Field/Stretch sort is gone from the UI (the code path stays only for `derive.test.ts`; follow-up: remove it).
- Stretch is defined on screen: "distance from your profile, not a grade".
- Early picks: the screen shows each field as its `domain` event arrives. Storage, the reaction saver and re-run bodies use only the final result. Reactions on early picks are held and saved when the final result has them. "Not me" waits for the final result. A failed "not me" re-run shows the last finished result.
