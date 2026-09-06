// SPDX-License-Identifier: Apache-2.0

/**
 * The guarantees that are not behaviour: what the type system forbids, and what
 * a message may never say.
 *
 * Every `@ts-expect-error` below is a guarantee that fails the build the moment
 * it stops being true — if the type is widened, the directive becomes an
 * *unused* directive and `tsc` reports `TS2578`. That is the mechanism
 * CLAUDE.md section 5 asks for, and the mutation that proves it is written
 * beside each one.
 */

import { describe, expect, it } from 'vitest';

import { fromHex } from './hex';
import {
  canonicalPayload,
  contentHashOf,
  recordPayload,
  signActivityRecord,
  type ActivityClaims,
} from './record';
import { ensureSigningKey } from './seam';
import { stubSha256, stubSigningKey } from './testing';

const CLAIMS: ActivityClaims = {
  activityId: 'ride-1',
  name: 'Sunday loop',
  startedAt: 1_700_000_000,
  startedAtTimeZone: 'Europe/London',
  elapsedTime: 3_600,
  movingTime: 3_540,
  distance: 42_195.5,
  hasPosition: true,
  averagePower: 214,
};

describe('a record cannot carry a coordinate — the compile-time half', () => {
  it('rejects a latitude on the claims', () => {
    // Mutation that proves this: add `readonly [member: string]: unknown` to
    // `ActivityClaims`. The directive below becomes unused and `pnpm run
    // typecheck` fails with TS2578.
    const claims: ActivityClaims = {
      ...CLAIMS,
      // @ts-expect-error a record references its ride by content hash and carries no position
      latitude: 51.5074,
    };

    expect(claims.activityId).toBe('ride-1');
  });

  it('rejects a longitude on the claims', () => {
    const claims: ActivityClaims = {
      ...CLAIMS,
      // @ts-expect-error see above — ADR 0004, and #21
      longitude: -0.1278,
    };

    expect(claims.activityId).toBe('ride-1');
  });

  it('rejects a start-position pair, which is the shape ADR 0004 names', () => {
    const claims: ActivityClaims = {
      ...CLAIMS,
      // @ts-expect-error ADR 0004 "Constraints this places on other work" item 1
      startPosition: { latitude: 51.5074, longitude: -0.1278 },
    };

    expect(claims.activityId).toBe('ride-1');
  });
});

describe('a signing key cannot hand out its private half — the compile-time half', () => {
  it('has no member that returns private key material', () => {
    // Mutation that proves this: add `readonly privateKey: Uint8Array` to
    // `SigningKey` in `seam.ts`. The directive becomes unused; TS2578.
    const key = stubSigningKey();

    // @ts-expect-error the private half is never reachable through this interface
    const leaked: unknown = key.privateKey;

    expect(leaked).toBeUndefined();
  });

  it('has no export path, in any encoding', () => {
    const key = stubSigningKey();

    // @ts-expect-error there is deliberately no `export`, `toJSON` or `seed`
    const leaked: unknown = key.exportPrivateKey;

    expect(leaked).toBeUndefined();
  });
});

describe('a serialised record contains no location — the runtime half', () => {
  it('has no coordinate-shaped member anywhere in its canonical text', async () => {
    // Serialised through the canonical form rather than `JSON.stringify`,
    // because the canonical form is what a record is when it is published.
    const record = await signActivityRecord(
      { claims: CLAIMS, contentHash: await contentHashOf(new Uint8Array([1, 2, 3]), stubSha256) },
      stubSigningKey(),
    );
    const text = canonicalPayload(recordPayload(record)).toLowerCase();

    for (const forbidden of [
      'latitude',
      'longitude',
      '"lat"',
      '"lon"',
      '"lng"',
      'semicircle',
      'coordinate',
      'startposition',
    ]) {
      expect(text).not.toContain(forbidden);
    }
    // `position` on its own is deliberately **not** on that list: `hasPosition`
    // is the one bit #62 needs, it is not a coordinate, and banning the
    // substring would ban it. `startposition` is on the list instead, because
    // a start-position pair is the shape ADR 0004 actually forbids.
    expect(record.claims.hasPosition).toBe(true);
  });
});

describe('no message names the material it rejected', () => {
  it('does not echo a rejected key', () => {
    // The private half of a key is the one value in this program that must
    // never reach a log line (#61). `fromHex` is the function it would pass
    // through, so its message names the field and the constraint only.
    const material = 'cafebabecafebabe!!';

    expect(() => fromHex(material, 'a private key')).toThrow(
      expect.objectContaining({
        message: expect.not.stringContaining('cafebabe') as unknown,
      }),
    );
  });

  it('does not echo the key when the keystore returns an unusable one', async () => {
    const publicKey = fromHex('ab'.repeat(31), 'a probe');

    await expect(
      ensureSigningKey({
        load: () => Promise.resolve({ ...stubSigningKey(), publicKey }),
        create: () => Promise.resolve(stubSigningKey()),
      }),
    ).rejects.toThrow(
      expect.objectContaining({
        message: expect.not.stringContaining('abab') as unknown,
      }),
    );
  });
});
