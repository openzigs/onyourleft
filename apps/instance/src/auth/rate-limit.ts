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
  /** Whether `key` is under the limit, counting nothing. */
  peek(key: string): boolean;
  /** Count one against `key`, whatever the count is. */
  count(key: string): void;
  /**
   * Count one request against `key` and answer how many it has made in this
   * window, this one included — for a caller that treats the first request
   * of a window differently from the rest (#883).
   */
  take(key: string): number;
  /** Forget every key whose window has ended. */
  sweep(): void;
  /** How many keys are held now. */
  readonly size: number;
}

export function createRateLimiter(rate: RateLimit, now: () => number): RateLimiter {
  let window = Number.NaN;
  let counts = new Map<string, number>();
  /** The counts of the current window, dropped when the window they were taken in has ended. */
  function current(): Map<string, number> {
    const at = Math.floor(now() / rate.windowMs);
    if (at !== window) {
      window = at;
      counts = new Map();
    }
    return counts;
  }
  function take(key: string): number {
    const held = current();
    const next = (held.get(key) ?? 0) + 1;
    held.set(key, next);
    return next;
  }
  return {
    allow: (key) => take(key) <= rate.limit,
    peek: (key) => (current().get(key) ?? 0) < rate.limit,
    count: (key) => {
      take(key);
    },
    take,
    sweep: () => {
      current();
    },
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

/**
 * The key a per-address limit counts a client under (#775): an IPv4 address
 * as it is, and an IPv6 address by its first 64 bits, because one subscriber is
 * routinely handed a whole /64 and could otherwise take a fresh address for
 * every request. An IPv4 address written as IPv6 (`::ffff:192.0.2.1`) is
 * counted as the IPv4 address it is. Anything else is counted as it is.
 *
 * ⚠️ **It can still be varied**, and #775 asks for that to be said plainly: a
 * client with many IPv4 addresses, or more than one /64 (a /48 is a common
 * allocation), gets an allowance for each. What makes an identity cost
 * something is approval-required registration, not this limit; this limit
 * bounds how fast one address can fill the approval queue.
 */
export function addressKey(address: string): string {
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address);
  if (mapped !== null) return mapped[1] as string;
  if (!address.includes(':')) return address;
  const [head = '', tail = ''] = address.toLowerCase().split('%')[0]!.split('::');
  const left = head === '' ? [] : head.split(':');
  const right = tail === '' ? [] : tail.split(':');
  const groups = address.includes('::')
    ? [...left, ...Array<string>(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right]
    : left;
  return `${groups
    .slice(0, 4)
    .map((group) => group.replace(/^0+(?=.)/, ''))
    .join(':')}::/64`;
}
