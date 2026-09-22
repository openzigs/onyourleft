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

  // ⚠️ **Since #483 the words in this block's expectations changed and its
  // claim did not.** #473's finding is that the OFFER must go — that pressing
  // "Update now" must not post to a worker that is already active and leave
  // the tab saying "activating" for ever. Every assertion about `posted` and
  // `reloads` below is unchanged and still the point. What moved is what the
  // rider is TOLD afterwards: `none` was true of the offer and false of the
  // tab, which is #483, so it is `superseded` now. A reviewer who remembers
  // these cases asserting `none` is reading the pre-#483 file.

  it('withdraws the offer when ANOTHER TAB activates it', () => {
    const { watcher, registration, announcements } = harness();
    const worker = registration.installUpdate();
    expect(watcher.status()).toBe('available');
    const before = announcements();
    takenElsewhere(registration, worker);
    expect(watcher.status()).toBe('superseded');
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
    expect(watcher.status()).toBe('superseded');
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
    // in progress". Once it has gone there is nothing to defer — and since
    // #483 what there IS to say is that the ride's own tab was left behind.
    const { watcher, registration, recording } = harness();
    recording.set(true);
    const worker = registration.installUpdate();
    expect(watcher.status()).toBe('deferred');
    takenElsewhere(registration, worker);
    expect(watcher.status()).toBe('superseded-deferred');
    recording.set(false);
    expect(watcher.status()).toBe('superseded');
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
    expect(watcher.status()).toBe('superseded');
  });

  it('still offers the NEXT release after withdrawing one', () => {
    // ⚠️ Withdrawn by being made REDUNDANT, which is #483's other exit from
    // `installed` and the one where nothing activated. It used to be withdrawn
    // by another tab activating it, which since #483 leaves this tab
    // `superseded` and offering a reload rather than an update — ADR 0027 D-4,
    // asserted in the #483 block. The claim this case makes is unchanged: one
    // withdrawal must not silence this tab for the rest of its life.
    const { watcher, registration } = harness();
    const first = registration.installUpdate();
    first.become('redundant');
    expect(watcher.status()).toBe('none');
    registration.installUpdate();
    expect(watcher.status()).toBe('available');
  });
});

describe('the tab that did NOT ask is left behind — #483, ADR 0027', () => {
  /**
   * Two tabs over ONE registration, which is what the case is about.
   *
   * ⚠️ Both watchers see the same `FakeWorker` objects, because in a browser
   * both tabs are clients of one registration and one worker: the
   * `statechange` every watcher hears is the same event. A test that gave each
   * tab its own registration would be two independent tabs rather than the
   * case, and would pass over any implementation at all.
   */
  function twoTabs(): {
    readonly registration: FakeRegistration;
    readonly a: Harness;
    readonly b: Harness;
  } {
    const registration = new FakeRegistration();
    const make = (): Harness => {
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
    };
    registration.running();
    return { registration, a: make(), b: make() };
  }

  /** B presses "Update now", and the worker activates for every client. */
  function bTakesTheUpdate(registration: FakeRegistration, b: Harness, worker: FakeWorker): void {
    b.watcher.activate();
    registration.waiting = null;
    registration.active = worker;
    worker.become('activating');
  }

  it('tells the tab that did not ask that it was left behind, rather than "none"', () => {
    // ⚠️ **The finding.** Before #483 tab A was told `none` — true of the
    // offer and false of the tab: A is running version 1's JavaScript under
    // version 2's cache, and any lazy chunk it has not loaded is a URL nothing
    // serves.
    const { registration, a, b } = twoTabs();
    const worker = registration.installUpdate();
    expect(a.watcher.status()).toBe('available');
    expect(b.watcher.status()).toBe('available');

    const before = a.announcements();
    bTakesTheUpdate(registration, b, worker);

    expect(a.watcher.status()).toBe('superseded');
    // The rider's screen has to hear about it; nothing polls.
    expect(a.announcements()).toBeGreaterThan(before);
    // And B is unaffected: it asked, so it is waiting for its own reload.
    expect(b.watcher.status()).toBe('activating');
  });

  it('reloads the tab that did not ask only when the rider asks it to', () => {
    const { registration, a, b } = twoTabs();
    const worker = registration.installUpdate();
    bTakesTheUpdate(registration, b, worker);

    // ADR 0027 D-2: nothing reloads on its own, not even here. A
    // `controllerchange` arrives in A too — that is how the spec's Activate
    // works — and A must still not reload by itself.
    a.changes.fire();
    expect(a.reloads()).toBe(0);

    a.watcher.reloadNow();
    expect(a.reloads()).toBe(1);
  });

  it('reloads at most once however many times the rider presses', () => {
    const { registration, a, b } = twoTabs();
    const worker = registration.installUpdate();
    bTakesTheUpdate(registration, b, worker);
    a.watcher.reloadNow();
    a.watcher.reloadNow();
    a.watcher.reloadNow();
    expect(a.reloads()).toBe(1);
  });

  it('and B, which asked, reloads on controllerchange exactly as it did before', () => {
    const { registration, a, b } = twoTabs();
    const worker = registration.installUpdate();
    bTakesTheUpdate(registration, b, worker);
    b.changes.fire();
    expect(b.reloads()).toBe(1);
    expect(a.reloads()).toBe(0);
  });

  it('will not reload over an unsaved ride, recording or paused — ADR 0027 D-3', () => {
    // ⚠️ #483's fourth criterion, and the one rule that could not be relaxed:
    // `rideInProgress` counts a PAUSED ride, so both are held. The refusal is
    // in the watcher and not only in the component, for the reason
    // `activate`'s is.
    const { registration, a, b } = twoTabs();
    const worker = registration.installUpdate();
    a.recording.set(true);
    bTakesTheUpdate(registration, b, worker);

    expect(a.watcher.status()).toBe('superseded-deferred');
    a.watcher.reloadNow();
    expect(a.reloads()).toBe(0);
    a.changes.fire();
    expect(a.reloads()).toBe(0);

    // And the moment the ride is saved the rider may act, with nobody polling.
    const before = a.announcements();
    a.recording.set(false);
    expect(a.announcements()).toBeGreaterThan(before);
    expect(a.watcher.status()).toBe('superseded');
    a.watcher.reloadNow();
    expect(a.reloads()).toBe(1);
  });

  it('does not call a tab superseded when a NEWER worker made the waiting one redundant', () => {
    // ⚠️ The other way out of `installed`, and it is the case that must NOT
    // report a stale tab: nothing activated, so nothing deleted this tab's
    // cache, and the newer worker will be offered when it installs.
    const { watcher, registration } = harness();
    const worker = registration.installUpdate();
    worker.become('redundant');
    expect(watcher.status()).toBe('none');
    registration.installUpdate();
    expect(watcher.status()).toBe('available');
  });

  it('does not call a rider’s FIRST ever visit superseded', () => {
    // ⚠️ #467's guard, restated for the new state. `clients.claim()` makes the
    // first ever worker the controller of the page that installed it, and a
    // rule written off `controllerchange` would have called every first visit
    // stale. The signal is a worker this watcher was OFFERING leaving
    // `installed`, and a first install is never offered.
    const { watcher, registration, changes, reloads } = harness();
    registration.installFirstEver();
    changes.fire();
    expect(watcher.status()).toBe('none');
    expect(reloads()).toBe(0);
  });

  it('refuses to activate a further release, and reloading is the one way out', () => {
    // ADR 0027 D-4. A release that installs behind a tab already left behind
    // does not make the old bundle current; the reload repairs both.
    const { registration, a, b } = twoTabs();
    const first = registration.installUpdate();
    bTakesTheUpdate(registration, b, first);
    first.become('activated');

    const second = registration.installUpdate();
    expect(a.watcher.status()).toBe('superseded');
    a.watcher.activate();
    expect(second.posted).toEqual([]);
    expect(a.reloads()).toBe(0);
    a.watcher.reloadNow();
    expect(a.reloads()).toBe(1);
  });

  it('is not reachable by "Not now", which silences an offer and not a fact', () => {
    const { registration, a, b } = twoTabs();
    const worker = registration.installUpdate();
    a.watcher.dismiss();
    expect(a.watcher.status()).toBe('none');
    bTakesTheUpdate(registration, b, worker);
    expect(a.watcher.status()).toBe('superseded');
    a.watcher.dismiss();
    expect(a.watcher.status()).toBe('superseded');
  });

  it('does nothing when the rider’s tab was never left behind', () => {
    const { watcher, registration, reloads } = harness();
    registration.installUpdate();
    watcher.reloadNow();
    expect(reloads()).toBe(0);
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
