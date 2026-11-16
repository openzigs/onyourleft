// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The admin passkeys' WebAuthn verifier (#2642, ADR 0069 D-6): the committed
 * synthetic fixtures (`fixtures/webauthn.json`, written by
 * `tools/write-webauthn-fixtures.ts` with the tests' own software
 * authenticator), each named, each good one accepted and each bad one refused
 * with its reason; then every other check the verifier makes, each with a
 * case that goes red when the check is removed.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  challengeOf,
  counterMayFollow,
  derToRaw,
  fromBase64Url,
  toBase64Url,
  verifyAssertion,
  verifyRegistration,
  WebAuthnRefused,
  type Expected,
  type PasskeyAlgorithm,
  type StoredCredential,
} from './webauthn.ts';
import {
  encodeCbor,
  keyPair,
  rawToDer,
  softwareAuthenticator,
  type CborInput,
  type SoftwareAssertion,
  type SoftwareRegistration,
} from './webauthn-testing.ts';

interface Fixture {
  readonly name: string;
  readonly kind: 'registration' | 'assertion';
  readonly challenge: string;
  readonly credential: StoredCredential;
  readonly response: SoftwareRegistration | SoftwareAssertion;
  readonly outcome: string;
}

const FIXTURES = JSON.parse(
  readFileSync(new URL('./fixtures/webauthn.json', import.meta.url), 'utf8'),
) as { rpId: string; origin: string; fixtures: Fixture[] };

const decoded = (text: string): Uint8Array => {
  const bytes = fromBase64Url(text);
  if (bytes === undefined) throw new Error(`not base64url: ${text}`);
  return bytes;
};

const registrationOf = (response: SoftwareRegistration) => ({
  clientDataJSON: decoded(response.clientDataJSON),
  attestationObject: decoded(response.attestationObject),
});

const assertionOf = (response: SoftwareAssertion) => ({
  clientDataJSON: decoded(response.clientDataJSON),
  authenticatorData: decoded(response.authenticatorData),
  signature: decoded(response.signature),
});

/** What a verification ended in: `accepted`, or the refusal's reason. */
async function outcome(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
    return 'accepted';
  } catch (error) {
    if (error instanceof WebAuthnRefused) return error.reason;
    throw error;
  }
}

describe('the committed synthetic fixtures (#2642)', () => {
  it('are exactly the ones the issue names, every one of them', () => {
    expect(FIXTURES.fixtures.map((fixture) => fixture.name)).toEqual([
      'good es256 registration',
      'good es256 assertion',
      'good ed25519 registration',
      'good ed25519 assertion',
      'flipped signature byte',
      'wrong rpIdHash',
      'user verification unset',
      'sign count went backwards',
      'challenge from another action',
    ]);
  });

  it.each(FIXTURES.fixtures.map((fixture) => [fixture.name, fixture] as const))(
    '%s',
    async (_name, fixture) => {
      const expected: Expected = {
        rpId: FIXTURES.rpId,
        origin: FIXTURES.origin,
        challenge: fixture.challenge,
      };
      if (fixture.kind === 'registration') {
        const response = fixture.response as SoftwareRegistration;
        expect(await outcome(() => verifyRegistration(registrationOf(response), expected))).toBe(
          fixture.outcome,
        );
        const registered = await verifyRegistration(registrationOf(response), expected);
        expect(registered).toEqual({
          credentialId: response.credentialId,
          algorithm: fixture.credential.algorithm,
          publicKey: fixture.credential.publicKey,
          signCount: 0,
        });
        return;
      }
      const response = fixture.response as SoftwareAssertion;
      expect(
        await outcome(() => verifyAssertion(assertionOf(response), fixture.credential, expected)),
      ).toBe(fixture.outcome);
    },
  );
});

const RP: Omit<Expected, 'challenge'> = { rpId: 'ride.example', origin: 'https://ride.example' };
const CHALLENGE = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
const EXPECTED: Expected = { ...RP, challenge: CHALLENGE };

async function enrolled(algorithm: PasskeyAlgorithm) {
  const authenticator = await softwareAuthenticator(algorithm);
  const registration = await verifyRegistration(
    registrationOf(await authenticator.register(EXPECTED)),
    EXPECTED,
  );
  return { authenticator, credential: { ...registration } as StoredCredential };
}

describe('every check of an assertion, each refused by name (#2642)', () => {
  it.each(['es256', 'ed25519'] as const)(
    'accepts a good %s assertion, and its counter',
    async (algorithm) => {
      const { authenticator, credential } = await enrolled(algorithm);
      const verified = await verifyAssertion(
        assertionOf(await authenticator.assert(EXPECTED)),
        credential,
        EXPECTED,
      );
      expect(verified).toEqual({ signCount: 1 });
    },
  );

  it.each<
    [
      string,
      Parameters<Awaited<ReturnType<typeof softwareAuthenticator>>['assert']>[1],
      Partial<Expected>,
      string,
    ]
  >([
    ['a registration’s type', { type: 'webauthn.create' }, {}, 'type'],
    ['another origin', {}, { origin: 'https://evil.example' }, 'origin'],
    ['another port on the same host', {}, { origin: 'https://ride.example:8443' }, 'origin'],
    ['a cross-origin frame', { crossOrigin: true }, {}, 'cross_origin'],
    ['user presence unset', { flags: 0x04 }, {}, 'user_present'],
    ['user verification unset', { flags: 0x01 }, {}, 'user_verified'],
    ['another challenge', {}, { challenge: toBase64Url(new Uint8Array(32)) }, 'challenge'],
    ['another RP ID', { rpIdHashed: 'localhost' }, {}, 'rp_id'],
  ])('refuses %s', async (_name, bend, override, reason) => {
    const { authenticator, credential } = await enrolled('es256');
    const response = await authenticator.assert(EXPECTED, bend);
    expect(
      await outcome(() =>
        verifyAssertion(assertionOf(response), credential, { ...EXPECTED, ...override }),
      ),
    ).toBe(reason);
  });

  it('accepts a counter that stays zero, as a synced passkey’s does, and refuses one that does not rise', async () => {
    expect(counterMayFollow(0, 0)).toBe(true);
    expect(counterMayFollow(4, 5)).toBe(true);
    expect(counterMayFollow(5, 5)).toBe(false);
    expect(counterMayFollow(5, 0)).toBe(false);
    const synced = await softwareAuthenticator('ed25519', 'zero');
    const registration = await verifyRegistration(
      registrationOf(await synced.register(EXPECTED)),
      EXPECTED,
    );
    for (let use = 0; use < 2; use += 1) {
      expect(
        await verifyAssertion(assertionOf(await synced.assert(EXPECTED)), registration, EXPECTED),
      ).toEqual({ signCount: 0 });
    }
    const { authenticator, credential } = await enrolled('es256');
    const response = await authenticator.assert(EXPECTED, { signCount: 3 });
    expect(
      await outcome(() =>
        verifyAssertion(assertionOf(response), { ...credential, signCount: 3 }, EXPECTED),
      ),
    ).toBe('counter');
  });

  it('refuses a signature by another key over the same credential id', async () => {
    const { credential } = await enrolled('es256');
    const stranger = await softwareAuthenticator('es256');
    expect(
      await outcome(async () =>
        verifyAssertion(assertionOf(await stranger.assert(EXPECTED)), credential, EXPECTED),
      ),
    ).toBe('signature');
  });

  it.each(['es256', 'ed25519'] as const)(
    'refuses a %s assertion with ANY one byte flipped, anywhere in it',
    async (algorithm) => {
      const { authenticator, credential } = await enrolled(algorithm);
      const good = assertionOf(await authenticator.assert(EXPECTED, { signCount: 7 }));
      for (const part of ['clientDataJSON', 'authenticatorData', 'signature'] as const) {
        for (let at = 0; at < good[part].byteLength; at += 1) {
          const changed = good[part].slice();
          changed[at] = (changed[at] as number) ^ 0x01;
          expect(
            await outcome(() =>
              verifyAssertion({ ...good, [part]: changed }, credential, EXPECTED),
            ),
            `${part} byte ${String(at)}`,
          ).not.toBe('accepted');
        }
      }
      // The control: the same assertion, unchanged, is accepted.
      expect(await outcome(() => verifyAssertion(good, credential, EXPECTED))).toBe('accepted');
    },
  );

  it('refuses client data that is not JSON, or too long, as malformed', async () => {
    const { authenticator, credential } = await enrolled('es256');
    const good = assertionOf(await authenticator.assert(EXPECTED));
    for (const clientDataJSON of [
      new TextEncoder().encode('not json'),
      new TextEncoder().encode('[1]'),
      new Uint8Array(4096).fill(0x20),
      new Uint8Array(),
    ]) {
      expect(
        await outcome(() => verifyAssertion({ ...good, clientDataJSON }, credential, EXPECTED)),
      ).toBe('malformed');
    }
  });
});

describe('every check of an enrolment, each refused by name (#2642)', () => {
  /** An attestation object over `authData`, with `fmt` and a statement. */
  const attestation = (authData: Uint8Array, fmt = 'none', statement: CborInput = new Map()) =>
    encodeCbor(
      new Map<string, CborInput>([
        ['fmt', fmt],
        ['attStmt', statement],
        ['authData', authData],
      ]),
    );

  /** Authenticator data holding `credentialId` and `coseKey`, flags UP | UV | AT. */
  async function authData(credentialId: Uint8Array, coseKey: Uint8Array): Promise<Uint8Array> {
    const rpIdHash = new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(RP.rpId)),
    );
    const out = new Uint8Array(37 + 18 + credentialId.byteLength + coseKey.byteLength);
    out.set(rpIdHash, 0);
    out[32] = 0x45;
    out[53] = credentialId.byteLength >> 8;
    out[54] = credentialId.byteLength & 0xff;
    out.set(credentialId, 55);
    out.set(coseKey, 55 + credentialId.byteLength);
    return out;
  }

  const clientData = new TextEncoder().encode(
    JSON.stringify({ type: 'webauthn.create', challenge: CHALLENGE, origin: RP.origin }),
  );

  const enrolment = async (attestationObject: Uint8Array) =>
    outcome(() => verifyRegistration({ clientDataJSON: clientData, attestationObject }, EXPECTED));

  const ed25519Key = (x: Uint8Array, alg = -8): Uint8Array =>
    encodeCbor(
      new Map<number, CborInput>([
        [1, 1],
        [3, alg],
        [-1, 6],
        [-2, x],
      ]),
    );

  it('accepts a good enrolment built the same way — the control for the cases below', async () => {
    const pair = await keyPair('ed25519');
    const x = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
    expect(await enrolment(attestation(await authData(new Uint8Array(16), ed25519Key(x))))).toBe(
      'accepted',
    );
  });

  it('refuses an attestation format other than none, or a statement in it', async () => {
    const data = await authData(new Uint8Array(16), ed25519Key(new Uint8Array(32)));
    expect(await enrolment(attestation(data, 'packed'))).toBe('attestation');
    expect(
      await enrolment(
        attestation(data, 'none', new Map<string, CborInput>([['sig', new Uint8Array(1)]])),
      ),
    ).toBe('attestation');
  });

  it('refuses every algorithm but Ed25519 and ES256: RS256 (-257) is not offered and not taken', async () => {
    const rsa = encodeCbor(
      new Map<number, CborInput>([
        [1, 3],
        [3, -257],
        [-1, new Uint8Array(256)],
        [-2, new Uint8Array([1, 0, 1])],
      ]),
    );
    expect(await enrolment(attestation(await authData(new Uint8Array(16), rsa)))).toBe('algorithm');
  });

  it('refuses a key that does not match its algorithm, or is not a point on its curve', async () => {
    const wrongCurve = encodeCbor(
      new Map<number, CborInput>([
        [1, 1],
        [3, -8],
        [-1, 4],
        [-2, new Uint8Array(32)],
      ]),
    );
    expect(await enrolment(attestation(await authData(new Uint8Array(16), wrongCurve)))).toBe(
      'public_key',
    );
    const offCurve = encodeCbor(
      new Map<number, CborInput>([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, new Uint8Array(32).fill(1)],
        [-3, new Uint8Array(32).fill(2)],
      ]),
    );
    expect(await enrolment(attestation(await authData(new Uint8Array(16), offCurve)))).toBe(
      'public_key',
    );
  });

  it('refuses a credential id over 1023 bytes, and takes one of 1023', async () => {
    const pair = await keyPair('ed25519');
    const key = ed25519Key(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)));
    expect(await enrolment(attestation(await authData(new Uint8Array(1024), key)))).toBe(
      'credential',
    );
    expect(await enrolment(attestation(await authData(new Uint8Array(1023), key)))).toBe(
      'accepted',
    );
  });

  it('refuses authenticator data with a byte after the key, or no attested credential', async () => {
    const key = ed25519Key(new Uint8Array(32));
    const data = await authData(new Uint8Array(16), key);
    const longer = new Uint8Array(data.byteLength + 1);
    longer.set(data);
    expect(await enrolment(attestation(longer))).toBe('malformed');
    const bare = data.slice(0, 37);
    bare[32] = 0x05;
    expect(await enrolment(attestation(bare))).toBe('credential');
  });

  it('refuses an assertion’s type at enrolment, another origin, and UV unset', async () => {
    const authenticator = await softwareAuthenticator('es256');
    const at = async (bend: Parameters<typeof authenticator.register>[1], expected = EXPECTED) =>
      outcome(async () =>
        verifyRegistration(registrationOf(await authenticator.register(EXPECTED, bend)), expected),
      );
    expect(await at({ type: 'webauthn.get' })).toBe('type');
    expect(await at({}, { ...EXPECTED, origin: 'http://localhost:8788' })).toBe('origin');
    expect(await at({ flags: 0x41 })).toBe('user_verified');
    expect(await at({})).toBe('accepted');
  });
});

describe('the encodings the verifier reads (#2642)', () => {
  it('converts an ES256 DER signature to raw r ‖ s, and refuses DER that is not strict', () => {
    const raw = new Uint8Array(64);
    raw[0] = 0x80; // r needs a leading zero in DER
    raw[63] = 0x01;
    const der = rawToDer(raw);
    expect(derToRaw(der)).toEqual(raw);
    // A short r (leading zero bytes dropped) is padded back.
    const short = new Uint8Array(64);
    short[5] = 0x11;
    short[40] = 0x22;
    expect(derToRaw(rawToDer(short))).toEqual(short);
    for (const bad of [
      new Uint8Array([0x30, 0x06, 0x02, 0x01, 0x00, 0x02, 0x01, 0x01]), // r = 0 written as 00
      new Uint8Array([0x30, 0x07, 0x02, 0x02, 0x00, 0x01, 0x02, 0x01, 0x01]), // needless zero
      new Uint8Array([0x30, 0x06, 0x02, 0x01, 0x81, 0x02, 0x01, 0x01]), // negative r
      new Uint8Array([0x31, 0x06, 0x02, 0x01, 0x01, 0x02, 0x01, 0x01]), // not a SEQUENCE
      new Uint8Array([...der, 0x00]), // a byte after it
      raw, // raw, not DER
    ]) {
      expect(derToRaw(bad)).toBeUndefined();
    }
  });

  it('reads base64url in its canonical spelling only', () => {
    expect(fromBase64Url('AQID')).toEqual(new Uint8Array([1, 2, 3]));
    expect(fromBase64Url('_-8')).toEqual(new Uint8Array([0xff, 0xef]));
    for (const bad of ['AQID=', 'AQ+D', 'A', 'AR']) expect(fromBase64Url(bad), bad).toBeUndefined();
  });

  it('reads the challenge a response names, before it is verified, and refuses one that is not base64url', () => {
    const named = new TextEncoder().encode(JSON.stringify({ challenge: CHALLENGE }));
    expect(challengeOf(named)).toBe(CHALLENGE);
    expect(() => challengeOf(new TextEncoder().encode('{"challenge":"a b"}'))).toThrow(
      WebAuthnRefused,
    );
    expect(() => challengeOf(new TextEncoder().encode('{}'))).toThrow(WebAuthnRefused);
  });
});
