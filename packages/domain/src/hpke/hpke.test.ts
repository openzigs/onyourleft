// SPDX-License-Identifier: Apache-2.0

/**
 * HPKE's plumbing, over a stand-in port (#1188).
 *
 * ⚠️ The stand-in below is **not cryptography**, for `identity/testing.ts`'s
 * reason: this package cannot name `crypto`. What it can show is what the
 * module does with what a port hands it — above all that an all-zero
 * Diffie–Hellman output is refused **by the module**, whatever the port did,
 * which no real WebCrypto lets a test reach. RFC 9180's vectors run through
 * the real ports in `packages/store` and `apps/instance`.
 */

import { describe, expect, it } from 'vitest';

import { HpkeError } from './errors';
import {
  HPKE_RESPONSE_NONCE_BYTES,
  openReply,
  sealReply,
  setupBaseRecipient,
  setupBaseSender,
} from './hpke';
import { assertMessageLimitRaises } from './hpke-testing';
import type { HpkePrimitives } from './primitives';

/** A deterministic, non-cryptographic byte mixer: every input byte matters. */
function mix(...parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(32);
  let state = 0x9e3779b9;
  let position = 0;
  for (const part of parts) {
    state = Math.imul(state ^ (part.length + 0x51), 0x85ebca6b) >>> 0;
    for (const byte of part) {
      state = Math.imul(state ^ byte, 0xc2b2ae35) >>> 0;
      state = (state ^ (state >>> 13)) >>> 0;
      out[position % 32] = (out[position % 32] ?? 0) ^ (state & 0xff);
      position += 1;
    }
  }
  for (let round = 0; round < 64; round += 1) {
    state = Math.imul(state ^ (out[round % 32] ?? 0), 0x27d4eb2d) >>> 0;
    out[round % 32] = (out[round % 32] ?? 0) ^ (state >>> 24);
  }
  return out;
}

interface StandIn extends HpkePrimitives<number> {
  readonly nonces: Uint8Array[];
}

/** A stand-in whose Diffie–Hellman is `dh` and whose AEAD tag is a mix. */
function standIn(dh: (privateKey: number, publicKey: Uint8Array) => Uint8Array): StandIn {
  let counter = 0;
  const nonces: Uint8Array[] = [];
  const tag = (key: Uint8Array, nonce: Uint8Array, aad: Uint8Array, pt: Uint8Array): Uint8Array =>
    mix(key, nonce, aad, pt).slice(0, 16);
  return {
    nonces,
    generateX25519KeyPair: () => {
      counter += 1;
      return Promise.resolve({ publicKey: new Uint8Array(32).fill(counter), privateKey: counter });
    },
    x25519: (privateKey, publicKey) => Promise.resolve(dh(privateKey, publicKey)),
    hmacSha256: (key, data) => Promise.resolve(mix(key, data)),
    aes128GcmSeal: (key, nonce, aad, plaintext) => {
      nonces.push(nonce.slice());
      const out = new Uint8Array(plaintext.length + 16);
      out.set(plaintext, 0);
      out.set(tag(key, nonce, aad, plaintext), plaintext.length);
      return Promise.resolve(out);
    },
    aes128GcmOpen: (key, nonce, aad, ciphertext) => {
      const plaintext = ciphertext.slice(0, ciphertext.length - 16);
      const expected = tag(key, nonce, aad, plaintext);
      const given = ciphertext.slice(ciphertext.length - 16);
      if (!expected.every((byte, index) => byte === given[index])) {
        return Promise.reject(new Error('tag'));
      }
      return Promise.resolve(plaintext);
    },
    randomBytes: (count) => {
      counter += 1;
      return new Uint8Array(count).fill(counter);
    },
  };
}

/**
 * A "Diffie–Hellman" that is symmetric in the two stand-in keys — a key pair
 * here is a counter and 32 copies of it — so both sides agree. Plumbing only.
 */
const workingDh = (privateKey: number, publicKey: Uint8Array): Uint8Array => {
  const other = publicKey[0] ?? 0;
  return mix(Uint8Array.of(Math.min(privateKey, other), Math.max(privateKey, other)));
};

const INFO = Uint8Array.of(1, 2, 3);

async function refusal(attempt: Promise<unknown>): Promise<HpkeError> {
  try {
    await attempt;
  } catch (error) {
    if (error instanceof HpkeError) return error;
    throw error;
  }
  throw new Error('the attempt was accepted');
}

describe('HPKE over a stand-in port — #1188', () => {
  describe('RFC 9180 §7.1.4: an all-zero shared secret', () => {
    it('is refused by the module on Encap even when the port returns the zeros', async () => {
      const port = standIn(() => new Uint8Array(32));
      const error = await refusal(setupBaseSender(port, new Uint8Array(32).fill(9), INFO));
      expect(error.reason).toBe('low-order-point');
    });

    it('is refused by the module on Decap even when the port returns the zeros', async () => {
      const port = standIn(() => new Uint8Array(32));
      const recipient = await port.generateX25519KeyPair();
      const error = await refusal(
        setupBaseRecipient(port, recipient, new Uint8Array(32).fill(9), INFO),
      );
      expect(error.reason).toBe('low-order-point');
    });

    it('reports a port that throws, as its contract says it must, as a refused key', async () => {
      const port = standIn(() => {
        throw new Error('OperationError');
      });
      const error = await refusal(setupBaseSender(port, new Uint8Array(32).fill(9), INFO));
      expect(error.reason).toBe('invalid-public-key');
    });
  });

  it('refuses a recipient key or an enc that is not 32 bytes, before asking the port', async () => {
    let asked = 0;
    const port = standIn((privateKey, publicKey) => {
      asked += 1;
      return workingDh(privateKey, publicKey);
    });
    const recipient = await port.generateX25519KeyPair();
    expect((await refusal(setupBaseSender(port, new Uint8Array(31), INFO))).reason).toBe(
      'invalid-public-key',
    );
    expect(
      (await refusal(setupBaseRecipient(port, recipient, new Uint8Array(33), INFO))).reason,
    ).toBe('invalid-public-key');
    expect(asked).toBe(0);
  });

  it('round-trips a request and its reply through the plumbing', async () => {
    const port = standIn(workingDh);
    const recipient = await port.generateX25519KeyPair();
    const sender = await setupBaseSender(port, recipient.publicKey, INFO);
    const opened = await setupBaseRecipient(port, recipient, sender.enc, INFO);
    const aad = Uint8Array.of(0xaa);
    expect(await opened.open(aad, await sender.seal(aad, Uint8Array.of(1, 2)))).toEqual(
      Uint8Array.of(1, 2),
    );

    const reply = await sealReply(port, opened);
    expect(reply.responseNonce).toHaveLength(HPKE_RESPONSE_NONCE_BYTES);
    const device = await openReply(port, sender, reply.responseNonce);
    expect(await device.open(aad, await reply.seal(aad, Uint8Array.of(3)))).toEqual(
      Uint8Array.of(3),
    );
  });

  it('refuses a response nonce that is not 16 bytes', async () => {
    const port = standIn(workingDh);
    const recipient = await port.generateX25519KeyPair();
    const sender = await setupBaseSender(port, recipient.publicKey, INFO);
    expect((await refusal(openReply(port, sender, new Uint8Array(12)))).reason).toBe(
      'invalid-length',
    );
  });

  it('refuses an export of no bytes or of more than 255 blocks', async () => {
    const port = standIn(workingDh);
    const recipient = await port.generateX25519KeyPair();
    const sender = await setupBaseSender(port, recipient.publicKey, INFO);
    expect((await refusal(sender.export(new Uint8Array(0), 0))).reason).toBe('invalid-length');
    expect((await refusal(sender.export(new Uint8Array(0), 255 * 32 + 1))).reason).toBe(
      'invalid-length',
    );
    expect(await sender.export(new Uint8Array(0), 255 * 32)).toHaveLength(255 * 32);
  });

  it('gives two seals started together two different nonces', async () => {
    const port = standIn(workingDh);
    const recipient = await port.generateX25519KeyPair();
    const sender = await setupBaseSender(port, recipient.publicKey, INFO);
    const aad = new Uint8Array(0);
    await Promise.all([sender.seal(aad, Uint8Array.of(1)), sender.seal(aad, Uint8Array.of(2))]);
    expect(port.nonces).toHaveLength(2);
    expect(port.nonces[0]).not.toEqual(port.nonces[1]);
  });

  it('raises at a lowered sequence limit rather than wrapping (RFC 9180 §5.2)', async () => {
    await expect(assertMessageLimitRaises(standIn(workingDh))).resolves.toBeUndefined();
  });
});
