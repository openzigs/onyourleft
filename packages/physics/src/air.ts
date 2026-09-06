// SPDX-License-Identifier: Apache-2.0

/**
 * Air density from altitude and temperature, by the International Standard
 * Atmosphere.
 *
 * Air density is the single largest lever in the model at any speed a rider
 * cares about: the aerodynamic term is 76 % of total power in Martin's own flat
 * trials, and it is linear in ρ. Riding the same watts at 2 000 m is worth
 * roughly 4 % more speed than at sea level, which is a bigger effect than most
 * of the coefficients in `coefficients.ts` and is the reason this is computed
 * rather than assumed.
 *
 * Martin et al. do not model it — they measured ρ in the wind tunnel and used
 * the measurement (1.2234 kg/m³ in Appendix I), which is why every entry point
 * in this package takes a density rather than an altitude. This function is for
 * the caller that has an altitude and a thermometer instead, and its output goes
 * into the same parameter.
 *
 * ## The formula, and where each constant is defined
 *
 * ISO 2533:1975 (the International Standard Atmosphere) fixes sea-level
 * pressure, sea-level temperature, the tropospheric lapse rate, standard gravity
 * and the composition of dry air. Pressure at a geopotential altitude `h` within
 * the troposphere is
 *
 * ```
 * p(h) = p₀ (1 − L h / T₀) ^ (g₀ M / (R L))
 * ```
 *
 * and density follows from the ideal gas law, `ρ = p M / (R T)`, evaluated at
 * the **actual** temperature rather than the standard one. Splitting it that way
 * is what makes the function useful: pressure at altitude is very nearly a
 * property of the altitude, while temperature on the day is not, and a cold
 * morning is several per cent denser than a hot afternoon at the same place.
 *
 * ## Two things it does not model
 *
 * - **Humidity.** Moist air is *less* dense than dry air, by up to about 1 % at
 *   30 °C and saturation and far less than that in any weather someone rides a
 *   bicycle in. Modelling it needs a vapour-pressure input nothing in Phase 1
 *   has.
 * - **Weather.** The pressure comes from the altitude, so a deep low or a strong
 *   high is not seen. A 30 hPa departure from standard is about 3 % of density.
 *   A caller who has a barometer should compute `p M / (R T)` directly rather
 *   than passing its altitude through here.
 *
 * Both are documented rather than approximated, because a wrong correction is
 * harder to find than an absent one.
 */

import type { AltitudeMetres, DegreesCelsius } from '@onyourleft/domain';

import { STANDARD_GRAVITY_METRES_PER_SECOND_SQUARED } from './constants';
import { PhysicsError } from './physics-error';

/** `p₀` — sea-level standard pressure, in pascals. ISO 2533. */
export const SEA_LEVEL_STANDARD_PRESSURE_PASCALS = 101325;

/** `T₀` — sea-level standard temperature, in kelvin (15 °C). ISO 2533. */
export const SEA_LEVEL_STANDARD_TEMPERATURE_KELVIN = 288.15;

/** `L` — the tropospheric temperature lapse rate, in kelvin per metre. ISO 2533. */
export const TROPOSPHERIC_LAPSE_RATE_KELVIN_PER_METRE = 0.0065;

/** `M` — the molar mass of dry air, in kilograms per mole. ISO 2533. */
export const MOLAR_MASS_OF_DRY_AIR_KILOGRAMS_PER_MOLE = 0.0289644;

/**
 * `R*` — the universal gas constant, in joules per mole kelvin, **as ISO 2533
 * fixes it**: 8.31432.
 *
 * Not the 2019 CODATA value of 8.314462618…, which is exact by definition of the
 * kelvin. The standard atmosphere's other constants were chosen together with
 * this one, and they are used as a set: with this value the formula reproduces
 * the 1.225 kg/m³ sea-level density the same standard *defines* to within
 * 8 × 10⁻⁷, and with the modern one it is out by 2.2 × 10⁻⁵ — so the table and
 * the formula stop agreeing.
 *
 * ⚠️ **That is 22 parts per million, and it is worth nothing to a rider.** It is
 * three orders of magnitude below the effect of not knowing the day's pressure,
 * which this function already does not model. The reason to keep the set intact
 * is that a formula which no longer reproduces its own standard's table is a
 * formula nobody can check against the standard — not that the third decimal
 * place of a speed depends on it. `air.test.ts` asserts the sea-level value to
 * five decimal places for exactly that reason, and that assertion is the only
 * thing standing between this constant and a well-meaning modernisation.
 */
export const ISO_2533_GAS_CONSTANT_JOULES_PER_MOLE_KELVIN = 8.31432;

/**
 * The top of the ISA troposphere, in metres. Above it the lapse rate is zero
 * rather than 0.0065 K/m and the formula below no longer applies.
 */
export const TROPOSPHERE_CEILING_METRES = 11000;

/** Zero degrees Celsius, in kelvin. */
const KELVIN_AT_ZERO_CELSIUS = 273.15;

/**
 * The specific gas constant of dry air, in joules per kilogram kelvin: the
 * universal gas constant divided by the molar mass, which works out at
 * 287.0528… under ISO 2533's constants.
 *
 * Written out in words rather than as the symbols, because the symbolic form
 * puts a `*` immediately before a `/` and ends this comment three lines early.
 */
const SPECIFIC_GAS_CONSTANT_OF_DRY_AIR =
  ISO_2533_GAS_CONSTANT_JOULES_PER_MOLE_KELVIN / MOLAR_MASS_OF_DRY_AIR_KILOGRAMS_PER_MOLE;

/**
 * The exponent of the barometric formula, `g₀ M / (R* L)` ≈ 5.2559.
 */
const BAROMETRIC_EXPONENT =
  (STANDARD_GRAVITY_METRES_PER_SECOND_SQUARED * MOLAR_MASS_OF_DRY_AIR_KILOGRAMS_PER_MOLE) /
  (ISO_2533_GAS_CONSTANT_JOULES_PER_MOLE_KELVIN * TROPOSPHERIC_LAPSE_RATE_KELVIN_PER_METRE);

/**
 * Standard-atmosphere pressure at an altitude, in pascals.
 *
 * @throws {PhysicsError} above {@link TROPOSPHERE_CEILING_METRES}, where the
 * formula's lapse rate is no longer the atmosphere's. Silently returning a
 * number there would be worse than refusing: the expression under the exponent
 * goes negative near 44 km and `Math.pow` of a negative base to a fractional
 * exponent is `NaN`, which then propagates through a whole ride as a plausible
 * absence of resistance.
 */
export function standardAtmospherePressurePascals(altitude: AltitudeMetres): number {
  if (altitude > TROPOSPHERE_CEILING_METRES) {
    throw new PhysicsError(
      `altitude is above the ISO 2533 troposphere (${String(TROPOSPHERE_CEILING_METRES)} m), ` +
        'where the standard lapse rate this formula assumes does not hold',
    );
  }
  const lapsed =
    1 -
    (TROPOSPHERIC_LAPSE_RATE_KELVIN_PER_METRE * altitude) / SEA_LEVEL_STANDARD_TEMPERATURE_KELVIN;
  return SEA_LEVEL_STANDARD_PRESSURE_PASCALS * Math.pow(lapsed, BAROMETRIC_EXPONENT);
}

/**
 * Air density in kilograms per cubic metre, for the parameter every entry point
 * in this package calls `airDensityKilogramsPerCubicMetre`.
 *
 * At sea level and 15 °C this returns 1.225 kg/m³, which is the figure ISO 2533
 * publishes; at 2 000 m and the standard 2 °C it returns 1.0065, against the
 * standard's table value of 1.0066. `air.test.ts` asserts both.
 *
 * @param altitude - signed. Below sea level is a real place and is handled.
 * @param temperature - the temperature **on the day**, not the standard-
 * atmosphere temperature for the altitude.
 * @throws {PhysicsError} at or below absolute zero, where the ideal gas law
 * divides by zero, and above the troposphere ceiling.
 */
export function airDensityKilogramsPerCubicMetre(
  altitude: AltitudeMetres,
  temperature: DegreesCelsius,
): number {
  const kelvin = temperature + KELVIN_AT_ZERO_CELSIUS;
  if (kelvin <= 0) {
    throw new PhysicsError('air at absolute zero has no density the ideal gas law can express');
  }
  return standardAtmospherePressurePascals(altitude) / (SPECIFIC_GAS_CONSTANT_OF_DRY_AIR * kelvin);
}
