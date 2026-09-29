// SPDX-License-Identifier: Apache-2.0

/**
 * What this package states that `@onyourleft/physics` also states.
 *
 * This package has no production dependency at all, so it cannot import the
 * physics version, the riding positions or the power ceiling; a room passes
 * the version in, and the two bounds are restated. This file is where they are
 * held equal — `@onyourleft/physics` is a **devDependency**, read only here —
 * so a moved constant is a red build rather than a wire that refuses what the
 * room would admit.
 */

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PLAUSIBILITY_LIMITS,
  PHYSICS_VERSION,
  RIDING_POSITION_DRAG_AREAS,
} from '@onyourleft/physics';

import { decodeClientMessage, encodeMessage } from './codec';
import { PROTOCOL_VERSION } from './messages';
import { MAXIMUM_REPORTED_POWER_WATTS, MESSAGE_FIELDS } from './schema';

describe('agreement with @onyourleft/physics', () => {
  it('bounds a reported power where the room’s admissibility rule does', () => {
    expect(MAXIMUM_REPORTED_POWER_WATTS).toBe(DEFAULT_PLAUSIBILITY_LIMITS.maximumPowerWatts);
  });

  it('offers exactly the riding positions the physics has drag areas for', () => {
    expect(
      [...MESSAGE_FIELDS.welcome.roomConfig.shape.fields.ridingPosition.shape.values].sort(),
    ).toEqual(Object.keys(RIDING_POSITION_DRAG_AREAS).sort());
  });

  it('shakes hands with the physics version this build ships', () => {
    const hello = encodeMessage({
      type: 'hello',
      protocol: PROTOCOL_VERSION,
      physicsVersion: PHYSICS_VERSION,
      ticket: 't',
    });
    expect(decodeClientMessage(hello, { physicsVersion: PHYSICS_VERSION }).ok).toBe(true);
  });
});
