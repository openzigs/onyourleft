// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { unixSeconds, watts } from '@onyourleft/domain';
import { deviceId } from '@onyourleft/sensors';

import {
  createTrainerTargetMemory,
  REMEMBERED_TARGET_MAX_AGE_SECONDS,
} from './trainer-target-memory';

const KEY = 'oyl.trainerTargets.v1';
const KICKR = deviceId('kickr');
const NEO = deviceId('neo');

function memoryStorage(initial?: string): {
  readonly rows: Map<string, string>;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
} {
  const rows = new Map<string, string>();
  if (initial !== undefined) rows.set(KEY, initial);
  return {
    rows,
    getItem: (key) => rows.get(key) ?? null,
    setItem: (key, value) => {
      rows.set(key, value);
    },
    removeItem: (key) => {
      rows.delete(key);
    },
  };
}

describe('the device’s memory of acknowledged trainer targets — #1305', () => {
  it('is read back by a NEW memory over the same storage, as after a page reload', () => {
    const storage = memoryStorage();
    createTrainerTargetMemory(storage).remember(KICKR, watts(250), unixSeconds(1000));

    const reloaded = createTrainerTargetMemory(storage);

    expect(reloaded.recall(KICKR, unixSeconds(1000))).toBe(250);
    expect(reloaded.recall(KICKR, unixSeconds(1000 + REMEMBERED_TARGET_MAX_AGE_SECONDS))).toBe(250);
  });

  it('is ignored once older than its age, and when stamped in the future', () => {
    const storage = memoryStorage();
    createTrainerTargetMemory(storage).remember(KICKR, watts(250), unixSeconds(1000));
    const reloaded = createTrainerTargetMemory(storage);

    expect(
      reloaded.recall(KICKR, unixSeconds(1000 + REMEMBERED_TARGET_MAX_AGE_SECONDS + 1)),
    ).toBeUndefined();
    // A clock moved back: the stamp is after "now", so its age is not known.
    expect(reloaded.recall(KICKR, unixSeconds(999))).toBeUndefined();
  });

  it('is kept by trainer: one trainer’s target is not another’s', () => {
    const storage = memoryStorage();
    const memory = createTrainerTargetMemory(storage);
    memory.remember(KICKR, watts(250), unixSeconds(1000));

    expect(createTrainerTargetMemory(storage).recall(NEO, unixSeconds(1000))).toBeUndefined();
  });

  it('keeps the latest target and time for a trainer', () => {
    const storage = memoryStorage();
    const memory = createTrainerTargetMemory(storage);
    memory.remember(KICKR, watts(250), unixSeconds(1000));
    memory.remember(KICKR, watts(150), unixSeconds(5000));

    const reloaded = createTrainerTargetMemory(storage);
    expect(reloaded.recall(KICKR, unixSeconds(5000))).toBe(150);
  });

  it('remembers at most eight trainers, dropping the one heard from longest ago', () => {
    const storage = memoryStorage();
    const memory = createTrainerTargetMemory(storage);
    for (let index = 0; index < 9; index += 1) {
      memory.remember(deviceId(`trainer-${String(index)}`), watts(100), unixSeconds(1000 + index));
    }

    const reloaded = createTrainerTargetMemory(storage);
    expect(reloaded.recall(deviceId('trainer-0'), unixSeconds(1010))).toBeUndefined();
    expect(reloaded.recall(deviceId('trainer-1'), unixSeconds(1010))).toBe(100);
    expect(reloaded.recall(deviceId('trainer-8'), unixSeconds(1010))).toBe(100);
    expect(Object.keys(JSON.parse(storage.rows.get(KEY) ?? '{}') as object)).toHaveLength(8);
  });

  it('never drops the trainer just written, even when the clock has moved back — #1424 review', () => {
    const storage = memoryStorage();
    const memory = createTrainerTargetMemory(storage);
    for (let index = 0; index < 8; index += 1) {
      memory.remember(deviceId(`trainer-${String(index)}`), watts(100), unixSeconds(1000 + index));
    }
    // Stamped before all eight: by stamp it would be the oldest, and drop itself.
    memory.remember(KICKR, watts(250), unixSeconds(500));

    const reloaded = createTrainerTargetMemory(storage);
    expect(reloaded.recall(KICKR, unixSeconds(500))).toBe(250);
    expect(reloaded.recall(deviceId('trainer-0'), unixSeconds(1010))).toBeUndefined();
    expect(reloaded.recall(deviceId('trainer-7'), unixSeconds(1010))).toBe(100);
  });

  it('forgets every trainer, on the device and in the page, and never throws', () => {
    const storage = memoryStorage();
    const memory = createTrainerTargetMemory(storage);
    memory.remember(KICKR, watts(250), unixSeconds(1000));
    memory.forget();

    expect(storage.rows.has(KEY)).toBe(false);
    expect(memory.recall(KICKR, unixSeconds(1000))).toBeUndefined();
    expect(() => {
      createTrainerTargetMemory({
        getItem: () => null,
        setItem: () => undefined,
        removeItem: () => {
          throw new Error('blocked');
        },
      }).forget();
    }).not.toThrow();
  });

  it('reads junk as nothing, entry by entry, and never throws', () => {
    const now = unixSeconds(1000);
    expect(createTrainerTargetMemory(memoryStorage('not json')).recall(KICKR, now)).toBeUndefined();
    expect(createTrainerTargetMemory(memoryStorage('[1,2]')).recall(KICKR, now)).toBeUndefined();
    const mixed = createTrainerTargetMemory(
      memoryStorage(
        JSON.stringify({
          kickr: { watts: 200, at: 1000 },
          neo: { watts: -5, at: 1000 },
          other: { watts: 'lots', at: 1000 },
          late: { watts: 200, at: 'yesterday' },
        }),
      ),
    );
    expect(mixed.recall(KICKR, now)).toBe(200);
    expect(mixed.recall(NEO, now)).toBeUndefined();
    expect(mixed.recall(deviceId('other'), now)).toBeUndefined();
    expect(mixed.recall(deviceId('late'), now)).toBeUndefined();
  });

  it('works in the page alone where the store is missing or refuses a write', () => {
    const missing = createTrainerTargetMemory(undefined);
    missing.remember(KICKR, watts(200), unixSeconds(1000));
    expect(missing.recall(KICKR, unixSeconds(1000))).toBe(200);

    const refusing = createTrainerTargetMemory({
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('full');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    });
    expect(() => {
      refusing.remember(KICKR, watts(200), unixSeconds(1000));
    }).not.toThrow();
    expect(refusing.recall(KICKR, unixSeconds(1000))).toBe(200);
  });
});
