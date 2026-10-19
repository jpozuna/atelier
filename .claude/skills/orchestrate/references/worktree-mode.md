# Worktree mode

Use for a ticket that is large, long-running, or needs its own dev server or test run that would collide with others. Most tickets should stay inline.

## Start

The manager commits the plan first (`tickets: plan`), so the branch starts with the ticket file. Then:

```
bash .claude/skills/orchestrate/scripts/new-ticket.sh T-NN-short-slug
```

The script creates branch `ticket/T-NN-short-slug` in a sibling worktree folder, copies `.env.local` if one exists (it is gitignored, and the worktree needs the Qloo key to run), and prints the commands and an opening prompt for the user to paste into a new Claude Code session in that folder. The user installs dependencies there (see CLAUDE.md Commands).

## Rules for the worktree session

- Work only on its branch. Edit only paths under the ticket's `Owns` plus its own ticket file.
- Committing on the ticket branch is expected here (unlike inline workers). Do not merge, push, rebase onto main, or switch branches.
- When done: fill `Handoff`, set `Status: review`, commit, and tell the user to return to the manager session.

## Rules for the manager

- Do not edit that ticket's file on main while the worktree is open. `BOARD.md` is the manager's status record. Editing the ticket file on both sides makes the merge fail.
- Review with `git diff main...ticket/<slug> --stat` (scope) and `git diff main...ticket/<slug>` (content). Run the same specialists as for inline tickets, pointing them at the branch.

## Accept

From main with a clean tree:

```
git merge --no-ff ticket/T-NN-short-slug -m "T-NN: <title>"
git worktree remove ../<repo>-wt/T-NN-short-slug
git branch -d ticket/T-NN-short-slug
```

Run the repo checks after the merge. If the merge conflicts, the ticket's `Owns` overlapped with something else. Abort the merge (`git merge --abort`), return the ticket, and fix the ownership split.

## Return

Send the findings to the user to paste into the worktree session, or start a new inline `ticket-worker` on the branch if the fix is small.
