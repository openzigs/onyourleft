// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A fixed-window rate limit, in memory (#772).
 *
 * Kept in memory on purpose: a limit exists to bound what one caller can make
 * the instance do in a minute, and forgetting the counts on a restart costs
 * one window's allowance at most. The count is bounded too — a window's keys
 * are dropped when the window turns over — so a stranger sending a new public
 * key with every request grows it by one entry a request for one window and
 * no longer.
 */

export interface RateLimit {
  /** How many requests a key may make in one window. */
  readonly limit: number;
  /** The window, in milliseconds. */
  readonly windowMs: number;
}

export interface RateLimiter {
  /** Count one request against `key`. `false` when it is over the limit. */
  allow(key: string): boolean;
}

export function createRateLimiter(rate: RateLimit, now: () => number): RateLimiter {
  let window = Number.NaN;
  let counts = new Map<string, number>();
  return {
    allow(key) {
      const current = Math.floor(now() / rate.windowMs);
      if (current !== window) {
        window = current;
        counts = new Map();
      }
      const count = (counts.get(key) ?? 0) + 1;
      counts.set(key, count);
      return count <= rate.limit;
    },
  };
}
