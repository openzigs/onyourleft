// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A village's litter — #1274, the owner's ruling of 2026-11-05: Poly Haven's
 * CC0 `trashbag` and `old_tyre`, scattered sparsely, **in villages only**,
 * and folded into a batch the frame already draws.
 *
 * ## Where it lies — from the street's own furniture, never a new placement
 *
 * Every piece is placed from a piece of street furniture `streets.ts`
 * already stands on a village's pavement (#1536), its **anchor**:
 *
 * - a **bag** beside a bin, {@link LITTER_BAG_BESIDE_METRES} on from the
 *   bin's middle, on the side away from its bench, at the bin's own setback —
 *   at {@link LITTER_BAG_SHARE} of the bins;
 * - a **tyre**, lying flat, {@link LITTER_TYRE_BESIDE_METRES} along the
 *   pavement from one lamp post, at the post's own setback by the pavement's
 *   back edge — at most one a village, in {@link LITTER_TYRE_SHARE} of them,
 *   and never within {@link LITTER_DOOR_CLEARANCE_METRES} of a front path
 *   (`streets.ts` §`DoorPath`), so no doorway is blocked.
 *
 * Both are hashed from the village's site and the anchor's place in its list
 * ({@link slotHash}), so a village's litter is the same on every lap and every
 * ride. Both stand clear of the line people walk
 * (`streets.ts` §`WALK_FROM_KERB_METRES`): a bin and a lamp post stand by the
 * pavement's back edge, 1.55 m and 1.65 m from the kerb, and neither piece
 * reaches 0.35 m toward the road from its anchor's line.
 *
 * ⚠️ **Villages only**: a city centre's street piece (`streets.ts`
 * §`VillageStreet.wrappedSite` below nought, #1637) has none, and nothing
 * here reads a verge, a field or a wood — the open road and the wooded hold
 * draw exactly what they drew.
 *
 * ## Why no draw call
 *
 * `three-renderer.ts` §`FurnitureBelt` merges each piece into the street
 * furniture's painted mesh, the one the bins and the lamp posts are already
 * drawn in, and admits a piece only on a frame that draws its anchor: so
 * the painted mesh is drawn on every frame a piece is, and the litter is
 * triangles in that call and never a call of its own. The stylised world
 * draws none.
 *
 * Pure, and names no rendering library.
 */

import { slotHash, uniformFrom } from './seeded';
import type { FurnitureItem, VillageStreet } from './streets';

/** What lies on a village's pavement — #1274. */
export type LitterKind = 'bag' | 'tyre';

/** Every {@link LitterKind}, in a fixed order. */
export const LITTER_KINDS: readonly LitterKind[] = ['bag', 'tyre'];

/** One piece of litter, in the corridor's local metres, turned by `rotation` (three's yaw). */
export interface LitterItem {
  readonly kind: LitterKind;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly rotation: number;
  /** The piece of street furniture it was placed from, which must be drawn for it to be. */
  readonly anchor: FurnitureItem;
}

/**
 * The share of a village's bins with a bag dumped beside them: **0.35** — a
 * village has four bins (`streets.ts` §`furnish`, a bench and its bin on each
 * run of each side), so one or two bags a village, and some none.
 */
export const LITTER_BAG_SHARE = 0.35;

/** The share of villages with one old tyre on the pavement: **0.5**. */
export const LITTER_TYRE_SHARE = 0.5;

/**
 * How far from its bin's middle a bag stands, in metres: **0.55** — the bin's
 * 0.26 m rim (`three-renderer.ts` §`FURNITURE_STYLE`), the bag's 0.23 m
 * half-width, and 6 cm between them.
 */
export const LITTER_BAG_BESIDE_METRES = 0.55;

/**
 * How far along the pavement from its lamp post a tyre lies, in metres:
 * **0.9** — the tyre's 0.3 m radius clear of the post's foot.
 */
export const LITTER_TYRE_BESIDE_METRES = 0.9;

/** How near a front path no tyre lies, in metres: **1.5**. */
export const LITTER_DOOR_CLEARANCE_METRES = 1.5;

/**
 * The most pieces of litter one frame draws: **10** — two villages in view at
 * most, each at most a bag at each of its four bins and one tyre, so the cap
 * never binds on a village these rules built. Held by `realistic-budget.ts`
 * §`REALISTIC_STREET_TRIANGLES`, which counts it at the heavier model's
 * triangles.
 */
export const LITTER_CAPACITY = 10;

/** The key the litter is hashed under, outside anything else's. */
const LITTER_KEY = 0x1274_0000;

/** Each street's litter, built on first sight: a street is the same object every frame. */
const known = new WeakMap<VillageStreet, readonly LitterItem[]>();

/** The litter on `street`'s pavements — none on a city centre's. @see the header */
export function litterOf(street: VillageStreet): readonly LitterItem[] {
  const found = known.get(street);
  if (found !== undefined) return found;
  const made = street.wrappedSite < 0 ? [] : litterOfVillage(street);
  known.set(street, made);
  return made;
}

function litterOfVillage(street: VillageStreet): readonly LitterItem[] {
  const litter: LitterItem[] = [];
  const furniture = street.furniture;
  const benches = furniture.filter((item) => item.kind === 'bench');
  furniture.forEach((bin, index) => {
    if (bin.kind !== 'bin') return;
    const hash = slotHash(LITTER_KEY, street.wrappedSite, index);
    if (uniformFrom(hash, 0) >= LITTER_BAG_SHARE) return;
    const bench = nearest(benches, bin);
    if (bench === undefined) return;
    const dx = bin.x - bench.x;
    const dz = bin.z - bench.z;
    const length = Math.hypot(dx, dz);
    if (length === 0) return;
    litter.push({
      kind: 'bag',
      x: bin.x + (dx / length) * LITTER_BAG_BESIDE_METRES,
      y: bin.y,
      z: bin.z + (dz / length) * LITTER_BAG_BESIDE_METRES,
      rotation: uniformFrom(hash, 1) * Math.PI * 2,
      anchor: bin,
    });
  });
  const village = slotHash(LITTER_KEY, street.wrappedSite, -1);
  if (uniformFrom(village, 0) >= LITTER_TYRE_SHARE) return litter;
  const lamps = furniture.filter((item) => item.kind === 'lamp-post');
  if (lamps.length === 0) return litter;
  // The lamp posts in a seeded order from a seeded first: the first whose
  // tyre lies clear of every front path takes it.
  const first = Math.floor(uniformFrom(village, 1) * lamps.length);
  const side = uniformFrom(village, 2) < 0.5 ? 1 : -1;
  for (let step = 0; step < lamps.length; step += 1) {
    const lamp = lamps[(first + step) % lamps.length] as FurnitureItem;
    // Along the pavement: the post's own +x, as three's `makeRotationY` turns it.
    const x = lamp.x + Math.cos(lamp.rotation) * LITTER_TYRE_BESIDE_METRES * side;
    const z = lamp.z - Math.sin(lamp.rotation) * LITTER_TYRE_BESIDE_METRES * side;
    if (nearAPath(street, x, z)) continue;
    litter.push({
      kind: 'tyre',
      x,
      y: lamp.y,
      z,
      rotation: uniformFrom(village, 3) * Math.PI * 2,
      anchor: lamp,
    });
    break;
  }
  return litter;
}

/** The item of `items` nearest `to`, or none. */
function nearest(items: readonly FurnitureItem[], to: FurnitureItem): FurnitureItem | undefined {
  let best: FurnitureItem | undefined;
  let least = Number.POSITIVE_INFINITY;
  for (const item of items) {
    const distance = Math.hypot(item.x - to.x, item.z - to.z);
    if (distance < least) {
      least = distance;
      best = item;
    }
  }
  return best;
}

/** Whether `(x, z)` is within {@link LITTER_DOOR_CLEARANCE_METRES} of any front path's line. */
function nearAPath(street: VillageStreet, x: number, z: number): boolean {
  for (const path of street.doorPaths) {
    const walk = path.walk;
    for (let at = 0; at + 2 < walk.length; at += 3) {
      const px = walk[at] as number;
      const pz = walk[at + 2] as number;
      if (Math.hypot(px - x, pz - z) < LITTER_DOOR_CLEARANCE_METRES) return true;
    }
  }
  return false;
}
