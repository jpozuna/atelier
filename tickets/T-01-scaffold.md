# T-01: Scaffold: Next.js + TypeScript, lint, tests, env

Status: done
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
Changed: Next.js 16.4.2 (App Router) + React 19 + TypeScript 5 + ESLint 9 (flat config, eslint-config-next) + Vitest 5, installed with npm. Files written by hand (create-next-app would not run in a non-empty repo): package.json, package-lock.json, tsconfig.json, next.config.ts, eslint.config.mjs, vitest.config.ts, .env.example, src/app/{layout.tsx,page.tsx,globals.css}. .gitignore gained `.vercel/` and `next-env.d.ts` (`.next/`, `node_modules/`, `.env`, `.qloo-private/`, `*.recording.json` were already there). CLAUDE.md Commands section filled; nothing else touched.

Contracts for other tickets:
- Scripts: `dev`, `build`, `start`, `lint` (`eslint .`), `typecheck` (`tsc --noEmit`), `test` (`vitest run`, passes with no test files), `evals` and `evals:live` (placeholders that print "not yet implemented (T-04)" and exit 0; T-04 must replace them in package.json, which is shared, so ask the manager).
- package.json has `"type": "module"`.
- Path alias `@/*` -> `src/*` in tsconfig.json and vitest.config.ts. Vitest env is `node`, includes `src/**/*.test.ts` and `evals/**/*.test.ts`. Component tests (jsdom) are not set up.
- `.env.example` lists all nine required vars with placeholders. `QLOO_MODE=replay` and `QLOO_RESERVE=6000` follow the qloo-api skill defaults. Only the two Supabase vars are `NEXT_PUBLIC_*`.
- No `src/styles/tokens.css` yet; globals.css is a placeholder with Georgia serif and no tokens.

Results (Node 22.20, npm 10.9): install, build, lint, typecheck and test all pass; `npm run dev` serves `<h1>Atelier</h1>` at `/`. Verified again after deleting `.next` and `next-env.d.ts` (clean-checkout state).

Known gaps:
- `npm audit` reports 5 high findings, all via `braces` -> micromatch -> fast-glob -> @next/eslint-plugin-next -> eslint-config-next (dev-only lint chain, not in the runtime bundle). The only offered fix downgrades to eslint-config-next 14, so I left it.
- eslint 9 prints a deprecation warning at install. eslint-config-next accepts `>=9`; ESLint 10 was not tried.
- CLAUDE.md "Stack" paragraph still says to confirm the stack and delete that sentence (DECISIONS.md now confirms it). That is outside the Commands section so I left it for the manager.
- Screenshot script command left as `<fill in>` (no owner ticket yet).
