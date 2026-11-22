// SPDX-License-Identifier: Apache-2.0

/**
 * The open-world ride's street graph, built on the device from decoded z15
 * tiles, one tile at a time (#2894, ADR 0091).
 *
 * It holds which streets meet where and which way each leaves, for a ride to
 * follow the street it is on and offer the streets that meet it. **It plans
 * no route** (ADR 0091 D-6): nothing here finds, costs or stores a path.
 *
 * ## Which streets are in it (D-3)
 *
 * The streets {@link decodeTile} keeps, less a `highway` (a motorway or its
 * link, as `apps/web/src/game/cross-streets.ts` §`meetsAtGrade` rules), a way
 * whose `access` is `no` or `private`, and a way whose `kind_detail` is
 * `service`. Footways are not streets and never reach it. A one-way street is
 * in it like any other: its `oneway` is kept on each edge as a fact, and
 * **never removes a way on** (D-5, the owner's answer to Q3).
 *
 * ## How a tile is built (D-4, spike 0040 §"Building the graph")
 *
 * 1. **Clip** each street to its own tile's box, so that the buffer two
 *    neighbouring tiles share is read once. A clip point on the box's edge is
 *    a **seam end**.
 * 2. **Snap** points within {@link SNAP_METRES} into one node. A line's ends
 *    always are nodes; its inner vertices are when another line shares them.
 *    A bridge's or a tunnel's inner vertices, and its seam ends, never snap
 *    to another line: its real ends do, where it comes back to grade.
 * 3. **Cross**: two at-grade segments that cross make a node on both.
 * 4. **T-snap**: a line end that is still dangling and lies within
 *    {@link T_SNAP_METRES} of another at-grade line makes a node on that line.
 * 5. **Stitch** (as a tile is added): a seam end joins the seam end of a
 *    loaded neighbour within {@link SEAM_STITCH_METRES}, of the same grade, as
 *    one node. Removing the tile unjoins them, and changes nothing else.
 *
 * A node where three or more edge ends meet is a `junction`; two, a `join`
 * (the street goes on: a seam, a bridge's end, a change of attributes); one,
 * a `dead-end`, unless it is a seam end facing a tile not loaded, which is a
 * `tile-edge`: the street runs on into a tile the graph does not hold yet.
 * A roundabout is a ring of ordinary junctions (D-5): the tiles carry no flag
 * for one.
 *
 * ⚠️ **What a tile alone cannot see**: steps 2 to 4 run inside one tile. A
 * dangling end within {@link T_SNAP_METRES} of a line that lies across the
 * seam in the neighbouring tile is not T-snapped to it, and two lines that
 * meet only across a seam meet only where their seam ends stitch.
 *
 * ## Bounds (D-8)
 *
 * A tile is untrusted input, and the decoder's bounds (`limits.ts`) are the
 * first. The builder adds its own, {@link StreetGraphLimits}: segments in a
 * tile, the work its spatial index may do, and nodes and edges a tile and in
 * the whole graph. A tile over any of them is refused with a
 * {@link StreetGraphRefusal}, the graph is left as it was, and
 * {@link describeStreetGraphRefusal} names the constraint and its limit and
 * never a coordinate, a tile id or a block id (ADR 0004 D).
 *
 * Pure: no platform API, no clock, no worker. The web app builds it in a
 * worker (`apps/web/src/game/open-world/graph-build.ts`, #2990), adding the
 * tiles of the blocks read round the rider and removing those left behind, and
 * hands the page only what each change did to it.
 */

import { tileBox } from './cover';
import type {
  Box,
  CorridorFrame,
  DecodedStreetFeature,
  StreetGrade,
  StreetOneway,
  TileId,
} from './types';

/** Points this close are one node (spike 0040 step 2): **1.0** m. */
export const SNAP_METRES = 1.0;

/** A dangling end this close to another at-grade line meets it (spike 0040 step 5): **3.0** m. */
export const T_SNAP_METRES = 3.0;

/** Seam ends of two neighbouring tiles this close are one node (spike 0040 step 3): **3.0** m. */
export const SEAM_STITCH_METRES = 3.0;

/** Every bound the builder holds a tile and the graph to. */
export interface StreetGraphLimits {
  /** Street segments in one tile, after the ways left out (D-3), before clipping. */
  readonly maxSegmentsPerTile: number;
  /** Entries the tile's spatial index holds plus the pairs of segments it compares. */
  readonly maxIndexWorkPerTile: number;
  readonly maxNodesPerTile: number;
  readonly maxEdgesPerTile: number;
  /** Nodes over every tile held, before seam ends are stitched into one. */
  readonly maxNodes: number;
  readonly maxEdges: number;
}

/**
 * The limits a caller gets when it names none. **Not measured against the
 * archive**: spike 0040 counted junctions, not segments. Each sits far above
 * what its figures imply — 2,153 junctions over a city centre's nine tiles —
 * so a real tile meets none of them, and a tile over one is refused, which
 * leaves its streets unoffered rather than the device out of memory.
 */
export const DEFAULT_STREET_GRAPH_LIMITS: StreetGraphLimits = {
  maxSegmentsPerTile: 50_000,
  maxIndexWorkPerTile: 1_000_000,
  maxNodesPerTile: 20_000,
  maxEdgesPerTile: 40_000,
  maxNodes: 200_000,
  maxEdges: 400_000,
};

/** Why a tile was not added. A value, never a throw: a tile is untrusted input. No coordinate, no tile id. */
export type StreetGraphRefusal =
  | { readonly reason: 'too-many-segments'; readonly limit: number }
  | { readonly reason: 'too-dense'; readonly limit: number }
  | { readonly reason: 'too-many-nodes'; readonly scope: 'tile' | 'graph'; readonly limit: number }
  | { readonly reason: 'too-many-edges'; readonly scope: 'tile' | 'graph'; readonly limit: number };

/** A refusal in words: the constraint and its limit, and never a coordinate or a tile id (ADR 0004 D). */
export function describeStreetGraphRefusal(refusal: StreetGraphRefusal): string {
  switch (refusal.reason) {
    case 'too-many-segments':
      return `street graph: the tile has more street segments than the limit of ${String(refusal.limit)}`;
    case 'too-dense':
      return `street graph: the tile's streets need more index work than the limit of ${String(refusal.limit)}`;
    case 'too-many-nodes':
      return refusal.scope === 'tile'
        ? `street graph: the tile makes more nodes than the limit of ${String(refusal.limit)} a tile`
        : `street graph: the tile would take the graph past its limit of ${String(refusal.limit)} nodes`;
    case 'too-many-edges':
      return refusal.scope === 'tile'
        ? `street graph: the tile makes more edges than the limit of ${String(refusal.limit)} a tile`
        : `street graph: the tile would take the graph past its limit of ${String(refusal.limit)} edges`;
  }
}

/** What a node is, by the edge ends that meet there. @see the header */
export type StreetNodeKind = 'junction' | 'join' | 'dead-end' | 'tile-edge';

/** A node: a junction, a join, a dead end or a street running on into a tile not loaded. */
export interface StreetGraphNode {
  /**
   * Stable while the tiles that hold it stay loaded. A node stitched across a
   * seam has its oldest tile's id; removing that tile gives the node left
   * behind its own.
   */
  readonly id: number;
  /** Local metres in the frame the tiles were decoded in: `x` WEST, `z` north. */
  readonly x: number;
  readonly z: number;
  readonly kind: StreetNodeKind;
  /**
   * The edges that leave it, one entry an edge end — a loop is listed twice —
   * whatever their `oneway`: every way on is offered in both directions (D-5).
   */
  readonly edges: readonly number[];
}

/** A street between two nodes, along its line, with the fields ADR 0091 D-2 lists. */
export interface StreetGraphEdge {
  readonly id: number;
  readonly from: number;
  readonly to: number;
  readonly kind: string;
  readonly kindDetail: string;
  readonly grade: StreetGrade;
  /** `'with-line'` runs from {@link from} to {@link to}. A fact; it removes no turn (D-5). */
  readonly oneway: StreetOneway;
  readonly isLink: boolean;
  /** Length along {@link line}, in metres. */
  readonly metres: number;
  /** `x0, z0, …` from `from`'s position to `to`'s, in local metres. */
  readonly line: Float32Array;
}

/**
 * Whether a decoded street is in the graph (ADR 0091 D-3): not a motorway, not
 * closed to a rider, not a service way.
 */
export function inStreetGraph(street: DecodedStreetFeature): boolean {
  return street.kind !== 'highway' && street.access === 'open' && street.kindDetail !== 'service';
}

/* ------------------------------------------------------------------------ */
/* The graph                                                                */
/* ------------------------------------------------------------------------ */

/** A seam end as it is held: where it is, which edges of the box it lies on, and what it is joined to. */
interface SeamEnd {
  readonly node: number;
  readonly x: number;
  readonly z: number;
  readonly grade: StreetGrade;
  /** {@link SIDE_WEST} | {@link SIDE_EAST} | {@link SIDE_NORTH} | {@link SIDE_SOUTH}. */
  readonly sides: number;
  partner: SeamEnd | null;
}

interface HeldNode {
  readonly id: number;
  readonly tile: TileId;
  readonly x: number;
  readonly z: number;
  /** Edge ids, one an edge end. */
  readonly edges: readonly number[];
  readonly seamEnds: readonly SeamEnd[];
}

interface HeldTile {
  readonly tile: TileId;
  readonly nodes: readonly number[];
  readonly edges: readonly number[];
  readonly seamEnds: readonly SeamEnd[];
}

const SIDE_WEST = 1;
const SIDE_EAST = 2;
const SIDE_NORTH = 4;
const SIDE_SOUTH = 8;

const tileKey = (x: number, y: number): string => `${String(x)}/${String(y)}`;

/**
 * The street graph over the tiles added to it (#2894). Add a tile as it is
 * decoded and remove it as it is evicted; neither rebuilds another tile.
 * Plain fields, not parameter properties: `demo:bake` runs this package
 * under Node's type stripping (#1931).
 */
export class StreetGraph {
  private readonly frame: CorridorFrame;
  private readonly limits: StreetGraphLimits;
  private readonly tiles = new Map<string, HeldTile>();
  private readonly heldNodes = new Map<number, HeldNode>();
  private readonly heldEdges = new Map<number, StreetGraphEdge>();
  private nextNode = 1;
  private nextEdge = 1;

  /** `frame` is the frame the tiles are decoded in (`decodeTile`'s `origin`). */
  constructor(frame: CorridorFrame, limits: StreetGraphLimits = DEFAULT_STREET_GRAPH_LIMITS) {
    this.frame = frame;
    this.limits = limits;
  }

  /** Whether the tile is held. */
  hasTile(tile: TileId): boolean {
    return this.tiles.has(tileKey(tile.x, tile.y));
  }

  /** How many tiles are held. */
  get tileCount(): number {
    return this.tiles.size;
  }

  /**
   * Adds one tile's decoded streets, stitched to its loaded neighbours, and
   * returns `null`; or returns a refusal and changes nothing. A tile already
   * held is a caller's error, and throws, naming no tile id.
   */
  addTile(tile: TileId, streets: readonly DecodedStreetFeature[]): StreetGraphRefusal | null {
    if (tile.z !== 15 || !Number.isInteger(tile.x) || !Number.isInteger(tile.y)) {
      throw new RangeError('StreetGraph.addTile: the tile id is not a z15 tile');
    }
    const key = tileKey(tile.x, tile.y);
    if (this.tiles.has(key)) {
      throw new RangeError('StreetGraph.addTile: the tile is already in the graph');
    }
    let built: BuiltTile;
    try {
      built = buildTile(streets, tileBox(this.frame, tile), this.limits);
    } catch (error) {
      if (error instanceof Refused) return error.refusal;
      throw error;
    }
    if (this.heldNodes.size + built.nodeX.length > this.limits.maxNodes) {
      return { reason: 'too-many-nodes', scope: 'graph', limit: this.limits.maxNodes };
    }
    if (this.heldEdges.size + built.edges.length > this.limits.maxEdges) {
      return { reason: 'too-many-edges', scope: 'graph', limit: this.limits.maxEdges };
    }

    // Commit: global ids, then the seams.
    const nodeIds = built.nodeX.map(() => this.nextNode++);
    const edgeIds = built.edges.map(() => this.nextEdge++);
    const nodeEdges: number[][] = nodeIds.map(() => []);
    const nodeSeams: SeamEnd[][] = nodeIds.map(() => []);
    built.edges.forEach((edge, i) => {
      const id = edgeIds[i] as number;
      (nodeEdges[edge.from] as number[]).push(id);
      (nodeEdges[edge.to] as number[]).push(id);
      this.heldEdges.set(id, {
        id,
        from: nodeIds[edge.from] as number,
        to: nodeIds[edge.to] as number,
        kind: edge.street.kind,
        kindDetail: edge.street.kindDetail,
        grade: edge.street.grade,
        oneway: edge.street.oneway,
        isLink: edge.street.isLink,
        metres: edge.metres,
        line: edge.line,
      });
    });
    const seamEnds = built.seamEnds.map((seam) => {
      const held: SeamEnd = { ...seam, node: nodeIds[seam.node] as number, partner: null };
      (nodeSeams[seam.node] as SeamEnd[]).push(held);
      return held;
    });
    nodeIds.forEach((id, i) => {
      this.heldNodes.set(id, {
        id,
        tile,
        x: built.nodeX[i] as number,
        z: built.nodeZ[i] as number,
        edges: nodeEdges[i] as number[],
        seamEnds: nodeSeams[i] as SeamEnd[],
      });
    });
    this.tiles.set(key, { tile, nodes: nodeIds, edges: edgeIds, seamEnds });
    this.stitch(tile, seamEnds);
    return null;
  }

  /** Removes a tile and unjoins its seams. Returns whether it was held. */
  removeTile(tile: TileId): boolean {
    const key = tileKey(tile.x, tile.y);
    const held = this.tiles.get(key);
    if (held === undefined) return false;
    for (const seam of held.seamEnds) {
      if (seam.partner !== null) seam.partner.partner = null;
    }
    for (const id of held.nodes) this.heldNodes.delete(id);
    for (const id of held.edges) this.heldEdges.delete(id);
    this.tiles.delete(key);
    return true;
  }

  /** Every node, with each node stitched across a seam once. */
  nodes(): StreetGraphNode[] {
    const out: StreetGraphNode[] = [];
    for (const id of this.heldNodes.keys()) {
      const component = this.component(id);
      if (component[0] === id) out.push(this.nodeOf(component));
    }
    return out;
  }

  /** The node with this id, or the node it was stitched into; `undefined` for none. */
  node(id: number): StreetGraphNode | undefined {
    if (!this.heldNodes.has(id)) return undefined;
    return this.nodeOf(this.component(id));
  }

  /** Every edge, its ends named by {@link StreetGraphNode.id}. */
  edges(): StreetGraphEdge[] {
    return [...this.heldEdges.values()].map((edge) => this.edgeOf(edge));
  }

  /** The edge with this id, or `undefined`. */
  edge(id: number): StreetGraphEdge | undefined {
    const edge = this.heldEdges.get(id);
    return edge === undefined ? undefined : this.edgeOf(edge);
  }

  private edgeOf(edge: StreetGraphEdge): StreetGraphEdge {
    const from = this.component(edge.from)[0] as number;
    const to = this.component(edge.to)[0] as number;
    return from === edge.from && to === edge.to ? edge : { ...edge, from, to };
  }

  /** The held nodes stitched to `id` through seams, `id` among them, lowest first. */
  private component(id: number): number[] {
    const seen = new Set<number>([id]);
    const queue = [id];
    while (queue.length > 0) {
      const node = this.heldNodes.get(queue.pop() as number) as HeldNode;
      for (const seam of node.seamEnds) {
        const other = seam.partner?.node;
        if (other !== undefined && !seen.has(other)) {
          seen.add(other);
          queue.push(other);
        }
      }
    }
    return [...seen].sort((a, b) => a - b);
  }

  private nodeOf(component: readonly number[]): StreetGraphNode {
    const members = component.map((id) => this.heldNodes.get(id) as HeldNode);
    const first = members[0] as HeldNode;
    const edges = members.flatMap((member) => member.edges);
    let kind: StreetNodeKind;
    if (edges.length >= 3) kind = 'junction';
    else if (
      members.some((member) =>
        member.seamEnds.some(
          (seam) =>
            seam.partner === null &&
            tilesAcross(member.tile, seam.sides).some((t) => !this.tiles.has(tileKey(t.x, t.y))),
        ),
      )
    ) {
      kind = 'tile-edge';
    } else kind = edges.length === 2 ? 'join' : 'dead-end';
    return { id: first.id, x: first.x, z: first.z, kind, edges };
  }

  /**
   * Joins the new tile's seam ends to its loaded neighbours': each pair facing
   * each other across their shared edge, of one grade, within
   * {@link SEAM_STITCH_METRES}, nearest first, each end at most once.
   */
  private stitch(tile: TileId, seamEnds: readonly SeamEnd[]): void {
    const pairs: { a: SeamEnd; b: SeamEnd; d: number }[] = [];
    for (const a of seamEnds) {
      for (const across of tilesAcross(tile, a.sides)) {
        const neighbour = this.tiles.get(tileKey(across.x, across.y));
        if (neighbour === undefined) continue;
        for (const b of neighbour.seamEnds) {
          if (b.partner !== null || b.grade !== a.grade) continue;
          if (!tilesAcross(across, b.sides).some((t) => t.x === tile.x && t.y === tile.y)) continue;
          const d = Math.hypot(a.x - b.x, a.z - b.z);
          if (d <= SEAM_STITCH_METRES) pairs.push({ a, b, d });
        }
      }
    }
    pairs.sort((p, q) => p.d - q.d || p.a.node - q.a.node || p.b.node - q.b.node);
    for (const { a, b } of pairs) {
      if (a.partner !== null || b.partner !== null) continue;
      a.partner = b;
      b.partner = a;
    }
  }
}

/** The tiles across the box edges in `sides`: one across an edge, three across a corner. */
function tilesAcross(tile: TileId, sides: number): TileId[] {
  // x is WEST in the frame, so the box's west edge faces column x − 1.
  const dx = sides & SIDE_WEST ? -1 : sides & SIDE_EAST ? 1 : 0;
  const dy = sides & SIDE_NORTH ? -1 : sides & SIDE_SOUTH ? 1 : 0;
  const out: TileId[] = [];
  if (dx !== 0) out.push({ z: 15, x: tile.x + dx, y: tile.y });
  if (dy !== 0) out.push({ z: 15, x: tile.x, y: tile.y + dy });
  if (dx !== 0 && dy !== 0) out.push({ z: 15, x: tile.x + dx, y: tile.y + dy });
  return out;
}

/* ------------------------------------------------------------------------ */
/* Building one tile                                                        */
/* ------------------------------------------------------------------------ */

class Refused extends Error {
  readonly refusal: StreetGraphRefusal;

  constructor(refusal: StreetGraphRefusal) {
    super(refusal.reason);
    this.refusal = refusal;
  }
}

/** A street clipped to its tile: `x, z` pairs in float64, and which box edges each end lies on. */
interface Piece {
  readonly coords: Float64Array;
  readonly street: DecodedStreetFeature;
  readonly atGrade: boolean;
  readonly startSides: number;
  readonly endSides: number;
  /** Its first and last points are one (a ring, as a roundabout's). */
  readonly closed: boolean;
}

/** A node on a piece: at vertex `at` when whole, or `t` of the way along segment `⌊at⌋`. */
interface Stop {
  readonly at: number;
  node: number;
}

interface BuiltEdge {
  readonly from: number;
  readonly to: number;
  readonly street: DecodedStreetFeature;
  readonly metres: number;
  readonly line: Float32Array;
}

interface BuiltTile {
  readonly nodeX: readonly number[];
  readonly nodeZ: readonly number[];
  readonly edges: readonly BuiltEdge[];
  readonly seamEnds: readonly Omit<SeamEnd, 'partner'>[];
}

/** How near a box edge a point is ON it, in metres: clip points are computed there to float64. */
const SEAM_EPSILON_METRES = 1e-3;

/**
 * A clipped piece shorter than this is dropped, in metres: **0.01**. A vertex
 * decoded to float32 can land a few micrometres inside the box beside the
 * one it was drawn on, and the sliver of a street that lies in the
 * neighbouring tile would otherwise be a street here.
 */
const MIN_PIECE_METRES = 0.01;

/** The spatial index's cell, in metres. */
const CELL_METRES = 32;

function sidesOf(x: number, z: number, box: Box): number {
  let sides = 0;
  if (Math.abs(x - box.maxX) <= SEAM_EPSILON_METRES) sides |= SIDE_WEST;
  if (Math.abs(x - box.minX) <= SEAM_EPSILON_METRES) sides |= SIDE_EAST;
  if (Math.abs(z - box.maxZ) <= SEAM_EPSILON_METRES) sides |= SIDE_NORTH;
  if (Math.abs(z - box.minZ) <= SEAM_EPSILON_METRES) sides |= SIDE_SOUTH;
  return sides;
}

/**
 * `line` clipped to `box` (Liang–Barsky, a segment at a time): the pieces of
 * it inside, each of at least two distinct points. A point on the box's edge
 * is inside.
 */
function clipLineToBox(line: Float32Array, box: Box): Float64Array[] {
  const pieces: Float64Array[] = [];
  let current: number[] | null = null;
  const finish = (): void => {
    if (current !== null && current.length >= 4) pieces.push(Float64Array.from(current));
    current = null;
  };
  const push = (x: number, z: number): void => {
    const points = current as number[];
    const n = points.length;
    if (n >= 2 && points[n - 2] === x && points[n - 1] === z) return;
    points.push(x, z);
  };
  for (let i = 0; i + 3 < line.length; i += 2) {
    const ax = line[i] as number;
    const az = line[i + 1] as number;
    const dx = (line[i + 2] as number) - ax;
    const dz = (line[i + 3] as number) - az;
    let t0 = 0;
    let t1 = 1;
    const edges: readonly (readonly [number, number])[] = [
      [-dx, ax - box.minX],
      [dx, box.maxX - ax],
      [-dz, az - box.minZ],
      [dz, box.maxZ - az],
    ];
    let outside = false;
    for (const [p, q] of edges) {
      if (p === 0) {
        if (q < 0) outside = true;
      } else {
        const r = q / p;
        if (p < 0) t0 = Math.max(t0, r);
        else t1 = Math.min(t1, r);
      }
    }
    if (outside || t0 > t1) {
      finish();
      continue;
    }
    if (current === null) current = [];
    push(ax + t0 * dx, az + t0 * dz);
    push(ax + t1 * dx, az + t1 * dz);
    if (t1 < 1) finish();
  }
  finish();
  return pieces;
}

/** A grid of cells keyed by their column and row. */
class Grid {
  private readonly cell: number;
  private readonly cells = new Map<string, number[]>();

  constructor(cell: number) {
    this.cell = cell;
  }

  private key(column: number, row: number): string {
    return `${String(column)},${String(row)}`;
  }

  /** Adds `value` to every cell `[minX, maxX] × [minZ, maxZ]` touches; returns how many. */
  add(value: number, minX: number, minZ: number, maxX: number, maxZ: number): number {
    let added = 0;
    const c1 = Math.floor(maxX / this.cell);
    const r1 = Math.floor(maxZ / this.cell);
    for (let c = Math.floor(minX / this.cell); c <= c1; c++) {
      for (let r = Math.floor(minZ / this.cell); r <= r1; r++) {
        const key = this.key(c, r);
        const list = this.cells.get(key);
        if (list === undefined) this.cells.set(key, [value]);
        else if (list[list.length - 1] !== value) list.push(value);
        added++;
      }
    }
    return added;
  }

  /** Every value in the cells within `reach` of the point, possibly repeated. */
  near(x: number, z: number, reach: number): number[] {
    const out: number[] = [];
    const c1 = Math.floor((x + reach) / this.cell);
    const r1 = Math.floor((z + reach) / this.cell);
    for (let c = Math.floor((x - reach) / this.cell); c <= c1; c++) {
      for (let r = Math.floor((z - reach) / this.cell); r <= r1; r++) {
        const list = this.cells.get(this.key(c, r));
        if (list !== undefined) out.push(...list);
      }
    }
    return out;
  }

  /** Each cell's values, with the cell's column and row. */
  *entries(): Generator<{ column: number; row: number; values: readonly number[] }> {
    for (const [key, values] of this.cells) {
      const [column, row] = key.split(',').map(Number) as [number, number];
      yield { column, row, values };
    }
  }

  get cellMetres(): number {
    return this.cell;
  }
}

/** Builds one tile's nodes, edges and seam ends, in the tile's own numbering. Throws {@link Refused}. */
function buildTile(
  streets: readonly DecodedStreetFeature[],
  box: Box,
  limits: StreetGraphLimits,
): BuiltTile {
  // The segments bound, before anything is allocated for them.
  let segments = 0;
  for (const street of streets) {
    if (inStreetGraph(street)) segments += Math.max(0, street.line.length / 2 - 1);
  }
  if (segments > limits.maxSegmentsPerTile) {
    throw new Refused({ reason: 'too-many-segments', limit: limits.maxSegmentsPerTile });
  }

  // 1. Clip.
  const pieces: Piece[] = [];
  for (const street of streets) {
    if (!inStreetGraph(street)) continue;
    for (const coords of clipLineToBox(street.line, box)) {
      if (lengthOf(coords) < MIN_PIECE_METRES) continue;
      const n = coords.length;
      const sx = coords[0] as number;
      const sz = coords[1] as number;
      const ex = coords[n - 2] as number;
      const ez = coords[n - 1] as number;
      pieces.push({
        coords,
        street,
        atGrade: street.grade === 'ground',
        startSides: sidesOf(sx, sz, box),
        endSides: sidesOf(ex, ez, box),
        closed: n >= 8 && Math.hypot(sx - ex, sz - ez) <= SNAP_METRES,
      });
    }
  }

  let work = 0;
  const spend = (amount: number): void => {
    work += amount;
    if (work > limits.maxIndexWorkPerTile) {
      throw new Refused({ reason: 'too-dense', limit: limits.maxIndexWorkPerTile });
    }
  };

  const nodeX: number[] = [];
  const nodeZ: number[] = [];
  const nodeGrid = new Grid(SNAP_METRES);
  const newNode = (x: number, z: number): number => {
    if (nodeX.length >= limits.maxNodesPerTile) {
      throw new Refused({ reason: 'too-many-nodes', scope: 'tile', limit: limits.maxNodesPerTile });
    }
    nodeX.push(x);
    nodeZ.push(z);
    const id = nodeX.length - 1;
    spend(nodeGrid.add(id, x, z, x, z));
    return id;
  };
  const nodeNear = (x: number, z: number): number | null => {
    let best: number | null = null;
    let bestD = SNAP_METRES;
    for (const id of nodeGrid.near(x, z, SNAP_METRES)) {
      const d = Math.hypot((nodeX[id] as number) - x, (nodeZ[id] as number) - z);
      if (d <= bestD && (best === null || d < bestD || id < best)) {
        best = id;
        bestD = d;
      }
    }
    return best;
  };
  const stops: Stop[][] = pieces.map(() => []);
  // Every stop past a piece's first can make an edge, so the stops are held to
  // the edge bound too: a hostile tile of lines crossing at one point makes
  // one node and a stop a crossing, and is refused here, not at the end.
  let stopCount = 0;
  const addStop = (piece: number, stop: Stop): void => {
    stopCount++;
    if (stopCount > limits.maxEdgesPerTile + pieces.length) {
      throw new Refused({ reason: 'too-many-edges', scope: 'tile', limit: limits.maxEdgesPerTile });
    }
    (stops[piece] as Stop[]).push(stop);
  };

  // 2. Snap. Candidates: every end, but a bridge's or a tunnel's seam end;
  // every inner vertex of an at-grade piece.
  const cPiece: number[] = [];
  const cVertex: number[] = [];
  const cEnd: boolean[] = [];
  const cGrid = new Grid(SNAP_METRES);
  pieces.forEach((piece, p) => {
    const last = piece.coords.length / 2 - 1;
    for (let v = 0; v <= last; v++) {
      const end = v === 0 || v === last;
      const seam = v === 0 ? piece.startSides : v === last ? piece.endSides : 0;
      const candidate = end ? piece.atGrade || seam === 0 : piece.atGrade;
      if (!candidate) {
        // A bridge's seam end: its own node, joined only by a stitch.
        if (end) addStop(p, { at: v, node: newNode(at(piece, v, 0), at(piece, v, 1)) });
        continue;
      }
      cPiece.push(p);
      cVertex.push(v);
      cEnd.push(end);
      const x = at(piece, v, 0);
      const z = at(piece, v, 1);
      spend(cGrid.add(cPiece.length - 1, x, z, x, z));
    }
  });
  const parent = cPiece.map((_, i) => i);
  const find = (i: number): number => {
    let r = i;
    while (parent[r] !== r) r = parent[r] as number;
    while (parent[i] !== r) {
      const next = parent[i] as number;
      parent[i] = r;
      i = next;
    }
    return r;
  };
  for (let i = 0; i < cPiece.length; i++) {
    const pi = pieces[cPiece[i] as number] as Piece;
    const xi = at(pi, cVertex[i] as number, 0);
    const zi = at(pi, cVertex[i] as number, 1);
    for (const j of cGrid.near(xi, zi, SNAP_METRES)) {
      if (j >= i) continue;
      spend(1);
      const samePiece = cPiece[i] === cPiece[j];
      // One piece's own points join only at its ends: a ring's close.
      if (samePiece && !(cEnd[i] && cEnd[j])) continue;
      const pj = pieces[cPiece[j] as number] as Piece;
      const d = Math.hypot(
        xi - at(pj, cVertex[j] as number, 0),
        zi - at(pj, cVertex[j] as number, 1),
      );
      if (d <= SNAP_METRES) parent[find(i)] = find(j);
    }
  }
  const groups = new Map<number, number[]>();
  for (let i = 0; i < cPiece.length; i++) {
    const root = find(i);
    const group = groups.get(root);
    if (group === undefined) groups.set(root, [i]);
    else group.push(i);
  }
  for (const group of groups.values()) {
    if (group.length < 2 && !cEnd[group[0] as number]) continue;
    let sx = 0;
    let sz = 0;
    for (const i of group) {
      const piece = pieces[cPiece[i] as number] as Piece;
      sx += at(piece, cVertex[i] as number, 0);
      sz += at(piece, cVertex[i] as number, 1);
    }
    const node = newNode(sx / group.length, sz / group.length);
    for (const i of group) addStop(cPiece[i] as number, { at: cVertex[i] as number, node });
  }

  // The at-grade segments' index, for steps 3 and 4. A long segment is entered
  // a cell's length at a time, so its entries grow with its length, not its
  // box's area.
  const sPiece: number[] = [];
  const sIndex: number[] = [];
  const sGrid = new Grid(CELL_METRES);
  pieces.forEach((piece, p) => {
    if (!piece.atGrade) return;
    const count = piece.coords.length / 2 - 1;
    for (let s = 0; s < count; s++) {
      sPiece.push(p);
      sIndex.push(s);
      const id = sPiece.length - 1;
      const ax = at(piece, s, 0);
      const az = at(piece, s, 1);
      const bx = at(piece, s + 1, 0);
      const bz = at(piece, s + 1, 1);
      const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / CELL_METRES));
      for (let k = 0; k < steps; k++) {
        const x0 = ax + ((bx - ax) * k) / steps;
        const z0 = az + ((bz - az) * k) / steps;
        const x1 = ax + ((bx - ax) * (k + 1)) / steps;
        const z1 = az + ((bz - az) * (k + 1)) / steps;
        spend(
          sGrid.add(
            id,
            Math.min(x0, x1) - T_SNAP_METRES,
            Math.min(z0, z1) - T_SNAP_METRES,
            Math.max(x0, x1) + T_SNAP_METRES,
            Math.max(z0, z1) + T_SNAP_METRES,
          ),
        );
      }
    }
  });

  // 3. Cross. A pair is decided in the one cell its crossing lies in.
  for (const { column, row, values } of sGrid.entries()) {
    const unique = [...new Set(values)];
    for (let a = 0; a < unique.length; a++) {
      for (let b = a + 1; b < unique.length; b++) {
        spend(1);
        const i = unique[a] as number;
        const j = unique[b] as number;
        const pi = sPiece[i] as number;
        const pj = sPiece[j] as number;
        if (pi === pj && adjacent(pieces[pi] as Piece, sIndex[i] as number, sIndex[j] as number)) {
          continue;
        }
        const hit = crossing(
          pieces[pi] as Piece,
          sIndex[i] as number,
          pieces[pj] as Piece,
          sIndex[j] as number,
        );
        if (hit === null) continue;
        if (
          Math.floor(hit.x / sGrid.cellMetres) !== column ||
          Math.floor(hit.z / sGrid.cellMetres) !== row
        ) {
          continue;
        }
        const node = nodeNear(hit.x, hit.z) ?? newNode(hit.x, hit.z);
        addStop(pi, { at: (sIndex[i] as number) + hit.t, node });
        addStop(pj, { at: (sIndex[j] as number) + hit.u, node });
      }
    }
  }

  // 4. T-snap: an end that nothing else meets yet, and that is not a seam end.
  const ends = new Map<number, number>();
  const countEnds = (): void => {
    ends.clear();
    pieces.forEach((piece, p) => {
      const last = piece.coords.length / 2 - 1;
      for (const stop of stops[p] as Stop[]) {
        const whole = stop.at === 0 || stop.at === last;
        ends.set(stop.node, (ends.get(stop.node) ?? 0) + (whole ? 1 : 2));
      }
    });
  };
  countEnds();
  pieces.forEach((piece, p) => {
    const last = piece.coords.length / 2 - 1;
    for (const v of [0, last]) {
      if ((v === 0 ? piece.startSides : piece.endSides) !== 0) continue;
      const stop = (stops[p] as Stop[]).find((s) => s.at === v);
      if (stop === undefined || ends.get(stop.node) !== 1) continue;
      const x = at(piece, v, 0);
      const z = at(piece, v, 1);
      let best: { segment: number; u: number; x: number; z: number; d: number } | null = null;
      for (const segment of new Set(sGrid.near(x, z, T_SNAP_METRES))) {
        spend(1);
        if (sPiece[segment] === p) continue;
        const target = pieces[sPiece[segment] as number] as Piece;
        const s = sIndex[segment] as number;
        const near = nearestOnSegment(target, s, x, z);
        if (near.d > T_SNAP_METRES) continue;
        if (best === null || near.d < best.d) best = { segment, ...near };
      }
      if (best === null) continue;
      const node = nodeNear(best.x, best.z) ?? newNode(best.x, best.z);
      addStop(sPiece[best.segment] as number, {
        at: (sIndex[best.segment] as number) + best.u,
        node,
      });
      // The end now meets the line: neither it nor the node is dangling.
      if (node !== stop.node) ends.set(stop.node, 0);
      stop.node = node;
      ends.set(node, (ends.get(node) ?? 0) + 3);
    }
  });

  // 5. Edges, a piece at a time, between its stops in order along it. A piece
  // of k stops makes at most k − 1 edges, so the stop bound above already
  // holds the edges to `maxEdgesPerTile`.
  const edges: BuiltEdge[] = [];
  pieces.forEach((piece, p) => {
    const ordered = [...(stops[p] as Stop[])].sort((a, b) => a.at - b.at || a.node - b.node);
    let previous = ordered[0] as Stop;
    for (const stop of ordered.slice(1)) {
      const line = [nodeX[previous.node] as number, nodeZ[previous.node] as number];
      for (let v = Math.floor(previous.at) + 1; v < stop.at; v++) {
        line.push(at(piece, v, 0), at(piece, v, 1));
      }
      line.push(nodeX[stop.node] as number, nodeZ[stop.node] as number);
      const metres = lengthOf(line);
      // The same node again is one stop, unless a loop of a street lies between.
      if (stop.node !== previous.node || metres > 2 * SNAP_METRES) {
        edges.push({
          from: previous.node,
          to: stop.node,
          street: piece.street,
          metres,
          line: Float32Array.from(line),
        });
      }
      previous = stop;
    }
  });

  // Keep only the nodes an edge reaches, renumbered in order.
  const used = new Int32Array(nodeX.length).fill(-1);
  const keptX: number[] = [];
  const keptZ: number[] = [];
  const keep = (node: number): number => {
    if (used[node] === -1) {
      used[node] = keptX.length;
      keptX.push(nodeX[node] as number);
      keptZ.push(nodeZ[node] as number);
    }
    return used[node] as number;
  };
  const kept = edges.map((edge) => ({ ...edge, from: keep(edge.from), to: keep(edge.to) }));

  // The seam ends, on the nodes they ended on.
  const seamEnds: Omit<SeamEnd, 'partner'>[] = [];
  pieces.forEach((piece, p) => {
    const last = piece.coords.length / 2 - 1;
    for (const v of [0, last]) {
      const sides = v === 0 ? piece.startSides : piece.endSides;
      if (sides === 0) continue;
      const stop = (stops[p] as Stop[]).find((s) => s.at === v);
      if (stop === undefined || used[stop.node] === -1) continue;
      seamEnds.push({
        node: used[stop.node] as number,
        x: at(piece, v, 0),
        z: at(piece, v, 1),
        grade: piece.street.grade,
        sides,
      });
    }
  });
  return { nodeX: keptX, nodeZ: keptZ, edges: kept, seamEnds };
}

/** Coordinate `axis` (0 `x`, 1 `z`) of vertex `v`. */
function at(piece: Piece, v: number, axis: 0 | 1): number {
  return piece.coords[v * 2 + axis] as number;
}

/** Whether two segments of one piece share a vertex: neighbours, or the first and last of a ring. */
function adjacent(piece: Piece, a: number, b: number): boolean {
  if (Math.abs(a - b) <= 1) return true;
  const last = piece.coords.length / 2 - 2;
  return piece.closed && Math.min(a, b) === 0 && Math.max(a, b) === last;
}

/** Where segment `s` of `p` crosses segment `r` of `q`, both ends included, or `null`. */
function crossing(
  p: Piece,
  s: number,
  q: Piece,
  r: number,
): { x: number; z: number; t: number; u: number } | null {
  const ax = at(p, s, 0);
  const az = at(p, s, 1);
  const dx = at(p, s + 1, 0) - ax;
  const dz = at(p, s + 1, 1) - az;
  const bx = at(q, r, 0);
  const bz = at(q, r, 1);
  const ex = at(q, r + 1, 0) - bx;
  const ez = at(q, r + 1, 1) - bz;
  const denominator = dx * ez - dz * ex;
  if (Math.abs(denominator) < 1e-9) return null; // parallel: an end meets by snapping
  const wx = bx - ax;
  const wz = bz - az;
  const t = (wx * ez - wz * ex) / denominator;
  const u = (wx * dz - wz * dx) / denominator;
  const slack = 1e-9;
  if (t < -slack || t > 1 + slack || u < -slack || u > 1 + slack) return null;
  const tc = Math.min(1, Math.max(0, t));
  const uc = Math.min(1, Math.max(0, u));
  return { x: ax + tc * dx, z: az + tc * dz, t: tc, u: uc };
}

/** The nearest point to `(x, z)` on segment `s` of `piece`. */
function nearestOnSegment(
  piece: Piece,
  s: number,
  x: number,
  z: number,
): { u: number; x: number; z: number; d: number } {
  const ax = at(piece, s, 0);
  const az = at(piece, s, 1);
  const dx = at(piece, s + 1, 0) - ax;
  const dz = at(piece, s + 1, 1) - az;
  const lengthSquared = dx * dx + dz * dz;
  const u =
    lengthSquared === 0
      ? 0
      : Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / lengthSquared));
  const px = ax + u * dx;
  const pz = az + u * dz;
  return { u, x: px, z: pz, d: Math.hypot(px - x, pz - z) };
}

function lengthOf(line: ArrayLike<number>): number {
  let metres = 0;
  for (let i = 2; i < line.length; i += 2) {
    metres += Math.hypot(
      (line[i] as number) - (line[i - 2] as number),
      (line[i + 1] as number) - (line[i - 1] as number),
    );
  }
  return metres;
}
