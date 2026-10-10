// SPDX-License-Identifier: Apache-2.0

/**
 * The device's half of ADR 0047 D-5 and D-6 (#1190): reading an instance card,
 * and judging a `GET /v1/instance/keys` answer against the pin and against what
 * the device has seen. The signatures are this package's stand-in
 * (`testing.ts`); real Ed25519 runs in `apps/web/src/instance/instance-pin.test.ts`.
 */

import { describe, expect, it } from 'vitest';

import { fromHex, toHex } from './hex';
import {
  base32Unpadded,
  INSTANCE_IDENTITY_ROTATION_PURPOSE,
  INSTANCE_KEY_PURPOSE,
  instanceCard,
  instanceIdentityFingerprint,
  instanceIdentityRotationBytes,
  instanceKeyId,
  instanceKeyStatementBytes,
  type InstanceIdentityRotation,
  type InstanceKeyStatement,
} from './instance-key-statement';
import {
  base32UnpaddedDecode,
  fingerprintsEqual,
  judgeInstanceKeys,
  NO_KEY_TRUST,
  parseInstanceCard,
  STATEMENT_TRUST_CAP_SECONDS,
  type InstanceKeyTrust,
} from './instance-pin';
import { stubPublicKey, stubSha256, stubSigningKey, stubVerifier } from './testing';

const ORIGIN = 'https://ride.example';
const T0 = 1_790_000_000;
const HOUR = 3600;

async function fingerprintOf(label: string, origin = ORIGIN): Promise<Uint8Array> {
  return instanceIdentityFingerprint(stubSha256, origin, toHex(stubPublicKey(label)));
}

async function statementFor(
  encryptionLabel: string,
  members: Partial<InstanceKeyStatement> = {},
): Promise<InstanceKeyStatement> {
  const encryptionKey = stubPublicKey(encryptionLabel);
  return {
    purpose: INSTANCE_KEY_PURPOSE,
    instanceOrigin: ORIGIN,
    keyId: await instanceKeyId(stubSha256, encryptionKey),
    encryptionKey: toHex(encryptionKey),
    serial: T0,
    notBefore: T0,
    issuedAt: T0,
    notAfter: T0 + 48 * HOUR,
    ...members,
  };
}

async function signed(identityLabel: string, statement: InstanceKeyStatement) {
  const signature = await stubSigningKey(identityLabel).sign(instanceKeyStatementBytes(statement));
  return { statement, signature: toHex(signature) };
}

async function served(
  identityLabel: string,
  statements: readonly InstanceKeyStatement[],
  endorsements: readonly unknown[] = [],
) {
  return {
    identityKey: toHex(stubPublicKey(identityLabel)),
    statements: await Promise.all(statements.map((each) => signed(identityLabel, each))),
    endorsements,
  };
}

async function judge(
  body: unknown,
  options: { pin?: Uint8Array; trust?: InstanceKeyTrust; now?: number } = {},
) {
  return judgeInstanceKeys({
    served: body,
    origin: ORIGIN,
    pin: options.pin ?? (await fingerprintOf('identity')),
    trust: options.trust ?? NO_KEY_TRUST,
    now: options.now ?? T0 + HOUR,
    sha256: stubSha256,
    verifier: stubVerifier,
  });
}

describe('an instance card, read back (#1190, ADR 0047 D-6)', () => {
  it('reads the card the instance writes, whole', async () => {
    const fingerprint = await fingerprintOf('identity');
    const read = parseInstanceCard(instanceCard(ORIGIN, fingerprint), ORIGIN);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.card.origin).toBe(ORIGIN);
    expect(read.card.fingerprint).toEqual(fingerprint);
    expect(read.card.fingerprintText).toBe(base32Unpadded(fingerprint));
    // A pasted line's newline is not part of it.
    expect(parseInstanceCard(`  ${instanceCard(ORIGIN, fingerprint)}\n`).ok).toBe(true);
  });

  it.each([
    ['a truncated fingerprint', (card: string) => card.slice(0, -1), 'fingerprint'],
    ['one character too many', (card: string) => `${card}A`, 'fingerprint'],
    [
      'a character outside base32',
      (card: string) => `${card.slice(0, -2)}1${card.slice(-1)}`,
      'fingerprint',
    ],
    [
      'lower-case base32',
      (card: string) => card.replace(/#(.*)$/, (_, f: string) => `#${f.toLowerCase()}`),
      'fingerprint',
    ],
    ['extra characters after it', (card: string) => `${card} please`, 'fingerprint'],
    ['no prefix', (card: string) => card.replace('oyl-instance:', ''), 'not-a-card'],
    [
      'a URL scheme spelling',
      (card: string) => card.replace('oyl-instance:', 'oyl-instance://'),
      'not-a-card',
    ],
    ['a path in the origin', (card: string) => card.replace(ORIGIN, `${ORIGIN}/x`), 'not-a-card'],
    ['two #', (card: string) => card.replace('#', '##'), 'not-a-card'],
  ])('refuses %s', async (_, spoil, problem) => {
    const card = instanceCard(ORIGIN, await fingerprintOf('identity'));
    expect(parseInstanceCard(spoil(card), ORIGIN)).toEqual({ ok: false, problem });
  });

  it('refuses a card for another origin than the account’s', async () => {
    const card = instanceCard('https://other.example', await fingerprintOf('identity'));
    expect(parseInstanceCard(card, ORIGIN)).toEqual({ ok: false, problem: 'other-origin' });
  });

  it('refuses a last character whose padding bits are set, so one fingerprint has one spelling', () => {
    const zeros = 'A'.repeat(52);
    expect(base32UnpaddedDecode(zeros, 32)).toEqual(new Uint8Array(32));
    // 52 characters carry 260 bits: the last character's low four are padding.
    expect(base32UnpaddedDecode(`${'A'.repeat(51)}B`, 32)).toBeUndefined();
    expect(base32UnpaddedDecode(`${'A'.repeat(51)}Q`, 32)).toBeDefined();
  });

  it('compares fingerprints whole: a card differing only in its last character is not the pin', async () => {
    const fingerprint = await fingerprintOf('identity');
    const text = base32Unpadded(fingerprint);
    const last = text.at(-1) === 'A' ? 'Q' : 'A';
    const other = base32UnpaddedDecode(`${text.slice(0, -1)}${last}`, 32)!;
    expect(other).toBeDefined();
    expect(fingerprintsEqual(fingerprint, other)).toBe(false);
    expect(fingerprintsEqual(fingerprint, fingerprint.slice())).toBe(true);
    // A prefix is never a match, however long.
    expect(fingerprintsEqual(fingerprint.slice(0, 31), fingerprint.slice(0, 31))).toBe(false);
  });
});

describe('judging the keys an instance serves (#1190, ADR 0047 D-5)', () => {
  it('trusts a statement the pinned key signed, and remembers its serial', async () => {
    const statement = await statementFor('enc-1');
    const verdict = await judge(await served('identity', [statement]));
    expect(verdict.kind).toBe('trusted');
    if (verdict.kind !== 'trusted') return;
    expect(verdict.statement).toEqual(statement);
    expect(verdict.trust.highestSerial).toBe(T0);
    expect(verdict.trust.highestKeyId).toBe(statement.keyId);
  });

  it('is a mismatch when another identity key signs, and when the pin differs in its last byte', async () => {
    const statement = await statementFor('enc-1');
    expect(await judge(await served('impostor', [statement]))).toEqual({ kind: 'mismatch' });
    const pin = (await fingerprintOf('identity')).slice();
    pin[31] = (pin[31] ?? 0) ^ 1;
    expect(await judge(await served('identity', [statement]), { pin })).toEqual({
      kind: 'mismatch',
    });
    expect(await judge({ identityKey: 'nope' })).toEqual({ kind: 'mismatch' });
  });

  it('asks for a new card on an endorsement from the pinned key, and never re-pins on it', async () => {
    const next = toHex(stubPublicKey('identity-2'));
    const rotation: InstanceIdentityRotation = {
      purpose: INSTANCE_IDENTITY_ROTATION_PURPOSE,
      instanceOrigin: ORIGIN,
      previousIdentityKey: toHex(stubPublicKey('identity')),
      identityKey: next,
      fingerprint: base32Unpadded(await fingerprintOf('identity-2')),
      issuedAt: T0,
    };
    const signature = toHex(
      await stubSigningKey('identity').sign(instanceIdentityRotationBytes(rotation)),
    );
    const body = await served(
      'identity-2',
      [await statementFor('enc-1')],
      [{ statement: rotation, signature }],
    );
    expect(await judge(body)).toEqual({ kind: 'new-card', fingerprint: rotation.fingerprint });

    // An endorsement the pinned key did not sign is no endorsement.
    const forged = toHex(
      await stubSigningKey('identity-2').sign(instanceIdentityRotationBytes(rotation)),
    );
    const forgedBody = await served(
      'identity-2',
      [await statementFor('enc-1')],
      [{ statement: rotation, signature: forged }],
    );
    expect(await judge(forgedBody)).toEqual({ kind: 'mismatch' });
  });

  it('refuses an endorsement that is not tied to the pinned key, the fingerprint or the origin', async () => {
    const endorse = async (
      signer: string,
      previousLabel: string,
      members: Partial<InstanceIdentityRotation> = {},
    ) => {
      const rotation: InstanceIdentityRotation = {
        purpose: INSTANCE_IDENTITY_ROTATION_PURPOSE,
        instanceOrigin: ORIGIN,
        previousIdentityKey: toHex(stubPublicKey(previousLabel)),
        identityKey: toHex(stubPublicKey('identity-2')),
        fingerprint: base32Unpadded(await fingerprintOf('identity-2')),
        issuedAt: T0,
        ...members,
      };
      const signature = toHex(
        await stubSigningKey(signer).sign(instanceIdentityRotationBytes(rotation)),
      );
      return judge(
        await served(
          'identity-2',
          [await statementFor('enc-1')],
          [{ statement: rotation, signature }],
        ),
      );
    };

    // Control: the pinned key's own endorsement is accepted.
    expect((await endorse('identity', 'identity')).kind).toBe('new-card');
    // An impostor endorsing its own key under its own previous key, validly signed.
    expect(await endorse('impostor', 'impostor')).toEqual({ kind: 'mismatch' });
    // Signed by the pinned key, but naming a fingerprint other than the served key's.
    expect(
      await endorse('identity', 'identity', {
        fingerprint: base32Unpadded(await fingerprintOf('impostor')),
      }),
    ).toEqual({ kind: 'mismatch' });
    // Signed by the pinned key, but for another origin.
    expect(
      await endorse('identity', 'identity', { instanceOrigin: 'https://other.example' }),
    ).toEqual({ kind: 'mismatch' });
  });

  it('never goes back: after serial 5, an answer serving only serial 4 is older, naming 5', async () => {
    const five = await statementFor('enc-5', { serial: 5 });
    const four = await statementFor('enc-4', { serial: 4 });
    const seen = await judge(await served('identity', [five, four]));
    expect(seen.kind).toBe('trusted');
    if (seen.kind !== 'trusted') return;
    expect(seen.statement.serial).toBe(5);

    const stripped = await judge(await served('identity', [four]), { trust: seen.trust });
    expect(stripped).toMatchObject({ kind: 'older', highestSerial: 5 });

    // A re-signed statement for the same key, with the same serial, is accepted.
    const resigned = await statementFor('enc-5', {
      serial: 5,
      issuedAt: T0 + 24 * HOUR,
      notAfter: T0 + 72 * HOUR,
    });
    const again = await judge(await served('identity', [resigned]), {
      trust: seen.trust,
      now: T0 + 25 * HOUR,
    });
    expect(again).toMatchObject({ kind: 'trusted', statement: resigned });

    // The same serial on a different key is not the key this device has seen.
    const swapped = await statementFor('enc-other', { serial: 5 });
    expect(await judge(await served('identity', [swapped]), { trust: seen.trust })).toMatchObject({
      kind: 'older',
    });
  });

  it('stops trusting a statement 48 hours after first verifying it, however far away its notAfter is', async () => {
    const yearLong = await statementFor('enc-1', { notAfter: T0 + 365 * 24 * HOUR });
    const body = await served('identity', [yearLong]);
    const first = await judge(body, { now: T0 });
    expect(first.kind).toBe('trusted');
    if (first.kind !== 'trusted') return;
    const justInside = await judge(body, {
      trust: first.trust,
      now: T0 + STATEMENT_TRUST_CAP_SECONDS - 1,
    });
    expect(justInside.kind).toBe('trusted');
    const after = await judge(body, { trust: first.trust, now: T0 + STATEMENT_TRUST_CAP_SECONDS });
    expect(after.kind).toBe('expired');
    // Shown again later, its 48 hours do not start again.
    if (after.kind !== 'expired') return;
    const later = await judge(body, { trust: after.trust, now: T0 + 30 * 24 * HOUR });
    expect(later.kind).toBe('expired');
  });

  describe('48 hours per KEY, not per re-signing (#1216, ADR 0047 D-5 amendment of 2026-10-09)', () => {
    const DAY = 24 * HOUR;
    /**
     * The same key, re-signed each day, as an edge might hold them for a
     * device that was away: one serial, one key, a distant `notAfter` so that
     * only the 48 hours bound them.
     */
    const resigning = (day: number) =>
      statementFor('enc-1', { issuedAt: T0 + day * DAY, notAfter: T0 + 365 * DAY });

    it('refuses a run of unseen older re-signings once a newer one has been verified', async () => {
      const [one, two, three] = await Promise.all([resigning(1), resigning(2), resigning(3)]);
      // The edge leads with its newest held re-signing: trusted, 48 hours.
      const newest = await judge(await served('identity', [three]), { now: T0 + 10 * DAY });
      expect(newest).toMatchObject({ kind: 'trusted', statement: three });
      if (newest.kind !== 'trusted') return;
      expect(newest.trust.newestIssued[three.keyId]?.issuedAt).toBe(three.issuedAt);

      // Its 48 hours run out, and the edge hands out the older ones it holds,
      // each never seen here — every one would have started 48 hours of its own.
      let trust: InstanceKeyTrust = newest.trust;
      let now = T0 + 10 * DAY + STATEMENT_TRUST_CAP_SECONDS;
      for (const older of [two, one]) {
        const verdict = await judge(await served('identity', [older]), { trust, now });
        expect(verdict.kind).toBe('expired');
        if (verdict.kind !== 'expired') return;
        trust = verdict.trust;
        now += HOUR;
      }
      // And the newest itself does not start again.
      expect((await judge(await served('identity', [three]), { trust, now })).kind).toBe('expired');
    });

    it('learns the newest from an answer that serves several, and trusts only that one', async () => {
      const [one, three] = await Promise.all([resigning(1), resigning(3)]);
      const both = await judge(await served('identity', [one, three]), { now: T0 + 4 * DAY });
      expect(both).toMatchObject({ kind: 'trusted', statement: three });
      if (both.kind !== 'trusted') return;
      // The older one alone, later, inside the newest's 48 hours: not trusted.
      expect(
        (await judge(await served('identity', [one]), { trust: both.trust, now: T0 + 5 * DAY }))
          .kind,
      ).toBe('expired');
    });

    it('control: the daily re-signing a device does see is trusted each day, past 48 hours from the first', async () => {
      let trust: InstanceKeyTrust = NO_KEY_TRUST;
      for (const day of [0, 1, 2, 3, 4]) {
        const statement = await resigning(day);
        const verdict = await judge(await served('identity', [statement]), {
          trust,
          now: T0 + day * DAY + HOUR,
        });
        expect(verdict).toMatchObject({ kind: 'trusted', statement });
        if (verdict.kind !== 'trusted') return;
        trust = verdict.trust;
      }
    });

    it('forgets a key’s newest once its notAfter has passed', async () => {
      const short = await statementFor('enc-1', { notAfter: T0 + 2 * HOUR });
      const seen = await judge(await served('identity', [short]), { now: T0 + HOUR });
      expect(seen.kind).toBe('trusted');
      if (seen.kind !== 'trusted') return;
      expect(Object.keys(seen.trust.newestIssued)).toEqual([short.keyId]);
      const after = await judge(await served('identity', []), {
        trust: seen.trust,
        now: T0 + 2 * HOUR,
      });
      expect(after.kind).toBe('expired');
      if (after.kind !== 'expired') return;
      expect(after.trust.newestIssued).toEqual({});
    });
  });

  it('accepts an issuedAt and a notBefore in the device’s future, and refuses one past its notAfter', async () => {
    const ahead = await statementFor('enc-1', {
      notBefore: T0 + 10 * HOUR,
      issuedAt: T0 + 10 * HOUR,
      notAfter: T0 + 58 * HOUR,
    });
    expect((await judge(await served('identity', [ahead]), { now: T0 })).kind).toBe('trusted');
    const past = await statementFor('enc-1', { notAfter: T0 + HOUR });
    expect((await judge(await served('identity', [past]), { now: T0 + HOUR })).kind).toBe(
      'expired',
    );
  });

  it('counts no statement for another origin, with a wrong key id, or a bad signature', async () => {
    const otherOrigin = await statementFor('enc-1', { instanceOrigin: 'https://other.example' });
    const wrongId = await statementFor('enc-1', { keyId: '0123456789abcdef' });
    const body = await served('identity', [otherOrigin, wrongId]);
    expect((await judge(body)).kind).toBe('expired');
    const good = await signed('identity', await statementFor('enc-1'));
    const badSignature = {
      identityKey: toHex(stubPublicKey('identity')),
      statements: [{ ...good, signature: toHex(fromHex(good.signature, 's', 64).reverse()) }],
      endorsements: [],
    };
    expect((await judge(badSignature)).kind).toBe('expired');
  });
});
