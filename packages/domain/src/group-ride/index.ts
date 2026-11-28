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
  ROTATION_CATCH_UP_SHARE,
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
  ROTATION_RIDER_WHEEL_BAND_METRES,
  ROTATION_TIRED_WBAL_SHARE,
  ROTATION_WHEEL_BAND_METRES,
  ROTATION_WINDOW_MS,
  startRotation,
  stepRotation,
} from './rotation';

// The climb the front is told of (#3348): 0 from a climb's start to its crest,
// which `courseHillsAhead` alone stops reporting 200 m before the top.
export { LINE_CLIMB_EASED_METRES, LINE_CLIMB_EASING_METRES, lineClimbAheadM } from './climb-ahead';

// The rider's cue (#3302): at most one a window, events said once,
// corrections out of band for a dwell and rate limited. Kinds, never
// sentences; none urges more effort, and none carries a power.
export type {
  Cue,
  CueAsk,
  CueCorrectionKind,
  CueEventKind,
  CueKind,
  CueState,
  CueStep,
  CueView,
  PendingCue,
} from './cues';
export {
  CUE_ASK,
  CUE_ASKS,
  CUE_CEILING_PER_MINUTE,
  CUE_CLIMB_AHEAD_METRES,
  CUE_CORRECTION_GAP_MS,
  CUE_CORRECTION_KINDS,
  CUE_EASED_DWELL_MS,
  CUE_EASED_METRES,
  CUE_EVENT_KINDS,
  CUE_GAP_DWELL_MS,
  CUE_GAP_METRES,
  CUE_KINDS,
  CUE_LAST_WHEEL_METRES,
  CUE_PAST_FRONT_DWELL_MS,
  CUE_SAME_CORRECTION_MOST,
  CUE_SHORTER_PULL_SHARE,
  CUE_SURGE_DWELL_MS,
  CUE_SURGE_MPS,
  CUE_TIME_CRITICAL,
  startCues,
  stepCues,
} from './cues';

// The group stepped through the one physics (#3300): the plan's power on the
// front, the lap race's wheel rule behind it, one draft call for every rider.
// The rider is read and never written; the physics is the caller's.
export type {
  GroupBot,
  GroupPhysics,
  GroupRideInput,
  GroupRideSetup,
  GroupRideState,
  GroupRideTick,
  GroupRoad,
} from './step';
export { startGroupRide, stepGroupRide } from './step';
