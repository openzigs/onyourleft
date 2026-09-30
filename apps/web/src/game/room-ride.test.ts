// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import type { RoomConnection } from '../net/room-port';
import { CORRECTION_THRESHOLD_METRES } from '../net/correction';
import type { DrawnRemoteRider } from '../net/snapshots';
import {
  NEARBY_METRES,
  nextToFollow,
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
    // 40 m in the second since the frame before, at the room's 12 m/s, is
    // explainable (#922): 8 m + 12 m/s × (1 s + the 2 s correction).
    roomFrame(
      connection([], { rider: { ...rider(0, 40), speedMetresPerSecond: 12 }, atLocalMs: 1_000 }),
      memory,
      sim,
      1_000,
    );
    expect(sim.correcting).toBe(true);
  });

  it('leaves the rider where they are for a frame 50 km out — #922', () => {
    const sim = simulation();
    const memory = roomRideState();
    roomFrame(connection([], { rider: rider(0, 0), atLocalMs: 0 }), memory, sim, 0);
    roomFrame(
      connection([], {
        rider: { ...rider(0, 50_000), speedMetresPerSecond: 12 },
        atLocalMs: 1_000,
      }),
      memory,
      sim,
      1_000,
    );
    expect(sim.correcting).toBe(false);
    // The control: the same frame 40 m out is acted on.
    roomFrame(
      connection([], { rider: { ...rider(0, 40), speedMetresPerSecond: 12 }, atLocalMs: 2_000 }),
      memory,
      sim,
      2_000,
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
