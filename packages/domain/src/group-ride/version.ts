// SPDX-License-Identifier: Apache-2.0

/**
 * The version of the group ride's rules a ride was ridden under — #3303, epic
 * #3296, ADR 0101: kept with the ride (`@onyourleft/store`
 * §`RideFacts.groupRide`) beside its seed, so a ride is replayed under the
 * rules it was ridden with, as a race with AI bots is (ADR 0071 D-4.4).
 *
 * **Raise it with any change to what the line decides or how a bot rides**:
 * the plan (`plan.ts`), the rotation (`rotation.ts`), no-drop (`no-drop.ts`),
 * the step (`step.ts`), or the group's make-up where the ride builds it.
 */
export const GROUP_RIDE_CODE_VERSION = 1;
