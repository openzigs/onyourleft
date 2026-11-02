// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The owner's page's `?race=worst` lap race — #1972: the worst case of
 * #1902/#1961 is handed to the frame, in either world since #1971, and
 * nothing of it reaches a frame that did not ask.
 */

import { describe, expect, it } from 'vitest';

import { realisticRoute } from '../../src/demo/synthetic-road';
import { qualitySettings } from '../../src/game/quality';
import { corridorOrigin } from '../../src/game/terrain';

import { configQuery, DEFAULT_CONFIG, parseConfig } from './config';
import { rideFrame } from './frame';
import {
  RACE_BOTS,
  RACE_HIT,
  RACE_HIT_RACERS,
  RACE_PUDDLES,
  lapRaceAhead,
  raceBotsAhead,
} from './lap-race';

const profile = realisticRoute();
const AT = 2_550;
const input = {
  profile,
  origin: corridorOrigin(profile),
  distance: AT,
  elapsed: 0,
  rung: { scatterItems: 0, structureItems: 0, people: 0 },
};
const racing = rideFrame({ ...input, race: { bots: raceBotsAhead(AT), riderHit: RACE_HIT } });

describe('the realistic page’s lap race — #1972', () => {
  it('reads ?race=worst with the stylised world, and writes it back as the same configuration', () => {
    const config = parseConfig('?world=stylised&race=worst');
    expect(config.race).toBe('worst');
    expect(parseConfig(configQuery(config))).toEqual(config);
    expect(DEFAULT_CONFIG.race).toBeUndefined();
    expect(parseConfig('?world=stylised').race).toBeUndefined();
  });

  it('reads a race in the realistic world too, on the village’s frame (#1971)', () => {
    for (const query of ['?race=worst', '?world=realistic&race=worst&route=village']) {
      const config = parseConfig(query);
      expect(config.race).toBe('worst');
      expect(parseConfig(configQuery(config))).toEqual(config);
    }
  });

  it('refuses a race beside a frame it is not: a round or a town anywhere, a route in the stylised world', () => {
    for (const world of ['stylised', 'realistic']) {
      for (const other of ['delivery=3', 'town=mixed']) {
        expect(() => parseConfig(`?world=${world}&race=worst&${other}`)).toThrow(
          /two frames; name one of them/,
        );
      }
    }
    expect(() => parseConfig('?world=stylised&race=worst&route=village')).toThrow(
      /two frames; name one of them/,
    );
  });

  it('refuses a race it does not know, as it refuses an unknown lever', () => {
    for (const bad of ['', 'best', 'Worst', '8']) {
      expect(() => parseConfig(`?world=stylised&race=${bad}`)).toThrow(/race is one of worst/);
    }
  });

  it('puts seven bots ahead of the rider, a lane each in turn, every other one hit', () => {
    const bots = raceBotsAhead(AT);
    expect(bots).toHaveLength(RACE_BOTS);
    expect(RACE_BOTS).toBe(7);
    // The numbers are written here, not read from lap-race.ts, so changing them there fails this.
    expect(bots.map((bot) => bot.distanceMetres - AT)).toEqual([6, 10, 14, 18, 22, 26, 30]);
    expect(bots.map((bot) => bot.hit !== undefined)).toEqual([
      true,
      false,
      true,
      false,
      true,
      false,
      true,
    ]);
    expect(new Set(bots.map((bot) => bot.lateralMetres)).size).toBe(3);
  });

  it('draws the rider and seven bots and no pacer, the rider and four bots hit', () => {
    const racers = racing.markers.filter(
      (marker) => marker.kind === 'rider' || marker.kind === 'bot',
    );
    expect(racers).toHaveLength(8);
    expect(racing.markers.filter((marker) => marker.kind === 'bot')).toHaveLength(7);
    expect(racers.filter((marker) => marker.hit !== undefined)).toHaveLength(5);
    expect(RACE_HIT_RACERS).toBe(5);
    // A ride with no race keeps its pacer, and nobody is hit.
    const ordinary = rideFrame(input);
    expect(ordinary.markers.filter((marker) => marker.kind === 'bot')).toHaveLength(1);
    expect(ordinary.markers.filter((marker) => marker.hit !== undefined)).toHaveLength(0);
  });

  it('stands every pick-up point of a three-lap race and ten puddles on the road ahead', () => {
    const raced = lapRaceAhead(racing, AT);
    expect(RACE_PUDDLES).toBe(10);
    expect(raced.lapRace?.pickUps).toHaveLength(9);
    expect(raced.lapRace?.hazards).toHaveLength(10);
    expect(racing.lapRace).toBeUndefined();
  });

  it('carries no scenery in the frame a race is held to', () => {
    expect(racing.scatter).toHaveLength(0);
    const sceneryRung = qualitySettings(0);
    expect(rideFrame({ ...input, rung: sceneryRung }).scatter.length).toBeGreaterThan(0);
  });
});
