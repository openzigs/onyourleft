// SPDX-License-Identifier: Apache-2.0

/**
 * The compression layer on its own, and in particular its **bound**.
 *
 * `stream-store.test.ts` proves the bound through the public read path. This
 * file proves it where it is implemented, because the store-level assertion
 * alone cannot separate "refused while inflating" from "inflated a megabyte and
 * then found the length wrong" — and the whole value of the bound is that the
 * megabyte is never allocated.
 */

import { describe, expect, it } from 'vitest';

import { compressStreamBytes, decompressStreamBytes, StreamSizeError } from './stream-compression';

/** Bytes that are not compressible, so the round trip is not a trivial one. */
function noise(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  let state = 1;
  for (let index = 0; index < length; index += 1) {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    bytes[index] = state & 0xff;
  }
  return bytes;
}

describe('the round trip', () => {
  it('returns exactly the bytes it was given', async () => {
    const original = noise(10_000);

    const back = await decompressStreamBytes(
      await compressStreamBytes(original),
      original.byteLength,
    );

    expect(back).toEqual(original);
  });

  it('handles an empty array', async () => {
    expect(await decompressStreamBytes(await compressStreamBytes(new Uint8Array(0)), 0)).toEqual(
      new Uint8Array(0),
    );
  });

  it('compresses bytes that are worth compressing', async () => {
    const compressible = new Uint8Array(100_000);
    expect((await compressStreamBytes(compressible)).byteLength).toBeLessThan(1_000);
  });
});

describe('the bound — a deflate stream expands by up to about a thousand to one', () => {
  it('refuses to inflate past the limit it was given', async () => {
    const bomb = await compressStreamBytes(new Uint8Array(1_000_000));

    await expect(decompressStreamBytes(bomb, 8)).rejects.toThrow(StreamSizeError);
    await expect(decompressStreamBytes(bomb, 8)).rejects.toThrow(
      /expand to more than the 8 bytes this row declares/,
    );
  });

  it('the same bytes inflate cleanly when the limit is the size they really are', async () => {
    // So the case above is about the limit and not about the bytes.
    const bomb = await compressStreamBytes(new Uint8Array(1_000_000));

    expect((await decompressStreamBytes(bomb, 1_000_000)).byteLength).toBe(1_000_000);
  });

  it('accepts output that is exactly the limit', async () => {
    const original = noise(1_000);

    expect(
      (await decompressStreamBytes(await compressStreamBytes(original), 1_000)).byteLength,
    ).toBe(1_000);
  });

  it('refuses output one byte over the limit', async () => {
    const original = noise(1_000);

    await expect(decompressStreamBytes(await compressStreamBytes(original), 999)).rejects.toThrow(
      StreamSizeError,
    );
  });
});

describe('bytes that are not a deflate stream', () => {
  it('reject rather than returning nothing', async () => {
    await expect(decompressStreamBytes(new Uint8Array([1, 2, 3, 4, 5]), 1_000)).rejects.toThrow();
  });

  it('reject when truncated part way through', async () => {
    const compressed = await compressStreamBytes(noise(5_000));

    await expect(
      decompressStreamBytes(compressed.slice(0, compressed.byteLength - 10), 5_000),
    ).rejects.toThrow();
  });
});
