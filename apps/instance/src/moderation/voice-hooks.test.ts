// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The moderation routes reach Discord voice (#876): a moderator's removal and
 * a suspension hand the voice step what the log recorded — after the action
 * is applied, never instead of it — and a refused action hands it nothing.
 * What the voice step does is `voice/voice-moderation.test.ts`'s; the whole
 * chain on a running instance is `instance.test.ts` §"#876".
 */

import { afterEach, describe, expect, it } from 'vitest';

import type { InstanceProbes } from '../route-kit.ts';
import { wholeModerationLog } from '../store/testing/index.ts';
import {
  startModerationWorld,
  TEST_STATEMENT,
  type ModerationWorld,
} from './moderation-testing.ts';

let world: ModerationWorld | undefined;
afterEach(async () => {
  await world?.close();
  world = undefined;
});

const ROOM = 'room-1';

async function start() {
  const calls: { readonly what: string; readonly with: unknown }[] = [];
  const probes: InstanceProbes = {
    ready: () => Promise.resolve({ ready: true, checks: {} }) as never,
    removeFromRoom: (roomId, athleteId) => {
      calls.push({ what: 'removeFromRoom', with: { roomId, athleteId } });
      return Promise.resolve(true);
    },
    afterRoomRemoval: (removal) => {
      calls.push({ what: 'afterRoomRemoval', with: removal });
      return Promise.resolve();
    },
    afterSuspension: (suspension) => {
      calls.push({ what: 'afterSuspension', with: suspension });
      return Promise.resolve();
    },
  };
  world = await startModerationWorld({ probes });
  return { w: world, calls };
}

describe('the moderation routes hand the voice step what was logged — #876', () => {
  it('a moderator’s removal: the rider out of the room first, then voice, with the removal’s log entry', async () => {
    const { w, calls } = await start();
    const bea = await w.rider('Bea');
    const removed = await w.as(
      w.owner,
      'POST',
      `/v1/moderation/rooms/${ROOM}/athletes/${bea.athleteId}/remove`,
      { reason: 'Abusive in the room', statement: TEST_STATEMENT },
    );
    expect(removed.status).toBe(200);
    const logId = (removed.body as { logId: number }).logId;
    const entry = (await w.freshRead((store) => wholeModerationLog(store))).find(
      (each) => each.id === logId,
    );
    expect(entry?.action).toBe('remove_from_room');
    expect(calls).toEqual([
      { what: 'removeFromRoom', with: { roomId: ROOM, athleteId: bea.athleteId } },
      {
        what: 'afterRoomRemoval',
        with: { roomId: ROOM, actorId: w.owner.athleteId, targetId: bea.athleteId, logId },
      },
    ]);
  });

  it('a suspension: voice is handed the suspension’s log entry', async () => {
    const { w, calls } = await start();
    const bea = await w.rider('Bea');
    const suspended = await w.as(
      w.owner,
      'POST',
      `/v1/moderation/athletes/${bea.athleteId}/suspend`,
      {
        reason: 'Repeated abuse',
        statement: TEST_STATEMENT,
      },
    );
    expect(suspended.status).toBe(200);
    const logId = (suspended.body as { logId: number }).logId;
    expect(calls).toEqual([
      {
        what: 'afterSuspension',
        with: { actorId: w.owner.athleteId, targetId: bea.athleteId, logId },
      },
    ]);
  });

  it('an action that was refused, or is not a ban, hands voice nothing', async () => {
    const { w, calls } = await start();
    const bea = await w.rider('Bea');
    // No statement: refused, nothing applied.
    expect(
      (
        await w.as(w.owner, 'POST', `/v1/moderation/athletes/${bea.athleteId}/suspend`, {
          reason: 'Repeated abuse',
        })
      ).status,
    ).toBe(400);
    // A moderator is never removed or suspended.
    expect(
      (
        await w.as(
          w.owner,
          'POST',
          `/v1/moderation/rooms/${ROOM}/athletes/${w.deputy.athleteId}/remove`,
          { reason: 'x', statement: TEST_STATEMENT },
        )
      ).status,
    ).not.toBe(200);
    // Hiding a name is not a ban.
    expect(
      (
        await w.as(w.owner, 'POST', `/v1/moderation/athletes/${bea.athleteId}/hide-display-name`, {
          reason: 'Offensive name',
          statement: TEST_STATEMENT,
        })
      ).status,
    ).toBe(200);
    expect(calls.filter((each) => each.what !== 'removeFromRoom')).toEqual([]);
  });
});
