// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The realistic riders' bike-shaped shadow — #626, option 1: a silhouette
 * made once, cast every frame by arithmetic.
 *
 * ## One picture, every heading and every sun
 *
 * #626 offered a silhouette "rendered orthographically along the sun" — but a
 * rider turns, so the sun's direction in the BICYCLE's frame changes on every
 * bend, and a picture taken along one sun is the wrong shape at every other
 * heading. What is made instead is the rider and bicycle seen from the SIDE —
 * {@link rasteriseSilhouette}, along the bicycle against height, with how far
 * each covered texel reaches across the bicycle kept beside it — and the
 * shadow is thrown from that picture every frame: a point `y` up, `z` along
 * and `x` across lands on the ground at `x + y·t_a` across and `z + y·t_c`
 * along, where `(t_a, t_c)` is the sun's throw per metre of height in the
 * bicycle's own frame ({@link silhouetteThrow}). The picture does not depend
 * on the sun or the heading at all, so it is made once, when the realistic
 * rider is, and never again — where #626 expected to remake it per route.
 *
 * ⚠️ **What it gets wrong, stated.** The body is treated as thin across the
 * bicycle: each texel of the side view is a segment `±reach` wide, which is
 * right for a wheel, a tube and a torso seen from the side and slightly
 * generous for the bars. The legs are drawn at one pose (the cranks level) and
 * do not turn in the shadow — #626 accepted that for this option. And like the
 * round blob it lies level with the bicycle on a road that climbs
 * (`contact-shadow.ts` §"What it gets wrong").
 *
 * ## Where the arithmetic runs
 *
 * `three-renderer.ts` §`RiderSilhouetteBelt` draws it: one instanced quad a
 * casting rider, a fragment shader that walks up the heights that could have
 * cast onto each ground point ({@link SILHOUETTE_TAPS} of them) and reads the
 * picture there. {@link silhouetteCoverage} is that shader in TypeScript, for
 * the tests; the browser gate reads the shipped shader off the drawing buffer.
 *
 * Who casts one is `contact-shadow.ts` §`CASTS_CONTACT_SHADOW` — the ghost does
 * not (#426, #93) — and the sun is `world.ts`'s one sun through
 * `contact-shadow.ts` §`sunThrowPerMetre`. Pure: no `three`, no clock.
 */

import { combinedLean } from './bicycle';
import { CASTS_CONTACT_SHADOW, sunThrowPerMetre, type SunThrow } from './contact-shadow';
import type { RiderMarker } from './port';
import type { SunStyle } from './world';

/** The silhouette's texels ALONG the bicycle: **256**. */
export const SILHOUETTE_ALONG_TEXELS = 256;

/** The silhouette's texels UP: **128**. */
export const SILHOUETTE_UP_TEXELS = 128;

/**
 * The silhouette's bytes on the GPU: two 8-bit channels — covered, and how far
 * across it reaches — at {@link SILHOUETTE_ALONG_TEXELS} ×
 * {@link SILHOUETTE_UP_TEXELS}, with no mipmaps: **64 KiB**, inside #626's
 * 128 KiB (`realistic-budget.ts` §`REALISTIC_RIDER_SILHOUETTE_BYTES`).
 *
 * @test-facing held by `rider-silhouette.test.ts` against that ceiling and
 * against the texture the belt builds; the belt sizes the texture from the
 * two texel counts
 */
export const SILHOUETTE_TEXTURE_BYTES = SILHOUETTE_ALONG_TEXELS * SILHOUETTE_UP_TEXELS * 2;

/**
 * How many heights the shader reads for one ground point: **32**. Over the
 * tallest range a ground point can be cast from (the rider's whole height,
 * when the sun is straight along the bicycle) that is a tap every 5 cm of
 * height — about 3 cm along the ground under the lowest sun `world.ts` has.
 */
export const SILHOUETTE_TAPS = 32;

/**
 * How much a covered texel's reach is softened either side, in metres: 1 cm,
 * so a tube's shadow has an edge rather than a stair.
 */
export const SILHOUETTE_EDGE_METRES = 0.01;

/** How much room the quad leaves round the cast silhouette, in metres. */
export const SILHOUETTE_MARGIN_METRES = 0.05;

/** Where the side view sits in the bicycle's frame, and how far it reaches across. */
export interface SilhouetteBounds {
  /** The rearmost and foremost `z` the picture spans. */
  readonly zMin: number;
  readonly zMax: number;
  /** The picture's top, in metres above the road; its bottom is the road. */
  readonly height: number;
  /** The furthest any covered texel reaches across the bicycle, `|x|`. */
  readonly reach: number;
}

/** The side view: its bounds, and two bytes a texel — covered, and reach as a share of `bounds.reach`. */
export interface RiderSilhouette {
  readonly bounds: SilhouetteBounds;
  /** Row by row from the road up, `SILHOUETTE_ALONG_TEXELS` a row, red then green. */
  readonly texels: Uint8Array;
}

/**
 * The rider and bicycle seen from the side, from their triangles — #626.
 *
 * `positions` is every triangle's three corners, `x, y, z` each, in the
 * bicycle's own frame (`+Z` forward, `+Y` up, `+X` across), unindexed. Each
 * triangle is filled where it covers a texel's centre, and the texel keeps the
 * largest `|x|` found there. Nothing under the road (`y < 0`) is drawn.
 *
 * @throws on a list that is not whole triangles or holds no triangle at all.
 */
export function rasteriseSilhouette(positions: Float32Array): RiderSilhouette {
  if (positions.length === 0 || positions.length % 9 !== 0) {
    throw new Error(`a silhouette needs whole triangles, not ${String(positions.length)} numbers`);
  }
  let zMin = Number.POSITIVE_INFINITY;
  let zMax = Number.NEGATIVE_INFINITY;
  let height = 0;
  let reach = 0;
  for (let at = 0; at < positions.length; at += 3) {
    const x = positions[at] as number;
    const y = positions[at + 1] as number;
    const z = positions[at + 2] as number;
    zMin = Math.min(zMin, z);
    zMax = Math.max(zMax, z);
    height = Math.max(height, y);
    reach = Math.max(reach, Math.abs(x));
  }
  const bounds: SilhouetteBounds = { zMin, zMax, height, reach };
  const across = SILHOUETTE_ALONG_TEXELS;
  const up = SILHOUETTE_UP_TEXELS;
  const texelZ = (zMax - zMin) / across;
  const texelY = height / up;
  const reaches = new Float32Array(across * up).fill(-1);
  for (let at = 0; at < positions.length; at += 9) {
    const ax = positions[at] as number;
    const ay = positions[at + 1] as number;
    const az = positions[at + 2] as number;
    const bx = positions[at + 3] as number;
    const by = positions[at + 4] as number;
    const bz = positions[at + 5] as number;
    const cx = positions[at + 6] as number;
    const cy = positions[at + 7] as number;
    const cz = positions[at + 8] as number;
    // The triangle in (z, y); its area's sign is its winding, which a side
    // view does not care about.
    const area = (bz - az) * (cy - ay) - (cz - az) * (by - ay);
    // A triangle seen edge-on covers no texel centre of its own; the
    // triangles beside it do.
    if (area === 0) continue;
    const lowColumn = Math.max(0, Math.floor((Math.min(az, bz, cz) - zMin) / texelZ));
    const highColumn = Math.min(across - 1, Math.floor((Math.max(az, bz, cz) - zMin) / texelZ));
    const lowRow = Math.max(0, Math.floor(Math.min(ay, by, cy) / texelY));
    const highRow = Math.min(up - 1, Math.floor(Math.max(ay, by, cy) / texelY));
    for (let row = lowRow; row <= highRow; row += 1) {
      const y = (row + 0.5) * texelY;
      for (let column = lowColumn; column <= highColumn; column += 1) {
        const z = zMin + (column + 0.5) * texelZ;
        const u = ((z - az) * (cy - ay) - (cz - az) * (y - ay)) / area;
        const v = ((bz - az) * (y - ay) - (z - az) * (by - ay)) / area;
        if (u < 0 || v < 0 || u + v > 1) continue;
        const x = Math.abs(ax + u * (bx - ax) + v * (cx - ax));
        const index = row * across + column;
        if (x > (reaches[index] as number)) reaches[index] = x;
      }
    }
  }
  const texels = new Uint8Array(across * up * 2);
  for (let index = 0; index < across * up; index += 1) {
    const found = reaches[index] as number;
    if (found < 0) continue;
    texels[index * 2] = 255;
    texels[index * 2 + 1] = reach > 0 ? Math.round((found / reach) * 255) : 0;
  }
  return { bounds, texels };
}

/**
 * The sun's throw per metre of height in one rider's own frame, and leaning
 * with them — written into `into`. `across` is along the bicycle's `+X`
 * (`(headingZ, −headingX)` on the ground), `along` along its heading.
 *
 * A rider leaning `φ` (`bicycle.ts` §`combinedLean` — the pair's, as
 * `contact-shadow.ts` throws the blob, #586) holds a point `y` up at `−y·sin φ`
 * across and `y·cos φ` up, so its shadow lands at `y·(t_a·cos φ − sin φ)`
 * across and `y·t_c·cos φ` along: the throw of a leaning rider is that.
 *
 * ⚠️ **Only the height term is leaned — an approximation, stated.** A point
 * `x` across the bicycle, leaned, lands at `x·(cos φ + t_a·sin φ)` across and
 * gains `x·sin φ·t_c` along; both are dropped, so the picture's width is
 * thrown as if the rider were upright. The error is at most `bounds.reach`
 * times `|cos φ + t_a·sin φ − 1|` across and `sin φ·|t_c|` along — a few
 * centimetres at `racing-line.ts`'s 38.7° cap. The lean branch is unit-tested
 * for its sign only, and the browser gate rides a level, straight route, so
 * no gate compares a LEANING silhouette with the twin (#872's review).
 *
 * @returns whether this rider casts one — `false` for the ghost
 * (`contact-shadow.ts` §`CASTS_CONTACT_SHADOW`) and under a sun at or below the
 * horizon; `into` is then untouched. Allocates nothing.
 */
export function silhouetteThrow(
  marker: RiderMarker,
  sun: Pick<SunStyle, 'x' | 'y' | 'z'>,
  into: SunThrow,
): boolean {
  if (!Object.hasOwn(CASTS_CONTACT_SHADOW, marker.kind) || !CASTS_CONTACT_SHADOW[marker.kind]) {
    return false;
  }
  if (!sunThrowPerMetre(sun, THROW)) {
    return false;
  }
  const across = THROW.x * marker.headingZ - THROW.z * marker.headingX;
  const along = THROW.x * marker.headingX + THROW.z * marker.headingZ;
  const lean = combinedLean(marker.lean, marker.bodyLean);
  into.x = across * Math.cos(lean) - Math.sin(lean);
  into.z = along * Math.cos(lean);
  return true;
}

/** Reused by {@link silhouetteThrow}, which runs for every rider on every frame. */
const THROW: SunThrow = { x: 0, z: 0 };

/**
 * The ground rectangle a cast silhouette can cover, in the bicycle's frame.
 *
 * @test-facing the type of {@link silhouetteFootprint}, whose reason applies
 */
export interface SilhouetteFootprint {
  acrossMin: number;
  acrossMax: number;
  alongMin: number;
  alongMax: number;
}

/**
 * Where on the ground, in the bicycle's frame, a silhouette thrown by `thrown`
 * can land — the quad the shader is run over — written into `into`. The
 * picture's four corners cast, widened by its reach and a margin.
 *
 * @test-facing the vertex shader's own arithmetic (`three-renderer.ts`
 * §`SILHOUETTE_VERTEX`) in TypeScript: `rider-silhouette.test.ts` holds that
 * nothing {@link silhouetteCoverage} covers falls outside it, and
 * `realistic-textures.test.ts` measures the real shadow over it
 */
export function silhouetteFootprint(
  bounds: SilhouetteBounds,
  thrown: SunThrow,
  into: SilhouetteFootprint,
): SilhouetteFootprint {
  const topAcross = bounds.height * thrown.x;
  const topAlong = bounds.height * thrown.z;
  const edge = bounds.reach + SILHOUETTE_MARGIN_METRES;
  into.acrossMin = Math.min(0, topAcross) - edge;
  into.acrossMax = Math.max(0, topAcross) + edge;
  into.alongMin = bounds.zMin + Math.min(0, topAlong) - SILHOUETTE_MARGIN_METRES;
  into.alongMax = bounds.zMax + Math.max(0, topAlong) + SILHOUETTE_MARGIN_METRES;
  return into;
}

/**
 * How covered one ground point is, 0 to 1 — the shader's own arithmetic in
 * TypeScript, #626. `across` and `along` are the point in the bicycle's frame,
 * from the marker's origin on the road.
 *
 * Every height that could have cast onto the point is one where `|x|` —
 * `across − y·t_a` — is inside the picture's largest reach; the shader reads
 * {@link SILHOUETTE_TAPS} of them, evenly, and keeps the most covered. Texels
 * are read NEAREST here; the shader's texture filter is linear, which only
 * softens an edge by a texel.
 *
 * @test-facing held by `rider-silhouette.test.ts`, which measures a cast
 * shadow's shape with it; the shipped shader is `three-renderer.ts`
 * §`SILHOUETTE_FRAGMENT`, which the browser gate reads off the drawing buffer
 */
export function silhouetteCoverage(
  silhouette: RiderSilhouette,
  thrown: SunThrow,
  across: number,
  along: number,
): number {
  const { zMin, zMax, height, reach } = silhouette.bounds;
  let low = 0;
  let high = height;
  if (Math.abs(thrown.x) > 1e-4) {
    const a = (across - reach) / thrown.x;
    const b = (across + reach) / thrown.x;
    low = Math.max(0, Math.min(a, b));
    high = Math.min(height, Math.max(a, b));
  }
  if (high < low) return 0;
  let cover = 0;
  for (let tap = 0; tap < SILHOUETTE_TAPS; tap += 1) {
    const y = low + ((high - low) * (tap + 0.5)) / SILHOUETTE_TAPS;
    const z = along - y * thrown.z;
    const x = Math.abs(across - y * thrown.x);
    const u = (z - zMin) / (zMax - zMin);
    const v = y / height;
    if (u < 0 || u >= 1 || v < 0 || v >= 1) continue;
    const column = Math.floor(u * SILHOUETTE_ALONG_TEXELS);
    const row = Math.floor(v * SILHOUETTE_UP_TEXELS);
    const index = (row * SILHOUETTE_ALONG_TEXELS + column) * 2;
    const covered = (silhouette.texels[index] as number) / 255;
    const edge = ((silhouette.texels[index + 1] as number) / 255) * reach;
    const inside = 1 - smoothstep(edge - SILHOUETTE_EDGE_METRES, edge + SILHOUETTE_EDGE_METRES, x);
    cover = Math.max(cover, covered * inside);
  }
  return cover;
}

/** GLSL's `smoothstep`. */
function smoothstep(low: number, high: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - low) / (high - low)));
  return t * t * (3 - 2 * t);
}

/**
 * The covered shape's aspect ALONG the bicycle, from a grid of coverage
 * samples — #626's measure: the root of the ratio of the covered area's second
 * moments along and across, which is 1 for a disc and its length over its
 * width for a long, thin thing. `covered(across, along)` answers one point;
 * the grid spans the rectangle given, `step` apart.
 *
 * @test-facing held by `realistic-textures.test.ts`, which prints it beside
 * the round blob's to show why #626's aspect criterion cannot tell the two
 * apart
 */
export function coveredAspect(
  covered: (across: number, along: number) => boolean,
  footprint: SilhouetteFootprint,
  step: number,
): number {
  let count = 0;
  let sumA = 0;
  let sumC = 0;
  let sumAA = 0;
  let sumCC = 0;
  for (let a = footprint.acrossMin; a <= footprint.acrossMax; a += step) {
    for (let c = footprint.alongMin; c <= footprint.alongMax; c += step) {
      if (!covered(a, c)) continue;
      count += 1;
      sumA += a;
      sumC += c;
      sumAA += a * a;
      sumCC += c * c;
    }
  }
  if (count === 0) return Number.NaN;
  const varianceA = sumAA / count - (sumA / count) ** 2;
  const varianceC = sumCC / count - (sumC / count) ** 2;
  return Math.sqrt(varianceC / Math.max(varianceA, 1e-12));
}
