// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A rider's own hosted key and their own hosted consent in the store (#1199,
 * ADR 0046 D-9 as the owner ruled it on 2026-10-09: bring-your-own only, and
 * Q10's consent naming the origin). One of each an athlete, never another
 * athlete's, and each read back through a fresh connection
 * (`StoreHarness.read`).
 */

import { afterEach, describe, expect, it } from 'vitest';

import {
  ATHLETE_A,
  ATHLETE_B,
  createStoreHarness,
  registrationFixture,
  type StoreHarness,
} from './testing/index.ts';
import type { SealedHostedModelKey } from './sql-store.ts';

let harness: StoreHarness | undefined;
afterEach(async () => {
  await harness?.destroy();
  harness = undefined;
});

const SEALED: SealedHostedModelKey = {
  url: 'https://models.example/v1',
  model: 'a-model',
  iv: new Uint8Array(12).fill(9),
  ciphertext: new Uint8Array([1, 2, 3, 4]),
  setAt: 1_790_000_000,
};

async function registered(): Promise<StoreHarness> {
  const h = await createStoreHarness();
  await h.write(async (store) => {
    await store.registerAthlete(registrationFixture(ATHLETE_A));
    await store.registerAthlete(registrationFixture(ATHLETE_B));
  });
  return h;
}

describe('a rider’s own hosted key (#1199)', () => {
  it('is held for its athlete alone, and read back on a fresh connection', async () => {
    harness = await registered();
    expect(await harness.write((store) => store.putAthleteHostedKey(ATHLETE_A, SEALED))).toEqual({
      outcome: 'stored',
    });
    expect(await harness.read((store) => store.getAthleteHostedKey(ATHLETE_A))).toEqual({
      athleteId: ATHLETE_A,
      ...SEALED,
    });
    expect(await harness.read((store) => store.getAthleteHostedKey(ATHLETE_B))).toBeUndefined();
    // Not the operator's one key: a rider's key is never the instance's.
    expect(await harness.read((store) => store.getHostedModelKey())).toBeUndefined();
  });

  it('is one row an athlete: a second replaces the first, and another rider’s stays', async () => {
    harness = await registered();
    await harness.write((store) => store.putAthleteHostedKey(ATHLETE_A, SEALED));
    await harness.write((store) =>
      store.putAthleteHostedKey(ATHLETE_B, { ...SEALED, model: 'b-model' }),
    );
    const second = { ...SEALED, model: 'another', setAt: SEALED.setAt + 1 };
    await harness.write((store) => store.putAthleteHostedKey(ATHLETE_A, second));
    expect(await harness.read((store) => store.getAthleteHostedKey(ATHLETE_A))).toEqual({
      athleteId: ATHLETE_A,
      ...second,
    });
    expect(await harness.read((store) => store.getAthleteHostedKey(ATHLETE_B))).toMatchObject({
      model: 'b-model',
    });
  });

  it('writes nothing for an athlete who is not here', async () => {
    harness = await registered();
    expect(await harness.write((store) => store.putAthleteHostedKey('nobody', SEALED))).toEqual({
      outcome: 'no-athlete',
    });
    expect(await harness.read((store) => store.getAthleteHostedKey('nobody'))).toBeUndefined();
  });

  it('clears its own athlete’s key and no other', async () => {
    harness = await registered();
    await harness.write((store) => store.putAthleteHostedKey(ATHLETE_A, SEALED));
    await harness.write((store) => store.putAthleteHostedKey(ATHLETE_B, SEALED));
    expect(await harness.write((store) => store.clearAthleteHostedKey(ATHLETE_A))).toBe(true);
    expect(await harness.write((store) => store.clearAthleteHostedKey(ATHLETE_A))).toBe(false);
    expect(await harness.read((store) => store.getAthleteHostedKey(ATHLETE_A))).toBeUndefined();
    expect(await harness.read((store) => store.getAthleteHostedKey(ATHLETE_B))).toBeDefined();
  });
});

describe('a rider’s own hosted consent (#1199, ADR 0046 Q10)', () => {
  const CONSENT = { athleteId: ATHLETE_A, origin: 'https://models.example', recordedAt: 7 };

  it('is recorded for its athlete alone, and withdrawn for them alone', async () => {
    harness = await registered();
    expect(await harness.write((store) => store.putHostedConsent(CONSENT))).toEqual({
      outcome: 'stored',
    });
    await harness.write((store) => store.putHostedConsent({ ...CONSENT, athleteId: ATHLETE_B }));
    expect(await harness.read((store) => store.getHostedConsent(ATHLETE_A))).toEqual(CONSENT);
    expect(await harness.write((store) => store.clearHostedConsent(ATHLETE_A))).toBe(true);
    expect(await harness.write((store) => store.clearHostedConsent(ATHLETE_A))).toBe(false);
    expect(await harness.read((store) => store.getHostedConsent(ATHLETE_A))).toBeUndefined();
    expect(await harness.read((store) => store.getHostedConsent(ATHLETE_B))).toMatchObject({
      athleteId: ATHLETE_B,
    });
  });

  it('writes nothing for an athlete who is not here', async () => {
    harness = await registered();
    expect(
      await harness.write((store) => store.putHostedConsent({ ...CONSENT, athleteId: 'nobody' })),
    ).toEqual({ outcome: 'no-athlete' });
  });

  it('survives a key rotated at the same origin, and is withdrawn by a key at another', async () => {
    harness = await registered();
    await harness.write((store) => store.putHostedConsent(CONSENT));
    await harness.write((store) => store.putHostedConsent({ ...CONSENT, athleteId: ATHLETE_B }));
    await harness.write((store) => store.putAthleteHostedKey(ATHLETE_A, SEALED));
    // Same origin, another path and model: a rotation, which keeps the consent.
    await harness.write((store) =>
      store.putAthleteHostedKey(ATHLETE_A, {
        ...SEALED,
        url: 'https://models.example/v2',
        model: 'rotated',
      }),
    );
    expect(await harness.read((store) => store.getHostedConsent(ATHLETE_A))).toEqual(CONSENT);
    // Another origin: not what the rider consented to.
    await harness.write((store) =>
      store.putAthleteHostedKey(ATHLETE_A, { ...SEALED, url: 'https://elsewhere.example/v1' }),
    );
    expect(await harness.read((store) => store.getHostedConsent(ATHLETE_A))).toBeUndefined();
    // And only theirs.
    expect(await harness.read((store) => store.getHostedConsent(ATHLETE_B))).toBeDefined();
  });
});
