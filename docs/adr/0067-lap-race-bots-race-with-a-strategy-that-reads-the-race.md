# ADR 0067: Lap-race bots race with a strategy that reads the race — superseding ADR 0060 D-9 and ADR 0061's course-only rule

- **Status**: **Proposed, 2026-11-11.** **The owner's ruling of 2026-11-10 is not open**: it is
  quoted in Context and D-0 records it, and nothing here re-argues it. **D-1 to D-7 are the author's
  recommendations**, each marked so, from the planner's recommendations on
  [#2457](https://github.com/openzigs/onyourleft/issues/2457), and are **Proposed until the owner
  rules on them on this ADR's pull request**; D-8 lists each one. Accepting this ADR as written
  accepts each recommendation. **Nothing is built by this ADR**: #2458 to #2464 build it.
  **Merge order (ADR 0013 D-2 makes Status part of the body, so it cannot be changed after merge)**:
  the owner rules on D-8 first; then this branch changes the Status to Accepted and the *Proposed*
  wording in `docs/architecture.md` and `docs/agents/adr-numbering.md`; only then does the pull
  request merge. **It does not merge while this Status reads Proposed**, and the dated entries it
  appends to ADR 0038, 0060, 0061 and 0066 say *"once ADR 0067 is Accepted"*, so they are true the
  day they merge and after
- **Date**: 2026-11-11
- **Deciders**: **the owner**, on the ruling of 2026-11-10 on
  [#2455](https://github.com/openzigs/onyourleft/issues/2455#issuecomment-6782129845), and on D-8 on
  this ADR's pull request. **The author** drafted the rest for that approval
- **Issue**: [#2457](https://github.com/openzigs/onyourleft/issues/2457), phase 0 of the plan whose
  sub-issues are #2458 to #2464, under the lap-race epic
  [#1894](https://github.com/openzigs/onyourleft/issues/1894)
- **Number**: **0067**. On 2026-11-11 `main` (`eba4b7eb`) holds no `docs/adr/` file numbered 0067,
  and `docs/agents/conventions.md` §7, `docs/agents/adr-numbering.md` and `docs/architecture.md` all
  give 0067 as the next free number. No open pull request names it; #2457 claims it by its title.
  **0057 and 0058 stay claimed** by [#1748](https://github.com/openzigs/onyourleft/issues/1748) and
  [#1752](https://github.com/openzigs/onyourleft/issues/1752)
- **Supersedes**, by decision number, for **lap-race bots in a solo race** only:
  - [ADR 0060](0060-the-lap-race-effort-distance-and-a-bounded-race-offset.md) **D-2.1's words
    *"or when"*, narrowed (not reversed) by D-3.3 and D-6.1 under D-3's answer (b)**: where a bot
    rides decides the rider's draft factor `k` and so when the next grade is sent (R-8). **D-9**: D-9.1 (bots
    do not vary their power with their race position), what was left of D-9.2 after ADR 0061, and
    D-9.3 (the patent reading). **D-14 Q4's answer, *"No"* to rubber-banding by rank, is kept as D-1
    here reads it**: no bot's capacity changes with its place;
  - [ADR 0061](0061-lap-race-bots-a-course-only-energy-plan-never-another-racer.md) **D-1** (power
    never a function of any other racer), **D-2** (what the plan may read: replaced by D-0 here),
    **D-3** (what it may never read), **D-4** (the dependency on solo races having no drafting), **D-6**
    (the patent reading), **D-8.1** (mean power within a tolerance of the tier: restated by D-1.3
    here), **D-8.5** (identical power as a function of the bot's own effort distance) and **D-8.6**
    (the sprint asserted on effort distance);
  - [ADR 0066](0066-the-bot-pacer-and-the-riders-own-ghost-give-a-draft-in-a-solo-ride.md) **D-2**
    (lap-race bots stay undrafted), on D-3 here, **D-1.5's** *"a lap race … unchanged"*, **D-4's**
    sentence that the patent-risk acceptance does not reach lap-race bots (R-7), and **D-6's last
    bullet**, that the switch *"has no effect in … a lap race"*, on D-3.4 here;
  - [ADR 0038](0038-drafting-in-the-first-multiplayer-release.md) **D-5's "Out" bullet** for the
    lap-race bots and the rider drafting them (its 2026-11-10 amendment left lap-race bots
    undrafted), on D-3 here. **D-7 stays** as the record of what was accepted on 2026-09-28.

  **Every other decision of those four ADRs is unchanged, by name**: ADR 0060 D-1, D-2 (but for the
  words above), D-3 to D-8 and D-10 to D-14 (Q4 as read above); ADR 0061 D-5, D-7's answers (the surge ceiling and the −20 % floor of
  Q2 (a), and Q3's reading of ADR 0060 D-4.3), D-8.2, D-8.3 and D-8.4; ADR 0066 D-1 (but for D-1.5's lap-race clause), D-3, D-4 (but for its lap-race clause), D-5 (as
  D-3.7 here reads it for a lap race), D-6 (its switch extended as D-3.4 says) to D-8; ADR 0038 D-1 to
  D-4, D-5's other bullets and D-6 to D-7. Each superseded ADR gains one dated `## Amendments`
  entry pointing here ([ADR 0013](0013-adr-amendments.md)); no body is edited. **The ADR 0066 and ADR 0038 entries,
  the ADR 0060 D-2.1 sentence and the ADR 0061 D-4 clause stand only if the owner keeps D-3's answer
  (b)**: D-3's last paragraph lists every edit (c) takes out of this pull request
- **Relates to**: [ADR 0059](0059-delivery-a-parcel-round-game-mode.md) D-2 and ADR 0060 D-2 (no
  game event reaches the trainer), [ADR 0028](0028-racing-fairness.md) D-1 (one physics),
  [ADR 0038](0038-drafting-in-the-first-multiplayer-release.md) D-3 (the draft model),
  [ADR 0007](0007-patent-posture.md) D4 (a bot is never a recorded ride),
  [ADR 0013](0013-adr-amendments.md) D-3 (why this is a new ADR)

---

## Context

### What the owner ruled

On 2026-11-10, on [#2455](https://github.com/openzigs/onyourleft/issues/2455#issuecomment-6782129845)
(*"all seven bots ride as one stacked group and vanish from view once the rider leads"*), the owner
wrote, quoted verbatim:

> **Owner ruling, 2026-11-10 (supersedes the constraint in my previous comment):** "I don't care
> about the patent check. There can't be a rule on racing strategy." Bots may race with a strategy
> that reacts to the race (position, gaps, the rider), as well as different paces. ADR 0060 D-9's
> "never its rank, place or gap" rule is to be reversed by a superseding ADR, as CLAUDE.md requires
> for reversing a decision. This PR (the #2455 lane already running) stays as phase 1: seeded
> different abilities and course-based pacing styles. Race-aware strategy follows from the Tavily
> research the owner asked for, filed as its own epic or issues under #1894.

On 2026-11-11 the owner chose #2457 for the next run, and restated its scope on the issue: *"Write
ADR 0067, which supersedes ADR 0060 D-9 and ADR 0061's course-only rule, following the owner ruling
of 2026-11-10: 'There can't be a rule on racing strategy.' Don't edit the bodies of the earlier ADRs.
The trainer-safety rule stays in force: no bot or race event reaches the trainer."*

### Why an ADR, and why a new one

ADR 0060 D-9 and ADR 0061 D-1 to D-4 are decisions, and the ruling reverses them. ADR 0013 D-3 sends
a reversed decision to a superseding ADR, and both ADRs' *Reversing any of these* sections say the
same: ADR 0061's names *"a plan that reads any other racer, the bot's own rank, its `raceOffset` or
its drawn distance"* and *"any bot in a drafting room"* as needing one. ADR 0061 did exactly this for
ADR 0060 D-9.2, and this ADR follows its shape.

### What exists today (read at `origin/main` `eba4b7eb`)

- **A bot's power** comes from `packages/domain/src/lap-race/plan.ts` §`botPlanStep`: its tier
  (`bots.ts` §`BOT_TIER_WATTS_PER_KILOGRAM` at `BOT_MASS_KILOGRAMS`, 75 kg), its pace since #2455
  (`pace.ts`: an ability at or a little under its tier and a course-read pacing style), the grade,
  the effort distance it has left, and a **banking reserve** that starts at 0, fills by riding
  `BOT_PLAN_BANKING` (5 %) under its own power and holds at most `BOT_TIER_BUDGET_JOULES`
  (1.5 to 3.3 kJ). It reads no other racer (ADR 0061 D-3).
- **The bots' item and lane choices** (`bots.ts` §`botDecision`, `strategy.ts`, #1900, #1959) already
  read the race and are not power.
- **No lap-race racer drafts.** `packages/physics` §`advanceBot` passes no draft multiplier, and ADR
  0066 D-2 kept the lap race undrafted when the solo pacer and the rider's own ghost began to give a
  draft. The lap race drops the pacer from its frame (#1971).
- **The two safety gates**: `apps/web/src/game/lap-race/lap-race-cannot-reach-trainer.test.ts` (no
  lap-race module reaches the trainer-command seam, by any static import chain) and
  `apps/web/src/game/lap-race-wiring.test.tsx`'s
  `sends the trainer the same writes, each grade at the same time, as an ordinary ride, a race with items off and one with the rider hit (D-2.1)`.

### What the research added (from #2457, not re-run here)

Rubber-banding is hated when it changes a computer racer's **speed** to catch up, and accepted when
catch-up comes from **behaviour** and a well-earned lead stands (Bugnet; How-To Geek). A cycling
manager game's computer riders read as over-costly in attack and **perfectly coordinated** (Gamecritics,
Pro Cycling Manager 2024). A drafting rider in a bunch saves about 27 % of their power at 40 km/h
(Ratamero's peloton model), which is what makes *"sit in, then kick"* a strategy at all. URLs are
on #2457.

---

## Decision

### D-0 — The rule (the owner's, 2026-11-10)

**There is no rule on a lap-race bot's racing strategy.** A bot may read the race: its own rank,
the gaps ahead and behind, any other racer's position and power, the rider's included, the laps
left, the drawn line and its own reserve. **The patent-based limit of ADR 0060 D-9.3 and ADR 0061
D-6 is set aside by the owner**, and this ADR does not re-argue it.

What does not move is everything that is not strategy: **D-6 below**, the trainer above all.

### D-1 — Capacity is fixed; strategy only spends it (decision 1)

**The author's recommendation: yes.**

1. **A bot's capacity is fixed at the start** from its tier, its archetype and pace (#2455, #2459)
   and the race's seed: its critical power (CP), its W′ and its sprint peak. **Strategy decides when
   to spend, never how much there is.**
2. **No rule changes a bot's power, CP, W′ or peak by its rank, its gap or the rider's.** This is
   rubber-banding by speed, and it stays out: ADR 0060 D-14 Q4's *"No"* is kept in this reading.
   Catch-up comes from behaviour (sitting in, timing a kick) and from the position-weighted items a
   rider gets (ADR 0060 D-4.3), so **a rider's well-earned lead stands**.
3. **ADR 0061 D-8.1 restated against capacity.** A mean-power tolerance cannot hold for a bot that
   sits in a draft or recovers on purpose, so it goes. In its place: **a bot's W′ balance is never
   below 0 and never above its W′, sampled every tick**, and its power stays inside the bounds of
   ADR 0061 D-8.2 (kept): the named surge ceiling over its tier, never over
   `MAXIMUM_INTENSITY_WATTS_PER_KILOGRAM` (7) at `BOT_MASS_KILOGRAMS`, and never under
   `PACING_FACTOR_FLOOR` (−20 %) of its tier **while it rides in the open (`k` = 1)**. **In a draft
   (`k` < 1) the floor does not apply** (R-10, the author's recommendation): a bot held at 80 % of a
   tier behind a same-tier bot riding at its tier rides up past the wheel, because the draft saves
   more than 20 %, so with the floor kept *"sit in, then kick"* works only behind a faster rider, and
   the floor also limits W′ recovery. The surge ceiling, the 7 W/kg limit and the W′ balance still
   bound it. If the owner rules that the floor still applies, D-1.3 reads as ADR 0061 D-8.2 has it.
4. **ADR 0060 D-4.3 is read as ADR 0061 D-7 Q3 read it**: a bot's own plan, now its strategy, is
   its source of power, as a rider's legs are, not a rule acting on it.

### D-2 — The power model: W′ balance in the discrete differential form (decision 2)

**The author's recommendation.** Each bot carries a W′ balance in the discrete differential
(Froncioni, Skiba and Clarke) form, the GoldenCheetah default, **replacing the banking reserve of
#1960** rather than sitting beside it ([#2458](https://github.com/openzigs/onyourleft/issues/2458)).
Per tick of length `dt` at power `P`: above CP, `wbal −= (P − CP)·dt`; at or below it,
`wbal += (CP − P)·dt·(W′ − wbal)/W′`; it starts full and is clamped to `[0, W′]`; at 0, power is
capped at CP until the balance recovers above a named re-entry threshold. **Not** the integral form,
whose time constant needs `Math.exp` and was fitted on untrained subjects. #2458's pull request
proposes each tier's W′ as named constants for the owner's approval.

### D-3 — Drafting in the solo lap race (decision 3)

**The options**: (a) bots draft each other only; (b) full drafting, the rider included; (c) none,
as today.

**The author's recommendation: (b).** *"Sit in, then kick"* means nothing without a draft, and (a)
is a race whose physics differs by racer, which ADR 0066 D-2 cites ADR 0028 D-1 against.

1. **One model for every racer**: ADR 0038 D-3's `k` from distances, unchanged, applied to every
   bot and to the rider alike ([#2460](https://github.com/openzigs/onyourleft/issues/2460) for the
   bots, [#2461](https://github.com/openzigs/onyourleft/issues/2461) for the rider).
2. **`k` reads effort distance**, never drawn distance, as ADR 0060 D-5.3 already has it for a room:
   a knock-back by an item costs a racer their place on the screen, never their shelter.
3. **A draft reaches the trainer only the way riding harder does** (ADR 0066 D-7): a multiplier on
   the rider's `C_D·A` in the game's simulation and nothing else. No draft term reaches any trainer
   write: no grade, no wind, no rolling resistance, no ERG target. The rider arrives at the next
   grade sooner, and that is all the trainer feels. **This narrows ADR 0060 D-2.1's *"or when"***,
   which the ADR 0060 amendment names: under (b), where a bot rides decides the rider's `k`, so it
   decides *when* the grade at a given place is sent, though never *what* is sent. The owner is asked
   about exactly this narrowing (R-8). The owner's scope note on #2457 (*"no bot or race event reaches
   the trainer"*) is kept as to what is sent and in every other respect.
4. **ADR 0066 D-6's switch reaches the lap race.** Its last bullet said the switch has no effect in a
   lap race, because there was no draft there. With it **off**, no racer in the lap race drafts,
   bots included, so the race keeps one physics and is today's race to the bit. **On by default**,
   as ADR 0066 has it.
5. **`lap-race-cannot-reach-trainer.test.ts` is unchanged**, every line of it.
6. **`lap-race-wiring.test.tsx` is restated in #2461, and only as follows.** The test
   `sends the trainer the same writes, each grade at the same time, as an ordinary ride, a race with items off and one with the rider hit (D-2.1)`
   has its assertions kept as they are, with the switch set off: it does not set the switch today,
   and the switch is on by default, so #2461 adds that setup step and today's assertion then holds
   byte for byte. #2461 adds **one** assertion beside it: with the
   switch on, a race in which the rider sat in a bot's draft sends the trainer the same writes, each
   grade at the same time, as **an ordinary ride ridden at the same draft factor `k`, tick for tick**,
   as the race applied to the rider. Nothing else in that file changes.
7. **The solo Draft field and the *"with its draft"* mark in a lap race** (ADR 0066 D-5, D-6) **and
   the test that holds ADR 0066 D-2.** The author's recommendation (R-9): a lap race in which the
   rider sat in a bot's draft **shows the solo Draft field and marks the ride drafted** (ADR 0066
   D-5.6), subject to the same display preference (`draft-preference.ts`) as a solo ride; with D-3.4's
   switch off there is no field and no mark. The mark records what the rider was ridden at. The test
   `apps/web/src/game/solo-draft-wiring.test.tsx` › `no solo draft in a lap race — #2425, ADR 0066 D-2` › `drafts nobody behind the own ghost the chooser sends with a lap race`
   holds the rule this ADR supersedes, so #2461 restates it (D-4): its assertions are kept as they
   are, with the switch set off, and one assertion beside it holds the field and the mark with the
   switch on and the rider behind a bot.
8. **The patent risk is not covered by D-0.** The owner's ruling of 2026-11-10 sets the patent check
   aside **for racing strategy**. ADR 0038 D-7 covers live riders in a room, and ADR 0066 D-4 extends
   it to the solo pacer and the rider's own ghost and says in terms that it *"does not reach … lap-race
   bots"*. **Nothing on record accepts the risk of drafting lap-race bots**, so R-7 asks the owner to.
   As ADR 0066 D-4 says of itself, this is a risk decision, not a freedom-to-operate opinion (ADR
   0007 D1), and nothing was searched for it.

Under (c), D-3.1 to D-3.8 fall away and **all of these are taken out of this pull request**: the ADR
0066 amendment; the ADR 0038 amendment; the ADR 0060 D-2.1 sentence in its amendment; the ADR 0061
amendment's D-4 clause (ADR 0061 D-4 then stands, as solo races still have no drafting); the
mentions of ADR 0066 D-2 and D-6 as superseded in `docs/architecture.md` and
`docs/agents/adr-numbering.md`; and R-7 to R-9. Under (a), D-3.1's *"and to the rider"* and D-3.6 fall
away and ADR 0028 D-1 has to be answered first.

### D-4 — Which bot tests are replaced, by name (decision 4)

These are **behaviour tests, not safety gates**: they hold rules this ADR reverses. Each is in
`packages/physics/src/lap-race-bot.test.ts` on `origin/main` (`eba4b7eb`), and each is replaced by
**the change that makes it false**, named below, never before. Until then it stays green.

| `describe` | `it` | Holds | Replaced by | Replacement |
|---|---|---|---|---|
| `no rubber-banding (ADR 0060 D-9)` | `reads back the same power trace whether the bot leads the race or trails it` | ADR 0060 D-9.1 | #2463 (tactics wired) | **no bot's capacity changes with rank**: CP, W′ and peak read back equal whether the bot leads or trails, and a mutation that scales CP or W′ by rank goes red |
| `no rubber-banding (ADR 0060 D-9)` | `holds for every pace: a paced bot reads back one power trace leading or trailing (#2455)` | the same, for every pace | #2463 | the same, for every pace and archetype |
| `skill is its own axis, and never power (#1959, ADR 0060 D-9)` | `a crafty bot beats a naive one of the same tier more often than not, on the same power trace` | skill never changes power | #2462 / #2463 (tactics skill) | a crafty bot beats a naive one of the same tier and capacity more often than not, **with the same CP, W′ and peak** (the power traces may now differ, because spending is strategy) |
| `the race plan (#1960, ADR 0061 D-8)` | `holds every tier’s mean power to its tier, inside the surge ceiling and #92’s floor` | ADR 0061 D-8.1 and D-8.2 | #2458 (W′ balance) | **W′ balance never below 0 nor above W′, every tick**, and power inside the floor, the surge ceiling and 7 W/kg (D-1.3), on a flat and a hilly loop, items on and off |
| `each bot its own pace (#2455)` | `holds every style’s mean to its tier at either end of the band, inside the bounds of D-8.2` | ADR 0061 D-8.1 and D-8.2, per pace | #2458 | the same as the row above, for every style at either end of the ability band |
| `the race plan (#1960, ADR 0061 D-8)` | `rides the same power at one effort distance whatever items did to its race offset (D-3.3)` | ADR 0061 D-8.5 and D-3.3, with its rank-reading and drawn-distance mutations | #2462 / #2463, the first change whose strategy reads the drawn line or another racer | none: D-0 permits the read. Its determinism half is kept by `the same race gives the same decisions` |
| `the race plan (#1960, ADR 0061 D-8)` | `opens its sprint on its own effort distance, on the flat` | ADR 0061 D-8.6 | #2462, **only if** its kick is timed on the drawn line | the kick opens where the bot's strategy reads it should, asserted on what it reads |

**Kept as they are, by name** (`describe` › `it`):

- `tiers decide a race with no items` › `finishes three tiers in tier order on a flat 3-lap loop, every seed of 100`
- `the race plan (#1960, ADR 0061 D-8)` › `finishes fierce, hard, brisk and steady in that order with items off, every seed of 100` (ADR 0061 D-8.3, kept)
- `the race plan (#1960, ADR 0061 D-8)` › `surges on the climbs and eases on the descents of a seeded hilly loop` (D-8.4, kept)
- `each bot its own pace (#2455)` › `keeps the tiers in order with every bot on a pace the field dealt it, every seed of 100`
- `the same race gives the same decisions`, every `it` in it
- `its inputs are a tier, the pacing rule, the course and a seed (ADR 0007 D4)`, the type and import scans
- `a lap-race bot is the #92 bot, on the one physics`, every `it` in it

`packages/domain/src/lap-race/plan.test.ts`'s tests of the banking reserve go with the reserve in
#2458, replaced by #2458's own W′ balance tests (its acceptance criteria).

**Read through the HUD, in `apps/web`, #2458 restates these and nothing else in their files.** A
bot that starts with its whole W′ goes over its tier on the opening climb, which a bot with an
empty reserve never did. These tests read that old fact as the tier's signature, so each one is
restated against what a tier now is, the tier's surge ceiling, rather than weakened:

- `apps/web/src/game/lap-race-wiring.test.tsx` › `starts the race with the device’s assisted setting: items off and gentler bots (#1905)`: the bots' figures are held at or under Brisk's surge ceiling and over Steady's, rather than at or under Brisk's tier.
- `apps/web/src/game/lap-race-wiring.test.tsx` › `takes no lane or item press while the ride is paused, and the next ones once it rides again`: the held item is read without the puddle warning under it, which follows the bots and changes while the rider waits. The assertions are unchanged.
- `apps/web/src/game/lap-race-chooser.a11y.test.tsx` › `starts the race chosen: its laps, field, tier and items read back off the running race`: the figures are held at or under Steady's surge ceiling and over Steady's tier.
- `apps/web/src/game/lap-race/bot-figure.test.ts` (#2329): its clauses follow the chooser's words for a tier, which #2458 rewrites, and the mean-power clause goes with ADR 0061 D-8.1.

The wiring file's trainer-writes test (D-3.6) is not among them, and
`lap-race-cannot-reach-trainer.test.ts` is untouched.

**One more test holds a superseded rule, restated by #2461 and by nothing else**:
`apps/web/src/game/solo-draft-wiring.test.tsx` › `no solo draft in a lap race — #2425, ADR 0066 D-2`
› `drafts nobody behind the own ghost the chooser sends with a lap race`. It holds ADR 0066 D-2. It
stays green until #2461 makes it false, and is then restated as D-3.7 says: its assertions kept as
they are with the switch off, plus the field and the mark with it on (R-9).

### D-5 — Bots in rooms stay out; the arithmetic is room-portable (decision 5)

**The author's recommendation.**

1. **No bots in rooms.** ADR 0060 D-8 and D-14 Q3 are kept. This ADR is for the solo race.
2. **Room portability is a requirement now**, so that a later room ADR does not reopen the model:
   the W′ balance and every tactic use only `+ − × ÷`, comparisons, `Math.min`, `Math.max` and
   `Math.sqrt`, which IEEE 754 makes bit-identical on x86 and ARM, as `packages/physics/src/draft.ts`
   requires of itself. **No `Math.exp`, `Math.pow`, `Math.random` or `Date`**, held by a static scan
   of each new module.

### D-6 — What does not move

1. **The trainer (ADR 0059 D-2, ADR 0060 D-2).** No bot behaviour, item, race event or draft changes
   the trainer's resistance or ERG target, or when anything is sent to it, except as D-3.3 says a
   draft does (it narrows ADR 0060 D-2.1's *"or when"*, R-8). `lap-race-cannot-reach-trainer.test.ts` stays green **unmodified**.
2. **Determinism.** Pure seeded functions only: no clock and no `Math.random`. Draws go through
   `packages/domain/src/lap-race/random.ts` with their own named salt. The same seed replays byte for
   byte, and every number is a named, exported constant.
3. **Tick-rate independence.** Decisions and draws happen once per decision window, the `strategy.ts`
   pattern, never per tick, so the solo race at 50 ms and the tests at 1 s decide alike.
4. **Budget.** O(bots) per tick at 20 Hz, up to `LAP_RACE_MOST_BOTS` (7), nothing new allocated per
   tick.
5. **A bot is never a recorded ride** (ADR 0007 D4, ADR 0060 D-7.1): the type and import scans stay.
6. **Licence (CLAUDE.md §3)**: model, tactics and harness in `packages/domain` and `packages/physics`
   (Apache-2.0); wiring and the HUD in `apps/web` (AGPL-3.0-or-later). No new dependency.
7. **No coordinate or place name** in public text, the HUD or speech (`lap-race-no-place.test.tsx`).

### D-7 — Bots are fallible (decision 6)

**The author's recommendation.** A tactics **skill** axis (#2459) makes a bot misjudge the gaps and
the distance to the finish by a seeded error drawn once per decision window, so the field is **not
perfectly coordinated**: a naive bot goes too early or too late, a crafty one closer to right. The
error changes what a bot reads, never its capacity (D-1).

### D-8 — What the owner is asked to rule on this pull request

Accepting this ADR as written accepts each recommendation.

| # | Question | Recommended | Where |
|---|---|---|---|
| **R-1** | Capacity fixed from tier, archetype and seed; strategy spends it; no capacity change by rank | **Yes** | D-1 |
| **R-2** | The power model: the discrete differential W′ balance, replacing the banking reserve | **Yes** | D-2 |
| **R-3** | Drafting in the solo lap race: (a) bots only, (b) every racer, the rider included, (c) none | **(b)**, with ADR 0066 D-6's switch reaching the lap race and the wiring test restated as D-3.6 says | D-3 |
| **R-4** | The tests D-4 names, replaced by the changes it names, with the replacements it gives | **Yes** | D-4 |
| **R-5** | No bots in rooms; room-portable arithmetic required now | **Yes** | D-5 |
| **R-6** | A seeded skill error on the gaps and the finish distance | **Yes** | D-7 |
| **R-7** | The owner accepts the patent risk of drafting in a lap race (bots, and the rider behind them), as ADR 0038 D-7 and ADR 0066 D-4 did for rooms, the pacer and the ghost; D-0 does not cover it | **Yes**, under (a) or (b); moot under (c) | D-3.8 |
| **R-8** | ADR 0060 D-2.1's *"or when"* is narrowed: a bot's place decides the rider's `k` and so when a grade is sent; what is sent is unchanged | **Yes**, under (b); moot under (c) | D-3.3, D-6.1 |
| **R-9** | A lap race in which the rider drafted a bot shows the solo Draft field and is marked drafted (ADR 0066 D-5), and `solo-draft-wiring.test.tsx`'s lap-race test is restated | **Yes**, under (b); moot under (c) | D-3.7, D-4 |
| **R-10** | ADR 0061 D-8.2's −20 % floor stops applying while a bot is in a draft (`k` < 1) | **Yes** | D-1.3 |

---

## Consequences

### What this enables

- **Bots that race**: sit in, follow, attack, chase and bridge, a late flyer and a final-lap kick
  (#2462), dealt as archetypes within a tier (#2459), on a W′ balance that makes an attack cost
  something and a bot that spends its matches fade (#2458).
- **#2455's report is answerable**: a field that spreads, attacks and finishes plausibly, held by a
  headless seeded harness (#2464), rather than seven bots on one trace.

### What this costs, stated plainly

- **A bot's power now depends on the race**, the rider included. A bot that closes on a rider is
  doing so by choice. Riders may read that as rubber-banding even though its capacity never changes
  (D-1); D-1.2 and the harness are the answer, and the surge ceiling is still the knob.
- **The mean-power guarantee goes.** A bot no longer averages near its tier; it averages what its
  strategy spent of a fixed capacity, which is bounded by its W′ balance and D-8.2, not by a mean.
- **Drafting makes the race harder to reason about**: a rider's effort distance now carries shelter
  from bots, and every lap-race test that compares to an ordinary ride must say which `k` it means
  (D-3.6).
- **The patent reading that ADR 0060 D-9.3 and ADR 0061 D-6 rested on is set aside by the owner**,
  not re-done.

### Constraints this places on other work

| Issue | Constraint |
|---|---|
| #2458 | D-2's form and clamp; D-5.2's arithmetic; replaces the two D-8.1 tests D-4 names, and restates the `apps/web` tests D-4 names and no others; the banking reserve removed |
| #2459 | Archetypes change capacity at the start only (D-1.1); the skill axis is D-7's |
| #2460, #2461 | D-3: one model, `k` on effort distance, the switch, D-3.6's restatement and D-3.7's solo-draft-wiring restatement, and no other |
| #2462, #2463 | Decide once per window (D-6.3); replace the rank tests D-4 names when they make them false |
| #2464 | Asserts D-1.3's bounds and D-6.2's replay over its seeded fields |

### Reversing any of these

Each of D-1 to D-7 is reversed only by a superseding ADR. In particular, any rule that changes a
bot's CP, W′ or peak by its rank or a gap (D-1.2), any draft term reaching a trainer write (D-3.3),
and any bot in a room (D-5.1) needs one.

### Not decided here

- **Each tier's W′ and the re-entry threshold**: #2458's pull request proposes them.
- **The archetypes' power profiles and the tactics' weights**: #2459 and #2462 propose them.
- **Bots in rooms**: ADR 0060 D-8 stands.

## What would make this ADR wrong

- **Riders read strategy as rubber-banding** whatever the capacity rule says: a bot that sits in and
  kicks past a rider who led all race may feel like a cheat. Then the tactics' weights and the
  skill error are the knobs, and D-1 is the line they may not cross.
- **A draft reaches a trainer write** other than by the rider arriving sooner: then D-3.3 has failed,
  and the change is wrong rather than the gate.
- **The W′ balance cannot be made tick-rate independent within a named tolerance** at 50 ms and 1 s:
  then D-2's form is wrong for this game, and the integral form's `Math.exp` reopens D-5.2.
