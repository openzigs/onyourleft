// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Where the realistic world's scenery darkens the ground it stands on — #620.
 *
 * ## Why a blob, and not a shadow map or a baked ground
 *
 * A realistic tree or house used to stand on grass exactly as bright right up
 * to its trunk or its wall, which is the strongest single cue that it was
 * placed rather than grown or built. #426 grounded the riders with a soft
 * ellipse; this grounds the scenery the same way, for one draw call and no
 * texture, and `three-renderer.ts` §`GroundBlobBelt` draws it.
 *
 * - **Not a shadow map.** That is #632, measured and ruled first; `three-seam.test.ts`
 *   §"lets only the sun and the riders cast a shadow" is untouched because
 *   nothing here writes any shadow state.
 * - **Not the ground's vertex colours.** The landform's columns
 *   (`landform.ts` §`TERRAIN_COLUMN_OFFSETS`) are 4 to 9 m apart beside the
 *   road, coarser than a crown or a wall, so darkness baked there would be a
 *   smear the size of a field.
 *
 * ## From the one sun
 *
 * Every blob is thrown from `world.ts`'s sun through
 * `contact-shadow.ts` §`sunThrowPerMetre` — the riders' projection, shared
 * rather than copied, so there is no second light direction to drift. A caster
 * is a column {@link BlobCaster.height} tall over its footprint: its blob is
 * centred on the shadow of its middle ({@link GROUND_BLOB_CAST_SHARE}) and
 * stretched along the sun by the length of the whole column's shadow, which is
 * exactly `placeContactShadow`'s construction for a rider.
 *
 * ## On the landform, not on a plane
 *
 * {@link groundUnder} finds the triangle of THIS frame's `TerrainMesh` the
 * blob's middle is over — the triangles the renderer draws, not a smoother
 * surface nobody sees — and the blob lies in that triangle's plane, lifted
 * {@link GROUND_BLOB_LIFT_METRES} along its normal. A blob is one quad, so on
 * ground that folds under it part of it is under the ground and the depth test
 * hides that part; it never floats a hand's width in the air.
 *
 * ## Never on the carriageway
 *
 * {@link roadClip} gives each blob two half-planes, in the blob's own
 * horizontal frame, that together hold every point of the road — the drawn
 * centreline widened by {@link ROAD_EDGE_METRES} — on their far side; the
 * shader keeps only what is on the near side of both. One plane per stretch of
 * road that comes within reach, so a tree on the inside of a hairpin, with road
 * on two sides of it, is clipped at both. `ground-blob.test.ts` holds it on
 * `route-fixtures-testing.ts`' hairpin.
 *
 * ⚠️ **Conservative, stated**: a stretch's plane is the straight line tangent
 * to the furthest-in point of that stretch, so on the OUTSIDE of a bend the
 * blob stops a little short of the curving edge. A third stretch in reach (it
 * has not happened on any fixture) is folded into the nearer-facing plane,
 * which clips more rather than less.
 *
 * Pure: no `three`, no clock, no DOM. Nothing here allocates per call.
 */

import type { SunThrow } from './contact-shadow';
import type { TerrainMesh } from './landform';
import { TERRAIN_COLUMN_OFFSETS } from './landform';
import { ROAD_WIDTH_METRES, type CorridorPoint } from './terrain';

/**
 * How dark a blob is at its middle, as the alpha of black: **0.3**.
 *
 * Chosen, and stated as a choice, from what it does on screen. The blob is
 * blended AFTER three's tone mapping and sRGB encoding — both happen inside
 * the ground's own shader, drawing straight to the canvas — so the ground under
 * a blob's middle reads `1 − 0.3 = 0.70` of its brightness in the encoded
 * pixel, whatever that brightness is. A full cast shadow under this sky takes
 * the direct share of the light away and leaves the ambient 0.4
 * (`world.ts` §`SUN_AMBIENT_SHARE`), which is about 0.66 of the ENCODED value;
 * a canopy lets light through and a soft blob should be lighter than a hard
 * shadow, so the middle stops short of that. `game.browser.spec.ts` §"#620"
 * holds the ratio read back off the drawing buffer to this number from both
 * sides.
 */
export const GROUND_BLOB_DARKNESS = 0.3;

/** How far out, as a share of the rim, a blob keeps its whole darkness. */
export const GROUND_BLOB_CORE = 0.35;

/**
 * How far above the ground's own triangle a blob is drawn: **5 cm**, along
 * the triangle's normal. More than the riders' 2 cm because a blob is metres
 * across on ground whose triangles bend under it; the polygon offset
 * `three-renderer.ts` applies does the rest.
 */
export const GROUND_BLOB_LIFT_METRES = 0.05;

/**
 * Which height's shadow a blob is centred on, as a share of its caster:
 * **half**, the rule `contact-shadow.ts` uses for a rider as a column.
 */
export const GROUND_BLOB_CAST_SHARE = 0.5;

/**
 * Triangles one blob costs: one quad. #620's ceiling is two.
 *
 * @test-facing held by `realistic-budget.test.ts`, which adds the blobs to the
 * worst frame's triangles with it, and `realistic-renderer.test.ts`, which
 * counts the quad `three-renderer.ts` builds against it
 */
export const GROUND_BLOB_TRIANGLES = 2;

/** Where the carriageway ends, either side of the drawn centreline. */
export const ROAD_EDGE_METRES = ROAD_WIDTH_METRES / 2;

/**
 * A blob's darkness at `r`, its distance from the middle as a share of the
 * rim: {@link GROUND_BLOB_DARKNESS} to {@link GROUND_BLOB_CORE}, a smoothstep
 * to nothing at the rim. ⚠️ `three-renderer.ts` §`GROUND_BLOB_FRAGMENT` is the
 * same arithmetic in GLSL; `realistic-renderer.test.ts` §"#620" reads the
 * constants in it.
 *
 * @test-facing held by `ground-blob.test.ts`, which samples every blob on the
 * hairpin by it; the shader is the production copy
 */
export function groundBlobAlpha(r: number, darkness: number = GROUND_BLOB_DARKNESS): number {
  if (!(r < 1)) return 0;
  if (r <= GROUND_BLOB_CORE) return darkness;
  const t = (r - GROUND_BLOB_CORE) / (1 - GROUND_BLOB_CORE);
  return darkness * (1 - t * t * (3 - 2 * t));
}

/**
 * One thing that darkens the ground: where it stands, how much ground it
 * covers, and how tall it is. Written by the belts that draw it; read here.
 */
export interface BlobCaster {
  /** Where it stands, in the corridor's local metres. */
  x: number;
  z: number;
  /**
   * The rotation about +Y taking +Z onto its footprint's long axis — a
   * structure's own facing. Ignored for a {@link round} caster, whose blob is
   * turned to the sun.
   */
  yaw: number;
  /** A tree, shrub or rock: a round footprint of radius {@link halfAcross}. */
  round: boolean;
  /** Half the footprint along {@link yaw}'s axis, and across it. */
  halfAlong: number;
  halfAcross: number;
  /** How far along its axis the footprint's middle is from where it stands. */
  centreAlong: number;
  /** How tall it is. */
  height: number;
  /**
   * How much of its blob is drawn, 0 to 1: 1 for all but the furthest tree
   * that has one, which fades its blob out as it nears the next tree back —
   * `three-renderer.ts` §`RealisticVegetationBelt`'s rule, so a blob never
   * appears or vanishes in one frame under a tree that does not.
   */
  strength: number;
}

/**
 * A frame's casters, in objects made once: a belt writes the first
 * {@link count} and reads nothing past it, so a frame allocates nothing.
 */
export interface BlobCasters {
  readonly casters: readonly BlobCaster[];
  count: number;
}

/** Room for `capacity` casters. */
export function blobCasters(capacity: number): BlobCasters {
  const casters: BlobCaster[] = [];
  for (let at = 0; at < capacity; at += 1) {
    casters.push({
      x: 0,
      z: 0,
      yaw: 0,
      round: true,
      halfAlong: 0,
      halfAcross: 0,
      centreAlong: 0,
      height: 0,
      strength: 1,
    });
  }
  return { casters, count: 0 };
}

/** One blob on the ground, in the horizontal plane. */
export interface GroundBlob {
  x: number;
  z: number;
  /** The rotation about +Y taking +Z onto the blob's long axis. */
  yaw: number;
  halfAlong: number;
  halfAcross: number;
}

/**
 * Where one caster's blob lies under a sun thrown `throwPerMetre`, written into
 * `into`. For a round caster the blob's long axis IS the sun's direction; for
 * a structure it is the building's own, stretched by the shadow's length along
 * and across it — `placeContactShadow`'s arithmetic for a bicycle.
 */
export function placeGroundBlob(
  caster: BlobCaster,
  throwPerMetre: SunThrow,
  into: GroundBlob,
): void {
  const throwX = throwPerMetre.x * caster.height;
  const throwZ = throwPerMetre.z * caster.height;
  const yaw = caster.round
    ? throwX === 0 && throwZ === 0
      ? 0
      : Math.atan2(throwX, throwZ)
    : caster.yaw;
  const alongX = Math.sin(yaw);
  const alongZ = Math.cos(yaw);
  const along = Math.abs(throwX * alongX + throwZ * alongZ);
  const across = Math.abs(throwX * alongZ - throwZ * alongX);
  into.x = caster.x + alongX * caster.centreAlong + throwX * GROUND_BLOB_CAST_SHARE;
  into.z = caster.z + alongZ * caster.centreAlong + throwZ * GROUND_BLOB_CAST_SHARE;
  into.yaw = yaw;
  into.halfAlong = caster.halfAlong + along / 2;
  into.halfAcross = caster.halfAcross + across / 2;
}

/** The ground under a point: its height and its upward unit normal. */
export interface GroundPoint {
  y: number;
  nx: number;
  ny: number;
  nz: number;
}

const COLUMNS = TERRAIN_COLUMN_OFFSETS.length;

/**
 * How many rows either side of the nearest cross-section are searched first
 * for the triangle a point is over. Three: the rows are 2 to 10 m apart, and
 * a point beside a bend can be over a quad whose rows are not the nearest.
 */
const NEAR_ROWS = 3;

/**
 * The ground under `(x, z)` — the height of THIS frame's landform triangle
 * there, and that triangle's normal — written into `into`.
 *
 * `centre` is the corridor the mesh was built from, one cross-section a point.
 * The quads near the nearest cross-section are searched first and then every
 * quad, so a point over ground built from another stretch of road (a
 * hairpin's inside) still finds it.
 *
 * @returns `false` when no triangle is under the point — beyond the mesh, or a
 * mesh that does not match the corridor — and `into` is untouched.
 */
export function groundUnder(
  mesh: TerrainMesh,
  centre: readonly CorridorPoint[],
  x: number,
  z: number,
  into: GroundPoint,
): boolean {
  const rows = mesh.rows;
  if (rows < 2 || centre.length !== rows) return false;
  let nearest = 0;
  let best = Number.POSITIVE_INFINITY;
  for (let row = 0; row < rows; row += 1) {
    const point = centre[row] as CorridorPoint;
    const distance = (point.x - x) ** 2 + (point.z - z) ** 2;
    if (distance < best) {
      best = distance;
      nearest = row;
    }
  }
  const from = Math.max(0, nearest - NEAR_ROWS);
  const to = Math.min(rows - 1, nearest + NEAR_ROWS);
  return quadsUnder(mesh, from, to, x, z, into) || quadsUnder(mesh, 0, rows - 1, x, z, into);
}

/** The first triangle between cross-sections `from` and `to` that `(x, z)` is over. */
function quadsUnder(
  mesh: TerrainMesh,
  from: number,
  to: number,
  x: number,
  z: number,
  into: GroundPoint,
): boolean {
  const perRow = COLUMNS * 2;
  for (let row = from; row < to; row += 1) {
    for (let side = 0; side < 2; side += 1) {
      for (let column = 0; column + 1 < COLUMNS; column += 1) {
        // `landform.ts` §`terrainIndices`' two triangles of this quad:
        // (a, b, c) and (b, d, c).
        const a = row * perRow + side * COLUMNS + column;
        const b = a + 1;
        const c = a + perRow;
        const d = c + 1;
        if (onTriangle(mesh.vertices, a, b, c, x, z, into)) return true;
        if (onTriangle(mesh.vertices, b, d, c, x, z, into)) return true;
      }
    }
  }
  return false;
}

/** Whether `(x, z)` is over triangle `(p, q, r)`, and if so the ground there. */
function onTriangle(
  vertices: Float32Array,
  p: number,
  q: number,
  r: number,
  x: number,
  z: number,
  into: GroundPoint,
): boolean {
  const px = vertices[p * 3] as number;
  const py = vertices[p * 3 + 1] as number;
  const pz = vertices[p * 3 + 2] as number;
  const qx = vertices[q * 3] as number;
  const qy = vertices[q * 3 + 1] as number;
  const qz = vertices[q * 3 + 2] as number;
  const rx = vertices[r * 3] as number;
  const ry = vertices[r * 3 + 1] as number;
  const rz = vertices[r * 3 + 2] as number;
  const ux = qx - px;
  const uz = qz - pz;
  const vx = rx - px;
  const vz = rz - pz;
  const det = ux * vz - uz * vx;
  if (Math.abs(det) < 1e-9) return false;
  const wx = x - px;
  const wz = z - pz;
  const s = (wx * vz - wz * vx) / det;
  const t = (ux * wz - uz * wx) / det;
  const slack = -1e-9;
  if (s < slack || t < slack || s + t > 1 - slack) return false;
  const uy = qy - py;
  const vy = ry - py;
  into.y = py + s * uy + t * vy;
  // The triangle's normal, turned up whichever way it is wound.
  let nx = uy * vz - uz * vy;
  let ny = uz * vx - ux * vz;
  let nz = ux * vy - uy * vx;
  if (ny < 0) {
    nx = -nx;
    ny = -ny;
    nz = -nz;
  }
  const length = Math.hypot(nx, ny, nz);
  into.nx = nx / length;
  into.ny = ny / length;
  into.nz = nz / length;
  return true;
}

/**
 * The most separate stretches of road one blob looks at. Two are kept as
 * planes; the rest fold into them. @see roadClip
 */
const MAXIMUM_STRETCHES = 8;

const stretchNormalX = new Float64Array(MAXIMUM_STRETCHES);
const stretchNormalZ = new Float64Array(MAXIMUM_STRETCHES);
const stretchCut = new Float64Array(MAXIMUM_STRETCHES);
const stretchFrom = new Int32Array(MAXIMUM_STRETCHES);
const stretchTo = new Int32Array(MAXIMUM_STRETCHES);

/**
 * The two half-planes that clip one blob off the carriageway, written into
 * `into` from `offset`: `(nx, nz, c)` twice, in metres from the blob's middle
 * `(x, z)`. A point `(dx, dz)` from the middle is KEPT when
 * `nx·dx + nz·dz ≥ c` for both — {@link keptByRoadClip}. A plane that clips
 * nothing is `(0, 0, −1)`.
 *
 * `reach` is how far from its middle the blob reaches. Only the road within
 * `reach + ROAD_EDGE_METRES` can touch it, so only the cross-sections whose
 * chords can come that close are read, and each contiguous run of them is one
 * stretch of road.
 *
 * Why this is exact, and where it is not: the road is the centreline's chords
 * widened by {@link ROAD_EDGE_METRES}, so its furthest reach along a normal is
 * the furthest of the chords' ENDPOINTS along it, plus the edge. A stretch's
 * plane is placed there, facing the blob from the stretch's nearest point.
 */
export function roadClip(
  centre: readonly CorridorPoint[],
  x: number,
  z: number,
  reach: number,
  into: Float32Array,
  offset = 0,
): void {
  const count = centre.length;
  const limit = reach + ROAD_EDGE_METRES;
  let stretches = 0;
  let open = false;
  for (let index = 0; index < count; index += 1) {
    const point = centre[index] as CorridorPoint;
    const before = index > 0 ? (centre[index - 1] as CorridorPoint) : point;
    const after = index + 1 < count ? (centre[index + 1] as CorridorPoint) : point;
    const chord = Math.max(
      Math.hypot(point.x - before.x, point.z - before.z),
      Math.hypot(after.x - point.x, after.z - point.z),
    );
    const near = Math.hypot(point.x - x, point.z - z) <= limit + chord;
    if (near && !open) {
      if (stretches === MAXIMUM_STRETCHES) {
        // More separate stretches than anywhere this program draws: fold the
        // rest into the last one, which only clips more.
        stretches -= 1;
      } else {
        stretchFrom[stretches] = index;
      }
      open = true;
    }
    if (near) stretchTo[stretches] = index;
    if (!near && open) {
      stretches += 1;
      open = false;
    }
  }
  if (open) stretches += 1;

  for (let stretch = 0; stretch < stretches; stretch += 1) {
    const first = stretchFrom[stretch] as number;
    const last = stretchTo[stretch] as number;
    // The stretch's nearest point to the blob, on its chords.
    let nearestX = (centre[first] as CorridorPoint).x;
    let nearestZ = (centre[first] as CorridorPoint).z;
    let best = (nearestX - x) ** 2 + (nearestZ - z) ** 2;
    for (let index = first; index < last; index += 1) {
      const a = centre[index] as CorridorPoint;
      const b = centre[index + 1] as CorridorPoint;
      const abx = b.x - a.x;
      const abz = b.z - a.z;
      const length = abx * abx + abz * abz;
      const share =
        length > 0 ? Math.min(1, Math.max(0, ((x - a.x) * abx + (z - a.z) * abz) / length)) : 0;
      const px = a.x + abx * share;
      const pz = a.z + abz * share;
      const distance = (px - x) ** 2 + (pz - z) ** 2;
      if (distance < best) {
        best = distance;
        nearestX = px;
        nearestZ = pz;
      }
    }
    let nx = x - nearestX;
    let nz = z - nearestZ;
    const length = Math.hypot(nx, nz);
    if (length < 1e-9) {
      // Standing on the centreline, which no caster does: face any way, and
      // let the cut below take the whole blob.
      nx = 1;
      nz = 0;
    } else {
      nx /= length;
      nz /= length;
    }
    stretchNormalX[stretch] = nx;
    stretchNormalZ[stretch] = nz;
    stretchCut[stretch] = furthestAlong(centre, first, last, nx, nz, x, z);
  }

  // The two that cut deepest are the planes; the rest fold into the one
  // facing most nearly the same way, which only raises its cut.
  let firstPlane = -1;
  let secondPlane = -1;
  for (let stretch = 0; stretch < stretches; stretch += 1) {
    const cut = stretchCut[stretch] as number;
    if (firstPlane < 0 || cut > (stretchCut[firstPlane] as number)) {
      secondPlane = firstPlane;
      firstPlane = stretch;
    } else if (secondPlane < 0 || cut > (stretchCut[secondPlane] as number)) {
      secondPlane = stretch;
    }
  }
  for (let stretch = 0; stretch < stretches; stretch += 1) {
    if (stretch === firstPlane || stretch === secondPlane) continue;
    const nx = stretchNormalX[stretch] as number;
    const nz = stretchNormalZ[stretch] as number;
    const facingFirst =
      nx * (stretchNormalX[firstPlane] as number) + nz * (stretchNormalZ[firstPlane] as number);
    const facingSecond =
      nx * (stretchNormalX[secondPlane] as number) + nz * (stretchNormalZ[secondPlane] as number);
    const kept = facingFirst >= facingSecond ? firstPlane : secondPlane;
    stretchCut[kept] = Math.max(
      stretchCut[kept] as number,
      furthestAlong(
        centre,
        stretchFrom[stretch] as number,
        stretchTo[stretch] as number,
        stretchNormalX[kept] as number,
        stretchNormalZ[kept] as number,
        x,
        z,
      ),
    );
  }
  writePlane(into, offset, firstPlane);
  writePlane(into, offset + 3, secondPlane);
}

/** The furthest any road point of cross-sections `[first, last]` reaches along `(nx, nz)`, from `(x, z)`. */
function furthestAlong(
  centre: readonly CorridorPoint[],
  first: number,
  last: number,
  nx: number,
  nz: number,
  x: number,
  z: number,
): number {
  let furthest = Number.NEGATIVE_INFINITY;
  for (let index = first; index <= last; index += 1) {
    const point = centre[index] as CorridorPoint;
    furthest = Math.max(furthest, nx * (point.x - x) + nz * (point.z - z));
  }
  return furthest + ROAD_EDGE_METRES;
}

function writePlane(into: Float32Array, at: number, stretch: number): void {
  if (stretch < 0) {
    into[at] = 0;
    into[at + 1] = 0;
    into[at + 2] = -1;
    return;
  }
  into[at] = stretchNormalX[stretch] as number;
  into[at + 1] = stretchNormalZ[stretch] as number;
  into[at + 2] = stretchCut[stretch] as number;
}

/**
 * Whether a point `(dx, dz)` metres from a blob's middle is drawn, under the
 * two planes {@link roadClip} wrote at `offset`. The shader's own test,
 * `three-renderer.ts` §`GROUND_BLOB_FRAGMENT`, is this line in GLSL.
 *
 * @test-facing held by `ground-blob.test.ts`' hairpin, which asks it of every
 * sampled point; the shader is the production copy
 */
export function keptByRoadClip(
  planes: Float32Array,
  offset: number,
  dx: number,
  dz: number,
): boolean {
  for (let at = offset; at < offset + 6; at += 3) {
    const nx = planes[at] as number;
    const nz = planes[at + 1] as number;
    const cut = planes[at + 2] as number;
    if (nx * dx + nz * dz < cut) return false;
  }
  return true;
}

/**
 * The blob's three axes as it lies on the ground, written into `into`
 * (nine numbers): the axis ACROSS it scaled by its half-width, the ground's
 * normal, and the axis ALONG it scaled by its half-length — the columns of the
 * instance matrix `three-renderer.ts` draws a unit quad with, so that local
 * `(u, 0, v)` lands at `u · across + v · along` from the middle.
 *
 * The long axis is the blob's horizontal one laid into the ground's plane, so
 * on a slope the blob is as long along the slope as it is on the flat.
 */
export function groundBlobAxes(blob: GroundBlob, ground: GroundPoint, into: Float64Array): void {
  const hx = Math.sin(blob.yaw);
  const hz = Math.cos(blob.yaw);
  const lean = hx * ground.nx + hz * ground.nz;
  let ax = hx - ground.nx * lean;
  let ay = -ground.ny * lean;
  let az = hz - ground.nz * lean;
  const length = Math.hypot(ax, ay, az);
  ax /= length;
  ay /= length;
  az /= length;
  // across = normal × along, which faces the quad up (`three-renderer.ts`
  // winds it for +Y in the local frame).
  const cx = ground.ny * az - ground.nz * ay;
  const cy = ground.nz * ax - ground.nx * az;
  const cz = ground.nx * ay - ground.ny * ax;
  into[0] = cx * blob.halfAcross;
  into[1] = cy * blob.halfAcross;
  into[2] = cz * blob.halfAcross;
  into[3] = ground.nx;
  into[4] = ground.ny;
  into[5] = ground.nz;
  into[6] = ax * blob.halfAlong;
  into[7] = ay * blob.halfAlong;
  into[8] = az * blob.halfAlong;
}
