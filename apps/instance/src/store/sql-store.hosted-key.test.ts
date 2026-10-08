// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The hosted model key in the store (#1097): held only on a single-rider
 * instance, in BOTH directions — a key is refused on an instance with more
 * than one athlete, and a second athlete is refused on an instance holding a
 * key (the owner's ruling on #1092's question 3). Each read back through a
 * fresh connection (`StoreHarness.read`).
 */

import { afterEach, describe, expect, it } from 'vitest';

import {
  ATHLETE_A,
  ATHLETE_B,
  ATHLETE_C,
  createStoreHarness,
  registrationFixture,
  type StoreHarness,
} from './testing/index.ts';
import { HostedKeyHeldError, type SealedHostedModelKey } from './sql-store.ts';

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

async function register(h: StoreHarness, athleteId: string): Promise<void> {
  await h.write((store) => store.registerAthlete(registrationFixture(athleteId)));
}

describe('a hosted key on a single-rider instance only (#1097)', () => {
  it('is held for the one athlete there is, and read back on a fresh connection', async () => {
    harness = await createStoreHarness();
    await register(harness, ATHLETE_A);
    expect(await harness.write((store) => store.putHostedModelKey(SEALED))).toEqual({
      outcome: 'stored',
      athleteId: ATHLETE_A,
    });
    expect(await harness.read((store) => store.getHostedModelKey())).toEqual({
      athleteId: ATHLETE_A,
      ...SEALED,
    });
  });

  it('replaces a key already held: one row, the newest', async () => {
    harness = await createStoreHarness();
    await register(harness, ATHLETE_A);
    await harness.write((store) => store.putHostedModelKey(SEALED));
    const second = { ...SEALED, model: 'another', setAt: SEALED.setAt + 1 };
    await harness.write((store) => store.putHostedModelKey(second));
    expect(await harness.read((store) => store.getHostedModelKey())).toEqual({
      athleteId: ATHLETE_A,
      ...second,
    });
  });

  it('is refused on an instance with no athlete, and writes nothing', async () => {
    harness = await createStoreHarness();
    expect(await harness.write((store) => store.putHostedModelKey(SEALED))).toEqual({
      outcome: 'not-single-rider',
      athletes: 0,
    });
    expect(await harness.read((store) => store.getHostedModelKey())).toBeUndefined();
  });

  it('is refused on an instance with two athletes, and writes nothing', async () => {
    harness = await createStoreHarness();
    await register(harness, ATHLETE_A);
    await register(harness, ATHLETE_B);
    expect(await harness.write((store) => store.putHostedModelKey(SEALED))).toEqual({
      outcome: 'not-single-rider',
      athletes: 2,
    });
    expect(await harness.read((store) => store.getHostedModelKey())).toBeUndefined();
  });

  it('counts athletes whatever their registration state: three, two of them not active, is three', async () => {
    harness = await createStoreHarness();
    await register(harness, ATHLETE_A);
    for (const [athleteId, registrationState] of [
      [ATHLETE_B, 'pending'],
      [ATHLETE_C, 'refused'],
    ] as const) {
      const fixture = registrationFixture(athleteId);
      await harness.write((store) =>
        store.registerAthlete({ ...fixture, athlete: { ...fixture.athlete, registrationState } }),
      );
    }
    expect(await harness.write((store) => store.putHostedModelKey(SEALED))).toEqual({
      outcome: 'not-single-rider',
      athletes: 3,
    });
    expect(await harness.read((store) => store.getHostedModelKey())).toBeUndefined();
  });

  it('refuses a second athlete’s registration while a key is held, writing nothing of them', async () => {
    harness = await createStoreHarness();
    await register(harness, ATHLETE_A);
    await harness.write((store) => store.putHostedModelKey(SEALED));

    await expect(register(harness, ATHLETE_B)).rejects.toBeInstanceOf(HostedKeyHeldError);

    expect(await harness.read((store) => store.getAthlete(ATHLETE_B))).toBeUndefined();
    expect(await harness.read((store) => store.listDeviceKeys(ATHLETE_B))).toEqual([]);
    expect(await harness.read((store) => store.getHostedModelKey())).toMatchObject({
      athleteId: ATHLETE_A,
    });
  });

  it('admits a second athlete again once the operator clears the key', async () => {
    harness = await createStoreHarness();
    await register(harness, ATHLETE_A);
    await harness.write((store) => store.putHostedModelKey(SEALED));
    expect(await harness.write((store) => store.clearHostedModelKey())).toBe(true);
    expect(await harness.write((store) => store.clearHostedModelKey())).toBe(false);
    await register(harness, ATHLETE_B);
    expect(await harness.read((store) => store.getAthlete(ATHLETE_B))).toBeDefined();
    expect(await harness.read((store) => store.getHostedModelKey())).toBeUndefined();
  });
});
