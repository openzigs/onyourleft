# ADR 0076: AI bots race with bodies that fit their style and a spread of strength — superseding in part ADR 0071 D-1.3, ADR 0073 D-2.5 and D-5.1, and ADR 0067 D-1.3

- **Status**: **Accepted**, 2026-11-17, by the owner on #2767, with the answers recorded in D-10.
  Proposed the same day. **The build is in that pull request**, behind bot-code version 4; it merges
  after the owner's tablet race
- **Date**: 2026-11-17
- **Deciders**: **the owner**, whose ruling of 2026-11-17 is quoted in Context and is not argued
  again. **The author** decided what it leaves open, marked *the author's choice* where it is made.
  D-9 lists the questions the author asks the owner to confirm or overrule
- **Issue**: [#2759](https://github.com/openzigs/onyourleft/issues/2759), under the epic
  [#2706](https://github.com/openzigs/onyourleft/issues/2706). It builds on
  [#2724](https://github.com/openzigs/onyourleft/pull/2724) (#2710), which ships the AI bots
- **Number**: **0076**. It was written on 2026-11-17 as 0075, the next free number on #2724's
  branch (`docs/agents/conventions.md` §7 and `docs/agents/adr-numbering.md`), and renumbered the
  same day because 0075 is #2600's ADR for the ride controls' fade, in pull request
  [#2670](https://github.com/openzigs/onyourleft/pull/2670), accepted by the owner. 0077 is claimed
  by [#2762](https://github.com/openzigs/onyourleft/pull/2762) if it needs one. 0072 stays claimed
  by [#2712](https://github.com/openzigs/onyourleft/issues/2712), 0070 by #2684, and 0057 and 0058
  by #1748 and #1752. The next free number is then 0078
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
| **R-1** | Approve ADR 0076 for model races: bodies that fit their style, a spread of strength whose mean is the tier, the strengths in the input, the prompt | **Approve** | whole |
| **R-2** | A spread of ±12 % of strength and ±3 kg, with the field's mean CP in W/kg held to the tier | **Yes**; tune it on the tablet if races still finish together or spread too far | D-2 |
| **R-3** | On `attack`, `chase`, `flyer` and `kick`, an effort rides the harder of itself and the move's own target, so an attack at `tempo` is still an attack | **Yes**: an attack under CP is no attack, and the model's choice of when and whom is untouched | D-5 |
| **R-4** | The style table's numbers (mass, CP, W′ and peak per style) | **Yes, as drafted**, for the tablet to judge | D-3 |
| **R-5** | Four strength words per bot in the model's input, against the field's mean, at a 4 % margin | **Yes** | D-4 |
| **R-6** | The seeded race (no instance, no consent) keeps its one-body field for now, or gets the same bodies in a follow-up | **Keep it for now**, and file a follow-up if the owner wants it: it changes the race every rider without an instance rides, and its tier-order guarantees | D-1 |

### D-10 — The owner's answers

**Owner ruling, 2026-11-17:** asked R-1 to R-6 in plain words, the owner first asked whether R-2's
"±3" meant watts per kilogram (*"For 2 do you mean they can maintain +-3 watts per kg?"*). It was
explained that ±3 is kilograms of body mass, and that strength is ±12 % of the tier (about 2.6 to
3.4 W/kg at a 3.0 W/kg tier, with the field's mean held to the tier). The owner then answered *"I
agree with all your recommendations"*. So:

- **R-1**: ADR 0076 is approved.
- **R-2**: a spread of ±12 % of strength and ±3 kg of mass, with the field's mean CP in W/kg held to
  the tier, to be tuned after a tablet race if needed.
- **R-3**: on `attack`, `chase`, `flyer` and `kick` an effort rides the harder of itself and the
  move's own target.
- **R-4**: the style table's numbers, as drafted, for the tablet to judge.
- **R-5**: four strength words per bot in the model's input, against the field's mean at a 4 %
  margin.
- **R-6**: the seeded race keeps its one-body field for now.

### D-11 — The cadence and the call, after the first tablet race (2026-11-17)

**Recorded 2026-11-17, after D-10, as a decision of this build** (*the author's choice*): ADR 0071
D-7 leaves the cadence to the build, so none of this is an owner ruling, and D-1 to D-10 are
unchanged by it.

- **Why.** On the owner's tablet, 2026-11-17 (ride build `fec90720`, the PC on a preview of this
  branch), **41 of 46 asks were given up as late** at 5 s, each booked at 5 050 ms, while the PC's
  own log gave the model a median 3.9 s and at most 4.5 s. The round trip through the instance's
  Cloudflare tunnel adds more than a second, and the race rode almost entirely on seeded tactics.
  Every earlier figure (ADR 0071's, spike 0039's and this ADR's "What was measured") was server
  time on the PC.
- **D-11.1 — Late at 8 s.** `MODEL_TACTICS_LATE_MS` is **8 000 ms** of race time from the ask: an
  answer that arrives later is logged `late` and never applied, and a call still out that long is
  given up and the next one asked. **The race never waits on the model**: asks still go out only
  between frames, one at a time, and a tick never waits for one.
- **D-11.2 — A decision holds 10 s.** `MODEL_TACTICS_HOLD_MS` is **10 000 ms** from the window it
  applies in. A decision still applies from the next 1 s tactics window after it arrives, and the
  next ask still goes out at the next 4 s mark after a call settles (`MODEL_TACTICS_ASK_EVERY_MS`
  stays 4 000 ms). So a call of more than 4 s, the tablet's every call, brings decisions about 8 s
  apart, and 10 s holds one until the next lands with 2 s for a slower successor. The old 5 s hold
  left a 3 s gap of seeded tactics between two such decisions. A late or missing answer still lets
  the field fall back to its seeded tactics, after 10 s.
- **D-11.3 — Bot-code version 5.** The hold changes which moves are in force for a logged race, so
  `LAP_RACE_BOT_CODE_VERSION` rises to **5** and `model-race-golden.json` gains a `"5"` key (D-7).
  A log recorded under version 4 is not replayed under 5.
- **D-11.4 — A shorter call.** The input drops each bot's `legs`, which its style decides since D-3,
  and the count of racers, which the prompt never read; gaps are whole metres, the grade a whole
  percent and W′ a tenth. Every other key and its meaning stand, and the device and the instance
  still read the input with the one reader, so the two cannot disagree. The answer's schema lets
  only a `follow` or a `chase` name a `target` (no other move reads one, and the model wrote one on
  most `sit-in`s) and lists at most one move a seat, so a model that repeats itself stops at the
  end of the field. The instance caps an answer at **256 tokens** (it was 400): the longest answer
  the schema admits for seven bots is about 180. `think: false` stays. The prompt is `tactics-6`:
  it names the style where it named the legs, and says that only `follow` and `chase` read a
  target. Nothing in it about racing changes.
- **D-11.5 — What it does not reach.** The aim was a median under 3 s of server time on the PC. It
  is not reached: see "What was measured", 2026-11-17 (evening). What remains is the ~1 550-token
  system prompt, read in full on every call, and some 85 to 100 tokens of answer at about 21 ms
  each. Neither moves without shortening the approved prompt or changing the model server's
  settings, which this build does not do.

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

## What was measured

On the owner's PC (`ssh zigs`, `gemma4:12b`, `think:false`, Ollama's settings unchanged), through
the shipped `startLapRaceRide`, `askLapRaceRide` and `answerLapRaceRide` with this prompt
(`tactics-5`), on #2724's harness races: 3 laps of the flat and the hilly 628 m circuit, 7 `brisk`
bots, the rider at 200 W and 8 m/s, each answer booked at the server's own duration after its ask.
Version 3 is #2724's six logged races replayed under version 3 from their logs, asking nothing. A
bot is **dropped** when it is more than 50 m behind the racer ahead of it for 10 s, after the first
30 s. **Spread** is the first bot's finish to the last's.

| | Version 3 (#2724's logs) | Version 4 (this ADR) |
|---|---|---|
| Flat: spread | 0.1, 0.5, 0.4 s | 12.3, 13.9, 2.4, 1.9 s |
| Flat: bots dropped | 0, 0, 0 | 1, 1, 0, 0 |
| Hilly: spread | 8.4, 33.6, 21.1 s | 51.9, 37.6, 27.1, 44.7 s |
| Hilly: bots dropped | 1, 5, 4 | 6, 5, 5, 5 |
| Lead changes, flat / hilly | 22–27 / 18–26 | 9–28 / 6–15 |
| Winners, flat | sprinter, breakaway, breakaway | sprinter in all four |
| Winners, hilly | breakaway in all three | opportunist 3, sprinter 1 |
| `flyer` efforts named | 420: 167 `tempo`, 183 none, 61 `threshold`, 9 `all-out` | 453: 389 `threshold`, 64 none, no `tempo` or `easy` |
| `attack` efforts named | 29: 25 `threshold`, 4 none | 93: all `threshold` |
| Calls | 275, 274 valid, 1 late; median 3.47 s | 367, 365 valid, 0 late; median 3.56 s, p90 4.34 s, highest 4.93 s |

Read plainly:

- **A hilly race splits**, and the field is no longer one group: five or six of seven bots are
  dropped, and the punchiest bodies (opportunists, a big W′ and a high peak) win. **A flat race ends
  in a bunch sprint**, as a flat club race does, won by a sprinter, though the bunch now spreads
  over 2 to 14 s where it finished inside half a second.
- **Attacks and breakaways are ridden hard**: the model named no `flyer` at `tempo` or `easy`, and
  D-5 would have ridden one at the move's own target if it had.
- **No bot blew** (emptied its W′) in any version 4 race; under version 3 one bot blew in each hilly
  race. Bots that go too hard pay by being dropped, not by blowing.
- **A climber won no race.** On the hilly circuit, whose climbs are 12 m and as long as its
  descents, the punchy bodies win; the climber's share was raised from 1.06 to 1.08 and its W′ from
  0.85 to 1.0 after the first round, and its best was second. Every bot has the same frontal area,
  so a light rider gains nothing on the flat or downhill (Not decided here).
- **Different every race, the same seed alike.** Each race draws its seed at the start, so its field
  and its winner differ; seeds 1, 2 and 3 gave three different fields and podiums. One seed ridden
  twice gave the same top two on the flat and the same order on the hills, with different gaps
  (12.3 and 13.9 s; 37.6 and 27.1 s): the bodies decide the order, and the model's temperature the
  margins.
- **The longer prompt did not slow the call past its limit**: no answer was late, but the highest,
  4.93 s, is close to the 5 s late limit (ADR 0071 D-7).

### 2026-11-17 (evening): the call's latency and the tablet's round trip (D-11)

On the owner's PC (`ssh zigs`, straight to Ollama on loopback as above, `gemma4:12b`, `think:false`,
Ollama's settings unchanged and the PC not redeployed), through the same harness. **Server time**
is Ollama's own `total_duration`.

| | Before D-11 (`tactics-5`, 400 tokens) | After D-11 (`tactics-6`, 256 tokens, the schema) |
|---|---|---|
| Calls, in races | 40 (flat 1, hilly 2), all valid | 60 (flat 3, hilly 3), all valid, none late |
| Server time | median 4.02 s, p90 5.07 s, highest 5.48 s | median 4.00 s, p90 4.58 s, highest 5.62 s |
| Reading the prompt | 1.36 s, 2 201 tokens | 1.28 s, 2 136 tokens |
| Writing the answer | 2.40 s, 117 tokens | 2.19 s, 105 tokens |
| Neither (queue, sampler) | 0.05 s | 0.73 s |
| A target on a move that reads none | 217 of 268 moves | 0 of 418 |

The two columns ran half an hour apart, and in between the PC took on other work: its GPU was at
about 50 % with no call of this measurement out, and the time outside reading and writing rose
from 0.05 s to 0.6 to 0.7 s a call in every run after. So the columns do not compare by
themselves. **The comparison is an interleaved one**: 28 race states, each asked of both
versions in the same minute, in alternating order. Paired, D-11 saved a median **0.36 s** of server
time (14 states read cold by both), 0.28 s of writing and 9.5 tokens of answer (all 28), and 0.05 s
of reading. Ollama re-reads nearly the whole prompt whenever any of it changes, so trimming the
input buys little: an identical prompt read in 0.2 to 0.45 s, one with only its last field changed
in 1.0 s, and one changed at its first key in 1.35 s, as long as a new one.

**The target of a median under 3 s is not met** (D-11.5). About 1 550 of the 2 136 prompt tokens
are the system text, and the answer is 85 to 105 tokens at about 21 ms each.

**One answer ran away**, without the schema's `maxItems`: it named seat 6 again and again until the
256-token cap ended it at 6.9 s, where 400 would have run past 9 s. With `maxItems` the schema
admits no eighth move; no runaway happened in the 60 calls after, so that is not seen working,
only held by the schema.

**The tablet's round trip** was not measured from a sealed client. The instance's own tool for that
(`apps/instance/tools/replan-round-trip.ts`) signs throwaway accounts up, which on the owner's
instance needs open registration and the operator's switch for other riders, and the tactics
route a consent and the model race slot: changes to the owner's live instance this build does
not make. So it is estimated, from `curl -w` of `/health` at `https://onyourleft-win.openzigs.com`
from the build machine on the same evening: **0.44 s** a request on a connection already open
(0.39 to 0.48 s, 11 requests) and **1.9 s** on a new one (0.96 to 2.44 s, 10). Added to each
measured server time, with 0.1 s for the frame that books the answer:

| Device round trip, estimated | Median | p90 | Late at 5 s | Late at 8 s |
|---|---|---|---|---|
| Before D-11, a new connection each call | 6.0 s | 7.1 s | 86 % | 0.25 % |
| After D-11, a new connection each call | 5.8 s | 6.8 s | 83 % | 0.5 % |
| After D-11, one connection kept open | 4.5 s | 5.1 s | 20 % | 0 |

The tablet's own race, 41 late of 46 (89 %), is what a new connection each call predicts (86 %),
so **expect about 0.5 % of asks late at 8 s**, the highest estimate 8.15 s, and none on a
connection kept open.

## What would make this ADR wrong

- **The field still finishes together on the flat** on the tablet: then the spread is too small or
  the model never makes the moves that split it, and the fix is the spread (R-2) or the prompt.
- **The tier stops meaning what the rider picked**: if a `steady` field beats riders who chose it
  for being easy, the spread or the scale is wrong.
- **A model answer reaches a trainer write**, or **a blown bot rides over CP**: ADR 0073 D-2 has
  failed, and the build is wrong, not the rule.

## Amendments

- **2026-11-18** — **Once [ADR 0081](0081-ai-bots-asked-one-at-a-time-from-a-menu-and-sit-in-is-no-opinion.md) is Accepted, D-11's figures for the call are superseded by
  it.** The device asks about one bot at a time, no more often than once a second, where D-11 had
  one call for the field every 4 s; the answer is capped at 48 tokens, where D-11 had 256; and the
  trimmed race state is what an ask for one bot is made from, no longer what is sent. **The 8 s
  late limit and the 10 s hold are unchanged**, the hold now for each bot. D-1 to D-10 are
  unchanged. Read ADR 0081 for the rule. This entry only points there; nothing else in this ADR
  changes. (#2836)
