# ADR 0088: Junction choice in an open-world ride is a discrete press, apart from lane steering, that cannot reach the trainer

- **Status**: **Proposed**, 2026-11-19, on the owner's rulings of 2026-11-19 on the epic
  [#2880](https://github.com/openzigs/onyourleft/issues/2880) and on
  [#2883](https://github.com/openzigs/onyourleft/issues/2883). Accepted only on the owner's approval
  on its pull request. D-9 lists the questions for the owner
- **Date**: 2026-11-19
- **Deciders**: **the owner**, whose rulings are quoted in Context. **The author** chose the keys,
  the buttons, the prompt distance and the default rule within them; each such choice is marked
  *the author's choice*
- **Issue**: [#2887](https://github.com/openzigs/onyourleft/issues/2887), Phase 0 of the epic #2880
- **Number**: **0088**, reserved for #2887 by the owner's lane note of 2026-11-19, beside 0087
  (#2885), 0089 (#2888) and 0090 (#2884, moved off 0086, which ADR 0086 had taken that day). On
  2026-11-19 the open pull requests [#2873](https://github.com/openzigs/onyourleft/pull/2873) (0081),
  [#2864](https://github.com/openzigs/onyourleft/pull/2864) (0083),
  [#2863](https://github.com/openzigs/onyourleft/pull/2863) (0084) and
  [#2872](https://github.com/openzigs/onyourleft/pull/2872) (0085) each write one
- **Supersedes**: nothing. It sits **beside**
  [ADR 0060](0060-the-lap-race-effort-distance-and-a-bounded-race-offset.md) **D-6.3** (lanes are
  discrete), and applies the same shape to a new input
- **Holds, and adds to**: [ADR 0059](0059-delivery-a-parcel-round-game-mode.md) D-2 and ADR 0060 D-2
  (no game event reaches the trainer), ADR 0059 D-5 and ADR 0060 D-13 (the touch lock stays whole),
  and CLAUDE.md §6 (trainer control is a safety issue)
- **Relates to**: ADR 0087 (#2885, real heights), whose D-6 fixes when a choice becomes final; the
  spike [#2882](https://github.com/openzigs/onyourleft/issues/2882) (the rolling route);
  [spike 0030](../spikes/0030-lap-race-expression-line-and-patent-read.md) §3.4 and §4.4

---

## Context

### What an open-world ride needs

An open-world ride (#2880) has no route. The rider chooses which street to take at each junction, so
the app needs a new rider input. The owner's request of 2026-11-19 put it as *"be able to turn on
streets"*, and the first version the epic describes is: *"The bike follows the road by itself.
Before each junction a prompt shows the choices; pick with the steering keys, a bar remote, a
gamepad, an OpenBikeControl controller or the screen; pick nothing and you go straight on; dead ends
turn you round."*

### Why this is a trainer question

A choice changes **which road** the trainer's grade is read from. That is the grade coming from the
road, which ADR 0059 D-2 and ADR 0060 D-2 allow. What they forbid is a game input that sets
resistance or an ERG target, or that changes what the trainer is sent by any path other than the
road. A smart trainer applies resistance to a person who is pedalling (CLAUDE.md §6), so a turn
choice must never be able to reach the trainer. The owner restated it on 2026-11-19 in the lane note
on #2887: *"junction choice must never be able to reach the trainer (CLAUDE.md §6 trainer
safety)."* The project already holds this for Delivery and the lap race with a static-import walk,
`apps/web/src/game/cannot-reach-trainer-testing.ts`, which
`delivery/delivery-cannot-reach-trainer.test.ts` and `lap-race/lap-race-cannot-reach-trainer.test.ts`
each call with their own roots.

### The patent reading

#2883 was filed to read the patents on choosing a turn at a junction and on free roaming before
this ADR. The owner closed it unrun on 2026-11-19, verbatim: *"skipped under the owner's
no-patent-limit rulings of 2026-11-10 (bots) and 2026-11-16 (AI pacer), which apply to the
open-world ride too. Trainer safety is unchanged: junction choice is a discrete input that can never
reach the trainer (#2887)."* So **no new patent reading rests under this ADR**, and it does not claim
one. What it cites is the reading that already exists, by reference: spike 0030 §3.4 reduced US
11,071,911 claim 1 to four limitations, of which **911-a** (input positions repeatedly acquired from
a pointing device) and **911-d** (the movement direction changes with the distance between a
reference and the input position) have no counterpart in a discrete press, which has neither a
position nor a distance. Spike 0030 §4.4 read US 11,484,783 and US 11,673,043 as reciting one
continuous touch drag. A press is not a drag. ADR 0060 D-6.3 rests the discrete lanes on the same
reading.

### What exists

- **Lanes** (`apps/web/src/game/lanes.ts`): three discrete lanes, **A** and **D** by key
  (`STEER_KEYS`, `STEER_CODES`), the D-pad's left and right (buttons 14 and 15) and the left stick
  on a pad (`delivery/gamepad-input.ts` §`STANDARD_BUTTONS`), and OpenBikeControl's `steerLeft` and
  `steerRight` (`packages/sensors/protocol/src/open-bike-control.ts` §`OPEN_BIKE_CONTROL_BUTTON`). A
  lane press is a drawing, never physics. `steer-port.ts` has one method, `steer(intent)`.
- **Ride-time keys** share one discipline (`lanes.ts` §`intentOfKeyIn`): never from a form field,
  never with Ctrl, Alt or Meta held, never one a handler already took, and never a held key's
  repeats. Enter and Space are never ride keys (`delivery/throw-input.ts`'s reason).
- **Delivery's throw keys** are the arrows and Page Up and Page Down (`throw-input.ts`
  §`THROW_KEYS`), and its pad throws are face buttons 0, 1 and 2. Delivery does not run in an
  open-world ride (#2907), so those keys and buttons are free there.

---

## Decision

### D-1 — The interaction

1. **The bike follows the road by itself.** No input is needed to stay on the street.
2. **A prompt before each junction.** The prompt for a junction appears when the rider is **250 m**
   before it, or as soon as the previous junction is passed if that is nearer (*the author's
   choice*; #2882 and the tablet session #2910 may move it). It shows every way on, the default
   (D-1.4), the current choice, and how far until the choice is final.
3. **A discrete press chooses**: **left**, **straight** or **right** (with more than three ways on,
   left and right step through them in order round the junction). A press moves the choice one step
   and never a continuous or scaled amount. A held key's repeats choose nothing more.
4. **Nothing pressed: the default.** The default is the way on with the **smallest change of
   bearing**; on a tie, the one of the higher road class; then the right-hand one. Straight on, where
   a street goes straight on, is the default.
5. **The choice is final 100 m before the junction** (ADR 0087 D-6.2). After that, a press for that
   junction does nothing, and the prompt shows that it is locked. A junction whose lock point is
   already behind the rider when it becomes the next one (two junctions less than 100 m apart) takes
   its default, and the prompt says so.
6. **A U-turn action** turns the rider round on the street they are on, at any time. The grade is
   walked to the new direction's under ADR 0087 D-6.4 (1 % a second).
7. **A dead end turns the rider round** by itself, the same way.
8. Which ways count as a junction (a driveway, a service road, a footway) is the street graph's
   (#2886), not this ADR's.

### D-2 — Separate from lane steering

**A lane press never takes a turn**, and **a turn press never changes lane.** A, D, the D-pad's left
and right, the left stick and OpenBikeControl's `steerLeft` and `steerRight` keep their one job:
a lane. So steering round a parked car cannot choose a wrong street. The turn presses are D-3's.

### D-3 — The inputs (*the author's choice*, each)

| Input | Left | Straight | Right | U-turn |
|---|---|---|---|---|
| Keyboard, by `key` (and `code` for other layouts, as `STEER_CODES`) | ArrowLeft, Page Up | ArrowUp | ArrowRight, Page Down | ArrowDown |
| A bar remote | whichever of those keys it sends; ⚠️ which keys a given remote sends is unmeasured, and the #733 tablet step records it | | | |
| A gamepad, standard mapping | face button 2 | face button 0 | face button 1 | face button 3 |
| The Android shell's numbered buttons | 4 | 3 | 2 | none: the screen or a key |
| OpenBikeControl v1 | a button id the specification names for navigation left, if it names one | likewise up | likewise right | likewise down |
| The screen | the prompt's own buttons (#2898) | | | a U-turn button |

- The keys follow `intentOfKeyIn`'s discipline. No Enter, no Space.
- The pad and the numbered buttons take the places Delivery's throws use, so a rider learns one
  layout.
- OpenBikeControl: #2897 reads the specification and maps only ids it names. **The steering angle
  never takes a turn** (D-4).
- **Keyboard and screen-reader equivalents** (#2898): every choice on the screen is a button with a
  name a screen reader reads, the prompt is announced once when it appears and once when it locks,
  and every screen action has a key.
- **The touch lock stays whole** (ADR 0059 D-5, ADR 0060 D-13): no prompt button carries
  `TOUCH_LOCK_EXEMPT`, so with the lock on, the choice comes by key, remote, pad or controller, and
  with nothing pressed the ride takes the default. Put to the owner as D-9 Q3.

### D-4 — Out of scope

**Continuous or drag-scaled steering, and lean-to-turn from a steering angle** (OpenBikeControl's
`steeringAngle`, `MAX_STEERING_ANGLE_DEGREES`), do not choose a turn. They are out of scope unless a
patent reading is re-run first, or the owner extends the no-patent-limit ruling to them by name. A
single drag that both steers and chooses a turn is not built (ADR 0060 D-13.3's reason).

### D-5 — The trainer rule, as a test an implementer must write

1. **What a choice does.** A choice changes only **which branch the rolling route appends** past the
   next junction (#2895), until the lock. It never calls, names or reaches `setSimulationParameters`,
   `setTargetPower`, `setTargetResistance`, `letGo` or anything in the trainer-command seam, and it
   is not an input to `gradient.ts`. In ERG or a workout, the open-world ride sends what that state
   sends today.
2. **The static test: `apps/web/src/game/open-world/open-world-cannot-reach-trainer.test.ts`.** It
   calls `apps/web/src/game/cannot-reach-trainer-testing.ts` (**shared, not copied**), as
   `lap-race/lap-race-cannot-reach-trainer.test.ts` does:
   - **Roots**: every non-test module of the junction-choice input and its prompt, wherever #2897
     and #2898 put them, and every non-test module under the open-world mode's own directories in
     `apps/web` and `packages/`, through `modulesUnder`.
   - **Forbidden**: the trainer-command seam read off `scripts/check-wiring.mjs`
     (`trainerCommandSeam(WIRING_SOURCE)`), every trainer-control writer the #1807 rules find
     (`WRITERS_ON_DISK`), and `GAME_TRAINER_MODULES` (`game/trainer-port.ts`, `game/gradient.ts`,
     `ride/trainer.ts`).
   - **Red when planted**, through `plantedOver`: a root that imports `game/gradient.ts`; a root that
     imports a seam module; and a root that defines a trainer-control writer. Each is a case the test
     runs.
   - It fails closed on an import it cannot follow, as the walk already does.
3. **The behavioural test.** A static walk cannot see a value handed in at run time (ADR 0060
   D-2's note). So #2897 also rides **one power trace twice** through the real ride: once on an
   open-world ride that takes a left turn by a press before the lock, and once on an open-world ride
   through **the same open-world machinery** (the same street graph and height fixture, the same
   rolling-route builder, ADR 0087's ride-anchored grid and start) with that junction's branch fixed
   to the left and no press. The grades sent, and their times, are **byte-identical**. That proves the
   grade came from the road ridden, and from nothing about how the road was chosen. It is **not**
   compared with a stored route over the same streets: that ride reads its `RouteRecord`'s own
   heights on `routeProfile`'s stretched grid, and ADR 0087 D-4.1 and D-6.4 give the open-world ride
   other heights, another grid and another start, so the two could never match. A third ride presses
   after the lock and asserts the grades sent are those of the default branch.
4. **The keys' module imports nothing** that could bring the trainer onto its path, as `lanes.ts`
   already does.

### D-6 — Recording

A turn choice is not recorded: the recorded ride is the track the rider rode (#2906). No choice, no
prompt and no lock is stored or sent anywhere.

### D-7 — No instance, no paid service

Junction choice runs on the device. A rider with no instance has it (ADR 0036 D-3).

### D-8 — What #2883's ruling leaves for later

If the owner ever wants continuous steering to choose a turn (D-4), a patent reading is owed first,
or an explicit owner ruling naming it. This ADR does not decide that.

### D-9 — What the owner is asked to rule on

1. **Q0 — Accept this ADR before it merges, or merge it as Proposed?** Recommended: **accept before
   merge**.
2. **Q1 — The keys and buttons in D-3**: the arrows (and Page Up and Page Down) for a turn, A and D
   kept for lanes, pad face buttons in Delivery's places? Recommended: **yes**. They are free in an
   open-world ride because Delivery does not run there.
3. **Q2 — The prompt at 250 m, and the lock at 100 m** (D-1.2, D-1.5)? Recommended: **yes**, to be
   checked on the tablet in #2910.
4. **Q3 — The touch lock stays whole for the prompt** (D-3), so with the lock on a tablet rider
   chooses by key or remote, or takes the default? Recommended: **yes**, as ADR 0059 D-5 ruled for
   throws.

---

## Consequences

### What this enables

- **Turning onto real streets**, with every input the app already reads, and no new way for a press
  to reach the trainer.
- #2897 (the input), #2898 (the prompt), #2904 (the street map as preview) and #2905 (the look-ahead
  on the default branch) have rules to be held to.

### What this costs

- **A second set of ride keys** beside the lanes. A rider who presses an arrow expecting a lane
  change chooses a turn instead; the prompt says what each key does.
- **Late presses do nothing.** A rider who presses inside the last 100 m goes the way the lock froze.
  The prompt has to make the lock visible.
- **A static walk and a behavioural ride** per D-5, before the first turn is taken.
- **Dense grids may lock junctions early.** Two junctions under 100 m apart leave the second to its
  default.

### Constraints this places on other work

| Issue | Constraint |
|---|---|
| [#2897](https://github.com/openzigs/onyourleft/issues/2897) | D-1, D-2, D-3, D-4 and D-5 in full, including the static test with its three plantings and the behavioural ride |
| [#2898](https://github.com/openzigs/onyourleft/issues/2898) | D-1.2, D-1.5 and D-3's screen, keyboard, screen-reader and touch-lock rows |
| [#2895](https://github.com/openzigs/onyourleft/issues/2895) | A choice swaps the tail only before the lock (ADR 0087 D-6.2) |
| [#2904](https://github.com/openzigs/onyourleft/issues/2904), [#2905](https://github.com/openzigs/onyourleft/issues/2905) | They show the current choice, and the default where none is pressed |
| [#2906](https://github.com/openzigs/onyourleft/issues/2906) | D-6: no choice is recorded |
| [#733](https://github.com/openzigs/onyourleft/issues/733) | The bar-remote key measurement covers the arrows and Page Up and Page Down |

---

## What would make this ADR wrong

- **A bar remote sends only A and D**, or keys the turn presses do not include. Then a tablet rider
  with the lock on cannot choose a turn, and D-3's map changes.
- **OpenBikeControl names no navigation buttons.** Then an OpenBikeControl rider chooses by key or
  screen, and the map says so.
- **The static walk is changed** in `cannot-reach-trainer-testing.ts` in a way that drops a forbidden
  module. The test's known-writers check exists for that.
- **A future ruling lets continuous steering choose a turn** (D-8). Then D-4 and D-2 change, by a new
  ADR.
