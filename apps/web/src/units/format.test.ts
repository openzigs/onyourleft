// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The one place a number becomes a unit, and the cases that hold it there.
 *
 * The compile-time guarantee below arrived with the workspace scaffold in #23,
 * moved from `formatSpeed` to `formatSpeedValue` in #143, and moves here with
 * #238. It is kept rather than dropped because CLAUDE.md §5 is explicit that
 * such a guarantee only holds while its absence breaks the build, and this is
 * still the function on the path a sensor reading takes to the screen.
 */

import { metres, metresPerSecond, UnitError } from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import {
  DISTANCE_DECIMALS,
  distanceIn,
  distanceUnit,
  formatDistance,
  formatSmallDistance,
  formatSpeed,
  measurementText,
  smallDistanceIn,
  smallDistanceUnit,
  speedIn,
  speedUnit,
} from './format';

describe('formatSpeed', () => {
  it('reads 10 m/s as 36.0 km/h for a metric rider', () => {
    expect(formatSpeed(metresPerSecond(10), 'metric')).toEqual({ value: '36.0', unit: 'km/h' });
  });

  it('reads the same 10 m/s as 22.4 mph for an imperial one', () => {
    // The number is the point: a formatter that changed only the label would
    // pass a test that asserted the unit alone, and that is the exact defect
    // #238 is about — a half-converted screen.
    expect(formatSpeed(metresPerSecond(10), 'imperial')).toEqual({ value: '22.4', unit: 'mph' });
  });

  it('renders one decimal place in both systems', () => {
    expect(formatSpeed(metresPerSecond(7.3), 'metric').value).toMatch(/^\d+\.\d$/);
    expect(formatSpeed(metresPerSecond(7.3), 'imperial').value).toMatch(/^\d+\.\d$/);
  });

  it('leaves a standstill at zero in both, rather than at a converted nothing', () => {
    expect(formatSpeed(metresPerSecond(0), 'metric').value).toBe('0.0');
    expect(formatSpeed(metresPerSecond(0), 'imperial').value).toBe('0.0');
  });

  it('cannot be handed an unvalidated number at all — a compile error first', () => {
    // What actually protects this path is the TYPE, not a runtime check inside
    // `formatSpeed`. A malformed sensor payload cannot reach here as a bare
    // number, so "NaN" is unrenderable by construction.
    //
    // The `toThrow` is not that assertion. Since #103 the domain conversion
    // returns through its constructor instead of casting, so a NaN forced past
    // the type reaches one that rejects it rather than rendering "NaN". The
    // directive is still the guarantee; this is the belt under it.
    expect(() => {
      // @ts-expect-error a raw number is not a MetresPerSecond. If this stops
      // being an error the directive fails the build, which is what keeps the
      // guarantee honest.
      formatSpeed(Number.NaN, 'metric');
    }).toThrow(UnitError);
  });

  it('holds that guarantee on the imperial path too', () => {
    // Two directives rather than one, because the imperial reading goes
    // through a *different* domain conversion. A guard on one path is not a
    // guard on the other, and this is the path that did not exist before #238.
    expect(() => {
      // @ts-expect-error a raw number is not a MetresPerSecond.
      formatSpeed(Number.NaN, 'imperial');
    }).toThrow(UnitError);
  });

  it('rejects an impossible speed at the domain constructor, before formatting', () => {
    // This asserts the CONSTRUCTOR, and says so. A version that read
    // `expect(() => formatSpeed(metresPerSecond(Number.NaN), …))` would be
    // named for propagation through the formatter — but the throw happens
    // while evaluating the argument, so the formatter is never entered, and
    // mutating it to return a constant would leave that test green.
    expect(() => metresPerSecond(Number.NaN)).toThrow(/finite/);
  });
});

describe('formatDistance — the ride scale', () => {
  it('reads 42 195 m as 42.2 km, and as 26.2 mi', () => {
    // A marathon, because both readings are numbers a person can check.
    expect(formatDistance(metres(42_195), 'metric')).toEqual({ value: '42.2', unit: 'km' });
    expect(formatDistance(metres(42_195), 'imperial')).toEqual({ value: '26.2', unit: 'mi' });
  });

  it('uses one decimal by default in both systems', () => {
    expect(DISTANCE_DECIMALS).toBe(1);
    expect(formatDistance(metres(1234), 'metric').value).toBe('1.2');
    expect(formatDistance(metres(1609.344), 'imperial').value).toBe('1.0');
  });

  it('takes a precision from the caller, which is not a unit choice', () => {
    // The game HUD counts the last kilometre down and wants the ten-metre
    // digit. That is a precision argument; the unit is still the formatter's.
    expect(formatDistance(metres(1234), 'metric', 2)).toEqual({ value: '1.23', unit: 'km' });
    expect(formatDistance(metres(1234), 'imperial', 2)).toEqual({ value: '0.77', unit: 'mi' });
  });

  it('converts through the international mile, exactly 1609.344 m', () => {
    expect(distanceIn(1609.344, 'imperial')).toBeCloseTo(1, 12);
    expect(distanceIn(1000, 'metric')).toBeCloseTo(1, 12);
  });
});

describe('formatSmallDistance — the segment and elevation scale', () => {
  it('reads 400 m as 400 m, and as 1312 ft', () => {
    expect(formatSmallDistance(400, 'metric')).toEqual({ value: '400', unit: 'm' });
    expect(formatSmallDistance(400, 'imperial')).toEqual({ value: '1312', unit: 'ft' });
  });

  it('rounds to whole units, because a tenth of a foot is not a climb', () => {
    expect(formatSmallDistance(123.4, 'metric').value).toBe('123');
    expect(formatSmallDistance(0.3048, 'imperial').value).toBe('1');
  });

  it('accepts a signed value, because an altitude can be below sea level', () => {
    // The reason this one takes a plain `number` rather than a `Metres`: the
    // ride detail view draws an altitude trace and `AltitudeMetres` is signed.
    expect(formatSmallDistance(-30, 'metric')).toEqual({ value: '-30', unit: 'm' });
    expect(formatSmallDistance(-30, 'imperial')).toEqual({ value: '-98', unit: 'ft' });
  });

  it('is consistent with the mile: 5280 ft is one mile', () => {
    // The two factors are definitions from the same 1959 agreement, so this
    // has to hold exactly. If it stops holding, one of them has been edited.
    expect(smallDistanceIn(1609.344, 'imperial')).toBeCloseTo(5280, 9);
  });
});

describe('a value and its label are produced together', () => {
  it('gives the same labels the format functions do', () => {
    // The label accessors exist for a column heading, which has no number of
    // its own. They must not be able to disagree with the measurements in the
    // column below them.
    for (const units of ['metric', 'imperial'] as const) {
      expect(speedUnit(units)).toBe(formatSpeed(metresPerSecond(1), units).unit);
      expect(distanceUnit(units)).toBe(formatDistance(metres(1), units).unit);
      expect(smallDistanceUnit(units)).toBe(formatSmallDistance(1, units).unit);
    }
  });

  it('never returns an empty unit, which a caller could render as a bare number', () => {
    for (const units of ['metric', 'imperial'] as const) {
      expect(formatSpeed(metresPerSecond(1), units).unit).not.toBe('');
      expect(formatDistance(metres(1), units).unit).not.toBe('');
      expect(formatSmallDistance(1, units).unit).not.toBe('');
    }
  });

  it('joins the two with a single space', () => {
    expect(measurementText(formatSpeed(metresPerSecond(10), 'imperial'))).toBe('22.4 mph');
  });
});

describe('the two systems are actually different', () => {
  it('gives a different number for every quantity, not only a different label', () => {
    // The cheapest way to "add imperial units" and ship nothing is to change
    // the labels. This is the assertion that catches it.
    expect(speedIn(metresPerSecond(10), 'metric')).not.toBeCloseTo(
      speedIn(metresPerSecond(10), 'imperial'),
      3,
    );
    expect(distanceIn(5000, 'metric')).not.toBeCloseTo(distanceIn(5000, 'imperial'), 3);
    expect(smallDistanceIn(100, 'metric')).not.toBeCloseTo(smallDistanceIn(100, 'imperial'), 3);
  });

  it('leaves the metric reading exactly what it was before #238', () => {
    // A regression guard on the half that already worked: 10 m/s was '36.0'
    // and 1000 m was '1.0' before this issue, and must still be.
    expect(formatSpeed(metresPerSecond(10), 'metric').value).toBe('36.0');
    expect(formatDistance(metres(1000), 'metric').value).toBe('1.0');
  });
});
