// SPDX-License-Identifier: Apache-2.0

/** The AI group ride's rules (epic #3296, ADR 0101 proposed): platform-free, seeded, per decision window. */

export type { GroupRideErrorCode } from './errors';
export { GroupRideError } from './errors';

// The line's phases and each member's role (#3299): closed lists, exhaustive switches.
export type { LinePhase, LineSeats, RiderRole } from './roles';
export { asideRole, isLineRole, LINE_PHASES, lineRoles, RIDER_ROLES } from './roles';

// The paceline rotation for one line (#3299): who is on the front, the pull,
// the pull-off, the drift back and the latch. Roles, speeds and facts out;
// nothing reaches a trainer.
export type {
  LineMember,
  MemberView,
  RotationPull,
  RotationRequest,
  RotationSetup,
  RotationState,
  RotationStep,
  RotationView,
} from './rotation';
export {
  ROTATION_BEND_RADIUS_METRES,
  ROTATION_BOT_PULL_MS,
  ROTATION_CLIMB_HOLD_METRES,
  ROTATION_EASE_SHARE,
  ROTATION_FADE_DWELL_MS,
  ROTATION_FADE_MARGIN_MPS,
  ROTATION_FORMING_MOST_MS,
  ROTATION_LINE_LEAST,
  ROTATION_LINE_MOST,
  ROTATION_PULL_STRENGTH_LEAST,
  ROTATION_PULL_STRENGTH_MOST,
  ROTATION_PULL_VARIATION,
  ROTATION_RIDER_GRACE_MS,
  ROTATION_RIDER_PULL_MS,
  ROTATION_TIRED_WBAL_SHARE,
  ROTATION_WHEEL_BAND_METRES,
  ROTATION_WINDOW_MS,
  startRotation,
  stepRotation,
} from './rotation';
