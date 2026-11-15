// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The path a rider is DRAWN along through a bend, and how fast along it — #2422.
 *
 * ## Why
 *
 * The owner rode a 90° junction on the tablet and the rider slowed far too
 * much, leant too far, snapped round the corner on the wrong line, and the
 * camera jerked round. #1998's easing was not the cause. Three things were,
 * and each was measured on `route-fixtures-testing.ts` §`plannerCornerRoute`
 * and §`jitteredJunctionRoute` before this file was written:
 *
 * 1. **The line was solved on one road and drawn on another.** `racing-line.ts`
 *    §`racingLine` solves against the route's own samples; the rider was drawn
 *    on `terrain.ts`' smoothed road, which at a one-vertex corner already runs
 *    3.5 m inside the vertex. The offsets took the rider a further 2.9 m in, so
 *    the drawn path was far tighter than the curvature the lean and the easing
 *    read, and where a GPS track wanders either side of the corner the offset
 *    curve folded back on itself and the rider swung round on the spot.
 * 2. **The drawn rider was paced by the ROUTE, not by the path it is drawn
 *    on.** A rider at odometer `d` was drawn at the road's point for `d`. The
 *    smoothed road and the line through it are SHORTER than the route through
 *    a corner, so the rider covered the corner's twenty-odd metres of route on
 *    a much shorter path: 42 % of the simulation's speed over the ground at
 *    the apex of a clean 90° corner, and 17 to 27 % through a jittered
 *    junction, measured on #2445's head before this file.
 * 3. **The lean, the speed limit and the facing were read off three different
 *    curves** — the solved line's curvature, the odometer's speed and the road
 *    plus an offset — so none agreed with what was drawn.
 *
 * ## What is drawn
 *
 * One path, and everything read from it:
 *
 * - **Through the line's own points.** `racing-line.ts` §`drawnRoadLine`
 *   solves the line on the road as it is DRAWN. Its point at each profile
 *   sample is on the tarmac, and the line has the least peak curvature the
 *   carriageway allows. The path is a cubic spline through those points,
 *   parameterised by their chord length so that its curvature is the line's
 *   — the fillet a real rider takes, sized by the road rather than invented.
 * - **Paced by its own length** ({@link DRAWN_PACE_WINDOW_METRES}). A rider
 *   at odometer `d` is drawn at the path's arc length MEAN over the
 *   {@link DRAWN_PACE_WINDOW_METRES} of route either side of `d`. On a
 *   straight that is the path's own point for `d`; through a bend the corner's
 *   shortfall in length is spread over the window, so the drawn rider loses a
 *   few per cent of their speed rather than more than half, and is never more
 *   than a few metres from their own place. Stateless, like the lean: a
 *   function of where the rider is.
 * - **A line object the easing and the lean already read.** {@link drawnLine}
 *   is a `RacingLine`. Its curvature at each sample is the path's, times the
 *   square of how fast the drawn place moves along the path per metre of
 *   odometer, so `racing-line.ts` §`leanAt` and `bend-easing.ts` §`easedPlace`,
 *   handed the odometer's speed, read `v²/(g·r)` and `√(g·tan φ/κ)` of the
 *   path at the speed it is drawn at. Its offsets are the path's distance from
 *   the drawn road's centreline, so riders level with each other are kept
 *   apart about it as before (`scene.ts` §`lateralOf`).
 *
 * ## What is NOT changed
 *
 * ⚠️ **A drawing, never physics** — `bend-easing.ts`' rule, unchanged. The
 * odometer, the trainer's grade (`gradient.ts`), recording, the HUD, segments,
 * the ghost's replay and the pacer's gap never read this file;
 * `draft-cannot-reach-trainer.test.tsx` holds the grade to the odometer
 * whatever the drawn place. Not in a Delivery round or a lap race, where the
 * drawn place is where the game meets the rider (`scene.ts` §`easingLine`):
 * there the riders are drawn on `racingLine` as before.
 *
 * Pure: no clock, no `three`, no DOM, no platform API. Computed once per route
 * and cached against the profile object, as the line is.
 */

import { distanceOnRoute, type RouteProfile } from '@onyourleft/domain';

import { LINE_LIMIT_METRES, drawnRoadLine, type RacingLine } from './racing-line';
import { corridorOrigin, drawnRoadPosition } from './terrain';

/**
 * Over how much route either side of the rider the path's length is averaged
 * to pace them: **60 m**. Chosen, from a measurement on 2026-11-10 of the
 * slowest a rider at 25 km/h — where the easing barely acts — is drawn moving
 * over the ground, through `plannerCornerRoute(90)` and the worst of 200
 * jittered junctions of 1 to 5 m:
 *
 * | Window | Planner 90° | Worst jittered junction |
 * |--:|--:|--:|
 * | 0 (paced by the route) | 60 % | 23 % |
 * | 20 m | 86 % | 69 % |
 * | 30 m | 91 % | 76 % |
 * | 60 m | 95 % | 81 % |
 * | 90 m | 96 % | 84 % |
 *
 * A wider window spreads a corner's shortfall over more road, so the drawn
 * rider slows less for it, at the cost of being drawn further from their own
 * place: at most half the shortfall, a few metres through a 90° corner. Past
 * 60 m it buys little. Near the end of a point-to-point route the window
 * shrinks to fit, so the rider finishes on the finish.
 */
export const DRAWN_PACE_WINDOW_METRES = 60;

/** A drawn rider's place on the path, and which way it runs there. */
export interface DrawnPoint {
  /** Local metres, as `terrain.ts` lays the road out. */
  readonly x: number;
  readonly z: number;
  /** A unit vector along the path in the ground plane. */
  readonly headingX: number;
  readonly headingZ: number;
}

/**
 * The path, as a `RacingLine` the lean and the easing read, and the spline
 * the riders are placed on. @see the module note
 */
export interface DrawnLine extends RacingLine {
  /** Where the path is at each profile sample's odometer, local metres. */
  readonly xs: Float64Array;
  readonly zs: Float64Array;
  /** The path's second derivatives at each sample, per metre of odometer squared. */
  readonly bendXs: Float64Array;
  readonly bendZs: Float64Array;
  /**
   * How far along the ROAD each sample's place on the path is from the
   * sample's own odometer, in metres — the pacing's shift, a few metres
   * through a corner and nought on a straight. @see drawnPlaceOf
   */
  readonly shifts: Float64Array;
}

const computed = new WeakMap<RouteProfile, DrawnLine>();

/**
 * Whether {@link drawnLine} has already been built for `profile` — #2422's
 * review: `GameView` builds it while the rider chooses (§`DRAWN_LINE_WARM_DELAY_MS`),
 * so the ride's first frame does not.
 *
 * @test-facing the product only ever calls {@link drawnLine}; a test needs to
 * know whether that call will build or find the line.
 */
export function drawnLineBuilt(profile: RouteProfile): boolean {
  return computed.has(profile);
}

/** Whether a line is a {@link DrawnLine}, which riders are placed ON rather than beside the road. */
export function isDrawnLine(line: RacingLine): line is DrawnLine {
  return 'bendXs' in line;
}

/**
 * The drawn path through a whole route — #2422. Pure; cached per profile
 * object. @see the module note
 */
export function drawnLine(profile: RouteProfile): DrawnLine {
  const known = computed.get(profile);
  if (known !== undefined) {
    return known;
  }
  const found = buildDrawnLine(profile);
  computed.set(profile, found);
  return found;
}

/**
 * The odometer of the ROAD beside where a rider at drawn odometer `distance`
 * is drawn on the path — #2422's review: the pacing puts the path's place a
 * few metres along the road from `distance` through a corner, and a height,
 * a grade or anything else read off the road for the rider is read here, or a
 * rider on a climbing corner is drawn a third of a metre above the tarmac.
 * Unwrapped, as `distance` is: the shift is added to it.
 */
export function drawnPlaceOf(line: DrawnLine, distance: number): number {
  const count = line.shifts.length;
  if (count < 2) return distance;
  const raw = distanceOnRoute(line.profile, distance) / (line.profile.resolution as number);
  const index = Math.max(0, Math.min(Math.floor(raw), count - 2));
  const fraction = Math.max(0, Math.min(1, raw - index));
  const low = line.shifts[index] as number;
  return distance + low + ((line.shifts[index + 1] as number) - low) * fraction;
}

/**
 * Where a rider at drawn odometer `distance` is on the path, and which way it
 * runs: the spline through {@link DrawnLine.xs}, wrapped on a loop and held at
 * the ends of a line.
 */
export function drawnLineAt(line: DrawnLine, distance: number): DrawnPoint {
  const count = line.xs.length;
  const resolution: number = line.profile.resolution;
  if (count < 2) {
    return { x: line.xs[0] ?? 0, z: line.zs[0] ?? 0, headingX: 0, headingZ: 1 };
  }
  const raw = distanceOnRoute(line.profile, distance) / resolution;
  const index = Math.max(0, Math.min(Math.floor(raw), count - 2));
  const fraction = Math.max(0, Math.min(1, raw - index));
  const x = splineAt(line.xs, line.bendXs, index, fraction, resolution);
  const z = splineAt(line.zs, line.bendZs, index, fraction, resolution);
  const length = Math.hypot(x.slope, z.slope);
  return length > 0
    ? { x: x.value, z: z.value, headingX: x.slope / length, headingZ: z.slope / length }
    : { x: x.value, z: z.value, headingX: 0, headingZ: 1 };
}

/** A cubic spline segment's value and slope, `fraction` of the way along a segment `span` long. */
function splineAt(
  values: Float64Array,
  bends: Float64Array,
  index: number,
  fraction: number,
  span: number,
): { readonly value: number; readonly slope: number } {
  const after = fraction;
  const before = 1 - after;
  const low = values[index] as number;
  const high = values[index + 1] as number;
  const lowBend = bends[index] as number;
  const highBend = bends[index + 1] as number;
  const value =
    before * low +
    after * high +
    ((before ** 3 - before) * lowBend + (after ** 3 - after) * highBend) * ((span * span) / 6);
  const slope =
    (high - low) / span +
    (-(3 * before * before - 1) * lowBend + (3 * after * after - 1) * highBend) * (span / 6);
  return { value, slope };
}

/** The whole build. @see drawnLine */
function buildDrawnLine(profile: RouteProfile): DrawnLine {
  const solved = drawnRoadLine(profile);
  const count = solved.xs.length;
  const resolution: number = profile.resolution;
  const total: number = profile.totalDistance;
  const loop = profile.loop;
  if (count < 3) {
    return {
      ...solved.line,
      xs: solved.xs,
      zs: solved.zs,
      shifts: new Float64Array(count),
      bendXs: new Float64Array(count),
      bendZs: new Float64Array(count),
    };
  }
  // On a loop the last sample IS the first: the lap is `count − 1` samples,
  // and every array is read across the wrap by padding it with whole samples.
  const lap = loop ? count - 1 : count;
  const pad = loop ? Math.ceil(DRAWN_PACE_WINDOW_METRES / resolution) + 4 : 0;
  const sampleOf = (padded: number): number =>
    loop ? (((padded - pad) % lap) + lap) % lap : padded;
  const size = loop ? lap + 2 * pad + 1 : count;

  // 1. The line's points and their chord length, the spline's parameter.
  const px = new Float64Array(size);
  const pz = new Float64Array(size);
  for (let padded = 0; padded < size; padded += 1) {
    px[padded] = solved.xs[sampleOf(padded)] as number;
    pz[padded] = solved.zs[sampleOf(padded)] as number;
  }
  const chord = new Float64Array(size);
  for (let padded = 1; padded < size; padded += 1) {
    // Never a zero-length knot: two samples in one place still advance it.
    const step = Math.hypot(
      (px[padded] as number) - (px[padded - 1] as number),
      (pz[padded] as number) - (pz[padded - 1] as number),
    );
    chord[padded] = (chord[padded - 1] as number) + Math.max(step, 1e-6);
  }
  const bendX = naturalSpline(px, chord);
  const bendZ = naturalSpline(pz, chord);

  // 2. The path's length at an odometer reading — linear between samples —
  // and its mean over the pace window, read at each sample.
  const lengthAt = (odometer: number): number => {
    const raw = odometer / resolution + pad;
    const index = Math.max(0, Math.min(Math.floor(raw), size - 2));
    const fraction = raw - index;
    const low = chord[index] as number;
    return low + ((chord[index + 1] as number) - low) * fraction;
  };
  const meanLength = (from: number, to: number): number => {
    // The exact mean of a function linear between samples: a trapezoid per cell.
    let sum = 0;
    let at = from;
    while (at < to) {
      const next = Math.min(to, (Math.floor(at / resolution + 1e-9) + 1) * resolution);
      sum += ((lengthAt(at) + lengthAt(next)) / 2) * (next - at);
      at = next;
    }
    return sum / (to - from);
  };

  // The odometer a length along the path is level with: the inverse of
  // `lengthAt`, linear between samples as it is.
  const odometerAt = (length: number): number => {
    let low = 0;
    let high = size - 1;
    while (high - low > 1) {
      const middle = (low + high) >> 1;
      if ((chord[middle] as number) <= length) low = middle;
      else high = middle;
    }
    const span = (chord[low + 1] as number) - (chord[low] as number);
    const fraction = span > 0 ? (length - (chord[low] as number)) / span : 0;
    return (low - pad + fraction) * resolution;
  };
  const xs = new Float64Array(count);
  const zs = new Float64Array(count);
  const shifts = new Float64Array(count);
  for (let sample = 0; sample < count; sample += 1) {
    const odometer = Math.min(total, sample * resolution);
    const half = loop
      ? DRAWN_PACE_WINDOW_METRES
      : Math.min(DRAWN_PACE_WINDOW_METRES, odometer, total - odometer);
    const paced = half > 0 ? meanLength(odometer - half, odometer + half) : lengthAt(odometer);
    const at = chordSplineAt(px, pz, bendX, bendZ, chord, paced);
    // Where along the road the paced place is, near enough for `scene.ts`
    // §`drawnHeight` to find the road under it from there.
    shifts[sample] = odometerAt(paced) - odometer;
    xs[sample] = at.x;
    zs[sample] = at.z;
  }
  if (loop) {
    xs[count - 1] = xs[0] as number;
    zs[count - 1] = zs[0] as number;
    shifts[count - 1] = shifts[0] as number;
  }

  // 3. Held on the road between samples, not only at them.
  const origin = corridorOrigin(profile);
  const road = (odometer: number): RoadFrame => roadFrameAt(profile, origin, odometer);
  // The road at each sample, read once: the hold reads it every round and
  // the offsets read it again.
  const atSamples: RoadFrame[] = [];
  for (let sample = 0; sample < count; sample += 1) {
    atSamples.push(road(Math.min(total, sample * resolution)));
  }
  const knots = new Float64Array(count);
  for (let sample = 0; sample < count; sample += 1) knots[sample] = sample * resolution;
  const bendsOf = (values: Float64Array): Float64Array =>
    loop ? periodicBends(values, resolution) : naturalSpline(values, knots);
  let bendXs = bendsOf(xs);
  let bendZs = bendsOf(zs);
  for (let round = 0; round < HOLD_ROUNDS; round += 1) {
    if (!heldOnTheRoad(xs, zs, bendXs, bendZs, resolution, total, loop, road, atSamples)) break;
    bendXs = bendsOf(xs);
    bendZs = bendsOf(zs);
  }

  // 4. Its offset from the drawn road's centreline, and its curvature as the
  // easing and the lean read it, at each sample.
  const offsets = new Float64Array(count);
  const curvatures = new Float64Array(count);
  for (let sample = 0; sample < count; sample += 1) {
    const frame = atSamples[sample] as RoadFrame;
    offsets[sample] =
      ((xs[sample] as number) - frame.x) * frame.normalX +
      ((zs[sample] as number) - frame.z) * frame.normalZ;
    const index = Math.min(sample, count - 2);
    const fraction = sample - index;
    const x = splineAt(xs, bendXs, index, fraction, resolution);
    const z = splineAt(zs, bendZs, index, fraction, resolution);
    const pace = Math.hypot(x.slope, z.slope);
    // `κ · pace²`, with `κ = (x′z″ − z′x″) / pace³` the path's own: per metre
    // of ODOMETER squared, so a lean read at the odometer's speed is the
    // lean at the speed the rider is drawn moving along the path.
    curvatures[sample] =
      pace > 0
        ? (x.slope * (bendZs[sample] as number) - z.slope * (bendXs[sample] as number)) / pace
        : 0;
  }
  if (!loop) {
    // As `racing-line.ts` has it: the two ends of a line have no bend.
    curvatures[0] = 0;
    curvatures[count - 1] = 0;
  }
  return { profile, offsets, curvatures, xs, zs, bendXs, bendZs, shifts };
}

/**
 * How many times {@link heldOnTheRoad} pulls the path in: **6**, where every
 * fixture measured needed at most three.
 */
const HOLD_ROUNDS = 6;

/**
 * How far inside the limit both ends of a stretch must be for
 * {@link heldOnTheRoad} not to read it: **1 m** — #2422's review, for the
 * first frame's cost. The most the path was measured bowing past the line
 * between two samples is 0.65 m, over 200 jittered junctions; the line holds
 * 1.75 m from the centre on a straight, 1.15 m inside the limit, so a
 * straight is never read.
 */
const HOLD_SCAN_MARGIN_METRES = 1;

/** How often {@link heldOnTheRoad} reads the path between two samples: every metre or so. */
const HOLD_STEPS_PER_SAMPLE = 10;

/** The drawn road's centreline at an odometer reading, and its normal there. */
interface RoadFrame {
  readonly x: number;
  readonly z: number;
  readonly normalX: number;
  readonly normalZ: number;
}

/** @see RoadFrame — the normal from half a metre either side, as `terrain.ts`' points are a road apart. */
function roadFrameAt(
  profile: RouteProfile,
  origin: ReturnType<typeof corridorOrigin>,
  odometer: number,
): RoadFrame {
  const here = drawnRoadPosition(profile, origin, odometer);
  const behind = drawnRoadPosition(profile, origin, odometer - 0.5);
  const ahead = drawnRoadPosition(profile, origin, odometer + 0.5);
  const dx = ahead.x - behind.x;
  const dz = ahead.z - behind.z;
  const length = Math.hypot(dx, dz);
  return length > 0
    ? { x: here.x, z: here.z, normalX: -dz / length, normalZ: dx / length }
    : { x: here.x, z: here.z, normalX: 0, normalZ: 0 };
}

/**
 * One round of holding the path inside ±`LINE_LIMIT_METRES` of the drawn
 * road BETWEEN its samples, in place — whether anything moved.
 *
 * The line is solved at the profile's samples, about 10 m apart, and the
 * drawn road between two of them is a curve of its own: where a GPS track
 * wanders, the road bows away between two samples the line is pinned at, and
 * the spline between them crossed the road's edge by up to 0.65 m in a scan of
 * 200 jittered junctions. So each stretch the path is near the limit on is
 * read every metre, and where it is past the limit both of its samples are
 * moved back across the road by the most it is over. Moving a knot by a few
 * tens of centimetres barely changes the path's curvature, which is read from
 * the spline afterwards.
 */
function heldOnTheRoad(
  xs: Float64Array,
  zs: Float64Array,
  bendXs: Float64Array,
  bendZs: Float64Array,
  resolution: number,
  total: number,
  loop: boolean,
  road: (odometer: number) => RoadFrame,
  atSamples: readonly RoadFrame[],
): boolean {
  const count = xs.length;
  const moves = new Float64Array(count * 2);
  let moved = false;
  // How far each sample is from the centreline: a stretch whose two ends are
  // both well inside the limit cannot bow past it, and is not read.
  const out = new Float64Array(count);
  for (let index = 0; index < count; index += 1) {
    const frame = atSamples[index] as RoadFrame;
    out[index] = Math.abs(
      ((xs[index] as number) - frame.x) * frame.normalX +
        ((zs[index] as number) - frame.z) * frame.normalZ,
    );
  }
  for (let index = 0; index < count - 1; index += 1) {
    if (
      (out[index] as number) < LINE_LIMIT_METRES - HOLD_SCAN_MARGIN_METRES &&
      (out[index + 1] as number) < LINE_LIMIT_METRES - HOLD_SCAN_MARGIN_METRES
    ) {
      continue;
    }
    let over = 0;
    let overNormalX = 0;
    let overNormalZ = 0;
    for (let step = 0; step <= HOLD_STEPS_PER_SAMPLE; step += 1) {
      const fraction = step / HOLD_STEPS_PER_SAMPLE;
      const odometer = Math.min(total, (index + fraction) * resolution);
      const frame = road(odometer);
      const x = splineAt(xs, bendXs, index, fraction, resolution).value;
      const z = splineAt(zs, bendZs, index, fraction, resolution).value;
      const across = (x - frame.x) * frame.normalX + (z - frame.z) * frame.normalZ;
      const excess = Math.abs(across) - LINE_LIMIT_METRES;
      if (excess > Math.abs(over)) {
        over = Math.sign(across) * excess;
        overNormalX = frame.normalX;
        overNormalZ = frame.normalZ;
      }
    }
    if (over === 0) continue;
    moved = true;
    for (const knot of [index, index + 1]) {
      // The larger pull wins where two stretches share a knot.
      const pullX = -over * overNormalX;
      const pullZ = -over * overNormalZ;
      if (
        Math.hypot(pullX, pullZ) >
        Math.hypot(moves[knot * 2] as number, moves[knot * 2 + 1] as number)
      ) {
        moves[knot * 2] = pullX;
        moves[knot * 2 + 1] = pullZ;
      }
    }
  }
  if (!moved) return false;
  for (let knot = 0; knot < count; knot += 1) {
    xs[knot] = (xs[knot] as number) + (moves[knot * 2] as number);
    zs[knot] = (zs[knot] as number) + (moves[knot * 2 + 1] as number);
  }
  if (loop) {
    // The last sample is the first: the larger of their two pulls holds both.
    const first = Math.hypot(moves[0] as number, moves[1] as number);
    const last = Math.hypot(moves[(count - 1) * 2] as number, moves[(count - 1) * 2 + 1] as number);
    const from = first >= last ? 0 : count - 1;
    xs[0] = xs[count - 1] = (from === 0 ? xs[0] : xs[count - 1]) as number;
    zs[0] = zs[count - 1] = (from === 0 ? zs[0] : zs[count - 1]) as number;
  }
  return true;
}

/** The point, and signed curvature (positive toward the normal `(−z′, x′)`), at chord length `at`. */
function chordSplineAt(
  xs: Float64Array,
  zs: Float64Array,
  bendX: Float64Array,
  bendZ: Float64Array,
  chord: Float64Array,
  at: number,
): { readonly x: number; readonly z: number; readonly curvature: number } {
  const last = chord.length - 1;
  let low = 0;
  let high = last;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if ((chord[middle] as number) <= at) low = middle;
    else high = middle;
  }
  const span = (chord[low + 1] as number) - (chord[low] as number);
  const fraction = Math.max(0, Math.min(1, (at - (chord[low] as number)) / span));
  const x = splineAt(xs, bendX, low, fraction, span);
  const z = splineAt(zs, bendZ, low, fraction, span);
  const xBend = (bendX[low] as number) * (1 - fraction) + (bendX[low + 1] as number) * fraction;
  const zBend = (bendZ[low] as number) * (1 - fraction) + (bendZ[low + 1] as number) * fraction;
  const speed = Math.hypot(x.slope, z.slope);
  return {
    x: x.value,
    z: z.value,
    curvature: speed > 0 ? (x.slope * zBend - z.slope * xBend) / speed ** 3 : 0,
  };
}

/**
 * A natural cubic spline's second derivatives through `values` at `knots` —
 * nought at both ends — by the tridiagonal (Thomas) solve.
 */
function naturalSpline(values: Float64Array, knots: Float64Array): Float64Array {
  const count = values.length;
  const bends = new Float64Array(count);
  if (count < 3) return bends;
  const upper = new Float64Array(count);
  const right = new Float64Array(count);
  for (let index = 1; index < count - 1; index += 1) {
    const before = (knots[index] as number) - (knots[index - 1] as number);
    const after = (knots[index + 1] as number) - (knots[index] as number);
    const rhs =
      6 *
      (((values[index + 1] as number) - (values[index] as number)) / after -
        ((values[index] as number) - (values[index - 1] as number)) / before);
    const lower = index > 1 ? before : 0;
    const pivot = 2 * (before + after) - lower * (index > 1 ? (upper[index - 1] as number) : 0);
    upper[index] = after / pivot;
    right[index] = (rhs - lower * (index > 1 ? (right[index - 1] as number) : 0)) / pivot;
  }
  for (let index = count - 2; index >= 1; index -= 1) {
    bends[index] =
      (right[index] as number) -
      (upper[index] as number) * (index < count - 2 ? (bends[index + 1] as number) : 0);
  }
  return bends;
}

/**
 * The second derivatives of a uniform spline through a LOOP's samples, whose
 * last is its first: a natural spline through the lap padded with itself
 * either side, read in the middle, so the ends it is natural at are far from
 * the lap and the closure has no kink.
 */
function periodicBends(values: Float64Array, spacing: number): Float64Array {
  const count = values.length;
  const lap = count - 1;
  const pad = Math.min(lap, 16);
  const size = lap + 2 * pad + 1;
  const padded = new Float64Array(size);
  const knots = new Float64Array(size);
  for (let index = 0; index < size; index += 1) {
    padded[index] = values[(((index - pad) % lap) + lap) % lap] as number;
    knots[index] = index * spacing;
  }
  const bends = naturalSpline(padded, knots);
  return bends.slice(pad, pad + count);
}
