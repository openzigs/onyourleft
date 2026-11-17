// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The sensors the Android shell remembers — #2669. Each case reads back
 * through a SECOND memory over the same storage, which is what the app does
 * the next time it opens: a write the page kept and the device did not would
 * pass a read of the memory that wrote it.
 */

import { deviceId } from '@onyourleft/sensors';
import { describe, expect, it } from 'vitest';

import { PAIRING_ROLE_CAPABILITIES } from './controller';
import {
  createRememberedSensors,
  REMEMBERED_SENSORS_STORAGE_KEY,
  transportSeed,
  type RememberedSensorStorage,
} from './remembered-sensors';

function storage(initial: Record<string, string> = {}): RememberedSensorStorage & {
  readonly rows: Map<string, string>;
} {
  const rows = new Map(Object.entries(initial));
  return {
    rows,
    getItem: (key) => rows.get(key) ?? null,
    setItem: (key, value) => void rows.set(key, value),
    removeItem: (key) => void rows.delete(key),
  };
}

const STRAP = deviceId('C4:7C:8D:6A:00:01');
const KICKR = deviceId('C4:7C:8D:6A:00:02');

describe('#2669 — what this phone remembers about a paired sensor', () => {
  it('keeps a paired sensor across a restart: its id, its name and its role', () => {
    const device = storage();
    createRememberedSensors(device).remember({ id: KICKR, name: 'KICKR 1F2A', role: 'trainer' });

    expect(createRememberedSensors(device).list()).toEqual([
      { id: KICKR, name: 'KICKR 1F2A', role: 'trainer' },
    ]);
  });

  it('writes those three fields and nothing else a caller hands it', () => {
    const device = storage();
    const sensor = { id: STRAP, name: 'HRM-Pro', role: 'heart-rate' as const, bpm: 151 };
    createRememberedSensors(device).remember(sensor);

    expect(JSON.parse(device.rows.get(REMEMBERED_SENSORS_STORAGE_KEY) ?? '')).toEqual([
      { id: STRAP, name: 'HRM-Pro', role: 'heart-rate' },
    ]);
  });

  it('lets go of one the rider forgot, on the device as well as in the page', () => {
    const device = storage();
    const memory = createRememberedSensors(device);
    memory.remember({ id: KICKR, name: 'KICKR', role: 'trainer' });
    memory.remember({ id: STRAP, name: 'HRM-Pro', role: 'heart-rate' });

    memory.drop(KICKR);

    expect(memory.list().map((one) => one.id)).toEqual([STRAP]);
    expect(
      createRememberedSensors(device)
        .list()
        .map((one) => one.id),
    ).toEqual([STRAP]);
  });

  it('forgets every one on Erase everything, and the page’s copy with them', () => {
    const device = storage({ 'oyl.other': 'kept' });
    const memory = createRememberedSensors(device);
    memory.remember({ id: KICKR, name: 'KICKR', role: 'trainer' });

    memory.forget();

    expect([...device.rows.keys()]).toEqual(['oyl.other']);
    expect(createRememberedSensors(device).list()).toEqual([]);
    // The next pairing rewrites the key without the erased one in it.
    memory.remember({ id: STRAP, name: 'HRM-Pro', role: 'heart-rate' });
    expect(device.rows.get(REMEMBERED_SENSORS_STORAGE_KEY)).not.toContain('00:02');
  });

  it('drops an entry it cannot read, one by one, and keeps the rest', () => {
    const device = storage({
      [REMEMBERED_SENSORS_STORAGE_KEY]: JSON.stringify([
        { id: KICKR, name: 'KICKR', role: 'trainer' },
        { id: STRAP, name: 'HRM-Pro', role: 'wheel' },
        { id: '', name: 'empty', role: 'power-meter' },
        { id: 7, name: 'number', role: 'power-meter' },
        'junk',
      ]),
    });
    expect(createRememberedSensors(device).list()).toEqual([
      { id: KICKR, name: 'KICKR', role: 'trainer' },
    ]);
  });

  it('reads a key that is not JSON, or not a list, as nothing remembered', () => {
    for (const text of ['{not json', '{"a":1}', 'null']) {
      const device = storage({ [REMEMBERED_SENSORS_STORAGE_KEY]: text });
      expect(createRememberedSensors(device).list()).toEqual([]);
    }
  });

  it('keeps at most eight, dropping the one paired longest ago', () => {
    const device = storage();
    const memory = createRememberedSensors(device);
    for (let n = 0; n < 10; n += 1) {
      memory.remember({ id: deviceId(`id-${String(n)}`), name: '', role: 'power-meter' });
    }
    const ids = createRememberedSensors(device)
      .list()
      .map((one) => one.id);
    expect(ids).toHaveLength(8);
    expect(ids[0]).toBe('id-2');
    expect(ids[7]).toBe('id-9');
  });

  it('remembers nothing across a restart, and throws nothing, where storage refuses', () => {
    const refusing: RememberedSensorStorage = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    };
    const memory = createRememberedSensors(refusing);
    memory.remember({ id: KICKR, name: 'KICKR', role: 'trainer' });
    expect(memory.list()).toHaveLength(1);
    memory.forget();
    expect(memory.list()).toEqual([]);
  });

  it('hands the transport each sensor with the capabilities its role pairs for', () => {
    const memory = createRememberedSensors(storage());
    memory.remember({ id: STRAP, name: 'HRM-Pro', role: 'heart-rate' });
    memory.remember({ id: KICKR, name: 'KICKR', role: 'trainer' });

    expect(transportSeed(memory)()).toEqual([
      { id: STRAP, name: 'HRM-Pro', capabilities: PAIRING_ROLE_CAPABILITIES['heart-rate'] },
      { id: KICKR, name: 'KICKR', capabilities: PAIRING_ROLE_CAPABILITIES.trainer },
    ]);
    // Read afresh: a sensor dropped since is not asked about again.
    memory.drop(KICKR);
    expect(transportSeed(memory)().map((one) => one.id)).toEqual([STRAP]);
  });
});
