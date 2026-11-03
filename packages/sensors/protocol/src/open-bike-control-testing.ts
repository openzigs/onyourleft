// SPDX-License-Identifier: Apache-2.0

/**
 * Synthetic OpenBikeControl fixtures (#1822): hand-built byte arrays, each
 * named for what it holds. None is a capture from a real device, and none
 * needs one. Test support only (`*-testing.ts`): nothing shipped imports it.
 */

/** A notification's bytes as the `DataView` a transport hands over. */
export function notification(bytes: readonly number[]): DataView {
  return new DataView(Uint8Array.from(bytes).buffer);
}

export const STEER_LEFT_PRESSED = [0x01, 0x18, 0x01] as const;
export const STEER_LEFT_RELEASED = [0x01, 0x18, 0x00] as const;
export const STEER_RIGHT_PRESSED = [0x01, 0x19, 0x01] as const;
/** 10° left: 0x80 - 20 half-degree steps. */
export const ANGLE_TEN_DEGREES_LEFT = [0x01, 0x1b, 0x6c] as const;
/** 10° right: 0x80 + 20 half-degree steps. */
export const ANGLE_TEN_DEGREES_RIGHT = [0x01, 0x1b, 0x94] as const;
export const ANGLE_STRAIGHT_AHEAD = [0x01, 0x1b, 0x80] as const;
export const ANGLE_FULL_LEFT = [0x01, 0x1b, 0x02] as const;
export const ANGLE_FULL_RIGHT = [0x01, 0x1b, 0xfe] as const;
export const ANGLE_UNAVAILABLE = [0x01, 0x1b, 0x00] as const;
/** 0x01 and 0xFF are no-op angle codes. */
export const ANGLE_NO_OP_LOW = [0x01, 0x1b, 0x01] as const;
export const ANGLE_NO_OP_HIGH = [0x01, 0x1b, 0xff] as const;
/** Steer left pressed, with a 10° left angle beside it in the same message. */
export const STEER_LEFT_WITH_ANGLE = [0x01, 0x18, 0x01, 0x1b, 0x6c] as const;
/** The same, angle first. */
export const ANGLE_THEN_STEER_LEFT = [0x01, 0x1b, 0x6c, 0x18, 0x01] as const;
/** Steer left pressed, with "no angle available" beside it: the steer still counts. */
export const STEER_LEFT_WITH_ANGLE_UNAVAILABLE = [0x01, 0x18, 0x01, 0x1b, 0x00] as const;
/** A manufacturer-specific id (0xA7) pressed: unknown to this codec. */
export const UNKNOWN_BUTTON_PRESSED = [0x01, 0xa7, 0x01] as const;
/** Shift up pressed and shift down released in one message. */
export const TWO_BUTTONS = [0x01, 0x01, 0x01, 0x02, 0x00] as const;
/** An analog value (0x80) on navigation up. */
export const ANALOG_BUTTON = [0x01, 0x10, 0x80] as const;

export const EMPTY = [] as const;
/** Only the message type, no pairs. */
export const ONE_BYTE = [0x01] as const;
/** The haptic message type where a button state belongs. */
export const UNKNOWN_MESSAGE_TYPE = [0x03, 0x18, 0x01] as const;
/** A button id with no state after it. */
export const ODD_LENGTH = [0x01, 0x18, 0x01, 0x19] as const;
