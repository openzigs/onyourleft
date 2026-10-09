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
  confirmationTokenFixture,
  createStoreHarness,
  deviceKeyFixture,
  FIXTURE_RENAME_LIMIT,
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
    // B's only key, so it needs one of B's codes (#867).
    const [code] = registrationFixture(ATHLETE_B).recoveryCodeSha256s;
    expect(
      await opened.write((store) =>
        store.revokeDeviceKey(ATHLETE_B, key, 1_790_001_000, code ?? null, key, 0),
      ),
    ).toBe('revoked');
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
    const [codeOfA] = registrationFixture(ATHLETE_A).recoveryCodeSha256s;
    expect(
      await opened.write((store) =>
        store.revokeDeviceKey(ATHLETE_A, key, 5, codeOfA ?? null, key, 0),
      ),
    ).toBe('not_found');
    expect((await opened.read((store) => store.findDeviceKey(key)))?.revokedAt).toBeNull();
  });

  describe('the last-key rule, in the transaction that revokes (#867)', () => {
    const key = deviceKeyFixture(ATHLETE_B).publicKey;
    const [codeOfB] = registrationFixture(ATHLETE_B).recoveryCodeSha256s as [string];
    const [codeOfA] = registrationFixture(ATHLETE_A).recoveryCodeSha256s as [string];

    it('refuses the last live key with no code, another athlete’s code, or a spent one', async () => {
      const opened = await world();
      for (const proof of [null, codeOfA, 'f0'.repeat(32)]) {
        expect(
          await opened.write((store) => store.revokeDeviceKey(ATHLETE_B, key, 5, proof, key, 0)),
        ).toBe('last_device');
      }
      await opened.write((store) => store.takeRecoveryCode(codeOfB, 6));
      expect(
        await opened.write((store) => store.revokeDeviceKey(ATHLETE_B, key, 7, codeOfB, key, 0)),
      ).toBe('last_device');
      expect((await opened.read((store) => store.findDeviceKey(key)))?.revokedAt).toBeNull();
    });

    it('revokes the last live key with a held code, and does not spend the code', async () => {
      const opened = await world();
      expect(
        await opened.write((store) => store.revokeDeviceKey(ATHLETE_B, key, 5, codeOfB, key, 0)),
      ).toBe('revoked');
      expect((await opened.read((store) => store.findDeviceKey(key)))?.revokedAt).toBe(5);
      const codes = await opened.read((store) => store.listRecoveryCodes(ATHLETE_B));
      expect(codes.map((code) => code.usedAt)).toEqual([null]);
    });

    it('needs no code while another key is live, and counts only live keys', async () => {
      const opened = await world();
      const second = { ...deviceKeyFixture(ATHLETE_B), publicKey: 'second-key-of-b' };
      await opened.write((store) => store.putDeviceKey(second));
      expect(
        await opened.write((store) =>
          store.revokeDeviceKey(ATHLETE_B, second.publicKey, 5, null, second.publicKey, 0),
        ),
      ).toBe('revoked');
      // Revoking an already revoked key again is not the last-key case.
      expect(
        await opened.write((store) =>
          store.revokeDeviceKey(ATHLETE_B, second.publicKey, 6, null, second.publicKey, 0),
        ),
      ).toBe('revoked');
      expect(
        await opened.write((store) => store.revokeDeviceKey(ATHLETE_B, key, 7, null, key, 0)),
      ).toBe('last_device');
    });
  });

  it('checks a recovery code as its own athlete’s, unspent, and does not spend it (#898)', async () => {
    const opened = await world();
    const [codeOfB] = registrationFixture(ATHLETE_B).recoveryCodeSha256s as [string];
    expect(await opened.read((store) => store.hasRecoveryCode(ATHLETE_B, codeOfB))).toBe(true);
    // Another athlete's code is no step-up for this one.
    expect(await opened.read((store) => store.hasRecoveryCode(ATHLETE_A, codeOfB))).toBe(false);
    expect(await opened.read((store) => store.hasRecoveryCode(ATHLETE_B, 'f0'.repeat(32)))).toBe(
      false,
    );
    const codes = await opened.read((store) => store.listRecoveryCodes(ATHLETE_B));
    expect(codes.map((code) => code.usedAt)).toEqual([null]);
    await opened.write((store) => store.takeRecoveryCode(codeOfB, 6));
    expect(await opened.read((store) => store.hasRecoveryCode(ATHLETE_B, codeOfB))).toBe(false);
  });

  it('keeps what a session reaches, full unless it says leave (#898)', async () => {
    const opened = await world();
    const full = sessionFixture(ATHLETE_A);
    expect((await opened.read((store) => store.findSession(full.tokenSha256)))?.scope).toBe('full');
    const leave = {
      ...sessionFixture(ATHLETE_A),
      tokenSha256: 'e1'.repeat(32),
      scope: 'leave' as const,
    };
    await opened.write((store) => store.putSession(leave));
    expect((await opened.read((store) => store.findSession(leave.tokenSha256)))?.scope).toBe(
      'leave',
    );
  });

  it('records when a key was last used, for its own athlete only', async () => {
    const opened = await world();
    const key = deviceKeyFixture(ATHLETE_B).publicKey;
    await opened.write((store) => store.touchDeviceKey(ATHLETE_A, key, 7));
    expect((await opened.read((store) => store.findDeviceKey(key)))?.lastUsedAt).toBeNull();
    await opened.write((store) => store.touchDeviceKey(ATHLETE_B, key, 7));
    expect((await opened.read((store) => store.findDeviceKey(key)))?.lastUsedAt).toBe(7);
  });

  it('registers a new athlete with their first key, codes and a confirmation, or nothing', async () => {
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
    // Given, not bound (#865).
    expect(await opened.read((store) => store.listRecoveryEmails('athlete-d'))).toEqual([]);
    expect(
      await opened.read((store) => store.findRecoveryEmail('athlete-d@example.org')),
    ).toBeUndefined();
    expect(await opened.read((store) => store.listEmailConfirmations('athlete-d'))).toEqual([
      {
        tokenSha256: confirmationTokenFixture('athlete-d'),
        athleteId: 'athlete-d',
        address: 'athlete-d@example.org',
        expiresAt: 1_790_086_400,
        usedAt: null,
        requestedByKey: deviceKeyFixture('athlete-d').publicKey,
        supersededAt: null,
      },
    ]);
  });
});

describe('confirming a recovery address (#865)', () => {
  const token = confirmationTokenFixture('athlete-d');

  it('binds the address only when its token is spent, once, before it expires', async () => {
    const opened = await world();
    await opened.write((store) => store.registerAthlete(registrationFixture('athlete-d')));
    expect(
      await opened.write((store) =>
        store.confirmRecoveryEmail(
          'athlete-d',
          token,
          1_790_086_400,
          deviceKeyFixture('athlete-d').publicKey,
          2,
        ),
      ),
    ).toEqual({ outcome: 'expired' });
    expect(await opened.read((store) => store.listRecoveryEmails('athlete-d'))).toEqual([]);
    expect(
      await opened.write((store) =>
        store.confirmRecoveryEmail(
          'athlete-d',
          token,
          1_790_000_500,
          deviceKeyFixture('athlete-d').publicKey,
          2,
        ),
      ),
    ).toEqual({ outcome: 'taken', athleteId: 'athlete-d', added: true });
    expect(await opened.read((store) => store.listRecoveryEmails('athlete-d'))).toEqual([
      {
        athleteId: 'athlete-d',
        address: 'athlete-d@example.org',
        confirmedAt: 1_790_000_500,
        boundByKey: deviceKeyFixture('athlete-d').publicKey,
      },
    ]);
    expect(
      await opened.write((store) =>
        store.confirmRecoveryEmail(
          'athlete-d',
          token,
          1_790_000_501,
          deviceKeyFixture('athlete-d').publicKey,
          2,
        ),
      ),
    ).toEqual({ outcome: 'used' });
    expect(
      await opened.write((store) =>
        store.confirmRecoveryEmail(
          'athlete-d',
          'e4'.repeat(32),
          1,
          deviceKeyFixture('athlete-d').publicKey,
          2,
        ),
      ),
    ).toEqual({ outcome: 'unknown' });
  });

  it('spends a token only as the athlete it was given for: another athlete’s is unknown', async () => {
    const opened = await world();
    await opened.write((store) => store.registerAthlete(registrationFixture('athlete-d')));
    for (const other of [ATHLETE_A, ATHLETE_B, ATHLETE_C]) {
      expect(
        await opened.write((store) =>
          store.confirmRecoveryEmail(
            other,
            token,
            1_790_000_500,
            deviceKeyFixture(other).publicKey,
            2,
          ),
        ),
      ).toEqual({ outcome: 'unknown' });
      expect((await opened.read((store) => store.listRecoveryEmails(other)))[0]?.address).toBe(
        `${other}@example.org`,
      );
    }
    const [pending] = await opened.read((store) => store.listEmailConfirmations('athlete-d'));
    expect(pending?.usedAt).toBeNull();
  });

  it('refuses an address another athlete confirmed first, spending and binding nothing', async () => {
    const opened = await world();
    await opened.write((store) =>
      store.registerAthlete({
        ...registrationFixture('athlete-d'),
        recoveryEmailConfirmation: {
          tokenSha256: token,
          address: `${ATHLETE_A}@example.org`,
          expiresAt: 1_790_086_400,
        },
      }),
    );
    expect(
      await opened.write((store) =>
        store.confirmRecoveryEmail(
          'athlete-d',
          token,
          1_790_000_500,
          deviceKeyFixture('athlete-d').publicKey,
          2,
        ),
      ),
    ).toEqual({ outcome: 'held' });
    expect(await opened.read((store) => store.listRecoveryEmails('athlete-d'))).toEqual([]);
    expect(
      (await opened.read((store) => store.findRecoveryEmail(`${ATHLETE_A}@example.org`)))
        ?.athleteId,
    ).toBe(ATHLETE_A);
    const [pending] = await opened.read((store) => store.listEmailConfirmations('athlete-d'));
    expect(pending?.usedAt).toBeNull();
  });

  it('adds a newly confirmed address BESIDE the athlete’s own, held, and replaces none (#1194)', async () => {
    const opened = await world();
    await opened.write((store) =>
      store.putEmailConfirmation({
        tokenSha256: token,
        athleteId: ATHLETE_B,
        address: 'new-b@example.org',
        expiresAt: 1_790_086_400,
        requestedByKey: deviceKeyFixture(ATHLETE_B).publicKey,
      }),
    );
    expect(
      await opened.write((store) =>
        store.confirmRecoveryEmail(
          ATHLETE_B,
          token,
          1_790_000_500,
          deviceKeyFixture(ATHLETE_B).publicKey,
          2,
        ),
      ),
    ).toEqual({ outcome: 'taken', athleteId: ATHLETE_B, added: true });
    expect(
      (await opened.read((store) => store.listRecoveryEmails(ATHLETE_B))).map(
        (each) => each.address,
      ),
    ).toEqual([`${ATHLETE_B}@example.org`, 'new-b@example.org']);
    // Nobody else's binding moved.
    for (const other of [ATHLETE_A, ATHLETE_C]) {
      expect(
        (await opened.read((store) => store.listRecoveryEmails(other))).map((each) => each.address),
      ).toEqual([`${other}@example.org`]);
    }
  });
});

describe('pending confirmations are bounded: one a key (#883, #1194)', () => {
  it('replaces the same key’s earlier unconfirmed code, keeps a spent one, and touches nobody else’s', async () => {
    const opened = await world();
    const confirmation = (athleteId: string, tokenSha256: string, address: string) =>
      opened.write((store) =>
        store.putEmailConfirmation({
          tokenSha256,
          athleteId,
          address,
          expiresAt: 1_790_086_400,
          requestedByKey: deviceKeyFixture(athleteId).publicKey,
        }),
      );
    const spent = 'a'.repeat(64);
    await confirmation(ATHLETE_B, spent, 'spent-b@example.org');
    expect(
      (
        await opened.write((store) =>
          store.confirmRecoveryEmail(
            ATHLETE_B,
            spent,
            1_790_000_500,
            deviceKeyFixture(ATHLETE_B).publicKey,
            2,
          ),
        )
      ).outcome,
    ).toBe('taken');
    await confirmation(ATHLETE_C, 'c'.repeat(64), 'c-pending@example.org');
    for (let n = 0; n < 5; n += 1) {
      await confirmation(ATHLETE_B, n.toString(16).repeat(64), `b-${n}@example.org`);
    }
    const kept = await opened.read((store) => store.listEmailConfirmations(ATHLETE_B));
    expect(kept.filter((each) => each.usedAt === null).map((each) => each.address)).toEqual([
      'b-4@example.org',
    ]);
    expect(kept.filter((each) => each.usedAt !== null).map((each) => each.address)).toContain(
      'spent-b@example.org',
    );
    // The replaced link spends nothing: it is simply unknown now.
    expect(
      await opened.write((store) =>
        store.confirmRecoveryEmail(
          ATHLETE_B,
          '3'.repeat(64),
          1_790_000_600,
          deviceKeyFixture(ATHLETE_B).publicKey,
          2,
        ),
      ),
    ).toEqual({ outcome: 'unknown' });
    expect(
      (await opened.read((store) => store.listEmailConfirmations(ATHLETE_C))).map(
        (each) => each.address,
      ),
    ).toContain('c-pending@example.org');
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
    ).toEqual({
      outcome: 'taken',
      athleteId: ATHLETE_A,
      mintedByKey: deviceKeyFixture(ATHLETE_A).publicKey,
    });
    expect(
      await opened.write((store) => store.takeLinkCode(code.codeSha256, code.expiresAt - 1)),
    ).toEqual({ outcome: 'used' });
  });

  it('refuses a link code naming another athlete’s key — the schema, beneath the port', async () => {
    const opened = await world();
    await expect(
      opened.write((store) =>
        store.putLinkCode(
          {
            codeSha256: 'c3'.repeat(32),
            athleteId: ATHLETE_A,
            mintedByKey: deviceKeyFixture(ATHLETE_B).publicKey,
            expiresAt: 10,
          },
          1,
        ),
      ),
    ).rejects.toThrow(/FOREIGN KEY/);
  });
});

describe('display names (#774)', () => {
  it('keeps every earlier name, for one athlete only', async () => {
    const opened = await world();
    expect(
      await opened.write((store) =>
        store.renameAthlete(ATHLETE_B, 'Third', 1_790_002_000, FIXTURE_RENAME_LIMIT),
      ),
    ).toBe('renamed');
    expect((await opened.read((store) => store.getAthlete(ATHLETE_B)))?.displayName).toBe('Third');
    expect(await opened.read((store) => store.listDisplayNameChanges(ATHLETE_B))).toEqual([
      { athleteId: ATHLETE_B, previousName: `Rider ${ATHLETE_B}`, changedAt: 1_790_000_300 },
      { athleteId: ATHLETE_B, previousName: `Renamed ${ATHLETE_B}`, changedAt: 1_790_002_000 },
    ]);
    expect(await opened.read((store) => store.listDisplayNameChanges(ATHLETE_A))).toHaveLength(1);
    expect(
      await opened.write((store) => store.renameAthlete('nobody', 'x', 1, FIXTURE_RENAME_LIMIT)),
    ).toBe('not_found');
  });

  it('counts the limit in the transaction that renames: this athlete’s changes, in the window (#867)', async () => {
    const opened = await world();
    // The fixture renamed each athlete once, at 1_790_000_300.
    const limit = { count: 2, windowSeconds: 1_000 };
    const at = 1_790_000_300 + 500;
    expect(await opened.write((store) => store.renameAthlete(ATHLETE_B, 'Second', at, limit))).toBe(
      'renamed',
    );
    expect(
      await opened.write((store) => store.renameAthlete(ATHLETE_B, 'Third', at + 1, limit)),
    ).toBe('rate_limited');
    expect((await opened.read((store) => store.getAthlete(ATHLETE_B)))?.displayName).toBe('Second');
    expect(await opened.read((store) => store.listDisplayNameChanges(ATHLETE_B))).toHaveLength(2);
    // Another athlete's changes are not counted against B's, and nor is A's
    // own fixture rename once it has left the window.
    expect(
      await opened.write((store) => store.renameAthlete(ATHLETE_A, 'Other', at + 1, limit)),
    ).toBe('renamed');
    expect(
      await opened.write((store) =>
        store.renameAthlete(ATHLETE_B, 'Later', 1_790_000_300 + 1_000, limit),
      ),
    ).toBe('renamed');
  });
});

describe('email recovery tokens (#773)', () => {
  it('finds an athlete by address, and spends a token once before it expires', async () => {
    const opened = await world();
    expect(
      await opened.read((store) => store.findRecoveryEmail(`${ATHLETE_B}@example.org`)),
    ).toMatchObject({ athleteId: ATHLETE_B, address: `${ATHLETE_B}@example.org` });
    const [token] = await opened.read((store) => store.listEmailRecoveryTokens(ATHLETE_B));
    if (token === undefined) throw new Error('no fixture token');
    expect(
      await opened.write((store) =>
        store.takeEmailRecoveryToken(token.tokenSha256, token.expiresAt, 2_000_000_000),
      ),
    ).toEqual({ outcome: 'expired' });
    expect(
      await opened.write((store) =>
        store.takeEmailRecoveryToken(token.tokenSha256, 1, 2_000_000_000),
      ),
    ).toEqual({ outcome: 'taken', athleteId: ATHLETE_B, address: `${ATHLETE_B}@example.org` });
    expect(
      await opened.write((store) =>
        store.takeEmailRecoveryToken(token.tokenSha256, 1, 2_000_000_000),
      ),
    ).toEqual({ outcome: 'used' });
  });
});
