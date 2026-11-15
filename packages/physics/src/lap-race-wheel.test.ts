// SPDX-License-Identifier: Apache-2.0

/**
 * #2542, pack riding step 1: a lap-race bot sitting in holds a wheel
 * 0.3–1 m back, behind the rider or a bot, on the flat and up a climb, and
 * lets it go when its W′ will not pay for it (ADR 0067 D-1, D-3).
 *
 * Seeded races through `stepBotRace` and the one `advance`, the field drafting;
 * every gap read back off the race's own effort distances, as the draft reads
 * them. No case sets its own timeout (#1688).
 */

import { describe, expect, it } from 'vitest';

import type {
  BotPace,
  BotTactic,
  ItemRaceState,
  RouteProfile,
  RoutePoint,
} from '@onyourleft/domain';
import {
  altitudeMetres,
  BOT_MASS_KILOGRAMS,
  BOT_TACTIC_WHEEL_FURTHEST_METRES,
  BOT_TACTIC_WHEEL_NEAREST_METRES,
  botRacePlan,
  botTierPlan,
  createItemRace,
  degreesCelsius,
  degreesLatitude,
  degreesLongitude,
  distanceOnRoute,
  geographicPosition,
  gradeAt,
  gradePercent,
  kilograms,
  metres,
  metresPerSecond,
  raceCourse,
  routeProfile,
  seconds,
  watts,
} from '@onyourleft/domain';

import { airDensityKilogramsPerCubicMetre } from './air';
import { withDefaultCoefficients, withDragArea } from './coefficients';
import { lapRaceBot, stepBotRace, type LapRaceBot } from './lap-race-bot';
import { steadyStateSpeedMetresPerSecond } from './power';
import { advance, type RideState } from './simulate';

const AIR = airDensityKilogramsPerCubicMetre(altitudeMetres(0), degreesCelsius(15));

/**
 * An out-and-back, a loop: `flat` metres level, then `climb` metres up at
 * `risePercent`, and the same back down.
 */
function outAndBack(flat: number, climb: number, risePercent: number): RouteProfile {
  const step = 20;
  const out: number[] = [];
  for (let along = 0; along <= flat + climb; along += step) out.push(along);
  const points: RoutePoint[] = [...out, ...out.slice(0, -1).reverse()].map((along) => ({
    position: geographicPosition(degreesLatitude(51.5 + along / 111_320), degreesLongitude(-0.12)),
    elevation: altitudeMetres((Math.max(0, along - flat) * risePercent) / 100),
  }));
  return routeProfile(points, { loop: true });
}

const FLAT = outAndBack(2_000, 0, 0);
/** 600 m of flat to settle on the wheel, then 1.6 km up at 5 %. */
const CLIMB = outAndBack(600, 1_600, 5);

/** A sprinter: its archetype sits in early rather than attack (#2459). */
const SPRINTER: BotPace = { style: 'sprinter', ability: 1 };
const STRATEGY = { personality: 'opportunist', skill: 'crafty' } as const;
const LAPS = 10;
const MASS = kilograms(botTierPlan('brisk').massKilograms);

/** A rouleur: its archetype follows a move rather than sit in (#2459). */
const ROULEUR: BotPace = { style: 'even', ability: 1 };

/** A brisk bot's CP on `profile`'s race, as its plan builds it: the sprinter's when not given. */
function cpOn(profile: RouteProfile, seed: number, pace: BotPace = SPRINTER): number {
  return botRacePlan('brisk', raceCourse(profile.totalDistance, LAPS), seed, pace).capacity.cpWatts;
}

/** The speed `powerWatts` holds on the flat, alone. */
function flatSpeed(powerWatts: number): number {
  return steadyStateSpeedMetresPerSecond({
    powerWatts,
    totalMass: MASS,
    grade: gradePercent(0),
    airDensityKilogramsPerCubicMetre: AIR,
  });
}

interface Sample {
  readonly second: number;
  /** The racer ahead's effort distance less the bot's, metres. */
  readonly gap: number;
  readonly tactic: BotTactic;
  readonly wbalShare: number;
  readonly exhausted: boolean;
}

/**
 * A bot on a wheel for `duration` seconds at ticks of `tick` seconds: behind
 * the rider, ridden through the one `advance` at a steady `riderWatts` from
 * its flat speed, the bot level with them at that speed; or, with no rider,
 * behind a second bot of its tier and pace riding its own race from rest.
 */
function onAWheel(options: {
  readonly profile: RouteProfile;
  readonly seed: number;
  readonly duration: number;
  readonly tick?: number;
  readonly riderWatts?: number;
  /** The follower's pace: the sprinter's when not given. */
  readonly pace?: BotPace;
}): Sample[] {
  const { profile, seed, duration, riderWatts } = options;
  const pace = options.pace ?? SPRINTER;
  const tick = options.tick ?? 1;
  const ahead = riderWatts === undefined ? 'a-lead' : 'a-rider';
  let race: ItemRaceState = createItemRace({
    course: raceCourse(profile.totalDistance, LAPS),
    seed,
    itemsOn: false,
    racerIds: [ahead, 'wheel'],
    startMs: 0,
  });
  const follower = lapRaceBot('wheel', 'brisk', STRATEGY, pace);
  const start: RideState = {
    distance: metres(0),
    speed: metresPerSecond(riderWatts === undefined ? 0 : flatSpeed(riderWatts)),
  };
  let bots: readonly LapRaceBot[] =
    riderWatts === undefined
      ? [lapRaceBot('a-lead', 'brisk', STRATEGY, SPRINTER), follower]
      : [{ ...follower, ride: start }];
  let rider = start;
  let riderK = 1;
  const base = withDefaultCoefficients(undefined);
  const samples: Sample[] = [];
  const ticks = Math.round(duration / tick);
  for (let at = 1; at <= ticks; at += 1) {
    if (riderWatts !== undefined) {
      rider = advance(
        rider,
        {
          power: watts(riderWatts),
          grade: gradeAt(profile, distanceOnRoute(profile, rider.distance)),
          duration: seconds(tick),
        },
        {
          totalMass: MASS,
          airDensityKilogramsPerCubicMetre: AIR,
          coefficients: withDragArea(riderK * base.dragCoefficient * base.frontalAreaSquareMetres),
        },
      );
    }
    const next = stepBotRace(race, bots, {
      elapsed: seconds(tick),
      conditions: { profile, airDensityKilogramsPerCubicMetre: AIR },
      seed,
      draft: true,
      ...(riderWatts === undefined
        ? {}
        : {
            rider: { effortDistances: { [ahead]: rider.distance } },
            riderWattsPerKilogram: riderWatts / BOT_MASS_KILOGRAMS,
          }),
    });
    race = next.race;
    bots = next.bots;
    riderK = next.draft?.[ahead] ?? 1;
    const of = (id: string): number =>
      race.racers.find((entry) => entry.racer.id === id)?.racer.effortDistance ?? Number.NaN;
    const wheel = bots.find((bot) => bot.id === 'wheel') as LapRaceBot;
    const plan = wheel.plan;
    samples.push({
      second: at * tick,
      gap: of(ahead) - of('wheel'),
      tactic: wheel.tactics.tactic,
      wbalShare: plan === undefined ? 1 : wheel.energy.wbalJoules / plan.capacity.wPrimeJoules,
      exhausted: wheel.energy.exhausted,
    });
  }
  return samples;
}

/** Whether every sample from `from` seconds on sits 0.3–1 m back. */
function heldFrom(samples: readonly Sample[], from: number): Sample[] {
  return samples.filter(
    (sample) =>
      sample.second >= from &&
      !(
        sample.gap >= BOT_TACTIC_WHEEL_NEAREST_METRES &&
        sample.gap <= BOT_TACTIC_WHEEL_FURTHEST_METRES
      ),
  );
}

const SEEDS = [1, 2, 3, 4, 5];

describe('a bot sitting in holds a wheel 0.3–1 m back (#2542)', () => {
  it('converges on the rider’s wheel within 30 s on the flat and holds it for 5 minutes, every seed', () => {
    for (const seed of SEEDS) {
      const samples = onAWheel({
        profile: FLAT,
        seed,
        duration: 330,
        riderWatts: cpOn(FLAT, seed),
      });
      expect(
        samples.every((sample) => sample.tactic === 'sit-in' || sample.tactic === 'follow'),
        String(seed),
      ).toBe(true);
      expect(heldFrom(samples, 30), String(seed)).toEqual([]);
    }
  });

  it('holds the rider’s wheel onto a 5 % climb and up it, every seed', () => {
    for (const seed of SEEDS) {
      // 600 m of flat, then about 5 minutes up the climb at the rider's CP.
      const samples = onAWheel({
        profile: CLIMB,
        seed,
        duration: 330,
        riderWatts: cpOn(CLIMB, seed),
      });
      expect(heldFrom(samples, 30), String(seed)).toEqual([]);
    }
  });

  it('holds a bot’s wheel from a standing start, the bot ahead riding its own race, every seed', () => {
    for (const seed of SEEDS) {
      const samples = onAWheel({ profile: FLAT, seed, duration: 300 });
      expect(heldFrom(samples, 60), String(seed)).toEqual([]);
    }
  });

  it('holds it at a 50 ms tick as at a 1 s one', () => {
    const samples = onAWheel({
      profile: FLAT,
      seed: 1,
      duration: 120,
      tick: 0.05,
      riderWatts: cpOn(FLAT, 1),
    });
    expect(heldFrom(samples, 30)).toEqual([]);
  });

  it('following a move, spends W′ on the wheel and lets it go only when its W′ will not pay, every seed', () => {
    for (const seed of SEEDS) {
      // The rider in a move, on a wheel that costs more than CP even in its draft.
      const samples = onAWheel({
        profile: FLAT,
        seed,
        duration: 450,
        riderWatts: 1.7 * cpOn(FLAT, seed, ROULEUR),
        pace: ROULEUR,
      });
      const gone = samples.findIndex(
        (sample) => sample.second >= 30 && sample.gap > BOT_TACTIC_WHEEL_FURTHEST_METRES,
      );
      expect(gone, String(seed)).toBeGreaterThan(60);
      // Following it while its W′ lasts, then recovering.
      expect(
        samples
          .slice(0, gone)
          .every((sample) => sample.tactic === 'follow' || sample.wbalShare < 0.2),
        String(seed),
      ).toBe(true);
      // Held while it paid: the gap in the band, W′ spent on it to under a tenth.
      expect(heldFrom(samples.slice(0, gone), 30), String(seed)).toEqual([]);
      expect((samples[gone] as Sample).wbalShare, String(seed)).toBeLessThan(0.1);
      // Then gone: 10 m back and more by the end.
      const last = samples[samples.length - 1] as Sample;
      expect(last.gap, String(seed)).toBeGreaterThan(10 * BOT_TACTIC_WHEEL_FURTHEST_METRES);
    }
  });

  it('sitting in, spends no W′ on a wheel that costs more than CP: it lets it go, every seed', () => {
    for (const seed of SEEDS) {
      const samples = onAWheel({
        profile: FLAT,
        seed,
        duration: 120,
        riderWatts: 1.9 * cpOn(FLAT, seed),
      });
      expect(
        samples.every((sample) => sample.tactic === 'sit-in'),
        String(seed),
      ).toBe(true);
      expect(Math.min(...samples.map((sample) => sample.wbalShare)), String(seed)).toBeGreaterThan(
        0.99,
      );
      const last = samples[samples.length - 1] as Sample;
      expect(last.gap, String(seed)).toBeGreaterThan(10 * BOT_TACTIC_WHEEL_FURTHEST_METRES);
    }
  });
});
