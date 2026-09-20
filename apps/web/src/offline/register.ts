// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Whether this build registers a service worker at all, and what happens if it
 * does (#406).
 *
 * ## ADR 0024 D-4 — not inside the Android shell
 *
 * `apps/mobile/capacitor.config.ts` sets `webDir: '../web/dist'` and `cap sync`
 * copies those assets **into the APK**, so inside the shell every file is
 * already local and already cold-starts with no network. A worker there would
 * put a cache in front of files that cannot be fetched over a network anyway:
 * all of D-3's staleness risk and none of D-2's benefit.
 *
 * ⚠️ **And it is worse than merely redundant.** An APK update replaces the
 * whole asset tree while a registered worker would still be holding the
 * previous build in Cache Storage under the same origin — which is D-3's
 * failure mode arriving by a route D-3's rider-gestured reload cannot reach,
 * because the rider never asked for a web update.
 *
 * The question is asked through `support/capacitor.ts` §`isNativeShell`, which
 * is the one place in this client that answers it — not the user agent (a
 * Capacitor WebView **is** Chrome and says so) and not `'Capacitor' in window`
 * (Capacitor's web build defines that global too).
 *
 * ## Why the container is a parameter
 *
 * `readAvailability`'s posture, for `readAvailability`'s reason: every branch
 * has to be reachable from a test, and no test machine can be a Capacitor
 * WebView, a browser with no `serviceWorker` and a browser with one. `main.tsx`
 * is the one caller that reads the real globals.
 */

/** The half of `ServiceWorkerContainer` this module uses. */
export interface ServiceWorkerContainerLike {
  register: (
    script: string,
    options?: { scope?: string },
  ) => Promise<ServiceWorkerRegistrationLike>;
}

/** The half of `ServiceWorkerRegistration` this module and `update.ts` use. */
export interface ServiceWorkerRegistrationLike {
  readonly installing: ServiceWorkerLike | null;
  readonly waiting: ServiceWorkerLike | null;
  readonly active: ServiceWorkerLike | null;
  addEventListener: (type: 'updatefound', listener: () => void) => void;
}

/** The half of `ServiceWorker` this module and `update.ts` use. */
export interface ServiceWorkerLike {
  readonly state: string;
  postMessage: (message: unknown) => void;
  addEventListener: (type: 'statechange', listener: () => void) => void;
}

/** Why no worker was registered, or the registration if one was. */
export type RegistrationOutcome =
  | { readonly kind: 'registered'; readonly registration: ServiceWorkerRegistrationLike }
  /** Inside the Android shell. ADR 0024 D-4. */
  | { readonly kind: 'native-shell' }
  /** No `navigator.serviceWorker`: a private window, plain HTTP, an old engine. */
  | { readonly kind: 'unsupported' }
  /** The browser has one and refused this registration. */
  | { readonly kind: 'failed'; readonly reason: string };

export interface RegistrationRequest {
  /** `navigator.serviceWorker`, or `undefined` where there is none. */
  readonly container: ServiceWorkerContainerLike | undefined;
  /** `isNativeShell(platformCapacitor())`, asked once by the caller. */
  readonly nativeShell: boolean;
  /** Where the worker script is, which is the build's base path plus `sw.js`. */
  readonly script: string;
  /** The scope it controls, which is the build's base path. */
  readonly scope: string;
}

/**
 * Register the worker, or say why not.
 *
 * ⚠️ **It resolves rather than rejecting**, on every path. A failed
 * registration must not take the app down with it: the client works perfectly
 * well with no worker — that is what shipped until this epic — and a rider
 * whose browser refuses one should get the app, not a blank page. The outcome
 * is returned rather than swallowed so a caller *can* react; today none does,
 * and `RegistrationOutcome.failed` is what a future notice would read.
 */
export async function registerServiceWorker(
  request: RegistrationRequest,
): Promise<RegistrationOutcome> {
  if (request.nativeShell) {
    return { kind: 'native-shell' };
  }
  if (request.container === undefined) {
    return { kind: 'unsupported' };
  }
  try {
    const registration = await request.container.register(request.script, {
      scope: request.scope,
    });
    return { kind: 'registered', registration };
  } catch (cause) {
    return { kind: 'failed', reason: cause instanceof Error ? cause.message : 'unknown' };
  }
}

/**
 * `navigator.serviceWorker`, or `undefined`.
 *
 * The one impure function here, and the reason it is a function rather than a
 * constant is that `navigator` is absent in the Vitest environment this
 * package runs in — a module-scope read would throw at import time in every
 * test in the client.
 */
export function platformServiceWorkerContainer(): ServiceWorkerContainerLike | undefined {
  const container = (globalThis as { navigator?: { serviceWorker?: ServiceWorkerContainerLike } })
    .navigator?.serviceWorker;
  return container ?? undefined;
}
