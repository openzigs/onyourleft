// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { createRateLimiter, sweepPeriodMs } from './rate-limit.ts';

/**
 * #892's review: the privacy policy says the project's instance holds an
 * internet address "in memory only, for at most an hour". A key here is that
 * address, so it must be gone when its window ends — with NO further request.
 */
describe('a rate limiter holds a key no longer than its window', () => {
  it('forgets a key at the end of its window with no further request, and not a millisecond before', () => {
    const clock = { ms: 120_000 + 17 };
    const limiter = createRateLimiter({ limit: 5, windowMs: 60_000 }, () => clock.ms);
    expect(limiter.allow('203.0.113.9')).toBe(true);
    expect(limiter.size).toBe(1);

    clock.ms = 179_999;
    limiter.sweep();
    expect(limiter.size).toBe(1);

    clock.ms = 180_000;
    limiter.sweep();
    expect(limiter.size).toBe(0);
  });

  it('keeps counting inside the window across a sweep', () => {
    const clock = { ms: 0 };
    const limiter = createRateLimiter({ limit: 2, windowMs: 60_000 }, () => clock.ms);
    expect(limiter.allow('a')).toBe(true);
    clock.ms = 30_000;
    limiter.sweep();
    expect(limiter.allow('a')).toBe(true);
    expect(limiter.allow('a')).toBe(false);
  });

  it('holds an address counted at the start of an hour-long window for the hour and no longer', () => {
    const hour = 3_600_000;
    const clock = { ms: 5 * hour };
    const limiter = createRateLimiter({ limit: 3, windowMs: hour }, () => clock.ms);
    limiter.allow('rider@example.org');
    clock.ms = 6 * hour - 1;
    limiter.sweep();
    expect(limiter.size).toBe(1);
    clock.ms = 6 * hour;
    limiter.sweep();
    expect(limiter.size).toBe(0);
  });
});

describe('sweepPeriodMs', () => {
  it('is a period every window ends on a boundary of', () => {
    expect(
      sweepPeriodMs([
        { limit: 1, windowMs: 60_000 },
        { limit: 1, windowMs: 3_600_000 },
      ]),
    ).toBe(60_000);
    expect(
      sweepPeriodMs([
        { limit: 1, windowMs: 40_000 },
        { limit: 1, windowMs: 60_000 },
      ]),
    ).toBe(20_000);
  });
});

describe('whatever builds an identity for the running instance runs its sweep', () => {
  // Since the merge with #895, `instance.ts` §`startInstance` builds the
  // running instance's `Identity`, so the project's instance counts addresses.
  // The sweep must come with it, or the policy's "at most an hour" is false
  // again: a tripwire on the one place that builds it. `instance.test.ts`
  // §"#892" drives the sweep through a started instance.
  it('instance.ts runs sweepRateLimits on its period wherever it creates an identity', () => {
    const started = readFileSync(new URL('../instance.ts', import.meta.url), 'utf8');
    expect(started).toContain('createIdentity(');
    expect(started).toContain('sweepRateLimits');
    expect(started).toContain('rateLimitSweepPeriodMs');
  });
});
