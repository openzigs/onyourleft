// SPDX-License-Identifier: Apache-2.0

/**
 * The 1989-12-31 boundary, pinned from both sides.
 *
 * `date_time` is a `uint32`, so an instant *below* the FIT epoch has no
 * representation at all. That makes the boundary an encode-side rejection: a
 * negative second count written into an unsigned field reappears as a date
 * sixty years in the future, which is plausible enough to store and impossible
 * to detect afterwards. `packages/domain` already refuses it; this test is here
 * so #31 cannot lose the behaviour without a fixture package going red, and so
 * the decode-side fixture has a stated meaning.
 */

import {
  FIT_EPOCH_UNIX_SECONDS,
  fitTimestampToUnixSeconds,
  isFitSystemTime,
  UnitError,
  unixSeconds,
  unixSecondsToFitTimestamp,
} from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

describe('the FIT epoch boundary', () => {
  it('accepts the epoch instant itself, which encodes to zero', () => {
    expect(unixSecondsToFitTimestamp(unixSeconds(FIT_EPOCH_UNIX_SECONDS))).toBe(0);
    expect(fitTimestampToUnixSeconds(0)).toBe(FIT_EPOCH_UNIX_SECONDS);
  });

  it('rejects one second below the epoch rather than wrapping it', () => {
    expect(() => unixSecondsToFitTimestamp(unixSeconds(FIT_EPOCH_UNIX_SECONDS - 1))).toThrow(
      UnitError,
    );
  });

  it('rejects the Unix epoch, which is nineteen years below the FIT one', () => {
    expect(() => unixSecondsToFitTimestamp(unixSeconds(0))).toThrow(UnitError);
  });

  it('classifies the reserved system-time range this fixture straddles', () => {
    // The values written into timestamp-epoch-boundary.fit, and what each means.
    expect(isFitSystemTime(0)).toBe(true);
    expect(isFitSystemTime(0x0fffffff)).toBe(true);
    expect(isFitSystemTime(0x10000000)).toBe(false);
    expect(isFitSystemTime(0xffffffff)).toBe(false);
  });
});
