# CLAUDE.md

Persistent context for Claude Code. Keep this file short — it is prepended to every session, so every line costs tokens forever. Prune anything that stops being true.

---

## Project

Season-long sports prediction game for private friend groups. Cricket-first. Free-to-play, no money, no prizes, ever.

Full specs live in `docs/`. **Do not read all of them.** Read only the section named in the task.

| File | Contains |
|---|---|
| `docs/00-PROJECT-BRIEF.md` | Vocabulary, constraints, naming |
| `docs/01-PRD.md` | Features, flows, scoring rules, edge cases |
| `docs/02-TECH-STACK-OPTIONS.md` | Stack rationale and cost model |
| `docs/03-DATA-MODEL-AND-API.md` | Schema, API surface, scoring engine spec |
| `docs/04-BUILD-PLAN.md` | Milestones |

## Stack

Vite + React + React Router (framework mode, SPA) · TypeScript strict · Tailwind + shadcn/ui · TanStack Query · Vercel Functions (REST, Zod-validated) · Drizzle + `@neondatabase/serverless` · Vitest · Satori for share cards · pnpm

## Non-negotiable rules

1. **Scoring engine is pure.** `src/lib/scoring/` does no I/O, no DB access, no `Date.now()`. Time and data are inputs.
2. **The database is expensive.** Neon free tier is 100 CU-hours/month. Reads hit `standings_snapshot` or a cache — never a computed join. Add `Cache-Control` to public GET endpoints.
3. **Lock state is computed from timestamps on read.** Never depend on a cron job for correctness.
4. **`StandingsProvider` is the only path to sports data.** No scoring or UI code calls an external API directly.
5. **No gambling vocabulary.** Not in code, comments, or copy. Use: group, season, slate, question, pick, lock, settlement, projected standings. Never: bet, odds, stake, wager, pool, market, tip, payout.
6. **Picks are invisible before lock**, enforced server-side in the query layer, with a test.
7. **Write the test before the resolver** for every question type.

## Code standards

- TypeScript strict; no `any`; no non-null assertions without a comment explaining why
- Zod schemas in `src/lib/schemas/`, shared by client and server. Parse at every boundary
- Named exports only, except React route components
- Errors: typed `Result` returns in the scoring engine; thrown `AppError` with a status code in API routes
- No barrel files (`index.ts` re-exports) — they hurt tree-shaking and create import cycles
- Comments explain *why*, never *what*
- No new dependency without asking first

## Layout

```
src/
  lib/scoring/          pure engine — resolvers/, boldness.ts, index.ts
  lib/schemas/          zod, shared
  lib/db/               drizzle schema + queries
  lib/providers/        StandingsProvider implementations
  routes/               React Router routes
  components/           ui/ (shadcn) + feature components
api/                    Vercel functions
docs/                   specs
seed/                   fixture JSON
```

## Git

- Work on `develop`. Never commit to `main`.
- Branch per milestone: `feat/m3-picks`. PR into `develop`.
- Conventional commits: `feat:`, `fix:`, `test:`, `chore:`, `docs:`, `refactor:`
- Commit at each working checkpoint, not at the end of a session
- Never commit `.env`, secrets, or `node_modules`

## Commands

```
pnpm dev            # vite dev server
pnpm test           # vitest run
pnpm test:watch
pnpm typecheck      # tsc --noEmit
pnpm lint
pnpm db:generate    # drizzle-kit generate
pnpm db:migrate
pnpm db:seed
```

## Working style

- Plan before editing when a task spans more than two files. Show the plan, wait for approval.
- Prefer editing existing files over creating new ones.
- Do not write summary markdown files unless asked.
- If a spec is ambiguous, ask rather than guess.
- Stop and report if a task turns out to be larger than described.
