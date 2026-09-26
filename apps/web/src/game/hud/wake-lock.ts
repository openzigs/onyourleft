// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Keeping the screen on for a ride, and — the half that matters — letting it go
 * afterwards.
 *
 * #94's sixth criterion:
 *
 * > *"The screen does not sleep mid-ride, and the wake lock is released when the
 * > ride ends — a test asserts release, because a leaked wake lock flattens the
 * > battery after the ride."*
 *
 * The criterion names *release* as the thing to assert, and that is the right
 * emphasis: acquiring is the obvious half and the one a developer notices
 * immediately, because a screen that sleeps mid-effort is unmissable. A lock
 * that is never released is invisible — the ride ends, the rider puts the phone
 * in a pocket, and it stays awake until the battery is flat. Nothing about that
 * looks like this feature's fault.
 *
 * ## Why a port
 *
 * `navigator.wakeLock` is a platform API, and this is `apps/web`, so it could
 * simply be called. It is behind an interface anyway for two reasons:
 *
 * 1. **It is absent more often than it is present.** Not on Firefox, not in any
 *    insecure context, and it rejects outright when the document is hidden.
 *    A ride must not fail to start because a screen lock could not be taken.
 * 2. **The Android shell will want the native one.** Capacitor apps hold a
 *    `PARTIAL_WAKE_LOCK` through the foreground service (#87), which survives
 *    conditions the web API does not. When that lands it implements this
 *    interface and nothing else changes — the same relationship `packages/
 *    sensors`' transport interface has with its two adapters.
 */

/** A screen lock that has been taken and can be given back. */
export interface ScreenLock {
  /** Releases it. Must be safe to call twice. */
  release(): Promise<void>;
  /**
   * Whether the lock is actually held. `false` where the platform declined,
   * once it is released, and — where the platform says so — while the page is
   * hidden and before a lock has been taken back. Informational: nothing in
   * the client decides anything on it.
   */
  readonly held: boolean;
}

/** Where a screen lock comes from. */
export interface ScreenLockSource {
  /**
   * Takes a lock, or reports that it could not.
   *
   * ⚠️ Resolves rather than rejects when the platform has no wake lock or
   * refuses one. A rider whose browser cannot keep the screen on should get a
   * ride with a screen that dims, not no ride.
   */
  acquire(): Promise<ScreenLock>;
}

/** A lock that was never taken. Releasing it is a no-op. */
export const NO_SCREEN_LOCK: ScreenLock = {
  held: false,
  release: async (): Promise<void> => {
    // Nothing to give back. Not an error: see `ScreenLockSource.acquire`.
  },
};

/** What the Wake Lock API gives us, named so this file does not depend on lib.dom's version. */
interface WakeLockSentinelLike {
  release(): Promise<void>;
  /**
   * `true` once the platform has let the sentinel go — on `release()`, or when
   * the page was hidden. Optional because an engine or a double may omit it,
   * and then `held` falls back to "not released by us".
   */
  readonly released?: boolean;
}

interface WakeLockLike {
  request(kind: 'screen'): Promise<WakeLockSentinelLike>;
}

/**
 * When the page comes back into view — #566's review.
 *
 * ⚠️ **The platform lets a screen wake lock go whenever the page is hidden**
 * (W3C Screen Wake Lock §"Handling document loss of visibility"), and nothing
 * takes it back. A tablet the rider switched away from for a moment then
 * slept on its own timeout for the rest of the pairing, and ADR 0033 D-4
 * dropped the link — #557's failure again, one app switch later. The ride's
 * lock had the same hole, so the answer is here, where both get it.
 */
interface PageVisibility {
  /** Calls `listener` each time the page becomes visible; returns the unsubscribe. */
  onVisible(listener: () => void): () => void;
}

/** The document's own visibility, where there is a document. */
function platformPageVisibility(): PageVisibility | undefined {
  const page = (globalThis as { document?: Document }).document;
  if (page === undefined) {
    return undefined;
  }
  return {
    onVisible: (listener) => {
      const changed = (): void => {
        if (page.visibilityState === 'visible') {
          listener();
        }
      };
      page.addEventListener('visibilitychange', changed);
      return () => {
        page.removeEventListener('visibilitychange', changed);
      };
    },
  };
}

/**
 * The browser's own wake lock, where there is one — taken again each time the
 * page comes back into view, until it is released (#566's review).
 *
 * @param wakeLock - injected rather than read from `navigator` so the absent and
 * the rejecting cases are testable. jsdom implements no Wake Lock API at all, so
 * a version of this that reached for `navigator.wakeLock` directly could only
 * ever be tested in its absent branch — which is the branch that does nothing.
 * @param page - when the page comes back into view; the document's own by
 * default, injected so a test can hide and show a page jsdom never hides.
 */
export function browserScreenLockSource(
  wakeLock: WakeLockLike | undefined,
  page: PageVisibility | undefined = platformPageVisibility(),
): ScreenLockSource {
  return {
    acquire: async (): Promise<ScreenLock> => {
      if (wakeLock === undefined) {
        return NO_SCREEN_LOCK;
      }
      let current: WakeLockSentinelLike;
      try {
        current = await wakeLock.request('screen');
      } catch {
        // Rejected: a hidden document, an insecure context, a browser that has
        // the property but refuses. All ordinary; none is a reason not to ride.
        return NO_SCREEN_LOCK;
      }
      let released = false;
      // The platform released the old sentinel when the page was hidden, so a
      // new one is asked for; the old is released as well (a no-op on a
      // released sentinel, caught where an engine rejects it), and a new one
      // that arrives after this lock was given back is given straight back.
      const stopWatching =
        page?.onVisible(() => {
          if (released) {
            return;
          }
          wakeLock.request('screen').then(
            (next) => {
              if (released) {
                void next.release().catch(() => undefined);
                return;
              }
              const previous = current;
              current = next;
              void previous.release().catch(() => undefined);
            },
            () => {
              // Refused on the way back: the screen dims, and the ride goes on.
            },
          );
        }) ??
        ((): void => {
          // No document: nothing to watch.
        });
      return {
        get held(): boolean {
          return !released && current.released !== true;
        },
        release: async (): Promise<void> => {
          if (released) {
            // Idempotent on purpose. A ride can end twice — the rider presses
            // stop and the component then unmounts — and a second `release()`
            // on an already-released sentinel rejects in some engines.
            return;
          }
          released = true;
          stopWatching();
          // Caught as the other two releases are: `current` may be a sentinel
          // the platform already let go while the page was hidden, and some
          // engines reject a second release — which a caller that discards
          // this promise with `void` would turn into an unhandled rejection.
          await current.release().catch(() => undefined);
        },
      };
    },
  };
}

/** Reads the platform's wake lock without asserting it exists. */
export function platformWakeLock(): WakeLockLike | undefined {
  const candidate = (navigator as { wakeLock?: WakeLockLike }).wakeLock;
  return typeof candidate?.request === 'function' ? candidate : undefined;
}
