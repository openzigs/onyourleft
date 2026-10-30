// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The hosted model key in the store (#1097): held for ONE athlete — the
 * operator, whom `operator model-key set` looks up (ADR 0046 Q9) — on an
 * instance with any number of riders. The owner's ruling 5 on #1092
 * *"REPLACES ruling 3's 'single-rider only'"*, so holding a key never refuses
 * another rider's registration. Each read back through a fresh connection
 * (`StoreHarness.read`).
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

async function register(h: StoreHarness, athleteId: string): Promise<void> {
  await h.write((store) => store.registerAthlete(registrationFixture(athleteId)));
}

describe('a hosted key, held for the operator’s athlete (#1097)', () => {
  it('is held for the athlete named, and read back on a fresh connection', async () => {
    harness = await createStoreHarness();
    await register(harness, ATHLETE_A);
    expect(await harness.write((store) => store.putHostedModelKey(ATHLETE_A, SEALED))).toEqual({
      outcome: 'stored',
    });
    expect(await harness.read((store) => store.getHostedModelKey())).toEqual({
      athleteId: ATHLETE_A,
      ...SEALED,
    });
  });

  it('is held on an instance with three riders, whatever their registration state', async () => {
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
    expect(await harness.write((store) => store.putHostedModelKey(ATHLETE_B, SEALED))).toEqual({
      outcome: 'stored',
    });
    expect(await harness.read((store) => store.getHostedModelKey())).toMatchObject({
      athleteId: ATHLETE_B,
    });
  });

  it('replaces a key already held: one row, the newest', async () => {
    harness = await createStoreHarness();
    await register(harness, ATHLETE_A);
    await harness.write((store) => store.putHostedModelKey(ATHLETE_A, SEALED));
    const second = { ...SEALED, model: 'another', setAt: SEALED.setAt + 1 };
    await harness.write((store) => store.putHostedModelKey(ATHLETE_A, second));
    expect(await harness.read((store) => store.getHostedModelKey())).toEqual({
      athleteId: ATHLETE_A,
      ...second,
    });
  });

  it('is refused for an athlete who is not on the instance, and writes nothing', async () => {
    harness = await createStoreHarness();
    await register(harness, ATHLETE_A);
    expect(await harness.write((store) => store.putHostedModelKey(ATHLETE_B, SEALED))).toEqual({
      outcome: 'no-athlete',
    });
    expect(await harness.read((store) => store.getHostedModelKey())).toBeUndefined();
  });

  it('never refuses another rider’s registration while a key is held (ADR 0046 ruling 5)', async () => {
    harness = await createStoreHarness();
    await register(harness, ATHLETE_A);
    await harness.write((store) => store.putHostedModelKey(ATHLETE_A, SEALED));

    await register(harness, ATHLETE_B);
    await register(harness, ATHLETE_C);

    expect(await harness.read((store) => store.getAthlete(ATHLETE_B))).toBeDefined();
    expect(await harness.read((store) => store.listDeviceKeys(ATHLETE_C))).toHaveLength(1);
    expect(await harness.read((store) => store.getHostedModelKey())).toEqual({
      athleteId: ATHLETE_A,
      ...SEALED,
    });
  });

  it('clears the key, and says whether there was one', async () => {
    harness = await createStoreHarness();
    await register(harness, ATHLETE_A);
    await harness.write((store) => store.putHostedModelKey(ATHLETE_A, SEALED));
    expect(await harness.write((store) => store.clearHostedModelKey())).toBe(true);
    expect(await harness.write((store) => store.clearHostedModelKey())).toBe(false);
    expect(await harness.read((store) => store.getHostedModelKey())).toBeUndefined();
  });
});
