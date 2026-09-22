// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The hash every seeded, stateless placement in the world draws from.
 *
 * ⚠️ **Moved here out of `scatter.ts` by #458, unchanged to the bit**, because
 * since then three files place things by *"a hash of where you are"* — the
 * scenery (`scatter.ts`), the landform beside the road (`landform.ts`) and the
 * water and settlements that stand on it (`waterways.ts`, `settlements.ts`).
 * One copy of the arithmetic is one answer to "is this place the same on lap
 * two"; three copies would be three. `arrangement-unchanged.test.ts`' digest,
 * which did not move with the move, is the evidence that nothing here changed.
 *
 * {@link fmix32} is MurmurHash3's 32-bit finaliser, Austin Appleby, **placed in
 * the public domain by its author** — arithmetic, and the one piece of this
 * file that is anybody else's idea. It carries no licence obligation.
 */

/** An odd multiplier, so that `stream` reaches a different part of the hash. */
const STREAM_STRIDE = 0x9e37_79b1;

/** `2³²`, for turning a `uint32` into a number in `[0, 1)`. */
const UINT32_SCALE = 0x1_0000_0000;

/**
 * MurmurHash3's 32-bit finaliser.
 *
 * Used rather than a bespoke mix because avalanche behaviour is a property that
 * is hard to get right and easy to get subtly wrong, and a weak mix here shows
 * up as scenery that visibly repeats.
 */
export function fmix32(value: number): number {
  let mixed = value >>> 0;
  mixed ^= mixed >>> 16;
  mixed = Math.imul(mixed, 0x85eb_ca6b);
  mixed ^= mixed >>> 13;
  mixed = Math.imul(mixed, 0xc2b2_ae35);
  mixed ^= mixed >>> 16;
  return mixed >>> 0;
}

/** Fold one integer into a running hash. */
export function mixInto(running: number, value: number): number {
  return fmix32((running ^ Math.imul(value | 0, STREAM_STRIDE)) >>> 0);
}

/** The hash of one slot: the route's seed, a cell, and which slot in it. */
export function slotHash(seed: number, cell: number, slot: number): number {
  return mixInto(mixInto(seed, cell), slot);
}

/**
 * One uniform number in `[0, 1)` from a slot's hash.
 *
 * ⚠️ Each quantity an item needs draws from its **own** stream. Reusing one
 * hash for two of them correlates them — every tall tree would also be a rotated
 * one — and the correlation is invisible in a unit test and obvious on screen.
 */
export function uniformFrom(base: number, stream: number): number {
  return fmix32((base ^ Math.imul(stream + 1, STREAM_STRIDE)) >>> 0) / UINT32_SCALE;
}
