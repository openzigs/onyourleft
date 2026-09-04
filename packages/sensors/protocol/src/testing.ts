// SPDX-License-Identifier: Apache-2.0

/**
 * Building captured byte arrays by hand, for the tests in this directory.
 *
 * #41 and #42 both require that *"all tests run from captured byte arrays with
 * no hardware attached"*. A builder rather than literal arrays because a
 * flags-driven packet's whole difficulty is that a field's offset depends on
 * which fields precede it: writing `new Uint8Array([0x30, 0x4b, …])` by hand
 * means computing those offsets in the test, with the same arithmetic the
 * decoder is being tested for, and a shared mistake cancels out invisibly.
 *
 * So the builder appends and the decoder walks, and the two meet in the middle
 * without either knowing an offset. It is the encoder half of each
 * characteristic, which `src/simulator/profiles.ts` says belongs beside the
 * decoder for exactly this reason.
 *
 * **Not exported from `index.ts`.** It is a test fixture, not a product: the
 * program has no reason to encode a Cycling Power Measurement, and a published
 * encoder is one a later issue would reach for instead of the specification.
 */

/** Little-endian, append-only, the mirror of `PayloadReader`. */
export interface PayloadWriter {
  u8(value: number): PayloadWriter;
  u16(value: number): PayloadWriter;
  u24(value: number): PayloadWriter;
  u32(value: number): PayloadWriter;
  i16(value: number): PayloadWriter;
  /** The bytes so far. */
  bytes(): Uint8Array;
  /** The bytes so far, as the `DataView` a transport would hand a decoder. */
  view(): DataView;
}

export function createPayloadWriter(): PayloadWriter {
  const octets: number[] = [];
  const writer: PayloadWriter = {
    u8(value) {
      octets.push(value & 0xff);
      return writer;
    },
    u16(value) {
      octets.push(value & 0xff, (value >>> 8) & 0xff);
      return writer;
    },
    u24(value) {
      octets.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff);
      return writer;
    },
    u32(value) {
      octets.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
      return writer;
    },
    i16(value) {
      return writer.u16(value < 0 ? value + 0x1_0000 : value);
    },
    bytes: () => Uint8Array.from(octets),
    view: () => {
      const bytes = Uint8Array.from(octets);
      return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    },
  };
  return writer;
}

/** Flags built from bit indices, so a test names bits rather than hex. */
export function flagsOf(...bits: readonly number[]): number {
  return bits.reduce((flags, bit) => flags | (1 << bit), 0);
}
