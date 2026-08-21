# 05 — Claude Design Prompt

Paste the block below into Claude Design. It's written to be self-contained — it doesn't assume the other documents are available.

Adjust the product name before pasting.

## The prompt

Design the complete screen set for ColdTake, a free web app where a private group of friends predicts season-long sports outcomes before a tournament starts, then watches a leaderboard play out over two months.

### What the product does

Before a tournament (IPL cricket, FIFA World Cup, Premier League), a group of 6–30 friends each fills in a "slate" of season-long predictions: who wins, who's runner-up, which four teams make the playoffs, who scores the most runs, who takes the most wickets, plus custom questions the group's organiser writes themselves. Picks are private until the tournament's first ball, then everyone's picks are revealed at once. For the next two months a live leaderboard shows who is currently winning based on real standings. At the end, the group settles it and the results join a permanent all-time record.

It is explicitly not gambling. No money, no odds, no prizes — just bragging rights. The design must never resemble a betting app.

### Who uses it

Groups of friends, cousins, and colleagues — heavily South Asian and cricket-obsessed, mostly on Android phones in India, plus diaspora members abroad. They live in WhatsApp. They arrive via a link someone pasted in a group chat. They are not power users and will not read instructions.

### Design principles, in priority order

- **Mobile-first, thumb-first.** Design for a 390px viewport. Desktop is a secondary, wider arrangement of the same content. Every primary action reachable with one thumb.
- **Joining must feel instant.** The path from tapping a WhatsApp link to answering the first question should look and feel like three taps, not a signup funnel.
- **Personality over neutrality.** This is a game between friends, not a productivity tool. It should feel like sport — energetic, a bit cheeky, celebratory of bold calls and merciless about bad ones. Avoid enterprise SaaS blandness. Avoid the neon-green-on-black aesthetic of betting apps.
- **The share card is the hero.** More people will see a shared image in WhatsApp than will ever open the app. Design those images with the most care of anything here.
- **Never confuse projected with final.** In-season standings are provisional and must be visually unmistakable from settled results.

### Visual direction

Explore two or three directions and show me the strongest. Some starting thoughts, not constraints:

- A warm, editorial sports-magazine feel — strong typography, generous numerals, a confident accent colour, textured or paper-like surfaces. Think a print cricket almanac reinterpreted for mobile.
- Or a bold, high-contrast "scoreboard" language — big tabular numbers, team colour accents, a dark surface with vivid highlights, referencing stadium displays without tipping into betting-app territory.
- Typography should carry the design. Rankings, scores, and countdowns want a distinctive numeral treatment. Consider a display face for headings and numbers against a highly readable text face.
- Team identity matters emotionally — accommodate per-team accent colours without letting them fight the interface.
- Light and dark modes both needed; dark is likely the default given evening match viewing.

### Screens to design

**Onboarding and entry**
1. Invite landing page — what someone sees when they tap a WhatsApp link. Group name, who's already in, the tournament, a lock countdown, one dominant "Join" action. Must sell the game in three seconds to someone who has never heard of it.
2. Name entry — a single field, a single button. The lowest-friction screen in the product.
3. Create a group — group name, your name, done. Then the invite link with a prominent "Share on WhatsApp" action.

**Home**
4. Multi-group home — a list of all groups the person belongs to, each showing the active season, their current rank, and the next thing that needs their attention ("6 picks left", "locks in 2 days", "you're 3rd"). Handle both an empty state and a person in five groups.

**Building the slate (admin)**
5. Season setup — choose a tournament, then a checklist of question templates with sensible defaults pre-selected, and a lock time.
6. Custom question builder — write your own question and its answer options. Should feel playful, since this is where the group's in-jokes live.

**Making picks**
7. Pick sheet — the core screen. A stack of question cards, one at a time, swipeable and scrollable. Each card is a question with its answer options. Different answer patterns needed: single team select (10 team crests), ordered multi-select for a top four, player search-and-select for stat leaders, a number input, a yes/no, and generic multiple choice. A persistent progress indicator and a lock countdown.
8. Slate complete — a satisfying confirmation. "Your calls are locked in." A prompt to share that you've submitted (without revealing what you picked).
9. Pre-lock waiting state — what a member sees when they've submitted but the tournament hasn't started. Who else has submitted, who hasn't, a countdown.

**The reveal**
10. Reveal screen — the moment everyone's picks become visible. This should feel like an event. Show the group's picks grouped by question: how many people backed each team, who was the only one to call something unusual. Highlight contrarian picks — they're worth more points and they're the best conversation fodder.

**In-season**
11. Leaderboard (projected) — the screen people open most. Ranked members, current points, movement since last update, and unmistakable "projected" framing. Tapping a member expands their per-question breakdown.
12. My slate status — the member's own picks with live status: which are landing, which are dead, which are still contested. Needs an emotional register — a dead pick should feel like a small loss.
13. Position history chart — line chart of every member's rank over the season. This is where the drama lives; make it beautiful and readable at 390px with 8+ lines.
14. Question detail — one question, everyone's picks, current real-world state, and a comment thread.

**Endgame**
15. Final standings — settled results, a winner treatment that feels genuinely celebratory, and a full breakdown.
16. Season recap — the season's best call, worst call, biggest collapse, most contrarian correct pick.
17. All-time record — a group's history across every season and tournament. A hall of fame.

**Admin utility**
18. Manual settlement — the organiser resolves custom questions and can override an automated result. Functional, not decorative, but it shouldn't feel like a different product.
19. Manual standings entry — a fallback form for entering the league table and stat leaders by hand when live data isn't available.

### Share cards (design these with the most care)

These are square or 4:5 images generated server-side and pasted into WhatsApp. They must be legible as a thumbnail, must carry the group's name and a join link, and must make a non-user curious enough to tap.

- Reveal card — everyone's champion pick, side by side
- Standings card — current top of the leaderboard, with movement
- Swing card — "Somansh jumped four places" after a big result
- Recap card — final standings and the season's defining call

Constraint on the cards: they'll be rendered with Satori, which supports flexbox but not CSS grid, has limited font handling, and can't use external images unless inlined. Design within a flexbox-only, text-and-shape vocabulary. Avoid effects that need filters or complex masks.

### States to cover throughout

- Empty: no groups, no seasons, no picks yet, nobody has joined
- Loading: especially the leaderboard, which may take a moment on a cold database
- Error: live data unavailable, showing last-known standings
- The person who joined after lock and can't pick
- The person who never submitted a slate
- A group of exactly two people, and a group of thirty

### Deliverables

- A design direction with type scale, colour system (light and dark), spacing, and component primitives
- All 23 screens and cards above, mobile-first, with desktop treatments for the leaderboard, pick sheet, and question detail
- The team-colour accent system, shown against at least three different team identities
- A short rationale for the direction you chose and what you rejected

Use placeholder cricket content throughout — IPL team names and generic player names are fine. Don't reproduce real team logos or brand marks; use abstract shapes or initials for team identity instead.

## Notes for you, not for the prompt

On team logos: IPL franchise crests are trademarked. Use team initials, colour blocks, or abstract marks in both the design and the build. This is a real constraint, not caution — an app displaying franchise logos will attract attention you don't want.

Two screens to get right above all others: the invite landing page (§1) and the standings share card (§21 in the original numbering — the "Standings card" under Share cards above). One determines whether people join; the other determines whether anyone hears about it. If Claude Design produces weak versions of those, iterate specifically on them before anything else.

Sequencing: run the design prompt before Milestone 3 in the build plan. Milestones 0–2 are infrastructure and won't be blocked, but the pick sheet is worth designing before you build it.
