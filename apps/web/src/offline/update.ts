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
 * ## ⚠️ The tab that did NOT ask — #483, and [ADR 0027](../../../../docs/adr/0027-a-tab-left-behind-by-another-tabs-update.md)
 *
 * Two tabs on version 1. The rider presses *Update now* in **B**. The new
 * worker activates, its `activate` deletes every cache but its own, and **the
 * spec's Activate algorithm makes it the controller of every client of the
 * registration — tab A included**, whatever `clients.claim()` does. Tab A is
 * now version 1's JavaScript under version 2's cache: any lazy chunk it has not
 * already loaded is a version-1 hashed URL that version 2's precache does not
 * hold, and after a deploy the server no longer serves it either. This client
 * is four lazy chunks and a dozen models deep, so that is the likely case.
 *
 * Until #483 tab A was told `none` — literally true of the *offer* and
 * misleading about the *tab*. ADR 0027 D-1 gives it a state of its own,
 * {@link UpdateStatus} `superseded`, and D-2 makes the repair a **rider's
 * reload** rather than an automatic one.
 *
 * ⚠️ **The signal is the worker's own state, NOT `controllerchange`.** A
 * `controllerchange` with `asked === false` also fires on the very first
 * activation on an origin, where nothing is stale and a reload would be a
 * reload loop (#467). What distinguishes the two is that a worker this watcher
 * was *offering* — so `isAnUpdate` was true of it — left `installed` for a
 * state other than `redundant`, which means it activated. See {@link follow}.
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
  | 'activating'
  /**
   * Another tab took an update and this tab was left behind: it is running an
   * older bundle under the new worker's cache, so a chunk it has not loaded yet
   * is a URL nothing serves. ADR 0027 D-1. The repair is a reload, and
   * {@link UpdateWatcher.reloadNow} is the rider's gesture for it.
   */
  | 'superseded'
  /**
   * The same, while a ride is in progress: **nothing reloads over an unsaved
   * ride**, which is ADR 0024 D-3 rule 3 applied to the repair rather than to
   * the activation. ADR 0027 D-3. A sentence and no button, exactly as
   * `deferred` is.
   */
  | 'superseded-deferred';

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
  /**
   * The rider's gesture for a tab another tab left behind — ADR 0027 D-2.
   *
   * ⚠️ Refused unless the status is exactly `superseded`, which is the same
   * shape {@link UpdateWatcher.activate}'s refusal has and is there for the
   * same reason: while a ride is in progress the status is
   * `superseded-deferred`, so this reloads nothing over an unsaved ride even if
   * a view offers the button anyway.
   */
  readonly reloadNow: () => void;
}

export function createUpdateWatcher(ports: UpdateWatcherPorts): UpdateWatcher {
  const listeners = new Set<() => void>();
  let waiting: ServiceWorkerLike | null = null;
  let dismissed = false;
  let asked = false;
  let reloaded = false;
  /**
   * Whether an update this tab was offering activated without this tab asking
   * — #483. Sticky for the life of the tab: nothing that happens in this tab
   * makes an old bundle current again, and only a reload repairs it.
   */
  let superseded = false;
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
        // ⚠️ **`none` was true of the offer and not of the tab, and #483 is
        // where that stopped being what the rider is told.** When ANOTHER tab
        // took the update, this one is now controlled by the new worker, whose
        // activation deleted this tab's precache: a lazy chunk it has not
        // loaded yet is a URL nothing serves. ADR 0024 D-3 had no state for
        // that; [ADR 0027](../../../../docs/adr/0027-a-tab-left-behind-by-another-tabs-update.md)
        // D-1 gives it one.
        //
        // ⚠️ **`redundant` is the case that is NOT it, and telling the two
        // apart is the whole of this branch.** A worker leaves `installed` for
        // `redundant` when a NEWER worker replaced it while it was still
        // waiting — nothing activated, this tab's cache is untouched, and the
        // newer one will be offered when it installs. Every other exit
        // (`activating`, `activated`) means it took control. Reading this off
        // `controllerchange` instead would be wrong for the opposite reason:
        // that fires on the first ever activation too, where nothing is stale
        // (#467).
        waiting = null;
        if (worker.state !== 'redundant') {
          superseded = true;
        }
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

  const riding = (): boolean => ports.recording?.inProgress() === true;

  const status = (): UpdateStatus => {
    if (asked) {
      return 'activating';
    }
    // ⚠️ **Before the waiting worker, deliberately — ADR 0027 D-4.** A tab that
    // has been left behind is already running a bundle whose chunks may not
    // resolve; a further release waiting behind it does not make that less
    // true, and both are repaired by the same reload. Offering "Update now"
    // there would tell the rider the wrong story about why their page has to
    // reload, and `activate` refuses in this state for that reason.
    if (superseded) {
      return riding() ? 'superseded-deferred' : 'superseded';
    }
    if (waiting === null || dismissed) {
      return 'none';
    }
    return riding() ? 'deferred' : 'available';
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
    reloadNow: () => {
      // ⚠️ The same refusal `activate` makes, for the same reason: a ride is
      // the one thing in this app a rider cannot redo, and `status()` is
      // `superseded-deferred` rather than `superseded` for as long as one is
      // recording OR paused. `reloaded` is shared with the `controllerchange`
      // path so that a tab reloads at most once however it got here.
      if (status() !== 'superseded' || reloaded) {
        return;
      }
      reloaded = true;
      ports.reload();
    },
  };
}

/** `navigator.serviceWorker` as this module needs it, or `undefined`. */
export function platformControllerChanges(): ControllerChangeSource | undefined {
  return (globalThis as { navigator?: { serviceWorker?: ControllerChangeSource } }).navigator
    ?.serviceWorker;
}
