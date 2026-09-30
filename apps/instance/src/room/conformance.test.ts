// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * One conformance suite, every adapter — #781's first criterion, ADR 0037 D-2.
 *
 * The same script (`conformance-testing.ts` §`rideTheScript`) drives the room
 * core directly — the reference — and each adapter, at the same room times,
 * and every socket must be sent **byte-identical** text. The Durable Object
 * adapter runs here under fakes on every `pnpm run test`; under a real
 * `workerd` it runs with `pnpm --filter @onyourleft/instance run test:workerd`,
 * which provides `workerd` and switches the last block on. #780's Node adapter
 * — real `ws` sockets over loopback into the adapter's `RoomHost` — joined
 * {@link ADAPTERS} and changed nothing else in this file.
 */

import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { decodeRoomMessage } from '@onyourleft/protocol';

import { admitConformance, conformanceSettings } from './conformance-room.ts';
import {
  CLOSED_BY_ROOM,
  coreRoom,
  rideTheScript,
  type RoomUnderTest,
  type Transcript,
} from './conformance-testing.ts';
import { fakeDurableRoom } from './durable-object/fake-runtime-testing.ts';
import { nodeRoom } from './node/node-room-testing.ts';
import type { Workerd } from './workerd-testing.ts';

declare module 'vitest' {
  export interface ProvidedContext {
    /** Set by `vitest.workerd.config.ts`: run the adapters that need a real `workerd`. */
    workerd: boolean;
  }
}

const underWorkerd = inject('workerd') === true;

const ADAPTERS: readonly (() => RoomUnderTest)[] = [
  () => fakeDurableRoom(conformanceSettings(), admitConformance),
  () => nodeRoom(conformanceSettings(), admitConformance),
];

let reference: Transcript;

beforeAll(async () => {
  reference = await rideTheScript(coreRoom(conformanceSettings(), admitConformance));
});

/** The messages of one socket's transcript, decoded, for the assertions that read them. */
function decoded(transcript: Transcript, label: string) {
  return (transcript[label] ?? []).map((text) =>
    text === CLOSED_BY_ROOM ? { type: 'closed' as const } : decodeRoomMessage(text),
  );
}

describe('the script itself — what the reference says happens', () => {
  it('welcomes two riders, refuses the forger, runs sixty frames, finishes both and refuses the late rejoin', () => {
    const ann = decoded(reference, 'ann');
    const frames = ann.filter((m) => 'ok' in m && m.ok && m.message.type === 'frame');
    expect(ann[0]).toMatchObject({ ok: true, message: { type: 'welcome', riderId: 0 } });
    expect(frames.length).toBeGreaterThanOrEqual(60);
    expect(ann.at(-1)).toMatchObject({ ok: true, message: { type: 'finish', order: [0, 1] } });
    expect(decoded(reference, 'forger')).toEqual([
      { ok: true, message: { type: 'refuse', reason: 'ticket-refused' } },
      { type: 'closed' },
    ]);
    // Bea's second socket gets her seat back, rider 1, inside the rejoin window.
    expect(decoded(reference, 'bea-again')[0]).toMatchObject({
      ok: true,
      message: { type: 'welcome', riderId: 1 },
    });
    expect(decoded(reference, 'ann-again')).toEqual([
      { ok: true, message: { type: 'refuse', reason: 'room-closed' } },
      { type: 'closed' },
    ]);
  });
});

function holdsToTheReference(make: () => RoomUnderTest): void {
  it(`${make().name} sends every socket exactly what the reference does`, async () => {
    const room = make();
    try {
      expect(await rideTheScript(room)).toEqual(reference);
    } finally {
      await room.dispose();
    }
  });
}

describe('every adapter sends byte-identical text for the same inputs and clock', () => {
  for (const make of ADAPTERS) holdsToTheReference(make);

  it('goes red for an adapter that differs by one frame — the comparison is not vacuous', () => {
    const ann = [...(reference.ann ?? [])];
    ann.splice(20, 1);
    expect({ ...reference, ann }).not.toEqual(reference);
    // …and by one byte inside one frame.
    const nudged = [...(reference.ann ?? [])];
    nudged[20] = (nudged[20] ?? '').replace('"tick":', '"tick": ');
    expect({ ...reference, ann: nudged }).not.toEqual(reference);
  });
});

describe.skipIf(!underWorkerd)(
  'under a real workerd — `pnpm --filter @onyourleft/instance run test:workerd`',
  () => {
    // Imported here rather than at the top, so an ordinary test run never
    // loads the bundler it needs.
    let runtime: Workerd | undefined;
    let workerdRoom: typeof import('./workerd-testing.ts').workerdRoom;
    beforeAll(async () => {
      const harness = await import('./workerd-testing.ts');
      workerdRoom = harness.workerdRoom;
      runtime = await harness.startWorkerd();
    });
    afterAll(async () => {
      await runtime?.stop();
    });

    it('the Durable Object adapter under workerd sends every socket exactly what the reference does', async () => {
      if (runtime === undefined) throw new Error('workerd did not start');
      const room = workerdRoom(runtime, 'CONFORMANCE', `conformance-${String(Date.now())}`);
      try {
        expect(await rideTheScript(room)).toEqual(reference);
      } finally {
        await room.dispose();
      }
    });
  },
);
