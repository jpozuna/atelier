# Atelier

Atelier helps people develop taste, not just feed it. A user shares what they love and why. The app draws their taste as a profile on an attribute chart, then suggests picks from other fields at the outer edge of that profile: unfamiliar but connected. Every pick shows the path back to the user and why it was chosen. The agent has no taste of its own. It is grounded in Qloo's taste graph and is an instrument for developing the user's.

Built for the Qloo Agentic Hackathon. Audience: creatives and students stuck in recommendation loops who want a point of view.

Brief: docs/BRIEF.md. Decisions and open questions: docs/DECISIONS.md (it overrides the brief where they differ).

## Key dates (ET)

- Oct 19: API spike done, domain list locked
- Oct 25: feature freeze. After this, only fixes, polish and docs
- Oct 29: target submit. Oct 30, 11:45 pm: hard deadline
- Nov 16, 11:45 pm: demo must stay free and working until judging ends. The hackathon key is active through the end of judging and deactivated after the hackathon closes, so live Qloo calls stop after that

## Stack

Next.js (App Router) + TypeScript, Supabase (auth + Postgres), Anthropic API for the agent's LLM calls (model id from env var `ATELIER_MODEL`).

## Hard rules

1. **One door to Qloo.** All Qloo calls go through `src/lib/qloo/client.ts`. `/v2/insights` by POST with a JSON body (`signal.interests.entities` as `[{id, weight}]`); `/search`, `/v2/tags` and `/entities` by GET. `X-Api-Key` header, host from `QLOO_BASE_URL` (must be `hackathon.api.qloo.com`; staging and production return 401). Never use `/recommendations` or `/recs` (legacy). Server-side only. The key never reaches the client bundle and never goes in a `NEXT_PUBLIC_*` variable. Request URLs and bodies carrying ids are logged only inside `.qloo-private/`.
2. **Params are validated before sending.** Every `/v2/insights` param must be `listed` or `confirmed` for that entity type in `src/lib/qloo/registry.ts` (seeded from the official Entity Type Parameter Guide). The client throws on anything else, including params the Parameter Reference mentions but the per-type guide does not list, until the spike confirms them. Qloo silently ignores invalid params and the result looks fine but is wrong.
3. **No Qloo response data in tracked files.** That means entity names, entity IDs, tag IDs, raw JSON, and screenshots showing picks. Fixtures are synthetic: invented names, IDs shaped `00000000-0000-4000-8000-0000000000NN`. Raw recordings and spike output go in `.qloo-private/` (gitignored). The only cache of Qloo data is server-side and private.
4. **Picks come from the frontier: connected and far.** Never fill with random picks or popular safe picks. If the frontier is empty, relax reach before connection. The connection floor never drops.
5. **Every pick has a stored path** (seed -> shared theme -> [lineage hop] -> pick). The explanation is generated from that path only.
6. **Sourced and inferred never merge.** Lineage and symbolism come only from retrieved text, are labeled a reading, and are omitted when nothing is retrieved.
7. **No taste scores, rankings or audience metrics** anywhere in the product.
8. **Code computes, the model chooses and explains.** Reach, connection and popularity checks are computed in code. The LLM picks themes, decides on re-queries given those computed signals, and writes explanations.
9. **Never push, deploy or publish** unless the user says so.
10. **Qloo calls are budgeted.** The key allows 10,000 calls a month (5 per second) and must last through judging. Dev and evals run from cache or replay by default. Before any live run (scripts, evals, manual tests), print the number of live calls it will make (`--dry-run`) and get the user's OK. A new profile run makes at most 12 live calls; a repeat view makes 0. Rules are in the `qloo-api` skill under "Call budget".

## Layout and ownership

Tickets must not share an `Owns` path. Files marked shared belong to the manager or to a foundation ticket.

| Path | Holds | Notes |
|---|---|---|
| `src/app/` | routes, pages, route handlers | one ticket per route group |
| `src/components/` | UI components | `chart/` is its own ticket |
| `src/lib/qloo/` | client, registry, private cache | `registry.ts` shared, manager-only after the spike |
| `src/lib/agent/` | loop, tool definitions | `config.ts` (tunable constants) shared |
| `src/lib/profile/` | tags -> axes | |
| `src/lib/frontier/` | reach, connection, dial | |
| `src/lib/refs/` | reference layer (lineage, readings) | |
| `src/types/` | shared contracts | shared, foundation ticket only |
| `supabase/migrations/` | schema | one ticket, sequenced |
| `src/styles/tokens.css` | design tokens | shared |
| `evals/` | scorers, judges, synthetic fixtures, runner | eval tickets |
| `scripts/` | spike and tooling scripts | outputs never committed |
| `docs/`, `tickets/` | planning | manager |
| `.qloo-private/` | recordings, spike output, eval runs | gitignored, never committed |

Other shared files: `package.json`, lockfile, `next.config.*`, `tsconfig.json`, `.env.example`, root `layout.tsx`.

## Commands

Reviewers and test-writers run whatever is named here.

- Install: `npm install`
- Dev: `npm run dev` (http://localhost:3000)
- Build: `npm run build`
- Test: `npm test` (Vitest; picks up `src/**/*.test.ts` and `evals/**/*.test.ts`)
- Lint / typecheck: `npm run lint` and `npm run typecheck`
- Evals (synthetic, CI-safe): `npm run evals` (placeholder until T-04)
- Evals (live, local only): `npm run evals:live` (placeholder until T-04)
- Screenshot script (optional, used by design-reviewer): `<fill in>` (not yet written)

## Orchestration specialists

- tests -> `test-writer`
- review -> `code-reviewer`
- research -> `researcher`
- qloo params -> `qloo-param-auditor`
- explanation quality -> `bridge-judge`
- UI -> `design-reviewer`

## Skills in this repo

- `orchestrate` (manual): plan work as tickets and manage workers
- `qloo-api`: how to call Qloo, param registry, data-handling rules
- `atelier-agent-loop`: the loop, reach and connection scoring, path and card contracts
- `atelier-evals`: scorers, judges, fixtures, eval-first workflow
- `atelier-design`: brand, chart, cards, reasoning panel
- `qloo-spike` (manual): the API spike that locks the domain list
- `submission-check` (manual): pre-submit audit against the official rules

## Definition of done

A ticket is done when its `Done when` items hold, repo checks pass, the scorers it names are green, and the manager has committed only its `Owns` paths.
