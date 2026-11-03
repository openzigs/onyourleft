// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The room core, authoritative for a lap race with items — #1909, ADR 0060.
 *
 * Every assertion reads the room's answer from the frames it sends, the
 * messages a client decodes, except where a criterion is about the room's own
 * view (a seat's state). `lap-race-conformance.test.ts` holds the same race
 * to every adapter, over real sockets.
 */

import { describe, expect, it } from 'vitest';

import { RACE_OFFSET_BOUND_METRES } from '@onyourleft/domain';
import { advance, ridingConditions, START_OF_RIDE } from '@onyourleft/physics';
import {
  decodeRoomMessage,
  encodeMessage,
  FLAG_PLAUSIBILITY,
  type Frame,
  type FrameRider,
  type ItemEvent,
} from '@onyourleft/protocol';
import { gradePercent, kilograms, seconds, watts } from '@onyourleft/domain';

import type { Outbound, Room } from './room.ts';
import {
  FLAT_COURSE,
  helloText,
  laneText,
  lastFrame,
  reportText,
  sentTo,
  testRoom,
  useText,
} from './room-testing.ts';
import { RoomSettingsError, roomSettings, type RoomSettingsInput } from './settings.ts';

const SECOND = 1000;
const LAP = { ...FLAT_COURSE, lengthMetres: 400 };

/** Ann (connection 1, rider 0) and Bea (connection 2, rider 1) on the line of a three-lap race. */
function lapRace(
  lapRace: Partial<NonNullable<RoomSettingsInput['lapRace']>> = {},
  input: Partial<RoomSettingsInput> = {},
  masses: Readonly<Record<string, number>> = {},
): Room {
  const room = testRoom(
    {
      countdownMs: 0,
      course: LAP,
      lapRace: { laps: 3, items: true, seed: 2, ...lapRace },
      ...input,
    },
    masses,
  );
  room.receive(1, helloText('ticket-ann'), 0);
  room.receive(2, helloText('ticket-bea'), 0);
  room.start(0);
  return room;
}

/** What each connection sends in second `t`: its power, and any inputs. */
interface Second {
  readonly power?: Readonly<Record<number, number>>;
  /** Inputs, as text, by connection, sent after the reports. */
  readonly inputs?: Readonly<Record<number, readonly string[]>>;
}

/** Second `t`: reports at t + 0.5 s, inputs at t + 0.6 s, the tick at t + 1 s. */
function second(room: Room, t: number, what: Second = {}): Outbound[] {
  const now = t * SECOND;
  for (const [connection, power] of Object.entries(what.power ?? { 1: 260, 2: 240 })) {
    room.receive(Number(connection), reportText(t, now + 500, power), now + 500);
  }
  for (const [connection, texts] of Object.entries(what.inputs ?? {})) {
    for (const text of texts) room.receive(Number(connection), text, now + 600);
  }
  return room.tick(now + SECOND);
}

/** The frame connection `to` was sent in `out`, through the decoder a client runs. */
function frameTo(out: readonly Outbound[], to: number): Frame {
  const decoded = decodeRoomMessage(encodeMessage(lastFrame(out, to)));
  if (!decoded.ok || decoded.message.type !== 'frame') throw new Error('not a frame');
  return decoded.message;
}

function riderIn(frame: Frame, riderId: number): FrameRider {
  const rider = frame.riders.find((each) => each.riderId === riderId);
  if (rider === undefined) throw new Error(`no rider ${String(riderId)} in the frame`);
  return rider;
}

function eventsOf(frame: Frame, riderId: number, event: ItemEvent['event']): ItemEvent[] {
  return (frame.itemEvents ?? []).filter((e) => e.riderId === riderId && e.event === event);
}

/** Ride seconds `from` to `to` − 1, every second the same, and return each frame Ann was sent. */
function ride(room: Room, from: number, to: number, what: (t: number) => Second = () => ({})) {
  const frames: Frame[] = [];
  for (let t = from; t < to; t += 1) frames.push(frameTo(second(room, t, what(t)), 1));
  return frames;
}

describe('a lap race’s settings and welcome — #1909', () => {
  it('welcomes a rider to the race’s laps and items, and never names its seed', () => {
    const room = testRoom({ lapRace: { laps: 4, items: false, seed: 77 } });
    const welcome = sentTo(room.receive(1, helloText('ticket-ann'), 0), 1)[0];
    expect(welcome).toMatchObject({
      type: 'welcome',
      roomConfig: { kind: 'race', lapRace: { laps: 4, items: 'off' } },
    });
    expect(JSON.stringify(welcome)).not.toContain('77');
  });

  it('refuses a lap race that is a group ride, or whose laps or seed are out of range', () => {
    const base = { kind: 'race', ridingPosition: 'hoods', course: LAP } as const;
    expect(() =>
      roomSettings({ ...base, kind: 'ride', lapRace: { laps: 3, items: true, seed: 1 } }),
    ).toThrow(RoomSettingsError);
    for (const bad of [
      { laps: 0, seed: 1 },
      { laps: 101, seed: 1 },
      { laps: 2.5, seed: 1 },
      { laps: 3, seed: -1 },
      { laps: 3, seed: 0.5 },
      { laps: 3, seed: 2 ** 32 },
    ]) {
      expect(() => roomSettings({ ...base, lapRace: { ...bad, items: true } })).toThrow(
        RoomSettingsError,
      );
    }
    expect(
      roomSettings({ ...base, lapRace: { laps: 100, items: true, seed: 2 ** 32 - 1 } }).lapRace,
    ).toEqual({ laps: 100, items: true, seed: 2 ** 32 - 1 });
  });

  it('sends a race that is not a lap race exactly as before: five slots, no events', () => {
    const room = testRoom({ countdownMs: 0, course: LAP });
    room.receive(1, helloText('ticket-ann'), 0);
    room.start(0);
    const frame = frameTo(
      second(room, 0, { power: { 1: 250 }, inputs: { 1: [useText(1, 600)] } }),
      1,
    );
    expect(Object.keys(riderIn(frame, 0)).sort()).toEqual(
      ['centimetresPerSecond', 'decimetres', 'draftPercent', 'flags', 'riderId'].sort(),
    );
    expect(frame.itemEvents).toBeUndefined();
  });
});

describe('the room’s answer is in every frame — #1909', () => {
  it('carries every rider’s offset, lane, held item and laps, and the tick’s pick-ups', () => {
    const room = lapRace();
    const frames = ride(room, 0, 30);
    expect(riderIn(frames[0] as Frame, 0)).toMatchObject({
      raceOffsetCentimetres: 0,
      lane: 1,
      held: 'none',
      lapsDone: 0,
    });
    // A quarter of a 400 m lap is the first pick-up: both riders draw there.
    const pickedUp = frames.findIndex((frame) => eventsOf(frame, 0, 'pick-up').length > 0);
    expect(pickedUp).toBeGreaterThan(0);
    const frame = frames[pickedUp] as Frame;
    expect(riderIn(frame, 0).held).toBe(eventsOf(frame, 0, 'pick-up')[0]?.item);
    expect(riderIn(frame, 0).decimetres).toBeGreaterThanOrEqual(1_000);
  });

  it('sends the EFFORT distance as a rider’s position, never the drawn one — ADR 0060 D-5.4', () => {
    const room = lapRace();
    const frames = ride(room, 0, 60, (t) => ({
      inputs: { 1: [useText(t + 1, 0)], 2: [useText(t + 1, 0)] },
    }));
    // Find a tick where a rider's offset is not 0: an item moved them.
    const moved = frames.flatMap((frame) =>
      frame.riders.filter((rider) => (rider.raceOffsetCentimetres ?? 0) !== 0),
    );
    expect(moved.length).toBeGreaterThan(0);
    const view = room.view().seats;
    const last = frames.at(-1) as Frame;
    for (const seat of view) {
      expect(riderIn(last, seat.riderId).decimetres).toBe(Math.floor(seat.distanceMetres * 10));
    }
  });

  it('never lets a lane reach the physics or the draft — ADR 0060 D-6.2', () => {
    // Items off, so a lane can decide no hit: two races differ only in Ann
    // weaving between lanes, and every rider's distance, speed and draft agree.
    const straight = lapRace({ items: false });
    const weaving = lapRace({ items: false });
    const a = ride(straight, 0, 40);
    const b = ride(weaving, 0, 40, (t) => ({ inputs: { 1: [laneText(t + 1, 0, t % 3)] } }));
    const physics = (frames: readonly Frame[]) =>
      frames.map((frame) =>
        frame.riders.map(({ decimetres, centimetresPerSecond, draftPercent }) => [
          decimetres,
          centimetresPerSecond,
          draftPercent,
        ]),
      );
    expect(physics(b)).toEqual(physics(a));
    // Non-vacuity: Ann did weave, and Bea sat in her draft.
    expect(new Set(b.map((frame) => riderIn(frame, 0).lane))).toEqual(new Set([0, 1, 2]));
    expect(Math.max(...a.map((frame) => riderIn(frame, 1).draftPercent))).toBeGreaterThan(0);
  });

  it('reads the grade round the lap at the effort distance', () => {
    // A 400 m loop that climbs at 4 % from 100 m to 300 m of every lap. Ann's
    // ride in the room must be the physics' own ride with the grade read at
    // her distance modulo the lap.
    const climb = (metres: number) => (metres >= 100 && metres < 300 ? 4 : 0);
    const room = testRoom({
      countdownMs: 0,
      course: { ...LAP, gradePercentAt: climb },
      lapRace: { laps: 3, items: false, seed: 1 },
    });
    room.receive(1, helloText('ticket-ann'), 0);
    room.start(0);
    let expected = START_OF_RIDE;
    const conditions = ridingConditions(kilograms(70), 'hoods');
    for (let t = 0; t < 110; t += 1) {
      second(room, t, { power: { 1: 250 } });
      expected = advance(
        expected,
        {
          power: watts(250),
          grade: gradePercent(climb(expected.distance % 400)),
          duration: seconds(1),
        },
        conditions,
      );
    }
    // Into the second lap's climb, where a grade read at the raw distance would be 0.
    expect(expected.distance).toBeGreaterThan(550);
    expect(room.view().seats[0]?.distanceMetres).toBe(expected.distance);
  });
});

describe('inputs, never outcomes — #1909', () => {
  it('changes nothing in the next frame for a use with nothing held, and never queues it', () => {
    const plain = lapRace();
    const spammed = lapRace();
    const quiet = ride(plain, 0, 40);
    // Bea presses use every second before she holds anything, and never after.
    const pressed = ride(spammed, 0, 40, (t) =>
      t < 10 ? { inputs: { 2: Array.from({ length: 5 }, (_, i) => useText(t * 10 + i, 0)) } } : {},
    );
    expect(pressed).toEqual(quiet);
    // …and Bea, who picked something up after, still holds it: nothing fired by itself.
    const bea = quiet.map((frame) => riderIn(frame, 1).held);
    expect(bea.some((held) => held !== 'none')).toBe(true);
  });

  it('admits at most one use a tick from 100 sent in a second', () => {
    const room = lapRace();
    const frames = ride(room, 0, 30);
    const holding = frames.findIndex((frame) => riderIn(frame, 1).held !== 'none');
    expect(holding).toBeGreaterThan(0);
    // 100 uses inside one second, every one with a fresh sequence.
    const burst = second(room, 30, {
      inputs: { 2: Array.from({ length: 100 }, (_, i) => useText(i + 1, 0)) },
    });
    expect(eventsOf(frameTo(burst, 1), 1, 'use')).toHaveLength(1);
    // And nothing more fires on later ticks with no further press.
    const after = ride(room, 31, 80);
    expect(after.flatMap((frame) => eventsOf(frame, 1, 'use'))).toEqual([]);
  });

  it('takes a lane in the next frame, and refuses one sent with a spent sequence or out of order', () => {
    const room = lapRace();
    // Before the race runs, nothing is admitted: its first tick is at 1 s.
    let frame = frameTo(second(room, 0, { inputs: { 1: [laneText(1, 0, 0)] } }), 1);
    expect(riderIn(frame, 0).lane).toBe(1);
    frame = frameTo(second(room, 1, { inputs: { 1: [laneText(5, 0, 0)] } }), 1);
    expect(riderIn(frame, 0).lane).toBe(0);
    frame = frameTo(second(room, 2, { inputs: { 1: [laneText(5, 0, 2)] } }), 1);
    expect(riderIn(frame, 0).lane).toBe(0);
    frame = frameTo(second(room, 3, { inputs: { 1: [laneText(4, 0, 2)] } }), 1);
    expect(riderIn(frame, 0).lane).toBe(0);
    frame = frameTo(second(room, 4, { inputs: { 1: [laneText(6, 0, 2)] } }), 1);
    expect(riderIn(frame, 0).lane).toBe(2);
    // Held through a tick with no input.
    expect(riderIn(frameTo(second(room, 5), 1), 0).lane).toBe(2);
  });

  it('ignores a use in a race with items off: no pick-ups, no events, no offset', () => {
    const room = lapRace({ items: false });
    const frames = ride(room, 0, 60, (t) => ({ inputs: { 1: [useText(t + 1, 0)] } }));
    expect(frames.flatMap((frame) => frame.itemEvents ?? [])).toEqual([]);
    for (const frame of frames) {
      for (const rider of frame.riders) {
        expect(rider).toMatchObject({ raceOffsetCentimetres: 0, held: 'none' });
      }
    }
  });
});

describe('effort dominates in the room — ADR 0060 D-4, #1909', () => {
  it('finishes first the rider who leads on effort by more than 2B, with the other using every item on them', () => {
    // Drafting off, so Bea gains nothing from sitting on Ann's wheel but the items.
    const room = lapRace({ seed: 2 }, { drafting: false });
    let finish: number[] | undefined;
    const events: ItemEvent[] = [];
    let margin = 0;
    for (let t = 0; t < 400 && finish === undefined; t += 1) {
      // Bea presses use every second and keeps to Ann's lane.
      const out = second(room, t, {
        power: { 1: 285, 2: 250 },
        inputs: { 2: [useText(t * 2 + 1, 0)] },
      });
      const frame = frameTo(out, 2);
      events.push(...(frame.itemEvents ?? []));
      const ann = riderIn(frame, 0);
      const bea = frame.riders.find((rider) => rider.riderId === 1);
      if (ann.lapsDone === 3 && margin === 0 && bea !== undefined) {
        margin = (ann.decimetres - bea.decimetres) / 10;
      }
      const message = sentTo(out, 2).find((m) => m.type === 'finish');
      if (message?.type === 'finish') finish = [...message.order];
    }
    // The precondition: at Ann's line, her effort lead is past 2B.
    expect(margin).toBeGreaterThan(2 * RACE_OFFSET_BOUND_METRES);
    // Bea used items, and they reached Ann.
    expect(events.filter((e) => e.riderId === 1 && e.event === 'use').length).toBeGreaterThan(3);
    expect(events.filter((e) => e.riderId === 0 && e.event === 'hit').length).toBeGreaterThan(0);
    expect(finish).toEqual([0, 1]);
  });
});

describe('rules 2 and 3 with items on — ADR 0028 D-2, #1909', () => {
  it('flags a rider whose power is implausible and goes on racing them', () => {
    const room = lapRace({}, {}, { ann: 40 });
    let frame: Frame | undefined;
    for (let t = 0; t < 8; t += 1)
      frame = frameTo(second(room, t, { power: { 1: 800, 2: 240 } }), 2);
    const ann = riderIn(frame as Frame, 0);
    expect(ann.flags & FLAG_PLAUSIBILITY).toBe(FLAG_PLAUSIBILITY);
    expect(ann.lane).toBe(1);
    expect(room.view().seats[0]?.state).toBe('connected');
    const before = ann.decimetres;
    expect(
      riderIn(frameTo(second(room, 8, { power: { 1: 800, 2: 240 } }), 2), 0).decimetres,
    ).toBeGreaterThan(before);
  });
});

describe('a dropped rider keeps their place in the race — #1909', () => {
  /** Ann picks up, is hit, steers to lane 2, drops at 32 s; `rejoin` brings her back at 35.5 s. */
  function dropped(rejoin: boolean): Frame {
    const room = lapRace();
    ride(room, 0, 32, (t) => ({
      inputs: {
        // Bea uses whatever she holds; Ann steers once, after her pick-up.
        1: t === 25 ? [laneText(1, 0, 2)] : [],
        2: [useText(t + 1, 0)],
      },
    }));
    room.disconnect(1, 32 * SECOND + 1);
    for (let t = 32; t < 35; t += 1) second(room, t, { power: { 2: 240 } });
    if (rejoin) room.receive(9, helloText('ticket-ann'), 35 * SECOND + 500);
    return frameTo(second(room, 35, { power: { 2: 240 } }), 2);
  }

  it('has the same held item, lane and offset in the next frame after a rejoin', () => {
    const away = riderIn(dropped(false), 0);
    const back = riderIn(dropped(true), 0);
    expect(away).toMatchObject({ lane: 2 });
    expect(away.held).not.toBe('none');
    expect(away.raceOffsetCentimetres).not.toBe(0);
    expect({
      lane: back.lane,
      held: back.held,
      raceOffsetCentimetres: back.raceOffsetCentimetres,
      lapsDone: back.lapsDone,
    }).toEqual({
      lane: away.lane,
      held: away.held,
      raceOffsetCentimetres: away.raceOffsetCentimetres,
      lapsDone: away.lapsDone,
    });
  });
});
