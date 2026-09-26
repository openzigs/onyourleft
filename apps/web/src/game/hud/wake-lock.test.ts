// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #94's sixth criterion, whose emphasis is on the half that is invisible.
 *
 * > *"the wake lock is released when the ride ends — a test asserts release,
 * > because a leaked wake lock flattens the battery after the ride."*
 *
 * Acquiring is the half a developer notices immediately: a screen that sleeps
 * mid-effort is unmissable. A lock never released is silent — the ride ends, the
 * phone goes in a pocket, and it stays awake until the battery is flat, with
 * nothing about it looking like this feature's fault.
 */

import { describe, expect, it, vi } from 'vitest';

import { NO_SCREEN_LOCK, browserScreenLockSource } from './wake-lock';
import { hideablePage } from './wake-lock-testing';

/** A wake lock that works, and counts what was asked of it. */
function workingWakeLock(): {
  readonly api: Parameters<typeof browserScreenLockSource>[0];
  readonly released: () => number;
} {
  let releases = 0;
  return {
    api: {
      // `Promise.resolve` rather than `async`: these stand in for a platform API
      // that genuinely awaits something, and an `async` body with nothing to
      // await is a lint error rather than a lie worth writing.
      request: () =>
        Promise.resolve({
          release: () => {
            releases += 1;
            return Promise.resolve();
          },
        }),
    },
    released: () => releases,
  };
}

describe('a ride keeps the screen awake', () => {
  it('takes a lock where the platform has one', async () => {
    const lock = await browserScreenLockSource(workingWakeLock().api).acquire();

    expect(lock.held).toBe(true);
  });

  it('reports the lock released once the ride ends', async () => {
    const platform = workingWakeLock();
    const lock = await browserScreenLockSource(platform.api).acquire();

    await lock.release();

    expect(platform.released()).toBe(1);
    expect(lock.held).toBe(false);
  });

  it('releases only once, however many times a ride ends', async () => {
    // A ride can end twice: the rider presses stop, and the component then
    // unmounts. A second `release()` on a released sentinel rejects in some
    // engines, and an unhandled rejection during teardown is a hard thing to
    // trace back to here.
    const platform = workingWakeLock();
    const lock = await browserScreenLockSource(platform.api).acquire();

    await lock.release();
    await lock.release();
    await lock.release();

    expect(platform.released()).toBe(1);
  });
});

describe('a platform without a wake lock still gets a ride', () => {
  it('resolves rather than rejecting when there is no API at all', async () => {
    // Firefox, and every insecure context.
    const lock = await browserScreenLockSource(undefined).acquire();

    expect(lock.held).toBe(false);
    await expect(lock.release()).resolves.toBeUndefined();
  });

  it('resolves when the platform has the API and refuses', async () => {
    // A hidden document is the common one: the Wake Lock API rejects outright
    // rather than queuing.
    const refusing = {
      request: vi.fn(() => Promise.reject(new Error('document is hidden'))),
    };

    const lock = await browserScreenLockSource(refusing).acquire();

    expect(lock.held).toBe(false);
    expect(refusing.request).toHaveBeenCalledOnce();
  });

  it('has a releasable no-op lock, so a caller needs no special case', async () => {
    await expect(NO_SCREEN_LOCK.release()).resolves.toBeUndefined();
    expect(NO_SCREEN_LOCK.held).toBe(false);
  });
});

describe('a lock the platform let go while the page was hidden — #566’s review', () => {
  it('is taken again when the page comes back into view', async () => {
    const platform = hideablePage();
    const lock = await browserScreenLockSource(platform.api, platform.page).acquire();
    expect(platform.live()).toBe(1);
    platform.hide();
    expect(platform.live()).toBe(0);
    platform.show();
    await Promise.resolve();
    await Promise.resolve();
    expect(platform.requests()).toBe(2);
    expect(platform.live()).toBe(1);
    // And the one taken back is the one given back.
    await lock.release();
    expect(platform.live()).toBe(0);
  });

  it('is not taken again once it has been released, and stops watching the page', async () => {
    const platform = hideablePage();
    const lock = await browserScreenLockSource(platform.api, platform.page).acquire();
    await lock.release();
    expect(platform.watching()).toBe(0);
    platform.hide();
    platform.show();
    await Promise.resolve();
    expect(platform.requests()).toBe(1);
    expect(platform.live()).toBe(0);
  });

  it('gives back a lock that arrives after it was released', async () => {
    const platform = hideablePage();
    const lock = await browserScreenLockSource(platform.api, platform.page).acquire();
    platform.hide();
    platform.show();
    // Released while the new request is on its way.
    await lock.release();
    await Promise.resolve();
    await Promise.resolve();
    expect(platform.requests()).toBe(2);
    expect(platform.live()).toBe(0);
  });

  it('holds one lock when the page is shown twice with nothing hidden between', async () => {
    // Two re-requests can both succeed while the page stays visible — a quick
    // hide/show/hide/show whose first answer lands after the second show. Each
    // new sentinel replaces the one before and gives it back; without that, the
    // platform would be holding three.
    const platform = hideablePage();
    const lock = await browserScreenLockSource(platform.api, platform.page).acquire();
    platform.show();
    platform.show();
    await Promise.resolve();
    await Promise.resolve();
    expect(platform.requests()).toBe(3);
    expect(platform.live()).toBe(1);
    await lock.release();
    expect(platform.live()).toBe(0);
  });

  it('says it is not held while the platform has let it go, and held again once taken back', async () => {
    const platform = hideablePage();
    const lock = await browserScreenLockSource(platform.api, platform.page).acquire();
    expect(lock.held).toBe(true);
    platform.hide();
    expect(lock.held).toBe(false);
    platform.show();
    await Promise.resolve();
    await Promise.resolve();
    expect(lock.held).toBe(true);
    await lock.release();
    expect(lock.held).toBe(false);
  });

  it('does not reject when the engine refuses to release a sentinel it already let go', async () => {
    const lock = await browserScreenLockSource({
      request: () =>
        Promise.resolve({
          release: () => Promise.reject(new Error('already released')),
        }),
    }).acquire();

    await expect(lock.release()).resolves.toBeUndefined();
  });
});
