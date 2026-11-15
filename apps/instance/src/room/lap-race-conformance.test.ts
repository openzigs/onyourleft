// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A lap race with items, through every adapter — #1909's first two criteria.
 *
 * The same script (`conformance-testing.ts` §`rideTheLapRace`) drives the room
 * core directly — the reference — the Durable Object adapter under fakes and
 * the self-host adapter over real `ws` sockets on loopback, and every socket
 * must be sent **byte-identical** text. The room's answer — a hit, an offset,
 * a held item, the finish — is read back from frames **as a client decodes
 * them** off the self-host adapter's sockets, never from the room object.
 */

import { beforeAll, describe, expect, it } from 'vitest';

import { decodeRoomMessage, type Frame, type RoomMessage } from '@onyourleft/protocol';

import { admitConformance, lapRaceConformanceSettings } from './conformance-room.ts';
import {
  CLOSED_BY_ROOM,
  coreRoom,
  rideTheLapRace,
  type RoomUnderTest,
  type Transcript,
} from './conformance-testing.ts';
import { fakeDurableRoom } from './durable-object/fake-runtime-testing.ts';
import { nodeRoom } from './node/node-room-testing.ts';

/** Every message one socket was sent, decoded as a client decodes it. */
function received(transcript: Transcript, label: string): RoomMessage[] {
  return (transcript[label] ?? []).flatMap((text) => {
    if (text === CLOSED_BY_ROOM) return [];
    const decoded = decodeRoomMessage(text);
    if (!decoded.ok)
      throw new Error(`a room sent text a client refuses: ${decoded.refusal.reason}`);
    return [decoded.message];
  });
}

function framesOf(transcript: Transcript, label: string): Frame[] {
  return received(transcript, label).filter((m): m is Frame => m.type === 'frame');
}

let reference: Transcript;
/** The self-host adapter's transcript, over real sockets: what a client decodes. */
let selfHost: Transcript;

beforeAll(async () => {
  reference = await rideTheLapRace(coreRoom(lapRaceConformanceSettings(), admitConformance));
  const room = nodeRoom(lapRaceConformanceSettings(), admitConformance);
  try {
    selfHost = await rideTheLapRace(room);
  } finally {
    await room.dispose();
  }
});

describe('a lap race read back from the frames a client decodes, over the real socket — #1909', () => {
  it('welcomes both riders to a lap race of three laps with items, and never says its seed', () => {
    const welcome = received(selfHost, 'ann')[0];
    expect(welcome).toMatchObject({
      type: 'welcome',
      roomConfig: { kind: 'race', lapRace: { laps: 3, items: 'on' } },
    });
    expect(JSON.stringify(selfHost)).not.toMatch(/seed/i);
  });

  it('carries a scripted use, the hit it made, and the new offset in the next frame', () => {
    const frames = framesOf(selfHost, 'ann');
    // The first tick on which a use hit a rider.
    const at = frames.findIndex((frame) =>
      (frame.itemEvents ?? []).some((event) => event.event === 'hit'),
    );
    expect(at).toBeGreaterThan(0);
    const frame = frames[at] as Frame;
    const hit = (frame.itemEvents ?? []).find((event) => event.event === 'hit');
    if (hit === undefined) throw new Error('no hit');
    // The hit came from a use on the same tick, of the item that hit.
    expect(frame.itemEvents).toContainEqual(
      expect.objectContaining({ event: 'use', item: hit.item }),
    );
    const then = frame.riders.find((rider) => rider.riderId === hit.riderId);
    const next = frames[at + 1]?.riders.find((rider) => rider.riderId === hit.riderId);
    // Every rider of a lap race's frame carries the four slots.
    expect(typeof then?.lane).toBe('number');
    expect(typeof then?.held).toBe('string');
    // A slowing item takes 2 m/s (a gust) or 1.5 m/s (a puddle) off the offset
    // over the next second, inside the ±10 m bound.
    expect(next?.raceOffsetCentimetres).toBeLessThan(then?.raceOffsetCentimetres ?? -Infinity);
    expect(next?.raceOffsetCentimetres).toBeGreaterThanOrEqual(-1_000);
  });

  it('finishes both riders, and both clients read the same order', () => {
    const finishes = ['ann', 'bea-again'].map((label) =>
      received(selfHost, label).find((m) => m.type === 'finish'),
    );
    expect(finishes[0]?.type).toBe('finish');
    expect(finishes[0]).toEqual(finishes[1]);
    expect(finishes[0]?.type === 'finish' ? [...finishes[0].order].sort() : []).toEqual([0, 1]);
  });

  it('gives Bea back her held item, lane and offset on her new socket', () => {
    const before = framesOf(selfHost, 'bea').at(-1);
    const after = framesOf(selfHost, 'bea-again')[0];
    const bea = (frame: Frame | undefined) => frame?.riders.find((rider) => rider.riderId === 1);
    // Four ticks apart, coasting, so her distance moved; what the race holds
    // about her did not reset: the same lane and held item, and laps not lost.
    expect(bea(after)?.lane).toBe(bea(before)?.lane);
    expect(bea(after)?.held).toBe(bea(before)?.held);
    expect(bea(after)?.lapsDone).toBeGreaterThanOrEqual(bea(before)?.lapsDone ?? Infinity);
  });

  it('admits a lane change and refuses one sent with a spent sequence', () => {
    const lanes = framesOf(selfHost, 'ann').map(
      (frame) => frame.riders.find((rider) => rider.riderId === 0)?.lane,
    );
    expect(lanes).toContain(0);
    // The stale lane 2 never arrives.
    expect(lanes).not.toContain(2);
  });
});

/** Every adapter, against the reference. */
const ADAPTERS: readonly (() => RoomUnderTest)[] = [
  () => fakeDurableRoom(lapRaceConformanceSettings(), admitConformance),
  () => nodeRoom(lapRaceConformanceSettings(), admitConformance),
];

describe('every adapter sends byte-identical lap-race frames for the same inputs and clock — #1909', () => {
  it('the self-host adapter over real sockets matches the reference', () => {
    expect(selfHost).toEqual(reference);
  });

  for (const make of ADAPTERS) {
    it(`${make().name} sends every socket exactly what the reference does`, async () => {
      const room = make();
      try {
        expect(await rideTheLapRace(room)).toEqual(reference);
      } finally {
        await room.dispose();
      }
    });
  }

  it('is a race with items in it, so the comparison is not of empty frames', () => {
    const events = framesOf(reference, 'ann').flatMap((frame) => frame.itemEvents ?? []);
    expect(new Set(events.map((event) => event.event))).toEqual(new Set(['pick-up', 'use', 'hit']));
  });
});
