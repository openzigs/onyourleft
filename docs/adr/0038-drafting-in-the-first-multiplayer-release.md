# ADR 0038: Drafting is in the first multiplayer release — a multiplier on `C_D·A` from published data, superseding ADR 0028 D-5

- **Status**: Accepted. The owner ruled that the first multiplayer release includes drafting, and that
  the patent-risk acceptance for live racing covers it; both are quoted verbatim in Context. **Nothing
  is built by this ADR.** It is the decision [#786](https://github.com/openzigs/onyourleft/issues/786)
  (the model) and [#787](https://github.com/openzigs/onyourleft/issues/787) (rooms and the game) wait on
- **Date**: 2026-09-29
- **Deciders**: **the owner**, on including drafting (ruling 3 of
  [2026-09-28](https://github.com/openzigs/onyourleft/issues/16#issuecomment-5879636643)) and on the
  patent risk (Q10, in [the acceptance of the planner's recommendations](https://github.com/openzigs/onyourleft/issues/16#issuecomment-5880031406)).
  **The author**, on the model's shape and its coefficients. Every number in D-3 is either read from a
  cited paper on the date given or marked *unsourced — the author's choice*
- **Issue**: [#764](https://github.com/openzigs/onyourleft/issues/764), in bundle
  [#825](https://github.com/openzigs/onyourleft/issues/825). Answers the discussion in
  [#327](https://github.com/openzigs/onyourleft/issues/327)
- **Number**: **0038**, reserved with 0036, 0037 and 0039 in the same pull request — see
  [ADR 0036](0036-a-self-hostable-instance-server-now.md)'s Number line
- **Supersedes**: [ADR 0028](0028-racing-fairness.md) **D-5 only** — *"The first races have no
  drafting"*. D-5's last paragraph (*"a draft reduces `C_D·A` and nothing else"*) is **kept** and is
  D-1 below. No other decision of ADR 0028 is touched. ADR 0028 gains an appended amendment in the same
  pull request ([ADR 0013](0013-adr-amendments.md))
- **Rests on**: Blocken et al. 2018 and 2013 (D-3), and
  [spike 0005](../spikes/0005-live-racing-patent-read.md) §1.4 on patents
- **Relates to**: [ADR 0028](0028-racing-fairness.md) D-1, D-2 and D-7,
  [ADR 0007](0007-patent-posture.md) D4, [ADR 0009](0009-clean-room-posture.md),
  [`packages/physics/README.md`](../../packages/physics/README.md) §2

> ## ⚠️ The patent half of this is a risk decision, not a finding
>
> Nothing here establishes that a drafting model is outside anybody's claims. Spike 0005's searches
> found no granted US patent claiming one, and the spike itself calls that *"weak evidence"*. The
> owner has accepted the risk, as recorded in D-7.

---

## Context

### What the owner decided, quoted so it is not argued again

Ruling 3, 2026-09-28:

> **First multiplayer release covers all four:** private group ride, private race, public rooms, and
> drafting. Public rooms still owe ADR 0028 D-6's moderation and identity prerequisites (#83,
> ADR 0014). Drafting overrides ADR 0028 D-5's "first races have no drafting", so it needs its own ADR
> decision.

And the owner's acceptance of the planner's recommendations, the same evening, verbatim:

> **Owner, 2026-09-28: the planner's recommendations for Q8–Q11 and Q14–Q18 are accepted as
> written.** Those are: no live standings list, only the gap to one chosen rider and the finish order
> afterwards; no keep-together in the first group ride; the patent-risk acceptance covers drafting;
> the room server is AGPL and the shared maths is Apache; cross-instance racing is deferred to #56;
> the server is `apps/instance`; WebSocket compression is off by default; only W/kg is shown beside
> other riders' names; no bot pacer in rooms. Voice chat is to be evaluated in #794.

The clause *"the patent-risk acceptance covers drafting"* is Q10.

### What ADR 0028 D-5 said, and what this document owes it

D-5 put drafting out of the first cut with four reasons, and *"the fourth is the one nobody would
guess"*. An override that did not answer them would be the owner's ruling applied without its cost
being read. So each is quoted and answered in D-6, one paragraph each.

### The published data, and how it was read

Facts and equations from published papers carry no licence restriction (`CLAUDE.md` §6). **No other
product's draft curve, cone or coefficients was consulted as a table**
([ADR 0009](0009-clean-room-posture.md)). #327 recorded a community measurement of a commercial
game's draft; it is not used here for any number.

| Source | How it was read | Date |
|---|---|---|
| **Blocken B, Toparlar Y, van Druenen T, Andrianne T.** *Aerodynamic drag in cycling team time trials.* J. Wind Eng. Ind. Aerodyn. **182** (2018) 128–145 | **First-hand**: the accepted-manuscript PDF on [lirias.kuleuven.be](https://lirias.kuleuven.be/server/api/core/bitstreams/629ef275-2fca-47e9-a7ac-2f914d34cec8/content). The per-rider figures in D-3 were read **off Figs. 9–13** (pacelines of 2 to 9 riders at d = 0.05, 0.15, 0.5, 1 and 5 m), which are images; the text around them was read for the claims quoted | 2026-09-29 |
| **Blocken B, Defraeye T, Koninckx E, Carmeliet J, Hespel P.** *CFD simulations of the aerodynamic drag of two drafting cyclists.* Computers & Fluids **71** (2013) 435–445 | **The abstract only**, from the [TU/e research portal listing](https://research.tue.nl/en/publications/cfd-simulations-of-the-aerodynamic-drag-of-two-drafting-cyclists/) via search. The full paper was **not** read | 2026-09-29 |
| **Blocken B et al.** *Aerodynamic drag in cycling pelotons.* J. Wind Eng. Ind. Aerod. **179** (2018) 319–337 | **At one remove**: as cited in the 2018 team-time-trial paper above — *"the aerodynamic resistance of a rider well embedded in the core of the peloton could go down to 5–10% of that of an isolated cyclist"*, and average drag of *"21.1 and 21.9%"* for its two pelotons | 2026-09-29 |
| Térol et al. 2025 | **Not read.** #327 records −4.3 % leading and −27.9 % trailing; nothing below uses it | — |

---

## Decision

### D-1 — A draft is a multiplier on the rider's `C_D·A`, supplied by the caller, and nothing else

**`C_D·A_effective = k × C_D·A`**, with **`k ∈ (0, 1]`**. Not mass, not rolling resistance, not the
gradient — ADR 0028 D-5's last paragraph, kept word for word in substance.

- **`packages/physics` gains a pure function that computes `k`** ([#786](https://github.com/openzigs/onyourleft/issues/786)).
  The integrator does not call it. The **caller** — the room, or the client predicting for its own
  screen — computes `k` and passes the product into the coefficients it already passes. With `k = 1`
  the tick is byte-for-byte what it is today, so `martin-1998.test.ts` and the Martin reproduction are
  untouched.
- **Two multipliers, multiplied together**: `k_behind` for the riders ahead of this one (D-3.1), and
  `k_ahead_of` for a rider close behind (D-3.2, the leading-rider effect). Both are ≤ 1.
- **The model is versioned with `physicsVersion`** (ADR 0028 D-2 rule 5). Changing a coefficient is a
  new version, never a live edit.

### D-2 — Inputs, output and the arithmetic it may use

- **Inputs**, for each other rider within the window: the **longitudinal gap** in metres, along the
  route (ADR 0028 D-7.3: riders are placed by distance along a route). **Nothing else about another
  rider's position, and no lateral offset** — D-3.4 says why. **Not** a boolean "drafting".
- **The window**: riders ahead with a gap of at most **30 m** (D-3.3). Riders behind within **30 m**
  for `k_ahead_of`. A rider whose gap to this one is **below 0.05 m either way is level**: neither
  ahead of nor behind this rider, and neither shelters the other (D-3.6).
- **Output**: `k`. The riding position does **not** enter `k` in this version (D-3.5); it enters the
  `C_D·A` that `k` multiplies, which ADR 0028 D-1 fixes per race.
- ⚠️ **Only `+ − × ÷` and `Math.sqrt`.** No `Math.exp`, no `Math.pow`, no trigonometry.
  `agreement.test.ts`'s argument that a room on x86 and a phone on ARM compute the same bits rests on
  IEEE 754 specifying exactly those operations (ADR 0028 §"What would make this ADR wrong"). So every
  curve is a **piecewise-linear table**, interpolated with a subtraction, a division and a
  multiplication.

### D-3 — The model, with one citation per number

**D-3.1 — `k_behind`: drag of a rider in a single-file line, by gap and by how many riders are ahead.**
Each number is a trailing rider's drag as a fraction of an isolated rider's, read off Blocken et al.
2018's figures on 2026-09-29. **Depth *n*** is the number of riders in the chain ahead; each value is
the **last** rider of a paceline of *n* + 1 riders, which is the rider with nobody behind them — the
leading-rider effect is applied separately by D-3.2.

| Depth *n* ↓ · gap *d* → | 0.05 m | 0.15 m | 0.5 m | 1 m | 5 m | Read from |
|---|--:|--:|--:|--:|--:|---|
| **1** | 0.641 | 0.644 | 0.652 | 0.665 | 0.709 | Blocken 2018, Figs. 9–13, 2-rider row, rider 2 |
| **2** | 0.517 | 0.522 | 0.536 | 0.556 | 0.631 | the same figures, 3-rider row, rider 3 |
| **3** | 0.459 | 0.466 | 0.486 | 0.511 | 0.611 | 4-rider row, rider 4 |
| **4** | 0.436 | 0.443 | 0.466 | 0.493 | 0.605 | 5-rider row, rider 5 |
| **5 or more** | 0.425 | 0.433 | 0.457 | 0.485 | 0.602 | 6-rider row, rider 6 |

Why the table stops at depth 5: the paper's own finding — *"for long pacelines, i.e. 6 riders or more,
the 5th rider and all following riders have a very similar drag"* (§4.3, observation 3).

**D-3.2 — `k_ahead_of`: the leading-rider effect**, from the first rider of the same figures' 2-rider
rows:

| Gap *d* to the rider behind | 0.05 m | 0.15 m | 0.5 m | 1 m | 5 m | Read from |
|---|--:|--:|--:|--:|--:|---|
| `k_ahead_of` | 0.976 | 0.980 | 0.987 | 0.992 | 0.999 | Blocken 2018, Figs. 9–13, 2-rider row, rider 1 |

The paper: *"In all pacelines and for all spacings up to d = 1 m, the leading rider experiences a small
but significant drag reduction due to the subsonic upstream disturbance."* Blocken 2013's abstract
confirms the effect for two riders at 0.01 m (0.8 %, 1.7 % and 2.6 % for upright, dropped and
time-trial positions). A model that gave the follower a discount and the leader nothing would be wrong
in a way both sources correct.

**D-3.3 — Beyond 5 m, and below 0.05 m.**

- ⚠️ **Beyond 5 m is unsourced — the author's choice.** The paper measured nothing further. Each row
  is interpolated linearly from its 5 m value to **1.000 at 30 m**, and `k = 1` beyond. 30 m is where
  the depth-1 row's own slope between 1 m and 5 m (0.011 per metre) reaches 1.0 (at about 31.5 m),
  rounded down. A step to 1.0 at 5 m would make a rider's drag jump by 29 % across one metre, and
  riders would feel that jump.
- **Below 0.05 m the 0.05 m value holds.** The paper calls 0.05 m *"a theoretical minimum distance"*,
  and the game has no collisions.

**D-3.4 — Lateral offset is not an input in version 1: every rider is modelled in single file.**
There is nothing authoritative to read it from. A room places a rider **only** by distance along the
route (ADR 0028 D-7.3), and D-4 has the room compute `k` from its own positions. The only lateral
position in the program is a **drawing**: `racing-line.ts` puts each rider on a line through a bend,
and `scene.ts` §`lateralOf` moves two riders apart so their sprites do not overlap. `lateralOf` is
itself computed from the longitudinal gap, so it adds nothing a room does not already have, and a
function written to keep pictures apart must never decide who gets shelter. So:

- **The model takes no lateral argument.** [#786](https://github.com/openzigs/onyourleft/issues/786)'s
  function has no parameter for one. A lateral input cannot then be passed as `0` by a room and as a
  drawn offset by a client, which would make the two disagree about `k`.
- **What this costs**: a rider 0.05 m or more ahead of another shelters them fully, however the two
  are drawn. Two riders the renderer draws side by side, half a wheel apart, are modelled as one
  behind the other. Riders exactly level (D-2's 0.05 m) shelter neither way.
- **Adding lateral position is a new `physicsVersion`**, not an amendment. It needs two things this
  program does not have: a lateral position the **room** holds (a steering input the rider controls,
  sent and re-simulated like power), and a source for the width of the wake (the 2018 peloton paper is
  the candidate). The renderer's line stays a drawing either way.

**D-3.5 — The riding position is not an input in this version, and why.** The 2018 figures are for a
time-trial position (aero helmet, time-trial bars, a disk wheel, a frontal area of 0.34 m²). A race
rides one of `rider.ts` §`RIDING_POSITIONS`, which are road positions (ADR 0028 D-1). Blocken 2013's
abstract shows the trailing benefit **depends on position** at 0.01 m: *"27.1%, 23.1% and 13.8% for
UP, DP and TTP"*. ⚠️ **And the two papers disagree for the time-trial position**: 2013 gives the
trailing time-trial rider 13.8 % at 0.01 m, while the 2018 two-rider row gives 35.9 % at 0.05 m. They
used different rider and bicycle geometries, and this ADR does not reconcile them. **Version 1 uses
the 2018 table because it is the only source read that varies both the gap and the depth.** Its
position is the race's, not the paper's, and that is the model's largest known uncertainty. #786
reads Blocken 2013 in full; if it gives gap-dependent values per position, a position axis is a new
`physicsVersion`.

**D-3.6 — The combination rule for more than one rider ahead.**

1. A **chain** is a run of riders ahead, each inside the window of the one behind it. A rider's depth
   is the length of the chain ahead of them, capped at 5. **Riders level with each other** (D-2: less
   than 0.05 m apart) **count as one place** in the chain, so two riders side by side ahead are not a
   double draft.
2. `k_behind` is D-3.1's row for that depth, **at this rider's own gap to the nearest rider ahead** —
   the wheel they are on. Gaps further up the chain do not enter. ⚠️ **Unsourced — the author's
   choice**: every line the paper measured is evenly spaced, so it says nothing about a chain whose
   gaps differ; using the rider's own gap is the simplest rule that gives a rider who drops off a
   wheel less shelter at once. Shelters do **not** compound by multiplication: D-3.1's depth rows
   already carry the in-line compounding the paper measured.
3. Multiply by `k_ahead_of` for the nearest rider behind (D-3.2).
4. **The floor follows from the table**: `0.425 × 0.976 ≈ 0.415`. The lowest drag the 2018 paper
   measured anywhere in a paceline is **0.397** (Fig. 9, the 9-rider line at 0.05 m, rider 7), so the
   model sits about 4 % above the paper's deepest single-file rider. ⚠️ **The peloton figure is not
   the floor, on purpose — the author's choice.** A rider *"well embedded in the core of the peloton"*
   can be at *"5–10%"* of an isolated rider's drag (Blocken 2018 pelotons, at one remove). That needs
   a staggered, many-rider formation the single-file model of D-3.4 cannot represent. Reaching it is a
   new `physicsVersion` with a room-held lateral position and a source for its lateral terms, not a
   lower constant.

**The check the table was held to.** Applying D-3.6 to the paper's own 3-rider lines: at 0.05 m the
middle rider is modelled at `0.641 × 0.976 = 0.626` against **0.617** measured; at 1 m, `0.665 ×
0.992 = 0.660` against **0.655**. At 0.15 m, **rider 7 of a 9-rider line** — depth 6, capped at 5,
with rider 8 behind — is modelled at `0.433 × 0.980 = 0.424` against **0.407** measured. That 0.407 is
the one figure here read from the paper's **text** rather than a figure image: §5 calls it *"the
minimum drag of the 9-rider paceline in Fig. 10, i.e. 40.7%"*, and §4.3 places that minimum at
*"position 7, although the difference with position 8 is very minor"*. So the model **errs toward less draft** by at most about
4 % of drag in the configurations the paper measured. [#786](https://github.com/openzigs/onyourleft/issues/786)
turns these three comparisons into tests.

### D-4 — Where it runs, and who is believed

- **The room computes `k` from authoritative positions** ([#787](https://github.com/openzigs/onyourleft/issues/787)),
  as part of the re-simulation ADR 0028 D-2 already decides. A client's claim about its own draft is
  never an input.
- **The client predicts `k` for its own screen** from the last frame and is **corrected** by the room
  (ADR 0028 D-2 rule 4). A prediction that disagrees is a smooth correction, not a teleport
  ([#782](https://github.com/openzigs/onyourleft/issues/782)).

### D-5 — What the rider is shown, and what is out

- **The benefit is shown as a percentage of aerodynamic drag**: `(1 − k) × 100 %`, **never watts
  saved**. A watt figure depends on speed and gradient, and on a descent it means nothing (#16's
  existing reasoning, and #327's research). The leading rider's benefit is shown too.
- **#327's proposed indicator criteria bind #787**: off by default, the full-scale mark drawn, honest
  on a climb, sayable (#395, #400), contrast and layout measured.
- **Out**: drafting the bot pacer (there is no bot pacer in rooms, one of the recommendations the owner accepted on 2026-09-28) or any
  ghost (a ghost is *"a replay of recorded distance against recorded time"* and has no drag area).
  Team tactics that create a **team-versus-team win condition** stay out: ADR 0028 D-7.6.

### D-6 — ADR 0028 D-5's four reasons, each answered

**1. *"It is a multi-year tuning problem, which #465 says itself, and #327 owns it."*** — Answered by
scoping. Version 1 is not a tuned model. It is a **lookup of published measurements** (D-3), with the
two unsourced choices named. Tuning is a new `physicsVersion` with a changelog in
`packages/physics/README.md`, never a live edit to a race in progress. What a multi-year effort would
tune — the shape of a wake around a turning, staggered group — is exactly what D-3.6 declines to
model.

**2. *"`packages/physics` models none, and says so … Adding one is a change to the single model the
whole product rests on, and it lands in the package whose tests reproduce a published paper
(`martin-1998.test.ts`)."*** — Answered by construction (D-1). Drafting is a multiplier on `C_D·A`
that the **caller** supplies. The integrator's equations do not change, and with `k = 1` every
existing test, `martin-1998.test.ts` included, runs on unchanged numbers. `simulate.ts`'s *"What it
deliberately does not model"* remains true of the tick; the new function lives beside it, not inside
it.

**3. *"Drafting changes who wins. A first cut with a bad draft model is worse than one with none,
because riders will attribute the wrongness to the race rather than to the model."*** — Answered by
two things, and the second is the one that matters. **The agreement vectors**
([#786](https://github.com/openzigs/onyourleft/issues/786)) pin the model's output on fixed inputs,
so a room and a phone cannot silently disagree about a draft. **The room computes the draft from
authoritative positions** (D-4, [#787](https://github.com/openzigs/onyourleft/issues/787)), so every
rider in a race is drafted by the same function of the same positions. That does not make the model
*right*; D-3's check says it errs toward less draft, which is the safer error for a race.

**4. *"It is the part of this design with the least patent reading behind it."*** — **Not answered
by engineering, and this document does not pretend otherwise.** Spike 0005 §1.4 records that its
searches found *"no granted US patent claiming a drafting or slipstream model in a virtual cycling
environment"* and that *"the absence of a hit is weak evidence"*. Nothing new was read. What changed
is that the owner decided — D-7.

### D-7 — The owner's patent-risk decision extends to drafting

The owner accepted spike 0005's reading without counsel for live racing on 2026-09-22 (#488 Q6,
recorded in ADR 0028's amendment). On 2026-09-28 the owner accepted, as Q10, that **"the patent-risk
acceptance covers drafting"** (quoted in full in Context).

- ⚠️ **This is a risk decision, not a finding.** No claim chart was drawn for a drafting model, no
  pending application was read, and no lawyer has looked at it. Spike 0005 is *"not legal advice"*
  and *"not a freedom-to-operate opinion"*, and neither is this.
- **It covers drafting between live riders in a room.** It does not cover drafting a ghost (which
  D-5 excludes anyway) and it does not touch [ADR 0007](0007-patent-posture.md) D4.
- **With it recorded, this ADR's status is Accepted.**

---

## Consequences

### What this enables

- #786 can add the model to `packages/physics`, with a table whose every number has a citation or a
  declared "unsourced".
- #787 can put drafting into rooms and the game, with the indicator #327 specified.
- The first multiplayer release is the one the owner asked for.

### What this costs, stated plainly

- **Version 1 is position-blind** (D-3.5) and single-file (D-3.4, D-3.6). A rider drawn beside
  another, half a wheel back, gets a full draft the picture does not show; riders exactly level get
  none. A road position gets a time-trial position's curve.
- **Two rules are unsourced**: the 30 m reach (D-3.3) and using the rider's own gap for a chain whose
  gaps differ (D-3.6 step 2). They are named, and #786 must either source them or keep saying so.
- **A draft model makes position matter**, so a room's authoritative positions (ADR 0028 D-2) now
  decide more than the finish order. A rider on a bad connection is drafted by where the room thinks
  they are.
- **The patent risk is accepted, not removed** (D-7).

### Constraints this places on other work

| Issue | Constraint |
|---|---|
| #786 | D-1's caller-supplied multiplier; D-2's arithmetic; D-3's table, with the three comparisons of D-3's check as tests; **no lateral parameter** (D-3.4), and a test that two riders under 0.05 m apart shelter neither way (D-2, D-3.6); provenance rows in `packages/physics/README.md` §2, the two unsourced rules marked so; read Blocken 2013 in full (D-3.5) |
| #787 | The room computes `k` (D-4) from distance along the route alone — never from `racing-line.ts` or `scene.ts` §`lateralOf` (D-3.4); the indicator as a percentage of aerodynamic drag (D-5) and #327's criteria |
| #782 | Predicts `k` for the rider's own screen and accepts the room's correction |
| #327 | Answered by this ADR; stays open only for the indicator's criteria, which #787 carries |

---

## What would make this ADR wrong

- **Blocken 2013's full paper, read, gives gap-dependent values per position that differ from the 2018
  time-trial table by more than D-3's check tolerates.** Then version 1's position-blindness is the
  wrong simplification and a position axis is owed before races depend on it.
- **Riders find the draft feels wrong at the edges** — a surge at 30 m, or a full draft while drawn
  half a wheel to one side. Those are the 30 m reach and the single-file model (D-3.4), and they are
  the first to revisit; the second needs a room-held lateral position before it can change.
- **A granted or pending claim turns up that recites a drafting model in a virtual environment.**
  Then D-7's acceptance was made without it, and the owner decides again.
- **The agreement vectors show a room and a phone disagreeing on `k`.** Then either a transcendental
  crept in (D-2) or interpolation is order-dependent, and `agreement.test.ts`'s argument no longer
  covers drafting.
