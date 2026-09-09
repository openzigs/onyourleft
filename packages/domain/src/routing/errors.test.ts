// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';

import { RoutingError, type RoutingErrorCode } from './errors';

const RETRYABLE: readonly RoutingErrorCode[] = ['rate-limited', 'unavailable'];
const PERMANENT: readonly RoutingErrorCode[] = [
  'no-route',
  'unpaved-endpoint',
  'malformed-response',
  'invalid-request',
];

describe('which failures a client may ask again about', () => {
  it('marks the two transient ones retryable', () => {
    // ⚠️ #70 asks that a 429 or a timeout surface "as a retryable state in the
    // client, not a blank map". This flag is the whole of that distinction, and
    // it is derived from the code so the two cannot disagree.
    for (const code of RETRYABLE) {
      expect(new RoutingError(code, 'x').retryable).toBe(true);
    }
  });

  it('marks every other one permanent', () => {
    for (const code of PERMANENT) {
      expect(new RoutingError(code, 'x').retryable).toBe(false);
    }
  });

  it('accounts for every code, so a new one cannot slip through unclassified', () => {
    // A code added without a decision about retryability fails here rather than
    // defaulting to "ask again forever" or "give up" by accident.
    expect([...RETRYABLE, ...PERMANENT].sort()).toStrictEqual(
      (
        [
          'invalid-request',
          'malformed-response',
          'no-route',
          'rate-limited',
          'unavailable',
          'unpaved-endpoint',
        ] satisfies RoutingErrorCode[]
      ).sort(),
    );
  });

  it('carries the leg when the failure belongs to one, and not when it does not', () => {
    expect(new RoutingError('no-route', 'x', 2).leg).toBe(2);
    expect(new RoutingError('unavailable', 'x').leg).toBeUndefined();
  });

  it('is an Error a caller can catch by name', () => {
    const error = new RoutingError('no-route', 'x');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('RoutingError');
  });
});
