---
name: atelier-design
description: "Atelier's brand and interface rules: serif, refined, distant, minimal; the attribute chart as centerpiece; pick cards and decks; the visible reasoning panel; onboarding screens; accessibility. Use whenever building, changing or reviewing any Atelier UI, component, screen, style, animation, copy or layout, or when asked how something should look, feel or be worded, even for small changes."
---

# Atelier design

Design is one of four equally weighted judging criteria, and the question is whether this is a coherent product experience rather than a technical proof of concept. Coherence beats polish on any single screen. Before building UI, also read the `frontend-design` skill if it is available, for craft and to avoid templated defaults. This skill supplies the Atelier-specific decisions.

## Brand

Serif, classy, refined, distant, minimal. Think a quiet gallery or a printed monograph, not an app that wants your attention. The user designs the logo: use a plain text wordmark ("Atelier") as a placeholder and never generate or invent a logo.

- Type: a serif for display and reading text; a restrained pairing for small UI labels. Pick fonts that are free to use (check the license) and self-host or load from Google Fonts. Define everything as tokens in `src/styles/tokens.css`.
- Color: near-neutral, one restrained accent. Provide light and dark values. Do not rely on color alone to carry meaning.
- Space and motion: generous space, few elements, slow and quiet motion.
- Tone of voice: precise, plain, a little reserved. Teach; do not sell. No exclamation marks, no gamified praise, no "AI with taste" language. The agent has no taste of its own and the interface never claims it does.

## The chart is the centerpiece

Everything else supports it.

- The profile is drawn as an attribute chart with about 6 to 8 axes. Each axis can be opened to show the tags it is made of.
- Suggestions are nodes beyond the edge of the profile. Distance from the edge encodes reach. Line weight to the profile encodes connection strength.
- Each field (music, film, TV, books, food and places, fashion) has its own mark shape, so fields are distinguishable without color.
- Selecting a node highlights its path back to the seed and opens its card. Hover and focus behave the same.
- The chart has a text equivalent: a list of axes with tags, and a list of picks with their path, reachable by keyboard and by screen reader.
- Build and review the chart against mock data first. It must read well with 6 picks and with 30.

## Cards and decks

A card shows four things, always in this order: the **path** (seed, shared theme, any lineage hop, pick), **why this one**, **what is different**, and **provenance** (sourced or inferred per hop, with links for sourced). After exploring, the user records a reaction in their own words. Picks can be revisited.

- Cards come in decks by field. They arrive like a card-pack opening, but read this in the brand's voice: a slow, quiet reveal where cards turn one at a time, not a flashy burst. If the user asks for a more energetic version, that is their call.
- Edge picks show all three degrees (moderate, high, extreme) at once, with an option to hide fields the user does not want.
- Sourced and inferred must look different at a glance, and must never be merged in one line.
- Never show a score, rank, stars or a percentage "match" for taste. Reach and connection are shown as position and line weight, not as numbers meant to rank.
- Respect `prefers-reduced-motion`: the reveal becomes a simple fade or none.

## Reasoning panel

The loop's trace is shown as readable steps ("Resolved 5 of 6 seeds", "Too many obvious results in music, asking again for less popular ones"). It is part of the product, not a debug view.

- One line per trace event, written by the panel from the event's structured fields in fixed wording (decided 2026-10-19). Free-text `say` is shown only for an unknown event kind, because it cannot be guaranteed free of ids and numbers. Counts of the user's own seeds are fine; taste scores and audience metrics never are.
- Re-queries show their reason in plain words.
- Relaxed bands are stated plainly ("Nothing connected strongly enough at the extreme band, so showing high").
- Collapsible, and readable without the chart.

## Onboarding

Everyone starts with questions. Pick a field from a dropdown, type a thing, answer a one-line why, with Qloo entity chips to confirm what was meant. Repeat for as many fields as the user wants. Aim for 5 to 10 minutes, with a visible sense of how much is left. Ambiguous or missing seeds are explained and fixable on the spot. The user can see the chart and the reasoning, and get calibration recs, before creating an account. Saving requires one.

## Accessibility (a floor, not polish)

- Text contrast at least WCAG AA in both themes. Visible focus states on everything interactive.
- Everything operable by keyboard, including chart nodes and deck cards.
- Meaning never carried by color alone (marks, labels, weights).
- Touch targets at least 44 by 44 px. Works at phone width. The chart adapts, it does not just shrink.
- Semantic HTML first. Labels on every input. Live regions for loading and for results arriving.

## For reviewers

Check against this file: does the screen serve the chart, is there anything that gamifies or ranks taste, are sourced and inferred distinguishable, does motion respect reduced-motion, does it work by keyboard, are tokens used instead of hard-coded values.
