// SPDX-License-Identifier: Apache-2.0

/**
 * A growable little-endian byte sink.
 *
 * ## Why the encoder owns one buffer rather than a list of chunks
 *
 * [#127](https://github.com/openzigs/onyourleft/issues/127) is the decoder
 * retaining ~354 MiB from a 4.39 MiB file, and #31's revision block asks that
 * the encoder not be made worse in the same way: *"a writer that builds the
 * whole file in memory before emitting has the same shape"*.
 *
 * A FIT file's header carries the **size of the data section**, which is not
 * known until the data has been written, and its last two bytes are a CRC over
 * everything before them. So a single-pass writer that emits as it goes is not
 * available without a second pass over the data — and the return type of
 * `encodeFitActivity` is a `Uint8Array`, so the whole file exists at once
 * regardless.
 *
 * What is available, and what this does, is to keep the *overhead* bounded:
 *
 * - one buffer, doubled when it fills, rather than a list of per-message arrays
 *   whose combined retention is unbounded in the number of messages;
 * - the header's fourteen bytes are reserved up front and back-filled, so the
 *   data is never copied to make room for it;
 * - {@link ByteSink.take} returns an **exactly sized copy** rather than a
 *   `subarray`. A `subarray` of a buffer grown to the next power of two keeps
 *   that whole buffer alive behind a view of half of it, which is #127's shape
 *   precisely. The copy costs one pass and releases the slack.
 *
 * Peak retention is therefore about twice the finished file during the final
 * copy, and exactly the finished file afterwards.
 */

/** The smallest buffer the sink starts with. */
const MINIMUM_CAPACITY = 64;

export class ByteSink {
  #bytes: Uint8Array;
  #view: DataView;
  #length = 0;

  /**
   * @param capacityHint the expected finished size. A hint only — the sink
   * grows past it — but a good one avoids every copy on the way there, which
   * is why {@link encodeFitActivity} estimates it from the record count rather
   * than starting at zero and doubling twenty times.
   */
  constructor(capacityHint = MINIMUM_CAPACITY) {
    const capacity = Math.max(MINIMUM_CAPACITY, Math.ceil(capacityHint));
    this.#bytes = new Uint8Array(capacity);
    this.#view = new DataView(this.#bytes.buffer);
  }

  /** How many bytes have been written. */
  get length(): number {
    return this.#length;
  }

  #reserve(extra: number): void {
    const needed = this.#length + extra;
    if (needed <= this.#bytes.length) return;
    let capacity = this.#bytes.length;
    while (capacity < needed) capacity *= 2;
    const grown = new Uint8Array(capacity);
    grown.set(this.#bytes.subarray(0, this.#length));
    this.#bytes = grown;
    this.#view = new DataView(grown.buffer);
  }

  /** Advance by `count` zero bytes, for a field to be back-filled later. */
  skip(count: number): this {
    this.#reserve(count);
    this.#length += count;
    return this;
  }

  u8(value: number): this {
    this.#reserve(1);
    this.#view.setUint8(this.#length, value);
    this.#length += 1;
    return this;
  }

  i8(value: number): this {
    this.#reserve(1);
    this.#view.setInt8(this.#length, value);
    this.#length += 1;
    return this;
  }

  u16(value: number): this {
    this.#reserve(2);
    this.#view.setUint16(this.#length, value, true);
    this.#length += 2;
    return this;
  }

  i16(value: number): this {
    this.#reserve(2);
    this.#view.setInt16(this.#length, value, true);
    this.#length += 2;
    return this;
  }

  u32(value: number): this {
    this.#reserve(4);
    this.#view.setUint32(this.#length, value, true);
    this.#length += 4;
    return this;
  }

  i32(value: number): this {
    this.#reserve(4);
    this.#view.setInt32(this.#length, value, true);
    this.#length += 4;
    return this;
  }

  /** Append raw bytes verbatim. */
  raw(bytes: Uint8Array): this {
    this.#reserve(bytes.length);
    this.#bytes.set(bytes, this.#length);
    this.#length += bytes.length;
    return this;
  }

  /** Overwrite a `uint32` already written, for the header's data size. */
  patchU32(offset: number, value: number): this {
    this.#view.setUint32(offset, value, true);
    return this;
  }

  /** Overwrite a `uint16` already written, for the header's own CRC. */
  patchU16(offset: number, value: number): this {
    this.#view.setUint16(offset, value, true);
    return this;
  }

  /**
   * A read-only view of what has been written so far.
   *
   * For computing a CRC over bytes that are still going to be appended to.
   * Invalidated by the next write that grows the buffer, so it is never held.
   */
  written(): Uint8Array {
    return this.#bytes.subarray(0, this.#length);
  }

  /** The finished bytes, as an exactly sized copy. See the module comment. */
  take(): Uint8Array {
    return this.#bytes.slice(0, this.#length);
  }
}
