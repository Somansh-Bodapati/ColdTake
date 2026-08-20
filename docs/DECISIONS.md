# Decisions

Choices the docs left open (marked `[DECISION]` or unspecified), resolved with the product owner on 2026-08-18 so later sessions don't need to re-ask. Not a spec — the docs are still the source of truth for everything else.

| Question | Decision |
|---|---|
| Product name | ColdTake (matches repo, CLAUDE.md) |
| Auth model (doc 01 §7.1) | Anonymous-first: display name creates user + session cookie; magic link later attaches email and claims the account (already specified in the session 5 brief) |
| Bold-pick multiplier default (doc 01 §4.2) | **On** by default |
| Standings refresh cadence (doc 01 §5) | On-demand with snapshot write, triggered by ingestion — not a fixed daily cron (matches session 9/10 briefs) |
| Injured-player scoring edge case (doc 01 §4.3) | Follow the doc's own stated recommendation when implementing settlement (session 12) |
| Cricket data vendor (doc 02 §4.2, session 11) | No vendor account yet. Build `CricketDataProvider` modeled on CricketData.org's response shape (doc's most-favored option) but driven entirely by recorded fixtures in tests. Real API key wired in later by the user |
| Email provider (session 5) | None wired yet — magic-link tokens are logged/stored, not emailed, until a provider is chosen |
| Vercel/Neon accounts | Not provisioned yet. Local dev uses a Dockerized Postgres; `DATABASE_URL` swaps to a real Neon connection string at deploy time — schema/queries stay driver-compatible (`@neondatabase/serverless` over plain `pg` for local) |
| Git remote policy for this autonomous run | Commit locally per `feat/mX` branch convention through session 16. Doc 05 landed and the user asked to finish and push everything (2026-08-20) — session 14 now proceeds and all commits get pushed to `origin/develop` |
| Session 14 (design implementation) | Doc 05 (`docs/05-DESIGN-PROMPT.md`, converted from the `.docx` the user dropped in `Documents/`) arrived 2026-08-20. It's a *design brief for Claude Design*, not finished screens/tokens — no Figma file or visual reference exists. Implemented directly in code from the brief's own direction (mobile-first, editorial-sports-magazine or scoreboard visual language, dark-default, never-confuse-projected-with-final) using the frontend-design skill, scoped to the original session-14 screen list (invite landing, name entry, multi-group home, pick sheet, leaderboard) plus the standings share card, since the brief calls those two out as the ones to get right above all else |
| Group size limits, hosting region | Not constrained by the docs; no artificial limit added unless it becomes a real cost/perf concern |

## Doc → repo section map

`docs/00-PROJECT-BRIEF.md` through `docs/04-BUILD-PLAN.md` are plain-text extractions of the original PDFs (`pdftotext -layout`), kept for cheap `grep`/section citation. Section numbers (`§1`, `§4.2`, etc.) match the originals.
