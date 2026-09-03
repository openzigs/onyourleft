// SPDX-License-Identifier: Apache-2.0

/**
 * Passing a value in the wrong unit is a **compile** error.
 *
 * ## How this file asserts that, and why it is not a runtime test
 *
 * Every case below is a `// @ts-expect-error` directive over a call that must
 * not typecheck. The assertion is the directive itself: if the call ever starts
 * to compile, TypeScript reports `TS2578: Unused '@ts-expect-error' directive`
 * on this file, `pnpm run typecheck` fails, and CI fails with it. This file is
 * inside `packages/domain/tsconfig.json`'s program, so that is not a
 * hypothetical.
 *
 * That inversion is the whole point. A runtime assertion cannot express "this
 * does not compile" — by the time a test runs, the brand has erased and the
 * value is a plain number, so the wrong-unit call would succeed and return a
 * wrong number, which is exactly the failure this package exists to prevent.
 * The `expect(...)` calls here are deliberately *not* the assertion; several of
 * them pin the fact that the wrong-unit call would have returned a plausible
 * wrong number, which is what makes the compile error worth having.
 *
 * A directive is only as good as the error under it, so each one names the
 * specific mismatch rather than sitting over a whole block.
 */

import { describe, expect, it } from 'vitest';

import type { DegreesLongitude, Metres, MetresPerSecond } from './index';
import {
  altitudeMetres,
  degreesLatitude,
  degreesLatitudeToSemicircles,
  eventTimeIntervalIsAmbiguous,
  EVENT_TICKS_PER_SECOND_1024,
  degreesLongitude,
  kilometresPerHourToMetresPerSecond,
  metres,
  metresPerSecond,
  metresPerSecondToKilometresPerHour,
  unixSeconds,
} from './index';

describe('a bare number is not a quantity', () => {
  it('does not accept an unvalidated number where a speed is required', () => {
    // @ts-expect-error a plain number carries no unit and has not been validated
    expect(metresPerSecondToKilometresPerHour(10)).toBeCloseTo(36, 10);
  });

  it('accepts the same number once it has been through the constructor', () => {
    expect(metresPerSecondToKilometresPerHour(metresPerSecond(10))).toBeCloseTo(36, 10);
  });
});

describe('two quantities of the same dimension are not interchangeable', () => {
  it('does not accept metres where metres per second are required', () => {
    // @ts-expect-error a distance is not a speed, however alike the numbers look
    expect(metresPerSecondToKilometresPerHour(metres(10))).toBeCloseTo(36, 10);
  });

  it('does not accept an altitude where a distance is required', () => {
    // @ts-expect-error altitude is signed and is not a distance travelled
    const distance: Metres = altitudeMetres(-430);
    expect(distance).toBe(-430);
  });

  it('does not accept a latitude where a longitude is required', () => {
    // @ts-expect-error a latitude is not a longitude; this is the coordinate swap
    const longitude: DegreesLongitude = degreesLatitude(45);
    expect(longitude).toBe(45);
  });

  it('does not accept a longitude where a latitude is required', () => {
    // @ts-expect-error the encoder for latitude will not take a longitude
    expect(degreesLatitudeToSemicircles(degreesLongitude(45))).toBe(536870912);
  });
});

describe('a presentation unit is not a canonical one', () => {
  it('does not accept metres per second where kilometres per hour are required', () => {
    // @ts-expect-error this is the conversion *from* km/h; it would divide by 3.6 twice
    expect(kilometresPerHourToMetresPerSecond(metresPerSecond(36))).toBeCloseTo(10, 10);
  });
});

describe('an instant is not a duration', () => {
  it('does not accept seconds-since-the-epoch where an elapsed interval is required', () => {
    // @ts-expect-error an instant is not an elapsed time; this would always be ambiguous
    expect(eventTimeIntervalIsAmbiguous(unixSeconds(1788393600), EVENT_TICKS_PER_SECOND_1024)).toBe(
      true,
    );
  });
});

describe('what the brand deliberately still allows', () => {
  it('is assignable to number, so ordinary arithmetic and comparison work', () => {
    const speed: MetresPerSecond = metresPerSecond(8.25);
    const asNumber: number = speed;

    expect(Math.round(asNumber)).toBe(8);
    expect(speed > metresPerSecond(8)).toBe(true);
  });

  it('erases at runtime: a quantity is a plain number, with no wrapper', () => {
    expect(typeof metresPerSecond(8.25)).toBe('number');
    expect(JSON.stringify({ speed: metresPerSecond(8.25) })).toBe('{"speed":8.25}');
  });
});
