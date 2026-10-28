# T-39: README and submission texts say what is true today

Status: todo
Mode: inline
Kind: docs
Priority: P0
Depends on: none (waits on two manager decisions: the picks gate check and the deployed QLOO_MODE; the manager pastes both outcomes into the worker prompt)

## Goal
The README, Devpost text and demo script match the shipped app and the deployed demo, with every TODO(manager) resolved or deliberately left with a reason.

## Owns
- README.md
- docs/submission/devpost.md
- docs/submission/demo-script.md

## Reads
- tickets/T-21-submission-docs.md (its hand-off lists the TODOs)
- src/components/shell/fonts.ts and src/components/shell/fonts/ (the fonts actually shipped)
- src/lib/qloo/registry.ts (`POST_BODY.confirmedBodyParams`)
- docs/DECISIONS.md
- The manager's notes on the gate check and the deployed settings (in the prompt)

## Skills
- atelier-design (voice and copy rules)
- submission-check (the rules the texts are judged against; read only, do not run the audit)

## Done when
- [ ] The user's new opening paragraphs keep their wording; only spelling is fixed (endeavours, vacuum, explanation) and the repeated "instrument for developing yours" appears once.
- [ ] Judge agreement is stated once and plainly: 3 of 6 judges meet the 80% target, with the existing table. "Measured agreement of the LLM judges" is removed from "Not yet verified" (it was measured), and devpost.md says the same without a stronger claim.
- [ ] The fonts line names the fonts in fonts.ts, with their licenses.
- [ ] The picks gate paragraphs (setup section and Limitations) match the gate's real state as given by the manager; the TODO(manager) after Limitations is gone.
- [ ] The deployed settings line matches the real Production QLOO_MODE as given by the manager; the guard-section TODO is resolved or left with a one-line reason.
- [ ] The first-commit-date line is restored or replaced with what the manager gives; no unverified claim about the submission period.
- [ ] README "How it works" item 8 matches the current picks screen (no sort menu; the chart key filters fields; per T-33/T-34 in docs/DECISIONS.md).
- [ ] No Qloo data, no real entity names in examples, no exclamation marks. npm run evals (repo-hygiene) passes.

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
(Worker fills in.)
