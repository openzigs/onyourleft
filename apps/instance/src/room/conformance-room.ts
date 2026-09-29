// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The rooms the conformance suite and the `workerd` cases build (#781), in a
 * module with no platform in it, because it is read in two places: by Vitest
 * in Node, and by `durable-object/worker-under-test.ts` inside `workerd`. Test
 * support, never mounted by the instance.
 */

import { admitByTable, COURSE_SHA256 } from './core/room-testing.ts';
import { roomSettings, type RoomSettings } from './core/settings.ts';

/**
 * A short course, so the script's two riders finish after about sixty ticks:
 * flat for 150 m and then a 2 % climb, so a grade reaches the physics.
 */
export const CONFORMANCE_COURSE = {
  sha256: COURSE_SHA256,
  lengthMetres: 450,
  gradePercentAt: (metres: number) => (metres < 150 ? 0 : 2),
} as const;

/** The conformance race: a two-second countdown and a ten-second rejoin window. */
export function conformanceSettings(): RoomSettings {
  return roomSettings({
    kind: 'race',
    ridingPosition: 'hoods',
    course: CONFORMANCE_COURSE,
    countdownMs: 2_000,
    rejoinWindowMs: 10_000,
  });
}

/** `ticket-ann` at 70 kg and `ticket-bea` at 62 kg; anything not `ticket-…` is refused. */
export const admitConformance = admitByTable({ bea: 62 });

/**
 * The race the alarm case runs on the runtime's own clock: a one-second
 * countdown and a two-second rejoin window, so it runs, empties and stops in a
 * few seconds of real time.
 */
export function wallClockSettings(): RoomSettings {
  return roomSettings({
    kind: 'race',
    ridingPosition: 'hoods',
    course: CONFORMANCE_COURSE,
    countdownMs: 1_000,
    rejoinWindowMs: 2_000,
  });
}
