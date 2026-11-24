// SPDX-License-Identifier: Apache-2.0

/**
 * The street graph's synthetic fixtures (#2894): each a handful of straight
 * streets drawn in tile pixels, encoded as real z15 tiles by
 * `../testing/mvt-encoder.ts` and read back through `decodeTile`, so the graph
 * is tested on what the decoder hands it. **No OpenStreetMap data of any
 * kind**, as `tiles.ts` says: every line is arithmetic.
 *
 * Pixels are counted from the north-west corner of {@link FIXTURE_TILE}, so a
 * pixel column of 4096 or more lies in its eastern neighbour,
 * {@link EAST_TILE}. Every tile a fixture names carries **every** street of
 * the fixture, shifted into its own pixels: the graph must clip each to its
 * own box, as it clips the buffer two real tiles share.
 *
 * A z15 pixel here is about 0.23 m, so {@link SNAP_METRES}' 1 m is about four
 * pixels and {@link T_SNAP_METRES}' 3 m about thirteen.
 */

import { localMetres } from '../projection';
import { latitudeAtRow, longitudeAtColumn } from '../projection';
import type { StreetGraphEdge, StreetNodeKind } from '../street-graph';
import { encodeTile, line, type LayerSpec, type TagValue } from '../testing/mvt-encoder';
import type { StreetOneway, TileId } from '../types';
import { EARTH, FIXTURE_EXTENT, FIXTURE_FRAME, FIXTURE_TILE } from './tiles';

/** {@link FIXTURE_TILE}'s eastern neighbour: pixel columns 4096 to 8191 of a fixture. */
export const EAST_TILE: TileId = { z: 15, x: FIXTURE_TILE.x + 1, y: FIXTURE_TILE.y };

/** {@link FIXTURE_TILE}'s southern neighbour: pixel rows 4096 to 8191 of a fixture. */
export const SOUTH_TILE: TileId = { z: 15, x: FIXTURE_TILE.x, y: FIXTURE_TILE.y + 1 };

/** {@link FIXTURE_TILE}'s south-eastern neighbour, across its corner at pixel (4096, 4096). */
export const SOUTH_EAST_TILE: TileId = { z: 15, x: FIXTURE_TILE.x + 1, y: FIXTURE_TILE.y + 1 };

export type Pixel = readonly [number, number];

/** One street of a fixture: its tags and its line, in fixture pixels. */
export interface GraphFixtureStreet {
  readonly tags: Readonly<Record<string, TagValue>>;
  readonly line: readonly Pixel[];
}

/** A node a fixture must make: where, what, and how many edge ends meet there. */
export interface ExpectedNode {
  readonly at: Pixel;
  readonly kind: StreetNodeKind;
  readonly degree: number;
}

/** An edge a fixture must make, from one node's pixel to another's, with its fields. */
export interface ExpectedEdge {
  readonly from: Pixel;
  readonly to: Pixel;
  readonly kind: string;
  readonly grade?: StreetGraphEdge['grade'];
  readonly oneway?: StreetOneway;
  readonly isLink?: boolean;
  /** Points on its line, its two nodes' included. */
  readonly points: number;
}

export interface GraphFixture {
  readonly tiles: readonly TileId[];
  readonly streets: readonly GraphFixtureStreet[];
  readonly nodes: readonly ExpectedNode[];
  readonly edges: readonly ExpectedEdge[];
}

const minor = { kind: 'minor_road' } as const;
const primary = { kind: 'major_road', kind_detail: 'primary' } as const;

/** The eight corners of a regular octagon about `(cx, cy)`, east first, whole pixels. */
function octagon(cx: number, cy: number, radius: number): Pixel[] {
  const out: Pixel[] = [];
  for (let k = 0; k <= 8; k++) {
    const angle = (k * Math.PI) / 4;
    out.push([
      Math.round(cx + radius * Math.cos(angle)),
      Math.round(cy - radius * Math.sin(angle)),
    ]);
  }
  return out;
}

const RING = octagon(2000, 2000, 160);

/**
 * The seven shapes #2894 names, and more: the ways the graph leaves out
 * (ADR 0091 D-3), and a street straight across each kind of seam (east,
 * south and a corner) for the add and remove tests.
 */
export const GRAPH_FIXTURES = {
  /** A side street ending 6 px (about 1.4 m) short of a through street: a T-snap. */
  tJunction: {
    tiles: [FIXTURE_TILE],
    streets: [
      {
        tags: minor,
        line: [
          [500, 1000],
          [3500, 1000],
        ],
      },
      {
        tags: minor,
        line: [
          [2000, 2500],
          [2000, 1006],
        ],
      },
    ],
    nodes: [
      { at: [500, 1000], kind: 'dead-end', degree: 1 },
      { at: [3500, 1000], kind: 'dead-end', degree: 1 },
      { at: [2000, 1000], kind: 'junction', degree: 3 },
      { at: [2000, 2500], kind: 'dead-end', degree: 1 },
    ],
    edges: [
      { from: [500, 1000], to: [2000, 1000], kind: 'minor_road', points: 2 },
      { from: [2000, 1000], to: [3500, 1000], kind: 'minor_road', points: 2 },
      { from: [2000, 2500], to: [2000, 1000], kind: 'minor_road', points: 2 },
    ],
  },
  /** Two streets crossing between their vertices: a crossing. */
  crossroads: {
    tiles: [FIXTURE_TILE],
    streets: [
      {
        tags: primary,
        line: [
          [500, 1000],
          [3500, 1000],
        ],
      },
      {
        tags: minor,
        line: [
          [2000, 200],
          [2000, 3000],
        ],
      },
    ],
    nodes: [
      { at: [2000, 1000], kind: 'junction', degree: 4 },
      { at: [500, 1000], kind: 'dead-end', degree: 1 },
      { at: [3500, 1000], kind: 'dead-end', degree: 1 },
      { at: [2000, 200], kind: 'dead-end', degree: 1 },
      { at: [2000, 3000], kind: 'dead-end', degree: 1 },
    ],
    edges: [
      { from: [500, 1000], to: [2000, 1000], kind: 'major_road', points: 2 },
      { from: [2000, 1000], to: [3500, 1000], kind: 'major_road', points: 2 },
      { from: [2000, 200], to: [2000, 1000], kind: 'minor_road', points: 2 },
      { from: [2000, 1000], to: [2000, 3000], kind: 'minor_road', points: 2 },
    ],
  },
  /**
   * A street crossed by a bridge, a vertex of each exactly on the other, and
   * by a tunnel: no junction at either. The bridge's ends meet its approaches,
   * at grade.
   */
  bridge: {
    tiles: [FIXTURE_TILE],
    streets: [
      {
        tags: minor,
        line: [
          [500, 1000],
          [2000, 1000],
          [3500, 1000],
        ],
      },
      {
        tags: minor,
        line: [
          [2000, 200],
          [2000, 600],
        ],
      },
      {
        tags: { ...primary, kind_detail: 'secondary', is_bridge: true },
        line: [
          [2000, 600],
          [2000, 1000],
          [2000, 1400],
        ],
      },
      {
        tags: minor,
        line: [
          [2000, 1400],
          [2000, 2200],
        ],
      },
      {
        tags: { ...minor, is_tunnel: true },
        line: [
          [3000, 700],
          [3000, 1300],
        ],
      },
    ],
    nodes: [
      { at: [500, 1000], kind: 'dead-end', degree: 1 },
      { at: [3500, 1000], kind: 'dead-end', degree: 1 },
      { at: [2000, 200], kind: 'dead-end', degree: 1 },
      { at: [2000, 600], kind: 'join', degree: 2 },
      { at: [2000, 1400], kind: 'join', degree: 2 },
      { at: [2000, 2200], kind: 'dead-end', degree: 1 },
      { at: [3000, 700], kind: 'dead-end', degree: 1 },
      { at: [3000, 1300], kind: 'dead-end', degree: 1 },
    ],
    edges: [
      { from: [500, 1000], to: [3500, 1000], kind: 'minor_road', grade: 'ground', points: 3 },
      { from: [2000, 200], to: [2000, 600], kind: 'minor_road', grade: 'ground', points: 2 },
      { from: [2000, 600], to: [2000, 1400], kind: 'major_road', grade: 'bridge', points: 3 },
      { from: [2000, 1400], to: [2000, 2200], kind: 'minor_road', grade: 'ground', points: 2 },
      { from: [3000, 700], to: [3000, 1300], kind: 'minor_road', grade: 'tunnel', points: 2 },
    ],
  },
  /**
   * A junction exactly on the seam between the two tiles: the through street
   * crosses it, and the side street starts on it and runs into the east tile.
   */
  seamJunction: {
    tiles: [FIXTURE_TILE, EAST_TILE],
    streets: [
      {
        tags: minor,
        line: [
          [2000, 1000],
          [6000, 1000],
        ],
      },
      {
        tags: minor,
        line: [
          [4096, 1000],
          [5000, 2500],
        ],
      },
    ],
    nodes: [
      { at: [2000, 1000], kind: 'dead-end', degree: 1 },
      { at: [4096, 1000], kind: 'junction', degree: 3 },
      { at: [6000, 1000], kind: 'dead-end', degree: 1 },
      { at: [5000, 2500], kind: 'dead-end', degree: 1 },
    ],
    edges: [
      { from: [2000, 1000], to: [4096, 1000], kind: 'minor_road', points: 2 },
      { from: [4096, 1000], to: [6000, 1000], kind: 'minor_road', points: 2 },
      { from: [4096, 1000], to: [5000, 2500], kind: 'minor_road', points: 2 },
    ],
  },
  /**
   * A one-way octagonal ring with four streets ending on its corners: four
   * ordinary junctions (ADR 0091 D-5), the ring's edges keeping its `oneway`.
   */
  roundabout: {
    tiles: [FIXTURE_TILE],
    streets: [
      { tags: { ...minor, oneway: 'yes' }, line: RING },
      {
        tags: minor,
        line: [
          [2160, 2000],
          [3000, 2000],
        ],
      },
      {
        tags: minor,
        line: [
          [2000, 1840],
          [2000, 1000],
        ],
      },
      {
        tags: minor,
        line: [
          [1840, 2000],
          [1000, 2000],
        ],
      },
      {
        tags: minor,
        line: [
          [2000, 2160],
          [2000, 3000],
        ],
      },
    ],
    nodes: [
      { at: [2160, 2000], kind: 'junction', degree: 3 },
      { at: [2000, 1840], kind: 'junction', degree: 3 },
      { at: [1840, 2000], kind: 'junction', degree: 3 },
      { at: [2000, 2160], kind: 'junction', degree: 3 },
      { at: [3000, 2000], kind: 'dead-end', degree: 1 },
      { at: [2000, 1000], kind: 'dead-end', degree: 1 },
      { at: [1000, 2000], kind: 'dead-end', degree: 1 },
      { at: [2000, 3000], kind: 'dead-end', degree: 1 },
    ],
    edges: [
      { from: [2160, 2000], to: [2000, 1840], kind: 'minor_road', oneway: 'with-line', points: 3 },
      { from: [2000, 1840], to: [1840, 2000], kind: 'minor_road', oneway: 'with-line', points: 3 },
      { from: [1840, 2000], to: [2000, 2160], kind: 'minor_road', oneway: 'with-line', points: 3 },
      { from: [2000, 2160], to: [2160, 2000], kind: 'minor_road', oneway: 'with-line', points: 3 },
      { from: [2160, 2000], to: [3000, 2000], kind: 'minor_road', oneway: 'no', points: 2 },
      { from: [2000, 1840], to: [2000, 1000], kind: 'minor_road', oneway: 'no', points: 2 },
      { from: [1840, 2000], to: [1000, 2000], kind: 'minor_road', oneway: 'no', points: 2 },
      { from: [2000, 2160], to: [2000, 3000], kind: 'minor_road', oneway: 'no', points: 2 },
    ],
  },
  /**
   * A closed loop that meets nothing: its two ends are one node, a join, and
   * it is one edge from that node back to it.
   */
  loop: {
    tiles: [FIXTURE_TILE],
    streets: [
      {
        tags: minor,
        line: [
          [1000, 1000],
          [2000, 1000],
          [2000, 2000],
          [1000, 2000],
          [1000, 1000],
        ],
      },
    ],
    nodes: [{ at: [1000, 1000], kind: 'join', degree: 2 }],
    edges: [{ from: [1000, 1000], to: [1000, 1000], kind: 'minor_road', points: 5 }],
  },
  /**
   * A bent cul-de-sac off a through street: its far end is a dead end, and
   * its bend, which nothing else shares, is not a node.
   */
  deadEnd: {
    tiles: [FIXTURE_TILE],
    streets: [
      {
        tags: minor,
        line: [
          [500, 3000],
          [3500, 3000],
        ],
      },
      {
        tags: { kind: 'other', kind_detail: 'residential' },
        line: [
          [2000, 3000],
          [2000, 2400],
          [2400, 2000],
        ],
      },
    ],
    nodes: [
      { at: [500, 3000], kind: 'dead-end', degree: 1 },
      { at: [3500, 3000], kind: 'dead-end', degree: 1 },
      { at: [2000, 3000], kind: 'junction', degree: 3 },
      { at: [2400, 2000], kind: 'dead-end', degree: 1 },
    ],
    edges: [
      { from: [500, 3000], to: [2000, 3000], kind: 'minor_road', points: 2 },
      { from: [2000, 3000], to: [3500, 3000], kind: 'minor_road', points: 2 },
      { from: [2000, 3000], to: [2400, 2000], kind: 'other', points: 3 },
    ],
  },
  /**
   * A dual carriageway, one `oneway=yes` and one `oneway=-1`, both drawn west
   * to east, crossed by a side street. Every edge is kept, whatever its
   * `oneway` (ADR 0091 D-5).
   */
  onewayPair: {
    tiles: [FIXTURE_TILE],
    streets: [
      {
        tags: { ...primary, oneway: 'yes' },
        line: [
          [500, 1000],
          [3500, 1000],
        ],
      },
      {
        tags: { ...primary, oneway: '-1' },
        line: [
          [500, 1060],
          [3500, 1060],
        ],
      },
      {
        tags: minor,
        line: [
          [2000, 600],
          [2000, 1500],
        ],
      },
    ],
    nodes: [
      { at: [2000, 1000], kind: 'junction', degree: 4 },
      { at: [2000, 1060], kind: 'junction', degree: 4 },
      { at: [500, 1000], kind: 'dead-end', degree: 1 },
      { at: [3500, 1000], kind: 'dead-end', degree: 1 },
      { at: [500, 1060], kind: 'dead-end', degree: 1 },
      { at: [3500, 1060], kind: 'dead-end', degree: 1 },
      { at: [2000, 600], kind: 'dead-end', degree: 1 },
      { at: [2000, 1500], kind: 'dead-end', degree: 1 },
    ],
    edges: [
      { from: [500, 1000], to: [2000, 1000], kind: 'major_road', oneway: 'with-line', points: 2 },
      { from: [2000, 1000], to: [3500, 1000], kind: 'major_road', oneway: 'with-line', points: 2 },
      {
        from: [500, 1060],
        to: [2000, 1060],
        kind: 'major_road',
        oneway: 'against-line',
        points: 2,
      },
      {
        from: [2000, 1060],
        to: [3500, 1060],
        kind: 'major_road',
        oneway: 'against-line',
        points: 2,
      },
      { from: [2000, 600], to: [2000, 1000], kind: 'minor_road', oneway: 'no', points: 2 },
      { from: [2000, 1000], to: [2000, 1060], kind: 'minor_road', oneway: 'no', points: 2 },
      { from: [2000, 1060], to: [2000, 1500], kind: 'minor_road', oneway: 'no', points: 2 },
    ],
  },
  /**
   * The ways ADR 0091 D-3 leaves out, each meeting a through street: a
   * motorway crossing it, a service way, a private way and a way with
   * `access=no` ending on it. None makes a junction. A `*_link` is a street
   * like any other, and does.
   */
  leftOut: {
    tiles: [FIXTURE_TILE],
    streets: [
      {
        tags: minor,
        line: [
          [500, 1000],
          [3500, 1000],
        ],
      },
      {
        tags: { kind: 'highway', kind_detail: 'motorway' },
        line: [
          [1000, 200],
          [1000, 2000],
        ],
      },
      {
        tags: { kind: 'other', kind_detail: 'service' },
        line: [
          [1500, 2000],
          [1500, 1000],
        ],
      },
      {
        tags: { ...minor, access: 'private' },
        line: [
          [2500, 2000],
          [2500, 1000],
        ],
      },
      {
        tags: { ...minor, access: 'no' },
        line: [
          [3000, 2000],
          [3000, 1000],
        ],
      },
      {
        tags: { ...primary, is_link: true },
        line: [
          [3300, 2000],
          [3300, 1000],
        ],
      },
    ],
    nodes: [
      { at: [500, 1000], kind: 'dead-end', degree: 1 },
      { at: [3500, 1000], kind: 'dead-end', degree: 1 },
      { at: [3300, 1000], kind: 'junction', degree: 3 },
      { at: [3300, 2000], kind: 'dead-end', degree: 1 },
    ],
    edges: [
      { from: [500, 1000], to: [3300, 1000], kind: 'minor_road', points: 2 },
      { from: [3300, 1000], to: [3500, 1000], kind: 'minor_road', points: 2 },
      { from: [3300, 2000], to: [3300, 1000], kind: 'major_road', isLink: true, points: 2 },
    ],
  },
  /**
   * A street that crosses another 9 px (about 2 m) inside the seam and runs
   * on across it, with only this tile loaded: its seam end stays a seam end,
   * and is not T-snapped back onto the street it has just crossed.
   */
  nearSeam: {
    tiles: [FIXTURE_TILE],
    streets: [
      {
        tags: minor,
        line: [
          [4087, 500],
          [4087, 1500],
        ],
      },
      {
        tags: minor,
        line: [
          [3000, 1000],
          [4600, 1000],
        ],
      },
    ],
    nodes: [
      { at: [4087, 500], kind: 'dead-end', degree: 1 },
      { at: [4087, 1500], kind: 'dead-end', degree: 1 },
      { at: [3000, 1000], kind: 'dead-end', degree: 1 },
      { at: [4087, 1000], kind: 'junction', degree: 4 },
      { at: [4096, 1000], kind: 'tile-edge', degree: 1 },
    ],
    edges: [
      { from: [4087, 500], to: [4087, 1000], kind: 'minor_road', points: 2 },
      { from: [4087, 1000], to: [4087, 1500], kind: 'minor_road', points: 2 },
      { from: [3000, 1000], to: [4087, 1000], kind: 'minor_road', points: 2 },
      { from: [4087, 1000], to: [4096, 1000], kind: 'minor_road', points: 2 },
    ],
  },
  /** One street straight across the seam, for adding and removing the east tile. */
  acrossSeam: {
    tiles: [FIXTURE_TILE, EAST_TILE],
    streets: [
      {
        tags: minor,
        line: [
          [2000, 1000],
          [6000, 1000],
        ],
      },
    ],
    nodes: [
      { at: [2000, 1000], kind: 'dead-end', degree: 1 },
      { at: [4096, 1000], kind: 'join', degree: 2 },
      { at: [6000, 1000], kind: 'dead-end', degree: 1 },
    ],
    edges: [
      { from: [2000, 1000], to: [4096, 1000], kind: 'minor_road', points: 2 },
      { from: [4096, 1000], to: [6000, 1000], kind: 'minor_road', points: 2 },
    ],
  },
  /** One street straight across the south seam: the north–south twin of `acrossSeam`. */
  acrossSouthSeam: {
    tiles: [FIXTURE_TILE, SOUTH_TILE],
    streets: [
      {
        tags: minor,
        line: [
          [1000, 2000],
          [1000, 6000],
        ],
      },
    ],
    nodes: [
      { at: [1000, 2000], kind: 'dead-end', degree: 1 },
      { at: [1000, 4096], kind: 'join', degree: 2 },
      { at: [1000, 6000], kind: 'dead-end', degree: 1 },
    ],
    edges: [
      { from: [1000, 2000], to: [1000, 4096], kind: 'minor_road', points: 2 },
      { from: [1000, 4096], to: [1000, 6000], kind: 'minor_road', points: 2 },
    ],
  },
  /**
   * One street leaving through the south-east corner of the tile into
   * {@link SOUTH_EAST_TILE}, a vertex exactly on the corner: its seam ends lie
   * on two box edges each. (Without that vertex the straight pixel line bends
   * in metres, and crosses one edge a few millimetres from the corner.)
   */
  acrossCorner: {
    tiles: [FIXTURE_TILE, SOUTH_EAST_TILE],
    streets: [
      {
        tags: minor,
        line: [
          [3000, 3000],
          [4096, 4096],
          [5000, 5000],
        ],
      },
    ],
    nodes: [
      { at: [3000, 3000], kind: 'dead-end', degree: 1 },
      { at: [4096, 4096], kind: 'join', degree: 2 },
      { at: [5000, 5000], kind: 'dead-end', degree: 1 },
    ],
    edges: [
      { from: [3000, 3000], to: [4096, 4096], kind: 'minor_road', points: 2 },
      { from: [4096, 4096], to: [5000, 5000], kind: 'minor_road', points: 2 },
    ],
  },
} as const satisfies Readonly<Record<string, GraphFixture>>;

export type GraphFixtureName = keyof typeof GRAPH_FIXTURES;

/**
 * The fixture's streets as one tile's bytes, in that tile's own pixels — and,
 * after them, whatever `layers` the caller wrote for the tile (a town's
 * footprints, for a ride that plans buildings), in the tile's own pixels too.
 */
export function graphFixtureTile(
  streets: readonly GraphFixtureStreet[],
  tile: TileId,
  layers: readonly LayerSpec[] = [],
): Uint8Array {
  const dx = (tile.x - FIXTURE_TILE.x) * FIXTURE_EXTENT;
  const dy = (tile.y - FIXTURE_TILE.y) * FIXTURE_EXTENT;
  return encodeTile([
    EARTH,
    {
      name: 'roads',
      features: streets.map((street) => ({
        type: 2,
        tags: street.tags,
        geometry: line([street.line.map(([x, y]) => [x - dx, y - dy] as const)]),
      })),
    },
    ...layers,
  ]);
}

/**
 * A fixture pixel in local metres in {@link FIXTURE_FRAME}, by the decoder's
 * own projection: what a vertex decodes to, before its float32 rounding.
 */
export function fixturePixelMetres(pixel: Pixel): { x: number; z: number } {
  const longitude = longitudeAtColumn(FIXTURE_TILE.x + pixel[0] / FIXTURE_EXTENT);
  const latitude = latitudeAtRow(FIXTURE_TILE.y + pixel[1] / FIXTURE_EXTENT);
  return localMetres(FIXTURE_FRAME, longitude, latitude);
}

/**
 * An at-grade street ending on the seam in the west tile, and a bridge
 * starting at the same point in the east tile: the two seam ends are of
 * different grades and are never stitched.
 */
export const SEAM_GRADE_STREETS: readonly GraphFixtureStreet[] = [
  {
    tags: minor,
    line: [
      [2000, 1000],
      [4096, 1000],
    ],
  },
  {
    tags: { ...minor, is_bridge: true },
    line: [
      [4096, 1000],
      [5000, 1000],
    ],
  },
];

/**
 * Many streets through one point, at as many angles: every pair crosses in
 * the same cell, which is what a hostile tile would do to the crossing step.
 */
export function starTile(count: number, radius: number): Uint8Array {
  const features = [];
  for (let i = 0; i < count; i++) {
    const angle = (i * Math.PI) / count;
    const dx = Math.round(radius * Math.cos(angle));
    const dy = Math.round(radius * Math.sin(angle));
    features.push({
      type: 2,
      tags: minor,
      geometry: line([
        [
          [2000 - dx, 2000 - dy],
          [2000 + dx, 2000 + dy],
        ],
      ]),
    });
  }
  return encodeTile([EARTH, { name: 'roads', features }]);
}
