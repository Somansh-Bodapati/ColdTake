01 — Product Requirements
Written as a business analyst would: user roles, flows, feature specs with acceptance criteria,
and explicit rules. Ambiguity resolved wherever possible; where a decision is genuinely open,
it's marked [DECISION] with options.




1. Roles
 Role                                             Capabilities

 Anonymous visitor                                View a public invite page; see what a group is
                                                  about; cannot see picks

 Member                                           Submit and edit own picks before lock; view
                                                  revealed picks and standings after lock;
                                                  comment

 Group admin                                      Everything a member can, plus: create
                                                  seasons, build the slate, set lock time, add
                                                  custom questions, settle manual questions,
                                                  remove members, transfer admin

 System                                           Ingests tournament data, computes projected
                                                  standings, settles automated questions


[DECISION] Should the admin be able to play?

   -​   Option A — Yes, admin plays like everyone else. Pro: matches reality; nobody wants a
        non-playing organiser. Con: admin can see the DB… but only if they're technical, and
        these are friends. Recommended.
   -​   Option B — Admin picks are locked first, or admin can't settle questions they have a
        stake in. Pro: integrity. Con: solves a problem that doesn't exist in a friend group.
2. Core user flows

2.1 Group creation
   1.​ Visitor lands on the site, taps "Start a group"
   2.​ Enters group name and their own display name
   3.​ Account is created [DECISION: see §7.1 auth]
   4.​ Group is created with them as admin; an invite link + 6-character join code is generated
   5.​ They're taken straight to season setup

Acceptance: From landing page to shareable invite link in under 60 seconds, on a phone.


2.2 Joining
   1.​ Member opens the invite link (or enters the join code)
   2.​ Sees the group name, member count, tournament, and lock time
   3.​ Enters a display name, authenticates
   4.​ Lands directly on the pick sheet with the lock countdown visible

Acceptance: Under 30 seconds from tapping a WhatsApp link to seeing the first question.
Every additional step loses members and a group that loses three of eight members dies.


2.3 Season setup (admin)
   1.​ Admin selects a tournament from the catalogue (IPL 2027, T20 World Cup, etc.)
   2.​ Selects which question templates to include — defaults pre-checked for that tournament
       type
   3.​ Optionally adds custom free-text questions with manually defined options
   4.​ Sets lock time (defaults to the scheduled start of match 1)
   5.​ Optionally adjusts point values per question
   6.​ Publishes the season — members are notified


2.4 Making picks
   1.​ Member sees the slate as a scrollable card stack, one question per card
   2.​ Answers each; progress indicator shows "7 of 12 answered"
   3.​ Picks autosave on every change
   4.​ Can revise freely until lock
   5.​ Own picks visible to self only. Other members' picks return HTTP 403 from the API
       before lock — this must be enforced server-side, not by hiding UI.
   6.​ A "Your slate is complete" state with a share prompt ("I've locked in my calls")
2.5 Lock and reveal
     1.​ At lock time, picks freeze (server-side check on every write)
     2.​ All picks become visible to all group members simultaneously
     3.​ A Reveal card is generated: a shareable image of everyone's champion pick, designed
         for WhatsApp
     4.​ Members who never submitted are marked "no slate" and score zero


2.6 In-season
     1.​ A daily job refreshes tournament standings and stat leaders
     2.​ Projected standings recompute: "if the season ended today, who wins"
     3.​ Members see the leaderboard, their own hit/miss status per question, and a
         position-history chart
     4.​ A weekly digest card is generated for sharing


2.7 Settlement
     1.​ When the tournament completes, automated questions settle from ingested data
     2.​ Manual/custom questions are settled by the admin in a settlement UI
     3.​ Final standings publish with a full per-question breakdown
     4.​ A season-recap card is generated
     5.​ Results append to the group's all-time record




3. Question types
This is the heart of the product. Each type needs a defined answer space, a settlement source,
and a scoring rule.


 #                   Type               Answer space      Settlement         Notes
                                                          source

 Q1                  Champion           One team          Final result       The anchor
                                                                             question

 Q2                  Runner-up          One team          Final result

 Q3                  Top N              N teams from      Final league       Partial credit per
                     (unordered)        the pool          table              correct team
 #                  Type               Answer space       Settlement         Notes
                                                          source

 Q4                 Top N (ordered)    N teams, ranked    Final league       Partial credit;
                                                          table              bonus for exact
                                                                             order

 Q5                 Wooden spoon       One team           Final league       Last place
                                                          table

 Q6                 Leading run        One player         Season stat        "Orange Cap" in
                    scorer                                leaders            IPL

 Q7                 Leading wicket     One player         Season stat        "Purple Cap"
                    taker                                 leaders

 Q8                 Most sixes         One player         Season stat        Cricket-specific
                                                          leaders

 Q9                 Team               One team + a       Final league       "CSK finishes
                    over/under         threshold          table              6th or better"
                                       position

 Q10                Numeric guess      An integer         Season             Closest wins;
                                                          aggregate          e.g. "total sixes
                                                                             in the
                                                                             tournament"

 Q11                Yes/No             Boolean            Manual or          "Will Dhoni retire
                                                          automated          this season"

 Q12                Custom             Admin-defined      Manual             The escape
                    multiple choice    options                               hatch; makes
                                                                             the product
                                                                             infinitely
                                                                             extensible


Design principle: Q12 exists so the product never blocks a group from asking what they
actually argue about. If everything else fails, a group can run an entire season on custom
questions with manual settlement. Build Q12 early — it's the fallback that makes the whole thing
robust.
4. Scoring rules

4.1 Base points
Every question carries an admin-configurable point value. Defaults:


 Question                                          Default points

 Champion                                          25

 Runner-up                                         15

 Top 4 (unordered)                                 5 per correct team (max 20)

 Top 4 (ordered)                                   5 per correct team + 10 bonus if all four in
                                                   exact order

 Wooden spoon                                      10

 Leading run scorer                                15

 Leading wicket taker                              15

 Most sixes                                        10

 Team over/under                                   5

 Numeric guess                                     10 to closest, 5 to second closest

 Yes/No                                            5

 Custom                                            10


4.2 Bold-pick multiplier [DECISION]
The idea: a correct pick that few people made is worth more. This is what makes the
leaderboard non-obvious and interesting.

Proposed formula: awarded = base × (1 + boldness) where boldness = 1 −
(share of members who picked this answer).

So if 8 of 8 people picked RCB and RCB wins, multiplier is 1.0. If 1 of 8 did, multiplier is 1.875.
   -​   Option A — Enable by default. Pro: dramatically better game; rewards conviction;
        creates the "you were the only one who called it" moment that drives sharing. Con:
        scores are less intuitive; requires the member pool to be frozen at lock (otherwise a late
        joiner changes everyone's score retroactively).
   -​   Option B — Off by default, admin toggle. Pro: simplicity for groups that want plain
        scoring. Con: nobody discovers the better mode. Recommended: on by default, admin
        can disable.
   -​   Option C — Omit entirely for v1. Pro: less to build and explain. Con: you lose the single
        most differentiating mechanic.

Hard requirement if enabled: compute boldness against the member set as of lock time,
stored as a snapshot. Never recompute against the current member list.


4.3 Settlement edge cases — these must all be specified
 Case                                             Rule

 Tie in a stat race (two bowlers on 24            Apply the tournament's own tiebreak (e.g.
 wickets)                                         better economy rate) if available in the data;
                                                  otherwise both picks score full points

 Picked player doesn't play / is injured out      Pick scores zero. Alternative: void and
                                                  redistribute. [DECISION] — I recommend
                                                  scoring zero: it's simpler, and "picking a
                                                  player who might get injured" is part of the
                                                  risk. State it clearly in the rules UI.

 Team withdraws or tournament is                  Admin can void the entire season; no scores
 abandoned                                        recorded

 Data source disagrees with reality               Admin override on any settled question, with
                                                  an audit note. Always build this escape hatch.

 Member joins after lock                          Can view but not pick; scores zero; excluded
                                                  from boldness denominator

 Member submits an incomplete slate               Unanswered questions score zero; no penalty
                                                  beyond that

 Duplicate answers within a Top-N pick            Rejected at input validation


4.4 Scoring engine requirements (non-negotiable)
   -​   Scoring is a pure function: score(picks, results, config,
        memberSnapshot) → standings. No side effects, no reads of mutable state.
   -​   Results are stored as immutable facts with a source and timestamp. Scores are
        derived, never stored as the source of truth.
   -​   The engine must be runnable against historical data to reproduce any past leaderboard
        exactly.
   -​   Every scored question must expose a human-readable explanation string: "You picked
        Mumbai Indians for champion. Rajasthan Royals won. 0 of 25 points." Disputes will
        happen; the UI must answer them without you opening a database.




5. Projected standings (in-season)
The mechanic that turns a one-time form into a two-month experience.

Rule: run the exact same scoring engine, but substitute current standings and stat leaders for
final results. Label the output unmistakably as projected — never let it be confused with settled
scores.

Display requirements:

   -​   Current position per member, with change since last update
   -​   Per-member: which picks are currently landing, which are dead, which are contested
   -​   A position-history line chart across the season
   -​   "Still alive" indicators — a champion pick is alive until that team is mathematically
        eliminated

[DECISION] Refresh cadence

   -​   Option A — Once daily. Pro: minimal API cost, minimal DB compute, entirely adequate
        for a season-long game. Con: not "live" during a match. Recommended for v1.
   -​   Option B — After each match completes. Pro: standings update when people care. Con:
        needs match-completion detection and more frequent polling; on Vercel Hobby, cron
        frequency is restricted (verify current limits — historically Hobby allowed limited daily
        crons).
   -​   Option C — On-demand refresh when a user opens the page, with a cache TTL. Pro:
        zero scheduled jobs, updates only when someone is watching, naturally
        cost-proportional to usage. Con: first visitor of the day pays the latency. Strong
        contender — arguably better than A for a free-tier build.
6. Social and sharing features
These are not decoration. For a group product, sharing is the growth loop and the retention
mechanism.


6.1 Share cards (high priority)
Server-generated images, one tap to share:

   -​   Reveal card: everyone's champion pick, at lock
   -​   Standings card: current leaderboard, weekly
   -​   Swing card: "Somansh jumped 4 places" after a big result
   -​   Recap card: final standings and the season's best and worst calls

Each card must include the group name and a join link. Every card pasted into WhatsApp is
seen by people who aren't users yet. This is your entire acquisition strategy.


6.2 Comments
Threaded comments per question, plus a general season thread. Deliberately lightweight — the
real conversation stays in WhatsApp and that's fine. Don't try to replace WhatsApp; try to feed it.


6.3 Notifications [DECISION]
   -​   Option A — None; rely on share cards. Pro: zero infrastructure, zero cost, zero
        permission prompts. Con: no re-engagement hook.
   -​   Option B — Email digest weekly. Pro: cheap (free tiers exist at this volume), no
        permission friction. Con: low open rates.
   -​   Option C — Web push (PWA). Pro: real re-engagement. Con: permission prompt friction,
        iOS PWA push requires the user to install to home screen, and it's another system to
        debug. Defer to v2.

Recommended v1: A + B. Ship push only if the game proves sticky.
7. Cross-cutting decisions

7.1 Authentication [DECISION — highest-impact choice in the product]
 Option                         Pros                             Cons

 Name-only, no account          Absolute lowest friction; a      Losing the cookie loses the
 (session cookie + a claim      cousin taps a WhatsApp link      identity; no cross-device;
 link)                          and is playing in 15 seconds;    abuse is trivial (though
                                no email deliverability          irrelevant in a private group)
                                problem

 Magic link email               No passwords; recoverable;       Email entry is friction;
                                cross-device                     deliverability on a free tier is a
                                                                 real risk; people mistype
                                                                 emails

 Google OAuth                   One tap on Android;              Requires OAuth consent
                                recoverable; free                screen setup; some people
                                                                 don't want to link Google to a
                                                                 game

 Phone OTP                      Native to the Indian audience; SMS costs money —
                                matches WhatsApp mental        immediately breaks the
                                model                          zero-cost constraint. Rule
                                                               this out.

 Hybrid: play immediately       Best of both: zero friction to   Two code paths;
 with a name, prompt to         convert, recoverability for      account-merge logic
 attach email after picks are   those who want it
 submitted


Recommended: the hybrid. Let people play first and authenticate later. Design the schema so a
member can exist with no user attached, and can be claimed later.


7.2 Group and season structure
   -​   A group persists across seasons and tournaments
   -​   A group has many seasons; a season belongs to one tournament
   -​   A member belongs to a group; their picks belong to a season
   -​   All-time standings aggregate across a group's seasons
   -​   A user can belong to many groups — this is the "under one roof" requirement from the
        original brief. One identity, one home screen, all their groups.


7.3 Privacy
   -​   Groups are private by default and invisible without the invite link
   -​   Picks are never visible to anyone (including other members) before lock — enforced in
        the query layer
   -​   No public leaderboards in v1




8. Explicit v1 scope boundary
In: groups, seasons, slate builder, all 12 question types, pick + lock + reveal, projected
standings, settlement with admin override, scoring engine with bold-pick multiplier, share cards,
multi-group home, all-time record, comments.

Out: payments, prizes, per-match predictions, mid-season pick changes, push notifications,
native apps, public leagues, fantasy mechanics, AI-generated commentary, multi-language.

The mid-season transfer window — which you specifically mentioned as a frustration — is
deliberately deferred. It's a great v2 feature (a limited number of pick changes at a points cost)
but it substantially complicates scoring, boldness computation, and the audit trail. Get one clean
season working first.
