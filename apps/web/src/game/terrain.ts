// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The road, as geometry, generated from #89's route profile.
 *
 * ## There is no world here, and that is the design
 *
 * ADR 0008 **D-5** settles the camera: a **fixed chase camera** over terrain
 * generated from the imported route. A free camera is out of scope, and
 * reopening it is a change to that ADR rather than an implementation detail.
 * #91 records what the fixed camera buys — *"it removes the culling problem, the
 * LOD problem and the visible-rider problem simultaneously"* — and this file is
 * where that saving is actually taken: the geometry built is a **corridor along
 * the route**, a few hundred metres of it at a time, rather than a scene.
 *
 * ⚠️ **#19 and ADR 0009 forbid deriving any world asset, course geometry,
 * texture or model from another product.** Nothing here is derived from
 * anything: every vertex is computed from the rider's own imported GPX, through
 * `packages/domain`'s route profile. That is not a licensing technicality that
 * happens to hold — it is why the epic can ship with no art budget at all, and
 * #91 says so: *"one real route from GPX terrain, stylised corridor, not a
 * designed fictional world"*.
 *
 * ## Why a local projection and not a map projection
 *
 * The route arrives as latitude and longitude. A renderer needs metres. Over the
 * few kilometres a route covers, an equirectangular projection about the route's
 * own first point is accurate to well under the width of the road, and it has
 * the property a map projection does not: **it is centred on this route**, so
 * the coordinates stay small and single-precision floats — which is what a
 * `Float32Array` vertex buffer holds — keep their precision. A Web Mercator
 * coordinate near the poles would not.
 *
 * ⚠️ It is deliberately **not** `packages/domain`'s distance maths. That answers
 * "how far apart are these two points", to a tolerance the segment matcher
 * depends on. This answers "where do I put this vertex", where being a
 * centimetre out is invisible and being slow is not.
 */

import {
  distanceOnRoute,
  elevationAt,
  type GeographicPosition,
  type RouteProfile,
} from '@onyourleft/domain';

/**
 * Metres per degree of latitude.
 *
 * The WGS-84 meridian arc over the whole sphere divided by 360. Constant enough
 * for a corridor: it varies by about 1% between the equator and the poles, which
 * over a 400 m view distance is four metres of scale error in a scene with no
 * absolute reference in it.
 */
const METRES_PER_DEGREE_LATITUDE = 111_320;

/** How wide the road is drawn, in metres. */
export const ROAD_WIDTH_METRES = 7;

/**
 * How far ahead of the rider the corridor is built.
 *
 * 400 m at a plausible 12 m/s is a little over thirty seconds of road, which is
 * enough that the far end is always beyond where a rider is looking and never so
 * much that the buffer is rebuilt for geometry nobody sees. It is a view
 * distance rather than a draw distance: there is no fog and nothing to cull,
 * because there is nothing outside the corridor to draw.
 */
export const VIEW_AHEAD_METRES = 400;

/** How far behind the rider the corridor keeps, so the chase camera sees road. */
export const VIEW_BEHIND_METRES = 60;

/**
 * The most quads the corridor is ever built from.
 *
 * The mobile budget is **draw calls, overdraw and fill rate, not triangles**
 * (#91), so this is not really a triangle budget — it is a bound on the work the
 * *rebuild* does, which happens on the JavaScript thread that GATT notifications
 * also arrive on. A corridor of 460 m at the profile's 10 m grid is 46 quads;
 * this leaves an order of magnitude of headroom before {@link roadCorridor}
 * starts striding, and the striding is what keeps a 1 m-resolution profile from
 * turning into 460.
 */
export const MAXIMUM_CORRIDOR_QUADS = 256;

/** A point on the road's centreline, in local metres, with the route distance it came from. */
export interface CorridorPoint {
  /** East of the projection origin. */
  readonly x: number;
  /** Up, relative to the route's first elevation. */
  readonly y: number;
  /** North of the projection origin. */
  readonly z: number;
  /** How far along the route this point is. */
  readonly distance: number;
}

/** A ribbon of road, ready to become a vertex buffer. */
export interface RoadCorridor {
  /** The centreline, in order. */
  readonly centre: readonly CorridorPoint[];
  /**
   * Triangle-strip vertices: left and right edge alternating, three floats each.
   *
   * A flat `Float32Array` rather than an array of objects because this is what a
   * GPU buffer is, and building the objects only to flatten them is the
   * allocation this loop most wants to avoid.
   */
  readonly vertices: Float32Array;
  /** How many quads the strip contains. `centre.length - 1`. */
  readonly quadCount: number;
}

/** Where the projection is centred, and what "up" is measured from. */
export interface CorridorOrigin {
  readonly latitude: number;
  readonly longitude: number;
  readonly elevation: number;
}

/**
 * The projection origin for a route: its first grid point.
 *
 * Computed once per route and reused for every rebuild, because a projection
 * that moved with the rider would make the whole world shift under them.
 */
export function corridorOrigin(profile: RouteProfile): CorridorOrigin {
  const first = profile.positions[0] as GeographicPosition;
  return {
    latitude: first.latitude,
    longitude: first.longitude,
    elevation: profile.elevations[0] as number,
  };
}

/**
 * Builds the stretch of road around `atDistance`.
 *
 * Called whenever the rider has moved far enough that the corridor's far end is
 * approaching — not every frame. The renderer decides that; this function is
 * pure and has no idea how often it is called.
 *
 * On a loop the corridor wraps: `distanceOnRoute` is what wraps, and it is the
 * same function #90's trainer driver uses to decide what gradient to send, so
 * the hill the rider sees and the resistance they feel come from one answer
 * rather than two that agree.
 */
export function roadCorridor(
  profile: RouteProfile,
  origin: CorridorOrigin,
  atDistance: number,
  options: { readonly aheadMetres?: number; readonly behindMetres?: number } = {},
): RoadCorridor {
  const ahead = options.aheadMetres ?? VIEW_AHEAD_METRES;
  const behind = options.behindMetres ?? VIEW_BEHIND_METRES;
  const span = ahead + behind;

  // Stride in whole grid points, so every sample lands on a real profile entry
  // and no elevation is interpolated twice — once here and once in `elevationAt`.
  const resolution: number = profile.resolution;
  const wantedPoints = Math.floor(span / resolution) + 1;
  const stride = Math.max(1, Math.ceil((wantedPoints - 1) / MAXIMUM_CORRIDOR_QUADS));
  const step = resolution * stride;

  const centre: CorridorPoint[] = [];
  const start = atDistance - behind;
  for (let along = start; along <= atDistance + ahead + 1e-9; along += step) {
    centre.push(pointAt(profile, origin, along));
  }
  if (centre.length < 2) {
    // A route shorter than one step still has to produce a drawable ribbon.
    centre.push(pointAt(profile, origin, start + step));
  }

  return {
    centre,
    vertices: ribbon(centre, ROAD_WIDTH_METRES),
    quadCount: centre.length - 1,
  };
}

/** One centreline point, projected and wrapped. */
function pointAt(profile: RouteProfile, origin: CorridorOrigin, along: number): CorridorPoint {
  // `distanceOnRoute` wraps a loop and clamps a point-to-point route, which is
  // exactly the behaviour the corridor wants at both ends: on a loop the road
  // continues, and on a straight route it stops rather than extrapolating into
  // terrain that was never surveyed.
  const wrapped = distanceOnRoute(profile, along);
  const index = Math.min(
    profile.positions.length - 1,
    Math.max(0, Math.round(wrapped / profile.resolution)),
  );
  const position = profile.positions[index] as GeographicPosition;
  const metresPerDegreeLongitude =
    METRES_PER_DEGREE_LATITUDE * Math.cos((origin.latitude * Math.PI) / 180);
  return {
    x: (position.longitude - origin.longitude) * metresPerDegreeLongitude,
    y: (elevationAt(profile, wrapped) as number) - origin.elevation,
    z: (position.latitude - origin.latitude) * METRES_PER_DEGREE_LATITUDE,
    distance: wrapped,
  };
}

/**
 * Widens a centreline into a ribbon.
 *
 * The normal at each point is taken from the segment it starts, and the last
 * point reuses the previous normal — so a corridor is never degenerate at its
 * far end, which is where a naive `points[i + 1] - points[i]` walks off the
 * array and produces `NaN` vertices. `NaN` in a vertex buffer does not throw; it
 * silently removes the triangle, which is the kind of rendering bug that gets
 * diagnosed as "the road flickers".
 */
function ribbon(centre: readonly CorridorPoint[], width: number): Float32Array {
  const half = width / 2;
  const vertices = new Float32Array(centre.length * 6);
  let normalX = 1;
  let normalZ = 0;
  for (let index = 0; index < centre.length; index += 1) {
    const here = centre[index] as CorridorPoint;
    const next = centre[index + 1];
    if (next !== undefined) {
      const dx = next.x - here.x;
      const dz = next.z - here.z;
      const length = Math.hypot(dx, dz);
      if (length > 0) {
        // Perpendicular in the ground plane. Height is deliberately not part of
        // the normal: a road on a 10% climb is still flat across its width, and
        // banking it would put the rider's wheels off the surface.
        normalX = -dz / length;
        normalZ = dx / length;
      }
    }
    const at = index * 6;
    vertices[at] = here.x + normalX * half;
    vertices[at + 1] = here.y;
    vertices[at + 2] = here.z + normalZ * half;
    vertices[at + 3] = here.x - normalX * half;
    vertices[at + 4] = here.y;
    vertices[at + 5] = here.z - normalZ * half;
  }
  return vertices;
}
