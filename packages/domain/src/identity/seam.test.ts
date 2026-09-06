// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from 'vitest';

import { IdentityError } from './errors';
import { toHex } from './hex';
import { ensureSigningKey, type Keystore, type SigningKey } from './seam';
import { stubSigningKey } from './testing';

/**
 * A keystore with one slot, standing in for a device.
 *
 * `create` writes into the slot only if it is still empty and otherwise returns
 * what is already there — which is the conditional write every real
 * implementation has to make, and the reason `Keystore.create` says so.
 */
function deviceKeystore(): Keystore & { readonly created: () => number } {
  let stored: SigningKey | undefined;
  let created = 0;
  return {
    load: () => Promise.resolve(stored),
    create: () => {
      created += 1;
      stored ??= stubSigningKey(`athlete-${String(created)}`);
      return Promise.resolve(stored);
    },
    created: () => created,
  };
}

describe('ensureSigningKey — the first-run behaviour', () => {
  it('creates a keypair when the device has none', async () => {
    const keystore = deviceKeystore();

    const key = await ensureSigningKey(keystore);

    expect(key.algorithm).toBe('Ed25519');
    expect(key.publicKey).toHaveLength(32);
    expect(keystore.created()).toBe(1);
  });

  it('reuses the key on the second launch rather than making a new identity', async () => {
    // The failure this prevents, in #61's own words: "an athlete's whole
    // history silently splitting across two identities after a browser
    // restart". Every record signed before the restart would be unverifiable
    // against the key that signed everything after it.
    const keystore = deviceKeystore();

    const first = await ensureSigningKey(keystore);
    const second = await ensureSigningKey(keystore);

    expect(toHex(second.publicKey)).toBe(toHex(first.publicKey));
    expect(keystore.created()).toBe(1);
  });

  it('does not call create at all when a key is already there', async () => {
    const keystore = deviceKeystore();
    await ensureSigningKey(keystore);
    const create = vi.spyOn(keystore, 'create');

    await ensureSigningKey(keystore);

    expect(create).not.toHaveBeenCalled();
  });

  it('gives both racing callers the same identity when the keystore is conditional', async () => {
    // Two tabs opening for the first time at the same moment: both see `load`
    // return undefined, both call `create`. A keystore whose write is
    // conditional collapses them onto one identity; one whose write is not
    // splits the athlete's history, which is why the interface says so.
    const keystore = deviceKeystore();

    const [a, b] = await Promise.all([ensureSigningKey(keystore), ensureSigningKey(keystore)]);

    expect(toHex(a.publicKey)).toBe(toHex(b.publicKey));
  });

  it('refuses a keystore that returns a key for another scheme', async () => {
    const keystore: Keystore = {
      load: () => Promise.resolve({ ...stubSigningKey(), algorithm: 'secp256k1' as 'Ed25519' }),
      create: () => Promise.resolve(stubSigningKey()),
    };

    await expect(ensureSigningKey(keystore)).rejects.toThrow(IdentityError);
  });

  it('refuses a key whose public half is the wrong length', async () => {
    const keystore: Keystore = {
      load: () => Promise.resolve(undefined),
      create: () => Promise.resolve({ ...stubSigningKey(), publicKey: new Uint8Array(31) }),
    };

    await expect(ensureSigningKey(keystore)).rejects.toThrow(/32 bytes/);
  });
});
