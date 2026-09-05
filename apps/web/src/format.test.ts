// SPDX-License-Identifier: AGPL-3.0-or-later

import { metresPerSecond, UnitError } from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import { formatSpeed } from './format';

// These three cases arrived with the workspace scaffold in #23 and lived in
// `App.test.tsx`, which #48 replaced with the real shell. They are moved here
// unchanged rather than dropped: the second is a compile-time guarantee, and
// CLAUDE.md §5 is explicit that such a guarantee only holds while its absence
// breaks the build.
describe('formatSpeed', () => {
  it('renders one decimal place and the unit', () => {
    expect(formatSpeed(metresPerSecond(10))).toBe('36.0 km/h');
  });

  it('cannot be handed an unvalidated number at all — a compile error first', () => {
    // What actually protects this path is the TYPE, not a runtime check inside
    // formatSpeed. A malformed sensor payload cannot reach here as a bare
    // number, so "NaN km/h" is unrenderable by construction.
    //
    // The `toThrow` is not that assertion. Since #103 the domain conversion
    // returns through `kilometresPerHour()` instead of casting, so a NaN forced
    // past the type reaches a constructor that rejects it rather than rendering
    // "NaN km/h". The directive is still the guarantee; this is the belt under
    // it, and it is why the call below no longer completes silently.
    expect(() => {
      // @ts-expect-error a raw number is not a MetresPerSecond. If this stops
      // being an error the directive fails the build, which is what keeps the
      // guarantee honest.
      formatSpeed(Number.NaN);
    }).toThrow(UnitError);
  });

  it('rejects an impossible speed at the domain constructor, before formatting', () => {
    // This asserts the CONSTRUCTOR, and says so. The version this replaced read
    // `expect(() => formatSpeed(metresPerSecond(Number.NaN))).toThrow(...)` and
    // was named for propagation through formatSpeed -- but the throw happens
    // while evaluating the argument, so formatSpeed is never entered. Mutating
    // formatSpeed to return a constant left that test green.
    expect(() => metresPerSecond(Number.NaN)).toThrow(/finite/);
  });
});
