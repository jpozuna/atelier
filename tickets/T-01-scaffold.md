# T-01: Scaffold: Next.js + TypeScript, lint, tests, env

Status: todo
Mode: inline
Kind: feature
Priority: P0
Depends on: none

## Goal
A Next.js (App Router) + TypeScript app that installs, builds, lints, typechecks and runs an empty test suite, with the repo commands written into CLAUDE.md.

## Owns
- package.json
- package-lock.json
- tsconfig.json
- next.config.ts
- eslint.config.mjs
- vitest.config.ts
- .env.example
- .gitignore
- src/app/layout.tsx
- src/app/page.tsx
- src/app/globals.css
- CLAUDE.md (the Commands section only)

## Reads
- CLAUDE.md
- docs/DECISIONS.md
- docs/BRIEF.md
- LICENSE

## Skills
- none

## Done when
- [ ] `npm install`, `npm run build`, `npm run lint`, `npm run typecheck` and `npm test` all succeed on a clean checkout
- [ ] `npm run dev` serves a placeholder page at `/` with the text wordmark "Atelier"
- [ ] `.env.example` lists `QLOO_BASE_URL`, `QLOO_API_KEY`, `QLOO_MODE`, `QLOO_RESERVE`, `ANTHROPIC_API_KEY`, `ATELIER_MODEL=claude-sonnet-5-5`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, with placeholder values only. No Qloo or Anthropic key in any `NEXT_PUBLIC_*` name
- [ ] `.gitignore` still ignores `.env`, `.qloo-private/` and `*.recording.json`, and adds `.next/`, `node_modules/` and `.vercel/`
- [ ] CLAUDE.md Commands section filled in: install, dev, test, lint/typecheck, and placeholders for the eval commands (T-04 fills those in). Nothing else in CLAUDE.md changes
- [ ] Vitest is the test runner and picks up `src/**/*.test.ts` and `evals/**/*.test.ts`
- [ ] Repo checks in CLAUDE.md pass; no Qloo data or secrets in tracked files

## Specialists
- tests: no
- qloo-param-auditor: no
- bridge-judge: no
- design-reviewer: no
- research question: none

## Evals
- none

## Qloo calls
- none

## Handoff
(Worker fills in.)
