// SPDX-License-Identifier: Apache-2.0

/**
 * The coefficient set a ride runs — ADR 0028 D-1's table, and #487's constant
 * move.
 */

import { describe, expect, it } from 'vitest';

import { MARTIN_1998_COEFFICIENTS, withDefaultCoefficients } from './coefficients';
import {
  RIDING_POSITION_DRAG_AREAS,
  ridingCoefficients,
  ROAD_ROLLING_RESISTANCE_COEFFICIENT,
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
