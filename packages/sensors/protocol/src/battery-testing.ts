// SPDX-License-Identifier: Apache-2.0

/**
 * Synthetic Battery Level fixtures (#2046): hand-built byte arrays, each named
 * for what it holds. None is a capture from a real device, and none needs one.
 * Test support only (`*-testing.ts`): nothing shipped imports it.
 */

/** A value's bytes as the `DataView` a transport hands over. */
export function batteryValue(bytes: readonly number[]): DataView {
  return new DataView(Uint8Array.from(bytes).buffer);
}

/** A valid one-octet level: 37 %. */
export const LEVEL_37 = [0x25] as const;
/** The empty battery and the full one, the two ends of the scale. */
export const LEVEL_EMPTY_BATTERY = [0x00] as const;
export const LEVEL_FULL = [0x64] as const;
/** No octets at all. */
export const EMPTY_PAYLOAD = [] as const;
/** Two octets: not this characteristic, even though the first is a valid level. */
export const TWO_BYTE_PAYLOAD = [0x25, 0x00] as const;
/** 101: one past full. */
export const LEVEL_101 = [0x65] as const;
/** 255: the top of the `uint8`. */
export const LEVEL_255 = [0xff] as const;
