// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The road ahead, as the HUD draws it — #2075.
 *
 * The whole-route strip is the route scaled to fit its box, so every route
 * looks equally steep: a 2 % drag and a 12 % wall fill the same height. This
 * is the other picture: the next {@link LOOK_AHEAD_METRES} of road, from the
 * rider forward, at a **fixed** scale — {@link LOOK_AHEAD_RISE_METRES} of
 * height across the strip's height, whatever the route — so a steeper road
 * is a steeper line. Each stretch is filled in its grade band's colour and
 * pattern ({@link GRADE_BANDS}), and the next climb within range is named:
 * how far ahead it starts and its average grade.
 *
 * ## No new engine
 *
 * Every number here is read from the same places the rest of the ride reads:
 * the elevation and the grade from `@onyourleft/domain`'s `elevationAt` and
 * `gradeAt`, which the trainer's gradient is read through, and the next climb
 * from `climb-ahead.ts`'s `slopesOf` and `slopeAhead`, which is what the
 * announcer says (#399). A second notion of "a climb" here would be a second
 * answer to the same question, and the strip and the voice would disagree.
 *
 * ## The lap seam
 *
 * `elevationAt` and `gradeAt` wrap on a loop and clamp on a point-to-point
 * route (`distanceOnRoute`), so a loop's look-ahead runs across the line into
 * the next lap's road, and a one-way route's stops where the road does —
 * {@link LookAhead.length} is shorter than the window there. `slopeAhead`
 * wraps the same way, so lap two's climb is ahead of a rider on lap one.
 *
 * ## The bands are this project's own
 *
 * Five, by grade, chosen as what a rider changes gear for rather than read
 * off any product (ADR 0009 L1): a descent, flat, a climb, steep and very
 * steep. Their edges extend `climb-ahead.ts` §`SLOPE_GRADE_PERCENT`, which is
 * where the announcer stops calling the road flat, so the strip turns from
 * flat to climb where the voice starts saying "Climb".
 *
 * ## The climb view — #2291
 *
 * The owner asked for the road ahead as a climb profile: 1 to 2 km of it,
 * shaded by steepness, saying how far it is to the top of the climb the rider
 * is on or of the next one, and its average grade. This EXTENDS #2075's strip
 * rather than replacing it: the window is 2 km where it was 1 km, and the
 * fixed scale doubles with it ({@link LOOK_AHEAD_RISE_METRES}), so a grade is
 * drawn at the angle it was and twice as much road fits. {@link climbAhead}
 * adds the climb under the rider, which `slopeAhead` leaves out on purpose
 * (the announcer has nothing to warn of there), and the top of either. The
 * same slopes, from the same `slopesOf`, so the strip, its caption and the
 * voice still agree about what a climb is and how steep it is.
 *
 * {@link routeBands} is the same banding over the whole route, for the whole
 * route's strip (#2291's third part), and {@link gradeBand} is what colours
 * the gradient's own number (its first).
 */

import {
  GRADIENT_WINDOW_METRES,
  PROFILE_RESOLUTION_METRES,
  elevationAt,
  gradeAt,
  type RouteProfile,
} from '@onyourleft/domain';
import type { UnitSystem } from '@onyourleft/store';

import { formatSmallDistance, measurementText, spokenSmallDistanceUnit } from '../../units/format';

import {
  SLOPE_GRADE_PERCENT,
  slopeAhead,
  slopesOf,
  wholePercent,
  type Slope,
  type SlopeAhead,
} from './climb-ahead';
import { planProgress } from './plan';

/**
 * How much road ahead the strip shows, in metres — the owner's to tune
 * (#2075: *"the next ~1 km (owner-tunable constant)"*). 2 km since #2291's
 * climb view (*"the next 1–2 km"*), so most of a climb and its top are in it.
 */
export const LOOK_AHEAD_METRES = 2000;

/**
 * How much height the strip's full height stands for, in metres — the
 * **fixed** vertical scale. A 10 % grade held over the whole window rises
 * 200 m and fills it; anything steeper for that long is cut at the top, which
 * a rider reads as "steeper than the strip can say" rather than as a lie.
 * The lowest point in the window sits on the strip's floor: the picture is
 * moved, never stretched. A tenth of {@link LOOK_AHEAD_METRES}, as it was at
 * 1 km and 100 m, so a grade is the same angle on the strip it was (#2291).
 */
export const LOOK_AHEAD_RISE_METRES = LOOK_AHEAD_METRES / 10;

/** The window in words, for the strip's accessible name: "next 2 kilometres". */
export const LOOK_AHEAD_WORDS = `next ${String(LOOK_AHEAD_METRES / 1000)} kilometres`;

/** How far apart the strip's samples are, in metres: the profile's own grid. */
const SAMPLE_METRES = 10;

/** A grade band's name, for code. */
export type GradeBandKey = 'descent' | 'flat' | 'climb' | 'steep' | 'wall';

/** One grade band: where it starts, what a rider calls it, how it is drawn. */
export interface GradeBand {
  readonly key: GradeBandKey;
  /** The least grade in the band, in percent; the first band opens at −∞. */
  readonly from: number;
  /** What the band is called where it is written down. */
  readonly name: string;
  /**
   * The fill PATTERN, so a band is never told by its colour alone (SC 1.4.1):
   * `HudCore.tsx` §`LookAheadStrip` draws each one.
   */
  readonly pattern: 'dots' | 'none' | 'hatch' | 'dense-hatch' | 'cross-hatch';
}

/**
 * The five bands, gentlest down to steepest up. Their colours are the
 * `hudGrade*` tokens in `design/tokens.ts`, each a declared 3:1 against the
 * HUD's surface (SC 1.4.11).
 */
export const GRADE_BANDS: readonly GradeBand[] = [
  { key: 'descent', from: Number.NEGATIVE_INFINITY, name: 'Descent', pattern: 'dots' },
  { key: 'flat', from: -SLOPE_GRADE_PERCENT, name: 'Flat', pattern: 'none' },
  { key: 'climb', from: SLOPE_GRADE_PERCENT, name: 'Climb', pattern: 'hatch' },
  { key: 'steep', from: 6, name: 'Steep', pattern: 'dense-hatch' },
  { key: 'wall', from: 9, name: 'Very steep', pattern: 'cross-hatch' },
];

/**
 * The band a grade is in. The edge belongs to the band above it, except at
 * the descent's: −3 % is flat, as `climb-ahead.ts` has it (`grade <= −3` is a
 * descent there), so the edge is exclusive on the way down.
 */
export function gradeBand(grade: number): GradeBand {
  if (grade <= -SLOPE_GRADE_PERCENT) return GRADE_BANDS[0] as GradeBand;
  let band = GRADE_BANDS[1] as GradeBand;
  for (const each of GRADE_BANDS.slice(2)) {
    if (grade >= each.from) band = each;
  }
  return band;
}

/**
 * The shortest band either strip draws, in metres — #2291, the owner's
 * screenshots of 2026-11-06: a thin extra band at a climb's crest. A grade is
 * a slope over `GRADIENT_WINDOW_METRES`, so at a change of slope it ramps
 * across the window, and a 10 % climb's ramp crosses the climb and steep
 * bands on its way to flat: 20 to 40 m of each, at the foot and at the top,
 * which is the window's transition and not road. A band shorter than this,
 * with a band on each side, is drawn as its neighbour ({@link withoutSlivers}).
 * Half the window, so a real stretch the window can resolve stays drawn, and
 * half a sample more: the road ahead counts in 10 m samples and the whole
 * route in its grid's cells, which are up to half a metre either side of
 * 10 m, so five of either (50 m, the half window) is merged on both strips
 * and six of either is drawn on both. On the threshold itself the two strips
 * disagreed about a 6 % climb's foot.
 */
export const MINIMUM_BAND_METRES = GRADIENT_WINDOW_METRES / 2 + PROFILE_RESOLUTION_METRES / 2;

/** How far a band is from flat: the descent and the climb 1, the wall 3. */
function steepness(band: GradeBandKey): number {
  return Math.abs(GRADE_BANDS.findIndex((each) => each.key === band) - 1);
}

/** A run of one band, from `from` to `to`, in whatever unit its strip counts in. */
interface BandSpan {
  readonly band: GradeBandKey;
  readonly from: number;
  readonly to: number;
}

/**
 * The runs with every sliver merged into a neighbour — #2291. A run shorter
 * than `minimum` between two others takes the band of the neighbour further
 * from flat (the longer, when they are as far), so a climb's ramps are drawn
 * as the climb and its band ends where `slopesOf` ends it, at the top marker.
 * The shortest goes first, and neighbours left in one band are joined. The
 * first and last runs are never merged: there the strip cuts the road, and a
 * short run at its edge is the start of what lies beyond. Pure.
 */
export function withoutSlivers(spans: readonly BandSpan[], minimum: number): BandSpan[] {
  const out = [...spans];
  const length = (span: BandSpan): number => span.to - span.from;
  for (;;) {
    let shortest = -1;
    for (let index = 1; index < out.length - 1; index += 1) {
      const span = out[index] as BandSpan;
      if (
        length(span) < minimum &&
        (shortest < 0 || length(span) < length(out[shortest] as BandSpan))
      ) {
        shortest = index;
      }
    }
    if (shortest < 0) return out;
    const before = out[shortest - 1] as BandSpan;
    const after = out[shortest + 1] as BandSpan;
    const lean = steepness(before.band) - steepness(after.band);
    const band = (lean !== 0 ? lean > 0 : length(before) >= length(after))
      ? before.band
      : after.band;
    out[shortest] = { ...(out[shortest] as BandSpan), band };
    // Join every pair of neighbours now in one band.
    for (let index = out.length - 1; index > 0; index -= 1) {
      const left = out[index - 1] as BandSpan;
      const right = out[index] as BandSpan;
      if (left.band === right.band) out.splice(index - 1, 2, { ...left, to: right.to });
    }
  }
}

/** One stretch of the strip in one band, from `start` to `end` metres ahead. */
export interface LookAheadRun {
  readonly band: GradeBandKey;
  readonly start: number;
  readonly end: number;
}

/** What the strip draws. Distances are metres ahead of the rider. */
export interface LookAhead {
  /** How much road there is to draw: the window, or less where a one-way route ends. */
  readonly length: number;
  /** Each sample: how far ahead, and its height above the window's lowest point. */
  readonly points: readonly { readonly ahead: number; readonly height: number }[];
  /** The rider's own height above the window's lowest point — the left edge. */
  readonly riderHeight: number;
  /** Consecutive stretches of one band, covering 0 to {@link length}. */
  readonly runs: readonly LookAheadRun[];
  /** The next climb starting within the window, as the announcer finds it. */
  readonly nextClimb: SlopeAhead | undefined;
  /**
   * The climb the strip's caption names — #2291: the one under the rider, or
   * else {@link nextClimb} — with how far it is to its top.
   */
  readonly climb: ClimbAhead | undefined;
}

/**
 * A climb, as the climb view names it — #2291. Distances are metres ahead of
 * the rider, along the road (across the line on a loop).
 */
export interface ClimbAhead {
  /** `on`: the rider is on it now. `ahead`: it starts within the window. */
  readonly where: 'on' | 'ahead';
  /** The climb, as `slopesOf` found it: its `grade` is its average. */
  readonly slope: Slope;
  /** How far ahead it starts: 0 when the rider is on it. */
  readonly startsIn: number;
  /** How far ahead its top is: where the climb ends. */
  readonly topIn: number;
}

/** `slopesOf` is once per route (its own note); the HUD renders many times a second. */
const slopesByProfile = new WeakMap<RouteProfile, readonly Slope[]>();

function climbsOf(profile: RouteProfile): readonly Slope[] {
  let slopes = slopesByProfile.get(profile);
  if (slopes === undefined) {
    slopes = slopesOf(profile).filter((slope) => slope.kind === 'climb');
    slopesByProfile.set(profile, slopes);
  }
  return slopes;
}

/**
 * The next {@link LOOK_AHEAD_METRES} of road from `distance`, the ride's own
 * odometer (the one `profileReading` and the announcer read). Pure.
 */
export function lookAhead(profile: RouteProfile, distance: number): LookAhead {
  const total = profile.totalDistance as number;
  if (!(total > 0) || !Number.isFinite(distance) || profile.elevations.length < 2) {
    return {
      length: 0,
      points: [],
      riderHeight: 0,
      runs: [],
      nextClimb: undefined,
      climb: undefined,
    };
  }
  // A one-way route ends: past its end there is no road to draw. A loop's road
  // goes on into the next lap, which `elevationAt` reads by wrapping.
  const remaining = profile.loop ? LOOK_AHEAD_METRES : Math.max(0, total - Math.max(0, distance));
  const length = Math.min(LOOK_AHEAD_METRES, remaining);

  const raw: { ahead: number; elevation: number }[] = [];
  for (let ahead = 0; ahead < length; ahead += SAMPLE_METRES) {
    raw.push({ ahead, elevation: elevationAt(profile, distance + ahead) });
  }
  raw.push({ ahead: length, elevation: elevationAt(profile, distance + length) });
  const floor = Math.min(...raw.map((each) => each.elevation));

  const spans: BandSpan[] = [];
  for (let index = 0; index < raw.length - 1; index += 1) {
    const from = (raw[index] as { ahead: number }).ahead;
    const to = (raw[index + 1] as { ahead: number }).ahead;
    // The grade at the middle of the stretch, as the trainer would be sent it.
    const band = gradeBand(gradeAt(profile, distance + (from + to) / 2)).key;
    const open = spans.at(-1);
    if (open?.band === band) spans[spans.length - 1] = { ...open, to };
    else spans.push({ band, from, to });
  }
  const runs: LookAheadRun[] = withoutSlivers(spans, MINIMUM_BAND_METRES).map((span) => ({
    band: span.band,
    start: span.from,
    end: span.to,
  }));

  const nextClimb = slopeAhead(climbsOf(profile), profile, distance, LOOK_AHEAD_METRES);
  return {
    length,
    points: raw.map((each) => ({ ahead: each.ahead, height: each.elevation - floor })),
    riderHeight: (raw[0]?.elevation ?? floor) - floor,
    runs,
    nextClimb,
    climb: climbAhead(profile, distance, nextClimb),
  };
}

/**
 * The climb under the rider at `distance`, or else `next` — #2291. Pure.
 *
 * "Under" is the announcer's own test turned round: `slopeAhead` skips a
 * slope the rider is inside, and this is that slope. On a loop the position
 * is the wrapped one `slopeAhead` reads (`planProgress`), so a climb that
 * runs across the line (`slopesOf` joins its two halves into one) is under a
 * rider on either side of the line, and its top is reached across it.
 */
export function climbAhead(
  profile: RouteProfile,
  distance: number,
  next: SlopeAhead | undefined,
): ClimbAhead | undefined {
  const total = profile.totalDistance as number;
  if (total > 0 && Number.isFinite(distance)) {
    const on = planProgress(profile, distance) * total;
    for (const slope of climbsOf(profile)) {
      // How far into the climb the rider is: modulo the lap on a loop, where a
      // climb may start near the end of one lap and finish in the next.
      const into = profile.loop ? (((on - slope.start) % total) + total) % total : on - slope.start;
      if (into >= 0 && into < slope.length) {
        return { where: 'on', slope, startsIn: 0, topIn: slope.length - into };
      }
    }
  }
  if (next === undefined) return undefined;
  return {
    where: 'ahead',
    slope: next.slope,
    startsIn: next.metresAhead,
    topIn: next.metresAhead + next.slope.length,
  };
}

/** One stretch of the whole route in one band, in fractions of the route from 0 to 1. */
export interface RouteBandRun {
  readonly band: GradeBandKey;
  readonly from: number;
  readonly to: number;
}

/** {@link routeBands} is once per route; the HUD renders many times a second. */
const bandsByProfile = new WeakMap<RouteProfile, readonly RouteBandRun[]>();

/**
 * The whole route in grade bands — #2291, so the whole route's strip is
 * shaded by steepness as the road ahead is. Each cell of the profile's grid
 * is banded by the grade at its middle, as {@link lookAhead} bands its
 * stretches, and neighbours in one band are one run. In fractions of the
 * route, so a cell is where the whole route's strip draws it (`HudCore.tsx`
 * §`strip`: grid point `i` of `n` at `i / (n − 1)`). A band shorter than
 * {@link MINIMUM_BAND_METRES} is merged as the road ahead's is
 * ({@link withoutSlivers}). Pure, cached per profile.
 */
export function routeBands(profile: RouteProfile): readonly RouteBandRun[] {
  const cached = bandsByProfile.get(profile);
  if (cached !== undefined) return cached;
  const grades = profile.grades as readonly number[];
  const cells = grades.length - 1;
  const runs: RouteBandRun[] = [];
  for (let index = 0; index < cells; index += 1) {
    const middle = ((grades[index] as number) + (grades[index + 1] as number)) / 2;
    const band = gradeBand(middle).key;
    const from = index / cells;
    const to = (index + 1) / cells;
    const open = runs.at(-1);
    if (open?.band === band) runs[runs.length - 1] = { ...open, to };
    else runs.push({ band, from, to });
  }
  const total = profile.totalDistance as number;
  const merged = total > 0 ? withoutSlivers(runs, MINIMUM_BAND_METRES / total) : runs;
  bandsByProfile.set(profile, merged);
  return merged;
}

/**
 * The climb in a short phrase for the strip, or `undefined` when there is
 * none: `Climb in 350 m · 6 %` before it, as #2075 wrote it and the
 * announcer says it, and `Top in 420 m · 7 %` on it (#2291). The distance is
 * the rider's own unit, as everywhere on the HUD; the grade is the whole
 * climb's average, in whole percent rounded half up from the tenth the
 * gradient field shows (`climb-ahead.ts` §`wholePercent`), as the announcer
 * says it.
 *
 * ⚠️ **Before a climb its top is on the strip, not in this phrase**: a dashed
 * line where the window reaches it (`HudCore.tsx` §`LookAheadStrip`), and in
 * the strip's accessible name ({@link nextClimbLabel}). Both in one phrase,
 * `Climb in 400 m · 6 % · top in 1010 m`, is 215 px at the caption's size,
 * and on an upright phone's 246 px column it wraps under the route's
 * sentence where #2075's 125 px phrase did not. That extra line put a
 * Delivery round's map credit over the leaning rider at 360 × 752
 * (`ride-delivery.browser.spec.ts`, measured for #2291), where the layout
 * has a pixel to spare. So no phrase here is longer than #2075's was.
 */
export function nextClimbText(
  climb: ClimbAhead | undefined,
  units: UnitSystem,
): string | undefined {
  if (climb === undefined) return undefined;
  const grade = `${String(wholePercent(climb.slope.grade))} %`;
  if (climb.where === 'on') {
    return `Top in ${measurementText(formatSmallDistance(roundedAhead(climb.topIn), units))} · ${grade}`;
  }
  const start = measurementText(formatSmallDistance(roundedAhead(climb.startsIn), units));
  return `Climb in ${start} · ${grade}`;
}

/** The same, for a screen reader: the units in words, and "per cent". */
export function nextClimbLabel(climb: ClimbAhead | undefined, units: UnitSystem): string {
  if (climb === undefined) return `no climb in the ${LOOK_AHEAD_WORDS}`;
  const spoken = (metres: number): string =>
    `${formatSmallDistance(roundedAhead(metres), units).value} ${spokenSmallDistanceUnit(units)}`;
  const grade = `${String(wholePercent(climb.slope.grade))} per cent average`;
  if (climb.where === 'on') return `on a climb, top in ${spoken(climb.topIn)}, ${grade}`;
  return `next climb in ${spoken(climb.startsIn)}, ${grade}, top in ${spoken(climb.topIn)}`;
}

/** Tens of metres: "in 350 m", not "in 347 m", and never "in 0 m". */
function roundedAhead(metresAhead: number): number {
  return Math.max(SAMPLE_METRES, Math.round(metresAhead / SAMPLE_METRES) * SAMPLE_METRES);
}
