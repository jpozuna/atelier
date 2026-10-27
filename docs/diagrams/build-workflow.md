# Atelier build workflow

How agents build Atelier: the `orchestrate` manager splits work into tickets, `ticket-worker` subagents implement them, specialist subagents check each hand-off, and domain skills carry the rules every agent reads.

Source: `.claude/skills/`, `.claude/agents/`, `CLAUDE.md`. Update this file when a skill or agent definition changes.

## Ticket lifecycle

One pass of `/orchestrate`, from goal to committed tickets.

```mermaid
flowchart TD
  U(["User runs /orchestrate with a goal"]) --> M1

  subgraph MGR["Manager: orchestrate skill"]
    M1["1 · Understand<br/>read CLAUDE.md, BRIEF, DECISIONS, code<br/>check key dates and git status"]
    M1 --> OQ{"Depends on an<br/>open decision?"}
    OQ -->|yes| ASK["Ask the user"] --> M1
    OQ -->|no| M2["2 · Write tickets<br/>tickets/T-NN-slug.md + BOARD.md<br/>Owns, Depends on, Done when,<br/>Specialists, Evals, Qloo calls, priority"]
    M2 --> M3["3 · Show board and cut line"]
    M3 --> OK{"User<br/>approves?"}
    OK -->|no| M2
    OK -->|yes| CP["Commit plan<br/>tickets: plan"]
  end

  CP --> MODE{"Ticket mode"}
  MODE -->|"inline (default)<br/>max 3 at once"| TW["ticket-worker subagent<br/>edits Owns paths only<br/>no commits"]
  MODE -->|"worktree<br/>large or needs own server"| WT["new-ticket.sh<br/>user opens a session on<br/>branch ticket/T-NN-slug"]
  TW --> HO["Handoff filled<br/>Status: review"]
  WT --> HO
  TW -.->|"needs a path outside Owns"| BL["Status: blocked"] -.-> M2

  HO --> R1

  subgraph REV["5 · Review the hand-off"]
    R1["Scope check<br/>every changed path is under Owns"]
    R1 --> R2["Data hygiene<br/>no Qloo ids, tag ids, raw JSON, secrets"]
    R2 --> SP["Specialists, in order"]
    SP --> R3["Check each Done when against code<br/>npm test, lint, typecheck, named scorers"]
  end

  R3 --> ACC{"Accept?"}
  ACC -->|"return with findings"| TW
  ACC -->|"accept, inline"| C1["Commit Owns paths<br/>T-NN: title"]
  ACC -->|"accept, worktree"| C2["git merge --no-ff<br/>remove worktree"]
  C1 --> DN["Status: done · BOARD.md<br/>start dependents"]
  C2 --> DN
  DN --> CL["6 · Close out<br/>record decisions in DECISIONS.md<br/>suggest /submission-check"]
```

**Rules that keep tickets parallel**

- No path appears in two tickets' `Owns`. Shared files (registry, config, types, tokens, migrations, package.json) get their own ticket or stay with the manager.
- `Depends on` names ticket IDs. Dependents start only after those are done.
- Any ticket kind until Oct 29, 10 am; after that, only fixes for the submission.

**Why the manager runs specialists**

- Subagents cannot call other subagents, so a worker returns and the manager launches each specialist on that ticket.
- Specialists only read and report, except `test-writer`, which writes tests under the ticket's `Owns`.
- Nothing is pushed or deployed without the user's say-so.

## Specialists and skills

Which specialist runs on a ticket, and which skills each agent reads. Solid lines are runs; dotted lines are reads.

```mermaid
flowchart LR
  subgraph TRIG["Ticket says"]
    T1["tests: yes"]
    T0["always"]
    T2["makes or changes<br/>Qloo calls"]
    T3["changes paths,<br/>cards, explanations"]
    T4["changes UI"]
    T5["names a research<br/>question"]
  end

  subgraph AG["Specialist subagents"]
    TWR["test-writer<br/>writes and runs tests"]
    CR["code-reviewer<br/>scope, hard rules, bugs"]
    QPA["qloo-param-auditor<br/>params vs registry"]
    BJ["bridge-judge<br/>card rubric scores"]
    DR["design-reviewer<br/>brand, chart, a11y"]
    RS["researcher<br/>one sourced answer"]
  end

  T1 --> TWR
  T0 --> CR
  T2 --> QPA
  T3 --> BJ
  T4 --> DR
  T5 --> RS

  subgraph SK["Domain skills"]
    S1["qloo-api"]
    S2["atelier-agent-loop"]
    S3["atelier-evals"]
    S4["atelier-design"]
  end

  W["ticket-worker"] -.->|"per ticket Skills field"| SK
  QPA -.-> S1
  BJ -.->|"judge-rubrics.md"| S3
  DR -.-> S4
  RS -.->|"param-registry.md"| S1
  TWR -.->|"synthetic fixtures"| S3
```

**Review order**

- `test-writer` first, then `code-reviewer`, then the auditor, judge and design reviewer where they apply.
- `researcher` runs only when a worker could not answer a named question.

**Manual-only skills**

- `/orchestrate`: the manager above.
- `/qloo-spike`: probes Qloo per domain and writes `docs/spike-report.md` (locked the domain list by Oct 19).
- `/submission-check`: pre-submit audit against the hackathon rules, suggested once P0 tickets are done.

## Agent roster

| Agent | Model | Tools | Job |
|---|---|---|---|
| `ticket-worker` | sonnet | Read, Grep, Glob, Edit, Write, Bash | Implements one ticket inside its Owns paths, fills Handoff, sets Status: review. Never commits. |
| `test-writer` | sonnet | Read, Grep, Glob, Edit, Write, Bash | Tests each Done when item plus edge cases with mocked clients and synthetic fixtures. Reports code bugs instead of fixing them. |
| `code-reviewer` | sonnet | Read, Grep, Glob, Bash | Scope violations first, then hard-rule violations, unmet criteria, bugs. Runs test and lint. |
| `qloo-param-auditor` | sonnet | Read, Grep, Glob, Bash | Checks every Qloo call site's endpoint, method, host and params against `registry.ts`, since Qloo silently ignores invalid params. |
| `bridge-judge` | opus | Read, Grep, Glob | Scores a card for groundedness, quality, stretch defensibility, lineage, reading restraint and rubric fit. JSON only. |
| `design-reviewer` | sonnet | Read, Grep, Glob, Bash | Checks brand, chart, cards, motion, accessibility and the reasoning panel. Code-only until a screenshot script exists. |
| `researcher` | sonnet | Read, Grep, Glob, WebSearch, WebFetch | Answers one question from the repo first, then official docs, marking verified versus inferred. |
