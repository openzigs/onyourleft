// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The open-world ride's way in** — #2889 hands a start to it, #2896's session
 * takes it.
 *
 * One start at a time, held in memory and nowhere else: not in the address
 * (a coordinate in the hash would sit in the browser's history), not in
 * storage, not in a log. {@link OpenWorldEntry.take} gives it up once, so a
 * second open of the ride screen does not start the same ride again unasked.
 *
 * ⚠️ The start is the rider's own location, and often their home. This module
 * keeps it for the moment between the picker's press and the session reading
 * it, and that is all (ADR 0090, the start "never leaves the device").
 */

import type { OpenWorldStart } from './start';

export interface OpenWorldEntry {
  /** The picker's press: this is where the next open-world ride starts. Replaces any start not yet taken. */
  hand(start: OpenWorldStart): void;
  /** The session's read: the start handed, once, or `undefined` when none is waiting. */
  take(): OpenWorldStart | undefined;
}

export function createOpenWorldEntry(): OpenWorldEntry {
  let waiting: OpenWorldStart | undefined;
  return {
    hand: (start) => {
      waiting = start;
    },
    take: () => {
      const start = waiting;
      waiting = undefined;
      return start;
    },
  };
}
