# `@onyourleft/physics`

The cycling power/speed model of **Martin et al. 1998**, as separately testable terms.

Power in, speed out. This is the feedback loop the whole product rests on — you push, the number
moves, the world moves, the hill arrives, the resistance changes — and it is pure computation: no
rendering, no BLE, no platform API, no clock.

**Apache-2.0**, because it is under `packages/`. See [CLAUDE.md §3](../../CLAUDE.md).

---

## 1. The source, and why it is a paper and not a game

The model is

> Martin, J.C., Milliken, D.L., Cobb, J.E., McFadden, K.L. & Coggan, A.R. (1998). **Validation of a
> Mathematical Model for Road Cycling Power.** *Journal of Applied Biomechanics* **14**(3), 276–291.
> PubMed 28121252.

It was validated against SRM measurements over 38 road trials and accounted for over 97 % of the
variation in cycling power, with a standard error of **2.7 W**. Every equation number cited in this
package's source is that paper's.

**The target is deliberately not Zwift.** Zwift does not publish its constants and encrypted its
client/server traffic in July 2022, so everything the community has is black-box testing — and
Zwift Insider's own validation against two independent outdoor calculators found it consistently
1–4 km/h optimistic, worst case 2.96 km/h at 150 W on a 50 kg rider. A model fitted to Zwift
inherits Zwift's optimism, and a virtual ride that does not match the road is the thing this package
exists to avoid.

### Nothing here was copied from prior art

[CLAUDE.md §6](../../CLAUDE.md) draws the line and this is the package where it bites:

> Facts are not copyrightable: a physical constant or an equation from a published paper carries no
> such restriction. **An implementation of it does.**

Every mature prior-art cycling-physics implementation is GPL-2.0 (GoldenCheetah), GPL-3.0
(qdomyos-zwift), AGPL-3.0 (Auuki) or CC BY-NC-4.0 (OpenTrainer, which is not open source under the
OSD at all). `packages/` admits **none** of them, with no exemption. So this package was written from
the paper: the equations are cited by number, every constant records the sentence it came from, and
a reviewer can check any term against Martin without opening anyone else's source.

`@glandais/virtual-cyclist` (MIT) was named in #88 as a candidate. It is **not** a dependency and
was not consulted. This package has **no runtime dependency but `@onyourleft/domain`**, which is
where every unit in the program is defined.

---

## 2. Provenance of every number

Modelled on [`packages/fit/README.md`](../fit/README.md) §3, which records where each protocol
number came from and flags the ones resting on weaker evidence rather than presenting them all as
equally settled. The flagged ones here are marked ⚠️.

| Symbol | Field | Default | Where it comes from |
|---|---|---|---|
| `c_d · A` | `dragCoefficient` × `frontalAreaSquareMetres` | 0.264 m² | Model Application: "a hypothetical subject who had the average characteristics of our subjects (drag area = 0.264 m², mass = 71.9 kg)". ⚠️ **The split into 0.88 × 0.30 is not the paper's** — see below |
| `F_w` | `spokeDragAreaSquareMetres` | 0.0044 m² | Appendix I, the `(0.2565 + 0.0044)` in the aerodynamic power line. Equation 3 models it as the incremental drag area of the spokes, measured by spinning a suspended wheel |
| `μ` (`C_RR`) | `rollingResistanceCoefficient` | 0.0032 | "Kyle (1988) reported C_RR values ranging from 0.0027 to 0.0040 for 10 high-pressure clincher bicycle tires on smooth asphalt … we used the average of those 10 values (C_RR = 0.0032)" |
| `β₀` | `bearingFrictionConstantNewtons` | 0.091 N | Equation 7, `P_WB = V_G (91 + 8.7 V_G) 10⁻³`, divided through by `V_G`. Traces to Dahn, Mai, Poland & Jenkins (1991), measured torque `T = 0.015 + 0.00005 N` N·m |
| `β₁` | `bearingFrictionPerMetrePerSecondNewtonSeconds` | 0.0087 N·s/m | Equation 7, likewise |
| `ζ` | `drivetrainLossFraction` | 0.024 | Appendix I divides by `E_C = 0.976`. ⚠️ **The Results section says 97.698 %** — see below |
| `I` | `wheelMomentOfInertiaKilogramSquareMetres` | 0.14 kg·m² | Equation 12: "I is the moment of inertia of the two wheels (approximately 0.14 kg · m²)" |
| `r` | `wheelRadiusMetres` | 0.311 m | Appendix I, the `0.14/0.311²` in the kinetic energy line |
| `g` | `GRAVITY_METRES_PER_SECOND_SQUARED` | 9.81 m/s² | Equation 5: "g is the acceleration of gravity (9.81 m/s²)". Deliberately not 9.80665 — see `constants.ts` |
| `p₀`, `T₀`, `L`, `M`, `R*`, `g₀` | `air.ts` | — | ISO 2533:1975, the International Standard Atmosphere. Used as a set, including its `R* = 8.31432` rather than the 2019 CODATA value |

### ⚠️ The drag-area split is this package's, not the paper's

`0.88 × 0.30 = 0.264` exactly, and 0.264 is Martin's. **Neither factor is.** Martin measures the
product in a wind tunnel (`C_D A = 2 F_D / ρ V_a²`, Equation 1) and reports only the product, which
is what every source of a drag area does. Splitting at all is a concession to #88's acceptance
criterion, which names `c_d` and `A` as separate tunables. **Only the product is ever read.** Tune
it with `withDragArea(0.264)` and treat a single factor as meaningless.

### ⚠️ The paper states its chain efficiency twice, and the two disagree

Results says "the efficiency of the chain drive system (E_C) was 97.698 %". Appendix I computes
`P_TOT = 208.2/0.976 = 213.3 W`. The default is `1 − 0.976`, the Appendix's, because the Appendix is
the worked example the test suite reproduces and 97.698 % would put that reproduction 0.4 W off the
published answer. The two differ by 0.2 % of total power; if you are tuning for a rider rather than
for the paper, neither is more right than the other.

---

## 3. The model

The force balance, in the form #88 quotes from Dahmen & Saupe:

```
P/v − ζP/v − (m + I/r²)·v̇ − mg·h'(x) − mgμ − (β₀ + β₁v) − ½·c_d·ρ·A·v² = 0
```

One exported function per term, in [`terms.ts`](src/terms.ts), each returning **newtons opposing
forward motion** — positive resists, negative assists:

| Function | Equation | Notes |
|---|---|---|
| `aerodynamicDragForceNewtons` | 1, 3, 4 | Evaluated at the **air** speed, not the ground speed, and it carries `F_w` as well as `c_d A` |
| `rollingResistanceForceNewtons` | 5, 6 | The full `COS[TAN⁻¹(G_R)]`, not the paper's small-grade simplification 6a |
| `gravityForceNewtons` | 8, 9 | **Signed.** The full `SIN[TAN⁻¹(G_R)]`, not 9a |
| `bearingFrictionForceNewtons` | 7 | Rearranged from a power to a force; the test asserts the rearrangement |
| `effectiveMassKilograms` | 12 | `m_T + I/r²` — the rotating mass of the wheels |
| `drivetrainEfficiency` | 14, 15 | `1 − ζ` |

`resistiveForces` evaluates all four forces at once and returns them in a **named-field** record, for
the reason `packages/domain`'s `GeographicPosition` uses named fields: four numbers of the same unit
and similar magnitude in a tuple is a transposition nothing would catch.

### Two terms most implementations get wrong

**Bearing friction and drivetrain loss are separate from rolling resistance.** Folding them into
`C_RR` is the common shortcut, and it is wrong in a way that shows at low speed: rolling resistance
scales with **weight** and bearing friction does not, so a merged model is wrong differently for a
heavy rider than for a light one. Drivetrain loss is a *fraction of the power*, which is a third
shape again.

**Inertia is not optional.** Without `(m + I/r²)·v̇` a sprint accelerates instantly, and experienced
riders identify the feel immediately — Zwift's own Pack Dynamics 4.1.1 notes cite "it feels as though
rider inertia has increased" as a *positive* change. The rotating mass is worth 1.45 kg on top of the
system mass with the paper's numbers: 1.6 % of a 90 kg rider and bike, and all of it in the first
seconds.

---

## 4. The tick, and why it is written the way it is

`advance(state, step, conditions)` in [`simulate.ts`](src/simulate.ts) is the loop a ride runs.
It is **deterministic** and **time-step independent**: a 1 Hz recording tick and a 60 Hz render
tick produce the same distance to within a millimetre over a minute of hard acceleration, which is
asserted rather than claimed.

Two things get that, and both are unusual enough to be worth knowing before changing them.

**The caller's tick is not the integration step.** `advance` divides whatever interval it is given
into equal sub-steps of at most 10 ms. A faster caller is not a more accurate one.

**The drive is integrated in energy and the resistance in force.** Each form has a singular point and
the points are different:

- The drive is `P/v`, infinite at rest. In energy it is `P Δt` — finite everywhere, and *exact*:
  `v = √(2 P t / m_eff)` from a standing start, independent of how `t` was chopped up. The singular
  case is the one the energy form gets exactly right, which is why there is no speed floor, no force
  cap and no special case for the first tick anywhere in this package.
- The resistance is a force, and putting it in the energy equation means multiplying it by the
  speed — which sends it to zero exactly where it matters. That is a fixed point, not a rounding
  error: at `v = 0` no force does any work, so a bicycle standing on a descent stays there forever
  and a coasting rider approaches rest asymptotically without arriving. **Both were observed in this
  package during #88** — the coast settled at 0.00027 m/s and never reached zero, and a stationary
  rider on an 8 % descent never moved — and both are now tests.

The two halves are composed in Strang's arrangement (drive for half a step, resistance for a whole
one at the midpoint speed, drive for the remaining half), which is second-order rather than first.
With the naive ordering the 1 Hz and 60 Hz runs disagreed by 4.6 mm and the tick settled 1.7 × 10⁻⁴
m/s away from the closed-form answer; both are now two orders of magnitude inside tolerance.

### What it deliberately does not model

- **Reverse.** Speed is clamped at zero, so a rider who runs out of power on a climb stops rather
  than rolling back. That is the safe wrong answer, and `MetresPerSecond` and `Metres` are both
  non-negative in `packages/domain`, so a model with reverse could not report its state at all.
- **Braking, cornering, drafting, gears and cadence.** None is in Martin's model or in #88's scope.
- **Humidity and weather** in the air-density model. Both are documented in `air.ts` rather than
  approximated: a wrong correction is harder to find than an absent one.

---

## 5. Determinism is enforced in ESLint, not in the typechecker

`tsconfig.json` narrows `lib` to `ES2024` and empties `types`, so `window`, `process`, `fetch` and
`indexedDB` are compile errors here, exactly as in `packages/domain`.

⚠️ **`Date` and `Math.random` are not.** Both are ECMAScript built-ins and are inside
`lib: ["ES2024"]` — the same way `DataView` survives the identical narrowing in `packages/sensors`.
No typechecker in this repository can see either of them. They are banned in
[`eslint.config.js`](../../eslint.config.js)'s `packages/physics` block instead, with
`no-restricted-globals` and `no-restricted-properties`.

That matters more here than it would elsewhere. #88 makes determinism and time-step independence
acceptance criteria, and a model that reads a wall clock instead of taking the elapsed time as a
parameter is precisely the frame-rate coupling those criteria exist against — and it is invisible in
a green suite, because the numbers still look like numbers. **Elapsed time arrives as a `Seconds`.**

Both gates were checked together with a probe file, per [CLAUDE.md §4d](../../CLAUDE.md), and the
probe is what the paragraph above rests on: `window`, `process`, `fetch`, `indexedDB`, `node:fs` and
`events` each produced *both* a TypeScript error and a lint error; `Date.now()` and `Math.random()`
produced **only** the lint error.

---

## 6. Using it

```ts
import {
  advance,
  airDensityKilogramsPerCubicMetre,
  powerRequired,
  START_OF_RIDE,
  steadyStateSpeedMetresPerSecond,
  withDragArea,
} from '@onyourleft/physics';
import { altitudeMetres, degreesCelsius, gradePercent, kilograms, seconds, watts } from '@onyourleft/domain';

const conditions = {
  totalMass: kilograms(82),
  airDensityKilogramsPerCubicMetre: airDensityKilogramsPerCubicMetre(
    altitudeMetres(0),
    degreesCelsius(15),
  ),
  coefficients: withDragArea(0.264),
};

// The closed question: what does 250 W get me up a 5 % climb?
steadyStateSpeedMetresPerSecond({ powerWatts: 250, grade: gradePercent(5), ...conditions });

// The ride: where am I a second later?
const next = advance(
  START_OF_RIDE,
  { power: watts(250), grade: gradePercent(5), duration: seconds(1) },
  conditions,
);

// The audit: what did that second cost, term by term?
powerRequired({ groundSpeed: next.speed, grade: gradePercent(5), ...conditions });
```

### What is a branded quantity here, and what is a bare number

Inputs are `@onyourleft/domain` quantities wherever that package has a type for them, because the
inputs are where a unit swap happens. Outputs of the force and power terms are **plain signed
numbers**, and that is deliberate rather than an omission: `Watts` is a non-negative magnitude and
the power a descent requires is negative, so a `Watts` return would throw on the first descent.
`advance` returns branded values because its two fields genuinely cannot be negative.

---

## 7. Testing

```bash
pnpm --filter @onyourleft/physics run test
pnpm --filter @onyourleft/physics run typecheck
```

| File | What it holds |
|---|---|
| `martin-1998.test.ts` | The paper. Appendix I worked term by term to 213.3 W within 0.1 W; the Model Application's 255 W at 11 m/s; the Figure 4 gradient fit |
| `terms.test.ts` | Each term alone — anchors against arithmetic from the paper's constants, and identities that a wrong shape fails |
| `air.test.ts` | The ISO 2533 table: 1.225 kg/m³ at sea level, 1.0066 at 2 000 m |
| `simulate.test.ts` | Determinism, the three tick rates, inertia wired in, and the cases that would put a `NaN` into a ride |
| `ride.test.ts` | A whole ride through the public entry point — the package's first consumer |

**Published worked examples beat round-tripping your own arithmetic**, which is why
`martin-1998.test.ts` exists and why it is first in that list: an implementation that is
self-consistently wrong round-trips perfectly and satisfies every other file here.

⚠️ **This package ships with no production consumer.** #88 scopes itself to `packages/physics` and
`apps/web` (#51) was running in parallel, so nothing renders a speed from it yet. `ride.test.ts` is
the closest thing to a first consumer and it establishes that the exported surface is sufficient to
run a ride; it cannot establish that the shape suits the screen. #90, #91 and #94 are the issues that
will find out.
