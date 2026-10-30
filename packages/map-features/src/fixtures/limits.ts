// SPDX-License-Identifier: Apache-2.0

/**
 * A tile at each of #1544's limits, and one over each (`../limits.ts`).
 *
 * Built on demand rather than held: the largest is 4 MiB. Every shape is
 * arithmetic — squares on a grid, lines of evenly spaced points.
 */

import {
  MAX_FEATURES_PER_LAYER,
  MAX_RINGS_PER_POLYGON,
  MAX_TILE_BYTES,
  MAX_VERTICES_PER_FEATURE,
  MAX_VERTICES_PER_TILE,
} from '../limits';
import {
  encodeTile,
  holeRing,
  line,
  outerRing,
  padTileTo,
  polygon,
  rectangle,
  type FeatureSpec,
} from '../testing/mvt-encoder';
import { EARTH } from './tiles';

export type LimitName =
  'bytes' | 'featuresPerLayer' | 'verticesPerFeature' | 'verticesPerTile' | 'ringsPerPolygon';

/** `count` small building footprints on a grid. */
function footprints(count: number): FeatureSpec[] {
  const out: FeatureSpec[] = [];
  for (let k = 0; k < count; k++) {
    const x0 = 100 + (k % 140) * 27;
    const y0 = 100 + Math.floor(k / 140) * 27;
    out.push({
      type: 3,
      tags: { kind: 'building' },
      geometry: polygon([outerRing(rectangle(x0, y0, x0 + 10, y0 + 10))]),
    });
  }
  return out;
}

/** A footway line of `vertices` points, `row` picking which band of the tile it runs in. */
function footway(vertices: number, row: number): FeatureSpec {
  const pts: [number, number][] = [];
  for (let i = 0; i < vertices; i++) {
    pts.push([100 + (i % 3800), 100 + row * 70 + Math.floor(i / 3800) * 3]);
  }
  return { type: 2, tags: { kind: 'path', kind_detail: 'footway' }, geometry: line([pts]) };
}

/** One polygon of `rings` rings: an outer square and `rings − 1` square holes on a grid. */
function holed(rings: number): FeatureSpec {
  const all = [outerRing(rectangle(100, 100, 3900, 3900))];
  for (let i = 0; i < rings - 1; i++) {
    const x0 = 300 + (i % 17) * 200;
    const y0 = 300 + Math.floor(i / 17) * 200;
    all.push(holeRing(rectangle(x0, y0, x0 + 50, y0 + 50)));
  }
  return { type: 3, tags: { kind: 'wood' }, geometry: polygon(all) };
}

/** Lines totalling `total` vertices, none over the per-feature limit. */
function footwaysTotalling(total: number): FeatureSpec[] {
  const out: FeatureSpec[] = [];
  let left = total;
  for (let row = 0; left > 0; row++) {
    const n = Math.min(8_000, left);
    out.push(footway(Math.max(2, n), row));
    left -= n;
  }
  return out;
}

const SMALL_TILE = (): Uint8Array =>
  encodeTile([EARTH, { name: 'buildings', features: footprints(3) }]);

/** `count` building footprints on a grid: the feature-limit fixtures, at any size. */
export function footprintTile(count: number): Uint8Array {
  return encodeTile([EARTH, { name: 'buildings', features: footprints(count) }]);
}

/** Footways totalling `vertices`: the tile-vertex-limit fixtures, at any size. */
export function footwayTile(vertices: number): Uint8Array {
  return encodeTile([EARTH, { name: 'roads', features: footwaysTotalling(vertices) }]);
}

/** A tile exactly at the named limit; it must decode. */
export function tileAtLimit(limit: LimitName): Uint8Array {
  switch (limit) {
    case 'bytes':
      return padTileTo(SMALL_TILE(), MAX_TILE_BYTES);
    case 'featuresPerLayer':
      return footprintTile(MAX_FEATURES_PER_LAYER);
    case 'verticesPerFeature':
      return encodeTile([
        EARTH,
        { name: 'roads', features: [footway(MAX_VERTICES_PER_FEATURE, 0)] },
      ]);
    case 'verticesPerTile':
      return footwayTile(MAX_VERTICES_PER_TILE);
    case 'ringsPerPolygon':
      return encodeTile([EARTH, { name: 'landuse', features: [holed(MAX_RINGS_PER_POLYGON)] }]);
  }
}

/** A tile one over the named limit; it must be refused. */
export function tileOverLimit(limit: LimitName): Uint8Array {
  switch (limit) {
    case 'bytes':
      return padTileTo(SMALL_TILE(), MAX_TILE_BYTES + 1);
    case 'featuresPerLayer':
      return footprintTile(MAX_FEATURES_PER_LAYER + 1);
    case 'verticesPerFeature':
      return encodeTile([
        EARTH,
        { name: 'roads', features: [footway(MAX_VERTICES_PER_FEATURE + 1, 0)] },
      ]);
    case 'verticesPerTile':
      return footwayTile(MAX_VERTICES_PER_TILE + 1);
    case 'ringsPerPolygon':
      return encodeTile([EARTH, { name: 'landuse', features: [holed(MAX_RINGS_PER_POLYGON + 1)] }]);
  }
}

export const LIMIT_NAMES: readonly LimitName[] = [
  'bytes',
  'featuresPerLayer',
  'verticesPerFeature',
  'verticesPerTile',
  'ringsPerPolygon',
];
