# Atelier: project brief (v3)

Copied from the planning notes (brief v3, Oct 14). Later decisions live in DECISIONS.md and override this file.

## Concept
Atelier helps people develop taste, not just feed it. The user shares what they love; the app draws their taste as a profile on an attribute chart, then suggests nodes from different fields at the outer edge of the profile (unfamiliar but connected). Every suggestion shows the connection path back to the user and why it was chosen. The agent has no taste of its own; it is grounded in Qloo's taste graph and used as an instrument for developing the user's.

## Audience and problem
Creatives and students stuck in recommendation loops who want a point of view.

## Product logic
- Input (process still to design): seeds plus why the user loves each; pairwise choices as an option.
- Profile: Qloo tags clustered into about 6-8 cross-domain axes; each axis shows its underlying tags.
- Frontier: score candidates on reach (distance from profile center: lower popularity, less tag overlap, different domain) and connection (strength and specificity of the path; shared tags weighted by rarity; the path needs a distinctive tag or a lineage link). Suggest from the frontier. Random far picks and safe picks are both excluded.
- Dial: sets required reach; the connection floor never drops. Develop (profile forming, the agent asks questions), Match (low reach), Stretch (high reach, low popularity, still connected).
- Paths are stored as seed -> shared theme (tags) -> [lineage hop] -> pick; the explanation is generated from the path. Card: path, why this one, what is different, provenance (sourced or inferred per hop), then the user's reaction in their own words; picks can be revisited.
- Reference layer: get_references(entity) for lineage and symbolic readings. Sourced items link to a source; symbolism only from retrieved text, labeled a reading, omitted if none; sourced and inferred never merged.
- Agent loop: resolve seeds (/search) -> tags (taste analysis, /v2/tags) -> profile and axes -> /v2/insights per domain -> score reach and connection -> fetch references -> re-query if too obvious, weak or poorly connected -> explain.

## Design
The chart is the centerpiece. Nodes sit beyond the edge (distance = reach, line weight = connection strength). Selecting a node highlights its path and opens the card. Different marks per field. Branding is serif, refined, distant, minimal; the user designs the logo.

## Scope
In: onboarding with reasons, attribute chart, frontier suggestions with dial, about 5-6 domains (music, film, TV, books, food and places, fashion brands), stored paths and four-part cards, reaction capture and revisit, visible reasoning, deployed demo, public open-source repo, README, demo video.
Out: architecture, cars and theater unless the API spike shows real Qloo coverage (else labeled LLM-bridged); social and sharing; taste history; taste scores or rankings. The README should name the missing social layer as a limitation.

## Constraints
Hackathon key only against hackathon.api.qloo.com, GET with X-Api-Key. No Qloo response data in the public repo (private server-side caching only). Check params against the Entity Type Parameter Guide. Check licensing for reference sources (Wikidata CC0, Wikipedia attribution).

## Evals
Code: param validity, seed resolution, dial behavior, re-query logic, domain coverage, path presence, distinctive hop, reach margin, connection floor, provenance, card completeness, repo hygiene.
LLM judge: bridge groundedness, bridge quality, stretch defensibility, lineage groundedness, reading restraint, rubric fit (Segal's discernment, pattern recognition, idiosyncrasy).

## Spike questions
- Does Qloo give per-entity tags, affinity and popularity in enough detail to compute reach and tag rarity?
- Are tags comparable across domains, so cross-domain paths are possible?
- Is there anything lineage-like from Qloo, and how good is external lineage coverage by domain?
- How often is the frontier empty? Fallback: relax reach before connection.
