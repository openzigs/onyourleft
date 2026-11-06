// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * No coordinate and no place name — #1904's fifth criterion, CLAUDE.md §6
 * (ADR 0004 decision D). A whole lap race, items on and hits taken, ridden
 * through the model and the real announcer's core onto the real HUD, and
 * **nothing the race puts on the HUD or says** formats a coordinate or names
 * a place.
 *
 * ⚠️ What a careless caller could hand in is handed in: each bot's entry
 * carries the route's name and its start's coordinates beside the name the
 * HUD declares, so a HUD that formatted what it was handed rather than the
 * fields it reads is red here. What is read back is every lap-race field, the
 * standings panel, every attribute on them, and every sentence the core said.
 */

import type { JSX } from 'react';
import { afterEach, describe, expect, expectTypeOf, it } from 'vitest';

import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  routeProfile,
  type ItemRaceState,
  type RoutePoint,
} from '@onyourleft/domain';

import { mount, type Mounted } from '../../testing/mount';
import { atStartLine } from '../simulation';

import { INITIAL_ANNOUNCER, announce, type AnnouncerState } from './announce';
import { DEFAULT_ANNOUNCEMENTS } from './announce-preference';
import { HudPanel } from './HudPanel';
import { lapRaceEvents, lapRaceOwedAtStart, lapRaceSpoken, oweRaceTick } from './lap-race-announce';
import { lapRaceStandings, type LapRaceEntrant, type LapRaceHud } from './lap-race-hud';
import { BOTS, ENTRANTS, RIDER, holding, hudOf, startRace, tick } from './lap-race-testing';

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

const LATITUDE = 51.501_234;
const LONGITUDE = -0.141_987;
const ROUTE_NAME = 'Birdcage Walk loop';

function route(): ReturnType<typeof routeProfile> {
  const points: RoutePoint[] = [];
  for (let index = 0; index <= 20; index += 1) {
    points.push({
      position: geographicPosition(
        degreesLatitude(LATITUDE + (index * 10) / 111_320),
        degreesLongitude(LONGITUDE),
      ),
      elevation: altitudeMetres(10),
    });
  }
  return routeProfile(points);
}

const PROFILE = route();

/** Each bot's entry with a place carried beside it, as a careless caller might carry it. */
const CARELESS: Readonly<Record<string, LapRaceEntrant>> = Object.fromEntries(
  Object.entries(ENTRANTS).map(([id, entrant]) => [
    id,
    { ...entrant, route: ROUTE_NAME, latitude: LATITUDE, longitude: LONGITUDE },
  ]),
);

function hud(race: ItemRaceState): LapRaceHud {
  return { ...hudOf(race), entrants: CARELESS };
}

function panel(race: ItemRaceState, announcement: string): JSX.Element {
  return (
    <main>
      <h1>Ride</h1>
      <HudPanel
        profile={PROFILE}
        state={atStartLine(PROFILE)}
        cadence={{ value: 88, live: true }}
        heartRate={{ value: 150, live: true }}
        onPause={() => undefined}
        onEnd={() => undefined}
        paused={false}
        announcement={announcement}
        lapRace={hud(race)}
        standings={lapRaceStandings(hud(race))}
      />
    </main>
  );
}

/** Everything the race put on the HUD: its fields and its standings, text and attributes. */
function raceOnTheHud(): string {
  const parts = [
    ...document.querySelectorAll('.oyl-hud__field--lap-race, [aria-label="Race standings"]'),
  ];
  return parts
    .flatMap((element) => [
      element.textContent ?? '',
      ...[element, ...element.querySelectorAll('*')].flatMap((each) =>
        [...each.attributes].map((attribute) => attribute.value),
      ),
    ])
    .join(' ');
}

/** A coordinate as any layer might print it, and the place itself. */
function placesIn(text: string): string[] {
  const found = [...text.matchAll(/-?\d+\.\d{3,}/g)].map((match) => match[0]);
  for (const place of [
    ROUTE_NAME,
    'Birdcage',
    String(LATITUDE),
    String(LONGITUDE),
    LATITUDE.toFixed(2),
    LONGITUDE.toFixed(2),
    LATITUDE.toFixed(4),
    LONGITUDE.toFixed(4),
  ]) {
    if (text.includes(place)) found.push(place);
  }
  return found;
}

describe('a lap race names no place — #1904', () => {
  it('takes nothing that could carry a coordinate or a place', () => {
    expectTypeOf<keyof LapRaceHud>().toEqualTypeOf<
      'race' | 'riderId' | 'entrants' | 'riderWattsPerKilogram' | 'speedMetresPerSecond'
    >();
    expectTypeOf<keyof LapRaceEntrant>().toEqualTypeOf<'name' | 'wattsPerKilogram'>();
  });

  it('puts no coordinate and no place name on the HUD or in a sentence, over a whole race', async () => {
    let race = holding(startRace({ laps: 2, lap: 400, seed: 7 }), 'bot-1', 'crosswind-gust');
    let owed = lapRaceOwedAtStart(race, RIDER);
    let state: AnnouncerState = INITIAL_ANNOUNCER;
    const said: string[] = [];
    const shown: string[] = [];
    mounted = await mount(panel(race, ''));
    for (let second = 1; second <= 90; second += 1) {
      const before = race;
      const efforts: Record<string, number> = { [RIDER]: second * 10 };
      BOTS.forEach((id, index) => {
        efforts[id] = second * (9.5 - index);
      });
      // Every racer uses whatever it holds, so hits land on the rider and the bots.
      const uses = [RIDER, ...BOTS];
      race = tick(before, { atMs: second * 1_000, effortDistances: efforts, uses });
      owed = oweRaceTick(owed, before, race, RIDER, true);
      const result = announce(state, {
        now: second,
        readings: [],
        events: lapRaceEvents(owed, second),
        preference: {
          ...DEFAULT_ANNOUNCEMENTS,
          enabled: true,
          powerEverySeconds: 'never',
          distanceEvery: 'never',
        },
      });
      state = result.state;
      owed = lapRaceSpoken(owed, result.kind, second);
      if (result.sentence !== undefined) said.push(result.sentence);
      await mounted.rerender(panel(race, result.sentence ?? ''));
      shown.push(raceOnTheHud());
    }
    // The race was ridden: a hit, a lap and the finish were all said.
    expect(said).toContain('Hit by a crosswind gust.');
    expect(said.some((each) => each.startsWith('Lap 1 of 2 done.'))).toBe(true);
    expect(said.some((each) => each.startsWith('Finished, '))).toBe(true);
    expect(shown.join(' ')).toContain('Brisk bot 1');
    expect(placesIn(said.join(' '))).toEqual([]);
    expect(placesIn(shown.join(' '))).toEqual([]);
  });
});
