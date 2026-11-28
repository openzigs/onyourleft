# ADR 0101: The AI group ride — a solo ride in a paceline of synthetic riders that coaches the rotation and never drops the rider

- **Status**: **Accepted, 2026-11-26**, by the owner, 2026-11-26, on its pull request (#3326):
  "Accept all 20". **The owner's four rulings of 2026-11-26** (D-0) were never open. **Q1 to Q20**
  in *What the owner has not decided* are accepted as proposed; each row's status reads accepted.
  The cue sentences and sounds stay drafts for the owner's approval when #3305 and #3306 are built
  (Q16). **Nothing is built by this ADR**: #3298 to #3310 build Phase 1
- **Date**: 2026-11-26
- **Deciders**: **the owner**, whose rulings of 2026-11-26 are quoted in Context. **The author**
  drafted the rest for the owner's approval; a point that rests on an open question says
  *proposed* and names the question
- **Issue**: [#3297](https://github.com/openzigs/onyourleft/issues/3297), Phase 0 of the epic
  [#3296](https://github.com/openzigs/onyourleft/issues/3296), whose sub-issues #3298 to #3310 are
  Phase 1 and #3311 to #3315 are one placeholder each for Phases 2 to 6
- **Number**: **0101**. On 2026-11-26 `main` (`292aa3a0e`) holds no `docs/adr/` file numbered above
  0099. `docs/agents/conventions.md` §7 gave 0100 as the next free number, and that was one claim
  out of date: the open pull request
  [#3261](https://github.com/openzigs/onyourleft/pull/3261) adds an ADR numbered 0100 for #3245.
  0098 is claimed by the open pull request
  [#2966](https://github.com/openzigs/onyourleft/pull/2966). Checked again before writing, as #3297
  asks: no other open pull request adds an ADR file numbered 0095 or above, and no open issue but
  #3297 claims 0101. The next free number is then **0102**
- **Supersedes**: **nothing**, Proposed or Accepted. No earlier ADR's decision is reversed for the
  mode it was written for, so no earlier ADR gains an `## Amendments` entry in this pull request
  (D-8 lists each statement that was checked and why it still holds)
- **Extends, follows and departs from**, by decision number (D-8):
  - **extends** [ADR 0038](0038-drafting-in-the-first-multiplayer-release.md) **D-5** and
    [ADR 0066](0066-the-bot-pacer-and-the-riders-own-ghost-give-a-draft-in-a-solo-ride.md) **D-1**:
    in a group ride the synthetic riders **take** a draft as well as give one;
  - **follows** [ADR 0067](0067-lap-race-bots-race-with-a-strategy-that-reads-the-race.md) **D-3**
    (one draft model for every rider, the bots included) for a new mode;
  - **departs from** ADR 0067 **D-1.2** (no bot's power moves with the rider's gap) for a ride
    that is not a race, and **is wider than**
    [ADR 0083](0083-the-device-decides-the-ai-pacers-intent-and-the-model-writes-the-line.md)
    **D-1**'s envelope for this mode only. Ruling 3 decides the substance; Q13 asks the owner to
    confirm the reading
- **Relates to**: [ADR 0007](0007-patent-posture.md) D1 and D4,
  [ADR 0009](0009-clean-room-posture.md) R1, [ADR 0013](0013-adr-amendments.md) D-3,
  [ADR 0028](0028-racing-fairness.md) D-7.2,
  [ADR 0030](0030-what-the-app-may-say-about-a-body.md),
  [ADR 0060](0060-the-lap-race-effort-distance-and-a-bounded-race-offset.md) D-6.3 and D-8,
  [ADR 0072](0072-a-model-directs-the-bot-pacer-during-a-ride.md) D-4, D-6 and D-9,
  [ADR 0082](0082-the-ai-pacer-paces-the-terrain-with-the-rider-on-its-wheel.md) D-1,
  [ADR 0088](0088-junction-choice-is-a-discrete-press-that-cannot-reach-the-trainer.md) D-5, and
  spikes [0005](../spikes/0005-live-racing-patent-read.md),
  [0030](../spikes/0030-lap-race-expression-line-and-patent-read.md) and
  [0032](../spikes/0032-energy-budget-pacing-of-lap-race-bots-patent-read.md)

---

## Context

### What the mode is for

A rider who has never sat on a wheel should be able to learn, at home, how a paceline works: hold a
wheel, take a turn on the front at the group's speed, pull off, drift back, get back on. Then go
and do it outdoors. The epic #3296 states the idea in the owner's plain words: the rider picks an
average speed and a route they can already ride, a small group of synthetic riders forms a line
with the rider in it, the group takes turns on the front, the ride says when the rider's turn is
near, when it has come and when it is over, and nobody leaves a rider who falls behind.

### What the owner ruled, quoted so it is not argued again

**Owner rulings, 2026-11-26**, as #3297 and the epic #3296 record them. The maintainer's
[lane note of that day](https://github.com/openzigs/onyourleft/issues/3297#issuecomment-7205067098)
on #3297 says the ADR states them *"as rulings and every other open question as a proposal for the
owner to accept"*. The words below are #3297's.

> 1. **The target speed is a true ride average.** The group speeds up on flats and descents to make
>    the stated average over the whole route. It still holds steadier effort on climbs, and it
>    makes up the time elsewhere. This replaces the research's flat-label recommendation.
> 2. **Instructions are a HUD line plus distinct sounds per cue kind.** No spoken voice in these
>    phases; a spoken coach is a later, unfiled idea.
> 3. **No-drop.** A sweep bot drops back to pace the rider, and the group eases and regroups for as
>    long as needed, with no lower limit. The rider's own physics is never tethered.
> 4. **The patent-risk acceptance is extended to group-ride bots and a waiting group**, on the same
>    footing as the pacer and the bots (no patent limit on bot strategy). Trainer safety still
>    holds: nothing in the mode writes to the trainer, and a `group-ride-cannot-reach-trainer` gate
>    is required.

#3297 adds what ruling 4 covers by name, because three earlier acceptances each stopped short of
it: *"(a) the rider drafting group-ride bots and those bots drafting each other (ADR 0038 D-7, ADR
0066 D-4 and ADR 0067 D-3.8 each accepted drafting risk for one case only); (b) a group that waits
for the rider (accepted for one pacer in ADR 0072 D-9); (c) 'no rule on strategy' for group-ride
bots (ADR 0067 D-0 is scoped to lap-race bots)."*

### Why an ADR, and why before any code

- **A new kind of synthetic rider drafts in a solo ride.** ADR 0066 D-1.1 has the pacer and the
  ghost give a draft and take none. ADR 0067 D-3 has lap-race bots give and take one, in a race. A
  group ride needs bots that give and take one in a ride that is not a race.
- **A group that slows for the rider** is what ADR 0067 D-1.2 keeps out of a race and what ADR 0083
  D-1 bounds at 20 % for one pacer. Ruling 3 has no lower limit.
- **The patent-risk acceptance had to be extended in terms**, and an acceptance is recorded where a
  reader will look for it (ADR 0038 D-7, ADR 0066 D-4, ADR 0067 D-3.8 and ADR 0072 D-9 each did
  the same).
- **Thirteen Phase 1 issues wait on figures and rules** that should be stated once: the climbing
  cap, the floor, the waiting rule, the cue list, what may reach the trainer (nothing).

### What exists today (read at `main` `292aa3a0e`, 2026-11-26)

The mode is mostly a new arrangement of parts that exist. The epic's reuse map lists them; the ones
this ADR's decisions turn on were opened for it:

| Need | What exists |
|---|---|
| The draft model | `packages/physics/src/draft.ts`: a factor per rider from odometer distances only, single file, `DRAFT_REACH_METRES` = 30, `MAXIMUM_DRAFT_DEPTH` = 5 (ADR 0038 D-3) |
| The rider drafting a synthetic rider in a solo ride | `apps/web/src/game/solo-draft.ts` (ADR 0066) |
| Bots that draft each other and the rider | the solo lap race (ADR 0067 D-3) |
| A reserve with room-portable arithmetic | `packages/domain/src/lap-race/wbal.ts` (ADR 0067 D-2, D-5.2) |
| Waiting for the rider by rule | `packages/domain/src/pacer/device-rule.ts` §`pacerRuleDecision` (ADR 0083 D-1) |
| Climbs ahead | `packages/domain/src/route/course-ahead.ts`: 3 % or steeper for 200 m |
| The gradient response | `packages/domain/src/pacer/pacing.ts` §`pacingFactor` |
| Three discrete drawn lanes | `apps/web/src/game/lanes.ts`, 0.4 s a change; a drawing, never physics (ADR 0060 D-6.3) |
| The announcer | `apps/web/src/game/hud/announce.ts`: one sentence per 3 s by rank; a lower one is dropped, not queued. **There is no text-to-speech in the app** |
| Non-speech sound | `apps/web/src/game/audio-cues.ts`: synthesised, behind a port, this project's own design |
| The trainer gates | `draft-cannot-reach-trainer.test.tsx`, `solo-draft-cannot-reach-trainer.test.tsx`, `lap-race/lap-race-cannot-reach-trainer.test.ts` and `model-pacer-wiring.test.tsx` under `apps/web/src/game/`, on the shared `cannot-reach-trainer-testing.ts` |

### What was read, and what was not

**Read for this ADR by its author, 2026-11-26**, in this repository at `292aa3a0e`: the decisions of
the ADRs cited above, in the parts cited; spike 0032 §4.4; spike 0030 §6 and §10; spike 0005's
search notes on drafting; `pacing.ts`; the announcer's rank table and the audio module's header;
issue [#92](https://github.com/openzigs/onyourleft/issues/92) and the body of its pull request
#196; and the epic #3296 with its Phase 1 sub-issues.

**Read by the research pass of 2026-11-26, and not re-read for this ADR.** #3297 names them: club
and federation paceline guides (USA Cycling's club tool kit, BikeWalk NC, Boulder Cycling Club),
coaching articles (TrainerRoad, CTS, GCN), Blocken et al. 2018 on drag in a line of riders (the
paper ADR 0038 D-3 already uses, read first-hand there), and Sigrist et al. 2013 on augmented
feedback in motor learning. **The research summary is not in this repository**, and #3297 records
no address or fetch date for the web pages, so no figure in this ADR is offered as sourced from
them. Every figure the mode adds is marked *proposed* and is a feel parameter to tune in the
harness (#3309) and on the owner's ride.

**Not read at all**: any patent claim, first-hand, by the research or by this author. D-7 says what
each row of its risk note rests on.

### Where the gradient figures come from

The epic's list of unconfirmed points says the pacer's +10 % and −20 % *"happen to match figures
reported for another platform's pace bots; how they were derived here was not checked"*, and asks
this ADR to record the derivation under the clean-room posture (ADR 0009). It was checked:

1. **The two envelope figures and the bot's fixed 75 kg came to this project as a description of
   how another indoor platform's pace bots are documented to behave.** Issue #92 (opened
   2026-09-03) lists them under *"Documented mechanics"* in its Context and puts the envelope in
   its third acceptance criterion. The match is therefore not a coincidence, and #92 never said it
   was.
2. **Everything inside the envelope is this project's own.** `pacing.ts` (first written in #196,
   2026-09-08) ramps in a straight line to +10 % at **8 %** and to −20 % at **−6 %**, holds there,
   and is continuous at zero. Its own comments flag both reference grades as *"a feel parameter,
   not a measured constant"* and say the shape was *"chosen to be the simplest thing that satisfies
   the envelope"*. #196's body says the same.
3. **What was taken is a fact about behaviour, and nothing else.** ADR 0009's *What is not
   protected* names product concepts and methods of operation, and R1's table lists *"the fact
   that a device behaves a certain way, once observed or documented"* among the facts that may be
   taken, against code, tables, fixtures and prose, which may not. A platform's bot is not a
   device; the author reads that row as covering documented behaviour in general. No code, table,
   text, name or sound of that platform is in `pacing.ts` or in this ADR. ⚠️ This is the author's
   reading of ADR 0009, not a legal opinion.
4. **What could not be confirmed.** #92 gives no address and no date for the document its author
   read, so this ADR cannot say which publication stated the figures or that it stated them
   accurately. `pacing.ts` already calls the envelope *"published"* on #92's word alone.
5. **What the group ride adds is its own.** The proposed +5 % climbing cap (Q2) is a new figure
   with no outside source, chosen because the draft is worth less at climbing speed. The −20 %
   downhill floor is the existing one, reused as it stands.

---

## Decision

**How to read this section.** **D-0 is the owner's and is decided.** D-1 to D-9 are the author's
draft and take effect only when the owner accepts this ADR. A sentence that rests on one of the
twenty open questions says *proposed* and names it (Q1 to Q20, in *What the owner has not
decided*). **None of those twenty is decided here.**

### D-0 — The owner's rulings (2026-11-26)

1. **The target speed is a true ride average.** The group speeds up on flats and descents to make
   the stated average over the whole route. It still holds steadier effort on climbs, and it makes
   up the time elsewhere.
2. **Instructions are a HUD line plus distinct sounds per cue kind.** No spoken voice in these
   phases.
3. **No-drop.** A sweep bot drops back to pace the rider, and the group eases and regroups for as
   long as needed, with no lower limit. The rider's own physics is never tethered.
4. **The patent-risk acceptance is extended to group-ride bots and a waiting group**, on the same
   footing as the pacer and the bots. Trainer safety still holds: nothing in the mode writes to the
   trainer, and a `group-ride-cannot-reach-trainer` gate is required.

### D-1 — What a group ride is

1. **A solo ride on any route the rider can already ride**, with a group of synthetic riders in a
   single line and the rider in it. Where the choice lives is *proposed* (Q9).
2. **Rule-based throughout.** Every decision of the group and every sentence the rider is shown is
   written in this repository. **No instance, no model, no network**: the mode works offline, and
   `apps/web/src/privacy/no-network.test.ts` stays green unmodified through Phases 0 to 4
   (CLAUDE.md §1 invariant (a); [ADR 0036](0036-a-self-hostable-instance-server-now.md) D-3).
3. **A bot is never a recorded ride** (ADR 0007 D4): a strength, a rule, the course and a seed.
4. **Not a race.** There is no finish order, no ranking and no standing, and nothing is compared
   with another person.
5. **What it is not offered beside** is *proposed*: a workout in ERG (Q7), and a ride with the
   draft switched off (Q8).

### D-2 — The target speed (ruling 1)

1. **The number the rider picks is the group's average speed over the whole route**, shown in the
   rider's display units ([ADR 0020](0020-display-units.md)).
2. **The plan solves once, at the start, from the course only**: the front rider's base power whose
   simulated time over the route equals distance divided by the target speed (#3298). A target the
   bots cannot make on that route is refused with the highest average they can make, never
   approximated.
3. **On climbs the group holds steadier effort.** It starts from `pacingFactor` and caps the uphill
   lift lower than the solo pacer's; it eases before a climb, as ADR 0082 D-1 has the pacer do, and
   is steady over the top. The cap, *proposed* (Q2), is **+5 %** against the pacer's +10 % at +8 %.
4. **So the group rides faster than the stated number on flats and descents**, and that is where
   the time comes back. The front rider keeps pedalling downhill: the floor is the existing −20 %
   (`PACING_FACTOR_FLOOR`), never zero (*proposed*, Q2).
5. **A time ledger corrects drift during the ride** inside a bounded band (#3298 proposes ±5 % of
   base power): planned elapsed time at this odometer against the group's own.
6. **Where rulings 1 and 3 meet**, *proposed* (Q1): time the group spends waiting or regrouping for
   the rider is **not** chased back, because chasing it would drop the rider again. The ride page
   then shows the stated average beside the average actually ridden.
7. **The HUD shows two speeds**: the ride's average target and **the group's speed now**. The cue
   on the front asks the rider to hold the group's speed now, never the average.
8. **None of these numbers is ever a target sent to the trainer** (D-6).

### D-3 — The group and the rotation

1. **One pure, seeded function in `packages/domain`**, stepped once per decision window, holds the
   order of the line, the line's state and one role per rider (#3299). The states and roles are the
   epic's: `forming`, `steady`, `changing`, `latching`, `waiting`, `regrouping`; and `on-front`,
   `second-wheel`, `in-line`, `last-wheel`, `drifting-back`, `latching`, `gapped`, `off-the-back`,
   `off-the-front`, `sitting-in`.
2. **One draft model for every rider, the bots included.** Each rider's factor is ADR 0038 D-3's,
   from odometer distances only, the same call a room and the lap race make (ADR 0067 D-3.1). A
   bot on the front has no shelter and a bot in the line has it, which is what makes a turn on the
   front cost something.
3. **Physics stays single file.** No lateral position enters the draft model or the physics (ADR
   0038 D-3.4), so a rider drawn to one side while drifting back is simply somewhere in the
   odometer order, and there is **no new `physicsVersion`** in Phases 1 to 3. The side a rider is
   drawn on is a drawing (ADR 0060 D-6.3). Echelons are *proposed* for later, behind their own ADR
   and a new `physicsVersion` (Q18).
4. **Size and make-up**, *proposed* (Q3): 3 to 7 bots, default 5, with a spread of strength.
   Stronger bots pull longer and weaker ones shorter, **all at the same speed**. With eight in the
   line the last rider has more riders ahead than `MAXIMUM_DRAFT_DEPTH` counts, and the model
   already holds that.
5. **A bot arriving on the front does not lift**: its speed in its first window on the front is the
   group's speed in the window before.
6. **The rider's pull**, *proposed* (Q4): 30 s by default with a visible countdown, and the rider
   may end it early at any time.
7. **Pulling off**, *proposed* (Q5, Q6): a discrete press toward one fixed side, stated on the
   ride. A rider who does not press and fades is passed by the line anyway; easing alone does not
   count as pulling off. **The rider never has to press anything to stay in the group**: holding a
   wheel and doing nothing else is a valid ride, and a rider may choose to sit in and skip pulls.
8. **The rider off the front**, *proposed* (Q11): the group does not chase. One cue, and the front
   bot holds its pace.
9. **Room portability**, *proposed* (Q15): the Phase 1 modules keep to ADR 0067 D-5.2's arithmetic
   (`+ − × ÷`, comparisons, `Math.min`, `Math.max`, `Math.sqrt`) from the first build.

### D-4 — No-drop (ruling 3)

1. **`gapped`** (off the wheel, inside the 30 m draft reach): the last bot becomes the **sweep**
   and eases to sit just ahead of the rider, so there is a wheel to take. The rest of the line does
   not ease yet.
2. **`off-the-back`** (beyond the reach): the line is `waiting` and **the whole group eases**, by a
   share that grows with the gap. **There is no floor**: the group slows to whatever the rider can
   do.
3. **Over a climb** the group rides its own steadier effort, is `regrouping` over the top until the
   rider is back, and holds a short settle time before the pace resumes.
4. **The rider who stops pedalling**, *proposed* (Q10): the group stops and waits with them, and
   the existing auto-pause governs. It does not roll on.
5. **The rider's physics is never tethered.** The rule changes only what the bots do. No rubber
   band, and no change to the rider's speed to keep them in the group: what the screen shows is
   what the legs did.
6. **How this sits beside the race rule and the pacer's envelope**, *proposed* (Q13): a group ride
   is not a race, so its bots may ease for the rider. That departs from ADR 0067 D-1.2 for a
   non-race and is wider than ADR 0083 D-1's 20 % for this mode only. Neither ADR changes for the
   mode it was written for.

### D-5 — Cues: a HUD line and a sound per kind (ruling 2)

Folding the cue list, the rank and the rate limits into this ADR, and not a second one, is
*proposed* (Q20).

1. **A cue is a kind, chosen by a pure function** in `packages/domain` from the rotation's facts
   (#3302), at most one at a time. The sentence is `apps/web`'s (#3305) and the sound is
   `apps/web`'s (#3306).
2. **Every sentence below is the build's draft, for the owner's approval** (*proposed*, Q16), and
   so is each sound's shape, which the owner judges by ear on a moving ride (#3306). The notes are
   synthesised, as `audio-cues.ts` already does; **no audio file, no recorded voice and no speech
   synthesis** is added.

   | Kind | When | Draft sentence | Draft sound |
   |---|---|---|---|
   | `next-up` | the rider becomes `second-wheel` | *"You are next on the front."* | one short note |
   | `your-pull` | the rider becomes `on-front` | *"Your pull. Hold the group's speed, no faster."* | two notes, rising |
   | `pull-off` | the pull timer ends | *"Pull off now."* | two notes, falling |
   | `ease` | the rider becomes `drifting-back` | *"Ease a little and let the line pass."* | one long low note |
   | `last-wheel` | the last rider is one length from level | *"The last wheel is coming. Slot in behind it."* | three quick notes at one pitch |
   | `back-in-line` | the rider is `in-line` after a pull | *"Back in the line. Recover."* | two slow notes at one pitch |
   | `climb` | 300 m before a climb | *"Climb ahead. The group holds a steady effort and the speed will drop."* | three notes, rising |
   | `regroup` | `regrouping` or `waiting` begins | *"The group is easing until you are back."* | three notes, falling |

   Corrections, said only when the rider is out of a band for a dwell time, and sharing **one**
   sound between them (a short low pair):

   | Kind | When (figures are #3302's, *proposed*) | Draft sentence |
   |---|---|---|
   | `close-gap` | a gap over 2 m for 4 s while `in-line` | *"A gap has opened. Close it smoothly."* |
   | `surging` | on the front and over the group's speed by 2 km/h for 5 s | *"You are above the group's speed. Ease back to it."* |
   | `past-front` | ahead of the front rider when not on a pull, for 3 s | *"You are past the front. Ease and drop back into the line."* |
   | `eased-too-much` | more than 5 m behind the last wheel while `latching` | *"You have drifted past the last wheel. Come back to it smoothly."* |
   | `shorter-pull` | **after** a pull, never during it | *"Next time, try a shorter pull."* |

   `shorter-pull` needs the rider's own recent average. The research did not read how one reaches
   the game during a ride; if nothing on the device provides one, the kind is left out of Phase 1
   and never approximated from a guess (#3302).
3. **A sound is never the only carrier.** Every sounded kind has its sentence, and a rider with
   sounds off loses nothing. No two kinds share a note sequence. The pull countdown has no sound
   and is never announced.
4. **Cues never urge more effort.** No kind tells the rider to push harder and no cue carries a
   power for the rider to reach. A gap is closed *"smoothly"*; in no-drop the group comes back
   instead.
5. **The announcer.** A cue's sentence goes to the HUD line and to the announcer's live region,
   where the rider's own screen reader may speak it. The group ride takes **one new rank, below
   every safety and workout item**: below everything down to the heart-rate hold (rank 5d of
   `announce.ts`'s table as read today) and above the periodic readings (ranks 6 to 8). Its exact
   place among the ride events between them is #3305's. A lower-ranked sentence is dropped, not
   queued, as today. **The announcer already says a climb ahead, at rank 5**, which outranks the
   group's `climb` cue: where both are due in one window the group's sentence is dropped from the
   live region and stays on the HUD line, and #3305 says whether the two should be one sentence.
   A cue's sound plays when the cue is selected and is not held or dropped by that window, the
   rule `audio-cues.ts` already states for the interval sound.
6. **Rate limits** (figures *proposed*, #3302's): at most one correction every 20 s; events are
   exempt, so a limit never delays `pull-off` or `last-wheel`; the same correction is not said more
   than twice in a row, after which it is a quiet mark on the role strip and a count for the
   debrief; nothing is said during a hard effort beyond the cue that started it.
7. **Coaching level**, *proposed* (Q17): one level in Phase 1, every event and corrections on, rate
   limited. Three levels and fading are Phase 2.
8. **What the debrief may say** (#3310): counts and durations only. Pulls taken, time on the front,
   time in the draft, time with the group, corrections counted, and the stated average beside the
   average ridden (Q1). No judgement of the rider's body, no medical wording, no praise for effort
   and no urging to push harder next time. The ride keeps the existing drafted mark, *proposed*
   (Q14).
9. **The words.** Plain cycling words (*"pull"*, *"pull off"*, *"last wheel"*) are ordinary
   vocabulary. No other product's names or wording are used (ADR 0009). *Proposed* (Q12): the group
   has a pace and no leader; no string calls a bot a leader, an instructor or a coach, and nothing
   is called a class.

### D-6 — What does not move: the trainer, and the rest of the safety rules

These restate existing decisions for this mode. A change that makes one false is a change to an
ADR, not a review note.

1. **Nothing in the group ride writes to the trainer.** Not a bot, the rotation, a role, a cue, a
   sound, a draft, a wait or a press. The only writes are those any ride makes: the road's grade at
   the rider's own odometer, through the existing gradient session and its bounds (ADR 0072 D-6.1,
   ADR 0066 D-7).
2. **Pulling on the front adds no resistance.** The rider on the front loses the draft in the
   simulation, so the same watts give less speed. The trainer feels nothing.
3. **No ERG target is ever derived from the group.** *"Hold the group's speed"* is words on a
   screen.
4. **A draft changes when a grade arrives, never what is sent** (ADR 0067 D-3.3).
5. **The pull-off press and the sit-in choice are discrete presses that cannot reach the trainer**,
   each with its own test, in the manner of ADR 0088 D-5.
6. **A new gate, `group-ride-cannot-reach-trainer`** (ruling 4; #3303 creates it, #3308 completes
   it), compares a worst-case group ride write for write with the same ride at the same draft
   factors without the group. The existing gates stay green **unmodified**.
7. **The rider's physics is never tethered** (ruling 3; D-4.5).
8. **Cues never urge more effort** (D-5.4).
9. **No medical wording and no body claims** in any cue or debrief line (ADR 0030; ADR 0072
   D-4.2's list).
10. **No coordinate and no place name** in any cue, HUD line or debrief
    ([ADR 0004](0004-privacy-and-location.md) D; `hud/lap-race-no-place.test.tsx` is the model).
11. **Sensor loss.** With no power reading, cues and sounds stop and the group waits. Silence is the
    answer to *"I do not know"*, as `audio-cues.ts` has it.
12. **No bot's pace reads the rider's heart rate.**
13. **Bots are never a recorded ride** (ADR 0007 D4; D-1.3).
14. **Determinism** (ADR 0067 D-6.2 and D-6.3): seeded, no clock, no `Math.random`, decisions per
    decision window and never per tick.
15. **Licence** (CLAUDE.md §3): rules, rotation, plan and cue selection in `packages/domain` and
    `packages/physics` (`Apache-2.0`, platform-free); the ride-facts field in `packages/store`
    (`Apache-2.0`); wiring, drawing, HUD, sounds and the gate in `apps/web`
    (`AGPL-3.0-or-later`). No new dependency.

### D-7 — The patent-risk acceptance (ruling 4), and the risks found

**This is not a freedom-to-operate opinion** (ADR 0007 D1), and it must not be quoted as one. It is
a risk decision the owner made, and a short note of what was found, not an opinion on any of it.

**What the owner accepted on 2026-11-26**, on the same footing as the pacer and the bots:

1. **The rider drafting group-ride bots, and those bots drafting each other.** ADR 0038 D-7 covers
   live riders in a room, ADR 0066 D-4 the solo pacer and the rider's own ghost, and ADR 0067 D-3.8
   lap-race bots and the rider behind them. Each says it covers its own case and nothing more.
   Those three stay as written; this is a further acceptance beside them.
2. **A group that waits for the rider.** ADR 0072 D-9 accepted it for one pacer.
3. **No rule on strategy for group-ride bots.** ADR 0067 D-0 set the patent-based limit aside for
   lap-race bots only; ruling 4 does the same for group-ride bots.

**Trainer safety is not relaxed by this acceptance, in any part.** Ruling 4 says so in terms, and
D-6 holds every trainer rule as it stood. An acceptance of patent risk is about what a bot may do
on the screen; it has never been, and is not here, permission for anything to reach a trainer
write.

**The risks found.** No claim was read first-hand in the research or for this ADR. Each row says
what it rests on. **No claim text is reproduced here**, and none should be added without ADR 0007
D7's citation and date.

| # | Risk | What it rests on | Bearing on this mode |
|---|---|---|---|
| 1 | **A partner that slows when the user lags**: the *virtual fitness partner* family, US 12,499,637 and US 12,118,684 | Spike 0032 §4.4, which read claim 1 of each first-hand on its own date and charted it against a course-only plan. Not re-read here | A no-drop group that waits is that behaviour: the element spike 0032 found absent from a course-only bot is present in this mode. Accepted for the pacer in ADR 0072 D-9; extended to a group by ruling 4 |
| 2 | **Drafting**, accepted case by case | ADR 0038 D-7, ADR 0066 D-4, ADR 0067 D-3.8; spike 0005 §1.4 found no granted US patent claiming a drafting model in a virtual cycling environment and recorded that as **not established** | Group-ride bots are now covered by ruling 4 |
| 3 | **A leader plus instructions in a room** | ADR 0028 D-7.2 (*"No instructor, and nobody leading a session"*), from spike 0005 | Out of scope until Phase 5, which needs its own ADR. The solo mode has no room, and Q12 keeps its words clear anyway |
| 4 | **A synthesised coach voice with model-written cues**: a pending application | Press summaries only, as ADR 0048 D-13 records. The claims were not read | A rule-written cue with no synthesised voice is further from it. It comes closer if speech or a model-written cue is ever added (Phase 6) |
| 5 | **A competitor whose speed depends on the user's heart rate**: US 6,902,513 | A search excerpt only. Its status was **not checked** | Designed around in any case: no bot's pace reads heart rate (D-6.12) |
| 6 | **Automatic shifting or resistance to keep up with a group**: US 11,986,700 | A search excerpt only | The mode must not shift or set resistance for the rider, which D-6.1 forbids anyway |
| 7 | **A continuous steer** | Spike 0030 §6 and §10, whose reading rests on discrete lanes | Pulling off is a discrete press on discrete lanes (Q5). A continuous or drag-scaled steer needs that spike's reading re-run first |
| 8 | **Not searched** | — | Pending applications for any assignee, and any non-US right |
| 9 | **Expression** | ADR 0009 | Other platforms' names and wording for these features are not used (D-5.9) |

**Nothing was found that claims automated paceline rotation instructions on a trainer platform.**
That is weak evidence: absence in a keyword search is not clearance.

**What the acceptance leaves standing**: no bot replays a recorded ride, from this rider or any
other (ADR 0007 D4); there is no ranking and no comparison against another person; and when
[#1234](https://github.com/openzigs/onyourleft/issues/1234)'s opinion arrives it is read against
this ADR too, and the owner decides again if it says to. #1234 is not a gate for this epic.

### D-8 — Its relation to earlier ADRs, and why none is amended

**No earlier ADR's body is edited, and none gains an `## Amendments` entry here.** ADR 0013 D-3
gives an amendment one job, a statement of fact that has become false. Each statement this mode
comes near was read, and each still holds:

| Statement | Why it still holds |
|---|---|
| ADR 0038 D-5's *"Out"* bullet (no drafting of the bot pacer or any ghost) | Already superseded for the pacer and the ghost by ADR 0066 and for lap-race bots by ADR 0067, with its pointers. It says nothing of a group-ride bot, which did not exist |
| ADR 0066 D-1.1, *"Only the rider takes a draft. The pacer and the ghost give one and never take one"* | Still true of the pacer and the ghost. A group-ride bot is neither |
| ADR 0066 D-1.5, a ride with neither a pacer nor a ghost is unchanged | Still true of every ride that exists. Nothing is built by this ADR, and the build's own pull request says so again if it is no longer true then |
| ADR 0038 D-7, ADR 0066 D-4, ADR 0067 D-3.8 and ADR 0072 D-9, each acceptance's scope | Each is a record of what was accepted on its date, and stays one. Ruling 4 is a further acceptance beside them, as ADR 0066 D-4 said of itself beside ADR 0038 D-7 |
| ADR 0067 D-0 and D-1.2, for lap-race bots | Unchanged for lap-race bots. A group ride is not a lap race |
| ADR 0083 D-1.3, the pacer eases by at most 20 % | Unchanged for the pacer |

**When the owner accepts this ADR**, the accepting commit may add a dated pointer to ADR 0066 and
ADR 0067, as accepting commits have before, if a reader of either would by then be misled. That is
a judgement for that commit, not this one.

### D-9 — Order against other work

1. **#2517 lands first**, *proposed* (Q19). It rewrites the wheel-holding and pack-layout code that
   #3300 and #3304 build on. Phase 0 and the pure rules (#3298, #3299, #3302) do not touch that
   code and need not wait.
2. **#2598 is coordinated with Phases 3 and 4**, which touch the same drawing code.
3. **#2583's ledger** is reused by #3298 if it has merged, and #3298's pull request says so if not.

---

## Consequences

### What this enables

- Thirteen Phase 1 issues can be built against one statement of the speed rule, the no-drop rule,
  the cue list and the trainer rule.
- A rider with no instance, offline, can learn a rotation at home. Nothing found in the research
  coaches one, which is weak evidence that nobody does.
- The patent-risk acceptance for a waiting, drafting group is on record where the next reader will
  look for it.

### What this costs, stated plainly

- **The group rides faster than the number on the screen on every flat and descent**, because
  ruling 1 makes that number a ride average. A rider who picked a speed they can hold on the flat
  has picked a ride that is harder than that on the flat. The HUD's second number, the group's
  speed now, is the honest answer, and the setup should say so in words.
- **The stated average may not be made.** With no lower limit (ruling 3) and waiting time not
  chased back (Q1), a rider who needs the group to wait finishes below the stated average. The ride
  page shows both numbers.
- **One more surface that must not reach the trainer**, and a gate to keep. Every later phase
  inherits it.
- **The risk in D-7 is accepted without counsel**, and row 1 is the nearest of them: the mode has
  the behaviour spike 0032 found absent from the lap-race bots.
- **Twenty answers are owed** before the first Phase 1 issue should merge, and several figures are
  feel parameters that only a ride can settle.
- **A press is not how a rider pulls off outdoors.** The mode teaches the timing and the order of a
  rotation, and it cannot teach the bike handling.

### Constraints this places on other work

| Issue | What binds it |
|---|---|
| #3298 | D-2: a true ride average, the climbing cap and the floor (Q2), waiting time not chased (Q1), an unreachable target refused |
| #3299 | D-3: one seeded function per decision window, no lateral input, no lift on arriving at the front, the rider never has to press |
| #3300 | D-3.2, D-3.3: one draft model and one physics for every rider; builds on #2517 (Q19) |
| #3301 | D-4: the sweep, no floor, the regroup, the rider's physics never tethered |
| #3302 | D-5.1, D-5.4, D-5.6: kinds and facts only, none urging effort, the rate limits |
| #3303 | D-1, D-6.6: no network, the first case of the gate, the drafted mark (Q14), the setup's place (Q9) and what it is not offered beside (Q7, Q8) |
| #3304 | D-3.3: the side a rider is drawn on is a drawing and never an input to the draft |
| #3305 | D-5.2, D-5.5, D-5.9: one sentence per kind, the owner's approval of each (Q16), one new rank |
| #3306 | D-5.2, D-5.3: synthesised, distinct, never the only carrier, silent on sensor loss |
| #3307 | D-3.7, D-6.5: a discrete press (Q5) to one fixed side (Q6) that cannot reach the trainer |
| #3308 | D-6.1 to D-6.6: the gate complete, and the existing gates unmodified |
| #3309 | The feel parameters marked *proposed* are tuned here, and on the owner's ride |
| #3310 | D-5.8: counts and durations only; both averages (Q1) |

### Not decided here

- **Phases 2 to 6.** Drop and soft-drop rides, coaching levels and a walkthrough (#3311); a double
  paceline (#3312); crosswind and echelons, which need their own ADR and a new `physicsVersion`
  (#3313, Q18); humans from a room, which needs ADRs that reopen ADR 0060 D-8, ADR 0067 D-5.1 and
  ADR 0028 D-7.2 (#3314); and a model-written line (#3315).
- **A spoken coach.** Ruling 2 leaves it a later, unfiled idea.
- **Whether a drafted group ride's mark travels in a FIT export**, which ADR 0066 D-5.4 left open
  for every drafted ride.

---

## What the owner has not decided

⚠️ **Twenty questions, each with a proposed answer. Every one is awaiting the owner, and none is
decided by this ADR.** Each proposed answer is the research's recommendation unless it is marked as
the planner's. The owner accepts or changes each on this ADR's pull request, and the answers are
recorded here when the ADR is accepted.

| # | Question | Proposed answer | Where | Status |
|---|---|---|---|---|
| **Q1** | Where rulings 1 and 3 meet: must time lost while the group waits be made up? | **No.** Time spent waiting or regrouping for the rider is not chased back, since chasing would drop the rider again. The ride page shows the stated average beside the average actually ridden. *The planner's proposal, following from rulings 1 and 3* | D-2.6 | Accepted by the owner, 2026-11-26 |
| **Q2** | How much steadier on climbs? | The group's uphill lift is capped lower than the solo pacer's: +5 % against the pacer's +10 % at +8 %. The front rider keeps pedalling downhill (the existing −20 % floor). Feel parameters, tuned in the harness | D-2.3, D-2.4 | Accepted by the owner, 2026-11-26 |
| **Q3** | Group size and make-up? | 3 to 7 bots, default 5 (a line of six with the rider, the size the research reports its sources give for a single paceline). A spread of strength: stronger bots pull longer, weaker shorter, **all at the same speed** | D-3.4 | Accepted by the owner, 2026-11-26 |
| **Q4** | How long is the rider's pull? | 30 s by default with a visible countdown; the rider may end it early at any time | D-3.6 | Accepted by the owner, 2026-11-26 |
| **Q5** | How does the rider pull off? | A discrete press (the lane key, a HUD button or a gamepad button). If the rider does not press and fades, the line comes round anyway. Easing alone does not count as pulling off | D-3.7 | Accepted by the owner, 2026-11-26 |
| **Q6** | Which side? | One fixed side in Phase 1, stated on the ride. Following the wind waits for Phase 4 | D-3.7 | Accepted by the owner, 2026-11-26 |
| **Q7** | Is it offered beside a workout in ERG? | Not in the first build: in ERG the rider cannot freely vary power, so a rotation makes little sense | D-1.5 | Accepted by the owner, 2026-11-26 |
| **Q8** | Is it offered with the draft switched off (#2967)? | No, and the setup says why | D-1.5 | Accepted by the owner, 2026-11-26 |
| **Q9** | Where does it live? | A choice in *Your ride* beside *"Ride against a pacer"*. *The planner's choice; the research offered this or a card in the Games tab and recommended neither* | D-1.1 | Accepted by the owner, 2026-11-26 |
| **Q10** | What does the group do when the rider stops pedalling? | It stops and waits with them, and the existing auto-pause governs. It does not roll on. *Follows ruling 3; the research proposed a bounded wait* | D-4.4 | Accepted by the owner, 2026-11-26 |
| **Q11** | What does the group do when the rider goes off the front? | It does not chase. One cue, and the front bot holds its pace | D-3.8 | Accepted by the owner, 2026-11-26 |
| **Q12** | May anything be called a leader? | No. The group has a pace and no leader. No string calls a bot a leader, an instructor or a coach, and nothing is called a class (ADR 0028 D-7.2 is about rooms, and the solo mode keeps clear of its vocabulary anyway) | D-5.9 | Accepted by the owner, 2026-11-26 |
| **Q13** | Does a group ride follow the race rule or the pacer rule on capacity? | The pacer's: a group ride is not a race, so its bots may ease for the rider (a departure from ADR 0067 D-1.2 for a non-race, and a wider envelope than ADR 0083 D-1 for this mode only) | D-4.6 | Accepted by the owner, 2026-11-26 |
| **Q14** | Is a group ride marked as drafted? | Yes, like any solo ride in which the rider sat in a draft (ADR 0066 D-5), with the same effect on *"Your best"* and segments | D-5.8 | Accepted by the owner, 2026-11-26 |
| **Q15** | Are the Phase 1 modules written room-portable? | Yes: they keep to the arithmetic limits of ADR 0067 D-5.2 from the first build, so a room could run the same code in Phase 5. It costs little | D-3.9 | Accepted by the owner, 2026-11-26 |
| **Q16** | Who approves the cue wording? | The owner. The sentences are the build's draft and go to the owner for approval, as every new sentence has | D-5.2 | Accepted by the owner, 2026-11-26 |
| **Q17** | How much coaching in Phase 1? | One level (every event, corrections on, rate limited). Three levels and fading are Phase 2 | D-5.7 | Accepted by the owner, 2026-11-26 |
| **Q18** | When do echelons come? | Later, behind their own ADR and a new `physicsVersion` (ADR 0038 D-3.4) | D-3.3 | Accepted by the owner, 2026-11-26 |
| **Q19** | In what order against #2517 and #2598? | #2517 lands first and the group ride's wheel-holding and drawing build on it; #2598 is coordinated with Phases 3 and 4 | D-9 | Accepted by the owner, 2026-11-26 |
| **Q20** | Are the cue list and rate limits folded into this ADR? | Yes: one ADR, with the cue kinds, the announcer rank (below safety and workout items), the rate limits and what the debrief may say | D-5 | Accepted by the owner, 2026-11-26 |

---

## What would make this ADR wrong

- **The flats are too fast for a learner.** Ruling 1 puts the group above the stated number on
  every flat. If the owner's ride shows a first-time rider cannot hold the wheel there, the answer
  is a different reading of the target, which is the owner's ruling to change and not a tuning
  matter.
- **The group never makes its average for the riders the mode is for.** Then the two numbers on the
  ride page are a standing reminder of a promise not kept, and Q1's answer should be looked at
  again.
- **The cues cannot be told apart by ear on a moving ride**, or a sentence arrives later than the
  second it is needed in. Ruling 2 rests on a sound per kind being enough without a voice.
- **The drawn line and the odometer line disagree enough to confuse.** Odometer gaps are wheel gaps
  and drawn gaps add a bike length a row, so a rider drifting back travels much further on the
  screen than in the physics. The epic records this as an inference; #3304 measures it.
- **#92's figures turn out to have come from something other than a published description** of
  another platform's behaviour. Then *Where the gradient figures come from* is wrong at its first
  step and ADR 0009 R1 has to be read again against the real source.
- **#1234's opinion, or any reading of a claim first-hand, puts the waiting group nearer than D-7
  row 1 says.** The owner decides again.
- **Anyone reads D-7 as clearance.** It is a risk decision and a note of search excerpts and
  earlier spikes, written by an engineer on one day.

---

## Amendments

Appended under [ADR 0013](0013-adr-amendments.md). Nothing above this line has been edited.

- **2026-11-27** — **D-3.2's *"Each rider's factor is ADR 0038 D-3's"* is no longer the whole of
  what a bot rides at.** The physics has no brake: a power is at least zero. Down a steep descent a
  sheltered bot that coasts is faster than the front that pedals, and it would roll through the
  wheel ahead. So a group-ride bot that its wheel rule asks for **less than zero watts** pedals
  nothing and **sits up**: it rides at a drag multiplier above its draft factor, by the share of
  the open air's extra drag that the missing watts are, and **never past 1**, so never at more
  drag than riding alone, and never below its factor, so never with more shelter than the model
  offers. The factor itself is still ADR 0038 D-3's, from the one call for every rider, and it is
  what the ride reports for each member; the draft model, its inputs and `physicsVersion` are
  unchanged (D-3.3 holds as written). The rule is the bots' alone: the rider is ridden at the
  model's factor and nothing here changes their speed (D-4.5). Accepted by the owner, 2026-11-27,
  on [#3347](https://github.com/openzigs/onyourleft/pull/3347): *"Decision 1 is accepted."* Built
  in `packages/domain/src/group-ride/step.ts`. (#3300)
- **2026-11-27** — **D-4.1's *"The rest of the line does not ease yet"* and D-4.2's waiting are no
  longer the whole of no-drop, and D-2.6 covers more than waiting.** Built as D-4 states it, a
  line released from a wait rode away at the plan's pace and waited again: a scripted rider at a
  quarter of the group's power spent the ride in a cycle of about a minute and was beyond the
  draft's reach each time. The owner ruled on
  [#3359](https://github.com/openzigs/onyourleft/pull/3359#issuecomment-7228951594): *"after the
  first wait, the group slows to the rider's sustained pace (a memory of what the rider can
  hold), so the rider stays on a wheel. This replaces the repeating ride-away-and-wait cycle …
  The wait and regroup still apply to a one-off gap. The group's plan speed recovers if the
  rider's pace rises."* So:
  1. **The rider's pace is remembered from the first wait or regroup**: what they can hold, as a
     share of the plan's speed, seeded with their speed in that wait. A rider who has stopped
     does not move it.
  2. **From then on the line is asked a 5 % margin over that pace**, never above the plan's
     speed, and **gives the speed back as the rider comes off the wheel**, all of it at 2 s of the
     rider's own speed (and never nearer than 5 m). So after the first wait the line does ease
     for a rider who is merely off the wheel, which D-4.1 said it did not. Before the first wait
     D-4.1 holds as written.
  3. **It recovers for as long as the rider keeps up, at any gap inside the 5 m wheel band.** A
     rider with the line rides the line's own speed, so their speed says nothing of what they can
     hold, and a pace fed on it would feed on itself. So the pace reads whether the rider keeps
     their gap: keeping it, the pace rises by the margin over about 20 s; losing ground, it comes
     down half as fast again; off the wheel, it follows the rider's own speed. The line rides the
     plan again once they hold it.
  4. **A one-off gap still ends in a wait or a regroup** (D-4.2, D-4.3), with no floor in either.
  5. **D-2.6 reaches the paced line too: the eased pace is the rider's ride.** A tick in which the
     line is held or paced is not booked as riding time, nor is one after it until the front is
     back at 98 % of the plan's speed, nor is a rider's own pull under that speed. The ledger is
     then exactly as late when the group rides the plan again as it was before, so a dropped
     rider is never chased by the ledger's 5 % band. The ride page still shows the stated average
     beside the average ridden.

  Every figure is a feel parameter for the harness (#3309) and the owner's ride. The rule is the
  bots' alone: it hands the rider a standing and nothing else, and nothing here changes their
  speed (D-4.5); nothing reaches a trainer (D-6.1). Built in
  `packages/domain/src/group-ride/no-drop.ts` and `step.ts`. (#3301)
- **2026-11-28** — **Proposed, not yet accepted by the owner. On a loop, D-2.1's *"average speed
  over the whole route"* is the average over each lap.** ADR 0101 does not mention loops. As
  first built, the plan covered one pass of the route and clamped the odometer to it, so from a
  loop's second lap the group rode the last cell's speed and the D-2.5 ledger stopped. #3364
  therefore offered no group on a loop. #3369 now has the plan **read at the odometer mod the
  lap's length**, so on every lap the power and speed follow the road as they do on the first.
  **Each lap before the current one adds a whole lap's planned time** (`distance ÷ target`). The
  ledger therefore keeps advancing lap after lap, and D-2.5 and D-2.6 hold as written. A loop's
  number of laps is open-ended, so the plan is still solved once for one lap (D-2.2): the
  target is the group's average over every lap, and so over any whole number of laps. A
  target the group cannot make on one lap is refused just as on a route with a finish. The
  questions for the owner:
  1. **Is "the average over each lap" what D-2.1 means on a loop?** *Recommended: yes.* The
     only other reading is the average over a number of laps that the rider names in advance.
     That needs a laps control that the group ride does not have, and it ends the group at a
     lap count that a free ride on a loop does not have either.
  2. **Should a group on a loop ever end by itself?** *Recommended: no.* It rides until the
     rider ends the ride, like a free ride on a loop. On a route with a finish it still ends at
     the finish.

  Nothing here reaches a trainer (D-6.1). Built in `packages/domain/src/group-ride/plan.ts`;
  the `loop` reason is gone from `apps/web/src/game/group-ride/choice.ts`
  §`groupRideUnavailable`. (#3369)
