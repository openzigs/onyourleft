# ADR 0061: Lap-race bots — a course-only energy plan, never another racer

- **Status**: **Accepted, 2026-11-01**, on the owner's
  [ruling of that day](https://github.com/openzigs/onyourleft/pull/1984#issuecomment-6557317199) on pull request #1984: Q1 *"Accept"*; Q2 *"Surge up, keep floor"*,
  answer (a); Q3 *"Confirm"*; Q4 and Q5 *"Short spike, add note"*. D-7 quotes the ruling and records
  each answer. Proposed 2026-11-01
- **Date**: 2026-11-01
- **Deciders**: **the owner**, on the request of 2026-10-31 for smarter bots
  ([#1960](https://github.com/openzigs/onyourleft/issues/1960)) and the ruling of 2026-11-01 on pull
  request [#1977](https://github.com/openzigs/onyourleft/pull/1977) that the plan be a new ADR rather
  than an amendment to ADR 0060. The author drafted it for that approval. Every recommendation here is
  the author's engineering reading and says so
- **Issue**: [#1960](https://github.com/openzigs/onyourleft/issues/1960) (lap-race bots: a
  course-only race plan, never reading their place), of the lap-race epic
  [#1894](https://github.com/openzigs/onyourleft/issues/1894)
- **Number**: **0061**. On 2026-11-01 `main` (`9f66b2e3`) holds no `docs/adr/` file numbered 0061,
  no open pull request adds one, and no issue claims 0061. **0057 is claimed by
  [#1748](https://github.com/openzigs/onyourleft/issues/1748) and 0058 by
  [#1752](https://github.com/openzigs/onyourleft/issues/1752)**, both by their titles and both
  unwritten, and are left alone as ADR 0059 and ADR 0060 left them
- **Supersedes**: **one clause of [ADR 0060](0060-the-lap-race-effort-distance-and-a-bounded-race-offset.md)
  D-9.2 and nothing else**: its reason *"it keeps a bot's power a function of its tier and the road
  only"*. ADR 0013 D-3's last row sends a decision whose reasoning has been overtaken to a superseding
  ADR, and this is that case. **ADR 0060's decision D-9.1 (no rubber-banding by rank), its D-9.3
  (the patent reading) and its D-14 Q4 answer stand unchanged, and this ADR adds to them.** ADR
  0060's body is not edited. On the owner's D-7 Q5 answer, a dated entry appended to its
  `## Amendments` section (ADR 0013) points here for D-9.2's reason clause, and does nothing else
- **Relates to**: [ADR 0060](0060-the-lap-race-effort-distance-and-a-bounded-race-offset.md) D-2
  (no game event reaches the trainer), D-3 (effort distance and the bounded race offset, B = 10 m),
  D-4.3 (no rule of catch-up changes power), D-5.1 and D-5.3 (what items move; drafting reads effort
  distance), D-7 (bots are #92 bots), D-8 (no bots in rooms) and D-9 (no rubber-banding);
  [ADR 0007](0007-patent-posture.md) D4 (the bot pacer ✅, a ghost of another rider ❌);
  [ADR 0013](0013-adr-amendments.md) D-3 (why this is an ADR and not an amendment);
  [ADR 0028](0028-racing-fairness.md) D-1 (one physics); spike 0030
  (`docs/spikes/0030-lap-race-expression-line-and-patent-read.md`) §3.2, the patent reading D-6
  rests on; [#92](https://github.com/openzigs/onyourleft/issues/92) (the bot pacer and its envelope);
  [#1900](https://github.com/openzigs/onyourleft/issues/1900) (the bots' item and lane choices, and
  the lead-or-trail test); [#1959](https://github.com/openzigs/onyourleft/issues/1959) (the sibling
  tactics issue); [#1952](https://github.com/openzigs/onyourleft/issues/1952) (the trainer seam walk);
  [#1955](https://github.com/openzigs/onyourleft/issues/1955) (the scans that no bot is built from a
  recorded ride)

---

## Context

### What is asked

On 2026-10-31 the owner asked for smarter bots in the lap race (#1960). Today a bot holds its tier's
target W/kg (`steady` 2, `brisk` 2.8, `hard` 3.6, `fierce` 4.4, in `packages/domain/src/lap-race/bots.ts`, at
`BOT_MASS_KILOGRAMS`, 75 kg, defined in `packages/domain/src/pacer/pacing.ts` and imported there), shaped by the road through #92's grade pacing
(`packages/domain/src/pacer/pacing.ts`) and ridden through `packages/physics` §`advanceBot` and
§`advance`. #1960 gives a bot a **race plan**: an energy budget in the critical-power and W′ style,
so that it surges on climbs, recovers on descents and sprints the closing distance, while its average
stays at its tier.

### Why an ADR, and why a new one

ADR 0060 D-9.2 gives as D-9's reason that it *"keeps a bot's power a function of its tier and the road
only"*. A plan that also reads the distance left and the bot's own spent budget is outside those words.
#1960 asked for an `## Amendments` entry on ADR 0060, and #1977 drafted one. Its review pointed out
that ADR 0013 D-3 sends a decision whose **reasoning** has been overtaken to a superseding ADR, and
that ADR 0060's own *Reversing any of these* section says an amendment *"may not change a decision"*.
**On 2026-11-01 the owner ruled on #1977 that the plan is a new ADR 0061.** This is that ADR. It
carries #1977's text over with every review point folded in, and #1977 is to be closed unmerged.

### What exists today (read at `origin/main` `9f66b2e3`)

- **#92's pacing envelope** is a band around the flat power, **+10 % and −20 %**:
  `PACING_MAXIMUM_UPLIFT` (0.1) and `PACING_MAXIMUM_EASING` (0.2), giving `PACING_FACTOR_CEILING`
  (1.1) and `PACING_FACTOR_FLOOR` (0.8) in `pacing.ts`, tested by `pacing.test.ts`'s *"dynamic
  pacing: the envelope"*. ⚠️ **This is what "#92's envelope" means in the code.** #1960's body uses the
  phrase for something else, the 0.5 to 7 W/kg bounds below, and the two are kept apart here.
- **#92's intensity bounds**, `MINIMUM_INTENSITY_WATTS_PER_KILOGRAM` (0.5) and
  `MAXIMUM_INTENSITY_WATTS_PER_KILOGRAM` (7), bound the **intensity a rider may choose** for a bot.
  They are not today a bound on the bot's power from moment to moment.
- **A critical-power model** exists in `packages/domain/src/analysis/critical-power.ts`, for a
  rider's own analysis.
- **A bot has no draft.** `advanceBot` passes `advance` no drafting multiplier. Bots are never in
  rooms (ADR 0060 D-8, D-14 Q3), and drafting exists only in a room, as the creator's choice
  (D-5.3, D-14 Q8).
- **Two distances** (ADR 0060 D-3). `effortDistance` is earned by the racer's own power; `raceOffset`
  is moved only by items, clamped to ±B with **B = 10 m**; laps and the finish are counted at the
  drawn distance, their sum (D-3.3). Other racers' items move a bot's `raceOffset` (D-5.1).
- **#1900's test** (`packages/physics/src/lap-race-bot.test.ts`, *"reads back the same power trace
  whether the bot leads the race or trails it"*) holds D-9.1 today.

---

## Decision

### D-1 — The rule

**A lap-race bot's power is a function of its tier, the road, the distance it has left and its own
energy budget, and never of any other racer.** Any randomness in it comes from the race's own seed.
This replaces ADR 0060 D-9.2's clause quoted above, for lap-race bots only. #92's pacer outside the
lap race is unchanged. ADR 0060 D-9.1 is unchanged and is a consequence of this rule: a bot that
reads no other racer cannot vary its power with its place.

### D-2 — What the plan may read

1. **The bot's tier.**
2. **The course**: the grade along the loop, the lap length, the lap count and the race length. The
   plan is fixed from the course before the start.
3. **The bot's own `effortDistance`.** The distance left is the race length less it, and the bot's
   lap is its `effortDistance` over the lap length, never the race's lap counter.
4. **The budget the bot itself has spent**, in the critical-power and W′ style of `critical-power.ts`:
   a reserve of work above the tier's power that a climb or the closing distance draws down and an
   easier stretch refills.
5. **Each step is pure and seeded.** Given the tier, the course, the seed and the bot's own state, the
   step returns the same power. Power still goes through `advanceBot` and `advance` (ADR 0060 D-7.1):
   no new physics.

**What follows from 3, and what it costs.** The plan's distance left is measured on `effortDistance`,
but the bot finishes at its drawn distance (ADR 0060 D-3.3). **So the closing sprint starts up to B
(10 m) early or late relative to the line the rider sees**, and the code that follows must not assert
that a bot sprints *at the line*; it asserts the sprint against `effortDistance`. A bot whose effort
distance has reached the race length while items hold its drawn distance short of the line has a
distance left of zero or less, and the plan defines its power there: **with no distance left, the
bot holds its last segment's power, and nothing in the plan reads when its drawn distance
finishes**. The race ending the bot's ride is the race's rule, not the plan's. **Past the race
length the budget is spent and refilled by the same rule as everywhere else, and it never goes
below zero**: a bot whose budget is empty rides at no more than its tier's power until it refills,
so holding a sprint segment for up to B more metres cannot overdraw it. That is the price of D-3's
exclusion below, and it is accepted.

### D-3 — What the plan may never read

1. **Any other racer's** place, power, `effortDistance`, drawn distance, `raceOffset`, gap to the bot
   or finish.
2. **The bot's own place or rank.**
3. **The bot's own `raceOffset` and drawn distance** (`effortDistance + raceOffset`), and the race's
   lap counter, which counts at the drawn distance. This is the one that is easy to miss: other racers'
   items move a bot's `raceOffset` (ADR 0060 D-5.1), so a plan that measured the distance left on the
   drawn distance would make the bot's power depend on what another racer did.
4. **The bots' item and lane choices** (`packages/domain/src/lap-race/bots.ts` §`botDecision`, #1900)
   read the race as they do today and are not power. #1959 keeps to that.

### D-4 — The dependency on solo races having no drafting

D-1's *"never of any other racer"* holds through D-2.3 only because a bot's `effortDistance` depends
on its own power alone. **That is true because a solo race has no drafting**: `advanceBot` passes no
draft multiplier, and ADR 0060 D-8 keeps bots out of rooms, where drafting lives (D-5.3, D-14 Q8). If
D-8 is revisited and a bot rides in a room with drafting on, its `effortDistance` carries the
shelter of the racer ahead, and *"distance left"* becomes a function of another racer through the one
distance this ADR permits. **A superseding ADR must then say first how the plan stays independent of
it** (for example, a distance left measured on an undrafted shadow distance). Nothing here is
filed for bots in rooms.

### D-5 — What does not move

1. **ADR 0060 D-7.1**: power comes from the tier through a pacing rule into `advanceBot` and
   `advance`, and **a bot is never built from a recorded ride** of any rider (ADR 0007 D4; #1955's
   scans).
2. **ADR 0060 D-2**: no game event reaches the trainer (#1952's walk). The plan changes a virtual
   bot's power only, and adds no path to the trainer-command seam.
3. **ADR 0060 D-5.2 and D-8**: no item changes any racer's power, physics or drafting, and there are
   still no bots in rooms.
4. **ADR 0060 D-4.3, as read here.** D-4.3 says *"no item and no rule changes any rider's grade, mass,
   `C_D·A`, rolling resistance, drafting multiplier or power, ever"*, and D-7.2 says a bot is a racer
   like any other. **This ADR reads D-4.3 as a rule about catch-up and items**: its sentence opens
   *"Catch-up comes only from item strength weighted by race position"*, and #92's grade pacing
   already varies a bot's power without breaking it. A bot's plan is the bot's own source of power
   (D-7.1), as a rider's legs are the rider's, not a rule acting on it. On that reading D-4.3 is
   untouched. The reading is the author's, and D-7 Q3 puts it to the owner.

### D-6 — The patent reading

Spike 0030 §3.2 reads US 7,278,913 claim 1 as needing a **target rank** set for each computer racer
and a performance value changed according to it. The plan sets no rank and reads none (D-3), so ADR
0060 D-9.3's reading holds by construction. **Spike 0030 was not re-run for this ADR, and no search
was made for claims on energy-budget or W′ pacing of computer opponents.** That is an engineering
reading, not a patent search. On the owner's D-7 Q4 answer, a short spike makes that search
([#1985](https://github.com/openzigs/onyourleft/issues/1985)), and it must finish before #1960's code
pull request merges; the code may be written meanwhile.

### D-7 — What the owner is asked to rule on

Accepting this ADR as written accepts each proposal.

| # | Question | Proposed | Owner's answer, 2026-11-01 | Where |
|---|---|---|---|---|
| **Q1** | The rule, as worded in D-1, as a new ADR that supersedes only ADR 0060 D-9.2's reason clause and leaves D-9.1, D-9.3 and D-14 Q4 standing | **Accept** | **Accept**, *"Accept"* | D-1, Supersedes |
| **Q2** | **#92's +10 %/−20 % envelope** (`PACING_FACTOR_CEILING`/`FLOOR`): may a lap-race bot leave it? (a) leave the **ceiling**, bounded instead by a named surge ceiling over the tier's power and by 7 W/kg, and keep the −20 % floor; (b) stay inside the band, so a surge or a sprint is at most +10 %; (c) leave both sides, bounded by 0.5 and 7 W/kg only | **(a)**. A W′ plan must exceed +10 % on a climb and in the closing sprint, which (b) forbids; refilling the budget needs only power below the tier's, which the floor already allows; (c) lets a single surge reach 7 W/kg | **(a)**, *"Surge up, keep floor"*: above +10 % up to a named surge ceiling and never over 7 W/kg; the −20 % floor is kept | D-8.2 |
| **Q3** | The D-4.3 reading: a bot's own plan is its source of power, not a rule changing it | **Confirm** | **Confirm**, *"Confirm"* | D-5.4 |
| **Q4** | A patent search before the code? #1977 proposed none. The alternative is a short spike on energy-budget pacing of computer opponents before the code's pull request merges | **A short spike before the code merges**, not before it is written: spike 0030 searched for rank, and nothing searched for this | **A short spike before the code merges**, *"Short spike, add note"*: filed as [#1985](https://github.com/openzigs/onyourleft/issues/1985), a sub-issue of #1894, which #1960's code pull request names as a merge prerequisite | D-6 |
| **Q5** | On acceptance, append a dated pointer entry to ADR 0060's `## Amendments` (ADR 0013), saying D-9.2's clause is superseded by ADR 0061, as ADR 0033 gained one for ADR 0044? | **Yes**, in the accepting pull request, appended only | **Yes**, *"Short spike, add note"*: appended in the accepting pull request | Supersedes |

**The owner's ruling, 2026-11-01**, on pull request
[#1984](https://github.com/openzigs/onyourleft/pull/1984#issuecomment-6557317199), quoted:

> - Q1: "Accept" — the rule is accepted as ADR 0061, superseding only D-9.2's reason clause.
> - Q2: "Surge up, keep floor" — answer (a): a bot may go above #92's +10% up to a named surge
>   ceiling and never over 7 W/kg; the −20% floor is kept.
> - Q3: "Confirm" — D-4.3 is about catch-up; a bot's own plan is its source of power, not a rule
>   changing it.
> - Q4/Q5: "Short spike, add note" — a short patent spike on energy-budget pacing runs before the
>   code PR merges (the code may be written meanwhile); ADR 0060 gets a dated pointer entry under
>   `## Amendments`.

So every decision above is decided as proposed. **Under Q2 (a), a lap-race bot may leave #92's band
on the ceiling side only**, as D-8.2 bounds it.

### D-8 — The bounds, held as tests by the code that follows

1. **Mean power**: a bot's time-weighted mean power over a race stays within a stated tolerance of
   its tier's W/kg × `BOT_MASS_KILOGRAMS`. The tolerance is a named, exported constant that the code's
   pull request proposes and the owner approves there.
2. **Power bounds** (Q2 (a)): above, a bot's power stays under a **named surge ceiling** over the
   tier's power and never over `MAXIMUM_INTENSITY_WATTS_PER_KILOGRAM` (7) at `BOT_MASS_KILOGRAMS`
   (75 kg), so the surge ceiling is at most 7 W/kg; it may exceed `PACING_FACTOR_CEILING`. Below, it
   stays at or over `PACING_FACTOR_FLOOR` (−20 %) of the tier's power, as #92's band does today. The
   surge ceiling is a named, exported constant that the code's pull request proposes and the owner
   approves there.
3. **Tier order**: with items off, `fierce`, `hard`, `brisk` and `steady` finish in that order over
   100 seeds.
4. **Surges follow the course**: on a seeded hilly loop, the bot's power on climbs is above its power
   on descents.
5. **D-1 holds**: #1900's lead-or-trail test is kept, and the same bot on the same course with the
   same seed reads back **an identical power as a function of its own `effortDistance`**, over every
   effort distance both runs reach, whatever the other racers and their items do. A run that items
   end sooner at the drawn line covers less effort distance and is compared over the stretch it rode;
   that is not a difference. A mutation that reads rank, and one that measures the distance left on
   the drawn distance, are each proven to turn it red.
6. **The sprint is asserted on `effortDistance`** (D-2), never at the drawn line.

---

## Consequences

### What this enables

- **#1960's code has a rule to be checked against**: the model in `packages/domain` (Apache-2.0,
  platform-free), its budget per tier as named constants, and the six tests of D-8.
- **Bots race like riders**: they attack climbs, ease on descents and sprint the close, with an
  average held at their tier (D-8.1).

### What this costs

- **A bot's sprint is not timed to the visible line.** It can start up to B (10 m) early or late,
  because the plan reads effort distance (D-2).
- **Bots still do not catch up.** A rider well ahead of a tier stays ahead; the plan reshapes a bot's
  effort, it does not raise it.
- **The no-other-racer rule rests on there being no drafting for bots** (D-4). Revisiting ADR 0060
  D-8 now has one more thing to answer.
- **Two named constants to choose** (the mean tolerance and the surge ceiling of Q2 (a)), both
  feel numbers rather than measured ones, as #92's 8 % and −6 % references are.

### Reversing any of these

Each of D-1 to D-8 is reversed only by a superseding ADR. In particular, a plan that reads any other
racer, the bot's own rank, its `raceOffset` or its drawn distance (D-3) needs one, and so does any
bot in a drafting room (D-4).

### Not decided here

- **The mean tolerance and the surge ceiling's values**: the code's pull request proposes them.
- **The bots' tactics** (items and lanes): #1959, under ADR 0060.
- **Bots in rooms**: ADR 0060 D-8 stands.

## What would make this ADR wrong

- **A bot's `effortDistance` comes to depend on another racer**: drafting for bots, a room with bots,
  or an item that moves effort distance. D-1's guarantee then fails through D-2.3 (D-4).
- **A search finds a claim on energy-budget pacing of computer opponents** (D-6, Q4, #1985), or spike 0030's
  '913 reading is overtaken (ADR 0060's own list).
- **Riders read a bot's surge as rubber-banding**: a climb attack that happens to land as the rider
  closes in looks like catch-up whatever its cause. The fixed-from-the-course plan is the answer, and
  if riders do not believe it, the surge ceiling is the knob.
