// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #3309's harness: **a ride's scores**, from its record (`ride.ts`). Pure:
 * the same record gives the same scores. Every score is a number, `null`
 * where the ride has none to give (an average for a ride cut before the
 * finish), and rounded ({@link SCORE_DECIMALS}) so the file and the table
 * read alike.
 *
 * The issue's five:
 *
 * - **cohesion**: the share of decision windows with every gap of the line
 *   inside {@link COHESION_BAND_METRES};
 * - **rotations**: how many times the front of the line changed, and the
 *   rider's own turns on it;
 * - **cues a minute**, and the corrections among them, said or kept as a
 *   quiet mark;
 * - **beyond the reach**: seconds the rider spent further than the draft's
 *   reach behind the nearest member ahead;
 * - **the average made**: the group's over the course against the one asked.
 *
 * And the four of the owner's note on #3309 (2026-11-28):
 *
 * 1. after a rejoin, how far the rider slips in the next
 *    {@link REJOIN_WATCH_SECONDS}, while the gap's long mean settles;
 * 2. at a crawl (the group under {@link CRAWL_MPS}), how often every gap is
 *    still inside the band;
 * 3. how often `past-front` is said or marked, a minute;
 * 4. the least and the most the group's speed is while it rotates.
 */

import {
  CUE_CORRECTION_KINDS,
  NO_DROP_GAPPED_METRES,
  NO_DROP_PACE_MEMORY_SECONDS,
  ROTATION_RIDER_WHEEL_BAND_METRES,
  type CueCorrectionKind,
  type RiderRole,
} from '@onyourleft/domain';
import { DRAFT_REACH_METRES } from '@onyourleft/physics';

import { GROUP_RIDE_RIDER_ID } from '../../src/game/group-ride/ride-group';

import type { RideRecord, WindowSample } from './ride';

/** The band every gap of a cohesive line is inside, metres: the rider's wheel band, **5 m**. */
export const COHESION_BAND_METRES = ROTATION_RIDER_WHEEL_BAND_METRES;

/** How long after a rejoin a slip is watched, seconds: the gap's long mean, **120 s**. */
export const REJOIN_WATCH_SECONDS = NO_DROP_PACE_MEMORY_SECONDS;

/** A group under this speed is at a crawl, m/s: the owner's note (2), **2.5 m/s**. */
export const CRAWL_MPS = 2.5;

/** Decimal places a score keeps. */
export const SCORE_DECIMALS = 3;

/** A ride's scores. */
export interface RideScore {
  /** Ride time to the rider's finish, or to where the ride was cut, minutes. */
  readonly minutes: number;
  /** Whether the rider reached the finish. */
  readonly finished: boolean;
  readonly cohesion: number;
  readonly rotations: number;
  readonly riderPulls: number;
  /** The rider's longest unbroken time on the front, seconds. */
  readonly riderLongestPullSeconds: number;
  readonly presses: number;
  readonly cuesPerMinute: number;
  /** Corrections said or kept as a quiet mark, by kind. */
  readonly corrections: Readonly<Record<CueCorrectionKind, number>>;
  /** Every correction said or marked, all kinds. */
  readonly correctionsAll: number;
  readonly beyondReachSeconds: number;
  readonly longestBeyondReachSeconds: number;
  /** The group's average over the course, km/h: its first member to the finish. */
  readonly groupAverageKmh: number | null;
  readonly riderAverageKmh: number | null;
  /** The group's average against the one asked, percent: under 0 is slower. */
  readonly averageOffPercent: number | null;
  /** How far the rider was behind the nearest member ahead as they finished, metres. */
  readonly finishBehindM: number | null;
  readonly rejoins: number;
  /** The furthest the rider was behind in the {@link REJOIN_WATCH_SECONDS} after any rejoin, metres. */
  readonly afterRejoinMostBehindM: number;
  /** Seconds the rider was further back than gapped in those windows. */
  readonly afterRejoinGappedSeconds: number;
  readonly crawlSeconds: number;
  /** Cohesion at a crawl; `null` with no crawl. */
  readonly crawlCohesion: number | null;
  readonly pastFrontPerMinute: number;
  /** The least and most the group's speed was while it rotated (not forming, waiting or regrouping), km/h. */
  readonly groupSpeedLeastKmh: number;
  readonly groupSpeedMostKmh: number;
}

const rounded = (value: number): number => {
  const scale = 10 ** SCORE_DECIMALS;
  const out = Math.round(value * scale) / scale;
  return Object.is(out, -0) ? 0 : out;
};

const roundedOrNull = (value: number | null): number | null =>
  value === null ? null : rounded(value);

const ADRIFT: readonly RiderRole[] = ['gapped', 'off-the-back'];

/** The longest run of consecutive windows that `test` holds for, in windows. */
function longestRun(
  windows: readonly WindowSample[],
  test: (each: WindowSample) => boolean,
): number {
  let longest = 0;
  let run = 0;
  for (const each of windows) {
    run = test(each) ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  return longest;
}

/** The seconds of each rejoin: a window off the wheel and the next one back on it. */
export function rejoinsOf(windows: readonly WindowSample[]): readonly number[] {
  const at: number[] = [];
  for (let index = 1; index < windows.length; index += 1) {
    const before = windows[index - 1] as WindowSample;
    const now = windows[index] as WindowSample;
    if (ADRIFT.includes(before.role) && !ADRIFT.includes(now.role)) at.push(now.seconds);
  }
  return at;
}

/** `record` scored. */
export function scoreRide(record: RideRecord): RideScore {
  const { windows } = record;
  const count = Math.max(1, windows.length);
  const endSeconds = record.riderFinishSeconds ?? windows.at(-1)?.seconds ?? 0;
  const minutes = endSeconds / 60;
  const perMinute = (value: number): number => (minutes > 0 ? value / minutes : 0);
  const inBand = (each: WindowSample): boolean => each.widestGapM <= COHESION_BAND_METRES;

  let rotations = 0;
  let riderPulls = 0;
  for (let index = 1; index < windows.length; index += 1) {
    const before = windows[index - 1] as WindowSample;
    const now = windows[index] as WindowSample;
    if (now.front !== before.front) {
      rotations += 1;
      if (now.front === GROUP_RIDE_RIDER_ID) riderPulls += 1;
    }
  }
  if (windows[0]?.front === GROUP_RIDE_RIDER_ID) riderPulls += 1;

  const corrections = Object.fromEntries(
    CUE_CORRECTION_KINDS.map((kind) => [
      kind,
      record.cues.filter((each) => each.kind === kind).length + record.marks[kind],
    ]),
  ) as Record<CueCorrectionKind, number>;
  const correctionsAll = CUE_CORRECTION_KINDS.reduce((sum, kind) => sum + corrections[kind], 0);

  const beyond = (each: WindowSample): boolean => each.behindM > DRAFT_REACH_METRES;

  const groupAverageMps =
    record.groupFinishSeconds === null ? null : record.courseMetres / record.groupFinishSeconds;
  const riderAverageMps =
    record.riderFinishSeconds === null ? null : record.courseMetres / record.riderFinishSeconds;
  const targetMps = record.targetKmh / 3.6;

  const rejoins = rejoinsOf(windows);
  const watched = windows.filter((each) =>
    rejoins.some((at) => each.seconds > at && each.seconds <= at + REJOIN_WATCH_SECONDS),
  );

  const crawl = windows.filter((each) => each.groupSpeedMps < CRAWL_MPS);
  const rotating = windows.filter(
    (each) => each.phase === 'steady' || each.phase === 'changing' || each.phase === 'latching',
  );
  const speeds = (rotating.length > 0 ? rotating : windows).map((each) => each.groupSpeedMps * 3.6);

  return {
    minutes: rounded(minutes),
    finished: record.riderFinishSeconds !== null,
    cohesion: rounded(windows.filter(inBand).length / count),
    rotations,
    riderPulls,
    riderLongestPullSeconds: longestRun(windows, (each) => each.role === 'on-front'),
    presses: record.presses,
    cuesPerMinute: rounded(perMinute(record.cues.length)),
    corrections,
    correctionsAll,
    beyondReachSeconds: windows.filter(beyond).length,
    longestBeyondReachSeconds: longestRun(windows, beyond),
    groupAverageKmh: roundedOrNull(groupAverageMps === null ? null : groupAverageMps * 3.6),
    riderAverageKmh: roundedOrNull(riderAverageMps === null ? null : riderAverageMps * 3.6),
    averageOffPercent: roundedOrNull(
      groupAverageMps === null ? null : ((groupAverageMps - targetMps) / targetMps) * 100,
    ),
    finishBehindM: roundedOrNull(record.finishBehindM),
    rejoins: rejoins.length,
    afterRejoinMostBehindM: rounded(Math.max(0, ...watched.map((each) => each.behindM))),
    afterRejoinGappedSeconds: watched.filter((each) => each.behindM > NO_DROP_GAPPED_METRES).length,
    crawlSeconds: crawl.length,
    crawlCohesion: crawl.length === 0 ? null : rounded(crawl.filter(inBand).length / crawl.length),
    pastFrontPerMinute: rounded(perMinute(corrections['past-front'])),
    groupSpeedLeastKmh: speeds.length === 0 ? 0 : rounded(Math.min(...speeds)),
    groupSpeedMostKmh: speeds.length === 0 ? 0 : rounded(Math.max(...speeds)),
  };
}
