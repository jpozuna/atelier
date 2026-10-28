# T-39: README and submission texts say what is true today

Status: done
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
Changed README.md, docs/submission/devpost.md, docs/submission/demo-script.md. No code touched. `npm run evals` passes (repo hygiene included). Submission-check audit not run, as instructed.

README:
- Opening: spelling fixed (endeavours, vacuum, explanation); the repeated "tool to develop yours" / "instrument for developing yours" now appears once. Wording otherwise the user's.
- Demo URL added (https://atelier-ten-teal.vercel.app); the other Vercel URL appears nowhere.
- Item 8 matches the picks screen: no sort menu, chart key is the only field filter, stretch defined on screen, tick-to-chart kept.
- Picks gate: "Open the picks gate" is now "The picks gate", past tense (ran live 2026-10-28, 7 calls, three params confirmed for all six types, recorded in `POST_BODY.confirmedBodyParams`), with the re-check steps (`--dry-run` first). "picks_not_enabled" text removed; the Limitations bullet rewritten as true today (confirmed for one key; re-check on a new key); its TODO removed.
- Guard section: TODO replaced by "Deployed settings" (record, reserve 300, ATELIER_DEMO unset, hackathon host, QLOO_CACHE unset so Supabase) and "Testing it" for judges (no account, 3 runs an hour and 8 a day, resting state). `QLOO_RESERVE` row now says the deployed demo uses 300.
- Judges: states once that 3 of 6 meet the 80% target, above the unchanged table; removed from "Not yet verified". "End-to-end run against live Qloo data and a real model" stays: docs/DECISIONS.md does not record it as done.
- Fonts line was wrong (Cormorant Garamond, Newsreader, Inter). Now Instrument Serif, DM Sans, DM Mono, SIL OFL 1.1, per fonts.ts. Same fix in devpost "Built with".
- First-commit line kept (git log confirms 2026-10-14).

devpost.md: same gate, judge, fonts, demo URL and testing text. Also corrected claims the app no longer makes: removed the "Qloo versus a plain model" view and the streaming reasoning panel (trace is private now, per DECISIONS 2026-10-22), and changed degree names to low, medium, high stretch.
demo-script.md: removed the sort beats, fixed a duplicated phrase in the 1:40 row, replaced the gate TODO with a plain note.

TODO(manager) left:
1. README, under the demo URL: demo video link (no video yet).
2. devpost.md line 5: confirm each claimed feature works in the deployed demo, fill repo URL, video link, team representative, check form length and video limits.
3. devpost.md Try it: Source (public repo URL) and Video link.
4. demo-script.md: check Devpost form video length and format limits.
5. demo-script.md: decide which gallery images are acceptable under the Qloo data rule.

Unchecked: that the deployed demo actually reflects these settings (stated by the manager, not verified here).
