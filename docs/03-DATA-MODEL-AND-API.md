03 — Data Model, API Surface, and Scoring Engine
Implementation specification. Written to be handed directly to Claude Code.




1. Schema
Postgres. Money-free, so no currency concerns. All timestamps timestamptz, all IDs text
holding a collision-resistant ID (nanoid or cuid2) unless noted.


1.1 Identity
-- A person. May exist without any auth method attached (anonymous play).

user (

    id         text primary key,

    display_name text not null,

    email        text unique,        -- nullable: anonymous users have none

    avatar_seed text not null,          -- deterministic generated avatar

    created_at     timestamptz not null default now(),

    claimed_at     timestamptz           -- set when they attach an email

)

-- Magic link tokens for the claim/login flow.

auth_token (

    id        text primary key,

    user_id     text not null references "user"(id) on delete cascade,

    token_hash text not null,           -- store a hash, never the raw token

    purpose      text not null,       -- 'login' | 'claim'
    expires_at timestamptz not null,

    used_at      timestamptz

)

Note: store only a hash of the magic-link token. If your database leaks, raw tokens would be live
credentials.


1.2 Groups
group (

    id        text primary key,

    name        text not null,

    slug       text not null unique,   -- for pretty URLs

    join_code text not null unique,      -- 6 chars, uppercase, no ambiguous glyphs (no O/0/I/1)

    created_by text not null references "user"(id),

    created_at timestamptz not null default now(),

    archived_at timestamptz

)

member (

    id        text primary key,

    group_id     text not null references "group"(id) on delete cascade,

    user_id     text not null references "user"(id) on delete cascade,

    role      text not null default 'member', -- 'admin' | 'member'

    joined_at timestamptz not null default now(),

    removed_at timestamptz,
    unique (group_id, user_id)

)


1.3 Tournament catalogue (system-owned, not user-editable)
tournament (

    id          text primary key,            -- e.g. 'ipl-2027'

    sport         text not null,            -- 'cricket' | 'football' | ...

    name           text not null,            -- 'Indian Premier League 2027'

    short_name           text not null,          -- 'IPL 2027'

    starts_at      timestamptz not null,

    ends_at         timestamptz,

    status        text not null,            -- 'upcoming' | 'live' | 'completed' | 'abandoned'

    team_count           int not null,

    provider_key text,                       -- external ID for the data provider

    config        jsonb not null              -- sport-specific: stat categories available, playoff format

)

team (

    id          text primary key,

    tournament_id text not null references tournament(id) on delete cascade,

    name          text not null,

    short_name       text not null,              -- 'CSK'

    color        text,                    -- brand hex, for the UI
    provider_key text

)

player (

    id         text primary key,

    tournament_id text not null references tournament(id) on delete cascade,

    team_id       text references team(id),

    name         text not null,

    role       text,               -- 'batter' | 'bowler' | 'allrounder' | 'keeper'

    provider_key text

)

Squad churn caveat: in cricket, players move between teams and squads are announced late.
player.team_id is a point-in-time convenience, not a fact to score against. Never make
scoring depend on it.


1.4 Seasons and slates
-- One group playing one tournament.

season (

    id         text primary key,

    group_id       text not null references "group"(id) on delete cascade,

    tournament_id text not null references tournament(id),

    name          text not null,       -- usually the tournament short_name

    lock_at      timestamptz not null,

    status       text not null,       -- 'draft' | 'open' | 'locked' | 'settled' | 'voided'

    scoring_config jsonb not null,          -- { boldPickEnabled: bool, injuryRule: 'zero'|'void' }
    member_snapshot jsonb,                      -- array of member_ids, frozen at lock. Drives boldness.

    created_at      timestamptz not null default now(),

    settled_at     timestamptz,

    unique (group_id, tournament_id)

)

question (

    id       text primary key,

    season_id       text not null references season(id) on delete cascade,

    type         text not null,         -- 'champion' | 'runner_up' | 'top_n_unordered' |

                                   -- 'top_n_ordered' | 'wooden_spoon' | 'stat_leader' |

                                   -- 'team_over_under' | 'numeric' | 'boolean' | 'custom'

    prompt        text not null,          -- display text, e.g. 'Who wins the Orange Cap?'

    config       jsonb not null,          -- type-specific: { n: 4 } | { statCategory: 'runs' } |

                                   -- { options: [...] } for custom

    points       int not null,

    sort_order     int not null,

    settlement     text not null,          -- 'auto' | 'manual'

    created_at      timestamptz not null default now()

)

pick (

    id       text primary key,
    question_id text not null references question(id) on delete cascade,

    member_id       text not null references member(id) on delete cascade,

    answer        jsonb not null,           -- { teamId } | { teamIds: [...] } | { playerId } |

                                   -- { value: 42 } | { bool: true } | { optionId }

    submitted_at timestamptz not null default now(),

    updated_at      timestamptz not null default now(),

    unique (question_id, member_id)

)

-- Append-only audit of every pick change. Never deleted.

pick_history (

    id        bigserial primary key,

    pick_id     text not null,

    answer       jsonb not null,

    recorded_at timestamptz not null default now()

)


1.5 Results and standings
-- Immutable facts about what actually happened. Never updated in place.

result (

    id         text primary key,

    tournament_id text not null references tournament(id) on delete cascade,

    kind        text not null,          -- 'final_table' | 'stat_leaders' | 'final_result'

    payload       jsonb not null,
    source        text not null,        -- 'manual' | 'cricketdata' | 'admin_override'

    is_final     boolean not null default false,

    recorded_at timestamptz not null default now(),

    recorded_by text                    -- user_id if manual

)

-- Current in-season state, overwritten on each ingestion. One row per tournament.

live_state (

    tournament_id text primary key references tournament(id) on delete cascade,

    table_data     jsonb not null,        -- [{ teamId, played, won, lost, points, nrr, position }]

    stat_leaders jsonb not null,           -- { runs: [{playerId, value}], wickets: [...], sixes: [...] }

    source        text not null,

    fetched_at     timestamptz not null

)

-- The materialised leaderboard. THIS is what the app reads. Recomputed after ingestion.

standings_snapshot (

    id         bigserial primary key,

    season_id      text not null references season(id) on delete cascade,

    is_projected boolean not null,          -- true during season, false once settled

    standings     jsonb not null,         -- [{ memberId, rank, points, delta, breakdown: [...] }]

    computed_at timestamptz not null default now()

)
create index on standings_snapshot (season_id, computed_at desc);

Why standings_snapshot exists: it is the single most important performance and cost
decision in the schema. Every leaderboard page view becomes one indexed row read of a
JSON blob, instead of a join across picks, questions, results, and members. Given the Neon
compute constraint, this is not optional.


1.6 Social
comment (

    id      text primary key,

    season_id text not null references season(id) on delete cascade,

    question_id text references question(id) on delete cascade, -- null = general thread

    member_id text not null references member(id) on delete cascade,

    body     text not null,

    created_at timestamptz not null default now(),

    deleted_at timestamptz

)


1.7 Indexes worth creating explicitly
create index on member (group_id) where removed_at is null;

create index on member (user_id);

create index on pick (question_id);

create index on question (season_id, sort_order);

create index on season (group_id, status);

create index on comment (season_id, created_at desc);
2. Scoring engine specification
Lives in src/lib/scoring/. Pure. No I/O. No database access. No date-now.


2.1 Signature
type ScoringInput = {

    questions: Question[]

    picks: Pick[]

    results: ResultSet       // final table, stat leaders, final result

    config: ScoringConfig

    memberIds: string[]        // the frozen snapshot from season.member_snapshot

    isProjected: boolean

}

type ScoringOutput = {

    standings: Array<{

     memberId: string

     rank: number

     points: number

     breakdown: Array<{

      questionId: string

      awarded: number

      maxPossible: number

      status: 'correct' | 'partial' | 'incorrect' | 'pending' | 'no_pick'
         boldnessMultiplier: number

         explanation: string   // human-readable, shown in the UI

     }>

    }>

}

function score(input: ScoringInput): ScoringOutput


2.2 Per-type resolvers
Each question type implements:

interface QuestionResolver {

    type: QuestionType

    validate(answer: unknown, question: Question, tournament: Tournament): ValidationResult

    resolve(

     question: Question,

     answer: Answer,

     results: ResultSet

    ): { awarded: number; status: Status; explanation: string }

}

Register resolvers in a map keyed by type. Adding a new question type = adding one file. No
changes to the engine.


2.3 Resolver rules
    Type                                              Rule

    champion                                          Exact match on winning team → full points
 Type                                             Rule

 runner_up                                        Exact match on losing finalist → full points

 top_n_unordered                                  points × (correctTeams / n),
                                                  rounded down. Status partial if 0 < correct
                                                  <n

 top_n_ordered                                    points × (correctPositions / n),
                                                  plus config.exactBonus if all positions
                                                  match

 wooden_spoon                                     Exact match on last-placed team

 stat_leader                                      Exact match on the leader in
                                                  config.statCategory. On a tie in the
                                                  underlying stat, all tied players count as
                                                  correct

 team_over_under                                  Correct if the team's final position satisfies the
                                                  comparison in config

 numeric                                          Ranked by absolute distance from the actual
                                                  value. Closest gets points, second gets
                                                  points × config.secondPlaceRatio
                                                  (default 0.5). Ties split equally, rounded down

 boolean                                          Exact match

 custom                                           Exact match against the admin-settled option
                                                  ID


2.4 Boldness multiplier
share      = (number of members whose answer equals this answer) / memberIds.length

boldness = 1 - share

multiplier = 1 + (boldness × config.boldnessWeight)      // boldnessWeight default 1.0

awarded     = floor(baseAwarded × multiplier)

Rules:

   -​    Only applies to correct or partially correct picks. Wrong picks score zero regardless.
    -​   share is computed over memberIds (the lock-time snapshot), not the current member
         list.
    -​   For top_n_*, compute boldness per team within the answer, not per whole answer —
         otherwise identical slates with one team different get treated as fully distinct.
    -​   For numeric, boldness does not apply (there's no meaningful "share").
    -​   Members with no pick for a question are excluded from the denominator.


2.5 Projected mode
Identical logic, but results is derived from live_state rather than result:

    -​   Current league table substitutes for final table
    -​   Current stat leaders substitute for final stat leaders
    -​   Questions that cannot be projected (e.g. a boolean question about a future event)
         return status pending, award 0, and are excluded from maxPossible displays

UI must label projected standings unambiguously. Never show a projected number in the
same visual treatment as a settled one.


2.6 Test requirements
A test file per resolver. Plus integration fixtures:

    -​   fixtures/ipl-2025-complete.json — a full real tournament with known
         outcomes
    -​   fixtures/edge-cases.json — ties, injured players, incomplete slates,
         single-member groups, all-members-picked-the-same
    -​   A golden-file test that scores a fixture season and diffs against a committed expected
         output. This catches regressions when you touch the engine.




3. API surface
REST. All request and response bodies validated with Zod schemas shared between client and
server.


3.1 Auth
POST /api/auth/anonymous              { displayName }          → { userId, sessionToken }

POST /api/auth/claim              { email }             → sends magic link

POST /api/auth/verify             { token }             → { userId, sessionToken }
POST /api/auth/logout

GET   /api/me                                    → { user, groups[] }


3.2 Groups
POST /api/groups                 { name }              → { group, joinCode, inviteUrl }

GET   /api/groups/:id                              → group + members + seasons

POST /api/groups/join            { joinCode | inviteToken } → { group }

GET   /api/groups/:id/all-time                       → cross-season standings

PATCH /api/groups/:id            { name }               [admin]

DELETE /api/groups/:id/members/:mid                           [admin]

POST /api/groups/:id/transfer      { memberId }               [admin]


3.3 Seasons and slates
GET   /api/tournaments                               → catalogue, cacheable

POST /api/seasons                { groupId, tournamentId, lockAt, questions[] } [admin]

GET   /api/seasons/:id                              → season + questions (+ picks if locked)

PATCH /api/seasons/:id            { lockAt, scoringConfig }     [admin, only while draft/open]

POST /api/seasons/:id/publish                          [admin]

POST /api/seasons/:id/questions { type, prompt, config, points } [admin, only while
draft/open]

DELETE /api/seasons/:id/questions/:qid                        [admin, only while draft/open]


3.4 Picks
GET   /api/seasons/:id/picks/mine                       → own picks only

PUT   /api/seasons/:id/picks       { picks: [{questionId, answer}] } → upsert, rejected after lock
GET    /api/seasons/:id/picks/all                     → 403 before lock, full reveal after

Security requirement, stated bluntly: /picks/all must return 403 before lock_at based
on a server-side clock comparison, and /picks/mine must filter by the authenticated
member. A friend who opens the network tab and sees everyone's champion pick destroys the
game permanently. Write an integration test for this specific case.


3.5 Standings
GET    /api/seasons/:id/standings            → latest snapshot. Cache-Control: s-maxage=300

GET    /api/seasons/:id/standings/history      → position over time for the chart

POST /api/seasons/:id/recompute                [admin, rate-limited]


3.6 Settlement
POST /api/seasons/:id/settle                [admin] settles auto questions from results

POST /api/seasons/:id/questions/:qid/settle      { answer } [admin] manual settlement

POST /api/seasons/:id/void                  [admin] abandon the season


3.7 Ingestion (system, not user-facing)
POST /api/ingest/:tournamentId               Bearer INGEST_SECRET

    → runs the configured StandingsProvider, writes live_state,

      recomputes standings_snapshot for every active season on that tournament

POST /api/admin/manual-standings/:tournamentId [group admin or system admin]

    → manual table + stat leader entry, writes live_state with source='manual'


3.8 Share cards
GET /api/cards/reveal/:seasonId              → PNG. Cache-Control: public, max-age=86400,
immutable

GET    /api/cards/standings/:seasonId          → PNG, keyed by snapshot timestamp in the URL

GET    /api/cards/recap/:seasonId             → PNG
Include the snapshot timestamp in the card URL path so cards are genuinely immutable and
can be cached forever. A URL like /api/cards/standings/abc123/1745000000.png is
cacheable; /api/cards/standings/abc123.png is not.




4. State machine — season status
draft ──publish──▶ open ──lock_at reached──▶ locked ──settle──▶ settled

 │               │                 │

 └──────────────────┴──────────void────────────┴──────────▶
voided

Transition rules:

     -​   draft → open: requires ≥1 question and a lock_at in the future
     -​   open → locked: automatic on time. Enforce lazily — check now() > lock_at on
          every read and write rather than relying on a scheduled job. This avoids depending on
          a cron for correctness.
     -​   At lock: write member_snapshot, generate the reveal card
     -​   locked → settled: requires every question to have a settled result
     -​   Any → voided: admin only, with a reason

The lazy-lock point matters. If locking depends on a cron job and the cron fails, picks stay
open past the deadline and the game is broken. Computing lock state from the timestamp on
read means it's correct even if every scheduled job dies.




5. Security checklist
          ​ Picks are invisible to other members before lock — enforced in the query, tested
          ​ Lock time is compared server-side, never trusting a client timestamp
          ​ Group membership is verified on every group-scoped endpoint
          ​ Admin actions verify member.role = 'admin' for that specific group
          ​ Magic-link tokens stored hashed, single-use, short expiry
          ​ INGEST_SECRET compared with a constant-time comparison
          ​ Rate limiting on join, pick submission, and comment endpoints
          ​ Comment bodies escaped on render; no HTML allowed
        ​ Join codes exclude visually ambiguous characters and are rate-limited against brute
          force
        ​ No PII beyond display name and optional email
        ​ pick_history is append-only — no update or delete paths exist in code




6. Seed data needed for development
   -​   One tournament (ipl-2027 or whichever is next) with 10 teams and ~150 players
   -​   A ManualProvider fixture representing a mid-season table and stat leaders
   -​   A complete past tournament fixture for scoring-engine tests
   -​   A demo group with 6 members and varied picks, so the leaderboard has something to
        show

Commit these as JSON under seed/. Being able to reset to a realistic state in one command
will save you hours.
