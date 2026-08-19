00 — Project Brief
      How to use these documents. Feed 00 through 04 into Claude Code as project
      context (a docs/ folder in the repo, or paste at session start). 05 is for Claude
      Design, separately. Docs 01–03 are specification: they describe what to build. Doc
      04 is the execution plan.




1. What this is
A free, season-long prediction game for private friend groups.

Before a tournament starts, every member of a group commits to a slate of season-long
outcomes — champion, runner-up, top four, Orange Cap, Purple Cap, wooden spoon, and
custom questions. Picks lock at the first ball and are revealed simultaneously. For the next two
months a live leaderboard shows who is currently winning based on real standings. At the end,
the group settles it.

Not per-match scoreline prediction. Not fantasy team selection. Not betting.


2. Why this specific shape
The competitive research (see the earlier Idea C document) found the friend-group prediction
category is well served for per-match football scorelines — Superbru, BeTeam, Prodefy,
TipLeague, Predictor for Friends. Season-long outcome slates exist only as a bolt-on side
feature ("Champion Bet", "champion and runner-up bonus picks"), never as the main event. And
cricket is served almost exclusively by fantasy and betting platforms, not free social games.

The unoccupied position: cricket-first, season-slate-first, group-native.


3. Non-negotiable constraints
 Constraint                                      Implication

 Zero cost at 1,000 users / 5 tournaments        Every architectural decision is subordinate to
 per year                                        this. See doc 02 §5 for the budget model.

 Free-to-play forever, no money, no prizes       Legal necessity in India, and an app-store
                                                 requirement. No entry fees, no cash, no odds,
                                                 never the word "bet".
 Constraint                                      Implication

 Vercel + Neon + React/Vite                      Chosen for familiarity. Doc 02 gives
                                                 alternatives but assumes these unless
                                                 overridden.

 GitHub-hosted                                   Public or private both fine; public helps if you
                                                 want it as a portfolio piece.

 Solo maintainer                                 Prefer boring, well-documented technology
                                                 over clever technology.


One legal note worth internalising and never violating: Vercel's Hobby plan is restricted to
personal, non-commercial use. A free-to-play game with no revenue sits inside that restriction.
The day you add any monetisation, you must move to Pro. This is a real constraint, not a
technicality — it's another reason to keep the product permanently free.


4. Success criteria
Ordered by how much they matter:

   1.​ A group you are not a member of gets created. This is the only real signal. Everything
       else is vanity.
   2.​ Your own group completes a full tournament without you manually fixing data.
   3.​ Someone in the group shares a leaderboard card into WhatsApp unprompted.
   4.​ A group returns for a second tournament.

Explicit non-goals for v1: monetisation, mobile app store presence, real-time ball-by-ball,
per-match predictions, public/global leagues, fantasy team mechanics.


5. Naming options
Requirements: short, pronounceable in Indian English, no gambling connotation, plausible
.com/.app availability, clean as a GitHub repo name.


Tier 1 — my strongest picks
 Name                            Rationale                        Concerns

 ColdTake                        Inverts "hot take" — you         May read as sarcastic; check
                                 make a bold claim in March       coldtake.app
                                 and it gets judged in May.
Name                         Rationale                        Concerns

                             Memorable, funny,
                             sport-agnostic, and describes
                             the mechanic exactly. Repo:
                             coldtake.

CalledIt                     The exact phrase people say      Common phrase — domain
                             when a prediction lands.         and App Store name likely
                             Instantly understood. Repo:      contested
                             calledit.

Slate                        Clean, professional, refers      Heavily used name (Slate
                             directly to the pick sheet.      magazine, Slate.js editor).
                             Repo: slate.                     Weak trademark position


Tier 2 — cricket-flavoured
Name                         Rationale                        Concerns

Toss                         Cricket's opening ritual, and    Reads as coin-flip/gambling
                             "toss up" implies prediction.    to some; limits you if you
                             Very short.                      expand to football

SillyPoint                   A real fielding position, and    Opaque to non-cricket
                             self-deprecating about bad       audiences
                             predictions. Very charming to
                             cricket fans.

LongHandle                   Cricket idiom for swinging big   Obscure even to some cricket
                             — matches "bold pick"            fans
                             scoring.

Nightwatchman                Beloved cricket term.            Too long, wrong connotation
                                                              (defensive, not bold)


Tier 3 — descriptive and safe
Name                         Rationale                        Concerns

Preseason                    Literally when you play. Clear   Generic; hard to trademark or
                             and calm.                        rank in search
 Name                            Rationale                       Concerns

 Frontrunner                     Leaderboard energy.             Slightly corporate; racing
                                                                 connotation

 PickSheet                       Exactly what it is.             Boring, and "pick sheet" is
                                                                 US-sports betting vocabulary
                                                                 — avoid

 Punditly                        You are all pundits. Playful.   "-ly" suffix is dated


Names to avoid entirely: anything containing bet, odds, stake, wager, punt, book, or parlay.
These will get you rejected by app stores and create legal ambiguity in India even for a free
product.

My recommendation, held loosely: ColdTake if you want personality and multi-sport
headroom; CalledIt if you want immediate comprehension. Check GitHub org, .com, .app,
and an npm scope before committing — renaming after launch is genuinely painful because it's
baked into share cards and links.


6. Vocabulary (use these terms consistently in code and UI)
 Term                            Meaning                         Never call it

 Group                           A private set of people (your   League, pool, club
                                 cousins, your office)

 Season                          One group playing one           Contest, competition
                                 tournament

 Slate                           The set of questions for a      Card, form, sheet
                                 season

 Question                        One predictable outcome         Market, line, prop

 Pick                            One member's answer to one      Bet, wager, tip
                                 question

 Lock                            The moment picks freeze and     Deadline, cutoff
                                 reveal

 Settlement                      Determining the correct         Payout, resolution
                                 answer
 Term                             Meaning                          Never call it

 Projected standings              Live in-season leaderboard       Odds, probability


Being disciplined about this vocabulary is a legal and positioning decision, not a style
preference.
