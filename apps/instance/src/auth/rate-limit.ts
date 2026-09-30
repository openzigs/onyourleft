// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A fixed-window rate limit, in memory (#772).
 *
 * Kept in memory on purpose: a limit exists to bound what one caller can make
 * the instance do in a minute, and forgetting the counts on a restart costs
 * one window's allowance at most.
 *
 * ⚠️ **A key is held for no longer than its window** (#892's review). The
 * privacy policy says the project's instance holds an internet address "in
 * memory only, for at most an hour", and a key here IS an address. Replacing
 * the counts only inside {@link RateLimiter.allow} did not keep that promise:
 * an address stayed until the NEXT request after its window ended, which on a
 * quiet instance is days. So a window's keys are dropped when the window ends
 * whether or not anybody asks again — by {@link RateLimiter.sweep}, which the
 * Node adapter runs on every {@link sweepPeriodMs} boundary
 * (`node-listener.ts` §`sweepOnBoundaries`). Windows are aligned to multiples
 * of their length from the epoch, so a sweep on each boundary ends a key's
 * life at the end of its window, never later. No clock is read here: time is
 * the `now` this is handed.
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
  /** Forget every key whose window has ended. */
  sweep(): void;
  /** How many keys are held now. */
  readonly size: number;
}

export function createRateLimiter(rate: RateLimit, now: () => number): RateLimiter {
  let window = Number.NaN;
  let counts = new Map<string, number>();
  /** Drop the counts when the window they were taken in has ended. */
  function turnOver(): void {
    const current = Math.floor(now() / rate.windowMs);
    if (current !== window) {
      window = current;
      counts = new Map();
    }
  }
  return {
    allow(key) {
      turnOver();
      const count = (counts.get(key) ?? 0) + 1;
      counts.set(key, count);
      return count <= rate.limit;
    },
    sweep: turnOver,
    get size() {
      return counts.size;
    },
  };
}

/**
 * The period a sweep has to run on for every one of `rates` to be swept at the
 * end of each of its windows: their greatest common divisor, since each
 * window's boundaries are multiples of its own length.
 */
export function sweepPeriodMs(rates: readonly RateLimit[]): number {
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  return rates.reduce((period, rate) => gcd(rate.windowMs, period), 0);
}
