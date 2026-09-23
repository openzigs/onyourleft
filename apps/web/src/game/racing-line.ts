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
 * own left normal `Nᵢ`, so the line's point is `Pᵢ = Cᵢ + offset[i]·Nᵢ`, and
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
 * The pull toward the centre is {@link LINE_SETTLE_METRES}: on a straight far
 * from any bend the curvature term weighs nothing, and without the pull the
 * line's place there would be whatever the nearest bend left.
 *
 * ## Computed once per route, and bounded
 *
 * A whole-route pass, like `routeProfile`'s windows, cached against the profile
 * OBJECT in a `WeakMap` — `waterways.ts` §`computed` argues why that is the one
 * shape of cache `game/` allows. The first frame of a ride computes it, and
 * every frame after reads it. Each step is at most
 * {@link ACTIVE_SET_ROUNDS_PER_STEP} O(n) solves and the steps are fixed at
 * {@link GAUSS_NEWTON_STEPS}. `racing-line.test.ts` §"its cost" times it
 * on a 1 000 km route, because nothing in the store bounds a route's length.
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
 * The length over which the line settles back to the centre on a straight:
 * **60 m**, as the pull's weight `h / settle⁴`. Chosen: short enough that a
 * straight between two bends is ridden down the middle, long enough that the
 * approach to a hairpin has room to go wide.
 */
const LINE_SETTLE_METRES = 60;

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
 * How many Gauss-Newton steps the line takes: **30**. Every fixture in
 * `racing-line.test.ts` has stopped moving by then, and a test holds a 31st
 * step to under a millimetre; at 20 a 10 m hairpin was still settling.
 */
const GAUSS_NEWTON_STEPS = 30;

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
 * ⚠️ **Through an S-bend the bound is twice this**: one lean unwinds at this
 * rate while the other builds at it (@see leanAt).
 */
export const MAXIMUM_ROLL_RADIANS_PER_METRE = (8 * Math.PI) / 180;

/**
 * How far ahead of — and behind — a rider the lean looks for a bend: the
 * distance a full lean takes to roll in, so a rider reaches the cap by the
 * point the bend asks for it. @see leanAt
 */
const LEAN_WINDOW_METRES = MAXIMUM_LEAN_RADIANS / MAXIMUM_ROLL_RADIANS_PER_METRE;

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
 * The lean to DRAW a rider at, in radians — positive toward the road's normal,
 * which is the side the line bends toward when its curvature is positive, so
 * the rider always leans INTO the bend.
 *
 * `steadyTurnLean` at every point within {@link LEAN_WINDOW_METRES}, each
 * reduced by {@link MAXIMUM_ROLL_RADIANS_PER_METRE} for every metre it is from
 * the rider, and the largest kept — once for each direction of lean. That is a
 * stateless rate limit: the result changes by at most that rate per metre in
 * each direction, it reaches a bend's full lean at the point the bend asks for
 * it, and it has already started leaning a few metres before. The sample points
 * are fixed in route distance rather than placed relative to the rider, which
 * is what makes the bound exact rather than approximately true.
 */
export function leanAt(line: RacingLine, distance: number, speed: number): number {
  if (!(speed > 0)) {
    return 0;
  }
  let leftward = 0;
  let rightward = 0;
  const first = Math.ceil((distance - LEAN_WINDOW_METRES) / LEAN_STEP_METRES);
  const last = Math.floor((distance + LEAN_WINDOW_METRES) / LEAN_STEP_METRES);
  for (let step = first; step <= last; step += 1) {
    const at = step * LEAN_STEP_METRES;
    const demand = steadyTurnLean(speed, curvatureAt(line, at));
    const reach = MAXIMUM_ROLL_RADIANS_PER_METRE * Math.abs(at - distance);
    leftward = Math.max(leftward, demand - reach);
    rightward = Math.max(rightward, -demand - reach);
  }
  return leftward - rightward;
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
 * {@link loopPaddingSamples} of the lap laid either side, so `at` wraps.
 */
interface PaddedRoad {
  readonly at: (padded: number) => number;
  readonly xs: Float64Array;
  readonly zs: Float64Array;
  readonly normals: Float64Array;
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
  const road: PaddedRoad = {
    at: (padded) => (profile.loop ? (((padded - padding) % nodes) + nodes) % nodes : padded),
    xs,
    zs,
    normals: sampleNormals(xs, zs, profile.loop),
    resolution: profile.resolution,
  };

  let solved: Float64Array = new Float64Array(size);
  const pinned = new Int8Array(size);
  let peak = 0;
  for (let step = 0; step < steps; step += 1) {
    solved = solveOnRoad(linearised(size, road, solved, peak), pinned);
    peak = 0;
    for (let row = 1; row < size - 1; row += 1) {
      peak = Math.max(peak, Math.abs(curvatureOf(road, solved, row, -1, 0).curvature));
    }
  }
  for (let index = 0; index < nodes; index += 1) {
    offsets[index] = solved[index + padding] as number;
    const edge = !profile.loop && (index === 0 || index === nodes - 1);
    curvatures[index] = edge ? 0 : curvatureOf(road, solved, index + padding, -1, 0).curvature;
  }
  if (profile.loop) {
    offsets[count - 1] = offsets[0] as number;
    curvatures[count - 1] = curvatures[0] as number;
  }
  return { profile, offsets, curvatures };
}

/**
 * The road's left normal at each sample, from the two samples either side.
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
      // line's "left" and the road's are one side.
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
 * The line's signed curvature at a padded row, with the sample at position
 * `which` of the three it is read from (0, 1 or 2 — the one before, the row
 * itself, the one after; −1 for none) nudged sideways by `nudge` metres.
 *
 * The turn between the two chords over their mean length, positive when the
 * line bends toward the normal.
 */
function curvatureOf(
  road: PaddedRoad,
  offsets: Float64Array,
  row: number,
  which: number,
  nudge: number,
): { readonly curvature: number; readonly chord: number } {
  // Written out rather than through a helper returning a pair: this runs five
  // times per sample per step, and a tuple each time was most of the solve.
  const { at, xs, zs, normals } = road;
  const i0 = at(row - 1);
  const i1 = at(row);
  const i2 = at(row + 1);
  const o0 = (offsets[row - 1] as number) + (which === 0 ? nudge : 0);
  const o1 = (offsets[row] as number) + (which === 1 ? nudge : 0);
  const o2 = (offsets[row + 1] as number) + (which === 2 ? nudge : 0);
  const x0 = (xs[i0] as number) + o0 * (normals[i0 * 2] as number);
  const z0 = (zs[i0] as number) + o0 * (normals[i0 * 2 + 1] as number);
  const x1 = (xs[i1] as number) + o1 * (normals[i1 * 2] as number);
  const z1 = (zs[i1] as number) + o1 * (normals[i1 * 2 + 1] as number);
  const x2 = (xs[i2] as number) + o2 * (normals[i2 * 2] as number);
  const z2 = (zs[i2] as number) + o2 * (normals[i2 * 2 + 1] as number);
  const ax = x1 - x0;
  const az = z1 - z0;
  const bx = x2 - x1;
  const bz = z2 - z1;
  const chord = (Math.hypot(ax, az) + Math.hypot(bx, bz)) / 2;
  if (chord === 0) {
    return NO_CURVATURE;
  }
  // The normal is the heading turned a quarter toward `+x × +z`'s positive
  // side, so a turn toward it has a positive `a × b` taken in that order.
  const turn = Math.atan2(ax * bz - az * bx, ax * bx + az * bz);
  return { curvature: turn / chord, chord };
}

/** What {@link curvatureOf} says of three points with no length between them. */
const NO_CURVATURE = { curvature: 0, chord: 0 } as const;

/** A symmetric five-diagonal system `H·o = b`. */
interface BandedSystem {
  /** `H[i][i]`. */
  readonly diagonal: Float64Array;
  /** `H[i][i + 1]`. */
  readonly first: Float64Array;
  /** `H[i][i + 2]`. */
  readonly second: Float64Array;
  readonly rhs: Float64Array;
}

/** The step each curvature's slope is measured over, in metres of offset. */
const SLOPE_STEP_METRES = 1e-4;

/**
 * One Gauss-Newton step of the energy in the module note, as the system whose
 * solution is the NEXT set of offsets.
 *
 * The curvature term is the residual `κ·|κ|³ / κ̂³` per row, so its square is
 * the eighth power; linearised about `current`, its slope is four times the
 * curvature's own, and that factor of four is why each row's target is a
 * QUARTER of the way to straight rather than all of it — the Gauss-Newton step
 * for that residual, and the step without the quarter overshoots and never
 * settles. The length and the pull are quadratic in the offsets already.
 */
function linearised(
  size: number,
  road: PaddedRoad,
  current: Float64Array,
  peak: number,
): BandedSystem {
  const h = road.resolution;
  const diagonal = new Float64Array(size).fill(h / LINE_SETTLE_METRES ** 4);
  const first = new Float64Array(size);
  const second = new Float64Array(size);
  const rhs = new Float64Array(size);

  // The length: `μ/h·|ΔC + o₁N₁ − o₀N₀|²` per chord, exactly quadratic.
  const length = LENGTH_WEIGHT / h;
  for (let chord = 0; chord < size - 1; chord += 1) {
    const i = road.at(chord);
    const j = road.at(chord + 1);
    const dx = (road.xs[j] as number) - (road.xs[i] as number);
    const dz = (road.zs[j] as number) - (road.zs[i] as number);
    const nix = road.normals[i * 2] as number;
    const niz = road.normals[i * 2 + 1] as number;
    const njx = road.normals[j * 2] as number;
    const njz = road.normals[j * 2 + 1] as number;
    diagonal[chord] = (diagonal[chord] as number) + length;
    diagonal[chord + 1] = (diagonal[chord + 1] as number) + length;
    first[chord] = (first[chord] as number) - length * (nix * njx + niz * njz);
    rhs[chord] = (rhs[chord] as number) + length * (nix * dx + niz * dz);
    rhs[chord + 1] = (rhs[chord + 1] as number) - length * (njx * dx + njz * dz);
  }

  const q = (PEAK_EXPONENT - 2) / 2;
  const slopes = new Float64Array(3);
  for (let row = 1; row < size - 1; row += 1) {
    const here = curvatureOf(road, current, row, -1, 0);
    if (here.chord === 0) continue;
    // Before the first step there is no peak to weigh against, and every row
    // weighs the same.
    const weight = h * (peak > 0 ? (Math.abs(here.curvature) / peak) ** (2 * q) : 1);
    if (weight === 0) continue;
    let target = here.curvature / (1 + q);
    for (let member = 0; member < 3; member += 1) {
      const nudged = curvatureOf(road, current, row, member, SLOPE_STEP_METRES).curvature;
      const slope = (nudged - here.curvature) / SLOPE_STEP_METRES;
      slopes[member] = slope;
      target -= slope * (current[row - 1 + member] as number);
    }
    // Minimising w·(Σ jᵢ·oᵢ + target)² adds w·j·jᵀ to H and −w·j·target to b.
    for (let left = 0; left < 3; left += 1) {
      const padded = row - 1 + left;
      const jl = slopes[left] as number;
      rhs[padded] = (rhs[padded] as number) - weight * jl * target;
      for (let right = left; right < 3; right += 1) {
        const value = weight * jl * (slopes[right] as number);
        const band = right - left;
        if (band === 0) diagonal[padded] = (diagonal[padded] as number) + value;
        else if (band === 1) first[padded] = (first[padded] as number) + value;
        else second[padded] = (second[padded] as number) + value;
      }
    }
  }
  return { diagonal, first, second, rhs };
}

/**
 * Minimises one step's energy with every sample held within
 * ±{@link LINE_LIMIT_METRES}: an active set of samples pinned at an edge.
 *
 * `pinned` is 0 for a free sample and ±1 for one held at the edge, and it is
 * CARRIED from one Gauss-Newton step to the next rather than started empty,
 * with at most {@link ACTIVE_SET_ROUNDS_PER_STEP} rounds each: consecutive
 * steps pin nearly the same samples, so the set is refined across the steps
 * instead of being rebuilt inside every one. Rebuilt every step, it took 897
 * solves over 30 steps on a 1 000 km route — 3.6 s. Holding the edge with a
 * stiff spring instead, one solve a step, never settled: a sample released by
 * one step was pushed back out by the next, and a 10 m hairpin's line still
 * moved by 3.4 m between the 30th step and the 31st.
 */
function solveOnRoad(system: BandedSystem, pinned: Int8Array): Float64Array {
  const size = system.diagonal.length;
  let solution = solvePinned(system, pinned);
  for (let round = 1; round < ACTIVE_SET_ROUNDS_PER_STEP; round += 1) {
    let changed = false;
    for (let index = 0; index < size; index += 1) {
      const value = solution[index] as number;
      const side = pinned[index] as number;
      if (side === 0) {
        if (Math.abs(value) > LINE_LIMIT_METRES) {
          pinned[index] = value > 0 ? 1 : -1;
          changed = true;
        }
      } else {
        // Released when the energy would fall by moving it inward.
        const gradient = residualAt(system, solution, index);
        if ((side > 0 && gradient > 0) || (side < 0 && gradient < 0)) {
          pinned[index] = 0;
          changed = true;
        }
      }
    }
    if (!changed) {
      break;
    }
    solution = solvePinned(system, pinned);
  }
  for (let index = 0; index < size; index += 1) {
    solution[index] = Math.max(
      -LINE_LIMIT_METRES,
      Math.min(LINE_LIMIT_METRES, solution[index] as number),
    );
  }
  return solution;
}

/** `(H·o − b)[index]`: half the energy's gradient in that unknown. */
function residualAt(system: BandedSystem, o: Float64Array, index: number): number {
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
 * is factorised is still symmetric and still five-diagonal.
 */
function solvePinned(system: BandedSystem, pinned: Int8Array): Float64Array {
  const size = system.diagonal.length;
  const diagonal = Float64Array.from(system.diagonal);
  const first = Float64Array.from(system.first);
  const second = Float64Array.from(system.second);
  const rhs = Float64Array.from(system.rhs);
  for (let index = 0; index < size; index += 1) {
    const side = pinned[index] as number;
    if (side === 0) continue;
    const value = side * LINE_LIMIT_METRES;
    // Move this column to the right-hand side of every free row it touches.
    const touched: readonly (readonly [number, number | undefined])[] = [
      [index - 2, system.second[index - 2]],
      [index - 1, system.first[index - 1]],
      [index + 1, system.first[index]],
      [index + 2, system.second[index]],
    ];
    for (const [row, coefficient] of touched) {
      if (row < 0 || row >= size || coefficient === undefined || pinned[row] !== 0) continue;
      rhs[row] = (rhs[row] as number) - coefficient * value;
    }
    diagonal[index] = 1;
    rhs[index] = value;
    if (index >= 1) first[index - 1] = 0;
    if (index >= 2) second[index - 2] = 0;
    first[index] = 0;
    second[index] = 0;
  }
  return bandedSolve(diagonal, first, second, rhs);
}

/**
 * `LDLᵀ` of a symmetric positive-definite five-diagonal matrix, and the two
 * triangular solves. O(n), and in place over fresh arrays.
 */
function bandedSolve(
  diagonal: Float64Array,
  first: Float64Array,
  second: Float64Array,
  rhs: Float64Array,
): Float64Array {
  const size = diagonal.length;
  const d = new Float64Array(size);
  const l1 = new Float64Array(size);
  const l2 = new Float64Array(size);
  for (let i = 0; i < size; i += 1) {
    const b2 = i >= 2 ? (second[i - 2] as number) / (d[i - 2] as number) : 0;
    const b1 =
      i >= 1
        ? ((first[i - 1] as number) -
            (i >= 2 ? b2 * (d[i - 2] as number) * (l1[i - 1] as number) : 0)) /
          (d[i - 1] as number)
        : 0;
    l2[i] = b2;
    l1[i] = b1;
    d[i] =
      (diagonal[i] as number) -
      (i >= 2 ? b2 * b2 * (d[i - 2] as number) : 0) -
      (i >= 1 ? b1 * b1 * (d[i - 1] as number) : 0);
  }
  const x = new Float64Array(size);
  for (let i = 0; i < size; i += 1) {
    x[i] =
      (rhs[i] as number) -
      (i >= 1 ? (l1[i] as number) * (x[i - 1] as number) : 0) -
      (i >= 2 ? (l2[i] as number) * (x[i - 2] as number) : 0);
  }
  for (let i = 0; i < size; i += 1) {
    x[i] = (x[i] as number) / (d[i] as number);
  }
  for (let i = size - 1; i >= 0; i -= 1) {
    x[i] =
      (x[i] as number) -
      (i + 1 < size ? (l1[i + 1] as number) * (x[i + 1] as number) : 0) -
      (i + 2 < size ? (l2[i + 2] as number) * (x[i + 2] as number) : 0);
  }
  return x;
}
