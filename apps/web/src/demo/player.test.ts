// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The demo player's ride — #1647. Every claim is read back off what the HUD
 * and the renderer read: the simulation's state, and the frame `sceneFrame`
 * built.
 */

import { createHash } from 'node:crypto';

import { distanceOnRoute, gradeAt } from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import { INITIAL_QUALITY, qualitySettings } from '../game/quality';
import { createDemoPlayer, type DemoPlayer } from './player';
import { CLIMB_PRESET, DEMO_PRESETS, GROUP_PRESET } from './presets';
import { demoRoad } from './runner';

const RUNG = qualitySettings(INITIAL_QUALITY.level);

/** A 60 Hz stepped clock, from `fromMs` to `toMs`, advancing `player` at each step. */
function ride(player: DemoPlayer, fromMs: number, toMs: number): void {
  for (let now = fromMs; now <= toMs; now += 1000 / 60) player.advance(now);
}

const distance = (player: DemoPlayer): number => player.state.ride.distance;

const digest = (player: DemoPlayer): string =>
  createHash('sha256').update(JSON.stringify(player.state)).digest('hex');

describe('the demo player — #1647', () => {
  it('starts paused on its start line, and moves nothing until it is played', () => {
    const player = createDemoPlayer(CLIMB_PRESET);
    expect(player.status).toBe('paused');
    ride(player, 0, 5_000);
    expect(distance(player)).toBe(0);
    expect(player.rideMs).toBe(0);
  });

  it('rides the preset when played', () => {
    const player = createDemoPlayer(CLIMB_PRESET);
    player.play();
    ride(player, 0, 10_000);
    expect(player.status).toBe('playing');
    expect(distance(player)).toBeGreaterThan(30);
    // The scripted lead's power, as a live, paired reading.
    expect(player.state.input).toEqual({
      power: player.state.input.power,
      live: true,
      paired: true,
    });
    expect(player.state.input.power).toBeGreaterThan(0);
  });

  it('a pause holds the distance for 2 s of clock, and play resumes from it', () => {
    const player = createDemoPlayer(CLIMB_PRESET);
    player.play();
    ride(player, 0, 10_000);
    player.pause();
    const held = distance(player);
    expect(held).toBeGreaterThan(0);
    ride(player, 10_000, 12_000);
    expect(distance(player)).toBe(held);
    player.play();
    // The first frame after play only notes the time: the 2 s are not ridden.
    player.advance(12_100);
    expect(distance(player)).toBe(held);
    ride(player, 12_100, 13_100);
    expect(distance(player)).toBeGreaterThan(held);
    // About a second of riding at about 9 m/s, never the paused seconds too.
    expect(distance(player) - held).toBeLessThan(15);
  });

  it('stop puts every rider back on its start line, paused there', () => {
    const player = createDemoPlayer(GROUP_PRESET);
    player.play();
    ride(player, 0, 10_000);
    player.stop();
    expect(player.status).toBe('stopped');
    expect(player.rideMs).toBe(0);
    expect(distance(player)).toBe(GROUP_PRESET.riders[0]?.startMetres);
    ride(player, 10_000, 12_000);
    expect(distance(player)).toBe(GROUP_PRESET.riders[0]?.startMetres);
    const others = player.frame(RUNG).markers.filter((marker) => marker.kind === 'remote');
    expect(others).toHaveLength(GROUP_PRESET.riders.length - 1);
  });

  it('rides none of a gap it was told to hold the clock across', () => {
    const player = createDemoPlayer(CLIMB_PRESET);
    player.play();
    ride(player, 0, 5_000);
    const before = player.rideMs;
    player.holdClock();
    player.advance(65_000);
    expect(player.rideMs).toBe(before);
  });

  it('starts the lead where its script says, and draws the other riders as riders', () => {
    const player = createDemoPlayer(GROUP_PRESET);
    expect(distance(player)).toBe(30);
    player.play();
    ride(player, 0, 20_000);
    const frame = player.frame(RUNG);
    expect(frame.markers.filter((marker) => marker.kind === 'rider')).toHaveLength(1);
    const others = frame.markers.filter((marker) => marker.kind === 'remote');
    expect(others).toHaveLength(3);
    // Each on its own stretch of road: no two drawn in the same place.
    const places = new Set(
      frame.markers.map((marker) => `${marker.x.toFixed(1)},${marker.z.toFixed(1)}`),
    );
    expect(places.size).toBe(4);
  });

  it('rides the road it draws: the climb climbs', () => {
    const profile = demoRoad(CLIMB_PRESET.route);
    expect(createDemoPlayer(CLIMB_PRESET).profile.totalDistance).toBeCloseTo(
      profile.totalDistance,
      6,
    );
    // Half way up the 8 % section, which starts at 1 500 m.
    expect(gradeAt(profile, distanceOnRoute(profile, 2_250))).toBeCloseTo(8, 0);
    expect(gradeAt(profile, distanceOnRoute(profile, 600))).toBeCloseTo(0, 1);
  });

  it.each(DEMO_PRESETS.map((preset) => [preset.id, preset] as const))(
    'gives the same GameState at 30 s on two runs of a stepped clock — %s',
    (_id, preset) => {
      const runs = [createDemoPlayer(preset), createDemoPlayer(preset)].map((player) => {
        player.play();
        ride(player, 0, 30_000);
        return player;
      });
      expect(runs[0]?.rideMs).toBeCloseTo(30_000, -2);
      expect(digest(runs[0] as DemoPlayer)).toBe(digest(runs[1] as DemoPlayer));
    },
  );

  it('the digest tells two presets apart, so equal digests are not an accident', () => {
    const [climb, sprint] = [DEMO_PRESETS[0], DEMO_PRESETS[1]].map((preset) => {
      const player = createDemoPlayer(preset as (typeof DEMO_PRESETS)[number]);
      player.play();
      ride(player, 0, 30_000);
      return digest(player);
    });
    expect(climb).not.toBe(sprint);
  });
});
