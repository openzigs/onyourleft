// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The update path, from the page's point of view (#407).
 *
 * ⚠️ **Asserted from the page's point of view and not from
 * `registration.waiting`**, which is #407's own note about the defect shape:
 * *"the registration object reporting a waiting worker is exactly what a
 * broken update also looks like."* So every case below asks what the rider is
 * told and whether the page reloaded, never what the registration says.
 */

import { describe, expect, it } from 'vitest';

import type { ServiceWorkerLike, ServiceWorkerRegistrationLike } from './register';
import { SKIP_WAITING_MESSAGE } from './protocol';
import { createUpdateWatcher, type RecordingInterlock, type UpdateWatcher } from './update';

class FakeWorker implements ServiceWorkerLike {
  state = 'installing';
  readonly posted: unknown[] = [];
  private readonly changed: (() => void)[] = [];

  postMessage(message: unknown): void {
    this.posted.push(message);
  }

  addEventListener(_type: 'statechange', listener: () => void): void {
    this.changed.push(listener);
  }

  become(state: string): void {
    this.state = state;
    for (const listener of this.changed) {
      listener();
    }
  }
}

class FakeRegistration implements ServiceWorkerRegistrationLike {
  installing: ServiceWorkerLike | null = null;
  waiting: ServiceWorkerLike | null = null;
  active: ServiceWorkerLike | null = null;
  private readonly found: (() => void)[] = [];

  addEventListener(_type: 'updatefound', listener: () => void): void {
    this.found.push(listener);
  }

  /** A version already running and controlling the page. */
  running(): FakeWorker {
    const worker = new FakeWorker();
    worker.state = 'activated';
    this.active = worker;
    return worker;
  }

  /** A new worker begins installing: `installing` is set and `updatefound` fires. */
  beginInstalling(): FakeWorker {
    const worker = new FakeWorker();
    this.installing = worker;
    this.dispatchUpdateFound();
    return worker;
  }

  dispatchUpdateFound(): void {
    for (const listener of this.found) {
      listener();
    }
  }

  /**
   * That worker finishes installing behind the one that is running.
   *
   * `waiting` is set before `statechange` here; `finishInstallingUnordered`
   * is the other order, because the watcher must not depend on which.
   */
  finishInstalling(worker: FakeWorker): void {
    this.installing = null;
    this.waiting = worker;
    worker.become('installed');
  }

  /** The same, with `statechange` delivered before the registration's attributes. */
  finishInstallingUnordered(worker: FakeWorker): void {
    worker.become('installed');
    this.installing = null;
    this.waiting = worker;
  }

  /** A new worker arrives and installs behind the one that is running. */
  installUpdate(): FakeWorker {
    if (this.active === null) {
      this.running();
    }
    const worker = this.beginInstalling();
    this.finishInstalling(worker);
    return worker;
  }

  /**
   * The FIRST ever worker: installed with nothing controlling the page.
   *
   * ⚠️ In the order the pinned Chromium actually delivers it, measured over
   * five first visits (#467): at `statechange` → `installed` the registration
   * already reports the worker as `waiting`, and `active` is still `null`.
   * Only afterwards does it move to `active`. An earlier version of this fake
   * left `waiting` null, which is what the watcher was written against — and
   * is not what the browser does.
   */
  installFirstEver(): FakeWorker {
    const worker = this.beginInstalling();
    this.installing = null;
    this.waiting = worker;
    worker.become('installed');
    this.waiting = null;
    this.active = worker;
    worker.become('activating');
    worker.become('activated');
    return worker;
  }
}

class FakeControllerChanges {
  private readonly listeners: (() => void)[] = [];

  addEventListener(_type: 'controllerchange', listener: () => void): void {
    this.listeners.push(listener);
  }

  fire(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

function recordingInterlock(): RecordingInterlock & { set: (value: boolean) => void } {
  let riding = false;
  const listeners = new Set<() => void>();
  return {
    inProgress: () => riding,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set: (value: boolean) => {
      riding = value;
      for (const listener of listeners) {
        listener();
      }
    },
  };
}

interface Harness {
  readonly watcher: UpdateWatcher;
  readonly registration: FakeRegistration;
  readonly changes: FakeControllerChanges;
  readonly recording: ReturnType<typeof recordingInterlock>;
  readonly reloads: () => number;
  readonly announcements: () => number;
}

function harness(): Harness {
  const registration = new FakeRegistration();
  const changes = new FakeControllerChanges();
  const recording = recordingInterlock();
  let reloads = 0;
  let announcements = 0;
  const watcher = createUpdateWatcher({
    registration,
    controllerChanges: changes,
    recording,
    reload: () => {
      reloads += 1;
    },
  });
  watcher.subscribe(() => {
    announcements += 1;
  });
  return {
    watcher,
    registration,
    changes,
    recording,
    reloads: () => reloads,
    announcements: () => announcements,
  };
}

describe('nothing happens on its own', () => {
  it('says nothing when no update is waiting', () => {
    expect(harness().watcher.status()).toBe('none');
  });

  it('offers no update on a rider’s FIRST ever visit', () => {
    // ⚠️ The first worker on an origin installs with nothing controlling the
    // page, so there is no old bundle to replace. Offering here would tell a
    // new rider to update to the version they are already running — which the
    // pinned Chromium did on one first visit in five before #467, because
    // `registration.waiting` IS the new worker at that moment.
    const { watcher, registration } = harness();
    registration.installFirstEver();
    expect(watcher.status()).toBe('none');
  });

  it('offers no update on a first visit the watcher arrived in the middle of', () => {
    // The watcher reaches the page after `register()` resolves, which is while
    // the first ever worker is still installing — so it follows that worker
    // from construction, and must still not mistake it for an update.
    const registration = new FakeRegistration();
    const worker = registration.beginInstalling();
    const watcher = createUpdateWatcher({
      registration,
      controllerChanges: new FakeControllerChanges(),
      recording: undefined,
      reload: () => undefined,
    });
    registration.installing = null;
    registration.waiting = worker;
    worker.become('installed');
    registration.waiting = null;
    registration.active = worker;
    worker.become('activating');
    expect(watcher.status()).toBe('none');
  });

  it('does not reload when the first worker claims the page', () => {
    // `worker-core.ts`'s `activate` calls `clients.claim()`, which fires
    // `controllerchange` with no update involved. A handler that reloaded on
    // it would reload every first visit — install, claim, reload, install…
    const { changes, reloads } = harness();
    changes.fire();
    expect(reloads()).toBe(0);
  });

  it('does not activate on a timer, on visibility, or on detection', () => {
    // #407 criterion 4, stated as the absence it is: the ONLY thing in this
    // module that calls `postMessage` is `activate`, and the only caller of
    // `activate` is a click handler.
    const { watcher, registration, reloads } = harness();
    const worker = registration.installUpdate();
    expect(watcher.status()).toBe('available');
    expect(worker.posted).toEqual([]);
    expect(reloads()).toBe(0);
  });
});

describe('the rider’s gesture', () => {
  it('asks the waiting worker to step aside, and then reloads once', () => {
    const { watcher, registration, changes, reloads } = harness();
    const worker = registration.installUpdate();
    watcher.activate();
    expect(worker.posted).toEqual([{ type: SKIP_WAITING_MESSAGE }]);
    expect(watcher.status()).toBe('activating');
    expect(reloads()).toBe(0);
    changes.fire();
    expect(reloads()).toBe(1);
  });

  it('reloads exactly once however many times controllerchange fires', () => {
    // The classic bug here is a reload loop, and `controllerchange` is not
    // guaranteed to fire once.
    const { watcher, registration, changes, reloads } = harness();
    registration.installUpdate();
    watcher.activate();
    changes.fire();
    changes.fire();
    changes.fire();
    expect(reloads()).toBe(1);
  });

  it('is a no-op when nothing is waiting', () => {
    const { watcher, changes, reloads } = harness();
    watcher.activate();
    expect(watcher.status()).toBe('none');
    changes.fire();
    expect(reloads()).toBe(0);
  });
});

describe('a ride is in progress', () => {
  it('defers the offer rather than cancelling it — ADR 0024 D-3 rule 3', () => {
    const { watcher, registration, recording } = harness();
    recording.set(true);
    registration.installUpdate();
    expect(watcher.status()).toBe('deferred');
  });

  it('refuses to activate, and nothing reloads over an unsaved ride', () => {
    // ⚠️ The refusal is in the watcher and not only in the component: a
    // refusal that lives in a view is one `disabled` attribute away from being
    // no refusal at all, and what it guards is a ride a rider cannot redo.
    const { watcher, registration, changes, recording, reloads } = harness();
    recording.set(true);
    const worker = registration.installUpdate();
    watcher.activate();
    expect(worker.posted).toEqual([]);
    expect(watcher.status()).toBe('deferred');
    changes.fire();
    expect(reloads()).toBe(0);
  });

  it('offers it the moment the ride is saved, with nobody polling', () => {
    const { watcher, registration, recording, announcements } = harness();
    recording.set(true);
    registration.installUpdate();
    const before = announcements();
    recording.set(false);
    expect(watcher.status()).toBe('available');
    expect(announcements()).toBeGreaterThan(before);
  });

  it('holds a PAUSED ride back as firmly as a recording one', () => {
    // `rideInProgress` is the one place that decides, and it counts a paused
    // ride: it is unsaved in exactly the way a recording one is. This asserts
    // the watcher asks rather than deciding for itself.
    const { watcher, registration, recording } = harness();
    registration.installUpdate();
    expect(watcher.status()).toBe('available');
    recording.set(true);
    expect(watcher.status()).toBe('deferred');
  });
});

describe('an update that was under way before the watcher existed — #467', () => {
  function lateWatcher(registration: FakeRegistration): UpdateWatcher {
    return createUpdateWatcher({
      registration,
      controllerChanges: new FakeControllerChanges(),
      recording: undefined,
      reload: () => undefined,
    });
  }

  it('offers a worker that was still INSTALLING when the watcher was made', () => {
    // ⚠️ The browser gate's flake. `main.tsx` builds the watcher in its second
    // render, and an update registered before that has already fired the
    // `updatefound` nobody was listening for. Reading `waiting` alone saw null
    // and never looked again.
    const registration = new FakeRegistration();
    registration.running();
    const worker = registration.beginInstalling();
    const watcher = lateWatcher(registration);
    let told = 0;
    watcher.subscribe(() => {
      told += 1;
    });
    expect(watcher.status()).toBe('none');
    registration.finishInstalling(worker);
    expect(watcher.status()).toBe('available');
    expect(told).toBe(1);
  });

  it('offers a worker that was already WAITING when the watcher was made', () => {
    const registration = new FakeRegistration();
    registration.installUpdate();
    expect(lateWatcher(registration).status()).toBe('available');
  });

  it('does not depend on the attribute arriving before the state change', () => {
    // Two updates reach the page separately — the registration's attributes
    // and the worker's state — and the watcher offers the worker it followed
    // rather than re-reading `registration.waiting` in between.
    const registration = new FakeRegistration();
    registration.running();
    const watcher = lateWatcher(registration);
    const worker = registration.beginInstalling();
    registration.finishInstallingUnordered(worker);
    expect(watcher.status()).toBe('available');
  });

  it('offers a worker already INSTALLED that the registration still calls installing', () => {
    // The same two separate updates, caught between them: the worker's state
    // says `installed` and `registration.installing` has not moved yet. No
    // further `statechange` is coming until the rider acts, so the worker is
    // judged when it is first followed as well as on every change.
    const registration = new FakeRegistration();
    registration.running();
    const worker = new FakeWorker();
    worker.state = 'installed';
    registration.installing = worker;
    expect(lateWatcher(registration).status()).toBe('available');
  });

  it('tells a subscriber once, not twice, when it sees the worker both ways', () => {
    // Constructed after `installing` is set and before `updatefound` is
    // dispatched, the watcher meets the same worker twice. Following it twice
    // would announce twice; harmless today, and a double offer tomorrow.
    const registration = new FakeRegistration();
    registration.running();
    const worker = new FakeWorker();
    registration.installing = worker;
    const watcher = lateWatcher(registration);
    let told = 0;
    watcher.subscribe(() => {
      told += 1;
    });
    registration.dispatchUpdateFound();
    registration.finishInstalling(worker);
    expect(told).toBe(1);
  });
});

describe('a browser with no ride controller at all', () => {
  it('offers the update, because no ride can be in progress', () => {
    const registration = new FakeRegistration();
    const watcher = createUpdateWatcher({
      registration,
      controllerChanges: new FakeControllerChanges(),
      recording: undefined,
      reload: () => undefined,
    });
    registration.installUpdate();
    expect(watcher.status()).toBe('available');
  });
});

describe('not now', () => {
  it('silences this offer', () => {
    const { watcher, registration } = harness();
    registration.installUpdate();
    watcher.dismiss();
    expect(watcher.status()).toBe('none');
  });

  it('does not silence the NEXT release', () => {
    // One "not now" must not mean "never again for the life of this tab".
    const { watcher, registration } = harness();
    registration.installUpdate();
    watcher.dismiss();
    registration.installUpdate();
    expect(watcher.status()).toBe('available');
  });

  it('leaves the worker waiting rather than discarding it', () => {
    const { watcher, registration, reloads } = harness();
    const worker = registration.installUpdate();
    watcher.dismiss();
    expect(worker.posted).toEqual([]);
    expect(reloads()).toBe(0);
  });
});

describe('the worker stops waiting without this tab asking — #473', () => {
  /** What another tab's "Update now" does to the worker every tab shares. */
  function takenElsewhere(registration: FakeRegistration, worker: FakeWorker): void {
    registration.waiting = null;
    registration.active = worker;
    worker.become('activating');
  }

  it('withdraws the offer when ANOTHER TAB activates it', () => {
    const { watcher, registration, announcements } = harness();
    const worker = registration.installUpdate();
    expect(watcher.status()).toBe('available');
    const before = announcements();
    takenElsewhere(registration, worker);
    expect(watcher.status()).toBe('none');
    // The rider's screen has to hear about it; nothing polls.
    expect(announcements()).toBe(before + 1);
  });

  it('does not then post to an active worker and sit at "activating" for ever', () => {
    // The finding's own sequence: tab A still showed the offer, pressed it,
    // posted SKIP_WAITING to a worker that was already active, set `asked`,
    // and waited for a `controllerchange` that had already fired.
    const { watcher, registration, changes, reloads } = harness();
    const worker = registration.installUpdate();
    takenElsewhere(registration, worker);
    changes.fire();
    watcher.activate();
    expect(worker.posted).toEqual([]);
    expect(watcher.status()).toBe('none');
    expect(reloads()).toBe(0);
  });

  it('withdraws the offer when a newer worker makes it redundant', () => {
    const { watcher, registration } = harness();
    const worker = registration.installUpdate();
    worker.become('redundant');
    expect(watcher.status()).toBe('none');
  });

  it('withdraws a DEFERRED offer too, rather than deferring nothing', () => {
    // ADR 0024 D-3's `deferred` means "a new version is waiting and a ride is
    // in progress". Once it has gone there is nothing to defer.
    const { watcher, registration, recording } = harness();
    recording.set(true);
    const worker = registration.installUpdate();
    expect(watcher.status()).toBe('deferred');
    takenElsewhere(registration, worker);
    expect(watcher.status()).toBe('none');
    recording.set(false);
    expect(watcher.status()).toBe('none');
  });

  it('withdraws an offer for a worker that was ALREADY waiting when the watcher was made', () => {
    // That worker was noted and never followed, so no `statechange` reached
    // the watcher at all.
    const registration = new FakeRegistration();
    const worker = registration.installUpdate();
    const watcher = createUpdateWatcher({
      registration,
      controllerChanges: new FakeControllerChanges(),
      recording: undefined,
      reload: () => undefined,
    });
    expect(watcher.status()).toBe('available');
    takenElsewhere(registration, worker);
    expect(watcher.status()).toBe('none');
  });

  it('still offers the NEXT release after withdrawing one', () => {
    const { watcher, registration } = harness();
    const first = registration.installUpdate();
    takenElsewhere(registration, first);
    first.become('activated');
    registration.installUpdate();
    expect(watcher.status()).toBe('available');
  });
});

describe('subscribers', () => {
  it('can stop listening', () => {
    const registration = new FakeRegistration();
    const watcher = createUpdateWatcher({
      registration,
      controllerChanges: new FakeControllerChanges(),
      recording: undefined,
      reload: () => undefined,
    });
    let seen = 0;
    const stop = watcher.subscribe(() => {
      seen += 1;
    });
    registration.installUpdate();
    stop();
    watcher.dismiss();
    expect(seen).toBe(1);
  });
});
