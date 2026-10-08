// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * 200 simulated riders through the room core — #779's load criterion.
 *
 * ⚠️ **The short run.** #779 asks for 200 riders for 3 600 ticks inside the
 * time the CI issue (#771) allows, "or the long run moves to #792 and this
 * suite runs a shorter one". It moved: measured on 2026-09-29 on an Apple M4
 * Pro, the full hour is 49.4 s of Vitest time (68.6 µs per rider-tick, 720 000 rider-ticks), and the CI runner
 * is about three times slower under coverage (docs/agents/ci.md §4c) — minutes of a
 * job #771 records as already over budget. So this runs every rider for
 * {@link TICKS} ticks, which exercises every path a tick takes at the largest
 * room size (two rooms of 100), and #792 owns the hour.
 *
 * It asserts what the load must not change — every rider advanced every tick,
 * and a frame to every connection every tick — and PRINTS the time rather
 * than asserting it: a wall-clock bound in a unit suite fails on a slow
 * runner for reasons that have nothing to do with the room.
 */

import { describe, expect, it } from 'vitest';

import { createRoom, type Outbound } from './core/room.ts';
import { admitByTable, FLAT_COURSE, helloText, reportText } from './core/room-testing.ts';
import { roomSettings } from './core/settings.ts';

/**
 * Vitest's own 5 s case timeout IS a wall-clock bound, the one the header
 * says this file does not assert: on `main` this case took 4 817 ms on an
 * EPYC 9V74 runner and 5 552 ms (a timeout) on an EPYC 7763, under coverage.
 * So it gets a stop for a hung loop, well clear of any runner, not a budget.
 */
const HUNG_AFTER_MS = 60_000;

const TICKS = 60;
const ROOMS = 2;
const RIDERS_PER_ROOM = 100;

describe('200 riders — #779', () => {
  it(
    `runs two full rooms for ${String(TICKS)} ticks, every rider advanced and framed every tick`,
    () => {
      const rooms = Array.from({ length: ROOMS }, () =>
        createRoom(
          roomSettings({
            kind: 'ride',
            ridingPosition: 'hoods',
            course: FLAT_COURSE,
            capacity: RIDERS_PER_ROOM,
            countdownMs: 0,
          }),
          admitByTable(),
        ),
      );
      rooms.forEach((room, r) => {
        for (let i = 0; i < RIDERS_PER_ROOM; i += 1) {
          room.receive(i, helloText(`ticket-${String(r)}-${String(i)}`), 0);
        }
      });

      const started = performance.now();
      let frames = 0;
      for (let t = 0; t < TICKS; t += 1) {
        for (const room of rooms) {
          for (let i = 0; i < RIDERS_PER_ROOM; i += 1) {
            room.receive(i, reportText(2 * t, t * 1000 + 250, 150 + i), t * 1000 + 250);
            room.receive(i, reportText(2 * t + 1, t * 1000 + 750, 160 + i), t * 1000 + 750);
          }
          const out: Outbound[] = room.tick((t + 1) * 1000);
          frames += out.filter((o) => o.kind === 'send').length;
        }
      }
      const elapsed = performance.now() - started;
      console.info(
        `room core: ${String(ROOMS * RIDERS_PER_ROOM)} riders × ${String(TICKS)} ticks in ${elapsed.toFixed(0)} ms ` +
          `(${((elapsed * 1000) / (ROOMS * RIDERS_PER_ROOM * TICKS)).toFixed(1)} µs per rider-tick)`,
      );

      expect(frames).toBe(ROOMS * RIDERS_PER_ROOM * TICKS);
      for (const room of rooms) {
        const { seats, tick } = room.view();
        expect(tick).toBe(TICKS);
        expect(seats).toHaveLength(RIDERS_PER_ROOM);
        expect(seats.every((seat) => seat.flags === 0 && seat.distanceMetres > 0)).toBe(true);
      }
    },
    HUNG_AFTER_MS,
  );
});
