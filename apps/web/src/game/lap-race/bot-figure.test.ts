// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Why a *Brisk* bot can read 2.6 W/kg on the HUD when the chooser says Brisk
 * is 2.8 — #2329, read off the standings' own figure (`lap-race-hud.ts`
 * §`lapRaceStandings`, fed by `ride-race.ts` §`lapRaceHud`) over a real race.
 *
 * The figure is the bot's power on the tick just ridden over its fixed
 * `BOT_MASS_KILOGRAMS`: not a time average, and not drafting (a bot has no
 * draft, ADR 0061 D-4). Its tier is the race plan's average (#1960,
 * `@onyourleft/domain` §`plan.ts`), and the plan saves a little on the flat
 * and more downhill and spends it on climbs and in the sprint. Rounding alone
 * cannot make 2.6: the flat's saving is 2.66, written 2.7. So 2.6 is a bot
 * riding downhill.
 *
 * Each case holds one clause of what the chooser now says
 * (`StageChooser.tsx` §`LAP_RACE_CHOICE_TEXT.tierLive`), so a change to the
 * plan that makes those words false goes red here.
 */

import {
  BOT_PLAN_MEAN_TOLERANCE,
  BOT_TIER_WATTS_PER_KILOGRAM,
  gradeAt,
  kilograms,
  type RouteProfile,
} from '@onyourleft/domain';
import { beforeAll, describe, expect, it } from 'vitest';

import { lapRaceStandings } from '../hud/lap-race-hud';
import { DEFAULT_RIDING_POSITION, rideConditionsFor } from '../rider';
import { circuitRoute } from '../route-fixtures-testing';

import type { LapRaceChoice } from './choice';
import {
  LAP_RACE_TICK_SECONDS,
  lapRaceBotConditions,
  lapRaceHud,
  startLapRaceRide,
  stepLapRaceRide,
} from './ride-race';

const BRISK: LapRaceChoice = { laps: 5, bots: 1, tier: 'brisk', itemsOn: false };
const TIER = BOT_TIER_WATTS_PER_KILOGRAM.brisk;

/** One tick of the race as the rider reads it: the bot's figure, and where the bot was. */
interface Reading {
  /** The standings' figure for the bot, as written: `2.7 W/kg`. */
  readonly figure: string;
  /** The same figure as a number, or NaN for a dash or *Finished*. */
  readonly value: number;
  /** The grade under the bot, in percent, at its own effort distance. */
  readonly grade: number;
  /** The effort distance the bot has left to the line, metres. */
  readonly left: number;
}

/** Ride `choice` on `profile` to the bot's finish, the rider a steady 9 m/s, and read every tick. */
function ride(profile: RouteProfile, choice: LapRaceChoice = BRISK): Reading[] {
  let race = startLapRaceRide({
    choice,
    profile,
    conditions: lapRaceBotConditions(
      profile,
      rideConditionsFor(kilograms(70), DEFAULT_RIDING_POSITION),
    ),
    riderDistance: 0,
    lineOffset: 0,
    storage: undefined,
  });
  if (race === undefined) throw new Error('a loop starts a race');
  const length = race.race.course.lapLengthMetres * race.race.course.laps;
  const lap = race.race.course.lapLengthMetres;
  const readings: Reading[] = [];
  for (let tick = 1; tick < 20_000; tick += 1) {
    race = stepLapRaceRide(race, { ticks: 1, along: tick * LAP_RACE_TICK_SECONDS * 9 });
    const bot = race.race.racers.find((entry) => entry.racer.id === 'bot-1');
    if (bot === undefined) throw new Error('the bot is not in the race');
    if (bot.racer.finishedAtMs !== null) return readings;
    const line = lapRaceStandings(lapRaceHud(race, { wattsPerKilogram: 3, speed: 9 })).lines.find(
      (each) => !each.you,
    );
    const effort = bot.racer.effortDistance;
    readings.push({
      figure: line?.figure ?? '',
      value: Number.parseFloat(line?.figure ?? ''),
      grade: gradeAt(profile, effort % lap),
      left: length - effort,
    });
  }
  throw new Error('the bot did not finish');
}

/** A flat loop of about 630 m: five laps, about six minutes for a Brisk bot. */
const FLAT = circuitRoute(100, () => 0);

/** A loop of about 1.26 km rising and falling 15 m: grades to about ±7.5 %. */
const HILLY = circuitRoute(
  200,
  (along) => 15 * Math.sin((along / (2 * Math.PI * 200)) * 2 * Math.PI),
);

describe('a Brisk bot’s W/kg on the HUD, against its tier — #2329', () => {
  let flat: Reading[] = [];
  let hilly: Reading[] = [];
  beforeAll(() => {
    flat = ride(FLAT);
    hilly = ride(HILLY);
  });

  it('fixture: the flat loop is flat and the hilly loop climbs and falls past 2 %', () => {
    expect(flat.every((reading) => reading.grade === 0)).toBe(true);
    expect(Math.max(...hilly.map((reading) => reading.grade))).toBeGreaterThan(5);
    expect(Math.min(...hilly.map((reading) => reading.grade))).toBeLessThan(-5);
  });

  it('saves a little on the flat: 2.7, not its tier’s 2.8, while its reserve fills', () => {
    const early = flat.slice(1, 200).map((reading) => reading.figure);
    expect(new Set(early)).toEqual(new Set(['2.7 W/kg']));
  });

  it('rides its tier on the flat once the reserve is full: the HUD then reads 2.8', () => {
    const steady = flat.filter((reading) => reading.left > 400).at(-1);
    expect(steady?.figure).toBe(`${TIER.toFixed(1)} W/kg`);
  });

  it('saves more downhill: 2.6 and below on a descent, which rounding alone cannot make', () => {
    const descending = hilly.filter((reading) => reading.grade < -2 && reading.left > 400);
    expect(descending.length).toBeGreaterThan(0);
    const below = descending.filter((reading) => reading.value <= 2.6);
    expect(below.length).toBeGreaterThan(descending.length / 2);
    expect(hilly.map((reading) => reading.figure)).toContain('2.6 W/kg');
  });

  it('spends it on climbs and in the final sprint: above its tier', () => {
    const climbing = hilly.filter((reading) => reading.grade > 2 && reading.left > 400);
    expect(climbing.some((reading) => reading.value > TIER)).toBe(true);
    const sprint = flat.filter((reading) => reading.left < 150);
    expect(sprint.length).toBeGreaterThan(0);
    expect(sprint.some((reading) => reading.value > TIER)).toBe(true);
  });

  it('averages about its tier over the race: never above it, and within the plan’s tolerance', () => {
    for (const readings of [flat, hilly]) {
      const values = readings.map((reading) => reading.value).filter(Number.isFinite);
      const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
      // Each figure is rounded to 0.1, so the mean may sit 0.05 either side.
      expect(mean).toBeLessThanOrEqual(TIER + 0.05);
      expect(mean).toBeGreaterThanOrEqual(TIER * (1 - BOT_PLAN_MEAN_TOLERANCE) - 0.05);
    }
  });
});
