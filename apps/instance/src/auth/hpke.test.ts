// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The instance's HPKE primitives against RFC 9180 Appendix A.1 and RFC 9458
 * Appendix A, and the client's and the instance's run against each other
 * (#1188, ADR 0047 D-2, D-3).
 *
 * The client's implementation is imported by a relative path, app to
 * package, which `boundaries/dependencies` permits: the instance does not
 * depend on `@onyourleft/store`, and the interop criterion is about the two
 * implementations, not the package around one of them.
 */

import {
  fromHex,
  HpkeError,
  openReply,
  sealReply,
  setupBaseRecipient,
  setupBaseSender,
  utf8Encode,
} from '@onyourleft/domain';
import {
  assertLowOrderPointsRefused,
  assertMessageLimitRaises,
  assertRfc9180A1Base,
  assertRfc9180A1TamperingRefused,
  assertRfc9458Reply,
} from '@onyourleft/domain/hpke-testing';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { webCryptoHpkePrimitives } from '../../../../packages/store/src/hpke-web-crypto.ts';
import { instanceHpkePrimitives } from './crypto.ts';

type Key = Awaited<ReturnType<typeof crypto.subtle.importKey>>;

/** RFC 8410's PKCS #8 prefix for a raw X25519 private key. */
const X25519_PKCS8_PREFIX = fromHex('302e020100300506032b656e04220420', 'the prefix');

async function importX25519PrivateKey(raw: Uint8Array): Promise<Key> {
  const pkcs8 = new Uint8Array(X25519_PKCS8_PREFIX.length + raw.length);
  pkcs8.set(X25519_PKCS8_PREFIX, 0);
  pkcs8.set(raw, X25519_PKCS8_PREFIX.length);
  return crypto.subtle.importKey('pkcs8', pkcs8, { name: 'X25519' }, false, ['deriveBits']);
}

const port = instanceHpkePrimitives;
const INFO = utf8Encode('oyl #1188 interop');

describe('the instance’s HPKE primitives — #1188', () => {
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
});

describe('the client and the instance, against each other — #1188', () => {
  it('a request the client seals is opened by the instance, and the instance’s reply by the client', async () => {
    const instanceKey = await instanceHpkePrimitives.generateX25519KeyPair();
    const aad = utf8Encode('the envelope');

    const device = await setupBaseSender(webCryptoHpkePrimitives, instanceKey.publicKey, INFO);
    const request = await device.seal(aad, utf8Encode('a ride, sealed'));

    const instance = await setupBaseRecipient(
      instanceHpkePrimitives,
      instanceKey,
      device.enc,
      INFO,
    );
    expect(await instance.open(aad, request)).toEqual(utf8Encode('a ride, sealed'));

    const reply = await sealReply(instanceHpkePrimitives, instance);
    const first = await reply.seal(aad, utf8Encode('event 0'));
    const second = await reply.seal(aad, utf8Encode('event 1'));

    const opener = await openReply(webCryptoHpkePrimitives, device, reply.responseNonce);
    expect(await opener.open(aad, first)).toEqual(utf8Encode('event 0'));
    expect(await opener.open(aad, second)).toEqual(utf8Encode('event 1'));

    // And the reply does not open under another request's context.
    const stranger = await setupBaseSender(webCryptoHpkePrimitives, instanceKey.publicKey, INFO);
    const misdirected = await openReply(webCryptoHpkePrimitives, stranger, reply.responseNonce);
    await expect(misdirected.open(aad, first)).rejects.toBeInstanceOf(HpkeError);
  });

  it('one request answered twice gives two response nonces and two different ciphertexts for the same plaintext (ADR 0047 D-2)', async () => {
    const instanceKey = await instanceHpkePrimitives.generateX25519KeyPair();
    const device = await setupBaseSender(webCryptoHpkePrimitives, instanceKey.publicKey, INFO);
    const empty = new Uint8Array(0);
    const request = await device.seal(empty, utf8Encode('once'));
    const instance = await setupBaseRecipient(
      instanceHpkePrimitives,
      instanceKey,
      device.enc,
      INFO,
    );
    await instance.open(empty, request);

    const plaintext = utf8Encode('the same answer');
    const firstReply = await sealReply(instanceHpkePrimitives, instance);
    const secondReply = await sealReply(instanceHpkePrimitives, instance);
    expect(firstReply.responseNonce).not.toEqual(secondReply.responseNonce);

    const firstCiphertext = await firstReply.seal(empty, plaintext);
    const secondCiphertext = await secondReply.seal(empty, plaintext);
    expect(firstCiphertext).not.toEqual(secondCiphertext);

    // Each still opens on the device, under its own nonce and no other.
    const firstOpener = await openReply(webCryptoHpkePrimitives, device, firstReply.responseNonce);
    const secondOpener = await openReply(
      webCryptoHpkePrimitives,
      device,
      secondReply.responseNonce,
    );
    expect(await firstOpener.open(empty, firstCiphertext)).toEqual(plaintext);
    expect(await secondOpener.open(empty, secondCiphertext)).toEqual(plaintext);
    const crossed = await openReply(webCryptoHpkePrimitives, device, firstReply.responseNonce);
    await expect(crossed.open(empty, secondCiphertext)).rejects.toBeInstanceOf(HpkeError);
  });

  it('a reply is not sealed under the request’s own key and nonce', async () => {
    const instanceKey = await instanceHpkePrimitives.generateX25519KeyPair();
    const device = await setupBaseSender(webCryptoHpkePrimitives, instanceKey.publicKey, INFO);
    const empty = new Uint8Array(0);
    const plaintext = utf8Encode('same bytes both ways');
    const request = await device.seal(empty, plaintext);
    const instance = await setupBaseRecipient(
      instanceHpkePrimitives,
      instanceKey,
      device.enc,
      INFO,
    );
    await instance.open(empty, request);
    const reply = await (await sealReply(instanceHpkePrimitives, instance)).seal(empty, plaintext);
    expect(reply).not.toEqual(request);
  });
});

/** The text between a file's two `hpke-primitives` markers, markers included. */
function hpkeRegion(source: string, file: string): string {
  const begin = source.indexOf('// <hpke-primitives>');
  const end = source.indexOf('// </hpke-primitives>');
  if (begin === -1 || end === -1 || end < begin) {
    throw new Error(`${file} has lost its hpke-primitives markers`);
  }
  if (source.indexOf('// <hpke-primitives>', begin + 1) !== -1) {
    throw new Error(`${file} has a second hpke-primitives region`);
  }
  return source.slice(begin, source.indexOf('\n', end));
}

describe('one HPKE port in two files — #1198', () => {
  it('the instance’s copy is byte-for-byte the client’s, between the markers', () => {
    const client = 'packages/store/src/hpke-web-crypto.ts';
    const instance = 'apps/instance/src/auth/crypto.ts';
    const clientRegion = hpkeRegion(
      readFileSync(new URL(`../../../../${client}`, import.meta.url), 'utf8'),
      client,
    );
    const instanceRegion = hpkeRegion(
      readFileSync(new URL('./crypto.ts', import.meta.url), 'utf8'),
      instance,
    );
    // The region is the whole port, not a stub: all six members are in it.
    for (const member of [
      'generateX25519KeyPair',
      'x25519',
      'hmacSha256',
      'aes128GcmSeal',
      'aes128GcmOpen',
      'randomBytes',
    ]) {
      expect(clientRegion).toMatch(new RegExp(`\\n {2}(?:async )?${member}\\(`));
    }
    expect(instanceRegion, `${instance} has drifted from ${client}: edit both`).toBe(clientRegion);
  });
});

describe('a small-order point is refused as low-order-point by both real ports — #1198', () => {
  const points = [
    '0000000000000000000000000000000000000000000000000000000000000000',
    '0100000000000000000000000000000000000000000000000000000000000000',
    'e0eb7a7c3b41b8ae1656e3faf19fc46ada098deb9c32b1fd866205165f49b800',
  ];

  for (const [name, primitives] of [
    ['the instance’s', instanceHpkePrimitives],
    ['the client’s', webCryptoHpkePrimitives],
  ] as const) {
    it(`${name} x25519 throws HpkeError('low-order-point'), and Encap and Decap pass it on`, async () => {
      const pair = await primitives.generateX25519KeyPair();
      for (const point of points) {
        const publicKey = fromHex(point, 'a low-order point');
        const direct: unknown = await primitives
          .x25519(pair.privateKey, publicKey)
          .catch((error: unknown) => error);
        expect(direct).toBeInstanceOf(HpkeError);
        expect((direct as HpkeError).reason).toBe('low-order-point');
        await expect(setupBaseSender(primitives, publicKey, INFO)).rejects.toMatchObject({
          reason: 'low-order-point',
        });
        await expect(setupBaseRecipient(primitives, pair, publicKey, INFO)).rejects.toMatchObject({
          reason: 'low-order-point',
        });
      }
    });
  }
});
