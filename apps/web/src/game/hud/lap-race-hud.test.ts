// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A lap race's fields and standings — #1904, read off what the model's own
 * race states make of them (`lap-race-testing.ts`).
 */

import {
  BOT_TIERS,
  GUST_REACH_METRES,
  ITEM_KINDS,
  createItemRace,
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  raceCourse,
  routeProfile,
  type RoutePoint,
} from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import { atStartLine } from '../simulation';

import { NO_READING, hudReadings } from './fields';
import {
  BOT_TIER_TEXT,
  ITEM_TEXT,
  LAP_RACE_ITEM_KEY,
  LAP_RACE_PLACE_KEY,
  PUDDLE_WARNING_METRES,
  botName,
  incomingHit,
  lapRaceReadings,
  lapRaceStandings,
  racePlace,
} from './lap-race-hud';
import { BOTS, RIDER, holding, hudOf, startRace, tick } from './lap-race-testing';
import { lapOfLaps } from './lap-text';

function flat(): ReturnType<typeof routeProfile> {
  const points: RoutePoint[] = [];
  for (let index = 0; index <= 20; index += 1) {
    points.push({
      position: geographicPosition(
        degreesLatitude(51.5 + (index * 10) / 111_320),
        degreesLongitude(-0.12),
      ),
      elevation: altitudeMetres(10),
    });
  }
  return routeProfile(points);
}

const PROFILE = flat();

const BASE_INPUT = {
  profile: PROFILE,
  state: atStartLine(PROFILE),
  cadence: { value: 88, live: true },
  heartRate: { value: 150, live: true },
  units: 'metric',
} as const;

/** Everyone at `metres` but the rider, who is at `rider`. */
function efforts(rider: number, others: readonly number[]): Record<string, number> {
  const all: Record<string, number> = { [RIDER]: rider };
  BOTS.forEach((id, index) => {
    all[id] = others[index] ?? 0;
  });
  return all;
}

function field(readings: ReturnType<typeof lapRaceReadings>, key: string) {
  return readings.find((reading) => reading.key === key);
}

describe('lapOfLaps — the lap being ridden (#1904)', () => {
  it('is the one after the last lap done, and never past the race’s last', () => {
    expect(lapOfLaps(0, 5)).toBe('Lap 1 of 5');
    expect(lapOfLaps(1, 5)).toBe('Lap 2 of 5');
    expect(lapOfLaps(4, 5)).toBe('Lap 5 of 5');
    expect(lapOfLaps(5, 5)).toBe('Lap 5 of 5');
    expect(lapOfLaps(-1, 3)).toBe('Lap 1 of 3');
  });
});

describe('the lap race’s fields (#1904)', () => {
  it('shows the place, the field and the lap, then the held item, last on the HUD', () => {
    let race = startRace({ laps: 3 });
    race = tick(race, { atMs: 1_000, effortDistances: efforts(120, [130, 110, 100]) });
    const readings = lapRaceReadings(hudOf(race));
    expect(readings.map((reading) => [reading.label, reading.value, reading.unit])).toEqual([
      ['Place', '2', 'of 4'],
      ['Item', 'None', ''],
    ]);
    expect(field(readings, LAP_RACE_PLACE_KEY)?.detail).toBe('Lap 1 of 3');
    // Through the HUD's own reading list, after every other field.
    const all = hudReadings({
      ...BASE_INPUT,
      lapRace: hudOf(race),
    }).map((reading) => reading.key);
    expect(all.slice(-2)).toEqual([LAP_RACE_PLACE_KEY, LAP_RACE_ITEM_KEY]);
  });

  it('is absent from a ride with no race', () => {
    expect(lapRaceReadings(undefined)).toEqual([]);
    expect(hudReadings(BASE_INPUT).some((reading) => reading.key.startsWith('lap-race-'))).toBe(
      false,
    );
  });

  it('has no item field with items off', () => {
    const race = startRace({ itemsOn: false });
    expect(lapRaceReadings(hudOf(race)).map((reading) => reading.key)).toEqual([
      LAP_RACE_PLACE_KEY,
    ]);
  });

  it('names the item held, in words, and the lap after one is done', () => {
    let race = startRace({ laps: 3, lap: 1_000 });
    race = tick(race, { atMs: 1_000, effortDistances: efforts(1_005, [10, 10, 10]) });
    race = holding(race, RIDER, 'crosswind-gust');
    const readings = lapRaceReadings(hudOf(race));
    expect(field(readings, LAP_RACE_ITEM_KEY)?.value).toBe('Gust');
    expect(field(readings, LAP_RACE_ITEM_KEY)?.word).toBe(true);
    expect(field(readings, LAP_RACE_PLACE_KEY)?.detail).toBe('Lap 2 of 3');
  });

  it('says Finished under the place once the rider is over the line', () => {
    let race = startRace({ laps: 1, lap: 500 });
    race = tick(race, { atMs: 60_000, effortDistances: efforts(505, [400, 300, 200]) });
    const place = field(lapRaceReadings(hudOf(race)), LAP_RACE_PLACE_KEY);
    expect([place?.value, place?.unit, place?.detail]).toEqual(['1', 'of 4', 'Finished']);
  });

  it('warns of a gust behind in the rider’s lane, in words and with the alert shape', () => {
    let race = startRace({ laps: 3 });
    race = tick(race, { atMs: 1_000, effortDistances: efforts(100, [80, 10, 10]) });
    expect(incomingHit(race, RIDER)).toBeUndefined();
    race = holding(race, 'bot-1', 'crosswind-gust');
    expect(incomingHit(race, RIDER)).toBe('gust');
    const item = field(lapRaceReadings(hudOf(race)), LAP_RACE_ITEM_KEY);
    expect(item?.detail).toBe('Gust behind you');
    expect(item?.alert).toBe(true);
    // Out of its lane, or out of its reach, it is no warning.
    expect(
      incomingHit(tick(race, { atMs: 2_000, effortDistances: {}, lanes: { [RIDER]: 0 } }), RIDER),
    ).toBeUndefined();
    const far = tick(race, {
      atMs: 2_000,
      effortDistances: efforts(100 + GUST_REACH_METRES + 21, [80, 10, 10]),
    });
    expect(incomingHit(far, RIDER)).toBeUndefined();
    expect(field(lapRaceReadings(hudOf(far)), LAP_RACE_ITEM_KEY)?.alert).toBeUndefined();
  });

  it('gives a rider over the line no warning, though a bot behind still holds a gust', () => {
    let race = startRace({ laps: 1, lap: 500 });
    race = tick(race, { atMs: 60_000, effortDistances: efforts(505, [480, 300, 200]) });
    race = holding(race, 'bot-1', 'crosswind-gust');
    expect(incomingHit(race, RIDER)).toBeUndefined();
    const item = field(lapRaceReadings(hudOf(race)), LAP_RACE_ITEM_KEY);
    expect(item?.alert).toBeUndefined();
    expect(item?.detail).toBeUndefined();
  });

  it('warns of another racer’s puddle ahead in the rider’s lane, and not of its own', () => {
    let race = startRace({ laps: 3, lap: 1_000 });
    race = tick(race, { atMs: 1_000, effortDistances: efforts(200, [230, 10, 10]) });
    // bot-1 lays a puddle at the next pick-up point ahead of it: 250 m.
    race = tick(holding(race, 'bot-1', 'puddle'), {
      atMs: 2_000,
      effortDistances: efforts(200 + 1, [240, 10, 10]),
      uses: ['bot-1'],
    });
    expect(race.hazards.map((hazard) => hazard.position)).toEqual([250]);
    expect(250 - 201).toBeLessThanOrEqual(PUDDLE_WARNING_METRES);
    expect(incomingHit(race, RIDER)).toBe('puddle');
    expect(field(lapRaceReadings(hudOf(race)), LAP_RACE_ITEM_KEY)?.detail).toBe('Puddle ahead');
    // Too far ahead to warn of yet.
    const back = tick(startRace({ laps: 3 }), { atMs: 1_000, effortDistances: efforts(150, []) });
    expect(incomingHit({ ...back, hazards: race.hazards }, RIDER)).toBeUndefined();
    // The rider's own puddle is no warning to the rider.
    const own = {
      ...race,
      hazards: race.hazards.map((hazard) => ({ ...hazard, ownerId: RIDER })),
    };
    expect(incomingHit(own, RIDER)).toBeUndefined();
  });

  it('says Cape on while a rain cape is, and nothing under the item otherwise', () => {
    let race = startRace({ laps: 3 });
    race = tick(holding(race, RIDER, 'rain-cape'), {
      atMs: 1_000,
      effortDistances: efforts(10, []),
      uses: [RIDER],
    });
    const item = field(lapRaceReadings(hudOf(race)), LAP_RACE_ITEM_KEY);
    expect([item?.value, item?.detail, item?.alert]).toEqual(['None', 'Cape on', undefined]);
    const later = tick(race, { atMs: 60_000, effortDistances: efforts(20, []) });
    expect(field(lapRaceReadings(hudOf(later)), LAP_RACE_ITEM_KEY)?.detail).toBeUndefined();
  });

  it('names every item and every tier in words, none of them the key', () => {
    for (const kind of ITEM_KINDS) {
      expect(ITEM_TEXT[kind].name).not.toBe(kind);
      // One word on the HUD: a second word is a second line in a 93 px value box.
      expect(ITEM_TEXT[kind].name).toMatch(/^\S+$/);
      expect(ITEM_TEXT[kind].said.toLowerCase()).toContain(ITEM_TEXT[kind].name.toLowerCase());
    }
    for (const tier of BOT_TIERS) {
      expect(botName(tier, 2)).toBe(`${BOT_TIER_TEXT[tier]} bot 2`);
    }
  });
});

describe('the lap race’s standings, as a room’s (#1904, ADR 0051)', () => {
  it('lists every racer in the model’s order, the rider marked, with a time gap to the rider and W/kg', () => {
    let race = startRace({ laps: 3 });
    race = tick(race, { atMs: 1_000, effortDistances: efforts(100, [150, 80, 100]) });
    const view = lapRaceStandings(hudOf(race, 10));
    expect(view.place).toBe(racePlace(race, RIDER).place);
    expect(view.of).toBe(4);
    expect(view.lines.map((line) => [line.place, line.who, line.gap, line.figure])).toEqual([
      [1, 'Brisk bot 1', '−5 s', '3.0 W/kg'],
      // Level with the rider, and behind by id: the model's tie-break.
      [2, 'Fierce bot 3', '0 s', '4.5 W/kg'],
      [3, 'You', '', '3.2 W/kg'],
      [4, 'Steady bot 2', '+2 s', '2.3 W/kg'],
    ]);
    expect(view.lines.filter((line) => line.you).map((line) => line.who)).toEqual(['You']);
    expect(view.lines.every((line) => !line.figure.includes(' W ') && !line.flagged)).toBe(true);
  });

  it('shows a dash for a gap at a standstill, and for a W/kg it is not given', () => {
    let race = startRace({ laps: 3 });
    race = tick(race, { atMs: 1_000, effortDistances: efforts(100, [150, 80, 100]) });
    const view = lapRaceStandings({
      ...hudOf(race, 0),
      riderWattsPerKilogram: undefined,
    });
    expect(view.lines.filter((line) => !line.you).map((line) => line.gap)).toEqual([
      NO_READING,
      NO_READING,
      NO_READING,
    ]);
    expect(view.lines.find((line) => line.you)?.figure).toBe(NO_READING);
  });

  it('puts finished racers apart by their finish instants, and says Finished', () => {
    let race = startRace({ laps: 1, lap: 500 });
    race = tick(race, { atMs: 60_000, effortDistances: efforts(505, [400, 300, 200]) });
    race = tick(race, { atMs: 72_000, effortDistances: efforts(600, [510, 400, 300]) });
    const view = lapRaceStandings(hudOf(race));
    expect(view.lines.slice(0, 2).map((line) => [line.who, line.gap, line.figure])).toEqual([
      ['You', '', 'Finished'],
      ['Brisk bot 1', '+12 s', 'Finished'],
    ]);
  });

  it('names a racer the HUD was not told about as a room names one, never by its id', () => {
    const race = startRace({ laps: 3 });
    const view = lapRaceStandings({ ...hudOf(race), entrants: {} });
    expect(view.lines.filter((line) => !line.you).map((line) => line.who)).toEqual([
      'A rider',
      'A rider',
      'A rider',
    ]);
  });

  it('never reads an entrant off Object.prototype, however a racer is named', () => {
    const race = createItemRace({
      course: raceCourse(1_000, 3),
      seed: 1,
      itemsOn: false,
      racerIds: [RIDER, 'constructor', 'toString'],
      startMs: 0,
    });
    const view = lapRaceStandings({ ...hudOf(race), entrants: {} });
    expect(view.lines.filter((line) => !line.you).map((line) => [line.who, line.figure])).toEqual([
      ['A rider', NO_READING],
      ['A rider', NO_READING],
    ]);
  });

  it('shows a dash, never NaN, for a W/kg that is not a number', () => {
    const race = startRace({ laps: 3 });
    const view = lapRaceStandings({
      ...hudOf(race),
      riderWattsPerKilogram: Number.NaN,
      entrants: { 'bot-1': { name: 'Brisk bot 1', wattsPerKilogram: Number.POSITIVE_INFINITY } },
    });
    expect(view.lines.map((line) => line.figure)).toEqual(view.lines.map(() => NO_READING));
  });
});
