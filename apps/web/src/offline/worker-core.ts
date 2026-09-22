// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Everything the service worker does, over an injected scope (#406, #407).
 *
 * @unwired Imported by `sw.ts` and by nothing else, and `sw.ts` is a **second
 * entry point** — Rollup builds it in its own pass into `dist/sw.js`, and the
 * browser reaches it through a URL rather than an import. `check:wiring` walks
 * the graph from `index.html`, so every module on the worker's side of that
 * seam is structurally unreachable from it. That is a fact about service
 * workers rather than a defect about this one, and it is why
 * `apps/web/src/offline/` is watched at all: the module this gate CAN see is
 * `register.ts`, which `main.tsx` imports, and deleting that call is a red
 * build. What proves this file ships is `offline.browser.spec.ts`, which loads
 * the product with the network off.
 *
 * ## Why the logic is here and the worker is five lines
 *
 * A service worker's globals do not exist in any test environment this
 * repository has. jsdom implements no `ServiceWorkerGlobalScope`, no Cache
 * Storage and no `FetchEvent`, and the browser gate can only observe a worker
 * from the outside — it can tell you a page loaded offline, never *which
 * branch* served it. So every decision lives in this module behind a narrow
 * interface, `sw.ts` binds it to the real `self`, and the tests drive it
 * against a fake scope where the install handler, the activate handler and the
 * fetch handler can each be inspected on their own.
 *
 * ⚠️ **The types below are declared here rather than pulled in from
 * `lib.webworker`.** Adding `/// <reference lib="webworker" />` to a program
 * compiled with `lib: ["DOM"]` collides on a long list of identifiers the two
 * libraries both declare. Naming the four shapes actually used costs about
 * twenty lines and keeps `apps/web`'s one tsconfig intact.
 *
 * ## The one cache strategy, and why there is only one
 *
 * ADR 0024 §"What would make this ADR wrong" names the honest signal that a
 * hand-written worker has outgrown itself: *"`sw.ts` growing a second cache
 * strategy"*. There is one. Everything in the precache is served from the cache
 * and falls back to the network; a navigation is served the precached shell;
 * **everything else is not touched at all** — no `respondWith`, so the request
 * is the page's rather than the worker's, and the worker contacts no origin but
 * its own. That last property is #406's fourth criterion and it is a
 * consequence of the structure rather than a rule layered on top of it.
 */

import { SKIP_WAITING_MESSAGE } from './protocol';

/** The half of `ExtendableEvent` this worker uses. */
export interface ExtendableEventLike {
  waitUntil(promise: Promise<unknown>): void;
}

/** The half of `FetchEvent` this worker uses. */
export interface FetchEventLike extends ExtendableEventLike {
  readonly request: Request;
  respondWith(response: Response | Promise<Response>): void;
}

/** The half of `ExtendableMessageEvent` this worker uses. */
export interface MessageEventLike {
  readonly data: unknown;
}

/** The half of `ServiceWorkerGlobalScope` this worker uses. */
export interface WorkerScope {
  readonly registration: { readonly scope: string };
  readonly caches: CacheStorage;
  readonly clients: { claim: () => Promise<void> };
  skipWaiting: () => Promise<void> | void;
  fetch: (request: Request) => Promise<Response>;
  addEventListener(
    type: 'install' | 'activate',
    listener: (event: ExtendableEventLike) => void,
  ): void;
  addEventListener(type: 'fetch', listener: (event: FetchEventLike) => void): void;
  addEventListener(type: 'message', listener: (event: MessageEventLike) => void): void;
}

/**
 * The prefix every cache this worker owns begins with.
 *
 * It is what makes `activate`'s tidy-up safe: a cache belonging to something
 * else on the same origin must survive, and a cache from a previous version of
 * this worker must not. Without a prefix the only honest options are deleting
 * everything or deleting nothing.
 */
export const CACHE_PREFIX = 'oyl-precache-';

export function cacheNameFor(version: string): string {
  return `${CACHE_PREFIX}${version}`;
}

/**
 * Which caches `activate` deletes.
 *
 * ADR 0024 D-3 rule 4: *"a cache nobody deletes is a disk leak that outlives
 * the bug that created it"* — and this one shares an origin with the rider's
 * rides, so the leak competes with the thing the app exists to keep.
 */
export function staleCaches(present: readonly string[], current: string): readonly string[] {
  return present.filter((name) => name.startsWith(CACHE_PREFIX) && name !== current);
}

/** What the fetch handler decided to do about one request. */
export type FetchDecision =
  /** Serve the precached app shell; fall back to the network. */
  | { readonly kind: 'shell' }
  /** Serve this exact URL from the cache; fall back to the network. */
  | { readonly kind: 'cached'; readonly url: string }
  /** Do not call `respondWith` at all. The page fetches it, not the worker. */
  | { readonly kind: 'untouched' };

export interface FetchInput {
  readonly method: string;
  /** `request.mode` — `'navigate'` for a document load. */
  readonly mode: string;
  readonly url: string;
  /** `registration.scope`, which is the origin and base path this worker owns. */
  readonly scope: string;
  /** The precache, as absolute URLs. */
  readonly precached: ReadonlySet<string>;
}

/**
 * What to do about one request.
 *
 * The order of these four branches is the whole policy, and each is a refusal
 * before it is a rule:
 *
 * 1. **Not a `GET`** — nothing this worker does is safe for a method that
 *    changes something. There is no such request in this client today, and
 *    that is exactly why the branch has to be here: the first one added must
 *    not silently be answered from a cache.
 * 2. **Not this origin** — the basemap (ADR 0010 D-1) and anything else remote
 *    is left entirely alone. Not "fetched and passed through": untouched, so
 *    the request is issued by the page. This is what makes "the worker
 *    contacts no origin but its own" a structural fact.
 * 3. **A navigation** — served the precached shell, because a hash-routed
 *    single-page app's every route is the same document, and a rider opening a
 *    bookmark with the network off is the case this whole epic is for.
 * 4. **In the precache** — served from the cache.
 *
 * Anything else is untouched, which is what leaves #408's control able to fail.
 */
export function decideFetch(input: FetchInput): FetchDecision {
  if (input.method !== 'GET') {
    return { kind: 'untouched' };
  }
  let url: URL;
  let scope: URL;
  try {
    url = new URL(input.url);
    scope = new URL(input.scope);
  } catch {
    return { kind: 'untouched' };
  }
  if (url.origin !== scope.origin) {
    return { kind: 'untouched' };
  }
  if (input.mode === 'navigate') {
    return { kind: 'shell' };
  }
  // The query string is dropped, because a precached asset is addressed by
  // path: Vite's own `?url` imports resolve to a hashed filename with no query
  // on it, and a cache-busting parameter a caller appends must not turn a
  // precached asset into a network fetch that fails offline.
  const withoutSearch = `${url.origin}${url.pathname}`;
  if (input.precached.has(withoutSearch)) {
    return { kind: 'cached', url: withoutSearch };
  }
  return { kind: 'untouched' };
}

/** The app shell's URL, which a navigation is served from. */
export function shellUrl(scope: string): string {
  return new URL('index.html', scope).toString();
}

/** Every precache entry, resolved against the scope the worker was registered at. */
export function precacheUrls(entries: readonly string[], scope: string): readonly string[] {
  return entries.map((entry) => new URL(entry, scope).toString());
}

export interface WorkerOptions {
  /** The precache, relative to the scope. Injected by the build (#406). */
  readonly precache: readonly string[];
  /** The build's digest, which names the cache. */
  readonly version: string;
}

/**
 * Wire this worker's four handlers onto a scope.
 *
 * ⚠️ **`skipWaiting()` is called from the `message` handler and NOWHERE else**,
 * which is ADR 0024 D-3 rule 1 and #407's first criterion. A page running
 * bundle v1 that later `lazy()`-imports a chunk from v2's precache is served an
 * asset its own bundle does not expect, or a 404 — create-react-app#3613 — and
 * this client is eleven models and four lazy chunks deep, so that is the likely
 * case rather than the exotic one. `worker-core.test.ts` asserts the install
 * handler leaves the worker waiting, and moving the call turns it red.
 */
export function attachWorker(scope: WorkerScope, options: WorkerOptions): void {
  const cacheName = cacheNameFor(options.version);
  const urls = precacheUrls(options.precache, scope.registration.scope);
  const precached = new Set(urls);
  const shell = shellUrl(scope.registration.scope);

  scope.addEventListener('install', (event) => {
    event.waitUntil(
      (async () => {
        const cache = await scope.caches.open(cacheName);
        // `addAll` rather than a loop of `put`: it is atomic in the sense that
        // matters here — one failed asset rejects the whole thing, so the
        // worker never reaches `installed` holding a cache that is missing the
        // renderer. A half-populated precache is the "wrong storage" cause of
        // CLAUDE.md §5's defect shape, and it would report success.
        await cache.addAll([...urls]);
      })(),
    );
    // ⚠️ And no `skipWaiting()`. See this function's own comment.
  });

  scope.addEventListener('activate', (event) => {
    event.waitUntil(
      (async () => {
        const present = await scope.caches.keys();
        await Promise.all(staleCaches(present, cacheName).map((name) => scope.caches.delete(name)));
        // Claim so that the very first load of the app — which happens in a
        // page the worker did not control — is controlled from its second
        // request onwards rather than only after a reload. On an update, the
        // page that asked for it reloads on `controllerchange`; ⚠️ a SECOND
        // tab that did not ask is controlled by this worker too (the spec's
        // Activate does that, claim or no claim) and keeps its old bundle
        // after the line above deleted that bundle's cache — #483.
        await scope.clients.claim();
      })(),
    );
  });

  scope.addEventListener('message', (event) => {
    if (
      typeof event.data === 'object' &&
      event.data !== null &&
      (event.data as { type?: unknown }).type === SKIP_WAITING_MESSAGE
    ) {
      void scope.skipWaiting();
    }
  });

  scope.addEventListener('fetch', (event) => {
    const decision = decideFetch({
      method: event.request.method,
      mode: event.request.mode,
      url: event.request.url,
      scope: scope.registration.scope,
      precached,
    });
    if (decision.kind === 'untouched') {
      return;
    }
    const wanted = decision.kind === 'shell' ? shell : decision.url;
    event.respondWith(
      (async () => {
        const cache = await scope.caches.open(cacheName);
        const hit = await cache.match(wanted);
        if (hit !== undefined) {
          return hit;
        }
        // The cache was cleared under us, or this is the very first load and
        // `install` has not finished. Falling back to the network is the
        // honest answer; offline it rejects, which is what a rider whose cache
        // was evicted should see rather than a blank page served from nothing.
        return scope.fetch(event.request);
      })(),
    );
  });
}
