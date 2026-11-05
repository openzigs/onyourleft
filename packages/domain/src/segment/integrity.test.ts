// SPDX-License-Identifier: Apache-2.0

/**
 * The automatic exclusion rule (#69), and **its detection rate measured
 * against a labelled fixture set** — #69's third criterion: *"Detection works"
 * is not a result.*
 *
 * ⚠️ **The set is synthetic and labelled by construction**, each case written
 * from what it is rather than from what the rule says: a car on a motorway, a
 * GPS jump, a time edited by a factor. It is not a sample of real uploads, and
 * no claim is made that real uploads divide the same way; what it pins is
 * which kinds of cheat the rule can and cannot see, and that it excludes no
 * genuine effort in the set.
 */

import { describe, expect, it } from 'vitest';

import { metres, seconds } from '../quantities';

import {
  IMPLAUSIBLE_SPEED_METRES_PER_SECOND,
  impliedSpeed,
  implausibleEffort,
  MEASURED_DETECTION,
} from './integrity';
import type { SegmentSport } from './segment';

interface Labelled {
  readonly what: string;
  readonly sport: SegmentSport;
  readonly distance: number;
  readonly elapsed: number;
  /** The ground truth, from what the case IS: could a person have done this? */
  readonly impossible: boolean;
}

/** `distance` metres at `speed` metres a second: the elapsed time. */
const at = (distance: number, speed: number): number => distance / speed;

const LABELLED: readonly Labelled[] = [
  // --- Impossible, by what each one is -------------------------------------
  {
    what: 'a car on a motorway, recorded as a ride',
    sport: 'ride',
    distance: 1200,
    elapsed: at(1200, 31),
    impossible: true,
  },
  {
    what: 'a car on a dual carriageway, recorded as a ride',
    sport: 'ride',
    distance: 1500,
    elapsed: at(1500, 27),
    impossible: true,
  },
  {
    what: 'a car in town, recorded as a ride',
    sport: 'ride',
    distance: 900,
    elapsed: at(900, 14),
    impossible: true,
  },
  {
    what: 'a train, recorded as a ride',
    sport: 'ride',
    distance: 3000,
    elapsed: at(3000, 45),
    impossible: true,
  },
  { what: 'a GPS jump: 800 m in 3 s', sport: 'ride', distance: 800, elapsed: 3, impossible: true },
  {
    what: 'a 40 km/h effort with its time halved by hand',
    sport: 'ride',
    distance: 1000,
    elapsed: at(1000, 11) / 2,
    impossible: true,
  },
  {
    what: 'a 40 km/h effort with its time quartered by hand',
    sport: 'ride',
    distance: 1000,
    elapsed: at(1000, 11) / 4,
    impossible: true,
  },
  {
    what: 'a motorbike up a climb, recorded as a ride',
    sport: 'ride',
    distance: 2000,
    elapsed: at(2000, 25),
    impossible: true,
  },
  {
    what: 'a bicycle commute recorded as a run, at 32 km/h',
    sport: 'run',
    distance: 1000,
    elapsed: at(1000, 9),
    impossible: true,
  },
  {
    what: 'a bicycle commute recorded as a run, at 43 km/h',
    sport: 'run',
    distance: 1000,
    elapsed: at(1000, 12),
    impossible: true,
  },
  {
    what: 'a car, recorded as a run',
    sport: 'run',
    distance: 1500,
    elapsed: at(1500, 20),
    impossible: true,
  },
  {
    what: 'a GPS jump on a run: 400 m in 10 s',
    sport: 'run',
    distance: 400,
    elapsed: 10,
    impossible: true,
  },
  {
    what: 'a 4 m/s run with its time cut to a third by hand',
    sport: 'run',
    distance: 1000,
    elapsed: at(1000, 4) / 3,
    impossible: true,
  },
  // --- Genuine ------------------------------------------------------------
  { what: 'a climb', sport: 'ride', distance: 2000, elapsed: at(2000, 4), impossible: false },
  { what: 'a commute', sport: 'ride', distance: 1000, elapsed: at(1000, 7), impossible: false },
  {
    what: 'a fast group ride',
    sport: 'ride',
    distance: 1500,
    elapsed: at(1500, 12),
    impossible: false,
  },
  {
    what: 'a solo time trial',
    sport: 'ride',
    distance: 3000,
    elapsed: at(3000, 14.5),
    impossible: false,
  },
  {
    what: 'a professional sprint finish',
    sport: 'ride',
    distance: 400,
    elapsed: at(400, 19),
    impossible: false,
  },
  {
    what: 'a fast descent',
    sport: 'ride',
    distance: 1200,
    elapsed: at(1200, 22),
    impossible: false,
  },
  {
    what: 'an alpine descent at 94 km/h',
    sport: 'ride',
    distance: 1800,
    elapsed: at(1800, 26),
    impossible: false,
  },
  { what: 'a walk', sport: 'run', distance: 500, elapsed: at(500, 1.4), impossible: false },
  { what: 'a jog', sport: 'run', distance: 1000, elapsed: at(1000, 3), impossible: false },
  {
    what: 'marathon pace',
    sport: 'run',
    distance: 2000,
    elapsed: at(2000, 5.5),
    impossible: false,
  },
  {
    what: 'a world-class 400 m',
    sport: 'run',
    distance: 400,
    elapsed: at(400, 9),
    impossible: false,
  },
  {
    what: 'a downhill sprint',
    sport: 'run',
    distance: 400,
    elapsed: at(400, 9.8),
    impossible: false,
  },
];

const excluded = (each: Labelled): boolean =>
  implausibleEffort(each.sport, metres(each.distance), seconds(each.elapsed)) !== undefined;

describe('the implied-speed rule (#69)', () => {
  it('excludes above the sport’s ceiling and not at it', () => {
    for (const sport of ['ride', 'run'] as const) {
      const ceiling = IMPLAUSIBLE_SPEED_METRES_PER_SECOND[sport];
      // Exactly at it: ten seconds over ten times the ceiling, which divides back exactly.
      expect(
        implausibleEffort(sport, metres(Math.round(ceiling * 10)), seconds(10)),
      ).toBeUndefined();
      expect(implausibleEffort(sport, metres(1000), seconds(1000 / (ceiling + 0.01)))).toEqual({
        rule: 'implied-speed',
        impliedSpeedMetresPerSecond: expect.closeTo(ceiling + 0.01, 6) as number,
        ceilingMetresPerSecond: ceiling,
      });
    }
    // A run's ceiling is a ride's speed: the same effort, the other sport.
    expect(implausibleEffort('ride', metres(1000), seconds(1000 / 12))).toBeUndefined();
    expect(implausibleEffort('run', metres(1000), seconds(1000 / 12))).toBeDefined();
  });

  it('calls a time of nothing impossible, rather than dividing by it', () => {
    expect(impliedSpeed(metres(500), seconds(0))).toBe(Number.POSITIVE_INFINITY);
    expect(implausibleEffort('ride', metres(500), seconds(0))).toBeDefined();
  });

  it('states its thresholds: 100 km/h for a ride, 10.5 m/s for a run', () => {
    expect(IMPLAUSIBLE_SPEED_METRES_PER_SECOND).toEqual({ ride: 27.8, run: 10.5 });
    expect(IMPLAUSIBLE_SPEED_METRES_PER_SECOND.ride * 3.6).toBeCloseTo(100, 0);
  });
});

describe('measured against the labelled set (#69’s third criterion)', () => {
  const impossible = LABELLED.filter((each) => each.impossible);
  const genuine = LABELLED.filter((each) => !each.impossible);

  it('catches what MEASURED_DETECTION says, and excludes no genuine effort', () => {
    expect(impossible).toHaveLength(MEASURED_DETECTION.impossible);
    expect(genuine).toHaveLength(MEASURED_DETECTION.genuine);
    expect(impossible.filter(excluded)).toHaveLength(MEASURED_DETECTION.caught);
    expect(genuine.filter(excluded)).toHaveLength(MEASURED_DETECTION.falselyExcluded);
    // 61.5%: the number the PR and docs/leaderboard-integrity.md record.
    expect((MEASURED_DETECTION.caught / MEASURED_DETECTION.impossible) * 100).toBeCloseTo(61.5, 1);
  });

  it('misses exactly the cheats that stay under a ceiling — the ceiling, stated', () => {
    expect(impossible.filter((each) => !excluded(each)).map((each) => each.what)).toEqual([
      'a car on a dual carriageway, recorded as a ride',
      'a car in town, recorded as a ride',
      'a 40 km/h effort with its time halved by hand',
      'a motorbike up a climb, recorded as a ride',
      'a bicycle commute recorded as a run, at 32 km/h',
    ]);
  });
});
