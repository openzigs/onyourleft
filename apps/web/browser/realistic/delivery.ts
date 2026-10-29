// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A Delivery round's worst case on the owner's realistic page — #1815, for
 * the two village ceilings (`realistic-budget.ts`
 * §`REALISTIC_VILLAGE_DRAW_CALLS` and §`DELIVERY_VILLAGE_DRAW_CALLS`).
 *
 * `?delivery=N` hands every frame N parcels, N house markers and N obstacles,
 * every obstacle kind among them, on the road ahead of the rider: what
 * `port.ts` §`SceneFrame.delivery` carries on a ride running a round (#1816), drawn by
 * the product's own `three-renderer.ts` §`DeliveryBelt`. #1814 measured the
 * belt at three calls whatever the count, so the worst case is every kind in
 * view at once, which no single throw needs and which this always is.
 *
 * ⚠️ **Placements, not a round.** Nothing here throws, picks a house or moves
 * an obstacle: a call costs the same wherever its instances stand, and the
 * belt is not frustum-culled. The pieces stand where a by-eye look can find
 * them — the markers beside the road, the parcels above its verge and the
 * obstacles on it — and follow the rider, so a five-minute ride on the tablet
 * carries the round for all five.
 */

import type {
  DeliveryInView,
  DeliveryObstacleKind,
  DeliveryPiece,
  SceneFrame,
} from '../../src/game/port';
import type { CorridorPoint } from '../../src/game/terrain';

/** Where the first of each piece stands, ahead of the rider, in metres. */
export const DELIVERY_AHEAD_METRES = 10;

/** How far apart each piece of a kind stands along the road, in metres. */
export const DELIVERY_SPACING_METRES = 2;

/** Every obstacle kind, in turn. `port.ts` §`DeliveryObstacleKind`. */
const KINDS: readonly DeliveryObstacleKind[] = ['bin', 'trolley', 'cone'];

/** The centreline point nearest `along`, and the road's heading there. */
function onRoad(
  centre: readonly CorridorPoint[],
  along: number,
): { readonly at: CorridorPoint; readonly headingX: number; readonly headingZ: number } {
  let index = 0;
  for (let at = 1; at < centre.length; at += 1) {
    const point = centre[at] as CorridorPoint;
    if (Math.abs(point.along - along) < Math.abs((centre[index] as CorridorPoint).along - along)) {
      index = at;
    }
  }
  const at = centre[index] as CorridorPoint;
  const from = centre[Math.max(0, index - 1)] as CorridorPoint;
  const to = centre[Math.min(centre.length - 1, index + 1)] as CorridorPoint;
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const length = Math.hypot(dx, dz);
  return { at, headingX: length > 0 ? dx / length : 0, headingZ: length > 0 ? dz / length : 1 };
}

/**
 * `count` of each Delivery piece on `frame`'s road, the first
 * {@link DELIVERY_AHEAD_METRES} ahead of `riderAlong` (the odometer, as
 * `CorridorPoint.along` is) and each {@link DELIVERY_SPACING_METRES} on.
 * Across the road along its normal `(−headingZ, headingX)`, positive to the
 * rider's right, as `delivery/in-view.ts` places a piece.
 */
export function deliveryAhead(
  frame: Pick<SceneFrame, 'corridor'>,
  riderAlong: number,
  count: number,
): DeliveryInView {
  const { centre } = frame.corridor;
  if (centre.length === 0 || count <= 0) return { parcels: [], markers: [], obstacles: [] };
  const piece = (index: number, across: number, up: number): DeliveryPiece => {
    const { at, headingX, headingZ } = onRoad(
      centre,
      riderAlong + DELIVERY_AHEAD_METRES + DELIVERY_SPACING_METRES * index,
    );
    return {
      x: at.x - headingZ * across,
      y: at.y + up,
      z: at.z + headingX * across,
      yaw: Math.atan2(headingX, headingZ),
    };
  };
  const each = Array.from({ length: count }, (_, index) => index);
  return {
    parcels: each.map((index) => piece(index, 3, 1.1)),
    markers: each.map((index) => piece(index, 6, 0)),
    obstacles: each.map((index) => ({
      ...piece(index, -1.5, 0),
      kind: KINDS[index % KINDS.length] as DeliveryObstacleKind,
    })),
  };
}
