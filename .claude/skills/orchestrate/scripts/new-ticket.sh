#!/usr/bin/env bash
# Create a git worktree and branch for one ticket, and print how to start a session in it.
# Usage: bash .claude/skills/orchestrate/scripts/new-ticket.sh T-NN-short-slug
set -euo pipefail

slug="${1:-}"
if [ -z "$slug" ]; then
  echo "usage: new-ticket.sh T-NN-short-slug" >&2
  exit 2
fi

root="$(git rev-parse --show-toplevel)"
ticket="tickets/${slug}.md"
branch="ticket/${slug}"
wt_root="$(dirname "$root")/$(basename "$root")-wt"
dir="${wt_root}/${slug}"

if [ ! -f "${root}/${ticket}" ]; then
  echo "no ${ticket}; write the ticket first" >&2
  exit 1
fi
if [ -n "$(git -C "$root" status --porcelain -- tickets)" ]; then
  echo "tickets/ has uncommitted changes. Commit the plan first (git add tickets && git commit -m 'tickets: plan')." >&2
  exit 1
fi
if [ -e "$dir" ]; then
  echo "${dir} already exists" >&2
  exit 1
fi

mkdir -p "$wt_root"
git -C "$root" worktree add -b "$branch" "$dir" HEAD >/dev/null

# Gitignored env file: the worktree needs the key to run the app or live evals.
for f in .env.local .env; do
  if [ -f "${root}/${f}" ]; then
    cp "${root}/${f}" "${dir}/${f}"
  fi
done

cat <<OUT
Worktree ready.

  Folder:  ${dir}
  Branch:  ${branch}

1. In a new terminal:
     cd "${dir}"
     <install dependencies, see CLAUDE.md Commands>
     claude

2. Paste this as the first message:

---
You are the worker for ${slug} in a git worktree on branch ${branch}.
Read CLAUDE.md and tickets/${slug}.md, then everything under Reads and the skills the ticket lists.
Edit only paths under Owns plus your own ticket file. If you need another path, stop,
set Status: blocked and explain in Handoff.
Commit on this branch only. Do not merge, push, rebase, or switch branches.
When done: fill in Handoff, set Status: review, commit, and tell me to go back to the manager session.
---

3. When the worker says it is in review, return to the manager session.
OUT
