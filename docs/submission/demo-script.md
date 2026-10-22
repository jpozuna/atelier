# Demo script: 3 minutes

Target length 3:00, hard ceiling 3:00. Voice-over over a screen recording, no face cam needed. Every beat below exists in the code. Whether each one works end to end depends on the picks gate being open and a deployed demo existing; if one is not working on recording day, cut its beat rather than fake it.

<!-- TODO(manager): the picks, card, Not me and save beats need the POST gate open (README, Open the picks gate) and a deployed demo. Confirm each against the deployment before recording. -->

<!-- TODO(manager): check the Devpost form for video length and format limits, and confirm the deployed URL before recording. -->

## Before recording

- Choose 3 to 5 seeds of your own across at least 2 fields, each with a one-line reason that is true for you. Use things you can speak about with conviction; the pitch is about a point of view, so a generic list will undercut it. In this script they are written as [film seed], [album seed] and [place seed].
- Rehearse the whole run once so the result is cached, then record from the same browser tab. The picks screen restores a finished run from the tab without any new call, and the server replays the same requests from its cache. Before any rehearsal that makes live Qloo calls, run the dry-run count and get the project owner's OK (CLAUDE.md rule 10).
- The demo guard allows 3 runs an hour per visitor, and the first run, each "Not me" re-run and each follow-up all count as a run. Plan for that: either pre-record the "Not me" and follow-up beats on a different hour or from a different visitor address, or note that each one costs a run. Do not spend runs on retakes; record from the stored run.
- Sign in beforehand, so the sign-in email is not part of the recording. Save two or three picks and mark one as tried before the take, then do a fresh follow-up on camera if time allows.
- Record the picks screen in a window at least 64rem wide (about 1024 pixels), so the chart and the suggestion list sit side by side.
- Hide bookmarks, other tabs, the terminal, the `.env` file and the Supabase and Anthropic dashboards. Use the light theme at a readable zoom (about 125 percent).
- Do not use `/dev/*` or `/picks/preview`. They are synthetic previews and 404 in production.

## Timeline and shot list

| Time | Shot | What to say |
|---|---|---|
| 0:00 to 0:15 | Landing page, then Begin. | "Recommenders show you more of what you already like. Atelier asks a different question: what connects the things you love, and where else does that show up?" |
| 0:15 to 0:50 | **Onboarding (`/start`).** Pick Film in the field dropdown, type [film seed], press Find it. Show the match, or the chooser if the title is ambiguous. Type the one-line reason, press Add to my list. Add [album seed] under Music, then [place seed] under Food and places. Show the list with its readiness line. Press See my taste. | "I name something I love, say why in one line, and repeat across fields. The why matters: Atelier maps my own words to Qloo tags. It needs at least three things across two fields." |
| 0:50 to 1:10 | **Chart (`/taste`).** Hover an axis so its tags list. Pin one. End on the "Look past the edge" button. | "This is my taste, drawn from Qloo's taste analysis, as axes. Each axis shows the tags it is made of. Nothing here is a score." |
| 1:10 to 1:40 | **Picks (`/picks`).** The chart on the left, the list on the right. Show the calibration rows (close picks, "Same field as" and "A different field from"), then the suggestion list: each row says the axis it sits beside and its stretch. Sort by stretch, then by field. Hide one field and show it again. Tick three suggestions from different fields and show them together on the chart; point at the heavier and lighter lines. | "First, a few very close picks so I can correct the agent. Then up to twenty suggestions at low, medium and high stretch, balanced so no field takes over. Unfamiliar, but connected. No random picks and no merely popular ones. A heavier line is a stronger connection, and I can put several on one chart to see where each falls." |
| 1:40 to 2:05 | **A suggestion's reasoning.** Click one row, preferably in a field different from a seed. Read the "On the chart" line (the axis it is beside and its stretch), then preferably in a field different from a seed. Walk the path: my seed, the "Shared theme" step, a lineage hop if this pick has one, the pick. Point at a Sourced or Inferred badge and, if present, the "A reading" section. Read the "what is different" line. | "Every pick shows its path back to me. The shared theme step is built from tags we share. Sourced and inferred are labeled and never mixed. Lineage and readings appear only when there is retrieved text behind them, and are left out otherwise. The explanation is written from this path and nothing else." |
| 2:05 to 2:20 | **Tags.** Select an axis and click one of its tag chips. Show the list of my seeds and suggestions that share that tag, and open one from there. | "Every axis is made of Qloo tags. A tag shows everything here that runs through it. Code measures how far and how connected a pick is; the model chooses the theme and explains. The agent has no taste of its own." |
| 2:20 to 2:30 | **"Not me."** On a calibration pick that misses, press Not me. Show only that field refresh. | "If a close pick is wrong, I say so. It is set aside and only that field is looked at again." |
| 2:30 to 2:45 | **Save and follow-up (`/saved`).** On a card, show the four saves: "Save for later", "I will try it", "Explore further" and "Not for me". Then open the saved list and one saved pick. Choose "Yes, I tried it", which brings up "How was it?" and the why box. Press "Save what happened" (the button then reads "Update"). | "I can save a pick for later, say I will try it, or explore further, and come back. After I try it, I say how it went and why, and the edges move." |
| 2:45 to 3:00 | **Close on the chart.** Back on `/picks`, tick the saved pick and two others, and hold on the chart. | "Every suggestion has a path back to me and a source or an honest 'inferred'. Atelier is built so I can disagree with its reasoning, and that is how taste develops." |

If the cut runs long, drop the sort and field toggle at 1:30, the "Not me" beat, or the tag chips. Keep onboarding, the multi-select on the chart and one full suggestion's reasoning.

## Notes for the voice-over

- Say "edge" and "frontier" sparingly; say "unfamiliar but connected".
- Describe the chart as a profile, never as a rating. There are no scores, percentages or rankings in the product, and the voice-over must not introduce any.
- Be exact about the guest path: onboarding, chart, calibration and edge picks work without an account. An account is needed to save.
- Name the missing social layer if the script mentions what is next. Do not imply sharing or finding people exists.
- Calm pacing. No hype words, no "revolutionary", no exclamations.

## What not to show

- No screenshots or frames of real picks in any tracked file. The video is hosted outside the repo, and nothing from the recording is committed. Picks, entity names and tag names come from Qloo.
- Pick images for the Devpost gallery are a separate decision: choose them deliberately, keep them out of the repo, and do not capture names or ids that you would not be comfortable sharing publicly.
  <!-- TODO(manager): decide which gallery images are acceptable under the Qloo data rule. -->
- No `.env`, no keys, no Supabase or Anthropic dashboards, no terminal output with request URLs or ids, and nothing from `.qloo-private/`.
- No numbers about taste. If a number appears anywhere on screen, stop and find out why.
- No claims the product does not support: no sharing, no social features, no architecture, cars or theater, no lineage for books or places.
- No live runs on camera if the demo guard has less than a run left for the visitor, and no retries of a failed run on camera. If a run errors, cut and re-record from the stored run.
