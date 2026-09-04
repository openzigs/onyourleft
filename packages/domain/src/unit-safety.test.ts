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
  eventTickRate,
  eventTicks,
  eventTimeIntervalIsAmbiguous,
  eventTimeIntervalSeconds,
  EVENT_TICKS_PER_SECOND_1024,
  degreesLongitude,
  kilometresPerHourToMetresPerSecond,
  metres,
  metresPerSecond,
  metresPerSecondToKilometresPerHour,
  seconds,
  UnitError,
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

describe('an event-time reading cannot be assembled in the wrong order (#103)', () => {
  // The three-positional-number signature accepted every permutation of its
  // arguments and returned a plausible answer for each. These directives are
  // what stops it coming back: widen any field of `EventTimeReading` to
  // `number`, or restore the positional signature, and the unused directive
  // fails `pnpm run typecheck`.

  it('cannot be called with three positional numbers at all', () => {
    // The directive is the assertion; the `toThrow` only keeps the suite green
    // while the call runs. A positional call now reads `previousTicks` off a
    // number and finds `undefined`, so it fails loudly at runtime too — but
    // that is the second line of defence, not the guarantee.
    expect(() =>
      // @ts-expect-error the signature that made every transposition below possible
      eventTimeIntervalSeconds(1000, 1512, EVENT_TICKS_PER_SECOND_1024),
    ).toThrow(UnitError);
  });

  it('does not accept the tick rate where a counter reading belongs', () => {
    // #103 row 2: (1000, 1024, 1512) returned 0.0159 s instead of 0.5 s, and
    // threw nothing. Both fields below are wrong, and each is its own error.
    expect(
      eventTimeIntervalSeconds({
        previousTicks: eventTicks(1000),
        // @ts-expect-error a tick rate is not a counter reading
        currentTicks: EVENT_TICKS_PER_SECOND_1024,
        // @ts-expect-error a counter reading is not a tick rate
        ticksPerSecond: eventTicks(1512),
      }),
    ).toBeCloseTo(0.015873, 6);
  });

  it('does not accept an unlabelled number in any of the three fields', () => {
    expect(
      eventTimeIntervalSeconds({
        // @ts-expect-error a plain number carries no unit and has not been range-checked
        previousTicks: 1000,
        // @ts-expect-error a plain number carries no unit and has not been range-checked
        currentTicks: 1512,
        // @ts-expect-error a plain number carries no unit and has not been range-checked
        ticksPerSecond: 1024,
      }),
    ).toBe(0.5);
  });

  it('does not accept a duration where a counter reading belongs', () => {
    expect(
      eventTimeIntervalSeconds({
        previousTicks: eventTicks(1000),
        // @ts-expect-error 1512 ticks is not 1512 seconds
        currentTicks: seconds(1512),
        ticksPerSecond: eventTickRate(1024),
      }),
    ).toBe(0.5);
  });

  it('accepts the reading once every field has been through its constructor', () => {
    expect(
      eventTimeIntervalSeconds({
        previousTicks: eventTicks(1000),
        currentTicks: eventTicks(1512),
        ticksPerSecond: EVENT_TICKS_PER_SECOND_1024,
      }),
    ).toBe(0.5);
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
