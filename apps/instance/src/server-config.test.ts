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
    const on = readServerConfig(
      { compression: 'on', metrics: 'ON', metricsToken: 'k'.repeat(32) },
      1,
    );
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

  it('pings every 25 s unless told otherwise, and 0 turns the ping off (to measure a tunnel’s idle timeout)', () => {
    expect(readServerConfig({}, 1)).toMatchObject({ config: { pingIntervalMs: 25_000 } });
    expect(readServerConfig({ pingIntervalMs: '0' }, 1)).toMatchObject({
      config: { pingIntervalMs: 0 },
    });
    expect(readServerConfig({ pingIntervalMs: '10000' }, 1)).toMatchObject({
      config: { pingIntervalMs: 10_000 },
    });
    expect(readServerConfig({ pingIntervalMs: '50' }, 1).ok).toBe(false);
  });

  it('reads the header a proxy writes the client address into, lower case, and refuses a header that is not one — #895 B3', () => {
    expect(readServerConfig({}, 1)).toMatchObject({ config: { clientAddressHeader: undefined } });
    expect(readServerConfig({ clientAddressHeader: 'CF-Connecting-IP' }, 1)).toMatchObject({
      config: { clientAddressHeader: 'cf-connecting-ip' },
    });
    expect(readServerConfig({ clientAddressHeader: 'x: y' }, 1).ok).toBe(false);
  });

  it('refuses metrics on with no token, or with one too short to be one — #895 N3', () => {
    expect(readServerConfig({ metrics: 'on' }, 1).ok).toBe(false);
    expect(readServerConfig({ metrics: 'on', metricsToken: 'short' }, 1).ok).toBe(false);
    const on = readServerConfig({ metrics: 'on', metricsToken: 'a'.repeat(32) }, 1);
    expect(on.ok && on.config.metricsToken).toBe('a'.repeat(32));
  });
});
