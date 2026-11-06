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
 */

import { elevationAt, gradeAt, type RouteProfile } from '@onyourleft/domain';
import type { UnitSystem } from '@onyourleft/store';

import { formatSmallDistance, measurementText, spokenSmallDistanceUnit } from '../../units/format';

import {
  SLOPE_GRADE_PERCENT,
  slopeAhead,
  slopesOf,
  type Slope,
  type SlopeAhead,
} from './climb-ahead';

/**
 * How much road ahead the strip shows, in metres — the owner's to tune
 * (#2075: *"the next ~1 km (owner-tunable constant)"*).
 */
export const LOOK_AHEAD_METRES = 1000;

/**
 * How much height the strip's full height stands for, in metres — the
 * **fixed** vertical scale. A 10 % grade held over the whole window rises
 * 100 m and fills it; anything steeper for that long is cut at the top, which
 * a rider reads as "steeper than the strip can say" rather than as a lie.
 * The lowest point in the window sits on the strip's floor: the picture is
 * moved, never stretched.
 */
export const LOOK_AHEAD_RISE_METRES = 100;

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
    return { length: 0, points: [], riderHeight: 0, runs: [], nextClimb: undefined };
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

  const runs: LookAheadRun[] = [];
  for (let index = 0; index < raw.length - 1; index += 1) {
    const start = (raw[index] as { ahead: number }).ahead;
    const end = (raw[index + 1] as { ahead: number }).ahead;
    // The grade at the middle of the stretch, as the trainer would be sent it.
    const band = gradeBand(gradeAt(profile, distance + (start + end) / 2)).key;
    const open = runs.at(-1);
    if (open?.band === band) runs[runs.length - 1] = { ...open, end };
    else runs.push({ band, start, end });
  }

  return {
    length,
    points: raw.map((each) => ({ ahead: each.ahead, height: each.elevation - floor })),
    riderHeight: (raw[0]?.elevation ?? floor) - floor,
    runs,
    nextClimb: slopeAhead(climbsOf(profile), profile, distance, LOOK_AHEAD_METRES),
  };
}

/**
 * The next climb in a short phrase for the strip — `Climb in 350 m · 6 %` —
 * or `undefined` when none starts within the window. The distance is the
 * rider's own unit, as everywhere on the HUD; the grade is whole percent, as
 * the announcer says it.
 */
export function nextClimbText(
  ahead: SlopeAhead | undefined,
  units: UnitSystem,
): string | undefined {
  if (ahead === undefined) return undefined;
  const distance = measurementText(formatSmallDistance(roundedAhead(ahead.metresAhead), units));
  return `Climb in ${distance} · ${String(Math.round(Math.abs(ahead.slope.grade)))} %`;
}

/** The same, for a screen reader: the units in words, and "per cent". */
export function nextClimbLabel(ahead: SlopeAhead | undefined, units: UnitSystem): string {
  if (ahead === undefined) return 'no climb in the next kilometre';
  const distance = `${formatSmallDistance(roundedAhead(ahead.metresAhead), units).value} ${spokenSmallDistanceUnit(units)}`;
  return `next climb in ${distance}, ${String(Math.round(Math.abs(ahead.slope.grade)))} per cent average`;
}

/** Tens of metres: "in 350 m", not "in 347 m", and never "in 0 m". */
function roundedAhead(metresAhead: number): number {
  return Math.max(SAMPLE_METRES, Math.round(metresAhead / SAMPLE_METRES) * SAMPLE_METRES);
}
