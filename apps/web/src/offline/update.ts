// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * When a new version of the app may take over, and who decides (#407).
 *
 * ## The defect this exists to prevent
 *
 * CLAUDE.md §5's dominant shape — *"a write that reports success while the read
 * cannot see it"* — in its most expensive form:
 *
 * > **A deploy reports success and every rider's tab keeps reading the old
 * > bundle, indefinitely.**
 *
 * A new worker **waits** until no client is controlled. A rider who leaves the
 * tab open never gets the update, and nothing anywhere reports a problem.
 *
 * ## Why `skipWaiting()` on install is not the fix
 *
 * It is specifically wrong for this client. A page loaded under bundle v1 that
 * later `lazy()`-imports a chunk from v2's precache is served an asset its own
 * running bundle does not expect, or a 404 —
 * [create-react-app#3613](https://github.com/react/create-react-app/issues/3613).
 * This client is **eleven `.glb` files and four lazy chunks** deep, so that is
 * the likely case rather than the exotic one, and a rider on `#/game` whose
 * scenery models 404 mid-ride watches the world fall apart.
 *
 * So the sequence is the documented safe one: no `skipWaiting()` on install →
 * detect the waiting worker → tell the rider → `postMessage` on their gesture →
 * the worker calls `skipWaiting()` → `controllerchange` → **one** reload.
 *
 * ## The rule the generic advice does not carry
 *
 * ⚠️ **Never activate while a ride is recording.** A ride is the one thing in
 * this app a rider cannot redo, and the activation ends in a page reload. The
 * offer is **deferred, not cancelled**: the worker is still waiting when the
 * ride is saved, and the rider is offered it then. `recording.subscribe` is
 * what makes that moment arrive without anybody polling.
 *
 * ## ⚠️ `controllerchange` fires when nobody asked, and that is a reload loop
 *
 * `worker-core.ts`'s `activate` calls `clients.claim()`, so the **first ever**
 * worker on an origin takes control of the page that installed it and
 * `controllerchange` fires with no update involved at all. A handler that
 * reloaded on that event would reload every first visit, install, claim, and
 * reload again. The reload is therefore conditional on this watcher having
 * asked, and it happens at most once — `#reloaded` is the second half, because
 * a `controllerchange` can fire more than once.
 */

import { SKIP_WAITING_MESSAGE } from './protocol';
import type { ServiceWorkerLike, ServiceWorkerRegistrationLike } from './register';

/** What the rider is being told, if anything. */
export type UpdateStatus =
  /** No new version is waiting, or the rider said not now. */
  | 'none'
  /** A new version is waiting and the rider may take it. */
  | 'available'
  /** A new version is waiting and a ride is in progress. ADR 0024 D-3 rule 3. */
  | 'deferred'
  /** The rider asked. Waiting for `controllerchange`, then one reload. */
  | 'activating';

/** The half of `ServiceWorkerContainer` this watcher listens to. */
export interface ControllerChangeSource {
  addEventListener: (type: 'controllerchange', listener: () => void) => void;
}

/**
 * Whether a ride is in progress, and a way to be told when that changes.
 *
 * `undefined` where there is no ride controller at all — Safari, Firefox, a
 * page served over plain HTTP — in which case no ride can be in progress and
 * the interlock has nothing to hold back.
 */
export interface RecordingInterlock {
  readonly inProgress: () => boolean;
  readonly subscribe: (listener: () => void) => () => void;
}

export interface UpdateWatcherPorts {
  readonly registration: ServiceWorkerRegistrationLike;
  readonly controllerChanges: ControllerChangeSource;
  readonly recording: RecordingInterlock | undefined;
  /** Reload the page. Injected so a test is not at the mercy of `location`. */
  readonly reload: () => void;
}

export interface UpdateWatcher {
  readonly status: () => UpdateStatus;
  /** Re-run on every change, so a component can `useSyncExternalStore` it. */
  readonly subscribe: (listener: () => void) => () => void;
  /** The rider's gesture. Refused outright while a ride is in progress. */
  readonly activate: () => void;
  /** The rider said not now. A later update offers itself again. */
  readonly dismiss: () => void;
}

export function createUpdateWatcher(ports: UpdateWatcherPorts): UpdateWatcher {
  const listeners = new Set<() => void>();
  let waiting: ServiceWorkerLike | null = null;
  let dismissed = false;
  let asked = false;
  let reloaded = false;
  const followed = new Set<ServiceWorkerLike>();

  const announce = (): void => {
    for (const listener of listeners) {
      listener();
    }
  };

  const noteWaiting = (worker: ServiceWorkerLike): void => {
    waiting = worker;
    // A worker that arrives after the rider dismissed the last one is a new
    // offer, not the same one. Otherwise one "not now" would silence every
    // future release for the life of the tab.
    dismissed = false;
    announce();
  };

  /**
   * Whether an installed worker is an UPDATE — that is, whether there is an
   * older version running that it would replace.
   *
   * ⚠️ **This used to be answered by `registration.waiting` being non-null, and
   * in Chromium that is false** — measured on the pinned Chromium 153 over
   * five first visits on 2026-09-21 (#467). On the **first** ever install the
   * browser sets `registration.waiting` to the new worker, dispatches
   * `statechange` → `installed`, and only then moves it to `active`: at the
   * moment this watcher reads it, `waiting` is the worker and `active` is
   * `null`. One of those five first visits put "Update now" on screen, offering
   * a new rider the version they were already running; which of them does
   * depended only on whether the watcher had subscribed before `updatefound`.
   * What distinguishes an update from a first install is the **active** worker:
   * an update always has an older one that is not this one.
   */
  const isAnUpdate = (worker: ServiceWorkerLike): boolean => {
    const active = ports.registration.active;
    return active !== null && active !== worker;
  };

  /**
   * Follow a worker that is installing, and offer it once it has installed.
   *
   * ⚠️ **The worker itself is offered, not `registration.waiting` re-read** —
   * a worker in the `installed` state is the waiting worker by definition, and
   * reading the registration's attribute instead ties the offer to the order
   * in which the browser delivers two separate updates to the page.
   */
  const follow = (worker: ServiceWorkerLike): void => {
    if (followed.has(worker)) {
      return;
    }
    followed.add(worker);
    const settle = (): void => {
      if (worker.state === 'installed' && isAnUpdate(worker)) {
        noteWaiting(worker);
      } else if (waiting === worker && worker.state !== 'installed') {
        // ⚠️ **It has stopped waiting, so the offer goes — #473.** A worker
        // leaves `installed` for `activating` (somebody took the update — in
        // ANOTHER TAB, as often as not) or for `redundant` (a newer one
        // superseded it). This used to be set and never cleared: tab A kept
        // offering a worker tab B had already activated, and pressing it
        // posted `SKIP_WAITING` to an active worker, set `asked`, and left
        // tab A saying "activating" for the life of the tab, because the
        // `controllerchange` it waits for had already happened. What the
        // rider is told now is ADR 0024 D-3's `none` — there is nothing
        // waiting, deferred or otherwise.
        //
        // ⚠️ **`none` is true of the offer and not of the tab — #483.** When
        // ANOTHER tab took the update, this one is now controlled by the new
        // worker, whose activation deleted this tab's precache: a lazy chunk
        // it has not loaded yet is a URL nothing serves. D-3 has no state for
        // that, and choosing one is #483's; #481's review (finding 5) found it.
        waiting = null;
        announce();
      }
    };
    worker.addEventListener('statechange', settle);
    settle();
  };

  // ⚠️ **What is already under way when the watcher is made — #467.** The
  // watcher reaches the page in `main.tsx`'s SECOND render (#418), once the
  // app's own `register()` has resolved and the athlete row and the platform
  // have been built. An update that began installing before then has already
  // fired its `updatefound`, which nothing was listening for, and this watcher
  // used to read `registration.waiting` alone: a worker still INSTALLING at
  // that moment was followed by nobody, reached `waiting` unseen, and the rider
  // was never offered it. Measured locally the second render lands 20 to 75 ms
  // before the browser gate registers its second worker; an offer that never
  // appears is what losing it looks like, and that is #467's failure in run
  // 35651738641. So both workers the registration can be
  // holding are read here, and an installing one is followed exactly as
  // `updatefound` would have followed it.
  //
  // ⚠️ A worker already waiting is FOLLOWED rather than merely noted, so that
  // its leaving `installed` withdraws the offer as it does for one this
  // watcher saw arrive (#473). Noting it alone left no `statechange` listener
  // on it at all.
  const alreadyWaiting = ports.registration.waiting;
  if (alreadyWaiting !== null) {
    follow(alreadyWaiting);
  }
  const alreadyInstalling = ports.registration.installing;
  if (alreadyInstalling !== null) {
    follow(alreadyInstalling);
  }

  ports.registration.addEventListener('updatefound', () => {
    const installing = ports.registration.installing;
    if (installing !== null) {
      follow(installing);
    }
  });

  ports.recording?.subscribe(() => {
    // The deferral lifting is a state change the rider can see, so it has to
    // announce. Nothing polls.
    announce();
  });

  ports.controllerChanges.addEventListener('controllerchange', () => {
    // ⚠️ Only when this watcher asked. `clients.claim()` fires this on the
    // first ever activation, with no update involved — see the header.
    if (!asked || reloaded) {
      return;
    }
    reloaded = true;
    ports.reload();
  });

  const status = (): UpdateStatus => {
    if (asked) {
      return 'activating';
    }
    if (waiting === null || dismissed) {
      return 'none';
    }
    return ports.recording?.inProgress() === true ? 'deferred' : 'available';
  };

  return {
    status,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    activate: () => {
      // ⚠️ The interlock is HERE and not only in the component that renders the
      // button. A refusal that lives in a view is one `disabled` attribute away
      // from being no refusal at all, and what it is guarding is a rider's
      // unsaved ride.
      if (status() !== 'available' || waiting === null) {
        return;
      }
      asked = true;
      waiting.postMessage({ type: SKIP_WAITING_MESSAGE });
      announce();
    },
    dismiss: () => {
      dismissed = true;
      announce();
    },
  };
}

/** `navigator.serviceWorker` as this module needs it, or `undefined`. */
export function platformControllerChanges(): ControllerChangeSource | undefined {
  return (globalThis as { navigator?: { serviceWorker?: ControllerChangeSource } }).navigator
    ?.serviceWorker;
}
