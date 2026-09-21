// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The road, as geometry, generated from #89's route profile.
 *
 * ## There is no world here, and that is the design
 *
 * ADR 0008 **D-5** settles the camera: a **fixed chase camera** over terrain
 * generated from the imported route. A free camera is out of scope, and
 * reopening it is a change to that ADR rather than an implementation detail.
 * What that buys is taken here: the geometry built is a **corridor along the
 * route**, a few hundred metres of it at a time, rather than a scene.
 *
 * ⚠️ **This paragraph used to add that the fixed camera "removes the culling
 * problem, the LOD problem and the visible-rider problem simultaneously" —
 * #91's words, and D-5's — and two of those three have since stopped being
 * true.** A reviewer who remembers the old sentence is reading the old file.
 * #244 put scenery beside the road, which unlike a road ribbon is not always in
 * front of you and does have to be culled: `three-renderer.ts`
 * §`lateralReachMetres` is the cull. #245 then made scenery density a rung on
 * `QUALITY_LADDER`, which is level-of-detail under another name. What survives
 * is the **visible-rider** third, untouched, and the corridor itself — nothing
 * in THIS file needs a cull or a level of detail, because the road ribbon is
 * still built only where the rider is about to be. ADR 0008 is amended to say
 * the same thing rather than left asserting the old one: see its
 * `## Amendments` entry of **2026-09-16**, appended by #246.
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
  gradeAt,
  positionAt,
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
 * much that the buffer is rebuilt for geometry nobody sees.
 *
 * ⚠️ **This used to end "there is no fog and nothing to cull, because there is
 * nothing outside the corridor to draw", and both halves of that have since
 * stopped being true.** #241 gave the world fog, and #244 put scenery beside
 * the road — which, unlike a road ribbon, is not always in front of you and
 * does have to be culled. `three-renderer.ts` §`lateralReachMetres` is the
 * cull, and it is bounded by this constant twice over so the belt and the
 * corridor cannot drift apart: once along the road, and once — since #269 —
 * across it, because nothing this far away is less than three-quarters faded
 * into the horizon at any fog density `world.ts` can produce. ADR 0008 D-5
 * makes the same claim this sentence did and is amended by #246.
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

/**
 * How many vertex columns the ribbon carries across its width: **six**.
 *
 * Three lanes — left edge line, carriageway, right edge line — and each lane
 * gets **its own pair** of columns rather than sharing one with its neighbour.
 * That duplication is the whole mechanism: a vertex colour is interpolated
 * across the triangle it belongs to, so a shared boundary vertex would smear
 * the edge line's colour three metres into the carriageway. Two coincident
 * vertices with different colours give a hard edge, which is what a painted
 * line is.
 *
 * @see roadCorridor for the layout, and {@link COLUMN_OFFSETS} for the metres.
 */
export const ROAD_COLUMNS = 6;

/**
 * How wide each edge line is, in metres: 0.15.
 *
 * ⚠️ **This repository's own choice, and nothing was consulted for it** —
 * #240's BR-1 and ADR 0009 L2. It is stated as a fraction of the road rather
 * than derived from anything: about one fiftieth of {@link ROAD_WIDTH_METRES},
 * which is wide enough to survive being a pixel or two at the far end of the
 * corridor and narrow enough that it takes no carriageway away from the
 * gradient cue.
 */
export const EDGE_LINE_WIDTH_METRES = 0.15;

/** How wide the centre line is, in metres. The same choice as the edge lines. */
export const CENTRE_LINE_WIDTH_METRES = 0.15;

/**
 * How far apart the starts of two centre-line marks are, in metres: **10**.
 *
 * ⚠️ **Provenance, because #240's BR-1 asks for it and ADR 0009 L2 forbids one
 * particular answer.** This number was **not** measured from another product's
 * road, and no other product was opened to arrive at it. It is this
 * repository's own choice, and the reasoning is: the period is what a rider
 * reads speed off, so it wants to be a round number in the units the route is
 * already measured in — and `packages/domain`'s `PROFILE_RESOLUTION_METRES` is
 * 10, so one dash period is one profile grid cell at the nominal resolution.
 * At a plausible 30 km/h a mark passes every 1.2 s, which is slow enough to
 * count and fast enough to feel.
 *
 * ⚠️ **It is a constant of its own and deliberately NOT a reference to
 * `profile.resolution`.** That field is the route's *actual* spacing, stretched
 * so the grid's last sample lands on the route's end — it differs from 10 by up
 * to half a metre from one route to the next, and a fine import sets it to 1.
 * A period that followed it would make the dash spacing a property of the file
 * the rider imported, which is exactly the false speed cue #242's first
 * criterion is written against.
 */
export const CENTRE_LINE_PERIOD_METRES = 10;

/**
 * How much of each period is painted, in metres: 4 of the 10.
 *
 * This repository's own choice on the same terms as the period above. Long
 * enough to read as a mark rather than a dot at the far end of the corridor,
 * short enough that the gap is the larger half and the pattern reads as
 * broken rather than as a solid line with notches in it.
 */
export const CENTRE_LINE_MARK_METRES = 4;

/**
 * How far above the road surface a centre-line mark is drawn, in metres: 0.05.
 *
 * ⚠️ **A depth-buffer allowance, not a paint thickness.** Real thermoplastic is
 * about 3 mm, and 3 mm would z-fight: with the camera's 0.5 m near plane and a
 * 24-bit depth buffer, the depth resolution at the far end of a
 * {@link VIEW_AHEAD_METRES} corridor is around 2 cm, so anything closer than
 * that to the surface it sits on flickers between the two. Five centimetres
 * clears it with margin and is invisible from a camera three metres up.
 *
 * The alternative — `polygonOffset` on the material — is not available here,
 * because the whole road is **one material on one mesh** (#242's fifth
 * criterion) and a material-level offset would lift the carriageway too.
 */
export const CENTRE_LINE_LIFT_METRES = 0.05;

/**
 * The gradient at which the surface tint reaches its extreme, in percent: 12.
 *
 * This repository's own choice. Twelve percent is about as steep as a paved
 * road a rider would put on a route gets for any distance, so the tint uses its
 * whole range over the gradients a real route actually contains rather than
 * spending most of it on gradients nothing produces. Steeper than that is
 * clamped — see {@link roadTint}.
 */
export const GRADIENT_TINT_FULL_SCALE_PERCENT = 12;

/**
 * The road surface on the flat. Unchanged from #91, where it was the whole road.
 *
 * ⚠️ It lives here rather than in `three-renderer.ts` now, because the surface
 * is no longer one colour: every vertex carries its own, derived from the
 * gradient at the point it sits on. The renderer's material is white and the
 * colours arrive as vertex data, which is what keeps the whole road one draw
 * call.
 */
export const ROAD_COLOUR = 0x3f4a5a;

/** The surface at {@link GRADIENT_TINT_FULL_SCALE_PERCENT} uphill, or steeper. */
export const ROAD_COLOUR_STEEPEST_CLIMB = 0x1c2430;

/** The surface at {@link GRADIENT_TINT_FULL_SCALE_PERCENT} downhill, or steeper. */
export const ROAD_COLOUR_STEEPEST_DESCENT = 0x77879c;

/** Paint: the edge lines and the centre-line marks. */
export const MARKING_COLOUR = 0xf2f0e6;

/**
 * The least the steepest climb and the steepest descent may differ by, as a
 * WCAG 2.2 contrast ratio: **3**.
 *
 * ⚠️ **The gradient cue must be readable without colour vision**, and this is
 * the assertion that makes that a fact rather than an intention. A tint that
 * moved hue alone — blue for up, red for down, at the same lightness — scores
 * about 1 here and fails, which is the point: `views/AnalysisView.tsx` encodes
 * nothing in colour, and `port.ts` gives each rider marker a shape as well as a
 * colour, *"colour alone fails a rider with a colour-vision deficiency and
 * washes out in sunlight"*. A road surface cannot be given a shape, so it is
 * given luminance instead.
 *
 * Three is not an invented number: it is WCAG 2.2 SC 1.4.11's threshold for a
 * non-text graphic, which `design/contrast.ts` already exports as
 * `AA_LARGE_TEXT_OR_NON_TEXT`. `terrain.test.ts` asserts against that export
 * rather than against this sentence, so the two cannot drift.
 *
 * @unwired a bound `terrain.test.ts` holds the gradient tints to; the tints
 * themselves are authored colours and read nothing from it.
 */
export const MINIMUM_TINT_CONTRAST_RATIO = 3;

/** Half the road, in metres, since every offset below is measured from the centre. */
const ROAD_HALF_WIDTH_METRES = ROAD_WIDTH_METRES / 2;

/**
 * Where each of the {@link ROAD_COLUMNS} sits, in metres left of the centreline.
 *
 * Left is positive, which is the direction of the ribbon's own normal. The
 * pairs are `(0, 1)` the left edge line, `(2, 3)` the carriageway and `(4, 5)`
 * the right edge line; columns 1 and 2 are coincident, as are 3 and 4, and that
 * is deliberate — see {@link ROAD_COLUMNS}.
 */
const COLUMN_OFFSETS: readonly number[] = [
  ROAD_HALF_WIDTH_METRES,
  ROAD_HALF_WIDTH_METRES - EDGE_LINE_WIDTH_METRES,
  ROAD_HALF_WIDTH_METRES - EDGE_LINE_WIDTH_METRES,
  -(ROAD_HALF_WIDTH_METRES - EDGE_LINE_WIDTH_METRES),
  -(ROAD_HALF_WIDTH_METRES - EDGE_LINE_WIDTH_METRES),
  -ROAD_HALF_WIDTH_METRES,
];

/** The first column of the carriageway, which is the only lane the tint reaches. */
const FIRST_CARRIAGEWAY_COLUMN = 2;

/** The last column of the carriageway. */
const LAST_CARRIAGEWAY_COLUMN = 3;

/** A point on the road's centreline, in local metres, with the route distance it came from. */
export interface CorridorPoint {
  /** East of the projection origin. */
  readonly x: number;
  /** Up, relative to the route's first elevation. */
  readonly y: number;
  /** North of the projection origin. */
  readonly z: number;
  /**
   * Where on the route this point is, wrapped into `[0, totalDistance]`.
   *
   * The geometry's own coordinate: it is what the elevation and the position
   * were read at, so on a loop two points a lap apart carry the same value
   * because they *are* the same place.
   */
  readonly distance: number;
  /**
   * The odometer reading this point was built for. **Not** wrapped.
   *
   * ⚠️ **Two fields rather than one, and #253 is what one cost.** A rider's and
   * a bot's distances are odometers — how far each has ridden in total — and
   * `pacer/gap.ts` requires them to stay that way, because a bot a full lap
   * ahead must read as a lap ahead rather than as level. {@link distance}
   * wraps, so matching an odometer against it made every corridor point compare
   * smaller than the value being searched for once either rider passed
   * `totalDistance`, and the rider and the bot were both drawn at the far end
   * of the corridor from lap two onward.
   *
   * So placement matches on this and geometry is read at {@link distance}, and
   * neither has to be bent to suit the other. `scene.ts` §`nearestPoint` is the
   * one consumer.
   */
  readonly along: number;
}

/** A ribbon of road, ready to become a vertex buffer. */
export interface RoadCorridor {
  /** The centreline, in order. */
  readonly centre: readonly CorridorPoint[];
  /**
   * Every vertex of the road, three floats each.
   *
   * A flat `Float32Array` rather than an array of objects because this is what a
   * GPU buffer is, and building the objects only to flatten them is the
   * allocation this loop most wants to avoid.
   *
   * **One array for the whole road**, and that is #242's fifth criterion rather
   * than a convenience: the surface, the two edge lines and every centre-line
   * mark are in here together, so the renderer draws them with one mesh, one
   * material and one call. The first `centre.length * ROAD_COLUMNS` vertices
   * are the surface, in centreline order and then in column order; the rest are
   * the centre-line marks, four vertices each.
   */
  readonly vertices: Float32Array;
  /**
   * The colour of each vertex, three floats each, **linear-light**.
   *
   * ⚠️ **Linear, not the sRGB bytes the constants above are written in.** three
   * multiplies a vertex-colour attribute straight into the fragment's diffuse
   * colour — `color_fragment.glsl` is one line, `diffuseColor *= vColor` — and
   * that multiplication happens in the renderer's linear working space. A
   * material's own `color` is converted for you because `Color.setHex` is told
   * it was given sRGB; an attribute is not, so the conversion is done here.
   * Skipping it does not throw and does not fail a test: it just paints the
   * road about forty percent too bright.
   */
  readonly colours: Float32Array;
  /**
   * Triangles, as indices into {@link vertices}. Three per triangle.
   *
   * Produced here rather than in the renderer because the road is no longer a
   * single strip: it is three lanes and a variable run of marks, and the shape
   * of that index list is a property of the geometry this file builds.
   *
   * ⚠️ **Borrowed, not owned.** Unlike {@link vertices} and {@link colours},
   * this array is shared between every corridor built at the same configuration
   * — see {@link roadIndices}. Read it; a caller that wants to change it copies
   * it first.
   */
  readonly indices: Uint32Array;
  /**
   * How many quads the ribbon spans **along its length**. `centre.length - 1`.
   *
   * Unchanged in meaning by #242, and still the number
   * {@link MAXIMUM_CORRIDOR_QUADS} bounds: it is the cost of the rebuild, not
   * the triangle count. The lanes multiply the triangles and not the work of
   * deciding where the road goes.
   */
  readonly quadCount: number;
}

/** Where the projection is centred, and what "up" is measured from. */
export interface CorridorOrigin {
  readonly latitude: number;
  readonly longitude: number;
  readonly elevation: number;
}

/**
 * Where a coordinate sits in the corridor's local metres, on the ground plane.
 *
 * ⚠️ **Exported so that `scatter.ts` (#243) projects with this projection rather
 * than with its own copy of it.** Two implementations of the equirectangular
 * projection is two sources of truth for where the world is, and a metre of
 * disagreement between them would put the scenery a metre off the road — which
 * is under the verge #243 puts between them, so it would show as trees in the
 * carriageway on one side and a bare strip on the other.
 *
 * `y` is not here because it is not a projection question: the road's height is
 * an interpolated elevation and the scenery's is the same one.
 */
export function localGroundPosition(
  origin: CorridorOrigin,
  position: GeographicPosition,
): { readonly x: number; readonly z: number } {
  const metresPerDegreeLongitude =
    METRES_PER_DEGREE_LATITUDE * Math.cos((origin.latitude * Math.PI) / 180);
  return {
    x: (position.longitude - origin.longitude) * metresPerDegreeLongitude,
    z: (position.latitude - origin.latitude) * METRES_PER_DEGREE_LATITUDE,
  };
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

  const normals = ribbonNormals(centre);
  const surfaceVertices = centre.length * ROAD_COLUMNS;
  // Fixed for a given corridor configuration, and that is what makes the road's
  // buffer a constant size — see `markSlotCount`.
  const slots = markSlotCount((centre.length - 1) * step);
  const vertices = new Float32Array((surfaceVertices + slots * 4) * 3);
  const colours = new Float32Array(vertices.length);

  writeSurface(profile, centre, normals, vertices, colours);
  writeCentreLine(profile, centre, normals, {
    atDistance,
    behind,
    start,
    step,
    firstVertex: surfaceVertices,
    slots,
    vertices,
    colours,
  });

  return {
    centre,
    vertices,
    colours,
    indices: roadIndices(centre.length, slots, surfaceVertices),
    quadCount: centre.length - 1,
  };
}

/**
 * The surface tint for a gradient, as a packed `0xRRGGBB`.
 *
 * Pure, total and **clamped**: `RouteProfile.grades` is computed from a file the
 * rider supplied, and a corrupt one can carry any finite number at all. A
 * gradient of 400 % is not a hill, and the honest thing for a renderer to do
 * with one is to draw the steepest road it knows how to draw rather than to
 * refuse the frame — the import path is where a file is judged, and
 * `world.ts` clamps its own inputs for the same reason and says so.
 *
 * Uphill darkens and downhill lightens. Which way round is arbitrary; that they
 * differ in **luminance** rather than only in hue is not, and
 * {@link MINIMUM_TINT_CONTRAST_RATIO} is where that is stated and asserted.
 */
export function roadTint(gradePercent: number): number {
  // ⚠️ Not clamped here, and that is deliberate rather than an omission:
  // {@link mix} clamps its own blend, so a second clamp on this line is a
  // branch no test can ever take — and a guard that cannot fail is a guard
  // nobody can tell has stopped working. Removing `mix`'s clamp is what turns
  // the 400 % case red.
  const amount = Math.abs(gradePercent) / GRADIENT_TINT_FULL_SCALE_PERCENT;
  return gradePercent >= 0
    ? mix(ROAD_COLOUR, ROAD_COLOUR_STEEPEST_CLIMB, amount)
    : mix(ROAD_COLOUR, ROAD_COLOUR_STEEPEST_DESCENT, amount);
}

/**
 * How many centre-line marks a corridor of `spanMetres` has room for.
 *
 * ⚠️ **It depends on the corridor's length and on nothing else — in particular
 * not on where the rider is** — and that is #240's NFR-3 rather than a tidiness
 * preference. The renderer grows its buffers and never shrinks them, so a mark
 * count that rose and fell by one as the rider crossed each period would
 * reallocate the vertex buffer on the frame it rose, thirty times a second
 * forever. A mark that falls outside the corridor is emitted as a zero-area
 * quad instead, which costs four vertices and rasterises nothing.
 *
 * The `+ 2` covers the two partial marks a corridor's ends can cut: one whose
 * start is before the corridor begins, and one whose start is inside it but
 * whose end is not.
 */
function markSlotCount(spanMetres: number): number {
  return Math.floor(Math.max(0, spanMetres) / CENTRE_LINE_PERIOD_METRES) + 2;
}

/**
 * The outward normal at each centreline point, as `x, z` pairs.
 *
 * The normal at each point is taken from the segment it starts, and the last
 * point reuses the previous normal — so a corridor is never degenerate at its
 * far end, which is where a naive `points[i + 1] - points[i]` walks off the
 * array and produces `NaN` vertices. `NaN` in a vertex buffer does not throw; it
 * silently removes the triangle, which is the kind of rendering bug that gets
 * diagnosed as "the road flickers".
 */
function ribbonNormals(centre: readonly CorridorPoint[]): Float64Array {
  const normals = new Float64Array(centre.length * 2);
  let normalX = 1;
  let normalZ = 0;
  /** The first point whose normal came from a real segment, not the default. */
  let firstReal = -1;
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
        if (firstReal === -1) {
          firstReal = index;
        }
      }
    }
    normals[index * 2] = normalX;
    normals[index * 2 + 1] = normalZ;
  }
  // #440: carry the first real cross-section BACK over the points before it.
  // Those are the points a point-to-point route clamps onto its start when the
  // corridor reaches behind distance 0 — all in one place — and with the
  // default normal they made a quad between an east-west cross-section and the
  // road's real one: a wedge of road at the start of every such route, drawn
  // at whatever angle the road happened to leave at. Behind the start of a
  // point-to-point route there is deliberately NOTHING, and these quads now
  // have zero area.
  for (let index = 0; index < firstReal; index += 1) {
    normals[index * 2] = normals[firstReal * 2] as number;
    normals[index * 2 + 1] = normals[firstReal * 2 + 1] as number;
  }
  return normals;
}

/**
 * Widens the centreline into a ribbon of {@link ROAD_COLUMNS} columns.
 *
 * The two outermost lanes are the edge lines and the middle one is the
 * carriageway, which is the only lane the gradient tint reaches: paint does not
 * change colour with the hill under it.
 */
function writeSurface(
  profile: RouteProfile,
  centre: readonly CorridorPoint[],
  normals: Float64Array,
  vertices: Float32Array,
  colours: Float32Array,
): void {
  for (let index = 0; index < centre.length; index += 1) {
    const here = centre[index] as CorridorPoint;
    const normalX = normals[index * 2] as number;
    const normalZ = normals[index * 2 + 1] as number;
    // Read at the point's own **route** distance, not at the odometer it was
    // built for: the gradient is a property of the road, so on a loop the same
    // place is the same climb on every lap. @see CorridorPoint.distance
    const tint = roadTint(gradeAt(profile, here.distance));
    for (let column = 0; column < ROAD_COLUMNS; column += 1) {
      const offset = COLUMN_OFFSETS[column] as number;
      const at = (index * ROAD_COLUMNS + column) * 3;
      vertices[at] = here.x + normalX * offset;
      vertices[at + 1] = here.y;
      vertices[at + 2] = here.z + normalZ * offset;
      const painted = column < FIRST_CARRIAGEWAY_COLUMN || column > LAST_CARRIAGEWAY_COLUMN;
      writeLinearColour(colours, at, painted ? MARKING_COLOUR : tint);
    }
  }
}

/** Everything {@link writeCentreLine} needs that is not the centreline itself. */
interface CentreLineRequest {
  readonly atDistance: number;
  readonly behind: number;
  readonly start: number;
  readonly step: number;
  readonly firstVertex: number;
  readonly slots: number;
  readonly vertices: Float32Array;
  readonly colours: Float32Array;
}

/**
 * Lays the broken centre line down the middle of the corridor.
 *
 * ## The mark grid is in route distance, and that is the whole of #242
 *
 * A mark begins at every whole multiple of {@link CENTRE_LINE_PERIOD_METRES}
 * **along the route**, so a mark that starts 1 230 m into a ride starts there
 * on every rebuild, at every corridor stride, and on every lap of a loop. Two
 * consequences, and they are the first two acceptance criteria of #242:
 *
 * - **The period is metres, not vertices.** `roadCorridor` strides its
 *   centreline when a profile's grid is fine enough to exceed
 *   {@link MAXIMUM_CORRIDOR_QUADS}, so a mark drawn one-per-corridor-point
 *   would be ten metres apart on one route and fifty on another. A rider reads
 *   speed off this; a period that grew with the length of the route they
 *   imported would be a false speed cue on exactly the long routes where speed
 *   matters most.
 * - **The pattern does not crawl.** The rider's own distance appears here only
 *   through `floor`, so advancing them by a fraction of a grid point moves
 *   which marks are in view and moves no mark. A pattern re-phased on every
 *   rebuild slides along the road at a speed unrelated to the rider's, and it
 *   is the single most noticeable artefact this file could ship.
 *
 * ## Why the marks are placed on the ribbon's own parameter and not by position
 *
 * A mark's ends are interpolated along the ribbon by `(odometer - start) /
 * step`, which is exact: `pointAt` places the ribbon's point `k` at odometer
 * `start + k * step`, so the parameter *is* the ribbon coordinate of that route
 * distance.
 *
 * ⚠️ **It carried a phase correction until #323 and no longer does, and a
 * reviewer who remembers one is reading the old file.** `pointAt` used to snap
 * a corridor point's `x` and `z` to the nearest profile grid point while
 * interpolating its height, so the ribbon's vertices sat at whole grid
 * coordinates and the corridor's first point was generally *not* at the grid
 * coordinate its odometer implied. The correction — the difference between the
 * two, in ribbon points — is what put a mark back where the geometry said that
 * route distance was. #323 removed the snapping, because it was freezing the
 * whole world for a grid cell at a time; with it gone the correction is the
 * error, and leaving it in moved every mark by up to half a grid cell. Both
 * `#242` tests above went red on exactly that.
 *
 * ⚠️ It is exact everywhere `distanceOnRoute` did not clamp, which is
 * everywhere except beyond the two ends of a point-to-point route. There the
 * ribbon is degenerate anyway — every point past the end is the same point —
 * so there is nothing for a mark to be misplaced on.
 */
function writeCentreLine(
  profile: RouteProfile,
  centre: readonly CorridorPoint[],
  normals: Float64Array,
  request: CentreLineRequest,
): void {
  const { start, step, vertices, colours } = request;
  const half = CENTRE_LINE_WIDTH_METRES / 2;
  const lastIndex = centre.length - 1;

  // An odometer is not a route distance once a lap has been ridden, and the
  // marks are painted on the road. @see CorridorPoint.along
  const routeAtRider = distanceOnRoute(profile, request.atDistance);
  const odometerOffset = request.atDistance - routeAtRider;
  const firstMark =
    Math.floor((routeAtRider - request.behind) / CENTRE_LINE_PERIOD_METRES) *
    CENTRE_LINE_PERIOD_METRES;

  for (let slot = 0; slot < request.slots; slot += 1) {
    const from = firstMark + slot * CENTRE_LINE_PERIOD_METRES + odometerOffset;
    const to = from + CENTRE_LINE_MARK_METRES;
    // Clamped to the ribbon rather than dropped. A mark whose whole length is
    // outside collapses to one parameter, which makes its four vertices
    // coincide and its two triangles cover no pixels at all.
    const fromParameter = clamp((from - start) / step, 0, lastIndex);
    const toParameter = clamp((to - start) / step, 0, lastIndex);

    const at = (request.firstVertex + slot * 4) * 3;
    writeMarkEdge(centre, normals, fromParameter, half, vertices, at);
    writeMarkEdge(centre, normals, toParameter, half, vertices, at + 6);
    for (let corner = 0; corner < 4; corner += 1) {
      writeLinearColour(colours, at + corner * 3, MARKING_COLOUR);
    }
  }
}

/** The two vertices across one end of a mark, at a ribbon parameter. */
function writeMarkEdge(
  centre: readonly CorridorPoint[],
  normals: Float64Array,
  parameter: number,
  halfWidth: number,
  vertices: Float32Array,
  at: number,
): void {
  const index = Math.min(centre.length - 2, Math.max(0, Math.floor(parameter)));
  const fraction = parameter - index;
  const from = centre[index] as CorridorPoint;
  const to = centre[index + 1] as CorridorPoint;
  const x = from.x + (to.x - from.x) * fraction;
  const y = from.y + (to.y - from.y) * fraction + CENTRE_LINE_LIFT_METRES;
  const z = from.z + (to.z - from.z) * fraction;
  const normalX = normals[index * 2] as number;
  const normalZ = normals[index * 2 + 1] as number;
  vertices[at] = x + normalX * halfWidth;
  vertices[at + 1] = y;
  vertices[at + 2] = z + normalZ * halfWidth;
  vertices[at + 3] = x - normalX * halfWidth;
  vertices[at + 4] = y;
  vertices[at + 5] = z - normalZ * halfWidth;
}

/**
 * The last index list built, and the three numbers that determined it.
 *
 * ⚠️ **A frame-rate optimisation, and the reason {@link RoadCorridor.indices}
 * is borrowed rather than owned.** `roadCorridor` runs inside
 * `requestAnimationFrame`, and for a fixed corridor configuration
 * {@link roadIndices}' three arguments do not change from one frame to the
 * next: the default 10 m-grid corridor rebuilt an identical 1 116-entry
 * `Uint32Array` — 4.5 kB — sixty times a second, on the thread GATT
 * notifications arrive on. #240's NFR-2.
 *
 * Handing the same instance back is safe because the renderer *copies* what it
 * is given into its own buffer rather than keeping the reference
 * (`three-renderer.ts` §`upload`); nothing in the program mutates a corridor's
 * indices. The key is every input the list depends on — `ROAD_COLUMNS` is a
 * constant — so the cache cannot return a stale list for a corridor whose shape
 * changed.
 */
let lastIndices:
  | {
      readonly pointCount: number;
      readonly slots: number;
      readonly firstMarkVertex: number;
      readonly indices: Uint32Array;
    }
  | undefined;

/**
 * Two triangles per quad, for every lane of the ribbon and every mark.
 *
 * One index list for the whole road, because there is one mesh. The winding is
 * consistent within a lane and is not relied on: the road's material is
 * double-sided, which is what lets a rider see the underside of a ribbon that
 * crests in front of them.
 */
function roadIndices(pointCount: number, slots: number, firstMarkVertex: number): Uint32Array {
  const cached = lastIndices;
  if (
    cached !== undefined &&
    cached.pointCount === pointCount &&
    cached.slots === slots &&
    cached.firstMarkVertex === firstMarkVertex
  ) {
    return cached.indices;
  }

  // Two columns per lane — see {@link ROAD_COLUMNS}, which counts both edge
  // lines and the carriageway.
  const lanes = ROAD_COLUMNS / 2;
  const segments = Math.max(0, pointCount - 1);
  const indices = new Uint32Array((lanes * segments + slots) * 6);
  let at = 0;
  const quad = (a: number, b: number, c: number, d: number): void => {
    indices[at] = a;
    indices[at + 1] = b;
    indices[at + 2] = c;
    indices[at + 3] = b;
    indices[at + 4] = d;
    indices[at + 5] = c;
    at += 6;
  };
  for (let lane = 0; lane < lanes; lane += 1) {
    const left = lane * 2;
    for (let segment = 0; segment < segments; segment += 1) {
      const here = segment * ROAD_COLUMNS + left;
      const next = (segment + 1) * ROAD_COLUMNS + left;
      quad(here, here + 1, next, next + 1);
    }
  }
  for (let slot = 0; slot < slots; slot += 1) {
    const base = firstMarkVertex + slot * 4;
    quad(base, base + 1, base + 2, base + 3);
  }
  lastIndices = { pointCount, slots, firstMarkVertex, indices };
  return indices;
}

/**
 * sRGB byte to linear-light, precomputed for all 256 of them.
 *
 * A table rather than `Math.pow` per channel per vertex: the corridor is
 * rebuilt as the rider moves, on the thread GATT notifications arrive on
 * (#240's NFR-2), and a 460 m corridor is a few thousand channels of work.
 * The transfer function is sRGB's own, the same one `design/contrast.ts`
 * linearises with for WCAG.
 */
const LINEAR_FROM_SRGB_BYTE = new Float32Array(256).map((_unused, byte) => {
  const proportion = byte / 255;
  return proportion <= 0.04045 ? proportion / 12.92 : Math.pow((proportion + 0.055) / 1.055, 2.4);
});

/** Unpacks a `0xRRGGBB` into three linear floats. @see RoadCorridor.colours */
function writeLinearColour(colours: Float32Array, at: number, packed: number): void {
  colours[at] = LINEAR_FROM_SRGB_BYTE[(packed >> 16) & 0xff] as number;
  colours[at + 1] = LINEAR_FROM_SRGB_BYTE[(packed >> 8) & 0xff] as number;
  colours[at + 2] = LINEAR_FROM_SRGB_BYTE[packed & 0xff] as number;
}

/**
 * Per-channel blend of two packed sRGB colours. `t` is clamped to [0, 1].
 *
 * ⚠️ The twin of `world.ts`'s own `mix`, and deliberately a copy rather than a
 * shared import: `world.ts` already imports `VIEW_AHEAD_METRES` from this file,
 * so an import the other way would be a cycle. #242 says a new module for this
 * would be the wrong answer, and ten lines of arithmetic is the cheaper of the
 * two prices.
 */
function mix(from: number, to: number, t: number): number {
  const amount = clamp01(t);
  let blended = 0;
  for (let shift = 16; shift >= 0; shift -= 8) {
    const a = (from >> shift) & 0xff;
    const b = (to >> shift) & 0xff;
    blended |= Math.round(a + (b - a) * amount) << shift;
  }
  return blended;
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/**
 * One centreline point, projected and wrapped.
 *
 * The wrap is applied to the *geometry* and recorded in `distance`; the
 * unwrapped `along` it was asked for is kept beside it. @see CorridorPoint.along
 */
function pointAt(profile: RouteProfile, origin: CorridorOrigin, along: number): CorridorPoint {
  // `distanceOnRoute` wraps a loop and clamps a point-to-point route, which is
  // exactly the behaviour the corridor wants at both ends: on a loop the road
  // continues, and on a straight route it stops rather than extrapolating into
  // terrain that was never surveyed.
  const wrapped = distanceOnRoute(profile, along);
  // ⚠️ **`positionAt`, which interpolates between the two grid points either
  // side, and NOT `positions[Math.round(wrapped / resolution)]`, which is what
  // this was until #323.** Rounding made every centreline point — and with it
  // the chase camera, which is placed on one — hold completely still for a
  // whole grid cell and then jump the width of one: at a route's nominal 10 m
  // grid and a plausible 8 m/s, 1.25 seconds of frozen world followed by a
  // ten-metre jump. `elevationAt` on the next line always interpolated, so the
  // camera rose and fell smoothly over ground that was standing still, which
  // is why the symptom read as a frame-rate problem rather than as a
  // resolution one.
  //
  // `gradeAt` in the same package states the rule this was breaking, about the
  // gradient it writes to a trainer: *"a held value steps by the whole
  // difference between two grid points every time the rider crosses one"*.
  // `scatter.ts` and `hud/plan.ts` were already reading positions this way;
  // this file was the one that was not.
  const ground = localGroundPosition(origin, positionAt(profile, wrapped));
  return {
    x: ground.x,
    y: (elevationAt(profile, wrapped) as number) - origin.elevation,
    z: ground.z,
    distance: wrapped,
    along,
  };
}
