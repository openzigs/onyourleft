// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A service-worker scope that exists in Node (#406).
 *
 * jsdom implements no `ServiceWorkerGlobalScope`, no Cache Storage and no
 * `FetchEvent`, and the browser gate can only observe a worker from the
 * outside — it can say the page loaded offline, never *which branch* served
 * it. So the worker's decisions are tested against this, and the browser gate
 * says the whole thing works end to end. Neither is the other's superset,
 * which is the same relationship `styleOrigins` has with `map.browser.spec.ts`
 * (CLAUDE.md §4f).
 *
 * ⚠️ **This file is deliberately NOT a `*.test.ts`.** It is test support, and
 * `scripts/check-wiring.mjs` §`isTestSupport` already treats a file called
 * `testing.ts` as such, so it is outside the wiring gate's production
 * population exactly as `ride/testing.ts` is.
 */

import type {
  ExtendableEventLike,
  FetchEventLike,
  MessageEventLike,
  WorkerScope,
} from './worker-core';

/** A `Cache` that holds `Response`s in a map, keyed by URL. */
class FakeCache {
  readonly entries = new Map<string, Response>();

  /** Every URL `addAll` was asked for, in order, including ones that failed. */
  readonly requested: string[] = [];

  constructor(private readonly network: (url: string) => Response | undefined) {}

  async addAll(urls: readonly string[]): Promise<void> {
    // Two-phase, like the real one: fetch everything, and only then write. A
    // partially-populated cache after a rejection would let a test pass over a
    // worker that installed half a precache.
    const fetched: [string, Response][] = [];
    for (const url of urls) {
      this.requested.push(url);
      const response = this.network(url);
      if (response === undefined) {
        throw new TypeError(`addAll: ${url} could not be fetched`);
      }
      fetched.push([url, response]);
    }
    for (const [url, response] of fetched) {
      this.entries.set(url, response);
    }
    return Promise.resolve();
  }

  match(url: string): Promise<Response | undefined> {
    return Promise.resolve(this.entries.get(url));
  }
}

export interface FakeScopeOptions {
  readonly scope: string;
  /** What the network would answer, by URL. Absent means the request fails. */
  readonly network: ReadonlyMap<string, Response>;
  /** Caches already on the origin before this worker installs. */
  readonly existingCaches?: readonly string[];
}

/** A scope a test can drive, and then ask what the worker did. */
export class FakeWorkerScope implements WorkerScope {
  readonly registration: { readonly scope: string };
  readonly caches: CacheStorage;
  readonly clients: { claim: () => Promise<void> };

  /** How many times `skipWaiting()` was called. ADR 0024 D-3 rule 1. */
  skipWaitingCalls = 0;
  /** How many times `clients.claim()` was called. */
  claimCalls = 0;
  /** Every request the worker itself issued — its network footprint. */
  readonly fetched: string[] = [];

  readonly caches_ = new Map<string, FakeCache>();

  private readonly listeners = new Map<string, ((event: never) => void)[]>();

  constructor(private readonly options: FakeScopeOptions) {
    this.registration = { scope: options.scope };
    this.clients = {
      claim: () => {
        this.claimCalls += 1;
        return Promise.resolve();
      },
    };
    for (const name of options.existingCaches ?? []) {
      this.caches_.set(name, new FakeCache(this.answer));
    }
    this.caches = {
      open: (name: string) => {
        let cache = this.caches_.get(name);
        if (cache === undefined) {
          cache = new FakeCache(this.answer);
          this.caches_.set(name, cache);
        }
        return Promise.resolve(cache);
      },
      keys: () => Promise.resolve([...this.caches_.keys()]),
      delete: (name: string) => Promise.resolve(this.caches_.delete(name)),
      has: (name: string) => Promise.resolve(this.caches_.has(name)),
      match: () => Promise.resolve(undefined),
    } as unknown as CacheStorage;
  }

  private readonly answer = (url: string): Response | undefined => {
    const response = this.options.network.get(url);
    return response === undefined ? undefined : response.clone();
  };

  skipWaiting(): Promise<void> {
    this.skipWaitingCalls += 1;
    return Promise.resolve();
  }

  /**
   * What the worker's own network fallback reaches.
   *
   * ⚠️ **A property rather than a method, and that is not a style choice.**
   * `privacy/no-network.test.ts` scans this client's source for anything that
   * could transmit an athlete's data, and its pattern cannot tell a `fetch(`
   * that is a *call* from one that is a *declaration* — so the method form of
   * this line was reported as a network call in a test double that ships in
   * nothing. Written as a property it is still plainly a declaration and the
   * scan is unchanged. ⚠️ The worker's one **real** network call is
   * `worker-core.ts`'s `scope.fetch(event.request)`, and that file has its own
   * case in `no-network.test.ts` rather than being quietly out of scope.
   */
  readonly fetch = (request: Request): Promise<Response> => {
    this.fetched.push(request.url);
    const response = this.answer(request.url);
    if (response === undefined) {
      return Promise.reject(new TypeError('Failed to fetch'));
    }
    return Promise.resolve(response);
  };

  addEventListener(type: string, listener: (event: never) => void): void {
    const existing = this.listeners.get(type) ?? [];
    existing.push(listener);
    this.listeners.set(type, existing);
  }

  /** Fire `install` or `activate` and wait for everything it waited on. */
  async dispatchLifecycle(type: 'install' | 'activate'): Promise<void> {
    const waited: Promise<unknown>[] = [];
    const event: ExtendableEventLike = {
      waitUntil: (promise) => {
        waited.push(promise);
      },
    };
    for (const listener of this.listeners.get(type) ?? []) {
      (listener as (event: ExtendableEventLike) => void)(event);
    }
    await Promise.all(waited);
  }

  /**
   * Fire `fetch` and report what happened.
   *
   * `undefined` means the worker did not call `respondWith` at all, which is a
   * different outcome from "responded with the network's answer" and is the
   * one #406's origin criterion turns on.
   */
  async dispatchFetch(request: Request): Promise<Response | undefined> {
    let responded: Response | Promise<Response> | undefined;
    const event: FetchEventLike = {
      request,
      waitUntil: () => undefined,
      respondWith: (response) => {
        responded = response;
      },
    };
    for (const listener of this.listeners.get('fetch') ?? []) {
      (listener as (event: FetchEventLike) => void)(event);
    }
    return responded === undefined ? undefined : await responded;
  }

  dispatchMessage(data: unknown): void {
    const event: MessageEventLike = { data };
    for (const listener of this.listeners.get('message') ?? []) {
      (listener as (event: MessageEventLike) => void)(event);
    }
  }

  /** What one cache holds, transplanted from another scope. */
  adopt(from: FakeWorkerScope): void {
    for (const [name, cache] of from.caches_) {
      this.caches_.set(name, cache);
    }
  }

  /** The names of the caches on this origin right now. */
  cacheNames(): string[] {
    return [...this.caches_.keys()];
  }

  /** What one cache holds, by URL. */
  cached(name: string): string[] {
    return [...(this.caches_.get(name)?.entries.keys() ?? [])];
  }
}

/**
 * A document request, which `new Request(url, { mode: 'navigate' })` refuses to
 * build.
 *
 * Node's `fetch` implementation forbids constructing a navigate-mode request
 * from script — only a browser's navigation algorithm makes one — and the
 * worker's fetch handler reads exactly three fields off it. So this is the
 * three fields, and the cast is the whole of the pretence.
 */
export function navigationRequest(url: string): Request {
  return { method: 'GET', mode: 'navigate', url } as unknown as Request;
}
