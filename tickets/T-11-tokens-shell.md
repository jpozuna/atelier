# T-11: Design tokens and app shell

Status: done
Mode: inline
Kind: feature
Priority: P0
Depends on: T-01

## Goal
Atelier's look as tokens and a shell component (wordmark placeholder, serif type, quiet chrome, light and dark), so every screen starts from the same base.

## Owns
- src/styles/tokens.css
- src/components/shell/

## Reads
- CLAUDE.md
- docs/DECISIONS.md
- .claude/skills/atelier-design/SKILL.md

## Skills
- atelier-design

## Done when
- [x] `tokens.css` defines color, type scale, spacing, radius and motion tokens for light and dark. The display serif and text faces load through `next/font`
- [x] A `<Shell>` component renders the text wordmark, the main region and an optional side region for the reasoning panel
- [x] The handoff gives the manager the exact lines to add to `src/app/layout.tsx` (the manager owns it)
- [x] Contrast meets WCAG AA in both themes. Visible focus states. Motion respects `prefers-reduced-motion`
- [x] Repo checks in CLAUDE.md pass; no Qloo data or secrets in tracked files

## Specialists
- tests: no
- qloo-param-auditor: no
- bridge-judge: no
- design-reviewer: yes
- research question: none

## Evals
- none

## Qloo calls
- none

## Handoff

Files: `src/styles/tokens.css`, `src/components/shell/{fonts.ts,Shell.tsx,Shell.module.css,index.ts}`.

What changed
- `tokens.css`: color (light, dark by `prefers-color-scheme`, forced with `data-theme="light|dark"` on `<html>`), type scale, spacing, radius, layout, motion, focus and provenance tokens (`--color-sourced` / `--color-inferred` plus `--line-sourced: solid` / `--line-inferred: dashed`, so the two never differ by color alone). It also holds the base layer (body font, background, text color, `h1-h3` display face, `:focus-visible` ring, `.sr-only`, reduced-motion). So globals.css no longer needs any body styling.
- Fonts (all SIL OFL, self-hosted by `next/font/google` at build): Cormorant Garamond (display, 400/500, wordmark and large headings only), Newsreader (reading text), Inter (small UI labels). Set in `fonts.ts`; it exports `fontVariables`, a class string declaring `--font-atelier-display|text|ui`, which tokens.css reads via `--font-display`, `--font-text`, `--font-ui`.
- `<Shell>` (server component): skip link, text wordmark "Atelier" linking to `/` (placeholder, no logo), `<main id="main">`, optional `<aside aria-label={sideLabel}>` (prop `side`, default label "Reasoning"). Side sits beside main at >= 64rem and follows main below that. Wordmark and skip link are 44px targets.
- Contrast computed (WCAG 2.x): every text token on bg/surface/raised is >= 6.0:1 in both themes; accent on bg 8.0 (light) / 8.8 (dark); on-accent on accent 8.0 / 8.8; `--color-border-strong` >= 3.2:1 for control boundaries. `--color-border` is a decorative hairline only. Focus ring is 2px accent (>= 8:1 on bg).
- Motion: `--motion-*` tokens collapse to 0.01ms under `prefers-reduced-motion`, plus a blanket override for animations and transitions. Components should use the tokens (`--motion-reveal` is meant for the card turn).

Manager: exact edits to `src/app/layout.tsx`
```tsx
import type { Metadata } from "next";
import "./globals.css";
import "@/styles/tokens.css";
import { Shell, fontVariables } from "@/components/shell";

// metadata unchanged

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={fontVariables}>
      <body>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
```
Keep `import "./globals.css"` before the tokens import is fine, but see below so nothing fights the tokens.

Manager: `src/app/globals.css` changes
- Delete the `body { font-family: Georgia...; background: #faf8f5; color: #1a1a1a; }` rule (tokens.css now owns it, with dark mode). Keep the `html, body { margin:0; padding:0 }` rule or drop it (tokens sets body margin 0).
- In `.placeholder`, change `min-height: 100vh` to something like `min-height: 60vh`, since the page now sits inside the Shell and would otherwise scroll. The h1 rule can stay or be removed.

Contracts other tickets rely on
- Use tokens, not literals: `var(--color-*)`, `--space-*`, `--text-*`, `--font-display|text|ui`, `--radius-*`, `--motion-*`, `--ease-*`, `--size-touch`, `--measure`.
- `import { Shell, fontVariables } from "@/components/shell"`; `ShellProps = { children; side?; sideLabel? }`. Pages should not render their own `<main>`; the Shell provides it.
- Do not add a second `<h1>` wordmark; the wordmark is a link, not a heading. Each page owns its own `<h1>`.

Verification
- `npm run typecheck`, `npm run lint`, `npm run build` pass in the repo. Because layout.tsx does not yet import the shell, I also built a scratch copy (in the session scratchpad, not the repo) with the layout edits above using `next build --webpack`: it compiled, prerendered, preloaded the fonts and emitted the three font variables. Turbopack build of that copy failed only because node_modules was symlinked into it (a copy artifact, not a code issue).
- No jsdom, so no render tests. No Qloo calls, no secrets, no Qloo data.

Known gaps
- No theme toggle UI (system preference only; `data-theme` override is ready for one).
- No live visual check in a browser; design-reviewer should look at it once layout.tsx is wired. Dark and light accent hues are my pick and easy to change in one place.
- `next/font/google` needs network at build time (works here). If the build environment is offline, switch `fonts.ts` to `next/font/local` with font files in the repo.
