// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A page that can be hidden and shown, which jsdom's never is, and a wake lock
 * that lets go of every sentinel when the page is hidden — as the platform does
 * (#566's review). Test support, never shipped.
 */

import type { browserScreenLockSource } from './wake-lock';

type WakeLockApi = Parameters<typeof browserScreenLockSource>[0];
type PageVisibility = Parameters<typeof browserScreenLockSource>[1];

export interface HideablePage {
  readonly api: NonNullable<WakeLockApi>;
  readonly page: NonNullable<PageVisibility>;
  /** The page is hidden: the platform releases every sentinel it holds. */
  hide(): void;
  /** The page is visible again. */
  show(): void;
  /** How many times a lock was asked for. */
  requests(): number;
  /** Sentinels the platform is actually holding. */
  live(): number;
  /** How many listeners are waiting for the page to come back. */
  watching(): number;
}

export function hideablePage(): HideablePage {
  const listeners = new Set<() => void>();
  let requests = 0;
  const sentinels: { held: boolean }[] = [];
  return {
    api: {
      request: () => {
        requests += 1;
        const sentinel = { held: true };
        sentinels.push(sentinel);
        return Promise.resolve({
          release: () => {
            sentinel.held = false;
            return Promise.resolve();
          },
        });
      },
    },
    page: {
      onVisible: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
    hide: () => {
      for (const sentinel of sentinels) {
        sentinel.held = false;
      }
    },
    show: () => {
      for (const listener of [...listeners]) {
        listener();
      }
    },
    requests: () => requests,
    live: () => sentinels.filter((each) => each.held).length,
    watching: () => listeners.size,
  };
}
