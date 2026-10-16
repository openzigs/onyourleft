// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The draft gauge's full scale — #787, from #327's indicator criterion: *"Its
 * full scale is the maximum draft available at this moment, and the
 * full-scale mark is drawn … If the scale is instead the theoretical maximum,
 * the gauge says so."*
 *
 * ## The theoretical maximum, and the field says so
 *
 * "The maximum available at this moment" depends on where every other rider
 * could be, which nothing on this device knows and the room does not send. So
 * the scale is the MODEL's maximum: the deepest chain at the closest gap
 * (ADR 0038 D-3.1's smallest `k_behind`) with a rider tight behind as well
 * (D-3.2's smallest `k_ahead_of`), which is the middle of a long, tight line.
 * It is read off `@onyourleft/physics`' own table rather than written here, so
 * a new `physicsVersion` with a new table moves the mark with it.
 *
 * `fields.ts` §`draftField` puts the number in words beside the gauge, so the
 * scale is stated and not only drawn.
 */

import { DRAFT_TABLE } from '@onyourleft/physics';

const smallest = (row: readonly number[]): number => Math.min(...row);

/**
 * The most of a rider's aerodynamic drag any draft in the model removes, in
 * whole percent: `(1 − min k_behind × min k_ahead_of) × 100`, rounded.
 */
export const DRAFT_FULL_SCALE_PERCENT = Math.round(
  (1 - smallest(DRAFT_TABLE.trailing.map(smallest)) * smallest(DRAFT_TABLE.leading)) * 100,
);
