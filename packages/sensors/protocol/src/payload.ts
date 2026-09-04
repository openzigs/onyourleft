// SPDX-License-Identifier: Apache-2.0

/**
 * The one way this package reads a byte off a GATT notification.
 *
 * ## Why a reader rather than `view.getUint16(offset, true)` at call sites
 *
 * Every characteristic decoded here is **flags-driven and variable length**:
 * the flags field says which fields follow, and each present field shifts the
 * offset of every field after it. Written as literal offsets that is correct
 * only for the flag combination the author's own sensor happens to send, which
 * is the trap #42 names in full. A cursor that advances itself cannot get the
 * arithmetic wrong, because there is no arithmetic to get wrong.
 *
 * ## Every read is bounds-checked, and the failure is typed
 *
 * `SECURITY.md` and CLAUDE.md §6 are explicit that sensor data is untrusted
 * input: a malformed or hostile payload comes from a device that may not be
 * what it claims, and the obvious attack on a flags-gated packet is a flag
 * claiming a field the buffer does not contain. `DataView` already refuses to
 * read past its end — but it refuses with a bare `RangeError`, which is
 * indistinguishable from a bug in this package and carries nothing a caller can
 * branch on. Every read below checks first and raises
 * `SensorError('malformed-payload')`, the same posture the FIT decoder (#125)
 * took for the same class of input.
 *
 * **`byteOffset` is honoured.** A `DataView` handed over by Web Bluetooth is
 * frequently a window onto a larger, reused buffer rather than a view starting
 * at zero, so every read goes through the view's own accessors and every bound
 * is measured against `byteLength`. Reading `view.buffer` directly would step
 * outside the notification and into whatever the browser put next to it.
 *
 * **Little-endian, always.** The Bluetooth Core Specification transmits
 * multi-octet characteristic fields least significant octet first; there is no
 * big-endian field in any characteristic this package reads, so the flag is not
 * a parameter anyone could pass wrongly.
 */

import { SensorError } from '../../src/errors';

/** Raise the one error a decoder is allowed to fail with. */
export function malformedPayload(message: string, cause?: unknown): SensorError {
  return new SensorError('malformed-payload', message, cause === undefined ? undefined : { cause });
}

/**
 * A cursor over one notification.
 *
 * Deliberately not reusable across notifications: it is three numbers and a
 * closure, allocated once per decode. #40's hot-path budget is about not
 * allocating **per field**; one small object per notification is what a
 * bounds-checked decode costs, and `hot-path.test.ts` measures the sink and
 * handler identities rather than this.
 */
export interface PayloadReader {
  /** How many octets are left unread. */
  remaining(): number;
  /** `uint8`. */
  u8(field: string): number;
  /** `uint16`, least significant octet first. */
  u16(field: string): number;
  /** `uint24`, least significant octet first. */
  u24(field: string): number;
  /** `uint32`, least significant octet first. */
  u32(field: string): number;
  /** `sint16`, least significant octet first, two's complement. */
  i16(field: string): number;
  /** Step over `octets` without interpreting them. */
  skip(octets: number, field: string): void;
}

export function createPayloadReader(view: DataView, what: string): PayloadReader {
  let offset = 0;

  const take = (octets: number, field: string): number => {
    if (offset + octets > view.byteLength) {
      throw malformedPayload(
        `${what} claims a ${field} at octet ${String(offset)} but carries only ${String(
          view.byteLength,
        )} octets`,
      );
    }
    const at = offset;
    offset += octets;
    return at;
  };

  return {
    remaining: () => view.byteLength - offset,
    u8: (field) => view.getUint8(take(1, field)),
    u16: (field) => view.getUint16(take(2, field), true),
    u24: (field) => {
      const at = take(3, field);
      return view.getUint8(at) | (view.getUint8(at + 1) << 8) | (view.getUint8(at + 2) << 16);
    },
    u32: (field) => view.getUint32(take(4, field), true),
    i16: (field) => view.getInt16(take(2, field), true),
    skip: (octets, field) => {
      take(octets, field);
    },
  };
}

/** Whether bit `index` of a flags field is set. */
export function flagSet(flags: number, index: number): boolean {
  // `& 1` rather than a truthiness test on the shifted value: bit 31 of a
  // 32-bit feature field shifts into the sign bit, and `flags & (1 << 31)` is
  // negative-but-truthy only by accident of two's complement. Shifting right
  // and masking is correct for every index this package uses.
  return ((flags >>> index) & 1) === 1;
}
