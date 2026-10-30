// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import type { RoomConnection } from '../net/room-port';
import type { RoomSessionStatus } from '../net/room-session';
import { CORRECTION_THRESHOLD_METRES } from '../net/correction';
import type { DrawnRemoteRider } from '../net/snapshots';
import {
  acrossTheRoomsLine,
  DRAFT_IN_PERCENT,
  DRAFT_OUT_PERCENT,
  DRAFT_SPOKEN,
  draftEvent,
  heldOnTheLine,
  NEARBY_METRES,
  nextToFollow,
  placeAcrossOf,
  raceEvent,
  raceFactOf,
  ROOM_RECORDING_PAUSED_TEXT,
  roomRideNotice,
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
import { altitudeMetres, degreesCelsius, kilograms, watts } from '@onyourleft/domain';
import { FLAG_FINISHED, FLAG_PLAUSIBILITY } from '@onyourleft/protocol';

const rider = (riderId: number, distanceMetres: number): DrawnRemoteRider => ({
  riderId,
  distanceMetres,
  speedMetresPerSecond: 8,
  flags: 0,
  draftPercent: 0,
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
        drafting: 'on',
      },
    }),
    others: () => others,
    race: () => ({ kind: 'not-a-race' }),
    own: () => own,
    standings: () => undefined,
    draftFactor: () => 1,
    report: () => Promise.resolve({ kind: 'reported' }),
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
    // 12 m in the second since the frame before is explainable (#922): the
    // local rider is standing, so the room's 12 m/s is believed only to 2 m/s
    // (#928's review, `correction.ts` §`admittedRoomSpeed`), and
    // 8 m + 2 m/s × (1 s + the 2 s correction) is 14 m.
    roomFrame(
      connection([], { rider: { ...rider(0, 12), speedMetresPerSecond: 12 }, atLocalMs: 1_000 }),
      memory,
      sim,
      1_000,
    );
    expect(sim.correcting).toBe(true);
  });

  it('measures the first frame’s bound from when the ride began — #922', () => {
    // Thirty seconds ridden at 200 W, and then the first frame: the room
    // has the rider 250 m on. At the room's 10 m/s that is explainable over
    // thirty seconds, and would not be over the two a correction lasts.
    const sim = simulation();
    for (let at = 0; at <= 30_000; at += 100) sim.advanceTo(at, { power: watts(200), live: true });
    expect(sim.state.ridden as number).toBeCloseTo(30, 6);
    const local = sim.state.ride.distance as number;
    roomFrame(
      connection([], {
        rider: { ...rider(0, local + 250), speedMetresPerSecond: 10 },
        atLocalMs: 30_000,
      }),
      roomRideState(),
      sim,
      30_000,
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
    // The control: the same frame 12 m out is acted on — 14 m is what a
    // standing rider and a room's word of 12 m/s explain in a second.
    roomFrame(
      connection([], { rider: { ...rider(0, 12), speedMetresPerSecond: 12 }, atLocalMs: 2_000 }),
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

  it('calls the chosen rider by the name a race’s room sent, and by a seat where it sent none — #1347', () => {
    const memory = roomRideState();
    memory.following = 2;
    const inARace: RoomConnection = {
      ...connection([rider(1, 20), rider(2, 40)]),
      standings: () => ({
        tick: 1,
        rows: [
          {
            riderId: 2,
            displayName: 'Bea',
            you: false,
            gapSeconds: -3,
            wattsPerKilogram: 3,
            flags: 0,
          },
          {
            riderId: 1,
            displayName: undefined,
            you: false,
            gapSeconds: 1,
            wattsPerKilogram: 3,
            flags: 0,
          },
        ],
      }),
    };
    expect(roomFrame(inARace, memory, simulation(), 0).hud.chosen?.label).toBe('Bea');
    memory.following = 1;
    expect(roomFrame(inARace, memory, simulation(), 0).hud.chosen?.label).toBe('Rider 2');
  });

  it('names a rider on the road by the name the HUD gives them, and nobody else — #783', () => {
    const memory = roomRideState();
    const labels = (room: RoomConnection): readonly (string | undefined)[] =>
      roomFrame(room, memory, simulation(), 0).remoteRiders.map((each) => each.label);
    const others = [rider(1, 20), rider(2, 40), rider(3, 60)];
    // A group ride's room names nobody (ADR 0051 D-3): no name on the road…
    expect(labels(connection(others))).toEqual([undefined, undefined, undefined]);
    // …but the one rider followed, by the seat the HUD calls them.
    memory.following = 3;
    expect(labels(connection(others))).toEqual([undefined, undefined, seatLabel(3)]);
    // A race's room names its riders, and the followed one by the room's name.
    const inARace: RoomConnection = {
      ...connection(others),
      standings: () => ({
        tick: 1,
        rows: [1, 3].map((riderId) => ({
          riderId,
          displayName: riderId === 1 ? 'Ann' : 'Cai',
          you: false,
          gapSeconds: 0,
          wattsPerKilogram: 3,
          flags: 0,
        })),
      }),
    };
    const frame = roomFrame(inARace, memory, simulation(), 0);
    expect(frame.remoteRiders.map((each) => each.label)).toEqual(['Ann', undefined, 'Cai']);
    expect(frame.hud.chosen?.label).toBe('Cai');
    // And nothing about a rider rides with the name: the input carries no
    // figure, so no W/kg and no watts can reach the road (ruling Q17).
    for (const each of frame.remoteRiders) {
      expect(Object.keys(each).sort()).toEqual(
        [
          'distanceMetres',
          'riderId',
          'speedMetresPerSecond',
          ...(each.label === undefined ? [] : ['label']),
          ...(each.riderId === 3 ? ['followed'] : []),
        ].sort(),
      );
    }
    // The followed rider is marked, so their name is kept first on the road.
    expect(frame.remoteRiders.map((each) => each.followed)).toEqual([undefined, undefined, true]);
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
    expect(heldOnTheLine({ kind: 'finished', order: [], place: null })).toBe(false);
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
      { kind: 'finished', order: [1], place: null },
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

describe('into and out of the room’s draft — #787, #327’s spoken cue', () => {
  /** Run a sequence of HUD draft figures through the cue, as `GameView` does frame by frame. */
  function said(figures: readonly (number | 'off' | undefined)[]): (string | undefined)[] {
    let inDraft = false;
    return figures.map((figure) => {
      const next = draftEvent(inDraft, figure);
      inDraft = next.inDraft;
      return next.event?.text;
    });
  }

  it('says “in” once on crossing into the draft and “out” once on leaving it, never the figure on every frame', () => {
    expect(said([0, 4, 12, 30, 34, 20, 3, 0])).toEqual([
      undefined,
      undefined,
      DRAFT_SPOKEN.into(12),
      undefined,
      undefined,
      undefined,
      DRAFT_SPOKEN.outOf,
      undefined,
    ]);
    expect(DRAFT_SPOKEN.into(34.4)).toBe('In the draft: 34 percent less drag.');
  });

  it('does not chatter at the edge: between the two thresholds nothing changes either way', () => {
    const between = (DRAFT_IN_PERCENT + DRAFT_OUT_PERCENT) / 2;
    expect(DRAFT_OUT_PERCENT).toBeLessThan(DRAFT_IN_PERCENT);
    expect(
      said([DRAFT_IN_PERCENT, between, DRAFT_IN_PERCENT - 0.1, between, DRAFT_OUT_PERCENT]),
    ).toEqual([DRAFT_SPOKEN.into(DRAFT_IN_PERCENT), undefined, undefined, undefined, undefined]);
    expect(said([DRAFT_IN_PERCENT - 0.1, between, DRAFT_OUT_PERCENT - 0.1])).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });

  it('never tells the leading rider they are drafting: the front of a line gets 1–2 %', () => {
    expect(said([1, 2, 2.4, 1])).toEqual([undefined, undefined, undefined, undefined]);
  });

  it('says nothing in a room with drafting off or before a frame, and is not left “in” by one', () => {
    expect(said(['off', 'off', undefined])).toEqual([undefined, undefined, undefined]);
    expect(draftEvent(true, 'off')).toEqual({ inDraft: false });
    expect(draftEvent(true, undefined)).toEqual({ inDraft: false });
    // …so going back into a draft afterwards is said again, as news.
    expect(draftEvent(false, 30).event).toEqual({
      kind: 'room-draft',
      text: DRAFT_SPOKEN.into(30),
    });
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

describe('the race a ride was in, for the device to keep — #785', () => {
  it('is the room’s order and this rider’s place in it, or a race left while it ran, and nothing else', () => {
    expect(raceFactOf('room-1', { kind: 'finished', order: [4, 2, 9], place: 2 }, false)).toEqual({
      roomId: 'room-1',
      place: 2,
      finishers: 3,
    });
    expect(raceFactOf('room-1', { kind: 'finished', order: [4], place: null }, false)).toEqual({
      roomId: 'room-1',
      place: null,
      finishers: 1,
    });
    expect(raceFactOf('room-1', { kind: 'running' }, false)).toEqual({
      roomId: 'room-1',
      place: null,
      finishers: null,
    });
    // Nothing was raced: a group ride, a race never started, no room.
    expect(raceFactOf('room-1', { kind: 'not-a-race' }, true)).toBeUndefined();
    expect(raceFactOf('room-1', { kind: 'waiting' }, false)).toBeUndefined();
    expect(raceFactOf('room-1', { kind: 'counting', endsAtLocalMs: 5 }, false)).toBeUndefined();
    expect(raceFactOf(undefined, { kind: 'running' }, true)).toBeUndefined();
  });

  it('keeps that the rider crossed the line when they left before the room’s order — and the room’s order over it once heard (#1360’s review, N2)', () => {
    expect(raceFactOf('room-1', { kind: 'running' }, true)).toEqual({
      roomId: 'room-1',
      place: null,
      finishers: null,
      crossedTheLine: true,
    });
    // The order heard is the room's word on who finished, whatever the device saw.
    expect(raceFactOf('room-1', { kind: 'finished', order: [4], place: null }, true)).toEqual({
      roomId: 'room-1',
      place: null,
      finishers: 1,
    });
    expect(raceFactOf('room-1', { kind: 'finished', order: [1, 4], place: 1 }, true)).toEqual({
      roomId: 'room-1',
      place: 1,
      finishers: 2,
    });
  });
});

describe('a place among the riders already across, from the room’s standings — #1364', () => {
  const row = (riderId: number, flags: number, you = false) => ({
    riderId,
    displayName: undefined,
    you,
    gapSeconds: 0,
    wattsPerKilogram: 0,
    flags,
  });
  const ACROSS = FLAG_FINISHED;

  it('is this rider’s place among the rows the room flags across, and how many it flags', () => {
    // The room's order: finishers first, by their finish, then the road.
    const standings = {
      tick: 9,
      rows: [row(3, ACROSS), row(0, ACROSS | FLAG_PLAUSIBILITY, true), row(5, ACROSS), row(7, 0)],
    };
    expect(placeAcrossOf(standings)).toEqual({ place: 2, across: 3 });
    expect(placeAcrossOf({ tick: 9, rows: [row(0, ACROSS, true), row(7, 0)] })).toEqual({
      place: 1,
      across: 1,
    });
  });

  it('is nothing with no standings, or where the room does not have this rider across', () => {
    expect(placeAcrossOf(undefined)).toBeUndefined();
    expect(placeAcrossOf({ tick: 9, rows: [] })).toBeUndefined();
    expect(placeAcrossOf({ tick: 9, rows: [row(3, ACROSS), row(0, 0, true)] })).toBeUndefined();
    expect(placeAcrossOf({ tick: 9, rows: [row(3, ACROSS), row(5, ACROSS)] })).toBeUndefined();
  });

  it('is kept with the race only for a rider across the line before the room’s order', () => {
    const placed = { place: 2, across: 5 };
    expect(raceFactOf('room-1', { kind: 'running' }, true, placed)).toEqual({
      roomId: 'room-1',
      place: null,
      finishers: null,
      crossedTheLine: true,
      placeAcross: 2,
      across: 5,
    });
    // Not across by the room's distance: a race left, and no place.
    expect(raceFactOf('room-1', { kind: 'running' }, false, placed)).toEqual({
      roomId: 'room-1',
      place: null,
      finishers: null,
    });
    // The room's order heard: that is the place, and the standings' is not kept.
    expect(
      raceFactOf('room-1', { kind: 'finished', order: [4, 0], place: 2 }, true, placed),
    ).toEqual({ roomId: 'room-1', place: 2, finishers: 2 });
  });
});

describe('whether the room has this rider across the line — #1360’s re-review (R1, R2)', () => {
  const at = (metres: number) => ({
    own: () => ({
      rider: { distanceMetres: metres } as DrawnRemoteRider,
      atLocalMs: 0,
    }),
  });
  it('is the room’s own distance against the line: on it or past it is across, short of it is not', () => {
    expect(acrossTheRoomsLine(at(60), 60)).toBe(true);
    expect(acrossTheRoomsLine(at(60.1), 60)).toBe(true);
    expect(acrossTheRoomsLine(at(59.9), 60)).toBe(false);
    expect(acrossTheRoomsLine(at(57), 60)).toBe(false);
  });
  it('is not, with no word from the room on this rider, or no line', () => {
    expect(acrossTheRoomsLine({ own: () => undefined }, 60)).toBe(false);
    expect(acrossTheRoomsLine(undefined, 60)).toBe(false);
    expect(acrossTheRoomsLine(at(100), undefined)).toBe(false);
  });
});

describe('the room’s notice says a paused recording — #1360’s review (N1)', () => {
  it('says it while in a room with the recording paused, and gives the room’s own word first', () => {
    const joined = { kind: 'joined', riderId: 0, config: {} } as unknown as RoomSessionStatus;
    expect(roomRideNotice(joined, true)).toBe(ROOM_RECORDING_PAUSED_TEXT);
    expect(roomRideNotice({ kind: 'connecting' }, true)).toBe(ROOM_RECORDING_PAUSED_TEXT);
    expect(roomRideNotice(joined, false)).toBeUndefined();
    // No room: nothing, paused or not.
    expect(roomRideNotice(undefined, true)).toBeUndefined();
    // The room's own trouble is said in the slot instead.
    expect(roomRideNotice({ kind: 'gone' }, true)).toBe(ROOM_GONE_TEXT);
  });
});
