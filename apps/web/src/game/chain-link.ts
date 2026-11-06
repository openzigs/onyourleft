// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Where a chain-link fence stands — #1274, the owner's ruling of 2026-11-05:
 * **beside industrial, school and sports grounds only**, and nowhere else. A
 * field's fence keeps its planks.
 *
 * ## Which grounds
 *
 * A mapped `landuse` polygon whose kind is one of {@link CHAIN_LINK_KINDS}:
 * `industrial`, `school`, and `pitch`, which is how Protomaps v4 writes a
 * sports ground (spike 0031 counted it in every corridor it decoded, and no
 * `sports_centre` or `stadium` in any). Read off the ride's corridor, so a
 * ride with none — the stylised world, the procedural road — has no
 * chain-link fence at all.
 *
 * ## Where along them
 *
 * Along the ground's own outline, in pieces of `settlements.ts`
 * §`BOUNDARY_PIECE_METRES` (8 m, the field fence's own piece): an edge
 * `L` long takes `round(L / 8)` pieces, evenly along it, and an edge under
 * half a piece takes none. A piece stands only where the road comes within
 * {@link CHAIN_LINK_REACH_METRES} of it: an outline further off is not seen
 * from the road. A piece whose middle is nearer the road than a field's
 * roadside boundary, `settlements.ts` §`FIELD_EDGE_LATERAL_METRES` (a ground
 * mapped to the road's own line, as OpenStreetMap often draws one), and that
 * runs along the road, is moved out to that boundary's line — so the
 * ground's frontage is fenced at the field's verge and not on the
 * carriageway. One across the road is dropped there by `settlements.ts`
 * §`structureClearance`, as every structure is. None stands in water, and
 * none where the urban class calls the road a city centre, whose pavement is
 * there (`streets.ts` §`CITY_STREET_RULE`).
 *
 * Each piece is a `fence` ({@link ScatterItem.chainLink}), so it spends the
 * structures' budget as a field boundary does, nearest the rider first
 * (`settlements.ts` §`structuresAt`), and the realistic world draws it as the
 * chain-link model inside the field fence's own instanced draw
 * (`three-renderer.ts` §`RealisticStructureBelts`).
 *
 * Pure, and names no rendering library. Built once a route, on first ask.
 */

import { distanceOnRoute, type RouteProfile } from '@onyourleft/domain';
import type { LandUseFeature } from '@onyourleft/map-features';

import type { LandClassMask } from './land-class';
import { terrainHeightAt } from './landform';
import { nearestOnDrawnRoad } from './road-grid';
import type { ScatterItem } from './scatter';
import { drawnRoadFrame, type CorridorOrigin } from './terrain';
import { inWater, waterways } from './waterways';

/** The `landuse` kinds a chain-link fence stands beside. @see the header */
export const CHAIN_LINK_KINDS: ReadonlySet<string> = new Set(['industrial', 'school', 'pitch']);

/** How far from the road a ground's outline is still fenced, in metres: **40**. */
export const CHAIN_LINK_REACH_METRES = 40;

/**
 * How nearly along the road a piece must run to be moved out to the
 * roadside boundary's line: within **30°** of it.
 */
export const CHAIN_LINK_ALONG_ROAD_COSINE = Math.cos(Math.PI / 6);

/** One piece of chain-link fence, with the odometer it stands at on the route's first lap. */
export interface ChainLinkPiece {
  readonly item: ScatterItem;
  readonly along: number;
}

/** The kinds the chain-link stands on, kept to those {@link CHAIN_LINK_KINDS} names. */
export function fencedGrounds(landUse: readonly LandUseFeature[]): readonly LandUseFeature[] {
  return landUse.filter(
    (feature) => feature.layer === 'landuse' && CHAIN_LINK_KINDS.has(feature.kind),
  );
}

/** What a placement needs of the route besides the grounds. */
export interface ChainLinkRoute {
  readonly profile: RouteProfile;
  readonly origin: CorridorOrigin;
  readonly seed: number;
  readonly land: LandClassMask;
  /** How far from the centreline a field's roadside boundary runs: `settlements.ts`' 5.6 m. */
  readonly roadside: number;
  /** One piece's length: `settlements.ts`' 8 m. */
  readonly piece: number;
  /** Whether the road at a first-lap odometer is a city centre's. */
  readonly cityCentre: (along: number) => boolean;
}

/** Every chain-link piece beside `grounds`, in their order and their outlines' order. @see the header */
export function chainLinkPieces(
  grounds: readonly LandUseFeature[],
  route: ChainLinkRoute,
): readonly ChainLinkPiece[] {
  const ways = waterways(route.profile, route.seed);
  const pieces: ChainLinkPiece[] = [];
  for (const ground of grounds) {
    const outline = ground.rings[0];
    if (outline === undefined) continue;
    const corners = outline.length / 2;
    for (let corner = 0; corner < corners; corner += 1) {
      const ax = outline[corner * 2] as number;
      const az = outline[corner * 2 + 1] as number;
      const next = (corner + 1) % corners;
      const bx = outline[next * 2] as number;
      const bz = outline[next * 2 + 1] as number;
      const length = Math.hypot(bx - ax, bz - az);
      const count = Math.round(length / route.piece);
      if (count === 0) continue;
      const dx = (bx - ax) / length;
      const dz = (bz - az) / length;
      for (let index = 0; index < count; index += 1) {
        const t = ((index + 0.5) * length) / count;
        const placed = standing(route, ways, ax + dx * t, az + dz * t, dx, dz);
        if (placed !== undefined) pieces.push(placed);
      }
    }
  }
  return pieces;
}

/** One piece whose middle is `(x, z)` and which runs along `(dx, dz)`, or none. @see the header */
function standing(
  route: ChainLinkRoute,
  ways: ReturnType<typeof waterways>,
  x: number,
  z: number,
  dx: number,
  dz: number,
): ChainLinkPiece | undefined {
  const { profile, origin } = route;
  const near = nearestOnDrawnRoad(profile, origin, x, z, CHAIN_LINK_REACH_METRES);
  if (near === undefined || route.cityCentre(near.along)) return undefined;
  let at = { x, z, rotation: Math.atan2(dx, dz), lateral: near.lateral };
  if (near.distance < route.roadside) {
    const frame = drawnRoadFrame(profile, origin, near.along);
    if (frame === undefined) return undefined;
    // The road's own direction is its normal turned a quarter: (nz, −nx).
    const along = Math.abs(dx * frame.normalZ - dz * frame.normalX);
    if (along < CHAIN_LINK_ALONG_ROAD_COSINE) return undefined;
    const lateral = (near.lateral < 0 ? -1 : 1) * route.roadside;
    at = {
      x: frame.x + frame.normalX * lateral,
      z: frame.z + frame.normalZ * lateral,
      rotation: Math.atan2(frame.normalZ, -frame.normalX),
      lateral,
    };
  }
  const wrapped = distanceOnRoute(profile, near.along);
  if (inWater(ways, profile, wrapped, at.lateral)) return undefined;
  return {
    item: {
      kind: 'fence',
      x: at.x,
      y: terrainHeightAt(profile, origin, route.seed, wrapped, at.lateral, route.land),
      z: at.z,
      rotation: at.rotation,
      scale: 1,
      variant: 0,
      chainLink: true,
    },
    along: near.along,
  };
}
