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
  let waiting: ServiceWorkerLike | null = ports.registration.waiting;
  let dismissed = false;
  let asked = false;
  let reloaded = false;

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

  ports.registration.addEventListener('updatefound', () => {
    const installing = ports.registration.installing;
    if (installing === null) {
      return;
    }
    installing.addEventListener('statechange', () => {
      if (installing.state !== 'installed') {
        return;
      }
      // ⚠️ `registration.waiting` rather than `installing`, and the difference
      // matters: on the **first** install there is no controlled page, so the
      // worker goes straight from `installed` to `activating` and
      // `registration.waiting` is null. Reading `installing` instead would
      // offer every rider an "update" on their first ever visit, to a version
      // they are already running.
      const nowWaiting = ports.registration.waiting;
      if (nowWaiting !== null) {
        noteWaiting(nowWaiting);
      }
    });
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
