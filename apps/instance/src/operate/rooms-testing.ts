// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A room router for a test world (#2612): what the owner's Rooms reads from
 * the room workers, as a list the test fills, and the end it asks of them,
 * which runs the commit as `RoomRouter.endRoom` does and notes each room it
 * would have closed on a worker. Test support, never shipped. The running
 * router and its workers are `rooms-instance.test.ts`'s.
 */

import type { LiveRoom, OperateRoomSources } from './operate.ts';

export interface FakeRoomRouter extends Pick<OperateRoomSources, 'live' | 'end'> {
  /** What the workers hold: a test adds and removes rooms here. */
  readonly held: LiveRoom[];
  /** Every room whose commit went through, so a worker would have closed its sockets. */
  readonly ended: string[];
  /** Every room an end was asked for, committed or not. */
  readonly asked: string[];
}

export function fakeRoomRouter(): FakeRoomRouter {
  const held: LiveRoom[] = [];
  const ended: string[] = [];
  const asked: string[] = [];
  return {
    held,
    ended,
    asked,
    live: () => Promise.resolve([...held]),
    end: async (roomId, commit) => {
      asked.push(roomId);
      if (!(await commit())) return false;
      ended.push(roomId);
      const at = held.findIndex((room) => room.roomId === roomId);
      if (at !== -1) held.splice(at, 1);
      return true;
    },
  };
}
