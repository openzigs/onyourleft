# ADR 0028: How a race is fair — one physics, a re-simulating room, declared weight, and what is not decided here

- **Status**: Accepted — for the seven decisions below, **and five named questions in
  §"What the owner has not decided" are explicitly NOT decided and are the owner's.** D-0 means
  nothing can be built until they are, so an Accepted status here cannot cause code to be written
  against an unanswered question. The alternative — Proposed — was rejected because four of the
  decisions (D-1, D-4, D-5, D-6) bind work that is already filed, and an ADR a reader is told not to
  rely on cannot bind anything. This follows [ADR 0007](0007-patent-posture.md)'s own reasoning for
  the same choice
- **Date**: 2026-09-22
- **Deciders**: the author, on the engineering content. ⚠️ **No owner decision was sought or given
  for this ADR**, and the owner's one recorded statement on the subject is quoted in Context: *"We
  would probably also need to ensure we support figuring out speed based on weight and watts per
  kg"* ([#465](https://github.com/openzigs/onyourleft/issues/465), 2026-09-21). D-1 and D-2 are what
  that sentence requires; everything else is engineering work built around it. Five questions that
  are **not** engineering questions are listed rather than answered
- **Issue**: [#465](https://github.com/openzigs/onyourleft/issues/465). Parent
  [#16](https://github.com/openzigs/onyourleft/issues/16)
- **Number**: **0028**. [`docs/architecture.md`](../architecture.md)'s ownership table is the check
  `CLAUDE.md` §7 asks for; it recorded 0028 as the next free number once
  [ADR 0027](0027-a-tab-left-behind-by-another-tabs-update.md) took 0027 in the same pull request.
  ⚠️ **0021 is a live reservation** ([#330](https://github.com/openzigs/onyourleft/issues/330), the
  superseding of ADR 0007 D4's ghost ban, claimed and still unwritten) and is left alone for
  [ADR 0022](0022-game-scenery-model-pack.md)'s reason: a written ADR cannot be renumbered without
  breaking citations, so a collision would land on the reservation rather than here
- **Supersedes**: nothing. ⚠️ In particular it does **not** supersede or relax
  [ADR 0007](0007-patent-posture.md) D4 — see D-0
- **Rests on**: [spike 0005](../spikes/0005-live-racing-patent-read.md), the live-racing patent read
  ([#466](https://github.com/openzigs/onyourleft/issues/466)), whose §6 recommendation D-0 carries
  and whose §4 constrains D-2 and D-4
- **Relates to**: [ADR 0002](0002-local-first-architecture.md) (why there is no room yet),
  [ADR 0004](0004-privacy-and-location.md) (D-3's refusal),
  [ADR 0009](0009-clean-room-posture.md) (D-4),
  [ADR 0014](0014-portable-identity.md) (D-6),
  [#69](https://github.com/openzigs/onyourleft/issues/69),
  [#83](https://github.com/openzigs/onyourleft/issues/83),
  [#327](https://github.com/openzigs/onyourleft/issues/327),
  [#7](https://github.com/openzigs/onyourleft/issues/7)

---

## Context

### The question

**When several riders race, what decides who is faster — and how does anyone trust it?**

Speed in this program is already computed rather than reported. `packages/physics` implements
Martin et al. 1998 and is deterministic and platform-free; `apps/web/src/game/rider.ts` composes the
athlete's own mass (#325) with a bicycle, a riding position and its drag area (#365); #326 adds a
wind; the route supplies the gradient. **So watts per kilogram already drives climbing speed** for a
solo rider, which is the half of the owner's sentence that is done.

What racing adds is **fairness between people**, which a solo game never needed. A solo rider who
declares 60 kg when they weigh 85 is fooling nobody but themselves. In a race, the same declaration
takes a result off somebody else.

### What is not in place, and why that shapes this document rather than blocking it

**There is no room, and there cannot be one yet.** Owner decision D6: there is no server in Phase 1;
a server arrives with [#7](https://github.com/openzigs/onyourleft/issues/7).
[ADR 0002](0002-local-first-architecture.md) puts everything on the athlete's device. A race between
people needs a party that is not either of their devices, so racing is downstream of #7 whatever
this ADR says.

**And the patent reading that had to come first now exists.**
[Spike 0005](../spikes/0005-live-racing-patent-read.md) (#466) read eleven granted US patents
first-hand on 2026-09-22 and charted them against the design below. Its §6 recommendation is that
live racing is **outside ADR 0007 D4 as written** — D4 rules on *replay*, and a live race replays
nothing — but that **D4's silence is not clearance**, and that the constraints should be written down
in D2's shape before any code is written. D-0 takes that recommendation; §"The patent constraints"
is the list.

So this ADR decides the **shape** of something nobody may build yet. That is deliberate and it is the
cheapest moment to decide it: every one of the six questions below is free to answer now and
expensive to answer after riders have used the result.

---

## Decision

### D-0 — Nothing is built until three things clear, and this ADR builds nothing

| Block | What would clear it |
|---|---|
| **No server** (owner decision D6) | [#7](https://github.com/openzigs/onyourleft/issues/7). Until then there is no room |
| **The patent constraints are recorded but untested by counsel** | [Spike 0005](../spikes/0005-live-racing-patent-read.md) §5 Question A, on US 9,174,085 claim 1 — the claim whose whole distance from a peer race is carried by one limitation |
| **Five questions are the owner's** | §"What the owner has not decided" |

⚠️ **ADR 0007 D4 is untouched.** Its two ❌ — a ghost of another rider, and a ranked leaderboard
populated by ghost participants replaying prior sessions — bind exactly as before. A live race is
outside D4 because it **replays nothing**: every rider on screen is pedalling at that moment. **A
race with a ghost in it is D4's**, and D4's D5 procedure is the only way to move it.

### D-1 — One physics for everyone in a race, and the riding position is the race's rather than the rider's

Every rider in a race is simulated with:

| | |
|---|---|
| **The same model** | `packages/physics`, at one agreed version. D-2 rule 5 is what puts that version on the wire |
| **The same coefficients** | **What `apps/web/src/game/rider.ts` §`rideConditionsFor` already builds**: `MARTIN_1998_COEFFICIENTS` with **exactly two overrides and no others** — `withDragArea(ridingPositionDragArea(position))` for the race's position, and `GAME_ROLLING_RESISTANCE_COEFFICIENT`. **One set for the whole room**, never a per-rider one |
| **The same bicycle** | `apps/web/src/game/rider.ts` §`BICYCLE_MASS_KILOGRAMS`, for everybody |
| **Their own body mass** | The one thing that is per-rider and the one thing that is declared. #325's athlete mass |
| **A race-fixed riding position** | One of `rider.ts` §`RIDING_POSITIONS` — 0.42 / 0.36 / 0.31 m² — chosen by the race and **not changeable by a client, ever, and specifically not mid-race**. It is the `position` the coefficients row takes |
| **The same wind** | #326's vector, the race's rather than the rider's. A rider who could set their own tailwind is not racing |

⚠️ **The coefficients are the GAME's, not the package's defaults, and the two are different numbers.**
This row is written out because an earlier draft of it said both *"its own default coefficients"* and
*"a race-fixed riding position"*, which cannot both hold: a riding position **is** a drag area
(`RIDING_POSITIONS`, applied through `withDragArea`), so choosing one necessarily departs from
`MARTIN_1998_COEFFICIENTS`. What a race runs is the set in the table above, and it differs from the
package's defaults in two fields:

| Field | Package default | What a race runs | Where it is argued |
|---|---|---|---|
| `C_D·A` | **0.264 m²** (`0.88 × 0.3` — Martin's track racer) | the race's position: **0.42 / 0.36 / 0.31 m²** | `rider.ts` §`ridingPositionDragArea`, #365 |
| `C_RR` | **0.0032** (Kyle 1988, high-pressure clinchers on smooth asphalt) | **0.005** | `rider.ts` §`GAME_ROLLING_RESISTANCE_COEFFICIENT`, #365 |

Every other field — spoke drag, bearing friction, drivetrain loss, wheel inertia — is the package
default, unchanged.

Two reasons for taking the game's rather than the package's, in order of weight:

1. **A race must produce the same speed for the same watts as the solo game the rider just rode.** A
   rider who is measurably quicker alone than in a race would read the race as broken, and they would
   be half right: it would be a different bicycle on a different road. `C_RR` alone is worth roughly
   0.8 km/h at 150 W on the flat (`rider.ts` §`GAME_ROLLING_RESISTANCE_COEFFICIENT`), and the drag
   change is larger.
2. **Both overrides are already argued in the tree, and the package's defaults are argued for
   something else.** `MARTIN_1998_COEFFICIENTS` exists to reproduce a published paper —
   `martin-1998.test.ts` rests on it and `packages/physics` must keep it (`CLAUDE.md` §2) — and its
   rider is a track racer nobody in a room is. #365 moved both fields deliberately and recorded why.

⚠️ **Where those two constants live is a problem the room inherits, not one this ADR solves.** They
are under `apps/`, and nothing under `packages/` may import `apps/` — `eslint.config.js`'s
`boundaries/dependencies` block, `CLAUDE.md` §4d. So a room cannot read them where they sit, and
whoever writes D-2's rule moves them into `packages/` (with the game reading them from there, so
there is one set rather than two that can drift) rather than restating the numbers.
[#487](https://github.com/openzigs/onyourleft/issues/487) carries it.

⚠️ **The riding position is race-fixed rather than derived from the rider's height, and that is a
decision against what #465 notes other platforms do.** Three reasons, in order of weight:

1. **There is no height→frontal-area correlation this project may use.** ADR 0006 R1 and
   [ADR 0009](0009-clean-room-posture.md) permit taking facts and forbid taking somebody's
   *compilation* of them. A published anthropometric correlation is a compilation, and
   `packages/physics/README.md` §2 already records that **Martin reports only the product `C_D·A`**
   and that this package's split between the two factors is its own. Deriving a frontal area from a
   height would mean inventing a correlation and presenting it as physics.
2. **Height is a new personal datum about a rider's body.** ADR 0004's posture is that data about a
   person is not collected without a need that cannot be met otherwise, and this need can be.
3. **A fixed position is checkable by reading the room's code.** A declared height is a *second*
   thing to police alongside mass, with the same honesty problem and none of the same visibility —
   nobody's power–duration curve reveals a lie about their height.

**The accepted cost, stated plainly.** A 1.55 m rider and a 1.95 m rider get the same drag area.
That is wrong, and it is wrong in the direction that flatters the larger rider on the flat. Their
**mass is still their own**, so climbing — where W/kg dominates and where the owner's sentence points
— is unaffected. A height-derived area is the natural way to fix it and is reopened by Q1.

### D-2 — The client simulates, the room re-simulates, and the room's position is the one that counts

The rider's own screen must be instant, so the client simulates locally from its own trainer's power
and draws immediately. **The room re-simulates every rider** from what they reported, and the room's
position is authoritative. A client that disagrees is corrected toward the room's answer and is never
asked to re-report.

`packages/physics` can run unchanged inside a Worker because it names no platform API — that is
`CLAUDE.md` §2's table and `eslint.config.js`'s `no-restricted-globals` block, not an aspiration.

#### What a room checks — the rule's shape, written here rather than as code

⚠️ **This is a deviation from #465's third acceptance criterion**, which asks for the rule *"as a
pure function in `packages/` with a mutation-tested rejection case"*, and it is recorded as one. The
reason is #465's own standard applied to itself: an implementation of a rule for a room that does not
exist, fed by a transport that does not exist, with thresholds nobody has agreed (Q3), is
`CLAUDE.md` §4a's *"a documented command nobody has run"* in a new place — and **worse than absent**,
because a reviewer reads plausible validation code as evidence that the validation question was
settled. The shape is settled here; the function is written by whoever builds the room, against this.

⚠️ **The remainder is carried by [#487](https://github.com/openzigs/onyourleft/issues/487)**, which
is the repair `CLAUDE.md` §7 names for a closing keyword that reaches further than the work does:
#465 closes with this criterion unmet, so the criterion lives in the tracker rather than only in this
paragraph. #487 is blocked on #7 and on Q3, and it carries D-1's constant move with it.

A report is `{ riderId, sequence, atMs, powerWatts, cadenceRpm? }`; the rider has a declared
`massKilograms` and a `physicsVersion`. In order:

1. **Admissibility of the report, not of the rider.** A monotone `sequence`, an `atMs` inside the
   room's own window, a `powerWatts` in `[0, ceiling]`, a `massKilograms` in a stated human range.
   ⚠️ **An inadmissible report is discarded and the rider is coasted** — advanced at zero power
   through the same `advance` — and **never extrapolated**. A room that invents a plausible power
   for a rider whose connection dropped has made up the race's result.
2. **Plausibility is judged over a window, never per sample.** A single 1800 W sample is a sprint; a
   1800 W five-minute mean is not a person. The rule is a **power–duration ceiling**: for each of a
   fixed set of durations, the rider's best mean power over that duration, divided by their declared
   mass, must not exceed a stated W/kg ceiling for that duration.
   `packages/domain/src/analysis/power-duration.ts` already computes the curve; the ceilings are
   numbers this project has not chosen, and choosing them is **Q3**.
3. ⚠️ **A breach FLAGS the result. It does not eject the rider and it does not delete the ride.**
   Three reasons: a room that silently drops a rider mid-race has produced a worse wrong answer than
   a flagged win; the declared mass is the likeliest cause and the rider may simply have typed it
   wrongly; and [#69](https://github.com/openzigs/onyourleft/issues/69) already owns
   implausible-effort exclusion, so the flag is an input to a decision somebody else makes rather
   than a decision this rule makes. **A flag is visible to every rider in the room**, because a
   result nobody can see is questioned is not a fair result.
4. **The room's position wins, and the disagreement is measured.** Where the client's own position
   and the room's differ by more than a stated distance the client is corrected. ⚠️ **The size of
   that disagreement is itself a signal** and is worth publishing: a client persistently ahead of its
   own re-simulation is either on different arithmetic (rule 5) or is not reporting what it is
   simulating.
5. **A physics version travels with every report and a room refuses a version it does not share.**
   This is the rule the whole of D-2 rests on and it is the one easiest to leave out.
   `packages/physics/src/agreement.test.ts` is where a change to the model's answer becomes a
   **visible event**: it pins the position a fixed trace produces, digit for digit, so a coefficient
   moved in the fourth significant figure is a red build rather than a race where the room and the
   client quietly disagree about who won.

### D-3 — Weight is declared. Honesty is bought with categories and flags, not with proof

**Mass is self-declared and there is no way to verify it.** This ADR does not pretend otherwise;
what it decides is which of #465's four options apply to a casual race.

| Option | Decision |
|---|---|
| **Category by W/kg with a declared weight** | **Yes.** D-4 |
| **Outlier flags on power/weight curves** | **Yes.** D-2 rule 2, reported to #69 |
| **Dual recording (a second power source) for anything with a prize** | **Not now, and conditional on a prize existing.** No prize exists. **Q2** is the owner's |
| **A video weigh-in** | ⚠️ **Refused outright unless a prize exists**, and reopened only by the owner. It asks a person to photograph themselves on a scale to play a game; ADR 0004's posture is that data about a person is not collected without a need that cannot be met otherwise, and no casual race has such a need. The body-image cost of making it normal is real and is not paid here |

⚠️ **A rider's declared mass is used in the physics and is not shown to other riders.** Their
**category** is. This is a default rather than a law of nature and **Q4** is the owner's if they want
the opposite; it is decided this way because a number about a person's body, shown beside their name
to strangers, is a thing to opt into rather than out of.

### D-4 — Categories are W/kg bands, named in this project's own plain English

1. **By W/kg bands, not by a results-based rating, for the first cut.** A rating needs a corpus of
   results and there are none — zero races have been ridden. A rating is **deferred, not rejected**;
   it is the better answer once results exist, and it is the answer that does not depend on a
   declared weight at all, which makes it the natural successor to this decision rather than its
   rival.
2. ⚠️ **No competitor's category letters, band boundaries or scoring system is copied or
   consulted.** [ADR 0009](0009-clean-room-posture.md), and the same posture `CLAUDE.md` §6 takes to
   the load-metric names: *"do not rename them to the familiar ones"*. A lettered scheme with
   somebody else's boundaries is that project's compilation; **a number is not**.
3. **So a band is named by what it is** — its own W/kg range, in the rider's own units — rather than
   by a letter. The boundaries themselves are a product decision and are **Q5**.
4. **A rider rides the category their declared mass and their recorded power put them in**, and the
   room says which that is. A rider may enter a *harder* category and may not enter an easier one;
   that asymmetry is the one that cannot be gamed.

### D-5 — The first races have no drafting

⚠️ **Out, for the first cut.** Four reasons, and the fourth is the one nobody would guess:

1. It is a multi-year tuning problem, which #465 says itself, and
   [#327](https://github.com/openzigs/onyourleft/issues/327) owns it.
2. `packages/physics` models none, and says so: `simulate.ts` §"What it deliberately does not model"
   names *"braking, cornering, drafting, gears and cadence"*. Adding one is a change to the single
   model the whole product rests on, and it lands in the package whose tests reproduce a published
   paper (`martin-1998.test.ts`).
3. **Drafting changes who wins.** A first cut with a bad draft model is worse than one with none,
   because riders will attribute the wrongness to the race rather than to the model — and the race is
   the thing that has to be trusted.
4. **It is the part of this design with the least patent reading behind it.** Spike 0005 §1.4 records
   that its searches found **no granted US patent claiming a drafting or slipstream model in a
   virtual cycling environment**, and that *"the absence of a hit is weak evidence"*. Everything else
   in this ADR has been charted against read claims; this has not.

**One thing about it is decided here for when it arrives: a draft reduces `C_D·A` and nothing else.**
Not mass, not rolling resistance, not the gradient. That is #465's own statement and it is the
correct physics — being in somebody's wake changes the air you are pushing and nothing about the
road under you.

### D-6 — Identity is the device keypair, and a **public** room is blocked on moderation

1. **A result is signed by the device keypair** (#61, [ADR 0014](0014-portable-identity.md)). That
   is enough to establish *the same device produced these reports*, which is what a race needs from a
   single session.
2. ⚠️ **It is NOT enough to establish a person.** ADR 0014 has no rotation and no recovery: an
   identity here is a **device**, not a human, and a new keypair costs nothing. So the same mechanism
   that makes a result attributable makes a ban worthless.
3. **Therefore: a race among people who already know each other — a shared room code — needs nothing
   more.** That is the first cut.
4. ⚠️ **A public room is blocked on [#83](https://github.com/openzigs/onyourleft/issues/83).** Not
   "should have moderation": blocked. A public room with free identities and no moderation is a
   place where a rider ejected for cheating returns thirty seconds later under a new key, and where
   the display name is the only rider-supplied string anybody else sees. This is recorded as a block
   so that a future issue cannot ship a public room and file moderation as a follow-up.
5. **A display name is rider-chosen, unverified, and shown. Nothing else about a rider is** — not
   their mass (D-3), not their location, not their other rides.

### D-7 — The patent constraints, in ADR 0007 D2's shape

Taken from [spike 0005](../spikes/0005-live-racing-patent-read.md) §6 recommendation 2. Each is
checkable by reading our own code and none requires a reader to have read a patent.

1. **No exercise class, and no course content served from an instance.** A race's course is a route a
   rider imported or saved — their own data (ADR 0002). ⚠️ Spike 0005 §4 records that the *cycling
   class* limitation carries the **whole** distance between this design and US 9,174,085 claim 1, so
   a "featured route of the week" delivered from a server is the single change that erodes it most.
2. **No instructor, and nobody leading a session.**
3. **No synchronising signal embedded in content**, because there is no content. Riders are placed by
   distance along a route.
4. **No archived or previously recorded performance parameters in a race.** This is also ADR 0007
   D4's ❌ and is doubly binding.
5. **No threshold-derived "performance zone" leaderboard, and no leaderboard overlaid on a
   broadcast.**
6. **No team-versus-team win condition spanning two locations in the world.** ⚠️ This one is inert
   today and becomes live the moment #16 wants team events — spike 0005 §3.5.
7. **Deliberate care with live standings.** A **finish order after the race** is decided here as what
   a race produces. A dynamically updating ranked list *during* it is spike 0005 §5 Question B and is
   not decided.

---

## Consequences

### What this enables

- **#16 has a shape to build to** when D-0's three blocks clear, with every question #465 asked
  either answered or named as the owner's.
- **#465's criterion 2 is discharged**: `packages/physics/src/agreement.test.ts` pins the position a
  fixed trace produces, digit for digit, so the arithmetic two builds share is a checked property
  rather than an assumption. D-2 rule 5 is the rule it enforces.
- **#327 is unblocked in the sense that matters**: it knows drafting is out of the first cut and that
  when it lands it reduces `C_D·A` only.
- **#83 knows it is a blocker** rather than a nice-to-have, which is a different piece of
  information from "moderation would be good".

### What this costs

- **A large rider and a small one push the same air** (D-1). Accepted, argued, and reopened by Q1.
- **A rider who lies about their weight will usually get away with it** (D-3). The flag catches the
  implausible, not the shaded. That is the honest position and no product in this space does better
  without a prize's worth of apparatus.
- **No drafting means the first races are not bunch racing** (D-5). They are time trials with other
  people on the road, and that is worth saying out loud rather than discovering.
- **#465's third acceptance criterion is not met as written** (D-2). The rule is specified here and
  not implemented; the reason is in D-2 and it is a deliberate deviation rather than an omission.
  ⚠️ **[#487](https://github.com/openzigs/onyourleft/issues/487) carries the remainder**, so the gap
  is in the tracker and not only in this document.

### Constraints this places on other work

| Issue | What it inherits |
|---|---|
| [#16](https://github.com/openzigs/onyourleft/issues/16) | All of D-0 through D-7 |
| [#69](https://github.com/openzigs/onyourleft/issues/69) | D-2 rule 3 — it is where a flag goes |
| [#83](https://github.com/openzigs/onyourleft/issues/83) | D-6.4 — it blocks a public room |
| [#327](https://github.com/openzigs/onyourleft/issues/327) | D-5, including the `C_D·A`-only rule |
| [#7](https://github.com/openzigs/onyourleft/issues/7) | D-0's first block, and D-2's room |
| [#466](https://github.com/openzigs/onyourleft/issues/466) | Closed by spike 0005; D-7 is where its recommendation landed |
| [#487](https://github.com/openzigs/onyourleft/issues/487) | D-2's rule, as the pure function #465 asked for, and D-1's two constants moved into `packages/` where a room can read them |

---

## What the owner has not decided

⚠️ **Five questions. None is an engineering question, and none is answered above.** Each says what
turns on it, so an answer can be short.

**Q1 — Should a race derive frontal area from a rider's declared height, instead of fixing the
riding position?** D-1 says no, on three grounds, and names the cost: a 1.55 m and a 1.95 m rider get
the same drag area. Answering "yes" means accepting a second declared number about a rider's body and
sourcing a height→area relation this project can defend under ADR 0009.

**Q2 — Will a race ever carry a prize, a stake or a ranking anybody values enough to cheat for?**
D-3 makes dual recording and a video weigh-in conditional on this and refuses both while the answer
is no. It also decides how much apparatus D-2 rule 2 is worth building.

**Q3 — What are the W/kg ceilings, at which durations?** D-2 rule 2's shape is decided; its numbers
are not. A ceiling set too low flags honest strong riders and a ceiling set too high flags nobody.
⚠️ This is the one question where **published physiological figures exist** and where taking somebody
else's *table* would be taking a compilation (ADR 0006 R1), so the answer should say where its
numbers come from.

**Q4 — May a rider's declared mass be shown to other riders in the room?** D-3 says no by default and
shows the category instead. "Yes" is a defensible answer — it is what makes a lie visible to a human
— and it is a privacy decision rather than an engineering one.

**Q5 — What are the category boundaries, and what are the categories called?** D-4 decides they are
W/kg bands with plain descriptive names and no competitor's scheme consulted. The numbers and the
words are a product decision.

And one that is the owner's in a different sense:

**Q6 — Is spike 0005 §5 Question A bought before any racing code is written?** D-0 carries the
spike's recommendation that it should be. It is a decision about money and risk appetite.

---

## What would make this ADR wrong

- **Spike 0005 §5 Question A comes back saying the *cycling class* limitation is met by
  equivalents.** Then a live race is a design problem rather than a documentation one, D-7.1 is not
  enough, and #16 stops until a design-around exists. This is the single most likely way this
  document becomes wrong.
- **A pending Peloton continuation issues with a live claim that drops the class limitation.** Spike
  0005 §1.4 records that **no pending application was read**, in a family with seven granted US
  members from one 2012 priority.
- **The re-simulation turns out not to be reproducible across CPU architectures.**
  `agreement.test.ts` argues that it is — IEEE 754 exactly specifies `+ − × ÷` and `Math.sqrt`, and
  `terms.ts` uses no transcendental — but that is an **argument, not a measurement**: this suite has
  only ever run on one architecture. A room on x86 and a phone on ARM disagreeing in the last bits
  would not change who wins a race, but it would make D-2 rule 4's correction fire constantly, and it
  would falsify the sentence in `agreement.test.ts`'s header rather than this ADR's decision.
- **W/kg categories are found in practice to be gamed harder than they are respected.** D-4's
  deferred alternative — a results-based rating — is the successor, and it needs the corpus that only
  running races produces. If the first season is dominated by riders in the wrong category, D-4 was
  the wrong first cut and the cost was one season.
- **Drafting turns out to be the feature, not a refinement** (D-5). If nobody wants a time trial with
  company, the first cut is not worth shipping and #327 is a prerequisite rather than a successor.
- **A public room ships without #83.** Then D-6.4 was written and ignored, which is the failure mode
  `CLAUDE.md` §4j exists for in a different domain: a rule nothing enforces. ⚠️ **Nothing mechanical
  checks any decision in this ADR** — ADR 0007's own §"Which of D1–D7 a machine checks: none of
  them" applies here verbatim, and a reviewer noticing is the entire mechanism.

---

## Amendments

Appended under [ADR 0013](0013-adr-amendments.md). Nothing above this line has been edited.

- **2026-09-22** — **The owner has answered all six questions, and one of the answers changes a
  decision.** [#488](https://github.com/openzigs/onyourleft/issues/488) carries them verbatim. Five
  of the six ratify what the body already decided; **Q5 does not**, and §"What the owner has not
  decided" is therefore no longer a list of open questions but a record of what was asked.
  ⚠️ **A reader who remembers this ADR having five open questions is reading the old file.** Each
  answer is below with exactly what it changes.

  | | Question | Owner's answer | What it changes |
  |---|---|---|---|
  | **Q1** | Height-derived frontal area, or a fixed riding position? | **A fixed position for all riders.** No height is collected; every rider gets identical drag | **D-1 is unchanged and is now owner-ratified.** It was the author's engineering judgement and is now a decision. The cost D-1 names stands as written: a 1.55 m and a 1.95 m rider push the same air, which flatters the larger rider on the flat. Climbing is unaffected, because mass is each rider's own |
  | **Q2** | Will a race ever carry a prize, a stake or a ranking worth cheating for? | **No stakes, for now.** Reversible: prizes, if they ever come, arrive with their own verification decision | **D-3 is unchanged.** Dual recording and the video weigh-in stay refused, and the weigh-in stays refused *outright* rather than deferred. D-2 rule 2's apparatus is sized for a friendly race and not for a prize |
  | **Q3** | The W/kg ceilings, and what happens at one? | **The tighter set, and a breach flags only** — about **18 W/kg at 5 s, 10 at 1 min, 6.5 at 20 min, 5.5 at 1 h** | **D-2 rule 2 gains numbers and D-2 rule 3 is confirmed.** The table below is where they are written down, with what each is anchored to. A breach **flags for review and never rejects mid-race** |
  | **Q4** | May declared mass be shown to other riders? | **No. The category only.** A rider may choose to share their own | **D-3's closing paragraph is unchanged and is now owner-ratified.** ⚠️ It interacts with Q5 — see the note under the table |
  | **Q5** | The category boundaries and names? | **No categories in the first cut.** Everyone races together and results show power-to-weight | ⚠️ **D-4 IS CHANGED.** Its W/kg bands are **deferred, not shipped.** D-4's reasoning survives — bands rather than a results-based rating, named by their own numbers rather than by anybody's letters, with no competitor's scheme consulted — and it describes what the *second* cut does. The first cut has no category at all |
  | **Q6** | Patent counsel before racing code? | **No counsel. Proceed on spike 0005's claim reading**, as the owner's decision on risk | **D-0 loses its second block and keeps its first.** The counsel block is lifted; *"there is no server in Phase 1"* ([#7](https://github.com/openzigs/onyourleft/issues/7), owner decision D6) stands, and so does the third block, which this entry discharges rather than lifts |

  ### What Q5 costs, said plainly

  **With no categories, the plausibility flags of Q3 are the only guard in the first cut.** D-3's
  whole answer to a declared weight was *"categories and flags"*, and Q5 has removed one of the two.
  What is left is D-2 rule 2's ceiling, and D-2 rule 3 says that a breach flags rather than ejects —
  so a rider who under-declares by a plausible margin is not caught by anything at all. That is the
  accepted position and it follows from Q2: nothing is at stake, so the apparatus is sized for a
  friendly race.

  ⚠️ **Q4 and Q5 together leave nothing about a rider's weight visible.** D-3 shows the category
  rather than the mass, and Q5 says there is no category; so in the first cut the only public
  quantity derived from a declared mass is the **power-to-weight shown with a result**, which is
  Q5's own answer. That is more than D-3's default contemplated and less than Q4 refused, and it is
  recorded here because neither question was asked about it.

  ### Q3's four ceilings, and where each number comes from

  ⚠️ **Each figure is anchored to ONE named individual's published performance or measurement, and
  no power-profile table was consulted or copied.** [ADR 0006](0006-fit-codec-licensing.md) R1 permits
  taking facts and forbids taking somebody's *compilation* of them, and a published power-profile
  chart — a grid of durations against categories — is exactly such a compilation. So there is one
  citation per number, chosen for being a single performance rather than a row in somebody's table,
  and the provenance column says how it was read rather than merely that it exists.

  **Provenance is one of two words and the distinction is load-bearing.** `first-hand` means the
  page was fetched and the figure read from it on the date given. `unsourced` means a named
  individual case study was *identified* and the figure is reported from search-result summaries of
  it, with the article itself behind a paywall and **not read** — that is a lead, not a citation,
  and the number stands as the owner's shape until somebody reads the paper.

  | Duration | Ceiling | Anchored to | What the anchor actually measures | Provenance |
  |---|---|---|---|---|
  | **5 s** | **18 W/kg** | **Sir Chris Hoy — 2500 W, *"over 27 watts per kilo"*, 92 kg** — UCI, *Track sprinting: a question of watts?*, uci.org | An **instantaneous peak**, not a 5 s mean. The same page gives **André Greipel** 1903 W peak and **1326 W averaged through the winning sprint** of stage 6 of the Tour Down Under, and gives no mass for him, so that one is not converted here | **first-hand**, read 2026-09-22 |
  | **1 min** | **10 W/kg** | — | The one 1-minute figure for a named individual found first-hand is the UCI page's **Robert Förstemann**, *"around 700 W for just over a minute"*, which is a demonstration and not a maximal effort. It is recorded as what it is rather than pressed into service as a bound | **unsourced**, searched 2026-09-22 |
  | **20 min** | **6.5 W/kg** | **Chris Froome** — Bell PG, Furber MJW, Van Someren KA, Antón-Solanas A, Swart J, *The Physiological Profile of a Multiple Tour de France Winning Cyclist*, Med Sci Sports Exerc **49(1):115–123**, January 2017 | The paper's own reported figures are VO₂peak 5.91 L·min⁻¹ (84 mL·kg⁻¹·min⁻¹) and a ramp **peak power output of 525 W** — neither of which is a 20-minute mean. The 20–40 minute figure that is widely reported from the same 2015 release is **419 W at a 67 kg racing weight**, about **6.25 W/kg** | **unsourced** — the article returned HTTP 402 and was not read; figures are from search-result summaries, 2026-09-22 |
  | **1 h** | **5.5 W/kg** | **Miguel Indurain's 1994 hour record** — Padilla S, Mujika I, Angulo F, Goiriena JJ, *Scientific approach to the 1-h cycling world record: a case study*, J Appl Physiol **89(4):1522–1527**, 2000 | A subject of **81 kg** covering **53.040 km** at an estimated mean **509.5 W**, which is **6.29 W/kg sustained for a full hour** | **unsourced** — the article returned HTTP 403 and was not read; figures are from two independent search-result summaries that agreed, 2026-09-22 |

  **Four things this table establishes, and they are not all comfortable.**

  1. **Only one of the four numbers has a first-hand anchor, and it does not bound the ceiling.**
     Hoy's 27 W/kg is an instantaneous peak; a 5 s *mean* is lower than a peak by an amount nothing
     read here measures. So the 5 s row says where the number came from and does not claim the
     ceiling sits above or below any performance.
  2. ⚠️ **The 1 h ceiling is BELOW the hour-record lead, by about 13 %.** If 6.29 W/kg is right,
     5.5 W/kg at 1 h flags a published world hour record. The owner's answer accepts that *"some
     genuinely strong riders will be flagged"*; this is what that looks like at the top end, and it
     is the row most likely to want revising once somebody reads the paper.
  3. **The 1 min ceiling has no anchor at all and is marked so.** Inventing one would have been
     worse than leaving it: a citation that does not support its number is how a figure stops being
     re-examined.
  4. **The 20 min ceiling clears its lead by about 4 %**, which is thinner than it looks: 6.5 W/kg
     against 6.25, on a figure that is itself a *reported* 20–40 minute mean rather than a
     20-minute maximal one. A rider whose best 20 minutes is genuinely at the top of the sport is
     inside a rounding error of being flagged, which is the first row Q3's *"some genuinely strong
     riders will be flagged"* actually bites in a race somebody might ride.

  **What happens at a ceiling is unchanged from D-2 rule 3 and is restated because Q3 asked:** a
  breach **flags the result for review**. It does not eject the rider, it does not delete the ride
  and it never rejects mid-race. ⚠️ **A flag is a report somebody has to handle**, which the owner
  accepted as the second named cost. [#69](https://github.com/openzigs/onyourleft/issues/69) owns
  implausible-effort exclusion and is where a flag goes;
  [#83](https://github.com/openzigs/onyourleft/issues/83) owns moderation and is what a public room
  is blocked on. Neither is built, so **until one of them is, a flag has nowhere to go** — and with
  Q5 removing categories, a room that flags into a void is the whole of the first cut's honesty
  apparatus.

  ### Q6, and the words that are not softened

  The counsel block in D-0 is lifted **by a decision about risk appetite, not by a finding about
  risk.** Nothing in [spike 0005](../spikes/0005-live-racing-patent-read.md) has changed and its own
  warning is repeated here rather than paraphrased: **it is not legal advice and it is not a
  freedom-to-operate opinion**, *"no systematic landscape search was performed"*, **no lawyer has
  reviewed it**, and **no pending application in the Peloton family was read** — §1.4 records seven
  granted US members from one 2012 priority, and a design-around verified against granted claims is
  not verified against claims in prosecution. **Anyone citing this amendment as clearance is
  misusing it exactly as §5 says anyone citing the spike that way would be.**

  §"What would make this ADR wrong" is unchanged and its first bullet is now the residual risk the
  owner has accepted rather than a question somebody was going to buy an answer to.

  ### What is still blocked

  **Everything.** D-0's first block stands: there is no server in Phase 1, so there is no room, and
  [#7](https://github.com/openzigs/onyourleft/issues/7) is what clears it.
  [#487](https://github.com/openzigs/onyourleft/issues/487) — D-2's rule as the pure function #465
  asked for, and D-1's two constants moved into `packages/` where a room could read them — is
  unblocked on Q3 by this entry and remains blocked on #7. **No racing code is written by this
  amendment and none may be written now**, which is the same sentence as before Q6 was answered and
  for a different reason.
