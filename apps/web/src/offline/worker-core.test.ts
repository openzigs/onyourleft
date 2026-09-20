// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { FakeWorkerScope, navigationRequest } from './testing';
import {
  attachWorker,
  CACHE_PREFIX,
  cacheNameFor,
  decideFetch,
  SKIP_WAITING_MESSAGE,
  staleCaches,
} from './worker-core';

const SCOPE = 'https://rider.example/';
const PRECACHE = ['index.html', 'assets/index-abc.js', 'assets/tree_oak-mno.glb'];
const VERSION = 'v1digest';

function network(extra: readonly string[] = []): Map<string, Response> {
  const map = new Map<string, Response>();
  for (const entry of [...PRECACHE, ...extra]) {
    map.set(new URL(entry, SCOPE).toString(), new Response(`body of ${entry}`));
  }
  return map;
}

function scopeWith(options?: { existingCaches?: readonly string[] }): FakeWorkerScope {
  const scope = new FakeWorkerScope({
    scope: SCOPE,
    network: network(),
    ...(options?.existingCaches === undefined ? {} : { existingCaches: options.existingCaches }),
  });
  attachWorker(scope, { precache: PRECACHE, version: VERSION });
  return scope;
}

describe('install', () => {
  it('fills a versioned cache with everything the build emitted', async () => {
    const scope = scopeWith();
    await scope.dispatchLifecycle('install');
    expect(scope.cached(cacheNameFor(VERSION))).toEqual(
      PRECACHE.map((entry) => new URL(entry, SCOPE).toString()),
    );
  });

  it('does NOT call skipWaiting — ADR 0024 D-3 rule 1, #407 criterion 1', async () => {
    // ⚠️ The create-react-app#3613 failure mode, and it is the likely case here
    // rather than the exotic one: this client is eleven models and four lazy
    // chunks deep, so a v1 page served v2's precache asks for a chunk name its
    // own bundle has never heard of. Moving `skipWaiting()` into the install
    // handler turns this red.
    const scope = scopeWith();
    await scope.dispatchLifecycle('install');
    expect(scope.skipWaitingCalls).toBe(0);
  });

  it('rejects rather than installing half a precache', async () => {
    // "A write that reports success while the read cannot see it", wrong
    // storage: a worker that reached `installed` holding everything but the
    // renderer would look installed and fail on the one screen this epic is
    // for.
    const scope = new FakeWorkerScope({ scope: SCOPE, network: network() });
    attachWorker(scope, { precache: [...PRECACHE, 'assets/missing.js'], version: VERSION });
    await expect(scope.dispatchLifecycle('install')).rejects.toThrow(/could not be fetched/);
    expect(scope.cached(cacheNameFor(VERSION))).toEqual([]);
  });

  it('resolves every entry against the scope, not against the origin root', async () => {
    // A deployment under a subdirectory registers a worker scoped to it, and a
    // precache resolved against `/` would cache URLs nothing ever requests.
    const nested = 'https://rider.example/cycling/';
    const scope = new FakeWorkerScope({
      scope: nested,
      network: new Map(
        PRECACHE.map((entry) => [
          new URL(entry, nested).toString(),
          new Response(`body of ${entry}`),
        ]),
      ),
    });
    attachWorker(scope, { precache: PRECACHE, version: VERSION });
    await scope.dispatchLifecycle('install');
    expect(scope.cached(cacheNameFor(VERSION))).toContain(
      'https://rider.example/cycling/index.html',
    );
  });
});

describe('activate', () => {
  it('deletes every older cache of this worker’s — ADR 0024 D-3 rule 4', async () => {
    const scope = scopeWith({ existingCaches: [`${CACHE_PREFIX}older`, `${CACHE_PREFIX}oldest`] });
    await scope.dispatchLifecycle('install');
    await scope.dispatchLifecycle('activate');
    expect(scope.cacheNames()).toEqual([cacheNameFor(VERSION)]);
  });

  it('leaves a cache that is not this worker’s alone', async () => {
    // The origin is shared with the rider's rides. Deleting everything would be
    // the easy way to satisfy the assertion above and the wrong one.
    const scope = scopeWith({ existingCaches: ['someone-elses-cache'] });
    await scope.dispatchLifecycle('activate');
    expect(scope.cacheNames()).toContain('someone-elses-cache');
  });

  it('claims the clients, so the first-ever load is controlled without a reload', async () => {
    const scope = scopeWith();
    await scope.dispatchLifecycle('activate');
    expect(scope.claimCalls).toBe(1);
  });
});

describe('staleCaches', () => {
  it('is prefix-scoped in both directions', () => {
    expect(
      staleCaches([`${CACHE_PREFIX}a`, `${CACHE_PREFIX}b`, 'other'], `${CACHE_PREFIX}b`),
    ).toEqual([`${CACHE_PREFIX}a`]);
  });
});

describe('what the worker does with a request', () => {
  const precached = new Set(PRECACHE.map((entry) => new URL(entry, SCOPE).toString()));
  const base = { scope: SCOPE, precached };

  it('serves the shell for a navigation, whatever the path', () => {
    expect(
      decideFetch({ ...base, method: 'GET', mode: 'navigate', url: `${SCOPE}#/game` }),
    ).toEqual({ kind: 'shell' });
  });

  it('serves a precached asset from the cache', () => {
    expect(
      decideFetch({ ...base, method: 'GET', mode: 'cors', url: `${SCOPE}assets/index-abc.js` }),
    ).toEqual({ kind: 'cached', url: `${SCOPE}assets/index-abc.js` });
  });

  it('ignores a query string, which a caller may append and the build never does', () => {
    expect(
      decideFetch({ ...base, method: 'GET', mode: 'cors', url: `${SCOPE}assets/index-abc.js?v=2` }),
    ).toEqual({ kind: 'cached', url: `${SCOPE}assets/index-abc.js` });
  });

  it('does not touch a request to any other origin — #406 criterion 4', () => {
    // ⚠️ `untouched` is not "fetched and passed through". The worker never
    // calls `respondWith`, so the request is the page's and this worker
    // contacts no origin but its own. `basemap.ts` §`styleOrigins` asserts
    // which origins the MAP may reach; nothing before this asserted anything
    // about the worker, because there was no worker.
    expect(
      decideFetch({
        ...base,
        method: 'GET',
        mode: 'cors',
        url: 'https://tiles.example/basemap.pmtiles',
      }),
    ).toEqual({ kind: 'untouched' });
  });

  it('does not touch a same-origin request that is not precached — #408’s control', () => {
    expect(
      decideFetch({ ...base, method: 'GET', mode: 'cors', url: `${SCOPE}not-precached.txt` }),
    ).toEqual({ kind: 'untouched' });
  });

  it('does not touch anything but a GET', () => {
    // There is no such request in this client today, which is exactly why the
    // branch has to exist: the first one added must not be answered from a
    // cache by a worker nobody re-read.
    expect(
      decideFetch({ ...base, method: 'POST', mode: 'cors', url: `${SCOPE}index.html` }),
    ).toEqual({ kind: 'untouched' });
  });

  it('does not touch a URL it cannot parse', () => {
    expect(decideFetch({ ...base, method: 'GET', mode: 'cors', url: 'not a url' })).toEqual({
      kind: 'untouched',
    });
  });
});

describe('the fetch handler, end to end', () => {
  it('answers a navigation from the cache with the network off', async () => {
    const scope = scopeWith();
    await scope.dispatchLifecycle('install');
    // Nothing is reachable from here on: the only source of a body is the cache.
    const offline = new FakeWorkerScope({ scope: SCOPE, network: new Map() });
    offline.adopt(scope);
    attachWorker(offline, { precache: PRECACHE, version: VERSION });
    const response = await offline.dispatchFetch(navigationRequest(SCOPE));
    expect(await response?.text()).toBe('body of index.html');
    expect(offline.fetched).toEqual([]);
  });

  it('answers a precached asset from the cache with the network off', async () => {
    const scope = scopeWith();
    await scope.dispatchLifecycle('install');
    const offline = new FakeWorkerScope({ scope: SCOPE, network: new Map() });
    offline.adopt(scope);
    attachWorker(offline, { precache: PRECACHE, version: VERSION });
    const response = await offline.dispatchFetch(new Request(`${SCOPE}assets/tree_oak-mno.glb`));
    expect(await response?.text()).toBe('body of assets/tree_oak-mno.glb');
  });

  it('leaves a non-precached request entirely alone', async () => {
    const scope = scopeWith();
    await scope.dispatchLifecycle('install');
    expect(await scope.dispatchFetch(new Request(`${SCOPE}control.txt`))).toBeUndefined();
    expect(scope.fetched).toEqual([]);
  });

  it('falls back to the network when the cache was cleared under it', async () => {
    const scope = scopeWith();
    // No install: the cache is empty, which is what an evicted origin looks
    // like. A rider should get the network's answer, not a blank page served
    // from nothing.
    const response = await scope.dispatchFetch(new Request(`${SCOPE}assets/index-abc.js`));
    expect(await response?.text()).toBe('body of assets/index-abc.js');
    expect(scope.fetched).toEqual([`${SCOPE}assets/index-abc.js`]);
  });
});

describe('the message handler', () => {
  it('steps aside when the page asks it to, and only then', () => {
    const scope = scopeWith();
    scope.dispatchMessage({ type: SKIP_WAITING_MESSAGE });
    expect(scope.skipWaitingCalls).toBe(1);
  });

  it('ignores anything else a page or an extension posts at it', () => {
    const scope = scopeWith();
    for (const junk of [undefined, null, 'OYL_SKIP_WAITING', { type: 'something-else' }, 42]) {
      scope.dispatchMessage(junk);
    }
    expect(scope.skipWaitingCalls).toBe(0);
  });
});
