// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * `Operate.keys()` reads the keys ONCE (#2613's review): a second read, made
 * to learn the state and again to show it, could meet keys that a reset from
 * the CLI had removed in between, and nothing caught the throw.
 */

import { describe, expect, it } from 'vitest';

import { InstanceKeysUnavailable, type InstanceKeys } from '../keys/instance-keys.ts';
import { createOperate } from './operate.ts';

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRST';
const HEX = 'ab'.repeat(32);

type Shown = Awaited<ReturnType<InstanceKeys['show']>>;

function operateWith(show: () => Promise<Shown>) {
  return createOperate({
    store: {} as never,
    status: {} as never,
    analysis: {} as never,
    keys: { keys: { show } } as never,
  });
}

const shown = {
  fingerprint: HEX,
  fingerprintBase32: BASE32,
  card: `oyl-instance:https://oyl.example#${BASE32}`,
  encryptionKeys: [{ serial: 1, createdAt: 1000, supersededAt: null }],
} as unknown as Shown;

describe('Operate.keys() (#2613)', () => {
  it('answers the state, not a throw, when the keys go between two reads', async () => {
    let reads = 0;
    const operate = operateWith(() => {
      reads += 1;
      return reads > 1
        ? Promise.reject(new InstanceKeysUnavailable('no-keys'))
        : Promise.resolve(shown);
    });
    const answer = await operate.keys();
    expect(answer).toMatchObject({ ok: true, value: { state: 'ready' } });
    expect(reads).toBe(1);
  });

  it('names why the keys cannot be shown', async () => {
    const operate = operateWith(() => Promise.reject(new InstanceKeysUnavailable('no-keys')));
    expect(await operate.keys()).toEqual({
      ok: true,
      value: { state: 'no-keys', fingerprint: null, card: null, current: null, olderHeld: 0 },
    });
  });

  it('shows the fingerprint as a rider’s device does: 52 base32 characters, not hex', async () => {
    const answer = await operateWith(() => Promise.resolve(shown)).keys();
    expect(answer.ok && answer.value.fingerprint).toBe(BASE32);
  });
});
