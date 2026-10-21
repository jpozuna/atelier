# T-21: README, demo script and Devpost text

Status: review
Mode: inline
Kind: docs
Priority: P0
Depends on: T-14

## Goal
The submission docs: a README with setup, architecture, how Qloo is used, evals, limitations (no social layer) and license; a demo video script; and Devpost text.

## Owns
- README.md
- docs/submission/

## Reads
- CLAUDE.md
- docs/DECISIONS.md
- docs/BRIEF.md
- docs/spike-report.md

## Skills
- none

## Done when
- [ ] The README explains setup from a clean checkout, the agent loop, the call budget, the evals and the missing social layer, and names the MIT license
- [ ] A 3-minute demo script with shot list
- [ ] Devpost text covering what it does, how it's built, challenges and what's next
- [ ] No Qloo data or screenshots of picks in tracked files
- [ ] `/submission-check` is run afterward by the manager
- [ ] Repo checks in CLAUDE.md pass; no Qloo data or secrets in tracked files

## Specialists
- tests: no
- qloo-param-auditor: no
- bridge-judge: no
- design-reviewer: no
- research question: none

## Evals
- repo-hygiene

## Qloo calls
- none

## Handoff
Changed (docs only, no code): `README.md` (rewritten), `docs/submission/demo-script.md`, `docs/submission/devpost.md`. No Qloo calls. `npm run evals` passes (13/13 scorers, repo-hygiene included). No exclamation marks, no Qloo data, no screenshots; examples use no real entity names.

Contracts: none. `/submission-check` is still the manager's step. The README names the MIT license, the missing social layer, and the third-party licenses (Qloo terms, Wikidata CC0, SIL OFL fonts, Anthropic). It states the first commit is Oct 14, inside the submission period (from `git log`).

TODOs for the manager (all are `TODO(manager)`; in the README they are HTML comments, in the submission files they are comments or plain lines; grep for them):
1. Deployed demo URL, repo URL and video link: README top, devpost.md "Try it".
2. Measured judge agreement (target 80% per judge, judge model used): README Evals section and devpost.md "How we built it". The README and Devpost state no number now.
3. POST body gate: `src/lib/qloo/registry.ts` `POST_BODY.confirmedBodyParams` is still empty, so `/api/run` returns `picks_not_enabled`. The README Limitations has a "parameter gate" bullet written for that state. Update or remove it once the 04-post-check is run and the gate opened. Also confirm the demo script's picks beats work in the deployed demo.
4. Supabase migration and `rls.live.test.ts` never run on a real database (README Supabase section note). Update after the first db push.
5. Deployed environment settings and judge testing instructions (README guard section, devpost.md): `QLOO_MODE=record`, `QLOO_RESERVE` about 300, `ATELIER_DEMO` unset, Supabase cache adapter (auto in production when the Supabase env is set). Add credentials only if something is private.
6. Devpost form: video length and format limits, gallery images (which, if any, are acceptable under the Qloo data rule), team representative.
7. Facts I took from handoffs and did not verify live: the guard numbers (3 runs an hour, 8 a day, 480 daily allowances), 10 seeds max, 3 seeds across 2 fields minimum, `/compare` reachable by URL only (no nav link exists; the demo script opens it by address), compare button "Ask a plain model".

Decisions I made: README says a fresh checkout has an empty cache, so `replay` answers only from a recorded cache and a developer needs `QLOO_MODE=record` with their own key. The demo script is voice-over only and tells the presenter to use seeds of their own, written as placeholders. The limitations section lists "not yet verified" items neutrally (thresholds untuned, model-text checks untuned, end-to-end live run, judge agreement, RLS, browser review).

Known gaps: demo script timings are an estimate and need a rehearsal. `docs/submission/` has no testing-instructions file; they sit at the end of devpost.md.

### Round 2 (coordinator fact-check corrections), all applied
README: Node 22.12 or newer; fresh checkout says `QLOO_MODE=record` (replay with an empty cache gives `lookups_off`); new "Open the picks gate" section (7-call post-check, `--dry-run` then `QLOO_LIVE=1 QLOO_BUDGET=7`, record names in `POST_BODY.confirmedBodyParams`, until then "Picks aren't ready yet"); live suites described as being added in `evals/live/` (post-check instructions only, smoke-run at most 9 Qloo calls per its header); guard covers five routes incl. `/api/compare` (6 an hour per IP, 1 model call, 0 Qloo, counts against the 480 daily model allowance); runs include first run, "Not me" re-run and follow-up; new "Compared with a plain model" item (needs `ANTHROPIC_API_KEY` and a stored run in the same tab, side by side from 56rem); reserve applies once the remaining count is known from a Qloo response; submission-period claim now a TODO(manager).
demo-script: no deployed-demo claims (TODO(manager)); run cost per beat; `/compare` same-tab, same-fields and 56rem notes; real copy ("so showing high", the four save labels, "Yes, I tried it" then "How was it?", "Save what happened" then "Update", "Look past the edge", "Compare with a plain model", page title "Grounded and ungrounded", "Shared theme" step label).
devpost: judges wording, tag vocabulary wording, a "Not yet verified" section, softened interface claim, testing instructions and judge note marked TODO(manager).
Still for the manager: the smoke-run's 9-call figure comes from its header comment (the suite is in progress); the `/compare` page `<title>` is "Compare | Atelier" while its heading is "Grounded and ungrounded" (I used the heading).
