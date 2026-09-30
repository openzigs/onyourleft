// SPDX-License-Identifier: Apache-2.0

/**
 * The coefficient set a ride runs — ADR 0028 D-1's table, and #487's constant
 * move.
 */

import { describe, expect, it } from 'vitest';

import { kilograms } from '@onyourleft/domain';

import { MARTIN_1998_COEFFICIENTS, withDefaultCoefficients } from './coefficients';
import { PhysicsError } from './physics-error';
import {
  BICYCLE_MASS_KILOGRAMS,
  RIDING_POSITION_DRAG_AREAS,
  ridingCoefficients,
  ridingConditions,
  ROAD_ROLLING_RESISTANCE_COEFFICIENT,
  SEA_LEVEL_AIR_DENSITY,
} from './riding';

describe('ridingCoefficients — ADR 0028 D-1', () => {
  it('overrides exactly two things and no others', () => {
    for (const position of ['upright', 'hoods', 'drops'] as const) {
      const overrides = ridingCoefficients(position);
      expect(Object.keys(overrides).sort()).toEqual([
        'dragCoefficient',
        'frontalAreaSquareMetres',
        'rollingResistanceCoefficient',
      ]);
      const full = withDefaultCoefficients(overrides);
      // The drag area is the position's, set as a product.
      expect(full.dragCoefficient * full.frontalAreaSquareMetres).toBe(
        RIDING_POSITION_DRAG_AREAS[position],
      );
      expect(full.rollingResistanceCoefficient).toBe(ROAD_ROLLING_RESISTANCE_COEFFICIENT);
      // Everything else is Martin's, untouched.
      expect(full.spokeDragAreaSquareMetres).toBe(
        MARTIN_1998_COEFFICIENTS.spokeDragAreaSquareMetres,
      );
      expect(full.drivetrainLossFraction).toBe(MARTIN_1998_COEFFICIENTS.drivetrainLossFraction);
    }
  });

  it('keeps the three areas in the order a rider would expect, and C_RR above Martin’s', () => {
    expect(RIDING_POSITION_DRAG_AREAS.upright).toBeGreaterThan(RIDING_POSITION_DRAG_AREAS.hoods);
    expect(RIDING_POSITION_DRAG_AREAS.hoods).toBeGreaterThan(RIDING_POSITION_DRAG_AREAS.drops);
    expect(RIDING_POSITION_DRAG_AREAS.drops).toBeGreaterThan(
      MARTIN_1998_COEFFICIENTS.dragCoefficient * MARTIN_1998_COEFFICIENTS.frontalAreaSquareMetres,
    );
    expect(ROAD_ROLLING_RESISTANCE_COEFFICIENT).toBeGreaterThan(
      MARTIN_1998_COEFFICIENTS.rollingResistanceCoefficient,
    );
  });
});

describe('ridingConditions — the game’s ride and a room’s re-simulation, built one way (#779)', () => {
  it('adds the one bicycle to the athlete, and rides alone on exactly ridingCoefficients', () => {
    for (const position of ['upright', 'hoods', 'drops'] as const) {
      const conditions = ridingConditions(kilograms(70), position);
      expect(conditions.totalMass).toBe(70 + BICYCLE_MASS_KILOGRAMS);
      expect(conditions.airDensityKilogramsPerCubicMetre).toBe(SEA_LEVEL_AIR_DENSITY);
      expect(conditions.coefficients).toEqual(ridingCoefficients(position));
    }
  });

  it('multiplies the position’s drag area by a draft, and nothing else', () => {
    const drafted = withDefaultCoefficients(
      ridingConditions(kilograms(70), 'hoods', 0.5).coefficients,
    );
    expect(drafted.dragCoefficient * drafted.frontalAreaSquareMetres).toBe(
      0.5 * RIDING_POSITION_DRAG_AREAS.hoods,
    );
    expect(drafted.rollingResistanceCoefficient).toBe(ROAD_ROLLING_RESISTANCE_COEFFICIENT);
  });

  it('refuses a draft multiplier outside (0, 1]', () => {
    for (const k of [0, -0.5, 1.01, Number.NaN]) {
      expect(() => ridingConditions(kilograms(70), 'hoods', k)).toThrow(PhysicsError);
    }
  });

  it('is the ISO 2533 sea-level density, which pow(1, y) makes exact on every engine', () => {
    expect(SEA_LEVEL_AIR_DENSITY).toBeCloseTo(1.225, 3);
  });
});
