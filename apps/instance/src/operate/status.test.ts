// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The sources the owner's Status reads (#2604): the disk under a stubbed
 * `statfs`, the tunnel's `/ready` under a stubbed `fetch` and resolver, the
 * keys' state, and `OYL_INSTANCE_TUNNEL_READY_URL` as it is read at start.
 */

import { describe, expect, it, vi } from 'vitest';

import { InstanceKeysUnavailable } from '../keys/instance-keys.ts';
import { readServerConfig } from '../server-config.ts';
import { diskSpace, keysState, statusSources, tunnelReadiness, type DiskProbe } from './status.ts';

const PATHS = { databasePath: '/data/instance.sqlite', blobsPath: '/blobs' };

/** A probe whose disks hold `free` of 1000 blocks each, on the devices named. */
function disks(
  free: Readonly<Record<string, number>>,
  devices: Readonly<Record<string, number>> = { '/data': 1, '/blobs': 1 },
): DiskProbe {
  return {
    statfs: (path) => {
      const bavail = free[path];
      if (bavail === undefined) return Promise.reject(new Error('no such disk'));
      return Promise.resolve({ bavail, blocks: 1000, bsize: 4096 });
    },
    device: (path) => {
      const device = devices[path];
      return device === undefined
        ? Promise.reject(new Error('no such directory'))
        : Promise.resolve(device);
    },
  };
}

describe('the disk (#2604)', () => {
  it('warns at 5 % free, and not at 50 %', async () => {
    expect(await diskSpace(PATHS, disks({ '/data': 50 }))()).toEqual([
      { holds: 'database_and_blobs', freeBytes: 50 * 4096, totalBytes: 1000 * 4096, low: true },
    ]);
    expect(await diskSpace(PATHS, disks({ '/data': 500 }))()).toEqual([
      { holds: 'database_and_blobs', freeBytes: 500 * 4096, totalBytes: 1000 * 4096, low: false },
    ]);
  });

  it('reads the blobs’ disk apart when it is another device, each with its own warning', async () => {
    const read = await diskSpace(
      PATHS,
      disks({ '/data': 900, '/blobs': 20 }, { '/data': 1, '/blobs': 2 }),
    )();
    expect(read.map((each) => [each.holds, each.low])).toEqual([
      ['database', false],
      ['blobs', true],
    ]);
  });

  it('leaves out a disk it could not read, rather than guessing', async () => {
    const read = await diskSpace(PATHS, disks({ '/data': 900 }, { '/data': 1 }))();
    expect(read.map((each) => each.holds)).toEqual(['database']);
    expect(await diskSpace(PATHS, disks({}, {}))()).toEqual([]);
  });
});

describe('the tunnel (#2604)', () => {
  const URL_SET = new URL('http://tunnel:20241/ready');
  const privateName = () => Promise.resolve(['172.30.87.10']);

  it('is unknown with no address, and asks nothing', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const resolve = vi.fn(privateName);
    expect(await tunnelReadiness({ url: undefined, resolve, fetch })()).toEqual({
      state: 'unknown',
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();
  });

  it('is ready, 4, when cloudflared answers 200 with four ready connections — asked at the checked address', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(Response.json({ status: 200, readyConnections: 4, connectorId: 'x' })),
    );
    expect(await tunnelReadiness({ url: URL_SET, resolve: privateName, fetch })()).toEqual({
      state: 'ready',
      connections: 4,
    });
    expect((fetch.mock.calls[0]?.[0] as URL | undefined)?.href).toBe(
      'http://172.30.87.10:20241/ready',
    );
    expect(fetch.mock.calls[0]?.[1]?.redirect).toBe('manual');
  });

  it('is not ready when cloudflared answers 503', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(Response.json({ status: 503, readyConnections: 4 }, { status: 503 })),
    );
    expect(await tunnelReadiness({ url: URL_SET, resolve: privateName, fetch })()).toEqual({
      state: 'not_ready',
    });
  });

  it('is not ready on 200 with no ready connection, a redirect, or no answer at all', async () => {
    for (const answer of [
      () => Promise.resolve(Response.json({ readyConnections: 0 })),
      () => Promise.resolve(Response.json({ readyConnections: '4' })),
      () => Promise.resolve(new Response(null, { status: 302, headers: { location: '/' } })),
      () => Promise.reject(new Error('refused')),
    ]) {
      expect(
        await tunnelReadiness({ url: URL_SET, resolve: privateName, fetch: answer })(),
      ).toEqual({ state: 'not_ready' });
    }
  });

  it('is not ready once the deadline passes while the name’s lookup still hangs, and asks nothing', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    // A resolver that never answers: the tunnel's container gone, a search domain retried.
    const resolve = () => new Promise<readonly string[]>(() => undefined);
    expect(await tunnelReadiness({ url: URL_SET, resolve, fetch, waitMs: 20 })()).toEqual({
      state: 'not_ready',
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('is not ready once the deadline passes while the request still hangs', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() => new Promise<Response>(() => undefined));
    expect(
      await tunnelReadiness({ url: URL_SET, resolve: privateName, fetch, waitMs: 20 })(),
    ).toEqual({ state: 'not_ready' });
    // The request carried the same deadline, so it is cancelled with it.
    expect(fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });

  it('asks nothing of a name that resolves to a public address', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const resolve = () => Promise.resolve(['172.30.87.10', '203.0.113.9']);
    expect(await tunnelReadiness({ url: URL_SET, resolve, fetch })()).toEqual({
      state: 'not_ready',
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('the tunnel row follows the remote path (#2859)', () => {
  const sources = (remotePath: 'tailnet' | 'funnel' | 'cloudflare' | null) => {
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(Response.json({ status: 200, readyConnections: 2 })),
    );
    const built = statusSources({
      // The home template's address, set whatever the path (`instance.env.example`).
      server: { ...PATHS, tunnelReadyUrl: new URL('http://172.30.88.10:20241/ready') },
      remotePath,
      keys: { show: () => Promise.reject(new Error('not asked here')) },
      now: () => 0,
      startedAt: 0,
      resolve: () => Promise.reject(new Error('an address literal is never looked up')),
      fetch,
      disk: disks({}),
    });
    return { built, fetch };
  };

  it('asks no cloudflared on the tailnet or Funnel, so a healthy install is never "not ready"', async () => {
    for (const path of ['tailnet', 'funnel'] as const) {
      const { built, fetch } = sources(path);
      expect(await built.tunnel(), path).toEqual({ state: 'unknown' });
      expect(fetch, path).not.toHaveBeenCalled();
    }
  });

  it('asks it on the Cloudflare path, and with no path named, as before', async () => {
    for (const path of ['cloudflare', null] as const) {
      const { built, fetch } = sources(path);
      expect(await built.tunnel(), String(path)).toEqual({ state: 'ready', connections: 2 });
      expect(fetch, String(path)).toHaveBeenCalledOnce();
    }
  });
});

describe('OYL_INSTANCE_TUNNEL_READY_URL, as it is read at start (#2604)', () => {
  it('takes a single-label name or a private address', () => {
    for (const given of ['http://tunnel:20241/ready', 'http://172.30.87.10:20241/ready']) {
      const read = readServerConfig({ tunnelReadyUrl: given }, 1);
      expect(read.ok && read.config.tunnelReadyUrl?.href).toBe(given);
    }
    const unset = readServerConfig({}, 1);
    expect(unset.ok && unset.config.tunnelReadyUrl).toBeUndefined();
  });

  it('refuses a public name, a public address, https:, credentials and a query — naming the variable, never the value', () => {
    for (const given of [
      'http://tunnel.example.com/ready',
      'http://203.0.113.9:20241/ready',
      'https://tunnel:20241/ready',
      'http://user:pw@tunnel:20241/ready',
      'http://tunnel:20241/ready?x=1',
      'not a url',
    ]) {
      const read = readServerConfig({ tunnelReadyUrl: given }, 1);
      expect(read.ok, given).toBe(false);
      const problems = read.ok ? '' : read.problems.join(' ');
      expect(problems).toContain('OYL_INSTANCE_TUNNEL_READY_URL');
      expect(problems).not.toContain(given);
    }
  });
});

describe('the keys (#2604)', () => {
  it('are ready when they can be shown, and otherwise named by why not', async () => {
    expect(await keysState({ show: () => Promise.resolve({} as never) })()).toBe('ready');
    expect(
      await keysState({ show: () => Promise.reject(new InstanceKeysUnavailable('busy')) })(),
    ).toBe('busy');
    expect(await keysState({ show: () => Promise.reject(new Error('anything')) })()).toBe(
      'unreadable',
    );
  });
});
