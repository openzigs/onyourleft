// SPDX-License-Identifier: Apache-2.0

/**
 * Air density, against the table the formula is supposed to reproduce.
 *
 * ISO 2533 publishes both a formula and a table of the values it produces, so
 * this file can do what `martin-1998.test.ts` does for the power model: assert
 * against numbers somebody else published. 1.225 kg/m³ at sea level is the
 * best-known number in the whole standard, and 1.0066 at 2 000 m is its table.
 */

import { describe, expect, it } from 'vitest';

import { altitudeMetres, degreesCelsius } from '@onyourleft/domain';

import {
  airDensityKilogramsPerCubicMetre,
  PhysicsError,
  SEA_LEVEL_STANDARD_PRESSURE_PASCALS,
  standardAtmospherePressurePascals,
  TROPOSPHERE_CEILING_METRES,
} from './index';

const SEA_LEVEL = altitudeMetres(0);
const STANDARD_TEMPERATURE = degreesCelsius(15);

describe('against the ISO 2533 table', () => {
  it('gives 1.225 kg/m³ at sea level and 15 °C, to five decimal places', () => {
    // Five, not four, and the extra digit is the whole point of the assertion.
    // 1.225 is a value ISO 2533 *defines*, and the constants in `air.ts` are the
    // set that reproduces it: they land 8 × 10⁻⁷ away. Swap the standard's gas
    // constant for the 2019 CODATA one — the obvious modernisation, and the one
    // a reader will propose — and the answer moves 2.2 × 10⁻⁵ away, which four
    // decimal places cannot see and five can. Nothing else in this package
    // notices that substitution at all, so if this assertion is ever loosened
    // the constant it protects is unguarded.
    expect(airDensityKilogramsPerCubicMetre(SEA_LEVEL, STANDARD_TEMPERATURE)).toBeCloseTo(1.225, 5);
  });

  it('gives 1.0066 kg/m³ at 2 000 m and the standard 2 °C', () => {
    // The standard's own lapse rate puts 2 °C at 2 000 m: 15 − 0.0065 × 2000.
    expect(airDensityKilogramsPerCubicMetre(altitudeMetres(2000), degreesCelsius(2))).toBeCloseTo(
      1.0066,
      3,
    );
  });

  it('gives 101 325 Pa at sea level exactly', () => {
    expect(standardAtmospherePressurePascals(SEA_LEVEL)).toBe(SEA_LEVEL_STANDARD_PRESSURE_PASCALS);
  });
});

describe('the direction of each effect', () => {
  it('thins with altitude — the reason a climb at altitude is faster than it looks', () => {
    // Roughly 19 % thinner at 2 000 m at a constant temperature, which is worth
    // several per cent of speed at any pace where drag dominates.
    const seaLevel = airDensityKilogramsPerCubicMetre(SEA_LEVEL, STANDARD_TEMPERATURE);
    const altitude = airDensityKilogramsPerCubicMetre(altitudeMetres(2000), STANDARD_TEMPERATURE);
    expect(altitude).toBeLessThan(seaLevel);
    expect(altitude / seaLevel).toBeCloseTo(0.784, 2);
  });

  it('thickens below sea level, where a hundred million people live', () => {
    // `AltitudeMetres` is signed for this reason; the Dead Sea shore is −430 m.
    expect(
      airDensityKilogramsPerCubicMetre(altitudeMetres(-430), STANDARD_TEMPERATURE),
    ).toBeGreaterThan(airDensityKilogramsPerCubicMetre(SEA_LEVEL, STANDARD_TEMPERATURE));
  });

  it('thickens as it cools, at the same place', () => {
    const cold = airDensityKilogramsPerCubicMetre(SEA_LEVEL, degreesCelsius(-5));
    const hot = airDensityKilogramsPerCubicMetre(SEA_LEVEL, degreesCelsius(35));
    expect(cold).toBeGreaterThan(hot);
    // 40 °C is about 14 % of density, which is more than the spread of drag
    // areas between a time trial position and the hoods.
    expect(cold / hot - 1).toBeGreaterThan(0.1);
  });
});

describe('inputs that are individually valid and jointly impossible', () => {
  it('refuses an altitude above the troposphere rather than returning NaN', () => {
    // The base of the power goes negative near 44 km, and `Math.pow` of a
    // negative base to a fractional exponent is NaN — which would travel
    // through a whole ride looking like an absence of air resistance.
    expect(() =>
      standardAtmospherePressurePascals(altitudeMetres(TROPOSPHERE_CEILING_METRES + 1)),
    ).toThrow(PhysicsError);
    expect(() => standardAtmospherePressurePascals(altitudeMetres(50000))).toThrow(PhysicsError);
    expect(
      Number.isNaN(standardAtmospherePressurePascals(altitudeMetres(TROPOSPHERE_CEILING_METRES))),
    ).toBe(false);
  });

  it('refuses absolute zero rather than dividing by it', () => {
    // `degreesCelsius` admits exactly −273.15, because that is a temperature.
    // The ideal gas law does not.
    expect(() => airDensityKilogramsPerCubicMetre(SEA_LEVEL, degreesCelsius(-273.15))).toThrow(
      PhysicsError,
    );
  });

  it('is finite everywhere a bicycle can go', () => {
    for (const altitude of [-430, 0, 1000, 3000, 5000]) {
      for (const temperature of [-30, 0, 15, 45]) {
        const density = airDensityKilogramsPerCubicMetre(
          altitudeMetres(altitude),
          degreesCelsius(temperature),
        );
        expect(Number.isFinite(density)).toBe(true);
        expect(density).toBeGreaterThan(0);
      }
    }
  });
});
