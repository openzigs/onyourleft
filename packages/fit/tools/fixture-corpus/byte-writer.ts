// SPDX-License-Identifier: Apache-2.0

/**
 * A growable little-endian byte buffer.
 *
 * Every fixture in this corpus declares little-endian architecture in its
 * definition messages, so every multi-byte write here is little-endian and
 * there is no endianness argument to get wrong. A big-endian fixture would be a
 * worthwhile addition for #30 and is deliberately not in this corpus — see
 * `fixtures/README.md`, "What this corpus does not cover".
 *
 * `offset` is public because the ADR 0004 decision G guard needs to know where
 * in the finished file each position field landed, so it can read the position
 * back out of the committed bytes rather than trusting what the generator
 * believed it wrote.
 */
export class ByteWriter {
  #bytes: number[] = [];

  /** The number of bytes written so far, which is the offset of the next one. */
  get offset(): number {
    return this.#bytes.length;
  }

  u8(value: number): this {
    assertIntegerInRange(value, 0, 0xff, 'uint8');
    this.#bytes.push(value);
    return this;
  }

  i8(value: number): this {
    assertIntegerInRange(value, -0x80, 0x7f, 'sint8');
    this.#bytes.push(value & 0xff);
    return this;
  }

  u16(value: number): this {
    assertIntegerInRange(value, 0, 0xffff, 'uint16');
    this.#bytes.push(value & 0xff, (value >>> 8) & 0xff);
    return this;
  }

  i16(value: number): this {
    assertIntegerInRange(value, -0x8000, 0x7fff, 'sint16');
    this.#bytes.push(value & 0xff, (value >>> 8) & 0xff);
    return this;
  }

  u32(value: number): this {
    assertIntegerInRange(value, 0, 0xffffffff, 'uint32');
    this.#bytes.push(
      value & 0xff,
      (value >>> 8) & 0xff,
      (value >>> 16) & 0xff,
      (value >>> 24) & 0xff,
    );
    return this;
  }

  i32(value: number): this {
    assertIntegerInRange(value, -0x80000000, 0x7fffffff, 'sint32');
    this.#bytes.push(
      value & 0xff,
      (value >>> 8) & 0xff,
      (value >>> 16) & 0xff,
      (value >>> 24) & 0xff,
    );
    return this;
  }

  raw(values: readonly number[] | Uint8Array): this {
    for (const value of values) {
      this.u8(value);
    }
    return this;
  }

  /**
   * A fixed-width, NUL-padded ASCII string, which is how the FIT `string` base
   * type is written when its declared size exceeds the text.
   *
   * ASCII only, and it throws rather than transcoding: a UTF-8 fixture would be
   * a good addition to the corpus and it would be a deliberate one, not a
   * by-product of somebody pasting an accented character into a device name.
   */
  asciiString(text: string, size: number): this {
    if (text.length + 1 > size) {
      throw new RangeError(`string ${JSON.stringify(text)} does not fit in ${String(size)} bytes`);
    }
    for (let index = 0; index < size; index += 1) {
      const code = index < text.length ? text.charCodeAt(index) : 0;
      if (code > 0x7f) {
        throw new RangeError(`string ${JSON.stringify(text)} is not ASCII`);
      }
      this.#bytes.push(code);
    }
    return this;
  }

  toUint8Array(): Uint8Array {
    return Uint8Array.from(this.#bytes);
  }
}

function assertIntegerInRange(value: number, min: number, max: number, what: string): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(
      `${what} must be a whole number between ${String(min)} and ${String(max)}, received ${String(value)}`,
    );
  }
}
