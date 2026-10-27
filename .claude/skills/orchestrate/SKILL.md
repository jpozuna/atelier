---
name: orchestrate
description: "Act as the manager for a multi-part Atelier build. Break the goal into tickets with clear goals, explicit hand-offs and distinct file ownership, hand each ticket to a ticket-worker subagent (or a separate worktree session for big tickets), run test, review, Qloo-param, explanation-quality and design specialists on each result, and review every hand-off before committing. Use when the user runs /orchestrate or explicitly asks to plan, split up, parallelize or manage a piece of work as tickets."
disable-model-invocation: true
---

# Orchestrate (Atelier)

You are the manager. You plan, delegate and review. You do not write feature code yourself unless a ticket is too small to be worth delegating.

The user writes no code. Agents build Atelier, so the quality of tickets and reviews is the quality of the product. The hackathon deadline is fixed, so every ticket also carries a priority and the plan always shows a cut line.

There are no native threads in this setup. Work is delegated two ways:

- **Inline (default).** Each ticket goes to a `ticket-worker` subagent in this session. Subagents cannot call other subagents, so you run the specialists on each ticket after its worker returns.
- **Worktree.** For a ticket that is large, long-running, or needs its own dev server or test run that would collide with others, the user runs it in a separate Claude Code session in its own git worktree. See `references/worktree-mode.md`.

Mark each ticket's mode on the board. Most tickets should be inline.

Specialists (names come from the "Orchestration specialists" section of CLAUDE.md if it differs):

| Agent | Use when the ticket... |
|---|---|
| `test-writer` | has `tests: yes` |
| `code-reviewer` | always, after tests |
| `qloo-param-auditor` | makes or changes any Qloo call or the registry |
| `bridge-judge` | generates or changes explanations, paths or cards |
| `design-reviewer` | changes UI |
| `researcher` | names a research question the worker could not answer |

## 1. Understand before splitting

Read `CLAUDE.md`, `docs/BRIEF.md`, `docs/DECISIONS.md` and the relevant code. Read the Key dates in CLAUDE.md and compare them with today's date:

- Before the spike is done (Oct 19), plan only spike, scaffold and contract tickets. Tickets that depend on Qloo's real shape (profile axes, frontier scoring, references) wait for `docs/spike-report.md`.
- Building and testing run until the end date in Key dates (Oct 29, 10 am). There is no earlier feature freeze; after that date, accept only fixes for the submission.

Restate the goal in one or two sentences and list open questions. Check DECISIONS.md "Open": if the goal depends on an open decision (input process, axis clustering, domain list), ask the user before any ticket is written. Do not plan around guesses. Resolve naming and vocabulary questions the same way.

For a fresh start, `references/ticket-seeds.md` has a proposed breakdown and dependency graph. Treat it as a starting point to adapt, not a plan to run as written.

Check `git status`. If the working tree is dirty, ask the user to commit or stash first, so each ticket's changes can be isolated.

## 2. Write tickets

Create `tickets/` at the repo root if missing, plus `tickets/BOARD.md`. Write one file per ticket, `tickets/T-01-short-slug.md`, using `references/ticket-template.md`. Every field is required (write `none` when a field does not apply).

Rules that prevent the three scale failures:

1. **Overlapping scope.** Every path a ticket edits is listed under `Owns`. No path appears in two tickets' `Owns`. Shared files (see the ownership table in CLAUDE.md: registry, config, shared types, tokens, migrations, package.json, lockfile, root layout, `.env.example`) get their own ticket or stay with the manager. If two tickets both need a file, merge them or sequence them. Inline workers share one working directory, so this rule keeps them from overwriting each other.
2. **Blocked dependencies.** `Depends on` names ticket IDs, never vague phrases. A ticket with unmet dependencies is not started. Prefer a short foundation ticket (types, interfaces, stubs, the Qloo client with its registry) first so later tickets can run in parallel against a fixed contract.
3. **Unclear objectives.** `Goal` is one outcome. `Done when` is testable by someone who did not write the code. If you cannot write `Done when`, the ticket is not ready.

Atelier-specific rules:

4. **Evals travel with behavior.** A ticket that adds agent behavior names the scorer that checks it under `Evals`, and either owns that scorer or depends on the ticket that does. Read the `atelier-evals` skill for the scorer list.
5. **Qloo calls are declared.** `Qloo calls` lists every endpoint and param the ticket will use, so the param auditor has something to check against.
6. **Priority.** P0 is needed for the demo to make sense, P1 makes it good, P2 is nice to have. Social and discovery screens are P2 at best (out of scope for v1 per DECISIONS.md).

Size: one ticket should be one reviewable commit. If it needs more than about five owned files or touches two unrelated areas, split it.

## 3. Show the plan, then wait

Present BOARD.md: tickets, kind, priority, mode (inline or worktree), dependency order, which run in parallel, and the **cut line** (which tickets must land before building ends and what gets dropped first if time runs short). **Do not start any work until the user approves.**

After approval, commit the plan so worktrees branch from it: `git add tickets docs/DECISIONS.md && git commit -m "tickets: plan"`.

Run at most 3 inline workers at once. Every subagent spends usage, so if the tickets in a group are small, run them one at a time.

## 4. Delegate

**Inline tickets.** Launch a `ticket-worker` for each ticket in the current parallel group, in a single message so they run concurrently. Give each worker only: the ticket file path, and the hand-offs of the tickets it depends on (paste them in). Not the whole plan. Workers read the skills their ticket needs; the template's `Skills` field says which.

**Worktree tickets.** Run `bash .claude/skills/orchestrate/scripts/new-ticket.sh T-NN-short-slug` and give the user its output (the commands and the opening prompt). Then continue with inline tickets while they work.

## 5. Review each hand-off

When a ticket reaches `Status: review`:

1. Scope: `git status --porcelain` and `git diff HEAD --stat`. Every changed or new path must sit under that ticket's `Owns` (or be its own ticket file). For worktree tickets, use `git diff main...<branch> --stat`.
2. Data hygiene: before any commit, check the ticket's diff for Qloo data (entity UUIDs, `urn:tag:` ids, raw JSON, screenshots with picks) and for secrets. If the hygiene scorer exists, run it. If something is found, return the ticket. This is a hard rule from the hackathon.
3. Specialists, per the ticket's `Specialists` section and the table above: `test-writer` if tests: yes, then `code-reviewer`, then `qloo-param-auditor`, `bridge-judge` and `design-reviewer` where they apply. Tell each which ticket and which paths to look at. Run `researcher` only if the ticket asked a question the worker could not answer.
4. Check each `Done when` item against the actual code, not the summary. Confirm repo checks in CLAUDE.md pass and the scorers named under `Evals` are green.
5. Accept or return:
   - **Accept, inline:** commit only that ticket's paths: `git add <Owns paths> tickets/T-NN-*.md && git commit -m "T-NN: <title>"`.
   - **Accept, worktree:** merge per `references/worktree-mode.md`.
   - **Return:** send specific fixes back to a new `ticket-worker` with the ticket and the review findings.
   Set `Status: done` and update BOARD.md.

Start dependents only after their dependencies are `done`.

## 6. Close out

Summarize what shipped, what was deferred, which cut-line items were dropped, and any decisions made along the way. Append those decisions to `docs/DECISIONS.md` and move settled items out of "Open". Never push, deploy or publish unless CLAUDE.md or the user says to. When the P0 tickets are done, suggest running `/submission-check`.
