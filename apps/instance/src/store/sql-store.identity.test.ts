// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Migration 0004's port members (#772, #773, #774), each claim read back on a
 * fresh connection, and each athlete-scoped WRITE shown to leave the other
 * two athletes' rows alone.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { OwnershipConflictError } from './sql-store.ts';
import {
  ATHLETE_A,
  ATHLETE_B,
  ATHLETE_C,
  createStoreHarness,
  deviceKeyFixture,
  registrationFixture,
  seedWorld,
  sessionFixture,
  type StoreHarness,
} from './testing/index.ts';

let harness: StoreHarness | undefined;
afterEach(async () => {
  await harness?.destroy();
  harness = undefined;
});

async function world(): Promise<StoreHarness> {
  harness = await createStoreHarness();
  await harness.write(seedWorld);
  return harness;
}

const NONCE = 'a1'.repeat(32);

describe('challenges (#772)', () => {
  it('is spent once: taken, then used — read on a fresh connection each time', async () => {
    const opened = await world();
    await opened.write((store) =>
      store.putChallenge({ nonce: NONCE, publicKey: 'k', expiresAt: 1_000 }),
    );
    expect(await opened.read((store) => store.takeChallenge(NONCE, 999))).toEqual({
      outcome: 'taken',
      publicKey: 'k',
    });
    expect(await opened.read((store) => store.takeChallenge(NONCE, 999))).toEqual({
      outcome: 'used',
    });
  });

  it('is expired from its expiry on, and an expired one is not spent', async () => {
    const opened = await world();
    await opened.write((store) =>
      store.putChallenge({ nonce: NONCE, publicKey: 'k', expiresAt: 1_000 }),
    );
    expect(await opened.read((store) => store.takeChallenge(NONCE, 1_000))).toEqual({
      outcome: 'expired',
    });
    expect(await opened.read((store) => store.takeChallenge(NONCE, 1_000))).toEqual({
      outcome: 'expired',
    });
  });

  it('is unknown when never issued, and pruned once expired', async () => {
    const opened = await world();
    expect(await opened.read((store) => store.takeChallenge(NONCE, 1))).toEqual({
      outcome: 'unknown',
    });
    await opened.write(async (store) => {
      await store.putChallenge({ nonce: NONCE, publicKey: 'k', expiresAt: 1_000 });
      await store.putChallenge({ nonce: 'b2'.repeat(32), publicKey: 'k', expiresAt: 2_000 });
    });
    expect(await opened.write((store) => store.pruneChallenges(1_500))).toBe(1);
    expect(await opened.read((store) => store.takeChallenge(NONCE, 1))).toEqual({
      outcome: 'unknown',
    });
    expect((await opened.read((store) => store.takeChallenge('b2'.repeat(32), 1))).outcome).toBe(
      'taken',
    );
  });
});

describe('device keys (#772, #773)', () => {
  it('revokes one athlete’s key, its sessions and its link codes, and nobody else’s', async () => {
    const opened = await world();
    const key = deviceKeyFixture(ATHLETE_B).publicKey;
    expect(
      await opened.write((store) => store.revokeDeviceKey(ATHLETE_B, key, 1_790_001_000)),
    ).toBe(true);
    const b = await opened.read((store) => store.findDeviceKey(key));
    expect(b?.revokedAt).toBe(1_790_001_000);
    const session = await opened.read((store) =>
      store.findSession(sessionFixture(ATHLETE_B).tokenSha256),
    );
    expect(session?.revokedAt).toBe(1_790_001_000);
    const links = await opened.read((store) => store.listLinkCodes(ATHLETE_B));
    expect(links.every((each) => each.usedAt === 1_790_001_000)).toBe(true);

    for (const other of [ATHLETE_A, ATHLETE_C]) {
      const keys = await opened.read((store) => store.listDeviceKeys(other));
      expect(keys.every((each) => each.revokedAt === null)).toBe(true);
      const sessions = await opened.read((store) => store.listSessions(other));
      expect(sessions.every((each) => each.revokedAt === null)).toBe(true);
    }
  });

  it('will not revoke a key as an athlete who does not hold it', async () => {
    const opened = await world();
    const key = deviceKeyFixture(ATHLETE_B).publicKey;
    expect(await opened.write((store) => store.revokeDeviceKey(ATHLETE_A, key, 5))).toBe(false);
    expect((await opened.read((store) => store.findDeviceKey(key)))?.revokedAt).toBeNull();
  });

  it('records when a key was last used, for its own athlete only', async () => {
    const opened = await world();
    const key = deviceKeyFixture(ATHLETE_B).publicKey;
    await opened.write((store) => store.touchDeviceKey(ATHLETE_A, key, 7));
    expect((await opened.read((store) => store.findDeviceKey(key)))?.lastUsedAt).toBeNull();
    await opened.write((store) => store.touchDeviceKey(ATHLETE_B, key, 7));
    expect((await opened.read((store) => store.findDeviceKey(key)))?.lastUsedAt).toBe(7);
  });

  it('registers a new athlete with their first key, codes and address, or nothing', async () => {
    const opened = await world();
    await expect(
      opened.write((store) =>
        store.registerAthlete({
          ...registrationFixture('athlete-d'),
          key: {
            ...deviceKeyFixture('athlete-d'),
            publicKey: deviceKeyFixture(ATHLETE_A).publicKey,
          },
        }),
      ),
    ).rejects.toBeInstanceOf(OwnershipConflictError);
    expect(await opened.read((store) => store.getAthlete('athlete-d'))).toBeUndefined();

    await opened.write((store) => store.registerAthlete(registrationFixture('athlete-d')));
    expect((await opened.read((store) => store.getAthlete('athlete-d')))?.id).toBe('athlete-d');
    expect(await opened.read((store) => store.listRecoveryCodes('athlete-d'))).toHaveLength(1);
    expect((await opened.read((store) => store.getRecoveryEmail('athlete-d')))?.address).toBe(
      'athlete-d@example.org',
    );
  });

  it('registers a second athlete whose address is already held, and leaves the address where it was (#861)', async () => {
    const opened = await world();
    await opened.write((store) => store.registerAthlete(registrationFixture('athlete-d')));
    await opened.write((store) =>
      store.registerAthlete({
        ...registrationFixture('athlete-e'),
        recoveryEmail: 'athlete-d@example.org',
      }),
    );
    expect((await opened.read((store) => store.getAthlete('athlete-e')))?.id).toBe('athlete-e');
    expect(await opened.read((store) => store.getRecoveryEmail('athlete-e'))).toBeUndefined();
    expect(
      (await opened.read((store) => store.findRecoveryEmail('athlete-d@example.org')))?.athleteId,
    ).toBe('athlete-d');
  });
});

describe('sessions (#772)', () => {
  it('revokes one athlete’s session and refuses to revoke another’s', async () => {
    const opened = await world();
    const token = sessionFixture(ATHLETE_B).tokenSha256;
    expect(await opened.write((store) => store.revokeSession(ATHLETE_A, token, 9))).toBe(false);
    expect((await opened.read((store) => store.findSession(token)))?.revokedAt).toBeNull();
    expect(await opened.write((store) => store.revokeSession(ATHLETE_B, token, 9))).toBe(true);
    expect((await opened.read((store) => store.findSession(token)))?.revokedAt).toBe(9);
    // A second revocation does not move the first one's time.
    await opened.write((store) => store.revokeSession(ATHLETE_B, token, 99));
    expect((await opened.read((store) => store.findSession(token)))?.revokedAt).toBe(9);
  });
});

describe('recovery and link codes (#773)', () => {
  it('spends a recovery code once, whoever asks, and names its athlete', async () => {
    const opened = await world();
    const [code] = await opened.read((store) => store.listRecoveryCodes(ATHLETE_C));
    if (code === undefined) throw new Error('no fixture code');
    expect(await opened.write((store) => store.takeRecoveryCode(code.codeSha256, 50))).toEqual({
      outcome: 'taken',
      athleteId: ATHLETE_C,
    });
    expect(await opened.write((store) => store.takeRecoveryCode(code.codeSha256, 51))).toEqual({
      outcome: 'used',
    });
    expect((await opened.read((store) => store.listRecoveryCodes(ATHLETE_C)))[0]?.usedAt).toBe(50);
  });

  it('spends a link code once, and not after it expired', async () => {
    const opened = await world();
    const [code] = await opened.read((store) => store.listLinkCodes(ATHLETE_A));
    if (code === undefined) throw new Error('no fixture code');
    expect(
      await opened.write((store) => store.takeLinkCode(code.codeSha256, code.expiresAt)),
    ).toEqual({
      outcome: 'expired',
    });
    expect(
      await opened.write((store) => store.takeLinkCode(code.codeSha256, code.expiresAt - 1)),
    ).toEqual({ outcome: 'taken', athleteId: ATHLETE_A });
    expect(
      await opened.write((store) => store.takeLinkCode(code.codeSha256, code.expiresAt - 1)),
    ).toEqual({ outcome: 'used' });
  });

  it('refuses a link code naming another athlete’s key — the schema, beneath the port', async () => {
    const opened = await world();
    await expect(
      opened.write((store) =>
        store.putLinkCode({
          codeSha256: 'c3'.repeat(32),
          athleteId: ATHLETE_A,
          mintedByKey: deviceKeyFixture(ATHLETE_B).publicKey,
          expiresAt: 10,
        }),
      ),
    ).rejects.toThrow(/FOREIGN KEY/);
  });
});

describe('display names (#774)', () => {
  it('keeps every earlier name, for one athlete only', async () => {
    const opened = await world();
    await opened.write((store) => store.renameAthlete(ATHLETE_B, 'Third', 1_790_002_000));
    expect((await opened.read((store) => store.getAthlete(ATHLETE_B)))?.displayName).toBe('Third');
    expect(await opened.read((store) => store.listDisplayNameChanges(ATHLETE_B))).toEqual([
      { athleteId: ATHLETE_B, previousName: `Rider ${ATHLETE_B}`, changedAt: 1_790_000_300 },
      { athleteId: ATHLETE_B, previousName: `Renamed ${ATHLETE_B}`, changedAt: 1_790_002_000 },
    ]);
    expect(await opened.read((store) => store.listDisplayNameChanges(ATHLETE_A))).toHaveLength(1);
    expect(await opened.write((store) => store.renameAthlete('nobody', 'x', 1))).toBe(false);
  });
});

describe('email recovery tokens (#773)', () => {
  it('finds an athlete by address, and spends a token once before it expires', async () => {
    const opened = await world();
    expect(
      await opened.read((store) => store.findRecoveryEmail(`${ATHLETE_B}@example.org`)),
    ).toEqual({ athleteId: ATHLETE_B, address: `${ATHLETE_B}@example.org` });
    const [token] = await opened.read((store) => store.listEmailRecoveryTokens(ATHLETE_B));
    if (token === undefined) throw new Error('no fixture token');
    expect(
      await opened.write((store) =>
        store.takeEmailRecoveryToken(token.tokenSha256, token.expiresAt),
      ),
    ).toEqual({ outcome: 'expired' });
    expect(
      await opened.write((store) => store.takeEmailRecoveryToken(token.tokenSha256, 1)),
    ).toEqual({ outcome: 'taken', athleteId: ATHLETE_B });
    expect(
      await opened.write((store) => store.takeEmailRecoveryToken(token.tokenSha256, 1)),
    ).toEqual({ outcome: 'used' });
  });
});
