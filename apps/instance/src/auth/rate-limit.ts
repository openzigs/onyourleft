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
  /** Whether `key` is under the limit, counting nothing. */
  peek(key: string): boolean;
  /** Count one against `key`, whatever the count is. */
  count(key: string): void;
}

export function createRateLimiter(rate: RateLimit, now: () => number): RateLimiter {
  let window = Number.NaN;
  let counts = new Map<string, number>();
  function current(): Map<string, number> {
    const at = Math.floor(now() / rate.windowMs);
    if (at !== window) {
      window = at;
      counts = new Map();
    }
    return counts;
  }
  function count(key: string): number {
    const held = current();
    const next = (held.get(key) ?? 0) + 1;
    held.set(key, next);
    return next;
  }
  return {
    allow: (key) => count(key) <= rate.limit,
    peek: (key) => (current().get(key) ?? 0) < rate.limit,
    count: (key) => {
      count(key);
    },
  };
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
