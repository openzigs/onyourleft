// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import type { RoomConnection } from '../net/room-port';
import { CORRECTION_THRESHOLD_METRES } from '../net/correction';
import type { DrawnRemoteRider } from '../net/snapshots';
import {
  heldOnTheLine,
  NEARBY_METRES,
  nextToFollow,
  raceEvent,
  raceNotice,
  RACE_TEXT,
  riderEvents,
  roomFrame,
  roomNotice,
  roomRideState,
  ROOM_GONE_TEXT,
  ROOM_LOST_TEXT,
  seatLabel,
} from './room-ride';
import { GameSimulation } from './simulation';
import { northRoute } from './route-fixtures-testing';
import { airDensityKilogramsPerCubicMetre } from '@onyourleft/physics';
import { altitudeMetres, degreesCelsius, kilograms } from '@onyourleft/domain';

const rider = (riderId: number, distanceMetres: number): DrawnRemoteRider => ({
  riderId,
  distanceMetres,
  speedMetresPerSecond: 8,
  flags: 0,
});

function connection(
  others: readonly DrawnRemoteRider[],
  own?: { readonly rider: DrawnRemoteRider; readonly atLocalMs: number },
): RoomConnection {
  return {
    status: () => ({
      kind: 'joined',
      riderId: 0,
      config: {
        kind: 'ride',
        ridingPosition: 'hoods',
        reportIntervalMs: 500,
        frameIntervalMs: 1000,
      },
    }),
    others: () => others,
    race: () => ({ kind: 'not-a-race' }),
    own: () => own,
    leave: () => undefined,
  };
}

function simulation(): GameSimulation {
  return new GameSimulation({
    profile: northRoute(3_000, () => 10),
    conditions: {
      totalMass: kilograms(80),
      airDensityKilogramsPerCubicMetre: airDensityKilogramsPerCubicMetre(
        altitudeMetres(0),
        degreesCelsius(15),
      ),
    },
  });
}

describe('one frame of a room ride — #782, #783', () => {
  it('counts the riders near, and not the one far up the road', () => {
    const frame = roomFrame(
      connection([rider(1, 50), rider(2, -120 + 200), rider(3, NEARBY_METRES + 500)]),
      roomRideState(),
      simulation(),
      0,
    );
    expect(frame.remoteRiders.map((r) => r.riderId)).toEqual([1, 2, 3]);
    expect(frame.hud.nearby).toBe(2);
    expect(frame.hud.chosen).toBeUndefined();
  });

  it('corrects the rider toward the room once per frame, and not inside the threshold', () => {
    const sim = simulation();
    const memory = roomRideState();
    roomFrame(
      connection([], { rider: rider(0, CORRECTION_THRESHOLD_METRES - 1), atLocalMs: 0 }),
      memory,
      sim,
      0,
    );
    expect(sim.correcting).toBe(false);
    roomFrame(
      connection([], { rider: { ...rider(0, 40), speedMetresPerSecond: 0 }, atLocalMs: 1_000 }),
      memory,
      sim,
      1_000,
    );
    expect(sim.correcting).toBe(true);
  });

  it('gives the chosen rider a seat label and a gap, and drops the choice when they leave', () => {
    const memory = roomRideState();
    memory.following = 2;
    const frame = roomFrame(connection([rider(1, 20), rider(2, 40)]), memory, simulation(), 0);
    expect(frame.hud.chosen?.label).toBe(seatLabel(2));
    expect(frame.hud.chosen?.label).toBe('Rider 3');
    roomFrame(connection([rider(1, 20)]), memory, simulation(), 0);
    expect(memory.following).toBeUndefined();
  });
});

describe('who is followed next — by seat, never by who is ahead', () => {
  it('walks the seats in rider-id order and wraps, whatever the distances say', () => {
    const near = [
      { riderId: 7, distanceMetres: 5, speedMetresPerSecond: 8 },
      { riderId: 2, distanceMetres: 90, speedMetresPerSecond: 8 },
      { riderId: 4, distanceMetres: 1, speedMetresPerSecond: 8 },
    ];
    expect(nextToFollow(undefined, near)).toBe(2);
    expect(nextToFollow(2, near)).toBe(4);
    expect(nextToFollow(4, near)).toBe(7);
    expect(nextToFollow(7, near)).toBe(2);
    expect(nextToFollow(undefined, [])).toBeUndefined();
  });
});

describe('what the rider is told about the room', () => {
  it('says the room is lost, gone or refused in words, and nothing while joined', () => {
    expect(roomNotice(undefined)).toBeUndefined();
    expect(roomNotice({ kind: 'connecting' })).toBeUndefined();
    expect(roomNotice({ kind: 'lost', since: 0 })).toBe(ROOM_LOST_TEXT);
    expect(roomNotice({ kind: 'gone' })).toBe(ROOM_GONE_TEXT);
    expect(roomNotice({ kind: 'refused', reason: 'room-full' })).toMatch(/full/);
  });
});

describe('a race on the HUD — #785', () => {
  it('holds the rider on the line while the race waits or counts down, and never in a group ride', () => {
    expect(heldOnTheLine({ kind: 'waiting' })).toBe(true);
    expect(heldOnTheLine({ kind: 'counting', endsAtLocalMs: 10 })).toBe(true);
    expect(heldOnTheLine({ kind: 'running' })).toBe(false);
    expect(heldOnTheLine({ kind: 'finished', order: [] })).toBe(false);
    expect(heldOnTheLine({ kind: 'not-a-race' })).toBe(false);
    expect(heldOnTheLine(undefined)).toBe(false);
  });

  it('counts the countdown down in whole seconds, on this device’s clock, never below nought', () => {
    expect(raceNotice({ kind: 'counting', endsAtLocalMs: 10_000 }, 2_500, true)).toBe(
      'The race starts in 8 seconds.',
    );
    expect(raceNotice({ kind: 'counting', endsAtLocalMs: 10_000 }, 9_100, true)).toBe(
      'The race starts in 1 second.',
    );
    expect(raceNotice({ kind: 'counting', endsAtLocalMs: 10_000 }, 12_000, true)).toBe(
      'The race starts in 0 seconds.',
    );
    expect(raceNotice({ kind: 'running' }, 0, true)).toBeUndefined();
    expect(raceNotice({ kind: 'not-a-race' }, 0, true)).toBeUndefined();
  });

  it('tells the rider who made the room to start it, and one who joined who will — the owner’s ruling of 2026-09-30', () => {
    expect(raceNotice({ kind: 'waiting' }, 0, true)).toBe(RACE_TEXT.waiting);
    expect(raceNotice({ kind: 'waiting' }, 0, false)).toBe(RACE_TEXT.waitingForItsMaker);
    expect(RACE_TEXT.waitingForItsMaker).toContain('the rider who made the room starts it');
  });

  it('says each change of the race once — the countdown, “Go”, and its end', () => {
    let said: Parameters<typeof raceEvent>[0];
    const heard: string[] = [];
    for (const race of [
      { kind: 'waiting' },
      { kind: 'counting', endsAtLocalMs: 10_000 },
      { kind: 'counting', endsAtLocalMs: 10_000 },
      { kind: 'running' },
      { kind: 'running' },
      { kind: 'finished', order: [1] },
    ] as const) {
      const next = raceEvent(said, race, 0);
      said = next.said;
      if (next.event !== undefined) heard.push(next.event.text);
    }
    expect(heard).toEqual([
      'The race starts in 10 seconds.',
      'Go.',
      'The race is over. End the ride to see its result.',
    ]);
  });
});

describe('riders coming and going — #784', () => {
  it('says nothing of the room as it was found, then who joined and who left, by count', () => {
    const first = riderEvents(undefined, [1, 2]);
    expect(first.events).toEqual([]);
    const second = riderEvents(first.seen, [1, 2, 3, 4]);
    expect(second.events).toEqual([{ kind: 'room-rider', text: '2 riders joined the room.' }]);
    const third = riderEvents(second.seen, [2, 3, 4]);
    expect(third.events).toEqual([{ kind: 'room-rider', text: 'A rider left the room.' }]);
    expect(riderEvents(third.seen, [2, 3, 4]).events).toEqual([]);
  });
});
