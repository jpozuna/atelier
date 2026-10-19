---
name: submission-check
description: "Audit Atelier against the Qloo Agentic Hackathon's official rules and the project's own constraints before submitting, and report blockers. Checks repo (public, open-source license, README, no Qloo data in files or git history, no secrets), demo (deployed, free, working through Nov 16, judge access), submission materials, and deadlines. Use only when the user runs /submission-check or explicitly asks if the project is ready to submit or for a pre-submission audit."
disable-model-invocation: true
---

# Submission check

Report only. This skill never pushes, deploys, publishes or submits. Verify against the repo and the running demo, not against memory of what was done. Where you cannot verify something (for example the live demo from inside the sandbox), say "not verified" and tell the user exactly how to check it.

## Dates (ET, from the official rules and brief)

- Submission period ends Oct 30, 11:45 pm ET (hard deadline). Target: submit by Thu Oct 29.
- Judging Nov 2 to Nov 16, 11:45 pm ET. The demo must stay free and working, without restriction, until the judging period ends.
- Winners around Nov 23.

State how many days remain, and flag anything that would stop a submission today.

## Repo

1. **Public.** The repo is on GitHub, GitLab or Bitbucket and public.
2. **Open-source license.** A license file exists and is detected by the host: it must show in the repo's About section at the top of the repo page. Check that the LICENSE text is a standard OSI license (for example MIT or Apache-2.0) so detection works.
3. **Everything needed to run.** Source, assets and instructions are all in the repo. A fresh clone plus the README steps works. Try it if you can: install, build, run with a documented `.env.example`.
4. **README.** Explains what Atelier is, who it is for, the agent loop, how to run it, the stack, how Qloo is used (entities, tags, popularity filters, exclusions, taste analysis), limitations (including the missing social layer), and licenses and attributions for third-party sources and fonts.
5. **No Qloo response data.** Run the `repo-hygiene` scorer if it exists. Also check the current tree and the whole git history (`git log -p` and a search for UUIDs outside the synthetic pattern, `urn:tag:` ids, raw JSON responses, screenshots showing picks). History matters: a deleted file is still public in a public repo. If anything is found, report it as a blocker with the commit. Do not rewrite history yourself. Tell the user.
6. **No secrets.** No API keys, `.env` files or Supabase service keys in the tree or history. `.env.example` has placeholders only.
7. **Originality and licenses.** Third-party SDKs, APIs, data, fonts and icons are used within their terms. Reference sources have recorded licenses (Wikidata CC0, Wikipedia needs attribution).
8. **When it was built.** The repo's first commit falls within the submission period (Sep 30 to Oct 30), or the README explains what was significantly updated.

## Demo

1. A deployed URL that loads. Not verified from the sandbox unless network access exists. Give the user a short manual script.
2. Free and without restriction through Nov 16. No paywall. If there is a login, either a guest path exists (onboarding, chart and calibration recs work before an account) or test credentials are in the testing instructions.
3. Survives judges. Rate limits and a cost cap are set, the private cache is working so repeated runs do not exhaust Qloo or LLM budgets, and errors fail gracefully. Per the Developer Guide, the hackathon key stays active through the end of judging (Nov 16) and is deactivated after the hackathon closes. Live Qloo calls will fail after that, so the README says so and the demo fails gracefully rather than looking broken. Quotas are per user and can be raised by asking in #api-help on the hackathon Discord; ask before judging if usage may be heavy.
4. Matches the video and the text. Every feature shown in the video exists in the deployed demo.
5. The hackathon key works only against `hackathon.api.qloo.com`: confirm the deployed environment points there.

## Judging criteria self-check

For each of the four equally weighted criteria, say in two lines what the project shows and what evidence a judge will see:

- Technological implementation: multi-step agent that plans and reacts to Qloo calls, using entities, tags, popularity filters and exclusions. Evidence: trace, reasoning panel, evals.
- Design: one coherent experience with the chart and dial as the centerpiece.
- Potential impact: a specific audience (creatives and students) and problem (recommendation loops), shown in the demo.
- Quality of the idea: growth framing and cross-domain bridges, not "more recommendations".

## Submission materials (Devpost)

- Text description of features and functionality
- Link to the functional demo
- URL of the public repo
- Demo video (the brief calls for one; check the Devpost form for length and format limits)
- Images or screenshots (no Qloo response data visible beyond what is acceptable in a demo; check with the hygiene rule in mind)
- Testing instructions (with credentials if anything is private)
- All materials in English
- Team representative named, if a team

## Output

A table of check, status (pass, fail, not verified) and note. Then:

1. Blockers (must fix before submitting).
2. Risks (should confirm).
3. Not verified (how the user can check).

Offer to draft the Devpost text and the testing instructions once there are no blockers.
