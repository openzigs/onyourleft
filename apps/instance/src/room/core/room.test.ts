// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { gradePercent, kilograms, seconds, watts } from '@onyourleft/domain';
import { advance, ridingConditions, START_OF_RIDE } from '@onyourleft/physics';
import {
  encodeMessage,
  FLAG_COASTING,
  FLAG_PLAUSIBILITY,
  MAXIMUM_REPORTED_POWER_WATTS,
} from '@onyourleft/protocol';

import { FINISH_CUT_OFF_TICKS, type Outbound, type Room } from './room.ts';
import {
  closed,
  COURSE_SHA256,
  FLAT_COURSE,
  helloText,
  lastFrame,
  reportText,
  sentTo,
  testRoom,
} from './room-testing.ts';
import {
  DEFAULT_ROOM_CAPACITY,
  MAXIMUM_ROOM_CAPACITY,
  RoomSettingsError,
  roomSettings,
} from './settings.ts';

const SECOND = 1000;

/** Join `athletes` on connections 1, 2, … and start the race at room time 0, running from 0. */
function runningRace(athletes: readonly string[], input: Parameters<typeof testRoom>[0] = {}) {
  const room = testRoom({ countdownMs: 0, ...input });
  athletes.forEach((athlete, index) => {
    room.receive(index + 1, helloText(`ticket-${athlete}`), 0);
  });
  room.start(0);
  return room;
}

/**
 * One second of a room: each named connection reports `power` (a sequence per
 * second, stamped on its own clock), then the room ticks at the end of it.
 */
function second(room: Room, t: number, reports: Readonly<Record<number, number>>): Outbound[] {
  const now = t * SECOND;
  for (const [connection, power] of Object.entries(reports)) {
    const c = Number(connection);
    room.receive(c, reportText(t, now + 500, power), now + 500);
  }
  return room.tick(now + SECOND);
}

function distanceOf(room: Room, riderId: number): number {
  const seat = room.view().seats.find((s) => s.riderId === riderId);
  if (seat === undefined) throw new Error('no such rider');
  return seat.distanceMetres;
}

describe('the handshake — ADR 0028 D-2 rule 5', () => {
  it('welcomes a rider on this build with a seat, the route by hash and the race’s position', () => {
    const room = testRoom();
    const out = room.receive(7, helloText('ticket-ann'), 0);
    expect(sentTo(out, 7)).toEqual([
      {
        type: 'welcome',
        riderId: 0,
        routeRef: { sha256: COURSE_SHA256 },
        roomConfig: {
          kind: 'race',
          ridingPosition: 'hoods',
          reportIntervalMs: 500,
          frameIntervalMs: 1000,
        },
      },
    ]);
    expect(closed(out)).toEqual([]);
  });

  it('refuses a physics version it does not share, and closes', () => {
    const room = testRoom();
    const out = room.receive(1, helloText('ticket-ann', { physicsVersion: 1 }), 0);
    expect(sentTo(out, 1)).toEqual([{ type: 'refuse', reason: 'physics-mismatch' }]);
    expect(closed(out)).toEqual([1]);
    expect(room.view().seats).toEqual([]);
  });

  it('refuses a protocol it does not share, and closes', () => {
    const room = testRoom();
    const out = room.receive(1, helloText('ticket-ann', { protocol: 2 }), 0);
    expect(sentTo(out, 1)).toEqual([{ type: 'refuse', reason: 'protocol-mismatch' }]);
    expect(closed(out)).toEqual([1]);
  });

  it('refuses a ticket its admission does not accept, and a declared mass rule 1 does not', () => {
    const room = testRoom({}, { heavy: 900 });
    expect(sentTo(room.receive(1, helloText('forged'), 0), 1)).toEqual([
      { type: 'refuse', reason: 'ticket-refused' },
    ]);
    expect(sentTo(room.receive(2, helloText('ticket-heavy'), 0), 2)).toEqual([
      { type: 'refuse', reason: 'ticket-refused' },
    ]);
  });

  it('closes a connection that reports before it says hello, or sends what is not a message', () => {
    const room = testRoom();
    expect(closed(room.receive(1, reportText(1, 0, 200), 0))).toEqual([1]);
    const garbage = room.receive(2, '{"type":"frame"}', 0);
    expect(closed(garbage)).toEqual([2]);
    expect(sentTo(garbage, 2)).toEqual([]);
  });
});

describe('capacity — ruling Q4', () => {
  it('holds 50 by default and refuses the 51st with a reason', () => {
    const room = testRoom();
    for (let i = 0; i < DEFAULT_ROOM_CAPACITY; i += 1) {
      expect(sentTo(room.receive(i, helloText(`ticket-r${String(i)}`), 0), i)[0]?.type).toBe(
        'welcome',
      );
    }
    const out = room.receive(99, helloText('ticket-late'), 0);
    expect(sentTo(out, 99)).toEqual([{ type: 'refuse', reason: 'room-full' }]);
    expect(closed(out)).toEqual([99]);
  });

  it('holds up to 100 when configured, and refuses 101 at start-up', () => {
    const room = testRoom({ capacity: MAXIMUM_ROOM_CAPACITY });
    for (let i = 0; i < MAXIMUM_ROOM_CAPACITY; i += 1) {
      room.receive(i, helloText(`ticket-r${String(i)}`), 0);
    }
    expect(room.view().seats).toHaveLength(100);
    expect(sentTo(room.receive(500, helloText('ticket-x'), 0), 500)[0]).toEqual({
      type: 'refuse',
      reason: 'room-full',
    });
    expect(() => testRoom({ capacity: 101 })).toThrow(RoomSettingsError);
    expect(() => testRoom({ capacity: 0 })).toThrow(RoomSettingsError);
    expect(() => testRoom({ capacity: 50.5 })).toThrow(RoomSettingsError);
  });
});

describe('the rest of the settings a room is refused over', () => {
  it('refuses a power limit above what a report can carry — the 2500 W wire bound', () => {
    const base = { kind: 'race', ridingPosition: 'hoods', course: FLAT_COURSE } as const;
    const limits = (maximumPowerWatts: number) => ({
      maximumPowerWatts,
      minimumMassKilograms: 20,
      maximumMassKilograms: 300,
      ceilings: [],
    });
    expect(() =>
      roomSettings({ ...base, limits: limits(MAXIMUM_REPORTED_POWER_WATTS + 1) }),
    ).toThrow(RoomSettingsError);
    expect(roomSettings({ ...base, limits: limits(2000) }).limits.maximumPowerWatts).toBe(2000);
    expect(() => roomSettings({ ...base, limits: limits(0) })).toThrow(RoomSettingsError);
  });

  it('refuses a course with no hash or no length, and a negative duration', () => {
    const base = { kind: 'ride', ridingPosition: 'drops', course: FLAT_COURSE } as const;
    expect(() => roomSettings({ ...base, course: { ...FLAT_COURSE, sha256: 'AB' } })).toThrow(
      RoomSettingsError,
    );
    expect(() => roomSettings({ ...base, course: { ...FLAT_COURSE, lengthMetres: 0 } })).toThrow(
      RoomSettingsError,
    );
    expect(() => roomSettings({ ...base, rejoinWindowMs: -1 })).toThrow(RoomSettingsError);
    expect(() => roomSettings({ ...base, reportSlack: { lateMs: 1.5, earlyMs: 0 } })).toThrow(
      RoomSettingsError,
    );
  });
});

describe('re-simulation agrees with the physics digit for digit — #779, ADR 0028 D-1', () => {
  // The powers of `packages/physics/src/agreement.test.ts`' TRACE, and its
  // grade by distance; the expected strings are its §"the room's
  // configuration" vectors, restated because a room may not import a test.
  const POWERS = [
    ...Array.from({ length: 20 }, () => 240),
    ...Array.from({ length: 20 }, () => 310),
    ...Array.from({ length: 20 }, () => 150),
  ];
  const COURSE = {
    ...FLAT_COURSE,
    gradePercentAt: (metres: number) => (metres < 150 ? 0 : metres < 300 ? 6.5 : -3.25),
  };
  const EXPECTED = {
    upright: { speed: '6.589710958414384', distance: '334.8060822533738' },
    hoods: { speed: '7.464954609002774', distance: '351.15003678706177' },
    drops: { speed: '8.31756864912602', distance: '369.1076290083885' },
  } as const;

  for (const position of ['upright', 'hoods', 'drops'] as const) {
    it(`puts a 74 kg rider in the ${position} where agreement.test.ts does`, () => {
      const r = testRoom({ countdownMs: 0, ridingPosition: position, course: COURSE }, { ann: 74 });
      r.receive(1, helloText('ticket-ann'), 0);
      r.start(0);
      POWERS.forEach((power, t) => second(r, t, { 1: power }));
      const [seat] = r.view().seats;
      expect(String(seat?.speedMetresPerSecond)).toBe(EXPECTED[position].speed);
      expect(String(seat?.distanceMetres)).toBe(EXPECTED[position].distance);
    });
  }
});

describe('coast, never extrapolate — ADR 0028 D-2 rule 1', () => {
  it('advances a rider whose reports stop at 0 W, not at their last power', () => {
    const room = runningRace(['ann']);
    for (let t = 0; t < 10; t += 1) second(room, t, { 1: 300 });
    const before = room.view().seats[0];
    let out: Outbound[] = [];
    for (let t = 10; t < 15; t += 1) out = second(room, t, {});

    const conditions = ridingConditions(kilograms(70), 'hoods');
    const step = (power: number) => (state: typeof START_OF_RIDE) =>
      advance(
        state,
        { power: watts(power), grade: gradePercent(0), duration: seconds(1) },
        conditions,
      );
    let coasted = {
      speed: before?.speedMetresPerSecond,
      distance: before?.distanceMetres,
    } as typeof START_OF_RIDE;
    let extrapolated = coasted;
    for (let i = 0; i < 5; i += 1) {
      coasted = step(0)(coasted);
      extrapolated = step(300)(extrapolated);
    }
    expect(distanceOf(room, 0)).toBe(coasted.distance);
    expect(distanceOf(room, 0)).not.toBe(extrapolated.distance);
    expect(lastFrame(out, 1).riders[0]?.flags).toBe(FLAG_COASTING);
  });

  it('coasts a rider whose only report in a tick was refused, and flags nothing for it', () => {
    // Out of rule 1's range for a room that lowered it: admissible on the wire, not here.
    const low = runningRace(['bob'], {
      limits: {
        maximumPowerWatts: 400,
        minimumMassKilograms: 20,
        maximumMassKilograms: 300,
        ceilings: [],
      },
    });
    second(low, 0, { 1: 250 });
    const out = second(low, 1, { 1: 900 });
    expect(lastFrame(out, 1).riders[0]?.flags).toBe(FLAG_COASTING);
  });
});

describe('what a seated rider sends that is not a report', () => {
  it('drops a malformed report without closing the rider, and coasts them', () => {
    const room = runningRace(['ann']);
    second(room, 0, { 1: 250 });
    const garbage = room.receive(1, '{"type":"report","sequence":1}', 1500);
    expect(garbage).toEqual([]);
    const out = room.tick(2 * SECOND);
    expect(lastFrame(out, 1).riders[0]?.flags).toBe(FLAG_COASTING);
  });

  it('ignores a second hello on a connection that already has a seat', () => {
    const room = runningRace(['ann']);
    expect(room.receive(1, helloText('ticket-bob'), 100)).toEqual([]);
    expect(room.view().seats.map((s) => s.athleteId)).toEqual(['ann']);
  });
});

describe('late and duplicate reports — rule 1, spike 0007 §9', () => {
  it('ignores a report whose sequence is not past the last admitted one', () => {
    const room = runningRace(['ann']);
    room.receive(1, reportText(5, 100, 200), 100);
    room.receive(1, reportText(5, 200, 900), 200); // a duplicate sequence, at a higher power
    room.receive(1, reportText(4, 300, 900), 300); // an older one
    const out = room.tick(SECOND);
    expect(lastFrame(out, 1).ackSequence).toBe(5);

    const control = runningRace(['ann']);
    control.receive(1, reportText(5, 100, 200), 100);
    control.tick(SECOND);
    expect(distanceOf(room, 0)).toBe(distanceOf(control, 0));
  });

  it('simulates the latest admitted sample at tick time, not the first or a mean', () => {
    const latest = runningRace(['ann']);
    latest.receive(1, reportText(1, 100, 100), 100);
    latest.receive(1, reportText(2, 600, 300), 600);
    latest.tick(SECOND);

    const only300 = runningRace(['ann']);
    only300.receive(1, reportText(2, 600, 300), 600);
    only300.tick(SECOND);
    expect(distanceOf(latest, 0)).toBe(distanceOf(only300, 0));
    expect(distanceOf(latest, 0)).toBeGreaterThan(0);
  });

  it('spends a report on one tick: silence after it is coasting', () => {
    const room = runningRace(['ann']);
    second(room, 0, { 1: 300 });
    const out = second(room, 1, {});
    expect(lastFrame(out, 1).riders[0]?.flags).toBe(FLAG_COASTING);
  });
});

describe('a client’s clock is not the room’s — #779, from #832’s review', () => {
  // The room's own clock reads like an epoch; each client's is somewhere else.
  const ROOM_EPOCH = 1_790_000_000_000;
  for (const [what, clientAt] of [
    ['an hour fast', (roomMs: number) => roomMs + 3_600_000],
    ['a day slow', (roomMs: number) => roomMs - 86_400_000],
    ['counting from when the tab opened', (roomMs: number) => roomMs - ROOM_EPOCH + 1_234],
  ] as const) {
    it(`does not coast an honest rider whose clock is ${what}`, () => {
      const room = testRoom({ countdownMs: 0 });
      room.receive(1, helloText('ticket-ann'), ROOM_EPOCH);
      room.start(ROOM_EPOCH);
      let out: Outbound[] = [];
      for (let t = 0; t < 20; t += 1) {
        // Delivery takes 20 to 300 ms, varying, as a real network does.
        const sampled = ROOM_EPOCH + t * SECOND + 400;
        room.receive(1, reportText(t, clientAt(sampled), 250), sampled + 20 + ((t * 97) % 280));
        out = room.tick(ROOM_EPOCH + (t + 1) * SECOND);
        expect(lastFrame(out, 1).riders[0]?.flags).toBe(0);
      }
      expect(lastFrame(out, 1).ackSequence).toBe(19);
    });
  }

  it('does not let one report held up in a queue move the clock the next is judged by', () => {
    const room = runningRace(['ann']);
    for (let t = 0; t < 5; t += 1) {
      room.receive(1, reportText(t, t * SECOND + 400, 250), t * SECOND + 420);
      room.tick((t + 1) * SECOND);
    }
    // Report 5 is sampled at 5.4 s and delivered 2.5 s late; the client, backgrounded,
    // samples nothing more until 8.4 s, and that one arrives promptly.
    room.tick(6 * SECOND);
    room.tick(7 * SECOND);
    room.receive(1, reportText(5, 5400, 250), 7900);
    room.tick(8 * SECOND);
    room.receive(1, reportText(6, 8400, 250), 8420);
    const out = room.tick(9 * SECOND);
    expect(lastFrame(out, 1).ackSequence).toBe(6);
    expect(lastFrame(out, 1).riders[0]?.flags).toBe(0);
  });

  it('does not coast a client far behind the room’s clock, and refuses a report stamped far ahead of its own timeline', () => {
    const room = runningRace(['ann']);
    const behind = 10_000; // the client's clock reads 10 s at room 1 000 010 ms
    const at = (roomMs: number) => roomMs - 1_000_000 + behind;
    const base = 1_000_000;
    room.receive(1, reportText(1, at(base + 500), 250), base + 500);
    room.tick(base + SECOND);
    room.receive(1, reportText(2, at(base + 1500), 250), base + 1500);
    let out = room.tick(base + 2 * SECOND);
    expect(lastFrame(out, 1).riders[0]?.flags).toBe(0);
    // Stamped a minute ahead of where this client's clock has been running.
    room.receive(1, reportText(3, at(base + 2500) + 60_000, 250), base + 2500);
    out = room.tick(base + 3 * SECOND);
    expect(lastFrame(out, 1).riders[0]?.flags).toBe(FLAG_COASTING);
    expect(lastFrame(out, 1).ackSequence).toBe(2);
  });
});

describe('rejoin — #16’s epic criterion', () => {
  it('gives a rider back the same seat and the same place within the window, on a new ticket for the same athlete', () => {
    const room = runningRace(['ann', 'bob']);
    for (let t = 0; t < 10; t += 1) second(room, t, { 1: 300, 2: 200 });
    room.disconnect(1, 10 * SECOND);
    for (let t = 10; t < 20; t += 1) second(room, t, { 2: 200 });
    const whereTheyWere = distanceOf(room, 0);

    const out = room.receive(9, helloText('ticket-ann'), 20 * SECOND + 1);
    expect(sentTo(out, 9)[0]).toMatchObject({ type: 'welcome', riderId: 0 });
    expect(distanceOf(room, 0)).toBe(whereTheyWere);
    expect(whereTheyWere).toBeGreaterThan(0);
    expect(room.view().seats).toHaveLength(2);
    // And rides on from there, on the new connection.
    second(room, 20, { 9: 300, 2: 200 });
    expect(distanceOf(room, 0)).toBeGreaterThan(whereTheyWere);
    expect(room.view().seats[0]?.state).toBe('connected');
  });

  it('coasts a held seat, and in a race, past the window, the rider did not finish and is refused', () => {
    const room = runningRace(['ann', 'bob'], { rejoinWindowMs: 5_000 });
    second(room, 0, { 1: 300, 2: 300 });
    room.disconnect(1, 1 * SECOND);
    let out: Outbound[] = [];
    for (let t = 1; t < 8; t += 1) out = second(room, t, { 2: 300 });
    expect(room.view().seats.find((s) => s.riderId === 0)?.state).toBe('dnf');
    expect(lastFrame(out, 2).riders.map((r) => r.riderId)).toEqual([1]);
    const refused = room.receive(9, helloText('ticket-ann'), 8 * SECOND);
    expect(sentTo(refused, 9)).toEqual([{ type: 'refuse', reason: 'room-closed' }]);
  });

  it('in a group ride, past the window, gives the seat up: a later hello is a new rider at the start', () => {
    const room = testRoom({ kind: 'ride', countdownMs: 0, rejoinWindowMs: 5_000 });
    room.receive(1, helloText('ticket-ann'), 0);
    room.receive(2, helloText('ticket-bob'), 0);
    for (let t = 0; t < 5; t += 1) second(room, t, { 1: 300, 2: 300 });
    room.disconnect(1, 5 * SECOND);
    for (let t = 5; t < 12; t += 1) second(room, t, { 2: 300 });
    expect(room.view().seats.map((s) => s.athleteId)).toEqual(['bob']);
    const out = room.receive(9, helloText('ticket-ann'), 12 * SECOND);
    expect(sentTo(out, 9)[0]).toMatchObject({ type: 'welcome', riderId: 2 });
    expect(distanceOf(room, 2)).toBe(0);
  });

  it('closes the older socket when the same athlete connects twice', () => {
    const room = runningRace(['ann']);
    const out = room.receive(5, helloText('ticket-ann'), 100);
    expect(closed(out)).toEqual([1]);
    expect(sentTo(out, 5)[0]).toMatchObject({ type: 'welcome', riderId: 0 });
    // The old socket's close, when it comes, does not drop the rider.
    room.disconnect(1, 200);
    expect(room.view().seats[0]?.state).toBe('connected');
  });
});

describe('a race — lobby, countdown, running, finished', () => {
  it('ticks nothing until the countdown is over, then frames every rider to every rider', () => {
    const room = testRoom({ countdownMs: 3_000 });
    room.receive(1, helloText('ticket-ann'), 0);
    room.receive(2, helloText('ticket-bob'), 0);
    expect(room.tick(1000)).toEqual([]);
    room.start(1000);
    expect(room.view().phase).toBe('countdown');
    expect(room.tick(2000)).toEqual([]);
    const out = room.tick(4000);
    expect(room.view().phase).toBe('running');
    expect(lastFrame(out, 1).riders.map((r) => r.riderId)).toEqual([0, 1]);
    expect(lastFrame(out, 2).tick).toBe(1);
  });

  it('refuses a new athlete once the race is running', () => {
    const room = runningRace(['ann']);
    room.tick(SECOND);
    expect(sentTo(room.receive(2, helloText('ticket-late'), 2 * SECOND), 2)).toEqual([
      { type: 'refuse', reason: 'room-closed' },
    ]);
  });

  it('gives back a lobby seat at once when its rider leaves before the start', () => {
    const room = testRoom();
    room.receive(1, helloText('ticket-ann'), 0);
    room.disconnect(1, 10);
    expect(room.view().seats).toEqual([]);
  });

  it('orders finishers by where in their tick they crossed the line, and sends the order', () => {
    const course = { ...FLAT_COURSE, lengthMetres: 100 };
    const room = runningRace(['ann', 'bob', 'cat'], { course });
    let out: Outbound[] = [];
    for (let t = 0; t < 60 && room.view().phase !== 'finished'; t += 1) {
      out = second(room, t, { 1: 250, 2: 400, 3: 320 });
    }
    expect(room.view().phase).toBe('finished');
    expect(room.view().finishOrder).toEqual([1, 2, 0]);
    expect(sentTo(out, 1).at(-1)).toEqual({ type: 'finish', order: [1, 2, 0] });
    expect(sentTo(room.receive(8, helloText('ticket-new'), 99 * SECOND), 8)).toEqual([
      { type: 'refuse', reason: 'room-closed' },
    ]);
  });

  it('does not finish a rider for anybody else’s crossing, and cuts the field off after the first finisher', () => {
    const course = { ...FLAT_COURSE, lengthMetres: 50 };
    const room = runningRace(['ann', 'bob'], { course });
    let t = 0;
    while (room.view().finishOrder.length === 0) second(room, t++, { 1: 300, 2: 0 });
    expect(room.view().seats.find((s) => s.riderId === 1)?.state).toBe('connected');
    for (let i = 0; i < FINISH_CUT_OFF_TICKS; i += 1) second(room, t++, { 2: 0 });
    expect(room.view().phase).toBe('finished');
    expect(room.view().finishOrder).toEqual([0]);
    expect(room.view().seats.find((s) => s.riderId === 1)?.state).toBe('dnf');
  });
});

describe('a group ride — starts on its first rider, closes when empty', () => {
  it('counts down from the first hello and closes after the grace once the last rider leaves', () => {
    const room = testRoom({
      kind: 'ride',
      countdownMs: 2_000,
      emptyGraceMs: 5_000,
      rejoinWindowMs: 1_000,
    });
    room.receive(1, helloText('ticket-ann'), 0);
    expect(room.view().phase).toBe('countdown');
    room.tick(2_000);
    expect(room.view().phase).toBe('running');
    room.disconnect(1, 3_000);
    room.tick(4_000);
    expect(room.view().phase).toBe('running');
    room.tick(8_000);
    expect(room.view().phase).toBe('closed');
    expect(sentTo(room.receive(2, helloText('ticket-bob'), 9_000), 2)).toEqual([
      { type: 'refuse', reason: 'room-closed' },
    ]);
  });

  it('stays open when a rider comes back inside the grace', () => {
    const room = testRoom({ kind: 'ride', countdownMs: 0, emptyGraceMs: 5_000 });
    room.receive(1, helloText('ticket-ann'), 0);
    room.tick(1_000);
    room.disconnect(1, 1_500);
    room.receive(2, helloText('ticket-ann'), 3_000);
    room.tick(9_000);
    expect(room.view().phase).toBe('running');
  });
});

describe('rule 2 flags, and never stops a rider — ADR 0028 D-2 rules 2 and 3', () => {
  it('flags a rider over the 5 s ceiling for their declared mass, and goes on simulating them', () => {
    const heavy = testRoom({ countdownMs: 0 }, { tiny: 40 });
    heavy.receive(1, helloText('ticket-tiny'), 0);
    heavy.start(0);
    let out: Outbound[] = [];
    for (let t = 0; t < 6; t += 1) out = second(heavy, t, { 1: 800 }); // 20 W/kg
    expect(lastFrame(out, 1).riders[0]?.flags).toBe(FLAG_PLAUSIBILITY);
    const moved = distanceOf(heavy, 0);
    second(heavy, 6, { 1: 800 });
    expect(distanceOf(heavy, 0)).toBeGreaterThan(moved);
  });
});

describe('determinism — the same calls give byte-identical frames', () => {
  function script(): string[] {
    const room = runningRace(['ann', 'bob', 'cat'], {
      course: { ...FLAT_COURSE, lengthMetres: 400 },
    });
    const wire: string[] = [];
    for (let t = 0; t < 90; t += 1) {
      const reports: Record<number, number> = { 1: 200 + t, 2: 350 - t };
      if (t % 7 !== 0) reports[3] = 280;
      const out = second(room, t, reports);
      for (const o of out)
        if (o.kind === 'send') wire.push(`${String(o.connection)} ${encodeMessage(o.message)}`);
      if (t === 30) room.disconnect(2, 30 * SECOND + 1);
      if (t === 40) room.receive(20, helloText('ticket-bob'), 40 * SECOND + 1);
    }
    return wire;
  }

  it('produces the same bytes twice, from two rooms built apart', () => {
    const first = script();
    expect(first.length).toBeGreaterThan(100);
    expect(script()).toEqual(first);
  });
});

describe('who can be in a room — ruling Q18', () => {
  it('has no way to add a rider but a hello: no bot pacer, no ghost', () => {
    expect(Object.keys(testRoom()).sort()).toEqual([
      'disconnect',
      'receive',
      'start',
      'tick',
      'view',
    ]);
  });
});
