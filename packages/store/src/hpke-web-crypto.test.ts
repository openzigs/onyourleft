// SPDX-License-Identifier: Apache-2.0

/**
 * The client's HPKE primitives against RFC 9180 Appendix A.1 and RFC 9458
 * Appendix A (#1188, ADR 0047 D-3) — the real port, not a stand-in.
 *
 * The instance's port is held to the same assertions in
 * `apps/instance/src/auth/hpke.test.ts`, which also runs the two together.
 */

import {
  assertLowOrderPointsRefused,
  assertMessageLimitRaises,
  assertRfc9180A1Base,
  assertRfc9180A1TamperingRefused,
  assertRfc9458Reply,
  HpkeConformanceFailure,
} from '@onyourleft/domain/hpke-testing';
import { fromHex } from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import { webCryptoHpkePrimitives } from './web-crypto';

type Key = Awaited<ReturnType<typeof crypto.subtle.importKey>>;

/** RFC 8410's PKCS #8 prefix for a raw X25519 private key. */
const X25519_PKCS8_PREFIX = fromHex('302e020100300506032b656e04220420', 'the prefix');

/** The vectors' fixed private keys, imported as the port's own handle. */
async function importX25519PrivateKey(raw: Uint8Array): Promise<Key> {
  const pkcs8 = new Uint8Array(X25519_PKCS8_PREFIX.length + raw.length);
  pkcs8.set(X25519_PKCS8_PREFIX, 0);
  pkcs8.set(raw, X25519_PKCS8_PREFIX.length);
  return crypto.subtle.importKey('pkcs8', pkcs8, { name: 'X25519' }, false, ['deriveBits']);
}

const port = webCryptoHpkePrimitives;

describe('the client’s HPKE primitives — #1188', () => {
  it('reproduce RFC 9180 Appendix A.1.1, mode_base: the shared secret, the key schedule, every encryption and every export', async () => {
    await expect(assertRfc9180A1Base(port, importX25519PrivateKey)).resolves.toBeUndefined();
  });

  it('refuse every A.1.1.1 ciphertext and AAD with one byte flipped, and messages out of order', async () => {
    await expect(
      assertRfc9180A1TamperingRefused(port, importX25519PrivateKey),
    ).resolves.toBeUndefined();
  });

  it('refuse the all-zero X25519 key and two other small-order points, on Encap and on Decap', async () => {
    await expect(
      assertLowOrderPointsRefused(port, importX25519PrivateKey),
    ).resolves.toBeUndefined();
  });

  it('reproduce RFC 9458 Appendix A’s response, which is ADR 0047 D-2’s reply derivation', async () => {
    await expect(assertRfc9458Reply(port, importX25519PrivateKey)).resolves.toBeUndefined();
  });

  it('raise at a lowered sequence limit, and never wrap', async () => {
    await expect(assertMessageLimitRaises(port)).resolves.toBeUndefined();
  });

  it('refuse an AES key that is not 16 bytes, rather than running AES-256', async () => {
    const empty = new Uint8Array(0);
    await expect(
      port.aes128GcmSeal(new Uint8Array(32), new Uint8Array(12), empty, empty),
    ).rejects.toThrow(RangeError);
  });

  it('refuse an all-zero X25519 output in the port itself', async () => {
    const pair = await port.generateX25519KeyPair();
    await expect(port.x25519(pair.privateKey, new Uint8Array(32))).rejects.toThrow();
  });

  describe('the assertions can fail', () => {
    it('A.1 fails over a port whose HMAC is off by one bit', async () => {
      const damaged = {
        ...port,
        hmacSha256: async (key: Uint8Array, data: Uint8Array) => {
          const mac = await port.hmacSha256(key, data);
          mac[0] = (mac[0] ?? 0) ^ 1;
          return mac;
        },
      };
      await expect(assertRfc9180A1Base(damaged, importX25519PrivateKey)).rejects.toBeInstanceOf(
        HpkeConformanceFailure,
      );
    });

    it('the tampering assertion fails over a port whose open never checks the tag', async () => {
      const credulous = {
        ...port,
        aes128GcmOpen: (_key: Uint8Array, _nonce: Uint8Array, _aad: Uint8Array, ct: Uint8Array) =>
          Promise.resolve(ct.slice(0, ct.length - 16)),
      };
      await expect(
        assertRfc9180A1TamperingRefused(credulous, importX25519PrivateKey),
      ).rejects.toBeInstanceOf(HpkeConformanceFailure);
    });
  });
});
