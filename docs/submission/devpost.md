# Atelier: Devpost text

Draft for the Devpost form. Edit lengths to fit the form's limits.

<!-- TODO(manager): the descriptions below match the code. Before submitting, confirm that each claimed feature works in the deployed demo, which needs the picks gate open (README, Open the picks gate) and a deploy. Fill in the demo URL, repo URL, video link, testing instructions and team representative below. Check the form for text length and video format limits. -->

## Tagline

Develop your taste, not just feed it.

## What it does

Atelier is for creatives and students who are stuck in recommendation loops and want a point of view.

You name a few things you love, across fields, and say why in a line each. Atelier draws your taste as a profile on an attribute chart: a set of axes, each one showing the Qloo tags behind it. Then it suggests picks from other fields that sit at the outer edge of that profile, unfamiliar but connected. They come in three degrees at once (moderate, high, extreme), preceded by a few very close picks so you can correct the agent first. The fields are music, film, TV, books, food and places, and fashion.

Every pick shows the path back to you: your seed, the theme you share, a lineage hop when a source has one, and the pick. Each card says why this one, what is different about it, and where each connecting step came from. Steps are labeled Sourced or Inferred, and the two are never merged. Lineage and symbolic readings appear only when there is retrieved text behind them, are labeled a reading, and are left out otherwise. A reasoning panel streams what the agent did, including when it re-queried and why.

You answer in your own words: save a pick for later, say you will try it, explore it further, or say it is not for you and why. After you try something, a follow-up asks how it went, and the edges of your profile move. A "Qloo versus a plain model" view gives a plain model only your seeds and reasons, and shows its list beside Atelier's, with no path or source on the plain side.

The agent has no taste of its own. It is grounded in Qloo's taste graph and is an instrument for developing yours. There are no taste scores, rankings or audience metrics anywhere in the product.

Guests can do everything up to and including the picks without an account. An account (email magic link) is needed only to save and revisit.

## How we built it

**Stack.** Next.js (App Router) and TypeScript. Supabase for auth and Postgres, with row-level security on every table. The Anthropic API for the agent's model calls, with the model id in an environment variable. Plain SVG for the chart.

**Qloo.** All calls go through one server-side module. It uses:

- `/search` to resolve what you typed, with a chooser for ambiguous titles.
- `/v2/tags` with semantic search to map the words of your reason to tags.
- Taste analysis over all your seeds, which gives the tags (with affinity and tag type) that become the axes.
- `/v2/insights` for entities, by POST, once per field: seeds are sent with per-seed weights, a popularity cap keeps the pool off the popular end, every seed and every pick already shown is excluded, and explainability is on so each result says which seed drove it. That seed anchors the path.

**The agent loop.** Resolve seeds, map reasons to tags, build the profile and axes, then for each field: the model chooses a theme from options code computed; one Qloo pool is fetched; code scores reach (how far from your profile) and connection (how specific the shared tags are), and flags pools that are empty, weak or too obvious; the model may re-query, at most twice a run, from actions code offers; code assigns the degrees, applies a connection floor that never drops, and builds each path; references are fetched for finalists; the model writes the explanation of each path, and code checks it before it is shown.

**Code computes, the model chooses and explains.** Reach, connection, rarity and popularity rank are computed in code. The model picks themes, decides on re-queries given those computed signals, and writes explanations from the stored path. If the frontier is thin, reach relaxes before connection does, and a field with nothing connected enough is shown thin rather than filled.

**Evals first.** Thirteen code scorers run over synthetic fixtures (param validity, call budget, dial behavior, re-query logic, domain coverage, path presence, distinctive hop, reach margin, connection floor, provenance, card completeness, seed resolution, repo hygiene). Six LLM judges (bridge groundedness, bridge quality, stretch defensibility, lineage groundedness, reading restraint, rubric fit) have labeled synthetic calibration cards (agreement with a real model is not yet measured), and code voids any verdict whose quote is not on the card.

<!-- TODO(manager): add measured judge agreement here once the first approved real judge run exists. Until then do not state a number. -->

**Built to survive judging.** The key allows 10,000 calls a month, so the client budgets calls, caches every response in a private table, and refuses live calls below a reserve. A proxy limits each visitor and sets daily allowances, and the demo shows a calm resting state instead of an error when an allowance is used up.

## Challenges

**Silent-ignore parameters.** Qloo ignores parameters it does not recognize for an entity type, and the results still look reasonable. Our API spike found several: sorting by rating, the trending bias on three types, the description-exists filter, and the backfill take on same-field queries all changed nothing, and one trending value returned an error for books. So we built a registry of parameters per entity type, seeded from the official Entity Type Parameter Guide and updated from the spike, and the client throws before sending anything that is not listed or confirmed. A scorer checks every call in a trace the same way.

**Popularity bunching.** Qloo's popularity sits near 1 for most results (medians of 0.95 to 0.99 in the spike), so an absolute cutoff for "obscure" is nearly meaningless. Obscurity is computed by rank within each pool, and a per-field popularity cap does the rest. Brands report 0 in the long tail, which we treat as unknown rather than as very obscure.

**The call budget.** One profile run fans out across six fields and can re-query. We capped it: at most 2 live calls per seed in onboarding, one profile call, at most 12 live calls per run, and 0 for a repeat view. The browser keeps the run plan so a revisit replays the same requests from the cache. Development and evals run from replay by default, and any live run prints its call count first. A "not me" re-run refreshes one field only.

**Grounding the explanations.** It is easy for a model to write a plausible reason a pick fits. We give it only the path: the seed, the user's own words, the shared tag names, a few tags the pick has that the seed side lacks, and plain distance words computed in code. Then code checks the reply: no internal terms, no numbers about taste, no invented descriptions beyond the words of the tags, no restating a lineage claim the model did not retrieve. Lineage claims are written by code from the source's own label. If a reply fails, a plain sentence built from the path is used.

**Connection that is not an artifact.** Qloo does not mark which cross-field results are backfill, so being in the results is not evidence of connection. A path has to carry at least one shared tag, and a candidate has to clear the connection floor on shared tags weighted by rarity, never on presence alone. The explainability data spreads credit across seeds, so the anchor is the top contributor and a path says when the link is thin.

**Tag vocabularies do not line up everywhere.** Film, TV and books share many tags, and music shares some. Food and places and fashion have their own, so paths into and out of them have less to rest on. Those decks can be thin, and we show them thin.

## Accomplishments we are proud of

- Every pick has a stored path, and the explanation is generated from that path only.
- Sourced and inferred stay separate in the data model, the card and the scorers.
- No scores, rankings or audience metrics reach the browser. The run strips them before anything leaves the server.
- A parameter registry and a call budget that the client enforces and the evals check.
- A repo that holds no Qloo data. A hygiene scorer checks the tree and the added lines in git history on every eval run.
- A guest path that needs no account, and an interface built with focus handling, a text alternative for the chart and reduced-motion support. These are checked by tests and code reading, not yet by a browser review.

## Not yet verified

An end-to-end run against live Qloo data and a real model; tuning of the thresholds (connection floor, band edges, the too-obvious test) against recorded real pools; browser, keyboard and phone-width review of the screens; the Supabase schema and row-level security on a real database; and the agreement of the LLM judges with their labels. We would rather say so than imply otherwise.

## What we learned

- Grounding is mostly a matter of what you refuse to show the model and what you refuse to let it say, and a deterministic fallback keeps the product honest when the checks reject a sentence.
- A taste graph is more useful as a way to find the shared theme between two unlike things than as a source of lists.
- Silent failures are the real risk with a wide API. Validating parameters up front and writing scorers for them was worth more than any single prompt.
- Developing taste needs disagreement. The "not me" and follow-up paths matter as much as the picks.

## What's next

- A social layer, which is not in v1: sharing a profile, finding people whose edges touch yours, and comparing profiles. The brief left it out, and we say so.
- Per-seed tag attribution and a continuous distance on the chart, so line weight can carry connection in words and not only position.
- Lineage for more fields, and more retrieved sources for readings.
- Tuning the thresholds against recorded real pools, and a measured agreement score for the judges.
- A clear use case: a reference board for a creative project.
- Architecture, cars and theater, labeled as bridged by the agent if Qloo adds types for them.

## Built with

Next.js, React, TypeScript, Supabase (Auth and Postgres), the Anthropic API, the Qloo hackathon API, Wikidata (CC0), Vitest, Cormorant Garamond, Newsreader and Inter (SIL OFL).

## Try it

- Demo: TODO(manager): URL
- Source: TODO(manager): public repo URL (MIT licensed)
- Video: TODO(manager): link
- Testing instructions: TODO(manager): write these once the picks gate is open and a deployed demo exists. The intended path is: start at `/start`, add at least 3 seeds across 2 fields, each with a one-line reason, choose See my taste, then Look past the edge. No account is needed for that path. To save picks, sign in with an email address and open the link in the same browser.
- Note for judges (TODO(manager): confirm once deployed): the demo is free. If a daily allowance is used up it shows a "resting" state and comes back later. The hackathon key is active through judging and is deactivated afterward, after which only cached and saved results can be shown.
<!-- TODO(manager): confirm these testing instructions against the deployed demo, and add credentials only if something is private. -->
