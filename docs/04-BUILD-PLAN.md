04 — Build Plan
Sequenced milestones, each ending in something demonstrable. Written so each milestone can
be a single Claude Code session with a clear definition of done.




Ground rules for the whole build
Give these to Claude Code at the start of every session:

   1.​ The scoring engine is pure. No I/O, no database, no Date.now() inside it. Time and
       data are inputs.
   2.​ The database is expensive. Every read path should hit standings_snapshot or a
       cache, not a computed join. Assume the Neon free-tier compute meter is the binding
       constraint.
   3.​ Lock state is computed from timestamps on read, never dependent on a scheduled
       job firing.
   4.​ The StandingsProvider interface is sacred. No scoring or UI code may call an
       external sports API directly.
   5.​ No gambling vocabulary anywhere — not in code, not in comments, not in UI copy.
       Use the vocabulary table in doc 00.
   6.​ Write the test before the resolver for every question type.
   7.​ Prefer boring solutions. This is a solo-maintained project.




Milestone 0 — Foundations
Goal: an empty but correctly-wired application deployed to Vercel.

   -​   Vite + React + React Router scaffolding, TypeScript strict mode
   -​   Tailwind + shadcn/ui initialised
   -​   Drizzle + @neondatabase/serverless, connected to a Neon project
   -​   Full schema from doc 03 as a migration
   -​   Seed script with tournament, teams, players, and a demo group
   -​   Vercel project connected to GitHub, preview deploys on PR
   -​   GitHub Actions: typecheck, lint, test on every PR
   -​   .env.example committed; DATABASE_URL, INGEST_SECRET, APP_URL

Done when: a deployed URL renders a page that reads a row from Neon.
Milestone 1 — The scoring engine (build this before any UI)
Goal: a fully tested pure function that can score a season.

    -​   Types for Question, Pick, Answer, ResultSet, ScoringConfig
    -​   Resolver interface and registry
    -​   All 10 resolvers from doc 03 §2.3
    -​   Boldness multiplier per doc 03 §2.4
    -​   Projected mode
    -​   Explanation strings for every outcome
    -​   Vitest coverage: one file per resolver, plus every edge case in PRD §4.3
    -​   A golden-file test against a complete tournament fixture

Done when: pnpm test scores a full fixture season and matches a committed expected
output, and every edge case has a passing test.

Why first: it's the product, it's pure, it's testable in isolation, and building it first prevents the UI
from constraining the domain model. It's also the part Claude Code will do best with no
ambiguity.




Milestone 2 — Identity and groups
Goal: people can create a group and join it from a link.

    -​   Anonymous auth: display name → user + session cookie
    -​   Magic-link claim flow (hashed tokens, single use)
    -​   Create group; generate slug and join code
    -​   Invite link and join-by-code
    -​   Group page: members, empty seasons state
    -​   Multi-group home screen
    -​   Admin role, member removal, admin transfer

Done when: you create a group on your phone, send the link to yourself on another device, and
join as a second member in under 30 seconds.

Watch for: the join flow is where adoption is won or lost. If it takes more than three taps from
opening the link, simplify it.
Milestone 3 — Slate and picks
Goal: a complete playable game with manual settlement.

   -​   Tournament catalogue (seeded, not ingested)
   -​   Season creation: pick tournament, select question templates, set lock time
   -​   Custom question builder (type custom — build this now, it's the escape hatch)
   -​   Pick sheet UI: one question per card, autosave, progress indicator
   -​   Answer validation per question type
   -​   pick_history append on every change
   -​   Server-enforced lock; /picks/all returns 403 before lock
   -​   Reveal view after lock
   -​   Admin manual settlement UI
   -​   Final standings using the engine from Milestone 1

Done when: you and one other person can play a complete season end to end — create, pick,
lock, reveal, settle, see final standings — with all data entered by hand.

This is the first genuinely shippable milestone. You could run your cousins' league on this
alone.




Milestone 4 — Live data and projected standings
Goal: the leaderboard updates itself during a tournament.

   -​   StandingsProvider interface
   -​   ManualProvider: admin enters the table and stat leaders through a form
   -​   CricketDataProvider: real implementation against the chosen API, behind the same
        interface
   -​   live_state table populated by ingestion
   -​   standings_snapshot recomputation after each ingestion
   -​   Ingestion endpoint guarded by INGEST_SECRET
   -​   GitHub Actions scheduled workflow calling it
   -​   On-demand TTL refresh as a fallback
   -​   Projected standings UI, visually distinct from settled
   -​   Per-member breakdown: which picks are landing, dead, or contested
   -​   Position-history chart (hand-rolled SVG)
Done when: the daily job runs, the leaderboard changes, and killing the external API entirely
still leaves the app functional via ManualProvider.

Test explicitly: what the app does when the provider returns garbage, times out, or returns a
partial table. The answer should be "keeps serving the last good snapshot," not "shows a
broken leaderboard."




Milestone 5 — Share cards and the growth loop
Goal: the product spreads through WhatsApp without you asking it to.

   -​   Satori-based card generation: reveal, standings, swing, recap
   -​   Group name and join link on every card
   -​   Immutable URLs with a timestamp segment; long-lived cache headers
   -​   Native share sheet integration (navigator.share) with a download fallback
   -​   Weekly digest generation
   -​   Open Graph tags on invite pages so the link preview in WhatsApp is attractive

Done when: someone in your group shares a card without being prompted.

Design note: these cards are the most important visual surface in the product. They will be
seen far more often than the app itself. Treat them as the primary design artifact, not an
afterthought.




Milestone 6 — Polish and second season
Goal: the group comes back.

   -​   All-time cross-season standings per group
   -​   Season archive: past slates, best and worst calls, hall of fame
   -​   Comments per question and a general thread
   -​   Email weekly digest (optional, free-tier provider)
   -​   Empty states, loading states, error states throughout
   -​   Rules and scoring explainer page — people will dispute scores; pre-answer them
   -​   Accessibility pass: keyboard navigation, focus states, contrast

Done when: a group that finished one tournament starts a second without you intervening.
Post-v1 backlog (do not build yet)
Ordered by my guess at value:

   1.​ Mid-season transfer window — your original frustration. A limited number of pick
       changes at a points cost. Complicates boldness and the audit trail; worth doing properly
       rather than quickly.
   2.​ Football/FIFA support — proves the multi-sport thesis and fixes the seasonality
       problem
   3.​ Web push notifications
   4.​ Draft mode — no two members can pick the same champion
   5.​ Public groups and a global leaderboard
   6.​ Per-match side predictions for groups that want more engagement
   7.​ AI season recap — a written summary of the season's drama, generated from the data




Verification checklist before your first real season
Run through this two weeks before a tournament starts. Do not skip it — a bug during a live IPL
is unrecoverable, because the season only happens once.

      ​ Picks genuinely invisible before lock — verified by inspecting the network tab as a
        second member
      ​ Lock fires correctly with the server in UTC and members in IST and CST
      ​ Scoring engine reproduces a known past tournament exactly
      ​ Provider failure degrades to the last good snapshot, not an error page
      ​ ManualProvider can fully replace the API mid-season
      ​ Ingestion job is idempotent — running it twice changes nothing
      ​ Share cards render correctly on iOS Safari, Android Chrome, and in a WhatsApp link
        preview
      ​ Neon compute usage over a simulated week projects under the monthly quota
      ​ Vercel usage dashboard shows headroom on all metrics
      ​ A member who joins after lock is handled correctly and excluded from boldness
      ​ A member who submits zero picks doesn't break standings
      ​ Admin override works on a settled question and recomputes correctly
Suggested session prompts for Claude Code
Rough shapes, to adapt:

      Milestone 1: "Read docs/03-DATA-MODEL-AND-API.md §2. Implement the
      scoring engine in src/lib/scoring/ as a pure function. Start with the types and
      the resolver registry, then implement the champion and top_n_unordered
      resolvers with full Vitest coverage including the edge cases in docs/01-PRD.md
      §4.3. Do not touch the database."

      Milestone 3: "Read docs/01-PRD.md §2.4 and §7.3, and
      docs/03-DATA-MODEL-AND-API.md §3.4. Implement the pick submission flow.
      The critical requirement is that /api/seasons/:id/picks/all returns 403
      before lock_at, compared against the server clock. Write the integration test for
      that case first."

      Milestone 4: "Read docs/02-TECH-STACK-OPTIONS.md §4.3. Implement the
      StandingsProvider interface with a ManualProvider implementation only. No
      external API calls yet. Then wire the ingestion endpoint and the
      standings_snapshot recomputation."

Keeping each session narrow and pointing at a specific document section will get much better
results than describing the whole app each time.
