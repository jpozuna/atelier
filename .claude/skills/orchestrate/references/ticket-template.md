# Ticket template

Copy this to `tickets/T-NN-short-slug.md`. Every field is required. Write `none` when a field does not apply. Workers edit only `Status` and `Handoff` (and set `Status: blocked` when needed).

```markdown
# T-NN: <title>

Status: todo            # todo | in-progress | blocked | review | done
Mode: inline            # inline | worktree
Kind: feature           # feature | fix | polish | docs
Priority: P0            # P0 needed for demo | P1 makes it good | P2 nice to have
Depends on: none        # ticket IDs only, e.g. T-02, T-03

## Goal
One outcome, one or two sentences.

## Owns
Every path this ticket may create or edit. No other ticket owns these.
- src/lib/example/

## Reads
Files the worker should read but must not edit. Include the hand-offs it depends on.
- src/types/
- CLAUDE.md

## Skills
Which repo skills the worker must read first (qloo-api, atelier-agent-loop, atelier-evals, atelier-design).
- none

## Done when
Testable by someone who did not write the code.
- [ ] item
- [ ] item

## Specialists
- tests: no                  # yes | no
- qloo-param-auditor: no     # yes if this ticket makes or changes Qloo calls or the registry
- bridge-judge: no           # yes if it generates or changes explanations, paths or cards
- design-reviewer: no        # yes if it changes UI
- research question: none    # one specific question, or none

## Evals
Scorers this ticket must keep green, or adds. Names from the atelier-evals skill.
- none

## Qloo calls
Endpoints and params this ticket will use. Checked against the registry.
- none

## Handoff
(Worker fills in: what changed, any contract other tickets rely on, known gaps.)
```
