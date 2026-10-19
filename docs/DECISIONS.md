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
- Stack (leaning): Next.js, TypeScript, Supabase for auth and DB.
- No code is hand-written by the user; agents build it, so the stack must be well documented and well represented in LLM training data.

## Open
- Input process: seeds plus reasons, pairwise choices, or a mix.
- How tags cluster into axes and stay grounded (proposal in atelier-agent-loop references/scoring.md).
- Concrete use case: reference board for a creative project?
- Qloo-vs-plain-LLM side-by-side as demo and eval?
- GET only vs testing POST for weighted signals. The Developer Guide says `/v2/insights` is GET and POST fails; the Parameter Reference documents POST-only per-entity and per-tag weights. (Group-level weights between the entity and tag signals are documented on GET and are separate.) Without per-seed weights, emphasis comes from which seeds you send. One test call in the spike settles whether POST works. Using it would change the "GET only" rule in CLAUDE.md, so it needs your OK.
- Use beta semantic tag search (`/v2/tags` with `feature.semantic_search`) to map the words of the user's "why" to tags? Depends on the spike's result.
- Domain list (lock Oct 19 after the spike). Architecture, cars and theater only if Qloo coverage is real.
- Runtime LLM provider and model for the agent.
- Reference-layer sources by domain and their licenses.
