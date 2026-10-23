// SPDX-License-Identifier: Apache-2.0

/**
 * A bounded protocol-buffer reader: just enough of the wire format for the
 * Mapbox Vector Tile schema, and nothing that reads past the end.
 *
 * ## Why our own rather than `pbf`
 *
 * #1544 admits `pbf` 5.1.2 or a reader of our own. `pbf`'s reader indexes its
 * buffer without a bounds check — a truncated varint reads `undefined`, which
 * `& 0x7f` turns into `0`, and the read carries on past the end with a
 * plausible number — so every read through it would need a position check
 * after it. Owning the reader puts the check in one place: every method here
 * either returns a value that lies wholly inside `[start, end)` or throws
 * {@link Malformed}, which `decode.ts` turns into a refusal. Nothing outside
 * this package ever sees the throw.
 *
 * Written from the protocol-buffers encoding documentation
 * (protobuf.dev/programming-guides/encoding); nothing was copied from an
 * implementation.
 */

/** The reader's one failure. Caught by `decodeTile`, never thrown out of the package. */
export class Malformed extends Error {
  constructor() {
    super('malformed protocol buffer');
  }
}

export const WIRE_VARINT = 0;
export const WIRE_FIXED64 = 1;
export const WIRE_BYTES = 2;
export const WIRE_FIXED32 = 5;

export class ProtoReader {
  pos: number;

  constructor(
    readonly buf: Uint8Array,
    start: number,
    readonly end: number,
  ) {
    this.pos = start;
  }

  atEnd(): boolean {
    return this.pos >= this.end;
  }

  /**
   * An unsigned 32-bit varint: at most five bytes, and a fifth byte that fits.
   * Every tag, length, count and geometry integer in the schema is one.
   */
  uint32(): number {
    // Unrolled: this is the decoder's inner loop, two calls a vertex.
    const buf = this.buf;
    const end = this.end;
    let pos = this.pos;
    if (pos >= end) throw new Malformed();
    let byte = buf[pos++] as number;
    let value = byte & 0x7f;
    if (byte < 0x80) {
      this.pos = pos;
      return value;
    }
    for (let shift = 7; shift < 28; shift += 7) {
      if (pos >= end) throw new Malformed();
      byte = buf[pos++] as number;
      value |= (byte & 0x7f) << shift;
      if (byte < 0x80) {
        this.pos = pos;
        return value;
      }
    }
    if (pos >= end) throw new Malformed();
    byte = buf[pos++] as number;
    if (byte > 0x0f) throw new Malformed();
    this.pos = pos;
    return value + byte * 2 ** 28;
  }

  /**
   * A varint of up to ten bytes as a `number`. Exact to 2^53; above that it
   * loses precision, which no field this package keeps can reach.
   */
  uint64(): number {
    let value = 0;
    for (let shift = 0; shift < 70; shift += 7) {
      if (this.pos >= this.end) throw new Malformed();
      const byte = this.buf[this.pos++] as number;
      value += (byte & 0x7f) * 2 ** shift;
      if (byte < 0x80) return value;
    }
    throw new Malformed();
  }

  /**
   * Skips `count` varints without decoding them: each ends at its first byte
   * under 0x80, so this counts those bytes and does no arithmetic. The
   * counting pass's inner loop. A varint too long to be a `uint32` is left for
   * the decoding pass to refuse.
   */
  skipVarints(count: number): void {
    const buf = this.buf;
    const end = this.end;
    let pos = this.pos;
    let left = count;
    while (left > 0 && pos < end) {
      if ((buf[pos++] as number) < 0x80) left--;
    }
    if (left > 0) throw new Malformed();
    this.pos = pos;
  }

  /** A two's-complement `int64` varint, as a `number`. */
  int64(): number {
    const raw = this.uint64();
    return raw >= 2 ** 63 ? raw - 2 ** 64 : raw;
  }

  /** A zig-zag `sint64` varint, as a `number`. */
  sint64(): number {
    const raw = this.uint64();
    return raw % 2 === 0 ? raw / 2 : -(raw + 1) / 2;
  }

  /** A length prefix and the `[start, end)` it encloses, checked against this message's end. */
  bytes(): { readonly start: number; readonly end: number } {
    const length = this.uint32();
    const start = this.pos;
    if (length > this.end - start) throw new Malformed();
    this.pos = start + length;
    return { start, end: start + length };
  }

  fixed32Float(): number {
    if (this.end - this.pos < 4) throw new Malformed();
    const view = new DataView(this.buf.buffer, this.buf.byteOffset + this.pos, 4);
    this.pos += 4;
    return view.getFloat32(0, true);
  }

  fixed64Double(): number {
    if (this.end - this.pos < 8) throw new Malformed();
    const view = new DataView(this.buf.buffer, this.buf.byteOffset + this.pos, 8);
    this.pos += 8;
    return view.getFloat64(0, true);
  }

  /** Skips one field's value by its wire type. Groups (3, 4) and unknown types are malformed. */
  skip(wireType: number): void {
    switch (wireType) {
      case WIRE_VARINT:
        this.uint64();
        return;
      case WIRE_FIXED64:
        if (this.end - this.pos < 8) throw new Malformed();
        this.pos += 8;
        return;
      case WIRE_BYTES:
        this.bytes();
        return;
      case WIRE_FIXED32:
        if (this.end - this.pos < 4) throw new Malformed();
        this.pos += 4;
        return;
      default:
        throw new Malformed();
    }
  }
}

/** Whether `buf[start, end)` holds exactly the ASCII bytes of `text`. Compares; never decodes. */
export function bytesEqualAscii(
  buf: Uint8Array,
  start: number,
  end: number,
  text: string,
): boolean {
  if (end - start !== text.length) return false;
  for (let i = 0; i < text.length; i++) {
    if (buf[start + i] !== text.charCodeAt(i)) return false;
  }
  return true;
}
