// SPDX-License-Identifier: Apache-2.0

/**
 * Synthetic street graphs for the rolling route's tests (#2895), and for the
 * open-world tests in `apps/web` that ride one (#2897). Never a real place:
 * every graph here is laid out in metres from one arbitrary origin.
 */

import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  type GeographicPosition,
} from '../quantities';

import type { RollingEdge, RollingPoint, RollingStreetGraph } from './rolling';

const METRES_PER_DEGREE_LATITUDE = 111_194.9;
const ORIGIN_LATITUDE = 40;
const ORIGIN_LONGITUDE = -105;

/** The position `east` and `north` metres from the synthetic origin. */
export function placeAt(east: number, north: number): GeographicPosition {
  const perDegreeLongitude =
    METRES_PER_DEGREE_LATITUDE * Math.cos((ORIGIN_LATITUDE * Math.PI) / 180);
  return geographicPosition(
    degreesLatitude(ORIGIN_LATITUDE + north / METRES_PER_DEGREE_LATITUDE),
    degreesLongitude(ORIGIN_LONGITUDE + east / perDegreeLongitude),
  );
}

/** Ground for a synthetic graph: a height for every place, in metres. */
export type SyntheticGround = (east: number, north: number) => number;

/** Rolling hills with a little noise: rough enough that a wrong window shows. */
export const roughGround: SyntheticGround = (east, north) => {
  const noise = Math.sin(east * 12.9898 + north * 78.233) * 43_758.5453;
  return (
    1_600 + 20 * Math.sin(east / 170) + 15 * Math.cos(north / 230) + 2 * (noise - Math.floor(noise))
  );
};

function point(east: number, north: number, ground: SyntheticGround): RollingPoint {
  return { position: placeAt(east, north), elevation: altitudeMetres(ground(east, north)) };
}

/** A street through `stops` (east, north pairs), with a point every `step` metres or so between them. */
export function streetThrough(
  stops: readonly (readonly [number, number])[],
  ground: SyntheticGround,
): RollingPoint[] {
  const points: RollingPoint[] = [];
  for (let index = 0; index < stops.length; index += 1) {
    const [east, north] = stops[index] as readonly [number, number];
    if (index > 0) {
      const [fromEast, fromNorth] = stops[index - 1] as readonly [number, number];
      // An irregular point inside each stretch, so a sample is interpolated
      // between source points that do not sit on the 10 m grid.
      const share = 0.37;
      points.push(
        point(
          fromEast + (east - fromEast) * share,
          fromNorth + (north - fromNorth) * share,
          ground,
        ),
      );
    }
    points.push(point(east, north, ground));
  }
  return points;
}

/** A graph from undirected streets, each given once from one end. */
export function graphOf(edges: readonly RollingEdge[]): RollingStreetGraph {
  const from = new Map<string, RollingEdge[]>();
  const add = (edge: RollingEdge): void => {
    const list = from.get(edge.from) ?? [];
    list.push(edge);
    from.set(edge.from, list);
  };
  for (const edge of edges) {
    add(edge);
    add({ ...edge, from: edge.to, to: edge.from, points: [...edge.points].reverse() });
  }
  return { edgesFrom: (node) => from.get(node) ?? [] };
}

/**
 * A street grid whose columns and rows are spaced unevenly, so the ways on
 * from one junction are of different lengths (ADR 0087's constraint on #2895).
 * Node `c,r` is column `c`, row `r`. Every street is road class 1, except the
 * row and column `major` (when given), which are class 2.
 */
export function gridGraph(
  columns: readonly number[],
  rows: readonly number[],
  ground: SyntheticGround = roughGround,
  major?: number,
): { readonly graph: RollingStreetGraph; readonly edges: readonly RollingEdge[] } {
  const edges: RollingEdge[] = [];
  for (const [c, east] of columns.entries()) {
    for (const [r, north] of rows.entries()) {
      const nextEast = columns[c + 1];
      if (nextEast !== undefined) {
        edges.push({
          id: `h${c},${r}`,
          from: `${c},${r}`,
          to: `${c + 1},${r}`,
          points: streetThrough(
            [
              [east, north],
              [nextEast, north],
            ],
            ground,
          ),
          roadClass: r === major ? 2 : 1,
        });
      }
      const nextNorth = rows[r + 1];
      if (nextNorth !== undefined) {
        edges.push({
          id: `v${c},${r}`,
          from: `${c},${r}`,
          to: `${c},${r + 1}`,
          points: streetThrough(
            [
              [east, north],
              [east, nextNorth],
            ],
            ground,
          ),
          roadClass: c === major ? 2 : 1,
        });
      }
    }
  }
  return { graph: graphOf(edges), edges };
}
