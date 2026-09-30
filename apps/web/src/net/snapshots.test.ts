// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { INTERPOLATION_DELAY_FRAMES, SnapshotBuffer } from './snapshots';
import { frameRider } from './testing';

const INTERVAL = 1_000;
const LATENCY = 80;

/** Frames 1 … `last`, rider 7 riding 10 m/s from 0, each arriving `LATENCY` after its tick. */
function steady(last: number): SnapshotBuffer {
  const buffer = new SnapshotBuffer(INTERVAL);
  for (let tick = 1; tick <= last; tick += 1) {
    buffer.push(
      { type: 'frame', tick, riders: [frameRider(7, tick * 10)] },
      tick * INTERVAL + LATENCY,
    );
  }
  return buffer;
}

const drawnAt = (buffer: SnapshotBuffer, localMs: number): number =>
  buffer.at(localMs).find((rider) => rider.riderId === 7)?.distanceMetres ?? Number.NaN;

describe('other riders between frames — #782 interpolation', () => {
  it('draws a rider linearly in the render clock between the two bracketing frames', () => {
    const buffer = steady(4);
    const delay = INTERVAL * INTERPOLATION_DELAY_FRAMES;
    // The instant that is exactly frame 2 in the room's clock, and points past it.
    const frame2 = 2 * INTERVAL + LATENCY + delay;
    const samples = [0, 100, 250, 500, 750, 999].map((after) => drawnAt(buffer, frame2 + after));
    const expected = [20, 21, 22.5, 25, 27.5, 29.99];
    samples.forEach((sample, index) => {
      expect(sample).toBeCloseTo(expected[index] as number, 6);
    });
    // Linear: every equal step of the clock is an equal step of the road.
    const steps = [0, 200, 400, 600, 800].map((at) => drawnAt(buffer, frame2 + at));
    const deltas = steps.slice(1).map((value, index) => value - (steps[index] as number));
    for (const delta of deltas) expect(delta).toBeCloseTo(2, 9);
  });

  it('lands exactly on each frame at its boundary', () => {
    const buffer = steady(4);
    const delay = INTERVAL * INTERPOLATION_DELAY_FRAMES;
    for (const tick of [1, 2, 3, 4]) {
      expect(drawnAt(buffer, tick * INTERVAL + LATENCY + delay)).toBeCloseTo(tick * 10, 9);
    }
  });

  it('never extrapolates past the newest frame, and holds when a frame is late by one period', () => {
    const buffer = steady(3);
    const delay = INTERVAL * INTERPOLATION_DELAY_FRAMES;
    const newest = 3 * INTERVAL + LATENCY + delay;
    // Frame 4 is late by a whole period: the rider is held at frame 3's 30 m.
    for (const after of [0, 1, 500, 999, 1_000, 1_999]) {
      expect(drawnAt(buffer, newest + after)).toBe(30);
    }
    // It arrives, a period late: the rider moves on from 30 m, never back.
    buffer.push({ type: 'frame', tick: 4, riders: [frameRider(7, 40)] }, 5 * INTERVAL + LATENCY);
    const resumed = drawnAt(buffer, newest + 2_000);
    expect(resumed).toBeGreaterThanOrEqual(30);
    expect(resumed).toBeLessThanOrEqual(40);
  });

  it('does not let a late frame drag the whole picture later', () => {
    const buffer = steady(3);
    // Frame 4 arrives 900 ms late; the offset stays the least-delayed frame's.
    buffer.push({ type: 'frame', tick: 4, riders: [frameRider(7, 40)] }, 4 * INTERVAL + 900);
    expect(buffer.roomTimeAt(10_000)).toBe(10_000 - LATENCY);
  });

  it('ignores a duplicate or an older frame', () => {
    const buffer = steady(3);
    buffer.push({ type: 'frame', tick: 2, riders: [frameRider(7, 999)] }, 3_500);
    const delay = INTERVAL * INTERPOLATION_DELAY_FRAMES;
    expect(drawnAt(buffer, 2 * INTERVAL + LATENCY + delay)).toBe(20);
  });

  it('draws a rider who first appears in the later frame where that frame puts them', () => {
    const buffer = steady(2);
    buffer.push(
      { type: 'frame', tick: 3, riders: [frameRider(7, 30), frameRider(9, 5)] },
      3 * INTERVAL + LATENCY,
    );
    const delay = INTERVAL * INTERPOLATION_DELAY_FRAMES;
    const nine = buffer.at(2 * INTERVAL + LATENCY + delay + 500).find((r) => r.riderId === 9);
    expect(nine?.distanceMetres).toBe(5);
  });

  it('draws nothing before the first frame', () => {
    expect(new SnapshotBuffer(INTERVAL).at(5_000)).toEqual([]);
  });
});
