// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Why a *Brisk* bot can read 2.6 W/kg on the HUD when the chooser says Brisk
 * is 2.8 — #2329, read off the standings' own figure (`lap-race-hud.ts`
 * §`lapRaceStandings`, fed by `ride-race.ts` §`lapRaceHud`) over a real race.
 *
 * The figure is the bot's power on the tick just ridden over its fixed
 * `BOT_MASS_KILOGRAMS`: not a time average, and not drafting (a bot has no
 * draft, ADR 0061 D-4). Since #2458 its tier is what it can hold, its CP
 * (`@onyourleft/domain` §`plan.ts`, ADR 0067 D-1): it holds that on the flat,
 * eases under it downhill, spends a W′ above it on climbs and in the sprint,
 * and once the W′ is spent it holds its CP until it has recovered some
 * (§`wbal.ts`). Before #2458 the plan banked a reserve 5 % under the tier on
 * the flat, and that saving is gone.
 *
 * Since #2455 each bot also rides its own ability, at or a little under its
 * tier, so those figures are now its own: the race here pins a seed that
 * deals its one bot the even pace and reads the figures against its own W/kg.
 * In a live race a Brisk bot at ability 0.94 reads 2.6 on the flat.
 *
 * Each case holds one clause of what the chooser now says
 * (`StageChooser.tsx` §`LAP_RACE_CHOICE_TEXT.tierLive`), so a change to the
 * plan that makes those words false goes red here.
 */

import {
  BOT_ABILITY_SPREAD,
  BOT_TIER_WATTS_PER_KILOGRAM,
  botFieldPaces,
  gradeAt,
  kilograms,
  type RouteProfile,
} from '@onyourleft/domain';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

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

/**
 * The first race seed that deals its one bot the even pace (#2455), so each
 * clause below reads the plan with nothing of a style on top. The seed is
 * found, never typed, so a change to the deal moves it rather than breaking
 * the fixture.
 */
const EVEN_SEED = Array.from({ length: 200 }, (_, seed) => seed).find(
  (seed) => botFieldPaces(seed, 1)[0]?.style === 'even',
) as number;

/** That bot's own W/kg: its tier's times its ability, never over the tier. */
const OWN = TIER * (botFieldPaces(EVEN_SEED, 1)[0]?.ability ?? Number.NaN);

/** A W/kg as the standings write it. */
const written = (value: number): string => `${value.toFixed(1)} W/kg`;

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
  vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(
    <T extends ArrayBufferView>(array: T): T => {
      (array as unknown as Uint32Array)[0] = EVEN_SEED;
      return array;
    },
  );
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
  afterAll(() => {
    vi.restoreAllMocks();
  });

  it('fixture: the flat loop is flat and the hilly loop climbs and falls past 2 %', () => {
    expect(flat.every((reading) => reading.grade === 0)).toBe(true);
    expect(Math.max(...hilly.map((reading) => reading.grade))).toBeGreaterThan(5);
    expect(Math.min(...hilly.map((reading) => reading.grade))).toBeLessThan(-5);
  });

  it('fixture: the one bot rides the even pace, at or a little under its tier (#2455)', () => {
    expect(botFieldPaces(EVEN_SEED, 1)[0]?.style).toBe('even');
    expect(OWN).toBeLessThanOrEqual(TIER);
    expect(OWN).toBeGreaterThan(TIER * (1 - BOT_ABILITY_SPREAD));
  });

  it('holds its own figure on the flat, from the gun: never over its tier', () => {
    // Clear of the sprint: the whole flat race before it.
    const flatRace = flat.filter((reading) => reading.left > 400);
    expect(flatRace.length).toBeGreaterThan(200);
    expect(new Set(flatRace.map((reading) => reading.figure))).toEqual(new Set([written(OWN)]));
    expect(OWN).toBeLessThanOrEqual(TIER);
  });

  it('eases downhill: under its own figure on a descent', () => {
    const own = Number.parseFloat(written(OWN));
    const descending = hilly.filter((reading) => reading.grade < -2 && reading.left > 400);
    expect(descending.length).toBeGreaterThan(0);
    const below = descending.filter((reading) => reading.value < own);
    expect(below.length).toBeGreaterThan(descending.length / 2);
  });

  it('goes harder on climbs and in the final sprint: above its tier', () => {
    const climbing = hilly.filter((reading) => reading.grade > 2 && reading.left > 400);
    expect(climbing.some((reading) => reading.value > TIER)).toBe(true);
    const sprint = flat.filter((reading) => reading.left < 150);
    expect(sprint.length).toBeGreaterThan(0);
    expect(sprint.some((reading) => reading.value > TIER)).toBe(true);
  });

  it('fades back to its own figure on a climb once it has gone too hard for too long (#2458)', () => {
    const climbing = hilly.filter((reading) => reading.grade > 2 && reading.left > 400);
    const first = climbing.findIndex((reading) => reading.value > TIER);
    expect(first).toBeGreaterThanOrEqual(0);
    // Later in the race, on climbs as steep, it can no longer pay for more than it holds.
    const faded = climbing.slice(first).filter((reading) => reading.figure === written(OWN));
    expect(faded.length).toBeGreaterThan(0);
  });
});
