// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A room's lap race from this rider's side — #1911: inputs sent, predictions
 * made and covered, the drawn offset eased, and the race the HUD reads built
 * from the room's own frame.
 */

import { describe, expect, it } from 'vitest';

import type { HeldItem } from '@onyourleft/protocol';

import type { RoomLapFrame, RoomLapRace, RoomLapRider } from '../../net/room-session';

import { SIDEWAYS_METRES_PER_SECOND } from '../lanes';

import {
  askRoomItem,
  askRoomLane,
  covers,
  OFFSET_EASE_SECONDS,
  roomLapRaceDrawing,
  roomLapRaceState,
  roomLapShown,
  startRoomLapRace,
  stepRoomLapRace,
  type RoomLapRaceRide,
} from './room-race';

const FRAME_MS = 1_000;

function rider(slots: Partial<RoomLapRider> = {}): RoomLapRider {
  return { effortMetres: 50, raceOffsetMetres: 0, lane: 1, held: 'none', lapsDone: 0, ...slots };
}

function frame(
  atLocalMs: number,
  riders: Readonly<Record<number, Partial<RoomLapRider>>>,
  extra: Partial<Pick<RoomLapFrame, 'ackSequence' | 'tick'>> = {},
): RoomLapFrame {
  return {
    tick: extra.tick ?? Math.round(atLocalMs / FRAME_MS),
    atLocalMs,
    ackSequence: extra.ackSequence,
    riders: new Map(Object.entries(riders).map(([id, slots]) => [Number(id), rider(slots)])),
    events: [],
  };
}

function race(newest: RoomLapFrame | undefined, items: 'on' | 'off' = 'on'): RoomLapRace {
  return { config: { laps: 3, items }, frameIntervalMs: FRAME_MS, riderId: 0, newest };
}

/** A sender that numbers what it sends, and keeps it. */
function sender(): {
  sent: { type: string; lane?: number; sequence: number }[];
  sendLane: (lane: number) => number;
  sendUse: () => number;
} {
  const sent: { type: string; lane?: number; sequence: number }[] = [];
  let next = 10;
  return {
    sent,
    sendLane: (lane) => {
      next += 1;
      sent.push({ type: 'lane', lane, sequence: next });
      return next;
    },
    sendUse: () => {
      next += 1;
      sent.push({ type: 'item-use', sequence: next });
      return next;
    },
  };
}

function start(newest?: RoomLapFrame): RoomLapRaceRide {
  return startRoomLapRace({
    race: race(newest),
    lapLengthMetres: 400,
    lineOffset: 0,
    nowLocalMs: 0,
  });
}

function step(
  ride: RoomLapRaceRide,
  nowLocalMs: number,
  newest: RoomLapFrame | undefined,
  send = sender(),
  ticks = 1,
  items: 'on' | 'off' = 'on',
): RoomLapRaceRide {
  return stepRoomLapRace(ride, {
    ticks,
    nowLocalMs,
    race: race(newest, items),
    sendLane: send.sendLane,
    sendUse: send.sendUse,
  });
}

describe('when a frame covers an input — #1911', () => {
  const sent = { sequence: 20, atLocalMs: 5_000 };

  it('covers once the room acknowledged a report sent after the input, before its tick', () => {
    expect(covers(frame(5_400, {}, { ackSequence: 21 }), sent, FRAME_MS)).toBe(true);
    expect(covers(frame(5_400, {}, { ackSequence: 20 }), sent, FRAME_MS)).toBe(false);
    expect(covers(frame(5_400, {}, { ackSequence: 19 }), sent, FRAME_MS)).toBe(false);
  });

  it('covers a whole frame interval after the input when no report was acknowledged', () => {
    expect(covers(frame(5_999, {}), sent, FRAME_MS)).toBe(false);
    expect(covers(frame(6_000, {}), sent, FRAME_MS)).toBe(true);
  });

  it('never covers with a frame from before the input, or none', () => {
    expect(covers(frame(4_900, {}, { ackSequence: 99 }), sent, FRAME_MS)).toBe(false);
    expect(covers(frame(5_000, {}, { ackSequence: 99 }), sent, FRAME_MS)).toBe(false);
    expect(covers(undefined, sent, FRAME_MS)).toBe(false);
  });
});

describe('an item use, predicted and then the room’s — #1911', () => {
  const holding = (atLocalMs: number, held: HeldItem, extra = {}) =>
    frame(atLocalMs, { 0: { held }, 1: { effortMetres: 60 } }, extra);

  it('sends a use only with an item shown held, and shows it gone at once', () => {
    const send = sender();
    let ride = askRoomItem(start());
    ride = step(ride, 100, holding(50, 'none'), send);
    expect(send.sent).toEqual([]);
    ride = askRoomItem(ride);
    ride = step(ride, 1_100, holding(1_050, 'tailwind'), send);
    expect(send.sent.map((each) => each.type)).toEqual(['item-use']);
    expect(roomLapShown(ride, race(holding(1_050, 'tailwind'))).held).toBe('none');
  });

  it('rolls a use the room never made back to the item it holds, within one frame interval after the next frame', () => {
    const send = sender();
    let ride = askRoomItem(start());
    ride = step(ride, 1_000, holding(900, 'tailwind'), send);
    // The next frame, 600 ms on: the room has not answered, and admitted no report since.
    const next = holding(1_600, 'tailwind');
    ride = step(ride, 1_600, next, send, 0);
    expect(roomLapShown(ride, race(next)).held).toBe('none');
    // The frame after: past one interval since the use, the room's word stands.
    const after = holding(2_600, 'tailwind');
    ride = step(ride, 2_600, after, send, 0);
    expect(roomLapShown(ride, race(after)).held).toBe('tailwind');
    expect(ride.useSent).toBeUndefined();
  });

  it('takes the room’s answer at the first frame that acknowledges a later report', () => {
    const send = sender();
    let ride = askRoomItem(start());
    ride = step(ride, 1_000, holding(900, 'tow'), send);
    const sequence = send.sent[0]?.sequence ?? 0;
    // The room made the use: the frame has no item, and acknowledges the next report.
    const answered = holding(1_400, 'none', { ackSequence: sequence + 1 });
    ride = step(ride, 1_400, answered, send, 0);
    expect(ride.useSent).toBeUndefined();
    expect(roomLapShown(ride, race(answered)).held).toBe('none');
  });

  it('predicts a tailwind’s own offset at its rate, and eases to the room’s when it overrules', () => {
    const send = sender();
    let ride = askRoomItem(start());
    ride = step(ride, 1_000, holding(900, 'tailwind'), send);
    // Two seconds on, the room has not answered: drawn toward +3 m (1.5 m/s for 2 s).
    for (let at = 1_050; at <= 3_000; at += 50)
      ride = step(ride, at, holding(900, 'tailwind'), send, 0);
    expect(ride.drawnOffset).toBeGreaterThan(2);
    expect(ride.drawnOffset).toBeLessThan(3);
    // The room overrules: a gust took them back to −4 m.
    const overruled = frame(
      3_100,
      { 0: { held: 'none', raceOffsetMetres: -4 } },
      { ackSequence: 99 },
    );
    ride = step(ride, 3_100, overruled, send, 0);
    // A slide, not a jump …
    expect(ride.drawnOffset).toBeGreaterThan(-4);
    for (let at = 3_150; at <= 3_100 + 10 * OFFSET_EASE_SECONDS * 1_000; at += 50) {
      ride = step(ride, at, overruled, send, 0);
    }
    // … to the room's.
    expect(ride.drawnOffset).toBeCloseTo(-4, 3);
  });

  it('sends no use with items off', () => {
    const send = sender();
    let ride = startRoomLapRace({
      race: race(undefined, 'off'),
      lapLengthMetres: 400,
      lineOffset: 0,
      nowLocalMs: 0,
    });
    ride = askRoomItem(ride);
    step(ride, 100, holding(50, 'tailwind'), send, 1, 'off');
    expect(send.sent).toEqual([]);
  });
});

describe('a step’s count of ticks — #1911', () => {
  it('refuses a count that is not a whole number of nought or more, naming no value', () => {
    for (const ticks of [-1, 0.5, Number.NaN]) {
      expect(() => step(start(), 0, undefined, sender(), ticks)).toThrow(
        /a whole number of ticks, 0 or more/u,
      );
    }
  });
});

describe('a lane, predicted and then the room’s — #1911', () => {
  it('sends a lane change once, shows it at once, and keeps it once the room has it', () => {
    const send = sender();
    let ride = askRoomLane(start(), 'lane-left');
    ride = step(ride, 100, frame(50, { 0: { lane: 1 } }), send);
    expect(send.sent).toEqual([{ type: 'lane', lane: 0, sequence: 11 }]);
    expect(roomLapShown(ride, race(frame(50, { 0: { lane: 1 } }))).lane).toBe(0);
    // More steps before the room answers send nothing more.
    ride = step(ride, 150, frame(50, { 0: { lane: 1 } }), send, 3);
    expect(send.sent).toHaveLength(1);
    const taken = frame(900, { 0: { lane: 0 } }, { ackSequence: 12 });
    ride = step(ride, 900, taken, send);
    expect(ride.laneSent).toBeUndefined();
    expect(roomLapShown(ride, race(taken)).lane).toBe(0);
    expect(send.sent).toHaveLength(1);
  });

  it('takes the room’s lane when nothing is asked: after a rejoin, the room’s lane, not the middle', () => {
    const send = sender();
    let ride = start();
    const restored = frame(5_000, { 0: { lane: 2, held: 'tow' } });
    ride = step(ride, 5_000, restored, send, 2);
    expect(ride.input.steer.lane).toBe(2);
    expect(roomLapShown(ride, race(restored))).toEqual({ lane: 2, held: 'tow' });
    // Nothing was sent: the lane was the room's already.
    expect(send.sent).toEqual([]);
  });
});

describe('the race the HUD reads, from the room’s frame — #1911', () => {
  it('is the room’s every number, with this rider’s lane and item as shown and offset as drawn', () => {
    const newest = frame(
      3_000,
      {
        0: { effortMetres: 120, raceOffsetMetres: -3, lane: 1, held: 'tow', lapsDone: 0 },
        1: { effortMetres: 130, raceOffsetMetres: 2, lane: 0, held: 'crosswind-gust' },
        2: { effortMetres: 1_300, lapsDone: 3 },
      },
      { tick: 3 },
    );
    const ride = { ...start(newest), drawnOffset: -1.5 };
    const state = roomLapRaceState(askRoomLane(ride, 'lane-right'), race(newest));
    expect(state?.course).toEqual({ lapLengthMetres: 400, laps: 3 });
    expect(state?.atMs).toBe(3_000);
    expect(state?.hazards).toEqual([]);
    const byId = new Map(state?.racers.map((entry) => [entry.racer.id, entry]));
    expect(byId.get('0')).toMatchObject({
      racer: { effortDistance: 120, raceOffset: -1.5, lapsDone: 0, finishedAtMs: null },
      lane: 1,
      held: 'tow',
    });
    expect(byId.get('1')).toMatchObject({
      racer: { effortDistance: 130, raceOffset: 2 },
      lane: 0,
      held: 'crosswind-gust',
    });
    // Finished at the room's laps.
    expect(byId.get('2')?.racer.finishedAtMs).toBe(3_000);
    expect(byId.get('2')?.held).toBeNull();
  });

  it('is nothing before the room’s first frame', () => {
    expect(roomLapRaceState(start(), race(undefined))).toBeUndefined();
  });

  it('draws the rider at the odometer moved by the drawn offset, and the others by the room’s', () => {
    const newest = frame(1_000, { 0: {}, 4: { raceOffsetMetres: -6.5 } });
    const drawing = roomLapRaceDrawing({ ...start(newest), drawnOffset: 2.25 }, race(newest), 300);
    expect(drawing.riderDistance).toBe(302.25);
    expect(drawing.offsetOf(4)).toBe(-6.5);
    expect(drawing.offsetOf(9)).toBe(0);
  });

  it('carries how fast the rider is steering across the road, toward the lane asked for, and 0 in a lane — #2456', () => {
    const newest = frame(1_000, { 0: {} });
    const inLane = roomLapRaceDrawing(start(newest), race(newest), 300);
    expect(inLane.steeringSpeed).toBe(0);
    const left = roomLapRaceDrawing(askRoomLane(start(newest), 'lane-left'), race(newest), 300);
    expect(left.steeringSpeed).toBe(-SIDEWAYS_METRES_PER_SECOND);
    const right = roomLapRaceDrawing(askRoomLane(start(newest), 'lane-right'), race(newest), 300);
    expect(right.steeringSpeed).toBe(SIDEWAYS_METRES_PER_SECOND);
  });
});
