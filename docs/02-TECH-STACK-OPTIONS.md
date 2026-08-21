02 — Technology Options and the Zero-Cost Budget
Every option presented with trade-offs. Where I have a recommendation I say so and explain
why, but the decision is yours.




1. The two constraints that actually shape the architecture
Before any framework choice, understand these. They are the real design inputs.


1.1 Vercel Hobby
Hobby is restricted to personal, non-commercial use, with roughly 100 GB of Fast Data Transfer,
1 million Edge Requests, 6,000 build-execution minutes, 1 million function invocations, and 4
CPU-hours of active function CPU per month, across up to 200 projects and 100 deployments
per day. When you hit any limit the project pauses rather than billing you — there is no overage
on the free tier.

Two things matter:

   -​   The commercial-use restriction is the binding constraint, not the numbers.
        Anything tied to payment, advertising, or paid work needs Pro. A free-to-play game with
        no revenue is compliant. Keep it that way.
   -​   4 CPU-hours of Active CPU is the number to watch, not invocations. 1,000 users is
        nowhere near 1M invocations, but inefficient server work adds up. Keep functions
        I/O-bound and short.


1.2 Neon free plan — this is your real bottleneck
The Free plan includes 100 projects, 10 branches per project, 100 CU-hours of compute per
project per month, 0.5 GB of storage per project, and 5 GB of public network transfer per project
per month. Computes scale to zero after 5 minutes of inactivity and scale up to 2 CU when
active. 100 CU-hours is enough to run a 0.25 CU compute for about 400 hours per project per
month. If CU-hours run out, the project's compute is suspended until the next billing period.

Do the arithmetic, because it's tight. A month is ~730 hours. You get ~400 hours at the
smallest compute size. During an IPL with 1,000 users checking standings throughout the day,
your database will rarely idle for the 5 minutes required to scale to zero. You can plausibly
exhaust the free tier mid-tournament and have your database suspended during the final.

This single fact should drive your entire data strategy:
      The database must be touched as rarely as possible. Reads should be served
      from cache; the DB should be the write path and the cold source of truth, not
      the read path.

Concretely: cache the leaderboard, cache the standings, cache the group page. A leaderboard
that changes once a day has no business hitting Postgres on every page view.

Neon's free tier is commercial-use-permitted and never expires, so the plan itself is fine — it's
the compute meter you have to respect.




2. Frontend
You've specified React + Vite. Options within that.


2.1 Routing
 Option                           Pros                             Cons

 React Router (framework          Mature, huge community,          More concepts to learn if
 mode)                            loaders/actions give you         you've only used React
                                  data-fetching structure, can     Router as a routing library
                                  deploy as SPA or SSR

 TanStack Router                  Best-in-class type safety,       Smaller community, fewer
                                  excellent search-param           examples for Claude Code to
                                  handling (useful for share       draw on
                                  links)

 Plain React Router               Simplest; you probably           You hand-roll all data fetching
 (declarative, SPA only)          already know it


Consideration: share cards need server-rendered OG images. If your frontend is a pure SPA
on Vercel and your API is serverless functions, that works fine — the OG image route is just
another function. You don't need SSR for this.

Recommended: React Router in framework mode, deployed as an SPA, unless you want SEO
on public invite pages — in which case enable SSR for those routes only.
2.2 Styling
 Option                        Pros                             Cons

 Tailwind CSS                  Fastest iteration, Claude        Verbose markup; needs
                               Code writes it extremely well,   discipline to extract
                               no naming decisions, tiny        components
                               production CSS

 CSS Modules                   Plain CSS, no build magic,       Slower to iterate; more files
                               scoped

 Vanilla Extract               Type-safe, zero-runtime          Smaller ecosystem, more
                                                                setup


Recommended: Tailwind. This app is visual-design-heavy (share cards, leaderboards, charts)
and Tailwind plus a component library will get you further faster than anything else.


2.3 Component library
 Option                        Pros                             Cons

 shadcn/ui                     You've used it before; you       You maintain the
                               own the code; excellent          components; not a drop-in
                               defaults; works perfectly with   dependency
                               Tailwind; Claude Code knows
                               it well

 Radix primitives directly     Maximum control, full            You style everything from
                               accessibility                    scratch

 Mantine / Chakra              Batteries included               Opinionated styling that fights
                                                                a custom design

 None                          Total control                    You will spend a week on a
                                                                dropdown


Recommended: shadcn/ui. Your prior experience with it is worth more than any marginal
advantage elsewhere.
2.4 Data fetching and state
 Option                           Pros                             Cons

 TanStack Query                   Caching, background refetch,     One more library
                                  stale-while-revalidate —
                                  which is exactly the pattern
                                  that protects your Neon quota

 SWR                              Lighter, same core idea          Fewer features

 Router loaders only              No extra library                 No client-side cache; more
                                                                   DB hits

 Redux / Zustand                  Global state                     This app has very little client
                                                                   state; overkill


Recommended: TanStack Query with aggressive staleTime. Set standings to a 10-minute
stale time and you've cut database reads by an order of magnitude. This is a cost decision as
much as an architecture one.


2.5 Charts (for position history)
 Option                           Pros                             Cons

 Recharts                         React-native API, easy,          Larger bundle; limited
                                  you've likely used it            customisation

 visx                             Composable, small, beautiful     Lower level, more work

 Hand-rolled SVG                  Zero dependency, full control,   You build tooltips and axes
                                  and a position chart is          yourself
                                  genuinely simple (a few
                                  polylines)


Recommended: hand-rolled SVG for the position chart specifically. It's ~100 lines, it'll look
better than a generic chart library, and it keeps the bundle small.
3. Backend

3.1 Where the API lives
 Option                        Pros                            Cons

 Vercel Functions in the       One deploy, one repo, zero      Coupled; cold starts
 same repo (/api routes)       CORS, simplest possible
                               setup

 Next.js instead of Vite       Server components, built-in     You explicitly want Vite
                               OG image generation, route      practice — this contradicts
                               handlers                        your goal

 Separate FastAPI service      You know FastAPI; better for    Second deploy; free tiers on
 (Railway/Fly free tier)       the scheduled ingestion job;    these platforms are less
                               Python's data handling is       generous and more likely to
                               nicer                           change; adds cost risk

 Cloudflare Workers            Extremely generous free tier;   Different runtime constraints;
                               fast; good for the read-cache   another platform to learn
                               layer


Recommended: Vercel Functions alongside the Vite app. It keeps everything on the platform
you've already committed to and eliminates a class of problems.


3.2 API style
 Option                        Pros                            Cons

 REST with typed contracts     Simple, cacheable via HTTP,     You write the types
 (Zod schemas shared           easy to debug, works with
 between client and server)    CDN caching — which
                               matters for your quota

 tRPC                          End-to-end type safety with     Harder to CDN-cache;
                               no codegen; excellent DX        couples client and server
                                                               tightly

 GraphQL                       Flexible                        Massive overkill here
Recommended: REST + Zod. The CDN-cacheability point is decisive given the Neon constraint
— you want Cache-Control headers on your standings endpoint, and that's awkward with
tRPC.


3.3 Database access
 Option                           Pros                             Cons

 Drizzle ORM                      Lightweight, SQL-like,           Smaller ecosystem than
                                  excellent TypeScript             Prisma
                                  inference, fast cold starts,
                                  great migration story

 Prisma                           Best-known, great DX, strong     Heavier cold starts in
                                  tooling                          serverless; historically a real
                                                                   issue on Vercel

 Kysely                           Pure query builder, very         No migrations built in
                                  type-safe, minimal

 Raw SQL +              Zero abstraction, minimal                  You hand-write everything
 @neondatabase/serverle bundle, fastest
 ss


Recommended: Drizzle with the Neon serverless driver. The `@neondatabase/serverless`
driver is optimised for serverless environments with connection pooling built in — use it rather
than a standard Postgres client, which will exhaust connections.


3.4 Caching layer — the most important decision for cost
 Option                           Pros                             Cons

 HTTP Cache-Control +             Free, zero infrastructure, and   Only works for public/shared
 Vercel CDN                       edge requests are far            responses; per-user data
                                  cheaper than function            can't be CDN-cached
                                  invocations

 Upstash Redis free tier          Real cache with a generous       Another vendor; free-tier
                                  free allowance; good for         limits to verify
                                  computed standings

 In-memory cache in the           Free, trivial                    Useless — serverless
 function                                                          instances don't persist
                                                                   reliably
 Option                         Pros                               Cons

 Materialised snapshot table    Standings computed once            Still touches Postgres, but
 in Postgres                    daily and stored as a single       one cheap read instead of a
                                row of JSON; reads become          complex aggregate
                                one tiny indexed query

 Static JSON regenerated on Genuinely free; near-zero DB           Stale by design; awkward for
 a schedule and served from load                                   per-member views
 the CDN


Recommended stack: materialised standings snapshot in Postgres plus HTTP caching on the
endpoint that serves it. The combination means a page view costs one indexed row read at
worst, and usually nothing at all.




4. Sports data — the critical external dependency

4.1 The insight that saves you money
You do not need ball-by-ball data. A season-slate game needs: the league table, the stat
leaders, and final results. That is one poll per day, not thousands. Design around this
deliberately — it's what makes a free or near-free data plan viable.


4.2 Provider options
 Provider                       Notes                              Cost posture

 Manual admin entry             Admin types the table and          Free
                                stat leaders. Sounds
                                primitive; is actually a robust
                                fallback and lets you ship
                                week 1 with zero dependency

 CricketData.org (formerly      Positioned as a free-to-use,       Free tier exists — verify
 CricAPI)                       high-bandwidth cricket API         current limits directly
                                covering live scores,              before relying on it
                                scorecards, ball-by-ball, plus
                                supporting data like player
                                lists and flags; advertises free
 Provider                       Notes                            Cost posture

                                access at high hourly request
                                limits

 CricBuzz API via               API key immediately with no      Paid — breaks your
 API.market                     sales call, 7-day free trial,    constraint
                                pricing from $19.99/month,
                                covering live scores, player
                                data, series, stats and
                                rankings

 EntitySport                    IPL-specific endpoints with      Pricing not public
                                schedules, live scores, team
                                and player statistics, and
                                historical data; proven at IPL
                                scale

 Roanuz                         Push-based real-time data        Paid
                                with a strong fantasy API for
                                Indian platforms

 Sportmonks                     14-day trial, 140+ leagues —     Paid after trial
                                relevant if you expand to
                                football

 Sportradar                     Enterprise contracts only, no    Not viable
                                public pricing

 Scraping                       Free                             Terms-of-service violation,
                                                                 brittle, legally risky. Don't.


4.3 The architectural decision that makes this safe
Build an ingestion adapter interface with multiple implementations.

interface StandingsProvider {

 getTable(tournamentId): TeamStanding[]

 getStatLeaders(tournamentId, category): PlayerStat[]

 getFinalResult(tournamentId): TournamentResult
}

Implementations: ManualProvider (reads from an admin-edited table),
CricketDataProvider, and later others. Ship ManualProvider first. This means:

      -​   Week 1 has zero external dependency
      -​   A provider outage during a final doesn't kill your product — the admin fills in the gap
      -​   You can switch providers without touching scoring logic
      -​   Testing is trivial

This is the single highest-leverage design decision in the project. Do not skip it.


4.4 Ingestion scheduling
    Option                           Pros                              Cons

    Vercel Cron                      Built in, free on Hobby           Hobby cron frequency is
                                                                       restricted — verify the
                                                                       current limit; historically it
                                                                       was limited to daily
                                                                       invocations on the free plan

    GitHub Actions scheduled         Free for public repos and         Runs outside your app;
    workflow                         generous for private; calls a     needs a shared secret;
                                     protected endpoint on your        scheduled Actions on inactive
                                     app; full control over            repos get disabled after ~60
                                     frequency; you already use        days
                                     GitHub

    On-demand refresh with a         No scheduler at all; refreshes    First visitor pays the latency
    TTL                              when someone actually looks

    External free cron               Free, flexible frequency          Third-party dependency
    (cron-job.org etc.)


Recommended: GitHub Actions as the primary scheduler with an on-demand TTL refresh as a
fallback. Actions gives you flexible frequency for free and fits your existing tooling. Guard the
ingestion endpoint with a bearer secret.
5. The zero-cost budget model
Sanity-check for 1,000 users, 5 tournaments/year, assuming a tournament runs ~8 weeks.


Storage (Neon: 0.5 GB)
 Table                            Rows at scale                   Est. size

 users / members                  ~1,500                          < 1 MB

 groups                           ~150                            < 1 MB

 seasons                          ~500                            < 1 MB

 picks                            1,000 users × 12 questions ×    ~10 MB/yr
                                  5 seasons = 60,000/yr

 standings snapshots              5 tournaments × 60 days × 1     < 5 MB
                                  row

 comments                         assume 20,000/yr                ~5 MB

 Total year one                                                   ~25 MB


Verdict: storage is a non-issue. You have 20× headroom. Only risk is if you store raw API
responses — don't, or prune them aggressively.


Compute (Neon: 100 CU-hours/month) — the actual risk
The danger is the database never idling. Mitigations, in order of impact:

   1.​ Serve standings from a snapshot row, not a computed aggregate
   2.​ HTTP-cache the standings endpoint with a several-minute TTL so most requests
       never reach a function
   3.​ TanStack Query staleTime so the client doesn't refetch on every navigation
   4.​ Batch the daily ingestion into a single connection, single transaction
   5.​ Accept the cold start. A cold start after scale-to-zero costs 500ms–2s. For a game
       people check a few times a day, that's fine — do not pay to keep the compute warm.

Honest assessment: at 1,000 active users during a live IPL, this is achievable but not
comfortable. If you exceed it, options are (a) Neon Launch at usage-based pricing, which for this
workload would likely be single-digit dollars per month, or (b) move reads to a cache layer
entirely. Neon's paid plans now have no monthly minimum and bill purely on usage, so the
failure mode is a small bill rather than a cliff.


Bandwidth (Vercel: 100 GB; Neon: 5 GB egress)
Share-card images are the main consumer. A 200 KB card × 50,000 views = 10 GB.
Comfortable, but cache the images hard (they're immutable once generated).


Sports data
Free tier if CricketData.org's limits hold; otherwise manual entry costs nothing. Design so that
either works.


Everything else
GitHub (free), Vercel Hobby (free, non-commercial), Neon (free), domain (~$10–15/year — your
only guaranteed cost, and optional if you accept a *.vercel.app URL).




6. Share-card image generation
 Option                           Pros                             Cons

 Satori / @vercel/og              Purpose-built, fast, runs in     Supports a CSS subset — no
                                  edge runtime, no browser         arbitrary layouts, careful with
                                                                   fonts

 Headless Chromium                Pixel-perfect, any CSS           Heavy, slow, likely blows past
 (Puppeteer)                                                       function limits on Hobby

 Server-side canvas               Full control                     Manual layout, painful for text
 (node-canvas, resvg)

 Client-side canvas +             Zero server cost                 User must manually save and
 download                                                          share; worse UX


Recommended: Satori. Design the cards within its constraints from the start — flexbox only, no
grid, embedded fonts, no external images unless base64-inlined. Cache generated cards
aggressively with a long-lived immutable header; a card for a given season and date never
changes.
7. Testing
 Layer                            Tool                              Priority

 Scoring engine                   Vitest, pure unit tests with      Critical. This is where bugs
                                  fixture data                      cost you credibility. Every
                                                                    question type, every edge
                                                                    case in PRD §4.3, with a
                                                                    golden-file test per
                                                                    tournament type.

 Ingestion adapters               Vitest with recorded API          High — you don't want live
                                  fixtures                          API calls in CI

 API routes                       Vitest + supertest, or            Medium
                                  Playwright API tests

 UI                               Playwright for the critical       Medium
                                  paths (join → pick → lock)

 Visual regression on share       Playwright screenshots            Low, but pleasant
 cards


If you only test one thing, test the scoring engine. It's pure, it's deterministic, it's the product.




8. Repository and tooling
 Concern                                           Options

 Structure                                         Single repo, src/ and api/ (simplest,
                                                   recommended) · pnpm workspace with
                                                   packages/scoring extracted (cleaner
                                                   boundary, reusable, slightly more setup —
                                                   worth it if scoring gets big)

 Package manager                                   pnpm (fast, disk-efficient) · npm (zero setup)
                                                   · bun (fastest, some ecosystem gaps)

 Migrations                                        Drizzle Kit (matches your ORM) · raw SQL
                                                   files with a runner (full control)
 Concern                                         Options

 CI                                              GitHub Actions: typecheck, lint, test on PR.
                                                 Free.

 Env management                                  Vercel env vars + .env.example
                                                 committed. Never commit secrets.

 Error tracking                                  Sentry free tier (5k errors/month) · console
                                                 logs only (free, useless in production) ·
                                                 Axiom/Better Stack free tiers

 Analytics                                       Umami self-hosted or Plausible free trial ·
                                                 Vercel Web Analytics (Hobby includes a
                                                 limited event allowance) · none




9. Summary recommendation
Stated as one coherent stack, with the understanding that you may deviate:

      -​   Vite + React + React Router (framework mode, SPA) — your stated learning goal
      -​   Tailwind + shadcn/ui — familiar, fast
      -​   TanStack Query with long staleTime — this is a cost control, not just DX
      -​   Vercel Functions, REST, Zod-validated contracts
      -​   Drizzle + @neondatabase/serverless
      -​   Materialised standings snapshot + HTTP caching — the core cost-avoidance pattern
      -​   StandingsProvider interface, ManualProvider first
      -​   GitHub Actions cron for ingestion
      -​   Satori for share cards
      -​   Vitest, with the scoring engine covered exhaustively

The two things I'd argue hardest for: the provider abstraction and the standings snapshot.
Everything else is preference; those two are what make the project survive both a data-provider
failure and the Neon compute meter.
