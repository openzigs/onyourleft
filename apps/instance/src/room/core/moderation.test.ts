// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Moderation in a room — #789 — through the real room core, read back from
 * what it SENDS: a block keeps two riders' names from each other, both ways,
 * and a removal closes the rider's socket and bars them from the room.
 */

import { describe, expect, it } from 'vitest';

import { PHYSICS_VERSION } from '@onyourleft/physics';

import { createRoom, type Admission } from './room.ts';
import { closed, FLAT_COURSE, helloText, sentTo } from './room-testing.ts';
import { roomSettings } from './settings.ts';

/** `ticket-<athlete>` as that athlete, with the blocks given for them. */
function admitWith(blocks: Readonly<Record<string, readonly string[]>>) {
  return (ticket: string): Admission | undefined => {
    const athleteId = /^ticket-(.+)$/.exec(ticket)?.[1];
    if (athleteId === undefined) return undefined;
    return {
      athleteId,
      declaredMassKilograms: 70,
      displayName: athleteId.charAt(0).toUpperCase() + athleteId.slice(1),
      ...(blocks[athleteId] === undefined ? {} : { blocks: blocks[athleteId] }),
    };
  };
}

function race(
  blocks: Readonly<Record<string, readonly string[]>> = {},
  kind: 'race' | 'ride' = 'race',
) {
  return createRoom(
    roomSettings({ kind, ridingPosition: 'hoods', course: FLAT_COURSE, countdownMs: 0 }),
    admitWith(blocks),
  );
}

const namesTo = (out: Parameters<typeof sentTo>[0], connection: number) =>
  sentTo(out, connection).flatMap((m) => (m.type === 'name' ? [m.displayName] : []));

describe('a block in a race — #789', () => {
  it.each([
    ['Ann blocked Bea', { ann: ['bea'] }],
    ['Bea blocked Ann', { bea: ['ann'] }],
  ] as const)('%s: neither is named to the other, and Cat sees both', (_name, blocks) => {
    const room = race(blocks);
    const annIn = room.receive(1, helloText('ticket-ann'), 0);
    const beaIn = room.receive(2, helloText('ticket-bea'), 0);
    const catIn = room.receive(3, helloText('ticket-cat'), 0);
    // What each was sent of the others' names, as they joined and after.
    const toAnn = [...namesTo(annIn, 1), ...namesTo(beaIn, 1), ...namesTo(catIn, 1)];
    const toBea = [...namesTo(beaIn, 2), ...namesTo(catIn, 2)];
    expect(toAnn).not.toContain('Bea');
    expect(toBea).not.toContain('Ann');
    expect(toAnn).toEqual(expect.arrayContaining(['Ann', 'Cat']));
    expect(toBea).toEqual(expect.arrayContaining(['Bea', 'Cat']));
    expect(namesTo(catIn, 3)).toEqual(['Ann', 'Bea', 'Cat']);
    // And a rejoin names the field again, with the same gap.
    room.disconnect(1, 10);
    expect(namesTo(room.receive(4, helloText('ticket-ann'), 20), 4).sort()).toEqual(['Ann', 'Cat']);
  });
});

describe('removing a rider — #789', () => {
  it('refuses and closes their socket, takes their seat, and refuses them again', () => {
    for (const kind of ['race', 'ride'] as const) {
      const room = race({}, kind);
      room.receive(1, helloText('ticket-ann'), 0);
      room.receive(2, helloText('ticket-bea'), 0);
      if (kind === 'race') room.start(0);
      room.tick(1_000);
      const out = room.remove('bea', 1_500);
      expect(sentTo(out, 2), kind).toEqual([{ type: 'refuse', reason: 'ticket-refused' }]);
      expect(closed(out), kind).toEqual([2]);
      const bea = room.view().seats.find((seat) => seat.athleteId === 'bea');
      expect(kind === 'race' ? bea?.state : bea, kind).toBe(kind === 'race' ? 'dnf' : undefined);
      // A fresh ticket does not bring them back.
      const again = room.receive(3, helloText('ticket-bea'), 2_000);
      expect(sentTo(again, 3), kind).toEqual([{ type: 'refuse', reason: 'ticket-refused' }]);
      // Ann rides on.
      expect(room.view().seats.find((seat) => seat.athleteId === 'ann')?.state).toBe('connected');
    }
  });

  it('bars an athlete with no seat yet', () => {
    const room = race();
    expect(room.remove('bea', 0)).toEqual([]);
    expect(sentTo(room.receive(1, helloText('ticket-bea'), 0), 1)).toEqual([
      { type: 'refuse', reason: 'ticket-refused' },
    ]);
    expect(PHYSICS_VERSION).toBeGreaterThan(0);
  });
});
