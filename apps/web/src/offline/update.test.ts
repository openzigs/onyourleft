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

  /** A new worker arrives and installs behind the one that is running. */
  installUpdate(): FakeWorker {
    const worker = new FakeWorker();
    this.installing = worker;
    for (const listener of this.found) {
      listener();
    }
    // The browser sets `waiting` before it dispatches `statechange`, which is
    // the ordering the watcher reads — see its note about the first install.
    this.waiting = worker;
    worker.become('installed');
    return worker;
  }

  /** The FIRST ever worker: installed with nothing controlling the page. */
  installFirstEver(): FakeWorker {
    const worker = new FakeWorker();
    this.installing = worker;
    for (const listener of this.found) {
      listener();
    }
    // ⚠️ `waiting` stays null. With no controlled client the browser takes the
    // worker straight to `activating`.
    worker.become('installed');
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
    // ⚠️ The case a naive reading of `installing.state === 'installed'` gets
    // wrong: the first worker on an origin installs with nothing controlling
    // the page, so `registration.waiting` is null and there is no old bundle to
    // replace. Offering here would tell every new rider to update to the
    // version they are already running.
    const { watcher, registration } = harness();
    registration.installFirstEver();
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
