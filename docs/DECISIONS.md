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
| Git remote policy for this autonomous run | Commit locally per `feat/mX` branch convention. Do **not** push or open PRs — user reviews and pushes manually |
| Session 14 (design implementation) | Deferred — doc 05 (Claude Design reference) was never provided. Skip this session for now |
| Group size limits, hosting region | Not constrained by the docs; no artificial limit added unless it becomes a real cost/perf concern |

## Doc → repo section map

`docs/00-PROJECT-BRIEF.md` through `docs/04-BUILD-PLAN.md` are plain-text extractions of the original PDFs (`pdftotext -layout`), kept for cheap `grep`/section citation. Section numbers (`§1`, `§4.2`, etc.) match the originals.
