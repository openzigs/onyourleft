// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The line a racer rides through a bend, and how far they lean on it — #499.
 *
 * ## What this is, and what it deliberately is not
 *
 * Every rider used to be drawn on the road's **centreline**, bolt upright, and
 * two riders level on the road were drawn inside each other. This file gives
 * each of them a **line** — a sideways offset inside the carriageway — and a
 * **lean** into the bend, and nothing else. `scene.ts` is what places the
 * three riders on it, and says how two level riders are kept apart.
 *
 * ⚠️ **The line is how a rider is DRAWN, never how far they rode.** A real
 * racing line is shorter than the centreline, and here that length feeds into
 * nothing: the simulation, the trainer's grade (`gradient.ts`), the ghost's
 * replay, the pacer's gap, the HUD's "To go", recording and segments all stay
 * on route distance along the centreline. A rider's place along the road is
 * still their odometer; the line adds a sideways offset and a roll. Letting
 * the line shorten a race would make a race depend on a drawing algorithm,
 * which ADR 0028 exists to prevent, and would need an ADR of its own.
 *
 * ## The line: the least PEAK curvature inside the carriageway
 *
 * The line a racer takes through a bend is close to the **minimum-curvature
 * path** between the road's edges — the published basis of racing-line
 * planning, Heilmeier et al., *"Minimum curvature trajectory planning and
 * control for an autonomous race car"*, Vehicle System Dynamics, 2020, which
 * notes that it *"is quite near to a minimum time line in corners"*. It is
 * implemented from that idea and from arithmetic: no code was read, and the
 * authors' reference implementation was not opened (CLAUDE.md §6).
 *
 * Each profile sample `i` is moved sideways by `offset[i]` along the road's
 * own normal `Nᵢ` — its RIGHT, on the map and on the screen, since #583 — so
 * the line's point is `Pᵢ = Cᵢ + offset[i]·Nᵢ`, and
 * `κₖ` is the line's own curvature at `Pₖ` — the turn between its two chords
 * over their mean length. What is minimised is
 *
 *     Σₖ h·(κₖ / κ̂)⁸  +  μ Σᵢ |Pᵢ₊₁ − Pᵢ|² / h  +  (h / settle⁴) Σᵢ offset[i]²
 *
 * with every `|offset[i]| ≤ LINE_LIMIT_METRES`, where `h` is the profile's
 * resolution and `κ̂` the last step's peak. Three decisions are in that line,
 * and each one was forced by a measurement on `hairpinRoute`, recorded here
 * so that it is not undone by somebody who reads the paper's title and not
 * this note:
 *
 * 1. ⚠️ **The PEAK, not the sum of squares.** The speed a bend can be taken at
 *    is `√(μ·g / κ)` at its tightest point, so what makes a line faster is a
 *    lower peak. The sum of squares — the paper's objective and the first one
 *    this file solved — spreads the turn by leaning into the wrong way first,
 *    and on a 180° hairpin it rides the OUTSIDE edge the whole way round,
 *    with a peak ABOVE the centreline's on a 40 m bend (0.0262 against 0.0250
 *    per metre). The eighth power is a smooth stand-in for the maximum, and
 *    `racing-line.test.ts` holds the peak below the centreline's.
 * 2. ⚠️ **True curvature, not the second difference.** `|Pₖ₋₁ − 2Pₖ + Pₖ₊₁|²`
 *    — #499's elastic band, and the textbook linearisation — is curvature
 *    times the chord length SQUARED, and a point moved to the inside of a bend
 *    has shorter chords, so it is paid to cut inside: that line came out more
 *    curved than the centreline through every hairpin measured (0.127 against
 *    0.100 at a 10 m radius). True curvature is not quadratic in the offsets,
 *    so each of {@link GAUSS_NEWTON_STEPS} linearises it about the last answer
 *    and solves the quadratic that leaves — a five-diagonal system, because
 *    each curvature reads three neighbouring samples, factorised directly in
 *    O(n) inside an active set of samples pinned at the edge, carried from
 *    one step to the next.
 * 3. ⚠️ **A little length, to break a tie the geometry leaves.** A 180°
 *    hairpin between parallel straights has a whole family of lines of the
 *    same least peak — a circle of radius `r + limit`, anywhere from riding
 *    the outside edge round to touching the inside at the apex — and without
 *    a preference the solve settles on the outside one. {@link LENGTH_WEIGHT}
 *    prefers the shortest of them, which is the one that enters wide, clips
 *    the apex and exits wide. It is kept small enough that it never buys
 *    length with curvature: raised tenfold, the line hugs the inside of a
 *    20 m hairpin with a peak of 0.057 against the centreline's 0.050.
 *
 * The pull is toward the rider's HOME on the road, not toward the centre —
 * #546. On a straight far from any bend the curvature term weighs nothing, and
 * without a pull the line's place there would be whatever the nearest bend
 * left; {@link LINE_SETTLE_METRES} says how quickly it returns, and
 * {@link LINE_HOME_OFFSET_METRES} says where to. ⚠️ **It used to pull to
 * offset nought, which IS the dashed centre line** (`terrain.ts`
 * §`writeCentreLine`), and that is the owner's *"rides on the centre line even
 * on straights"* from the 2026-09-25 tablet ride. The energy's last term is
 * therefore `(h / settle⁴) Σᵢ (offset[i] − home)²`.
 *
 * ## A closed road, a side to keep to, and a late apex — #546
 *
 * The owner's rulings of 2026-09-25, each of them one named constant here
 * rather than an assumption spread through the solve:
 *
 * - **A closed road.** Through a bend the line may use the whole carriageway,
 *   crossing the centre line, as a race on closed roads does (UCI and USA
 *   Cycling both describe rolling road closures that give riders the full
 *   width). The limit is therefore still ±{@link LINE_LIMIT_METRES} about the
 *   centreline, on both sides.
 * - **The right-hand side, for now.** On a straight, and wherever no bend is
 *   asking for the road, the line holds {@link LINE_HOME_OFFSET_METRES}: the
 *   middle of the right-hand lane, which is the Highway Code's *primary
 *   position* (Rule 72) and leaves the bar end 1.55 m clear of the centre
 *   line. "For now" is {@link ROAD_SIDE}: one constant, which the browser gate
 *   reads back as a side of the SCREEN rather than of this file's normal.
 * - **A late apex.** A racer on a road they cannot see through turns in later
 *   and reaches the inside after the bend's geometric apex, so that the exit is
 *   the wider half (road.cc, *"11 tips for better cornering"*; Wikipedia,
 *   *"Racing line"*). Here that is a weight on the curvature term that is
 *   LIGHTER where the road's own bend is tightening and HEAVIER where it is
 *   opening out — {@link LATE_APEX_GAIN}, read off a smoothed centreline
 *   curvature so that it is continuous and returns to one on every straight.
 *   A line that may curve more cheaply on the way in does its turning early,
 *   and its apex moves past the bisector. `racing-line.test.ts` §"#546"
 *   publishes where it lands.
 *
 * ## Computed once per route, and bounded
 *
 * A whole-route pass, like `routeProfile`'s windows, cached against the profile
 * OBJECT in a `WeakMap` — `waterways.ts` §`computed` argues why that is the one
 * shape of cache `game/` allows. The first frame of a ride computes it, and
 * every frame after reads it. Each step is at most
 * {@link ACTIVE_SET_ROUNDS_PER_STEP} O(n) solves and the steps are fixed at
 * {@link GAUSS_NEWTON_STEPS}. `racing-line.test.ts` §"its cost" times it
 * on a 1 000 km route, because nothing in the store bounds a route's length,
 * and — since #588 made the solve and the lean cheaper by restructuring them —
 * holds the line and the lean on five fixtures to a digest taken before that
 * change, so a speed-up that moved either is red.
 *
 * ## The lean
 *
 * For a bicycle in a steady turn, **tan φ = v² / (g·R)** — gravity balanced
 * against centripetal acceleration (Wikipedia, *"Bicycle and motorcycle
 * dynamics"* §"Leaning"; any vehicle-dynamics text). It is taken from the
 * **line's** curvature, never the centreline's, and from the rider's **own**
 * simulated speed. That is what answers `bicycle.ts`'s old objection that a
 * lean from the centreline would be a second source of truth about where the
 * rider is: the line is the one source, and the lean is derived from it.
 *
 * ⚠️ **The cap is a drawing decision, not physics.** The simulation has no
 * cornering speed limit — the trainer is sent grade only — so a hairpin taken
 * at 12 m/s calls for more than 60°, which no tyre holds. The drawn lean stops
 * at {@link MAXIMUM_LEAN_RADIANS}. A rider drawn at the cap is NOT cornering
 * legally; they are going faster than the bend allows and the game does not
 * slow them, which is out of scope here.
 *
 * Pure: no clock, no `three`, no DOM, no platform API.
 */

import { distanceOnRoute, type GeographicPosition, type RouteProfile } from '@onyourleft/domain';
import { STANDARD_GRAVITY_METRES_PER_SECOND_SQUARED } from '@onyourleft/physics';

import { RIDER_HALF_WIDTH_METRES } from './bicycle';
import { ROAD_WIDTH_METRES, corridorOrigin, localGroundPosition } from './terrain';

/**
 * How far inside each road edge the line's middle stays: **0.6 m** — half a
 * handlebar ({@link RIDER_HALF_WIDTH_METRES}, 0.2 m) and 0.4 m of clearance
 * between the bar end and the edge line. Chosen, and stated as a choice.
 */
const LINE_MARGIN_METRES = RIDER_HALF_WIDTH_METRES + 0.4;

/**
 * The furthest the line may be from the centre: **2.9 m**, on the 7 m road.
 * #499's second criterion is stated against this.
 */
export const LINE_LIMIT_METRES = ROAD_WIDTH_METRES / 2 - LINE_MARGIN_METRES;

/**
 * The length over which the line settles back to its home on a straight:
 * **50 m**, as the pull's weight `h / settle⁴`. Chosen: short enough that a
 * straight between two bends is ridden at home, long enough that the approach
 * to a hairpin has room to go wide. ⚠️ **It was 60 m until #546**, when the
 * home stopped being the centre: a bend whose outside is the far side of the
 * road now draws the line ACROSS it, and at 60 m that crossing had not
 * settled within 0.1 m of home 150 m from the bend (0.12 m off); at 50 m it
 * is 0.03 m off, which `racing-line.test.ts` §"#546" holds.
 */
const LINE_SETTLE_METRES = 50;

/**
 * Which side of the road a rider keeps to, as a sign on the road's own normal:
 * **+1**, the normal's side — the owner's *"right side, for now"* (#546).
 *
 * ⚠️ **The normal's side is the rider's RIGHT — on the screen and, since #583,
 * on the map.** A camera behind a rider heading north with `+y` up has `−x` on
 * its right in a right-handed renderer, and the normal `(−headingZ, headingX)`
 * there is `(−1, 0)`. Since #583 `−x` is EAST (`terrain.ts`
 * §`localGroundPosition`), which is the map's right going north. ⚠️ **Until
 * #583 `−x` was WEST**: the corridor put east on `+x`, the world was drawn as a
 * mirror of its map, and this comment said the normal was the screen's right
 * "although `terrain.ts` calls it left" — a reviewer who remembers that is
 * reading the old file. #583 moved the projection and not this constant: the
 * normal was always the screen's right, and is now the map's too. What holds
 * it to what the owner sees is `game.browser.spec.ts` §"#546", which reads the
 * rider back on a straight right of the frame's middle, and §"#583", which
 * reads a bend to the right on the map turning right on the screen — not this
 * comment, which is an argument about a handedness.
 */
export const ROAD_SIDE: 1 | -1 = 1;

/**
 * How far in from its own edge a rider holds the road on a straight: **1.75
 * m**, a quarter of the 7 m road — the middle of the lane, which is the
 * Highway Code's *primary position* (Rule 72) and puts the bar end 1.55 m
 * from the centre line and 1.55 m from the edge. Chosen, and stated as a
 * choice: #546 found no source giving a racer's lateral place on a straight.
 */
const HOME_FROM_EDGE_METRES = ROAD_WIDTH_METRES / 4;

/**
 * Where the line settles on a straight, in metres from the centreline on the
 * normal's side: {@link ROAD_SIDE} times the road's half-width less
 * {@link HOME_FROM_EDGE_METRES} — **+1.75 m**.
 */
export const LINE_HOME_OFFSET_METRES = ROAD_SIDE * (ROAD_WIDTH_METRES / 2 - HOME_FROM_EDGE_METRES);

/**
 * How much more the line's curvature costs where a bend is opening out than
 * where it is tightening: **40**, as the ratio of the heaviest weight to the
 * lightest. @see lateApexWeights
 *
 * Measured, not derived — `racing-line.test.ts` §"#546" publishes where the
 * apex lands at each radius. Because the line minimises very nearly its PEAK
 * curvature (the eighth power), a weight `w` moves the line's curvature by
 * only `w^(1/8)`: 40 lets the way in bend about 1.6 times as hard as the way
 * out at the two extremes. At 3 and at 10 the apex of a 10 m corner stayed
 * BEFORE the bisector (−0.5 and −0.1 m, as the middle of the stretch the line
 * holds the inside); at 40 every fixture's apex is at or after it, and the
 * line's tightest radius stays within 10 % of the closed form — which is what
 * says this is a late apex rather than a different, tighter bend.
 */
const LATE_APEX_GAIN = 40;

/**
 * The window the late-apex weight reads the road's bend over: **15 m**, as
 * the standard deviation of a Gaussian. Wide enough that a polygonal route's
 * single-sample corner (#543) reads as a bend with a way in and a way out,
 * narrow enough that two bends 60 m apart do not read as one.
 */
const LATE_APEX_WINDOW_METRES = 15;

/**
 * The curvature below which the road is read as straight by the late-apex
 * weight: **1/500 m⁻¹**. What keeps the weight at one on a straight, where the
 * smoothed curvature's relative change is noise over nothing.
 */
const LATE_APEX_STRAIGHT_CURVATURE = 1 / 500;

/**
 * How much the solve prefers a shorter line among equally curved ones:
 * **10⁻⁴**, against a peak row weighing `h`. @see the module note, decision 3.
 * Measured, not derived: 10⁻⁵ leaves a 10 m hairpin's apex 0.4 m from the
 * centre, and 10⁻³ hugs the inside of a 20 m one.
 */
const LENGTH_WEIGHT = 1e-4;

/**
 * The power the curvature is raised to: **eight**, the smooth stand-in for its
 * peak. @see the module note, decision 1. Measured: at the fourth power the
 * sum still wins and a 10 m hairpin is ridden round its outside edge.
 */
const PEAK_EXPONENT = 8;

/**
 * How many Gauss-Newton steps the line takes: **80**. Every fixture in
 * `racing-line.test.ts` has stopped moving by then, and a test holds one more
 * step to under a millimetre. It was 30 until #546: with the late-apex weights
 * a 31st step still moved a fixture's line by 1.6 mm; at 20 (#499) a 10 m
 * hairpin was still settling.
 *
 * ⚠️ **It was 40 until #640, and 40 was not converged on a loop whose bends
 * turn toward the home side.** On `stadiumRoute(30)` — two right-hand 180°
 * bends, home on their INSIDE — the steps do not settle, they CYCLE: from the
 * seventh step to the forty-sixth the line moves 1.1 to 1.9 m a step, round a
 * cycle of about four steps whose peak curvature sits at 0.037 per metre, with
 * the peak hopping between the two bends. At the forty-seventh it leaves the
 * cycle and settles geometrically on a line whose peak is 0.032, the one a
 * 400-step solve reaches. The line drawn at 40 was a point on that cycle:
 * 1.48 m from the 41st step's, and 1.2 m from the 400-step line. Measured
 * 2026-09-27; nothing before #583 rode that fixture this way round, because
 * the world was a mirror of its map until then.
 *
 * ⚠️ **What 80 rests on is a sweep, not a proof.** 88 fixtures — stadiums
 * of 8 to 80 m, circuits of 20 to 100 m, corners of 45°, 90° and 135° at 8
 * to 40 m, hairpins and S-bends of 10 to 30 m and the planner route, each in
 * both hands — were solved at 40, at 80 and at 600 steps. At 40, seven of them
 * moved more than a millimetre on the next step; at 80, none did, the worst
 * moving 0.26 mm (a 20 m right-hand S-bend) and none lying further than
 * 0.14 mm from its 600-step line. Where the cycle ends is not something this
 * solve controls, so a route that stays on one longer than 80 steps would
 * still be drawn from the cycle — on the road and within the limit, but not
 * the least-peak line.
 *
 * ⚠️ **A damped step was tried and lost.** Halving the step whenever it moved
 * the line no less than the one before (down to a quarter, or a half) settled
 * this stadium inside 40 steps, but the rule also fired on fixtures that were
 * converging, left six of the 88 still moving at 40, and sent a 12 m stadium
 * to a line 4.1 m from where the undamped solve settles. Doubling the steps
 * doubles the cost instead: the 1 000 km route in `racing-line.test.ts`
 * §"its cost" went from 0.69 s to 1.29 s.
 *
 * Exported so that `racing-line.test.ts` takes a solve of this many steps and
 * one more, and times a solve of this many: a change here is the change it
 * measures, rather than a literal the test keeps apart.
 */
export const GAUSS_NEWTON_STEPS = 80;

/**
 * How many active-set rounds one Gauss-Newton step may take: **3**. The set is
 * carried from step to step (@see solveOnRoad), so this bounds the work per
 * step rather than deciding when the set is right.
 */
const ACTIVE_SET_ROUNDS_PER_STEP = 3;

/**
 * How many samples of the lap are laid either side of a LOOP before it is
 * solved: at least **64**, and ten settle lengths.
 *
 * ⚠️ **This is the whole of the "continuous across the wrap" guarantee.** A
 * loop has no ends, so its sample `0` and its last sample are neighbours; the
 * system is solved over the lap with more of its own road laid before and
 * after it, and the middle is kept. Solved as though the lap were a
 * point-to-point route instead, the two ends are each free of the other, and
 * `racing-line.test.ts` §"a loop" measures the step that leaves at the wrap.
 */
function loopPaddingSamples(resolution: number): number {
  return Math.max(64, Math.ceil((10 * LINE_SETTLE_METRES) / resolution));
}

/**
 * The most a tyre holds on dry tarmac, as a friction coefficient: **0.8**.
 *
 * ⚠️ **Inherited, not measured**: it is #499's own figure for a road tyre on
 * dry tarmac. A friction coefficient is what caps lean because a steady turn
 * needs `tan φ` of side force per unit of weight (Wikipedia, *"Bicycle and
 * motorcycle dynamics"* §"Leaning"). Racing riders rarely exceed about 45°, so
 * the cap it gives sits below what a person ever sees a racer do.
 */
const DRY_ROAD_TYRE_FRICTION = 0.8;

/**
 * The most the bicycle is ever DRAWN leaning: **atan(0.8) ≈ 38.7°**.
 * @see DRY_ROAD_TYRE_FRICTION, and the module note §"The lean" for why this is
 * a drawing decision rather than a claim the rider cornered legally.
 */
export const MAXIMUM_LEAN_RADIANS = Math.atan(DRY_ROAD_TYRE_FRICTION);

/**
 * The fastest the drawn lean may change in one direction, per metre ridden:
 * **8° a metre**.
 *
 * A bicycle does not snap to an angle; it rolls in over about half a second
 * while the rider counter-steers. Half a second at 10 m/s is 5 m, and the full
 * {@link MAXIMUM_LEAN_RADIANS} over 5 m is 7.7° a metre. Per METRE rather than
 * per second so the lean stays a function of where the rider is and how fast,
 * with no state — `scatter.ts` makes the same argument for being a hash of
 * where you are. A slower rider therefore rolls in over more time, which is
 * also what a slower rider does.
 *
 * ⚠️ **Through an S-bend the bound was twice this until #546**: one lean
 * unwound at this rate while the other built at it. It is this rate everywhere
 * now (@see leanAt, the second stage).
 *
 * ⚠️ **Since #546 it is the ceiling, not the rate**: above 7.5 m/s the
 * per-second bound below is the tighter one (@see rollRatePerMetre).
 */
export const MAXIMUM_ROLL_RADIANS_PER_METRE = (8 * Math.PI) / 180;

/**
 * The fastest the drawn lean may change in one direction, per SECOND: **60°
 * a second** — #546.
 *
 * ⚠️ **{@link MAXIMUM_ROLL_RADIANS_PER_METRE} alone was a per-metre bound, and
 * per metre is `8°·v` per second**: 80°/s at 10 m/s and 130°/s at 16 m/s, so
 * a descending rider snapped into a bend. A rider takes about half a second to
 * a second to roll in — a modelled turn entry of *"1 second … in good
 * agreement with reality"* to about 45° (Shayak, *"The physics of motorcycles
 * and fast bicycles"*, arXiv:1611.03857, a motorcycle-scale model), with the
 * roll rate peaking near half the final lean (motochassis, *"Initiating a
 * turn"*). 60°/s is the peak of a roll to 30° over one second, and it is
 * chosen from that rather than measured: #546 records that no measured human
 * bicycle roll rate was found.
 *
 * It is still STATELESS: the per-metre rate a speed allows is
 * `min(8°, 60° / v)` (@see rollRatePerMetre), and the speed is an input.
 */
export const MAXIMUM_ROLL_RADIANS_PER_SECOND = (60 * Math.PI) / 180;

/**
 * The slowest the per-metre rate is ever taken as: whatever rolls the full
 * {@link MAXIMUM_LEAN_RADIANS} in **50 m**. It bounds the lean's window, and
 * so its cost, at a speed nothing reaches: the per-second bound stops binding
 * only above `60°/s ÷ (38.7° / 50 m)` ≈ 78 m/s, which is 280 km/h.
 */
const MINIMUM_ROLL_RADIANS_PER_METRE = MAXIMUM_LEAN_RADIANS / 50;

/**
 * The per-metre roll rate a speed allows — the lesser of
 * {@link MAXIMUM_ROLL_RADIANS_PER_METRE} and
 * {@link MAXIMUM_ROLL_RADIANS_PER_SECOND} over the speed.
 */
export function rollRatePerMetre(speed: number): number {
  return Math.max(
    MINIMUM_ROLL_RADIANS_PER_METRE,
    Math.min(MAXIMUM_ROLL_RADIANS_PER_METRE, MAXIMUM_ROLL_RADIANS_PER_SECOND / speed),
  );
}

/** The step the lean window is read at, in metres of absolute route distance. */
const LEAN_STEP_METRES = 0.5;

/** A route's line: where on the road each profile sample is ridden, and how it bends. */
export interface RacingLine {
  /** The profile it was computed for — a line is meaningless against any other. */
  readonly profile: RouteProfile;
  /**
   * Metres from the centreline per profile sample, **positive on the side of
   * the road's own normal** — the side `terrain.ts` §`COLUMN_OFFSETS` calls
   * left. Always within ±{@link LINE_LIMIT_METRES}.
   */
  readonly offsets: Float64Array;
  /**
   * The LINE's signed curvature per sample, in 1/m, positive when it bends
   * toward the normal. What the lean is read from.
   */
  readonly curvatures: Float64Array;
}

const computed = new WeakMap<RouteProfile, RacingLine>();

/**
 * The line through a whole route. Pure; cached per profile object.
 * @see RacingLine
 */
export function racingLine(profile: RouteProfile): RacingLine {
  const known = computed.get(profile);
  if (known !== undefined) {
    return known;
  }
  const found = solveLine(profile, GAUSS_NEWTON_STEPS);
  computed.set(profile, found);
  return found;
}

/**
 * The line's offset at a distance, in metres from the centreline.
 *
 * ⚠️ **Catmull-Rom between samples, not linear**, because the camera follows
 * the rider sideways (`scene.ts` §`cameraPose`) and a linear interpolation has
 * a kink in its slope at every sample — the camera would change its sideways
 * speed every 10 m. This one is continuous in slope, which is the smoothing
 * #499 asks of the camera. It is clamped to {@link LINE_LIMIT_METRES} after,
 * because a cubic through a sample pinned at the edge overshoots it.
 */
export function lineOffsetAt(line: RacingLine, distance: number): number {
  const value = sampled(line.profile, line.offsets, distance);
  return Math.max(-LINE_LIMIT_METRES, Math.min(LINE_LIMIT_METRES, value));
}

/**
 * The COMBINED lean — rider and bicycle together, the one physics fixes — in
 * radians, positive toward the road's normal, which is the side the line bends
 * toward when its curvature is positive, so the rider always leans INTO the
 * bend. `bicycle.ts` §`bicycleRoll` splits it into the bicycle's lean and the
 * body's.
 *
 * Two stateless rate limits, on sample points fixed in route distance so that
 * each bound is exact rather than approximately true:
 *
 * 1. **Anticipation, as #499 built it.** At each sample, `steadyTurnLean` at
 *    every point within the distance a full lean takes to roll in, each
 *    reduced by {@link rollRatePerMetre} for every metre it is from the
 *    sample, and the largest kept — once for each direction of lean. It
 *    reaches a bend's full lean at the point the bend asks for it, and has
 *    already started leaning a few metres before.
 * 2. **One roll at a time — #546.** Where one lean unwinds as the other builds
 *    — an S-bend, or since #546 the lane change that sets a bend up from the
 *    far side of the road — the first stage's two directions add and roll at
 *    TWICE the rate. So its result is passed through the symmetric Lipschitz
 *    envelope `(max_s(g(s) − r|s − d|) + min_s(g(s) + r|s − d|)) / 2`, which
 *    rolls at no more than the rate `r` anywhere, and is EXACTLY the first
 *    stage wherever that already rolled no faster — so a single bend keeps its
 *    anticipation to the metre, and only a transition is changed.
 *
 * ⚠️ **Both windows depend on the speed**, through the per-second bound: at
 * 20 m/s the second stage reads 26 m either side, each point of which reads
 * 13 m either side of itself. Bounded by
 * {@link MINIMUM_ROLL_RADIANS_PER_METRE}; the samples are held in buffers made
 * once, so a frame allocates nothing here.
 *
 * ⚠️ **The first stage is two passes, not a window per sample** — #588. Read
 * as written above it is a window of `2·reach + 1` at each of `2·span + 1`
 * samples: 5 565 steps a call at 20 m/s, three riders a frame, and the reason
 * `main` went red when #546 widened both windows. The running maximum of
 * `demand − rate·|s − d|` is the same number carried forward and then back,
 * falling by one roll step a sample, so each pass is one step per sample. A
 * sample further off than `reach` cannot win — it would have fallen by more
 * than the whole cap, below the nought each direction starts at — so the
 * unbounded passes and the windowed maximum agree, to rounding (a fall
 * subtracted k times rather than multiplied by k; about 10⁻¹⁵ rad).
 */
export function leanAt(line: RacingLine, distance: number, speed: number): number {
  if (!(speed > 0)) {
    return 0;
  }
  const rate = rollRatePerMetre(speed);
  // How far a full lean takes to roll in (the first stage's reach), and how far
  // from one extreme to the other (the second's).
  const reach = Math.ceil(MAXIMUM_LEAN_RADIANS / rate / LEAN_STEP_METRES);
  const span = 2 * reach;
  const centre = Math.round(distance / LEAN_STEP_METRES);
  const lowest = centre - span - reach;
  const count = 2 * (span + reach) + 1;
  const { demand, leftward, rightward } = leanScratch(count);
  for (let index = 0; index < count; index += 1) {
    demand[index] = steadyTurnLean(speed, curvatureAt(line, (lowest + index) * LEAN_STEP_METRES));
  }
  const rollStep = rate * LEAN_STEP_METRES;
  // The first stage, both directions, carried forward…
  let left = Number.NEGATIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < count; index += 1) {
    const value = demand[index] as number;
    left = Math.max(value, left - rollStep);
    right = Math.max(-value, right - rollStep);
    leftward[index] = left;
    rightward[index] = right;
  }
  // …and back, where each direction's floor of nought is applied.
  left = Number.NEGATIVE_INFINITY;
  right = Number.NEGATIVE_INFINITY;
  for (let index = count - 1; index >= 0; index -= 1) {
    const value = demand[index] as number;
    left = Math.max(value, left - rollStep);
    right = Math.max(-value, right - rollStep);
    leftward[index] = Math.max(0, left, leftward[index] as number);
    rightward[index] = Math.max(0, right, rightward[index] as number);
  }
  let upper = Number.POSITIVE_INFINITY;
  let lower = Number.NEGATIVE_INFINITY;
  for (let step = centre - span; step <= centre + span; step += 1) {
    const anticipated = (leftward[step - lowest] as number) - (rightward[step - lowest] as number);
    // The second stage, at the rider's own distance.
    const away = rate * Math.abs(step * LEAN_STEP_METRES - distance);
    lower = Math.max(lower, anticipated - away);
    upper = Math.min(upper, anticipated + away);
  }
  return (lower + upper) / 2;
}

/**
 * The three buffers {@link leanAt} works in — MODULE scratch, shared by every
 * line and every rider, grown when a call needs more and never shrunk. Safe
 * because `leanAt` is synchronous and re-entered by nothing it calls.
 */
let leanBuffers = {
  demand: new Float64Array(256),
  leftward: new Float64Array(256),
  rightward: new Float64Array(256),
};

/** At least `count` numbers in each of {@link leanBuffers}, reused from call to call. */
function leanScratch(count: number): typeof leanBuffers {
  if (leanBuffers.demand.length < count) {
    leanBuffers = {
      demand: new Float64Array(count),
      leftward: new Float64Array(count),
      rightward: new Float64Array(count),
    };
  }
  return leanBuffers;
}

/**
 * The lean of a steady turn: `tan φ = v²·κ / g`, capped at
 * {@link MAXIMUM_LEAN_RADIANS} either way. Zero at rest and on a straight.
 */
export function steadyTurnLean(speed: number, curvature: number): number {
  const lean = Math.atan((speed * speed * curvature) / STANDARD_GRAVITY_METRES_PER_SECOND_SQUARED);
  return Math.max(-MAXIMUM_LEAN_RADIANS, Math.min(MAXIMUM_LEAN_RADIANS, lean));
}

/**
 * The line through a route with a stated number of steps and no cache — for
 * `racing-line.test.ts` to show the steps have converged, and to time one
 * solve.
 *
 * @test-facing the product always takes {@link racingLine}'s cached answer at
 * {@link GAUSS_NEWTON_STEPS}; a test needs to take one more step and compare.
 */
export function solvedLine(profile: RouteProfile, steps: number): RacingLine {
  return solveLine(profile, steps);
}

/** The line's curvature at a distance, linear between samples. */
function curvatureAt(line: RacingLine, distance: number): number {
  const profile = line.profile;
  const values = line.curvatures;
  if (values.length < 2) {
    return 0;
  }
  const on = distanceOnRoute(profile, distance);
  const raw = on / profile.resolution;
  const index = Math.max(0, Math.min(Math.floor(raw), values.length - 2));
  const fraction = Math.max(0, Math.min(1, raw - index));
  const low = values[index] as number;
  const high = values[index + 1] as number;
  return low + (high - low) * fraction;
}

/** A per-sample value at a distance, Catmull-Rom between samples. @see lineOffsetAt */
function sampled(profile: RouteProfile, values: Float64Array, distance: number): number {
  const count = values.length;
  if (count < 2) {
    return count === 1 ? (values[0] as number) : 0;
  }
  const on = distanceOnRoute(profile, distance);
  const raw = on / profile.resolution;
  const index = Math.max(0, Math.min(Math.floor(raw), count - 2));
  const t = Math.max(0, Math.min(1, raw - index));
  const p0 = values[neighbour(profile, count, index - 1)] as number;
  const p1 = values[index] as number;
  const p2 = values[index + 1] as number;
  const p3 = values[neighbour(profile, count, index + 2)] as number;
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  );
}

/**
 * A sample index one or two beyond either end: wrapped on a loop, where the
 * last sample IS the first (`LOOP_CLOSURE_METRES`), and clamped otherwise.
 */
function neighbour(profile: RouteProfile, count: number, index: number): number {
  if (index >= 0 && index < count) {
    return index;
  }
  if (!profile.loop) {
    return index < 0 ? 0 : count - 1;
  }
  const lap = count - 1;
  return ((index % lap) + lap) % lap;
}

/**
 * The road the line is solved over, indexed by PADDED sample — on a loop,
 * {@link loopPaddingSamples} of the lap laid either side, so `index` wraps.
 */
interface PaddedRoad {
  /**
   * The lap sample each padded sample reads. A table rather than the modulo it
   * holds, because every curvature reads three of them, five times a sample a
   * step — #588.
   */
  readonly index: Int32Array;
  readonly xs: Float64Array;
  readonly zs: Float64Array;
  readonly normals: Float64Array;
  /** The late-apex weight per sample, by unpadded index. @see lateApexWeights */
  readonly weights: Float64Array;
  readonly resolution: number;
}

/** The whole solve. @see racingLine */
function solveLine(profile: RouteProfile, steps: number): RacingLine {
  const count = profile.positions.length;
  const offsets = new Float64Array(count);
  const curvatures = new Float64Array(count);
  // On a loop the last sample is the first place again, so the lap is one
  // sample shorter than the array and the last entry is copied at the end.
  const nodes = profile.loop ? count - 1 : count;
  if (nodes < 5) {
    return { profile, offsets, curvatures };
  }
  const origin = corridorOrigin(profile);
  const xs = new Float64Array(nodes);
  const zs = new Float64Array(nodes);
  for (let index = 0; index < nodes; index += 1) {
    const ground = localGroundPosition(origin, profile.positions[index] as GeographicPosition);
    xs[index] = ground.x;
    zs[index] = ground.z;
  }
  const padding = profile.loop ? loopPaddingSamples(profile.resolution) : 0;
  const size = nodes + 2 * padding;
  const lapIndex = new Int32Array(size);
  for (let padded = 0; padded < size; padded += 1) {
    lapIndex[padded] = profile.loop ? (((padded - padding) % nodes) + nodes) % nodes : padded;
  }
  const road: PaddedRoad = {
    index: lapIndex,
    xs,
    zs,
    normals: sampleNormals(xs, zs, profile.loop),
    weights: lateApexWeights(xs, zs, profile.loop, profile.resolution),
    resolution: profile.resolution,
  };

  // ⚠️ **One set of arrays for the whole solve — #588.** Every step used to
  // allocate the system, three copies of it per active-set round, the factors
  // and the answer: about a dozen arrays of the route's length, forty times.
  // The answer is written over in place, which is safe because each step reads
  // the last one's only while building its own system, before solving it.
  const work = workspace(size);
  const solved = work.solution;
  const pinned: ActiveSet = { side: new Int8Array(size), at: new Int32Array(size), count: 0 };
  // The curvature of the line at every row, kept from one step to the next: a
  // step's peak is measured from it, and the next step linearises about the
  // same offsets, so it is the curvature that step would otherwise recompute.
  // The FIRST step weighs every row alike (@see linearise), so the centreline's
  // own peak is measured and deliberately not used.
  measure(road, solved, work);
  let peak = 0;
  for (let step = 0; step < steps; step += 1) {
    linearise(road, solved, peak, work);
    solveOnRoad(work, pinned);
    peak = measure(road, solved, work);
  }
  for (let at = 0; at < nodes; at += 1) {
    offsets[at] = solved[at + padding] as number;
    const edge = !profile.loop && (at === 0 || at === nodes - 1);
    curvatures[at] = edge ? 0 : (work.curvature[at + padding] as number);
  }
  if (profile.loop) {
    offsets[count - 1] = offsets[0] as number;
    curvatures[count - 1] = curvatures[0] as number;
  }
  return { profile, offsets, curvatures };
}

/**
 * The road's normal at each sample — its right, since #583 — from the two
 * samples either side.
 * A sample with no direction — two identical positions — keeps the last one.
 */
function sampleNormals(xs: Float64Array, zs: Float64Array, loop: boolean): Float64Array {
  const nodes = xs.length;
  const normals = new Float64Array(nodes * 2);
  let normalX = 1;
  let normalZ = 0;
  let firstReal = -1;
  for (let index = 0; index < nodes; index += 1) {
    const before = loop ? (index - 1 + nodes) % nodes : Math.max(0, index - 1);
    const after = loop ? (index + 1) % nodes : Math.min(nodes - 1, index + 1);
    const dx = (xs[after] as number) - (xs[before] as number);
    const dz = (zs[after] as number) - (zs[before] as number);
    const length = Math.hypot(dx, dz);
    if (length > 0) {
      // The same perpendicular `terrain.ts` §`ribbonNormals` takes, so the
      // line's positive side and the road's are one side — the right.
      normalX = -dz / length;
      normalZ = dx / length;
      if (firstReal === -1) firstReal = index;
    }
    normals[index * 2] = normalX;
    normals[index * 2 + 1] = normalZ;
  }
  for (let index = 0; index < firstReal; index += 1) {
    normals[index * 2] = normals[firstReal * 2] as number;
    normals[index * 2 + 1] = normals[firstReal * 2 + 1] as number;
  }
  return normals;
}

/**
 * How much the line's curvature costs at each sample, for a late apex — #546.
 *
 * `LATE_APEX_GAIN ^ (−tanh(D) / 2)`, where `D` is the road's own smoothed
 * curvature magnitude `k` (a Gaussian of {@link LATE_APEX_WINDOW_METRES}) read
 * as a relative rate of change, `σ · (dk/ds) / (k + k₀)`: a lighter weight
 * where the bend is tightening, a heavier one where it is opening out, one in
 * the middle of a steady arc and on every straight. Continuous, so the solve
 * is never handed a step in its weights to dump curvature against; and ONE on
 * a straight, so nothing about a road with no bends changed.
 *
 * ⚠️ **Read from the CENTRELINE, and fixed before the first step**: a weight
 * read from the line would move with the answer and the Gauss-Newton steps
 * would be chasing their own tail.
 */
function lateApexWeights(
  xs: Float64Array,
  zs: Float64Array,
  loop: boolean,
  resolution: number,
): Float64Array {
  const nodes = xs.length;
  const index = (at: number): number =>
    loop ? ((at % nodes) + nodes) % nodes : Math.max(0, Math.min(nodes - 1, at));
  // The centreline's own curvature magnitude, from three samples.
  const raw = new Float64Array(nodes);
  for (let at = 0; at < nodes; at += 1) {
    if (!loop && (at === 0 || at === nodes - 1)) continue;
    const i0 = index(at - 1);
    const i2 = index(at + 1);
    const ax = (xs[at] as number) - (xs[i0] as number);
    const az = (zs[at] as number) - (zs[i0] as number);
    const bx = (xs[i2] as number) - (xs[at] as number);
    const bz = (zs[i2] as number) - (zs[at] as number);
    const chord = (Math.hypot(ax, az) + Math.hypot(bx, bz)) / 2;
    raw[at] = chord > 0 ? Math.abs(Math.atan2(ax * bz - az * bx, ax * bx + az * bz)) / chord : 0;
  }
  // Smoothed with a Gaussian, cut at three standard deviations.
  const sigma = LATE_APEX_WINDOW_METRES / resolution;
  const reach = Math.ceil(3 * sigma);
  const kernel = new Float64Array(2 * reach + 1);
  let total = 0;
  for (let k = -reach; k <= reach; k += 1) {
    const value = Math.exp(-(k * k) / (2 * sigma * sigma));
    kernel[k + reach] = value;
    total += value;
  }
  const smooth = new Float64Array(nodes);
  for (let at = 0; at < nodes; at += 1) {
    let sum = 0;
    for (let k = -reach; k <= reach; k += 1) {
      sum += (kernel[k + reach] as number) * (raw[index(at + k)] as number);
    }
    smooth[at] = sum / total;
  }
  const weights = new Float64Array(nodes);
  for (let at = 0; at < nodes; at += 1) {
    const slope =
      ((smooth[index(at + 1)] as number) - (smooth[index(at - 1)] as number)) / (2 * resolution);
    const relative =
      (LATE_APEX_WINDOW_METRES * slope) / ((smooth[at] as number) + LATE_APEX_STRAIGHT_CURVATURE);
    weights[at] = LATE_APEX_GAIN ** (-Math.tanh(relative) / 2);
  }
  return weights;
}

/**
 * The signed curvature of two chords `a` then `b`, given their lengths: the
 * turn between them over their mean length, positive when the line bends
 * toward the normal, and nought when they have no length between them.
 *
 * ⚠️ **Chords and lengths rather than a row and a nudge — #588.** It used to
 * take the offsets, a row and which of the three samples to nudge, rebuild all
 * three points, take both lengths and hand back a fresh object, five times a
 * sample a step. The caller builds the points once now, moves only the one
 * that is nudged, and takes a length again only for a chord that moved — each
 * chord's own length is {@link measure}'s, and a chord is shared by two rows.
 * Every number that reaches this arithmetic is the one it was, so the line is
 * unchanged to the bit.
 */
function curvatureOfChords(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  aLength: number,
  bLength: number,
): number {
  const chord = (aLength + bLength) / 2;
  if (chord === 0) {
    return 0;
  }
  // The normal is the heading turned a quarter toward `+x × +z`'s positive
  // side, so a turn toward it has a positive `a × b` taken in that order.
  const turn = Math.atan2(ax * bz - az * bx, ax * bx + az * bz);
  return turn / chord;
}

/**
 * Where the line is at every padded sample of `offsets`, the length of every
 * chord between two, and the line's curvature and mean chord at every row,
 * into the workspace — and the largest curvature among them, the peak the
 * next step weighs against. Curvature is read at rows `1` to `size − 2`: the
 * two ends have no neighbour.
 */
function measure(road: PaddedRoad, offsets: Float64Array, work: Workspace): number {
  const { index, xs, zs, normals } = road;
  const { x, z, length } = work;
  const size = offsets.length;
  for (let padded = 0; padded < size; padded += 1) {
    const at = index[padded] as number;
    const offset = offsets[padded] as number;
    x[padded] = (xs[at] as number) + offset * (normals[at * 2] as number);
    z[padded] = (zs[at] as number) + offset * (normals[at * 2 + 1] as number);
  }
  for (let chord = 0; chord < size - 1; chord += 1) {
    length[chord] = Math.hypot(
      (x[chord + 1] as number) - (x[chord] as number),
      (z[chord + 1] as number) - (z[chord] as number),
    );
  }
  let peak = 0;
  for (let row = 1; row < size - 1; row += 1) {
    const x1 = x[row] as number;
    const z1 = z[row] as number;
    const aLength = length[row - 1] as number;
    const bLength = length[row] as number;
    const curvature = curvatureOfChords(
      x1 - (x[row - 1] as number),
      z1 - (z[row - 1] as number),
      (x[row + 1] as number) - x1,
      (z[row + 1] as number) - z1,
      aLength,
      bLength,
    );
    work.curvature[row] = curvature;
    work.chord[row] = (aLength + bLength) / 2;
    peak = Math.max(peak, Math.abs(curvature));
  }
  return peak;
}

/**
 * Every array one solve works in, made once for it — #588. The system
 * `H·o = b` is five-diagonal and symmetric: `diagonal` is `H[i][i]`, `first`
 * `H[i][i + 1]`, `second` `H[i][i + 2]`.
 */
interface Workspace {
  readonly diagonal: Float64Array;
  readonly first: Float64Array;
  readonly second: Float64Array;
  readonly rhs: Float64Array;
  /** The same system with the pinned samples moved to the right-hand side. @see solvePinned */
  readonly pinnedDiagonal: Float64Array;
  readonly pinnedFirst: Float64Array;
  readonly pinnedSecond: Float64Array;
  readonly pinnedRhs: Float64Array;
  /** The `LDLᵀ` factors. @see bandedSolve */
  readonly d: Float64Array;
  readonly l1: Float64Array;
  readonly l2: Float64Array;
  /** The offsets: the last step's answer, and the next step's, written over it. */
  readonly solution: Float64Array;
  /** Where {@link solution} puts each padded sample, and each chord's length. @see measure */
  readonly x: Float64Array;
  readonly z: Float64Array;
  readonly length: Float64Array;
  /** The line's curvature and mean chord at each row of {@link solution}. @see measure */
  readonly curvature: Float64Array;
  readonly chord: Float64Array;
}

/** A {@link Workspace} for a system of `size` unknowns, the answer starting at nought. */
function workspace(size: number): Workspace {
  const array = (): Float64Array => new Float64Array(size);
  return {
    diagonal: array(),
    first: array(),
    second: array(),
    rhs: array(),
    pinnedDiagonal: array(),
    pinnedFirst: array(),
    pinnedSecond: array(),
    pinnedRhs: array(),
    d: array(),
    l1: array(),
    l2: array(),
    solution: array(),
    x: array(),
    z: array(),
    length: array(),
    curvature: array(),
    chord: array(),
  };
}

/** The step each curvature's slope is measured over, in metres of offset. */
const SLOPE_STEP_METRES = 1e-4;

/**
 * One Gauss-Newton step of the energy in the module note, as the system whose
 * solution is the NEXT set of offsets — written into the workspace.
 *
 * The curvature term is the residual `κ·|κ|³ / κ̂³` per row, so its square is
 * the eighth power; linearised about `current`, its slope is four times the
 * curvature's own, and that factor of four is why each row's target is a
 * QUARTER of the way to straight rather than all of it — the Gauss-Newton step
 * for that residual, and the step without the quarter overshoots and never
 * settles. The length and the pull are quadratic in the offsets already.
 *
 * Each row's points, chords and curvature at `current` are {@link measure}'s,
 * taken when `current` was solved, rather than taken again here.
 */
function linearise(road: PaddedRoad, current: Float64Array, peak: number, work: Workspace): void {
  const { index, xs, zs, normals } = road;
  const { diagonal, first, second, rhs, x, z, length } = work;
  const size = current.length;
  const h = road.resolution;
  const settle = h / LINE_SETTLE_METRES ** 4;
  diagonal.fill(settle);
  first.fill(0);
  second.fill(0);
  // The pull toward home, `settle·(o − home)²`, puts `settle·home` on the
  // right-hand side — #546. Nought here is the centre line.
  rhs.fill(settle * LINE_HOME_OFFSET_METRES);

  // The length: `μ/h·|ΔC + o₁N₁ − o₀N₀|²` per chord, exactly quadratic.
  const lengthWeight = LENGTH_WEIGHT / h;
  for (let chord = 0; chord < size - 1; chord += 1) {
    const i = index[chord] as number;
    const j = index[chord + 1] as number;
    const dx = (xs[j] as number) - (xs[i] as number);
    const dz = (zs[j] as number) - (zs[i] as number);
    const nix = normals[i * 2] as number;
    const niz = normals[i * 2 + 1] as number;
    const njx = normals[j * 2] as number;
    const njz = normals[j * 2 + 1] as number;
    diagonal[chord] = (diagonal[chord] as number) + lengthWeight;
    diagonal[chord + 1] = (diagonal[chord + 1] as number) + lengthWeight;
    first[chord] = (first[chord] as number) - lengthWeight * (nix * njx + niz * njz);
    rhs[chord] = (rhs[chord] as number) + lengthWeight * (nix * dx + niz * dz);
    rhs[chord + 1] = (rhs[chord + 1] as number) - lengthWeight * (njx * dx + njz * dz);
  }

  const q = (PEAK_EXPONENT - 2) / 2;
  for (let row = 1; row < size - 1; row += 1) {
    if (work.chord[row] === 0) continue;
    const here = work.curvature[row] as number;
    // Before the first step there is no peak to weigh against, and every row
    // weighs the same.
    const weight =
      h *
      (road.weights[index[row] as number] as number) *
      (peak > 0 ? (Math.abs(here) / peak) ** (2 * q) : 1);
    if (weight === 0) continue;
    // The three points as they stand, and each of them in turn moved sideways
    // by the slope step: a nudged point moves the chords either side of it,
    // and only those are measured again.
    const x0 = x[row - 1] as number;
    const z0 = z[row - 1] as number;
    const x1 = x[row] as number;
    const z1 = z[row] as number;
    const x2 = x[row + 1] as number;
    const z2 = z[row + 1] as number;
    const ax = x1 - x0;
    const az = z1 - z0;
    const bx = x2 - x1;
    const bz = z2 - z1;
    const aLength = length[row - 1] as number;
    const bLength = length[row] as number;
    const i0 = index[row - 1] as number;
    const i1 = index[row] as number;
    const i2 = index[row + 1] as number;
    const m0 = (current[row - 1] as number) + SLOPE_STEP_METRES;
    const m1 = (current[row] as number) + SLOPE_STEP_METRES;
    const m2 = (current[row + 1] as number) + SLOPE_STEP_METRES;
    const nx0 = (xs[i0] as number) + m0 * (normals[i0 * 2] as number);
    const nz0 = (zs[i0] as number) + m0 * (normals[i0 * 2 + 1] as number);
    const nx1 = (xs[i1] as number) + m1 * (normals[i1 * 2] as number);
    const nz1 = (zs[i1] as number) + m1 * (normals[i1 * 2 + 1] as number);
    const nx2 = (xs[i2] as number) + m2 * (normals[i2 * 2] as number);
    const nz2 = (zs[i2] as number) + m2 * (normals[i2 * 2 + 1] as number);
    const a0x = x1 - nx0;
    const a0z = z1 - nz0;
    const a1x = nx1 - x0;
    const a1z = nz1 - z0;
    const b1x = x2 - nx1;
    const b1z = z2 - nz1;
    const b2x = nx2 - x1;
    const b2z = nz2 - z1;
    // ⚠️ **Three locals and the three-by-three written out — #734.** This was
    // a loop over the three members and a nested loop over the band with a
    // branch per entry, which under coverage is a counter per entry per row per
    // step. Each diagonal, band and right-hand-side slot below still receives
    // exactly one term per row, in the same arithmetic, so the order they are
    // written in changes no bit (`racing-line.test.ts` §"the digests").
    const j0 =
      (curvatureOfChords(a0x, a0z, bx, bz, Math.hypot(a0x, a0z), bLength) - here) /
      SLOPE_STEP_METRES;
    const j1 =
      (curvatureOfChords(a1x, a1z, b1x, b1z, Math.hypot(a1x, a1z), Math.hypot(b1x, b1z)) - here) /
      SLOPE_STEP_METRES;
    const j2 =
      (curvatureOfChords(ax, az, b2x, b2z, aLength, Math.hypot(b2x, b2z)) - here) /
      SLOPE_STEP_METRES;
    let target = here / (1 + q);
    target -= j0 * (current[row - 1] as number);
    target -= j1 * (current[row] as number);
    target -= j2 * (current[row + 1] as number);
    // Minimising w·(Σ jᵢ·oᵢ + target)² adds w·j·jᵀ to H and −w·j·target to b.
    const w0 = weight * j0;
    const w1 = weight * j1;
    const w2 = weight * j2;
    rhs[row - 1] = (rhs[row - 1] as number) - w0 * target;
    diagonal[row - 1] = (diagonal[row - 1] as number) + w0 * j0;
    first[row - 1] = (first[row - 1] as number) + w0 * j1;
    second[row - 1] = (second[row - 1] as number) + w0 * j2;
    rhs[row] = (rhs[row] as number) - w1 * target;
    diagonal[row] = (diagonal[row] as number) + w1 * j1;
    first[row] = (first[row] as number) + w1 * j2;
    rhs[row + 1] = (rhs[row + 1] as number) - w2 * target;
    diagonal[row + 1] = (diagonal[row + 1] as number) + w2 * j2;
  }
}

/**
 * Minimises one step's energy with every sample held within
 * ±{@link LINE_LIMIT_METRES}: an active set of samples pinned at an edge. The
 * answer is written into the workspace's `solution`.
 *
 * `pinned.side` is 0 for a free sample and ±1 for one held at the edge, and it is
 * CARRIED from one Gauss-Newton step to the next rather than started empty,
 * with at most {@link ACTIVE_SET_ROUNDS_PER_STEP} rounds each: consecutive
 * steps pin nearly the same samples, so the set is refined across the steps
 * instead of being rebuilt inside every one. Rebuilt every step, it took 897
 * solves over 30 steps on a 1 000 km route — 3.6 s. Holding the edge with a
 * stiff spring instead, one solve a step, never settled: a sample released by
 * one step was pushed back out by the next, and a 10 m hairpin's line still
 * moved by 3.4 m between the 30th step and the 31st.
 */
function solveOnRoad(work: Workspace, pinned: ActiveSet): void {
  const solution = work.solution;
  const size = solution.length;
  const sides = pinned.side;
  solvePinned(work, pinned);
  for (let round = 1; round < ACTIVE_SET_ROUNDS_PER_STEP; round += 1) {
    let changed = false;
    let count = 0;
    for (let index = 0; index < size; index += 1) {
      const value = solution[index] as number;
      const side = sides[index] as number;
      if (side === 0) {
        if (Math.abs(value) > LINE_LIMIT_METRES) {
          sides[index] = value > 0 ? 1 : -1;
          changed = true;
        }
      } else {
        // Released when the energy would fall by moving it inward.
        const gradient = residualAt(work, solution, index);
        if ((side > 0 && gradient > 0) || (side < 0 && gradient < 0)) {
          sides[index] = 0;
          changed = true;
        }
      }
      // The pinned samples, listed as they are decided, in ascending order.
      if (sides[index] !== 0) {
        pinned.at[count] = index;
        count += 1;
      }
    }
    pinned.count = count;
    if (!changed) {
      break;
    }
    solvePinned(work, pinned);
  }
  for (let index = 0; index < size; index += 1) {
    solution[index] = Math.max(
      -LINE_LIMIT_METRES,
      Math.min(LINE_LIMIT_METRES, solution[index] as number),
    );
  }
}

/** `(H·o − b)[index]`: half the energy's gradient in that unknown. */
function residualAt(system: Workspace, o: Float64Array, index: number): number {
  const { diagonal, first, second, rhs } = system;
  let sum = (diagonal[index] as number) * (o[index] as number);
  if (index >= 1) sum += (first[index - 1] as number) * (o[index - 1] as number);
  if (index >= 2) sum += (second[index - 2] as number) * (o[index - 2] as number);
  if (index + 1 < o.length) sum += (first[index] as number) * (o[index + 1] as number);
  if (index + 2 < o.length) sum += (second[index] as number) * (o[index + 2] as number);
  return sum - (rhs[index] as number);
}

/**
 * Solves the system with the pinned samples held at their edge: their rows
 * become the identity and their columns move to the right-hand side, so what
 * is factorised is still symmetric and still five-diagonal. Works on the
 * workspace's `pinned*` copies, so the system itself is left as it was built.
 */
function solvePinned(work: Workspace, pinned: ActiveSet): void {
  const {
    pinnedDiagonal: diagonal,
    pinnedFirst: first,
    pinnedSecond: second,
    pinnedRhs: rhs,
  } = work;
  diagonal.set(work.diagonal);
  first.set(work.first);
  second.set(work.second);
  rhs.set(work.rhs);
  // ⚠️ **The pinned samples are LISTED, in ascending order — #734.** This
  // loop used to visit every sample and skip the free ones: three times a
  // step, over the route's length, for a set that is a small fraction of it,
  // and under coverage that skip was the costliest line of the solve. The list
  // is visited in the same order the scan visited them, so every right-hand
  // side receives its terms in the same order and no bit moves.
  const sides = pinned.side;
  for (let listed = 0; listed < pinned.count; listed += 1) {
    const index = pinned.at[listed] as number;
    const side = sides[index] as number;
    const value = side * LINE_LIMIT_METRES;
    // Move this column to the right-hand side of every free row it touches —
    // the two before it and the two after, in that order.
    unpin(rhs, sides, index - 2, index >= 2 ? work.second[index - 2] : undefined, value);
    unpin(rhs, sides, index - 1, index >= 1 ? work.first[index - 1] : undefined, value);
    unpin(rhs, sides, index + 1, work.first[index], value);
    unpin(rhs, sides, index + 2, work.second[index], value);
    diagonal[index] = 1;
    rhs[index] = value;
    if (index >= 1) first[index - 1] = 0;
    if (index >= 2) second[index - 2] = 0;
    first[index] = 0;
    second[index] = 0;
  }
  bandedSolve(diagonal, first, second, rhs, work);
}

/**
 * The active set: each sample's side (0 free, ±1 held at that edge), and the
 * held samples listed in ascending order, which is how {@link solvePinned}
 * visits them. Both are carried from one Gauss-Newton step to the next.
 */
interface ActiveSet {
  readonly side: Int8Array;
  readonly at: Int32Array;
  count: number;
}

/** Moves a pinned column's `coefficient · value` onto a free row's right-hand side. */
function unpin(
  rhs: Float64Array,
  pinned: Int8Array,
  row: number,
  coefficient: number | undefined,
  value: number,
): void {
  if (row < 0 || row >= rhs.length || coefficient === undefined || pinned[row] !== 0) return;
  rhs[row] = (rhs[row] as number) - coefficient * value;
}

/**
 * `LDLᵀ` of a symmetric positive-definite five-diagonal matrix, and the two
 * triangular solves, into the workspace's `solution`. O(n); every factor is
 * written before it is read, so nothing is cleared between calls.
 */
function bandedSolve(
  diagonal: Float64Array,
  first: Float64Array,
  second: Float64Array,
  rhs: Float64Array,
  work: Workspace,
): void {
  const size = diagonal.length;
  const { d, l1, l2, solution: x } = work;
  // ⚠️ **The first two rows and the last two are peeled out of each loop —
  // #734.** They are the only rows with a neighbour missing, and testing for
  // one on every row put a branch in each of the four hottest loops of the
  // solve: 80 steps and up to three solves a step, over the route's length.
  // Under coverage every such branch is a counter, and that is where a
  // 1 000 km solve spent most of its 27 s on CI. What a peeled row computes
  // is what the old loop computed for it with the missing terms as nought,
  // and subtracting nought changes no bit, so the line is the same to the bit
  // — `racing-line.test.ts` §"the digests" holds it to that.
  // A solve is only asked of five samples or more (`solveLine`).
  l2[0] = 0;
  l1[0] = 0;
  d[0] = diagonal[0] as number;
  const b1First = (first[0] as number) / d[0];
  l2[1] = 0;
  l1[1] = b1First;
  d[1] = (diagonal[1] as number) - b1First * b1First * d[0];
  for (let i = 2; i < size; i += 1) {
    const b2 = (second[i - 2] as number) / (d[i - 2] as number);
    const b1 =
      ((first[i - 1] as number) - b2 * (d[i - 2] as number) * (l1[i - 1] as number)) /
      (d[i - 1] as number);
    l2[i] = b2;
    l1[i] = b1;
    d[i] =
      (diagonal[i] as number) - b2 * b2 * (d[i - 2] as number) - b1 * b1 * (d[i - 1] as number);
  }
  x[0] = rhs[0] as number;
  x[1] = (rhs[1] as number) - l1[1] * x[0];
  for (let i = 2; i < size; i += 1) {
    x[i] =
      (rhs[i] as number) -
      (l1[i] as number) * (x[i - 1] as number) -
      (l2[i] as number) * (x[i - 2] as number);
  }
  for (let i = 0; i < size; i += 1) {
    x[i] = (x[i] as number) / (d[i] as number);
  }
  const last = size - 1;
  x[last - 1] = (x[last - 1] as number) - (l1[last] as number) * (x[last] as number);
  for (let i = last - 2; i >= 0; i -= 1) {
    x[i] =
      (x[i] as number) -
      (l1[i + 1] as number) * (x[i + 1] as number) -
      (l2[i + 2] as number) * (x[i + 2] as number);
  }
}
