# ADR 0075: AI bots race with bodies that fit their style and a spread of strength — superseding in part ADR 0071 D-1.3, ADR 0073 D-2.5 and D-5.1, and ADR 0067 D-1.3

- **Status**: **Proposed**, 2026-11-17. The owner approves it, or overrules any of D-9's questions,
  on #2759's pull request before it merges. **The build is in that pull request**: every decision
  here is written there behind bot-code version 4, so the owner can ride it on the tablet before
  ruling
- **Date**: 2026-11-17
- **Deciders**: **the owner**, whose ruling of 2026-11-17 is quoted in Context and is not argued
  again. **The author** decided what it leaves open, marked *the author's choice* where it is made.
  D-9 lists the questions the author asks the owner to confirm or overrule
- **Issue**: [#2759](https://github.com/openzigs/onyourleft/issues/2759), under the epic
  [#2706](https://github.com/openzigs/onyourleft/issues/2706). It builds on
  [#2724](https://github.com/openzigs/onyourleft/pull/2724) (#2710), which ships the AI bots
- **Number**: **0075**, the next free number on 2026-11-17 (`docs/agents/conventions.md` §7 and
  `docs/agents/adr-numbering.md` on #2724's branch). No open issue or pull request named it. 0072
  stays claimed by [#2712](https://github.com/openzigs/onyourleft/issues/2712), 0070 by #2684, and
  0057 and 0058 by #1748 and #1752. The next free number is then 0076
- **Supersedes, in part**, for **a model race only** (ADR 0071 D-1):
  - [ADR 0071](0071-model-chosen-lap-race-bot-tactics-during-a-ride.md) **D-1.3**'s words *"The
    physics, W′ balance, fixed capacity … are exactly the seeded race's. A model race differs from a
    seeded one only in which of the seven moves `decideTactic`'s caller rides"*: a model race now
    deals its own field (D-1, D-2, D-3). **D-1.4 stands**: a rider with no instance or no consent
    rides the seeded race, unchanged to the bit;
  - [ADR 0073](0073-ai-bots-race-with-strategy-freedom-inside-the-bodys-limits.md) **D-5.1**'s
    *"dealt apart from the bot's archetype … so a bot may race in a style its legs do not suit"*
    and its answer **R-4** in that part: the style now brings its legs (D-3). The every-style-once
    deal stands. And **D-2.5**'s *"it replaces the move's target power"* for the four moves made to
    gain ground: an effort there never softens the move (D-5);
  - [ADR 0067](0067-lap-race-bots-race-with-a-strategy-that-reads-the-race.md) **D-1.3**'s bounds
    read against the tier at `BOT_MASS_KILOGRAMS` (and through it ADR 0061 D-8.2's surge ceiling and
    floor *"of its tier"*): in a model race they are read against the bot's own strength at its own
    mass (D-2.4). **D-1.1 and D-1.2 stand**: capacity is fixed at the start, and nothing changes it
    by rank or gap.

  Each is a new ADR and not an amendment because it reverses part of a decision, and
  [ADR 0013](0013-adr-amendments.md) D-3 sends a reversed decision to a new ADR. ADR 0067, ADR 0071
  and ADR 0073 each gain one dated `## Amendments` entry pointing here; no body is edited
- **Leaves standing**: every seeded race, to the bit; ADR 0073 D-2 (the body's limits) and D-3 (the
  strategy rules lifted); ADR 0074 (the sprint instinct); ADR 0071 D-3.1 to D-3.4, D-4 to D-9 and
  D-11, its fallback (D-7) above all; ADR 0060 D-2.1 and D-2.2 and ADR 0067 D-3.6 (no race event
  reaches the trainer); ADR 0028 D-3 (the rider's own mass is never read for a bot)
- **Relates to**: [ADR 0036](0036-a-self-hostable-instance-server-now.md) D-3,
  [ADR 0004](0004-privacy-and-location.md) D

---

## Context

### What the owner ruled, quoted so it is not argued again

After the first tablet race with AI bots, on 2026-11-17, the owner wrote on #2759:

> **Owner ruling, 2026-11-17:** "The agent on the pc making the choices has to be realistic in
> nature to how riders would go. They should also have different personalities on the riders that
> could be strengths. not every race run over and over should produce the same results from ai
> bots"

and earlier the same morning, on nobody being dropped: *"Seems odd that none of the bots were
dropped but I guess they all have the same w/kg setting"*.

### What the first race showed, and what the bench shows

The tablet's decision log (ADR 0071 D-4), as #2759 records it: 4 laps in about 2.5 minutes; the
whole field finished within about 4 s; nobody was dropped; breakaways and attacks were mostly ridden
at `tempo` or `easy`, and `all-out` came only in the final sprint.

#2724's six full-distance races on the owner's PC, replayed from their logs under bot-code version 3
by #2759's harness (no model asked; the logs replay to the bit, ADR 0071 D-4.1), say the same on the
flat: **every bot finished within 0.1 to 0.5 s of the winner, and no bot was dropped**. On the hilly
circuit 1 to 5 bots were dropped and the field spread over 8 to 34 s. Of the 180 `flyer`s the model
named in the three flat races, 65 carried `tempo`.

### Why the field rode as one

- **One body.** Every bot rode at 75 kg (`BOT_MASS_KILOGRAMS`), at an ability from 94 % to 100 % of
  its tier (`pace.ts`), and its archetype's CP share from 95 % to 100 %. A field's CP in W/kg spanned
  at most about 11 %, all of it under the tier, and nothing made one bot strong where another is weak
  except its archetype's W′ and peak.
- **Style and body apart.** ADR 0073 D-5.1 dealt the racing style apart from the legs, so a bot told
  it is a climber could have a sprinter's body and the prompt could not say what it was good at.
- **A soft attack.** ADR 0073 D-2.5 lets an effort *replace* a move's target. `tempo` is 90 % of CP
  (`tactics.ts` §`BOT_EFFORT_CP_SHARE`), so an `attack` at `tempo` is ridden under CP, slower than
  sitting on the front. The model named that often.

### What is already right

- **The seed is drawn at every start**, from the platform's cryptographic source
  (`ride-race.ts` §`drawRaceSeed`), never kept per route or per ride. #2759 checked it and found no
  fixed seed; a test now holds it.
- **The model's temperature is 0.6** (`apps/instance` §`tactics-prompt.ts` §`tacticsRequest`), so
  two races on one seed already differ by what the model answers. A stored race still replays
  exactly from its seed and its log (ADR 0071 D-4).

## Decision

### D-1 — Scope: a model race only

Everything here is about a lap race the rider chose to ride with AI bots (ADR 0071 D-1). The field is
dealt at the start of such a race, from its seed, whatever the instance then answers; a model race
whose instance refuses it at the start (ADR 0071 D-6.3), or never answers, rides seeded tactics on
that field. **A seeded race is unchanged, to the bit**: its bots keep `pace.ts` §`botFieldPaces`,
75 kg, and every bound of ADR 0067 D-1.3. *The author's choice*: the issue is about AI bots, and the
seeded race's tier order (ADR 0061 D-8.3) and its tests stand untouched. Whether the seeded race
should get the same field is D-9 R-6.

### D-2 — A spread of strength, whose middle is the tier

1. **Each bot has a body**: a mass and a strength, dealt from the race's seed under their own salt
   (`packages/domain` §`model-field.ts` §`modelFieldPaces`), fixed at the start (ADR 0067 D-1.1).
2. **Strength** is dealt from 1 − 12 % to 1 + 12 % of the tier, one bot to each equal share of the
   band in an order the seed shuffles, so a field always spreads. Its CP, W′ and peak all scale with
   it, over its style's profile (D-3). **Mass** is its style's, give or take 3 kg.
3. **The field's middle is the tier the rider chose**: the whole field is scaled by one number so
   that its **mean CP in W/kg equals the tier's exactly**. A bot may now be over the tier as well as
   under it. Over 10 000 seeds a field of seven's strongest CP in W/kg is 7 % to 48 % over its
   weakest, and no bot is more than 23 % from the tier; the tiers are 22 % to 40 % apart. ⚠️ The
   12 % and the 3 kg are feel numbers for the owner.
4. **The bounds read against the bot's own body** (superseding ADR 0067 D-1.3 in part): its surge
   ceiling is `BOT_PLAN_SURGE_CEILING` (1.5) times its own strength at the tier's W/kg, at its own
   mass; its floor is −20 % of the same; and **7 W/kg is at its own mass**
   (`wbal.ts` §`botCeilingWatts`). The W′ balance is still never below 0 nor above W′, and an
   exhausted bot still rides no more than CP.
5. **The physics rides each bot at its own mass** (`physics` §`lapRaceBotPacerPlan`): a light bot
   climbs at its W/kg, and a heavy one has the watts on the flat. The rider's own mass is never read
   for a bot (ADR 0028 D-3), and the standings show each bot's W/kg at its own mass.

### D-3 — The racing style carries its body

The five styles are still dealt every-style-once from the seed (ADR 0073 D-5.1, kept). Each now
brings the pacing style whose archetype fits it, so its `legs` match, and a body profile:

| Style | Pace (legs) | Mass | CP, × tier W/kg | W′, × tier's at its mass | Peak, × tier W/kg |
|---|---|---|---|---|---|
| `breakaway` | `fast-start` (attacker) | 72 kg | 1.01 | 1.0 | 1.3 |
| `sprinter` | `sprinter` | 80 kg | 0.93 | 1.4 | 1.5 |
| `climber` | `climber` | 62 kg | 1.08 | 1.0 | 1.3 |
| `rouleur` | `even` (rouleur) | 78 kg | 1.0 | 0.9 | 1.25 |
| `opportunist` | `negative-split` (attacker) | 70 kg | 0.98 | 1.2 | 1.45 |

A sprinter is heavy, with the biggest W′ and the highest peak; a climber is light, with the most W/kg
and the fewest watts on the flat; a rouleur has the most watts at threshold; a breakaway rider holds a
high threshold; an opportunist has the punch to follow and counter. The five CP shares average 1.
Each bot keeps its archetype's recovery rate,
climb grade and launch distance. A bot's name in the standings is its pace's, as before (`Bolter`
for a breakaway rider, `Closer` for an opportunist, `Tempo` for a rouleur), so no rider-facing word
changes. ⚠️ Feel numbers for the owner.

### D-4 — The model is told each bot's strengths in plain words

Each bot's view gains four fields, each one of `strong`, `average` or `weak`
(`model-tactics.ts` §`MODEL_STRENGTH_WORDS`): **`flat`** (its CP in watts), **`climb`** (its CP per
kilogram), **`sprint`** (its peak in watts, as its body allows) and **`punch`** (its W′), each
compared with the mean of the whole field, finished bots included: `strong` at least 4 % over it,
`weak` at least 4 % under (`model-field.ts` §`modelFieldStrengths`). They are words from a closed
list, so the input stays within ADR 0071 D-3.4: nothing a coordinate, a name or a date could be
written into, and the instance's reader refuses any other word. They describe the bots only; nothing
new about the rider is sent.

### D-5 — An effort never softens a move made to gain ground

Superseding ADR 0073 D-2.5 in part. On **`attack`, `chase`, `flyer` and `kick`**
(`tactics.ts` §`BOT_HARD_TACTICS`), the effort a model names is ridden at **the harder of the
effort's target and the move's own**, so `easy`, `tempo` and `threshold` there ride the move as it
is (an attack at 1.3 × CP, a chase at 1.15 ×, a flyer at 1.1 ×, a kick at the peak) and `all-out`
rides it at the body's most. Everywhere else D-2.5 is unchanged: on the front with no wheel, a
`sit-in` or `follow` rides the effort's own share of CP, so `easy` and `tempo` still save energy
there; behind a wheel and on `recover`, an effort is ignored. **This is the definition of the four
moves, not a strategy rule**: the model still chooses whether to attack, when, at whom and how hard
above the move's own, and the body is still the only limit (ADR 0073 D-2). *The author's choice*,
D-9 R-3: the prompt alone (D-6) was the issue's ask, but gemma4:12b answers each bot's current move
back (ADR 0074's Context), and an attack ridden under CP is not an attack in any race.

### D-6 — The prompt: race to the strengths

The prompt (`tactics-prompt.ts`, version `tactics-5`) keeps ADR 0073 D-5's guidance and adds three
sentences, still guidance and not rules: what the strength words mean; that an attack, a chase and a
breakaway are hard efforts and a kick all-out; and that riders attack where their strengths pay
(climbers on climbs, rouleurs and breakaway riders on the flat, sprinters at the finish), let a
stronger rival go rather than blow up chasing, cover a move they are as strong as, and that a bot
that goes too hard for too long is dropped. The temperature stays 0.6 (Context).

### D-7 — Different every race, the same on replay

- **Between races**: the seed is drawn at every start (Context), and from it the styles, the bodies,
  the strengths, the skills and the misreads; the model, at temperature 0.6, answers differently
  again. #2759's pull request measures one seed ridden twice and reports how the two differ.
- **Within a replay**: nothing changes. The bots of a model race stay pure functions of the seed, the
  log, the bot-code version and the rider's per-tick input (ADR 0071 D-4). **The bot-code version
  rises to 4** (ADR 0071 D-4.3), `model-race-golden.json` gains a `"4"` key beside the others, and
  a log recorded under version 3 is not replayed under 4.

### D-8 — What does not move

- **The body is the only limit** (ADR 0073 D-2): no watts field, no tools, no model output at the
  trainer. `lap-race-cannot-reach-trainer.test.ts` and `lap-race-wiring.test.tsx`'s trainer-write
  equality are unmodified. A bot's mass and strength are the virtual rider's; nothing of them
  reaches a trainer write.
- **Capacity is fixed at the start** (ADR 0067 D-1.1 and D-1.2): no body, strength or bound changes
  with rank, gap or the rider's.
- **Every seeded race**, its bots, its 75 kg and its tier order.
- **The fallback** (ADR 0071 D-7) and **the sprint instinct** (ADR 0074).

### D-9 — Questions for the owner

| # | Question | The author's recommendation | Where |
|---|---|---|---|
| **R-1** | Approve ADR 0075 for model races: bodies that fit their style, a spread of strength whose mean is the tier, the strengths in the input, the prompt | **Approve** | whole |
| **R-2** | A spread of ±12 % of strength and ±3 kg, with the field's mean CP in W/kg held to the tier | **Yes**; tune it on the tablet if races still finish together or spread too far | D-2 |
| **R-3** | On `attack`, `chase`, `flyer` and `kick`, an effort rides the harder of itself and the move's own target, so an attack at `tempo` is still an attack | **Yes**: an attack under CP is no attack, and the model's choice of when and whom is untouched | D-5 |
| **R-4** | The style table's numbers (mass, CP, W′ and peak per style) | **Yes, as drafted**, for the tablet to judge | D-3 |
| **R-5** | Four strength words per bot in the model's input, against the field's mean, at a 4 % margin | **Yes** | D-4 |
| **R-6** | The seeded race (no instance, no consent) keeps its one-body field for now, or gets the same bodies in a follow-up | **Keep it for now**, and file a follow-up if the owner wants it: it changes the race every rider without an instance rides, and its tier-order guarantees | D-1 |

## Consequences

### What this enables

- **A field that can split.** A strong climber can ride away on a climb and a strong rouleur on the
  flat; a weak rider who follows a strong one's attack pays in W′ and can be dropped.
- **Personalities the model can play to.** A bot's style, legs and strengths agree, and the model
  is told them in words it can use.
- **Attacks that are attacks**, at any effort the model names.
- **A different race every time**, from the seed drawn at every start and the model's temperature.

### What this costs, stated plainly

- **A model race is no longer the seeded race with other moves** (ADR 0071 D-1.3). A rider who
  rides AI bots with the instance unavailable rides seeded tactics on the bodied field, not the
  seeded race's field.
- **The tier now means the field's middle, not every bot's ceiling.** A bot may be up to 23 % over
  the tier the rider picked. The rider who could hang on to every bot of a tier may now meet one
  they cannot.
- **More input.** Four short words per bot, at most about 500 characters for a field of seven, inside the
  4 096-character cap and a little more for the model to read each call. #2759's pull request
  reports the latency.
- **The bot-code version rises**, and logs recorded under version 3 stop replaying under 4.
- **The numbers are feel numbers.** Every share, the spread and the margin are drafts for the
  owner's tablet race.

### Constraints this places on other work

| Issue | Constraint |
|---|---|
| #2759 | The field, the input, the prompt and D-5 behind bot-code version 4; the measurement on the owner's PC of drops, lead changes, winners by style and the effort mix; the trainer gates unmodified; owner screenshots and a tablet race before merge |
| Any change to the seeded race's field | D-9 R-6 first |

### Reversing any of these

Each of D-1 to D-7 is reversed only by a superseding ADR. Putting a model race back on the seeded
race's field restores ADR 0071 D-1.3; letting an effort soften an attack again restores ADR 0073
D-2.5 as written.

### Not decided here

- **The seeded race's field** (D-9 R-6).
- **A higher surge ceiling for sprinters.** A sprinter's peak is still 1.5 × its strength at the
  tier: about 4.2 W/kg at `brisk`, far under a real sprint. Raising it is ADR 0061 D-8.2's knob.
- **A bot's frontal area.** Every bot keeps the same drag; a light rider is not made smaller.

## What would make this ADR wrong

- **The field still finishes together on the flat** on the tablet: then the spread is too small or
  the model never makes the moves that split it, and the fix is the spread (R-2) or the prompt.
- **The tier stops meaning what the rider picked**: if a `steady` field beats riders who chose it
  for being easy, the spread or the scale is wrong.
- **A model answer reaches a trainer write**, or **a blown bot rides over CP**: ADR 0073 D-2 has
  failed, and the build is wrong, not the rule.
