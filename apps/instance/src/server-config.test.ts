// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { readServerConfig } from './server-config.ts';

describe('readServerConfig (#780, #791)', () => {
  it('defaults: compression OFF (ruling Q16), metrics off, registration closed, a worker per core', () => {
    const result = readServerConfig({}, 4);
    expect(result).toMatchObject({
      ok: true,
      config: {
        databasePath: 'data/instance.sqlite',
        origin: null,
        registration: 'closed',
        roomWorkers: 4,
        compression: false,
        metrics: false,
      },
    });
  });

  it('turns compression and metrics on only for the word on', () => {
    const on = readServerConfig({ compression: 'on', metrics: 'ON' }, 1);
    expect(on.ok && [on.config.compression, on.config.metrics]).toEqual([true, true]);
    expect(readServerConfig({ compression: 'yes' }, 1).ok).toBe(false);
  });

  it('takes an origin alone, https unless it is this machine', () => {
    const ok = readServerConfig({ origin: 'https://ride.example' }, 1);
    expect(ok.ok && ok.config.origin).toBe('https://ride.example');
    const local = readServerConfig({ origin: 'http://127.0.0.1:8787' }, 1);
    expect(local.ok && local.config.origin).toBe('http://127.0.0.1:8787');
    for (const origin of ['http://ride.example', 'https://ride.example/path', 'nonsense']) {
      expect(readServerConfig({ origin }, 1).ok, origin).toBe(false);
    }
  });

  it('refuses a worker count that is not one, and reports every problem', () => {
    expect(readServerConfig({ roomWorkers: '0' }, 1).ok).toBe(false);
    expect(readServerConfig({ roomWorkers: '2' }, 8)).toMatchObject({ config: { roomWorkers: 2 } });
    const many = readServerConfig({ roomWorkers: 'x', registration: 'maybe', metrics: '1' }, 1);
    expect(many.ok ? 0 : many.problems.length).toBe(3);
  });
});
