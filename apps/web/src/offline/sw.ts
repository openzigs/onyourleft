// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The service worker's entry point (#406).
 *
 * @unwired A service worker is a **second entry point**, built by its own
 * Rollup pass into `dist/sw.js` and reached at runtime through a URL that
 * `register.ts` hands `navigator.serviceWorker.register`. No module in the
 * client's own graph imports it and none ever can: importing it would run
 * `attachWorker` against a `Window`. `check:wiring` walks the graph from
 * `index.html`, so this file and `worker-core.ts` are structurally unreachable
 * from it — which is a fact about service workers rather than a defect about
 * this one. What holds the seam honest instead is `register.ts`, which IS
 * imported by `main.tsx` and IS watched, and `offline.browser.spec.ts`, which
 * loads the product build with the network off and would fail if this file
 * never ran.
 *
 * Everything it does is in `worker-core.ts`, where it can be tested. This file
 * exists to do the two things that module must not: read the values the build
 * injected, and cast the real global.
 */

import { attachWorker, type WorkerScope } from './worker-core';

/**
 * Injected by `vite.config.ts`'s `oyl-service-worker` plugin, from the build's
 * own output. Never written down — see `tools/precache/precache.ts`.
 */
declare const __OYL_PRECACHE__: readonly string[];
declare const __OYL_CACHE_VERSION__: string;

/**
 * ⚠️ The one cast in this file, and it is unavoidable.
 *
 * `apps/web/tsconfig.json` compiles with `lib: ["DOM"]`, where `self` is a
 * `Window`. The real global here is a `ServiceWorkerGlobalScope`, which that
 * library does not declare at all — and adding `lib.webworker` to the program
 * collides with `lib.dom` on a long list of identifiers. `WorkerScope` names
 * the four shapes this worker actually uses, so what is asserted by the cast is
 * small enough to read.
 */
attachWorker(self as unknown as WorkerScope, {
  precache: __OYL_PRECACHE__,
  version: __OYL_CACHE_VERSION__,
});
