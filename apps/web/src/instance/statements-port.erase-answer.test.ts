// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Deleting the account when the instance ANSWERS but does not delete (#1517).
 *
 * `statements-port.test.ts` reaches the real instance, whose sealed answers
 * cannot be made to say 400, 403, 429 or 500 on demand. Here the session the
 * device holds is replaced by one that answers as scripted, so each non-deleting
 * answer is read back through the path the rider's screen uses: the sign-in
 * this device holds, which must survive every answer but the deletion's own.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { InstanceStorage } from './instance-port';
import { INSTANCE_ACCOUNT_STORAGE_KEY, readInstanceAccount } from './sign-in';
import { createStatementsPort, ERASE_REFUSAL_TEXT } from './statements-port';
import { LOADED_LOCALLY } from './testing';

interface Scripted {
  status: number;
  body: unknown;
}

const held: { answer: Scripted; calls: string[] } = vi.hoisted(() => ({
  answer: { status: 0, body: undefined },
  calls: [],
}));

vi.mock('./instance-port', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./instance-port')>()),
  heldAccountSession: () => () =>
    Promise.resolve({
      kind: 'open' as const,
      token: 'held-session',
      sealedOrKeyless: {
        call: (method: string, path: string) => {
          held.calls.push(`${method} ${path}`);
          return Promise.resolve(held.answer);
        },
      },
    }),
}));

const ORIGIN = 'https://club.example';
const NONCE = 'ab'.repeat(32);

function erasing(answer: { status: number; body: unknown }) {
  held.answer = answer;
  held.calls.length = 0;
  const map = new Map<string, string>([
    [
      INSTANCE_ACCOUNT_STORAGE_KEY,
      JSON.stringify({ origin: ORIGIN, instanceAthleteId: 'athlete-1' }),
    ],
  ]);
  const storage: InstanceStorage = {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
  const port = createStatementsPort({
    storage,
    loadedFrom: LOADED_LOCALLY,
    ensureLocalAthlete: () => Promise.resolve(),
    signingKey: () =>
      Promise.resolve({
        algorithm: 'Ed25519' as const,
        publicKey: new Uint8Array(32).fill(7),
        sign: () => Promise.resolve(new Uint8Array(64).fill(9)),
      }),
    send: () => Promise.resolve(Response.json({ nonce: NONCE })),
    now: () => 1_790_000_000_000,
  });
  return { port, storage };
}

afterEach(() => {
  held.calls.length = 0;
});

describe('an instance that answers the deletion without deleting (#1517)', () => {
  it.each([
    [400, 'step_up_invalid'],
    [403, 'step_up_required'],
    [429, 'rate_limited'],
    [500, 'internal'],
  ])('keeps the sign-in and says nothing was deleted on a %i (%s)', async (status, code) => {
    const { port, storage } = erasing({ status, body: { error: { code } } });
    expect(await port.eraseAccount()).toEqual({ kind: 'refused', text: ERASE_REFUSAL_TEXT });
    expect(held.calls).toEqual(['DELETE /v1/account']);
    // Read back: the device still holds its sign-in to the account the instance still holds.
    expect(readInstanceAccount(storage)?.instanceAthleteId).toBe('athlete-1');
  });

  it('forgets the sign-in only on the deletion’s own 204', async () => {
    const { port, storage } = erasing({ status: 204, body: undefined });
    expect(await port.eraseAccount()).toEqual({ kind: 'erased' });
    expect(readInstanceAccount(storage)).toBeUndefined();
  });
});
