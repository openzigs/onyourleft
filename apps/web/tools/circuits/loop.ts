// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The street graph and the loop search behind `author-circuit.ts` — #2293,
 * ADR 0064 D-7.1: a closed loop that follows the archive's street lines from a
 * chosen start. Pure: it is handed lines in local metres (`x` WEST, `z`
 * north, as `@onyourleft/map-features` decodes them) and answers points in the
 * same frame. It reads no file, makes no request and knows no coordinate.
 *
 * ## How a loop is drawn
 *
 * 1. **The graph.** Every street line is cut into segments; a point within
 *    {@link SNAP_METRES} of another is the same node, and a line's loose end
 *    within that distance of another line's segment is joined to it there (a
 *    junction whose vertex the tile simplified away). Lines are clipped to
 *    their own tile by the caller, so a street that crosses a tile edge is
 *    joined where both halves meet it.
 * 2. **The corners.** `corners - 1` points on a circle of `radius` through the
 *    start, the circle's centre at `bearing` from it, each moved to the nearest
 *    node a loop can turn at.
 * 3. **The legs.** The cheapest path start → corner → … → start, by
 *    {@link shortestPath}, where an edge already ridden costs
 *    {@link REUSE_PENALTY} times its weight and a node already passed costs
 *    {@link REVISIT_PENALTY_METRES}, so a leg finds a new way home rather than
 *    the way it came.
 * 4. **The choice.** {@link searchLoops} tries every radius, bearing and corner
 *    count in its grid and keeps the loop {@link scoreLoop} likes best: one that
 *    rides no street twice, crosses itself nowhere, turns back on itself
 *    nowhere, and is nearest the target length.
 *
 * The design is this script's, never a course traced from any game (ADR 0060
 * D-1.2, D-1.3).
 */

/** A point in the frame's local metres: `x` WEST, `z` north. */
export interface LocalPoint {
  readonly x: number;
  readonly z: number;
}

/** One street, as the graph takes it. */
export interface StreetLine {
  readonly points: readonly LocalPoint[];
  /** Whether it is a bridge: its heights are not the ground's (`bridgeHeights`). */
  readonly bridge: boolean;
  /** What a metre of it costs a leg; `1` for a quiet street. */
  readonly weight: number;
}

interface Edge {
  readonly id: number;
  readonly to: number;
  readonly length: number;
  readonly weight: number;
  readonly bridge: boolean;
}

export interface RoadGraph {
  readonly nodes: readonly LocalPoint[];
  readonly edges: readonly (readonly Edge[])[];
}

/** Two points nearer than this are one node. */
export const SNAP_METRES = 1;

/** What an edge already ridden costs again, as a multiple of its weight. */
export const REUSE_PENALTY = 12;

/** What passing a node already passed adds to a leg. */
export const REVISIT_PENALTY_METRES = 400;

/** The sharpest change of direction a loop may make between two segments of over {@link TURN_SEGMENT_METRES}. */
export const TURN_BACK_DEGREES = 150;

/** A change of direction sharper than this is a corner a rider takes. */
export const CORNER_DEGREES = 60;

/** Segments shorter than this are not judged for a turn: a kink in a junction is not one. */
export const TURN_SEGMENT_METRES = 8;

function distance(a: LocalPoint, b: LocalPoint): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** Nodes snapped through a grid of {@link SNAP_METRES} cells. */
class NodeIndex {
  readonly nodes: LocalPoint[] = [];
  readonly #cells = new Map<string, number[]>();

  #key(cx: number, cz: number): string {
    return `${String(cx)},${String(cz)}`;
  }

  /** The node at `point`, made if there is none within {@link SNAP_METRES}. */
  at(point: LocalPoint): number {
    const cx = Math.floor(point.x / SNAP_METRES);
    const cz = Math.floor(point.z / SNAP_METRES);
    let best = -1;
    let bestDistance = SNAP_METRES;
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dz = -1; dz <= 1; dz += 1) {
        for (const index of this.#cells.get(this.#key(cx + dx, cz + dz)) ?? []) {
          const gap = distance(this.nodes[index] as LocalPoint, point);
          if (gap < bestDistance) {
            best = index;
            bestDistance = gap;
          }
        }
      }
    }
    if (best >= 0) return best;
    const made = this.nodes.length;
    this.nodes.push({ x: point.x, z: point.z });
    const key = this.#key(cx, cz);
    const cell = this.#cells.get(key);
    if (cell === undefined) this.#cells.set(key, [made]);
    else cell.push(made);
    return made;
  }
}

interface Segment {
  a: number;
  b: number;
  weight: number;
  bridge: boolean;
}

/** The nearest point on segment `a`–`b` to `p`, and how far along it (0 to 1). */
function project(p: LocalPoint, a: LocalPoint, b: LocalPoint): { point: LocalPoint; t: number } {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const span = dx * dx + dz * dz;
  const t = span === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / span));
  return { point: { x: a.x + t * dx, z: a.z + t * dz }, t };
}

/**
 * The graph of `lines`. Segments are deduplicated, so two tiles' copies of one
 * street are one edge, and a loose end near another segment is joined to it.
 */
export function buildGraph(lines: readonly StreetLine[]): RoadGraph {
  const index = new NodeIndex();
  const segments = new Map<string, Segment>();
  const add = (a: number, b: number, weight: number, bridge: boolean): void => {
    if (a === b) return;
    const key = a < b ? `${String(a)}-${String(b)}` : `${String(b)}-${String(a)}`;
    const existing = segments.get(key);
    if (existing === undefined) segments.set(key, { a, b, weight, bridge });
    else existing.weight = Math.min(existing.weight, weight);
  };
  for (const line of lines) {
    let previous: number | undefined;
    for (const point of line.points) {
      const node = index.at(point);
      if (previous !== undefined) add(previous, node, line.weight, line.bridge);
      previous = node;
    }
  }

  // A loose end within SNAP_METRES of another segment is a junction whose
  // vertex was simplified away: split that segment at the loose end.
  const degree = new Map<number, number>();
  for (const segment of segments.values()) {
    degree.set(segment.a, (degree.get(segment.a) ?? 0) + 1);
    degree.set(segment.b, (degree.get(segment.b) ?? 0) + 1);
  }
  const CELL = 25;
  const buckets = new Map<string, string[]>();
  const cellKey = (cx: number, cz: number): string => `${String(cx)},${String(cz)}`;
  for (const [key, segment] of segments) {
    const a = index.nodes[segment.a] as LocalPoint;
    const b = index.nodes[segment.b] as LocalPoint;
    const x0 = Math.floor((Math.min(a.x, b.x) - SNAP_METRES) / CELL);
    const x1 = Math.floor((Math.max(a.x, b.x) + SNAP_METRES) / CELL);
    const z0 = Math.floor((Math.min(a.z, b.z) - SNAP_METRES) / CELL);
    const z1 = Math.floor((Math.max(a.z, b.z) + SNAP_METRES) / CELL);
    for (let cx = x0; cx <= x1; cx += 1) {
      for (let cz = z0; cz <= z1; cz += 1) {
        const bucket = buckets.get(cellKey(cx, cz));
        if (bucket === undefined) buckets.set(cellKey(cx, cz), [key]);
        else bucket.push(key);
      }
    }
  }
  for (const [node, count] of degree) {
    if (count !== 1) continue;
    const p = index.nodes[node] as LocalPoint;
    const bucket = buckets.get(cellKey(Math.floor(p.x / CELL), Math.floor(p.z / CELL))) ?? [];
    let bestKey: string | undefined;
    let bestGap = SNAP_METRES;
    for (const key of bucket) {
      const segment = segments.get(key);
      if (segment === undefined || segment.a === node || segment.b === node) continue;
      const near = project(
        p,
        index.nodes[segment.a] as LocalPoint,
        index.nodes[segment.b] as LocalPoint,
      );
      const gap = distance(near.point, p);
      if (gap < bestGap && near.t > 0 && near.t < 1) {
        bestGap = gap;
        bestKey = key;
      }
    }
    if (bestKey === undefined) continue;
    const split = segments.get(bestKey) as Segment;
    segments.delete(bestKey);
    add(split.a, node, split.weight, split.bridge);
    add(node, split.b, split.weight, split.bridge);
  }

  const edges: Edge[][] = index.nodes.map(() => []);
  let id = 0;
  for (const segment of segments.values()) {
    const length = distance(
      index.nodes[segment.a] as LocalPoint,
      index.nodes[segment.b] as LocalPoint,
    );
    const weight = length * segment.weight;
    (edges[segment.a] as Edge[]).push({
      id,
      to: segment.b,
      length,
      weight,
      bridge: segment.bridge,
    });
    (edges[segment.b] as Edge[]).push({
      id,
      to: segment.a,
      length,
      weight,
      bridge: segment.bridge,
    });
    id += 1;
  }
  return { nodes: index.nodes, edges };
}

/** A binary min-heap of `[cost, node]`. */
class Heap {
  readonly #items: [number, number][] = [];

  get size(): number {
    return this.#items.length;
  }

  push(cost: number, node: number): void {
    const items = this.#items;
    items.push([cost, node]);
    let at = items.length - 1;
    while (at > 0) {
      const parent = (at - 1) >> 1;
      if ((items[parent] as [number, number])[0] <= cost) break;
      items[at] = items[parent] as [number, number];
      at = parent;
    }
    items[at] = [cost, node];
  }

  pop(): [number, number] {
    const items = this.#items;
    const top = items[0] as [number, number];
    const last = items.pop() as [number, number];
    if (items.length > 0) {
      let at = 0;
      for (;;) {
        const left = at * 2 + 1;
        const right = left + 1;
        let smallest = at;
        let smallestCost = last[0];
        if (left < items.length && (items[left] as [number, number])[0] < smallestCost) {
          smallest = left;
          smallestCost = (items[left] as [number, number])[0];
        }
        if (right < items.length && (items[right] as [number, number])[0] < smallestCost) {
          smallest = right;
        }
        if (smallest === at) break;
        items[at] = items[smallest] as [number, number];
        at = smallest;
      }
      items[at] = last;
    }
    return top;
  }
}

/** A path through the graph: its nodes in order and the edges between them. */
export interface GraphPath {
  readonly nodes: readonly number[];
  readonly edges: readonly number[];
}

/**
 * The cheapest path from `from` to `to`, an edge in `used` costing
 * {@link REUSE_PENALTY} times its weight and a node in `passed`
 * {@link REVISIT_PENALTY_METRES} more. `undefined` when there is none.
 */
export function shortestPath(
  graph: RoadGraph,
  from: number,
  to: number,
  used: ReadonlySet<number> = new Set(),
  passed: ReadonlySet<number> = new Set(),
): GraphPath | undefined {
  const cost = new Float64Array(graph.nodes.length).fill(Number.POSITIVE_INFINITY);
  const via = new Int32Array(graph.nodes.length).fill(-1);
  const viaEdge = new Int32Array(graph.nodes.length).fill(-1);
  const heap = new Heap();
  cost[from] = 0;
  heap.push(0, from);
  while (heap.size > 0) {
    const [here, node] = heap.pop();
    if (here > (cost[node] as number)) continue;
    if (node === to) break;
    for (const edge of graph.edges[node] ?? []) {
      let step = edge.weight * (used.has(edge.id) ? REUSE_PENALTY : 1);
      if (edge.to !== to && passed.has(edge.to)) step += REVISIT_PENALTY_METRES;
      const next = here + step;
      if (next < (cost[edge.to] as number)) {
        cost[edge.to] = next;
        via[edge.to] = node;
        viaEdge[edge.to] = edge.id;
        heap.push(next, edge.to);
      }
    }
  }
  if (!Number.isFinite(cost[to])) return undefined;
  const nodes: number[] = [to];
  const edges: number[] = [];
  let at = to;
  while (at !== from) {
    edges.push(viaEdge[at] as number);
    at = via[at] as number;
    nodes.push(at);
  }
  return { nodes: nodes.reverse(), edges: edges.reverse() };
}

/** The node nearest `point` that a loop can turn at (two or more edges), within `within` metres. */
export function nearestNode(
  graph: RoadGraph,
  point: LocalPoint,
  within: number,
): number | undefined {
  let best: number | undefined;
  let bestGap = within;
  graph.nodes.forEach((node, index) => {
    if ((graph.edges[index]?.length ?? 0) < 2) return;
    const gap = distance(node, point);
    if (gap < bestGap) {
      best = index;
      bestGap = gap;
    }
  });
  return best;
}

/** How a loop is laid out round its start. */
export interface LoopDesign {
  /** The circle's radius, metres. */
  readonly radiusMetres: number;
  /** Where the circle's centre is from the start, degrees clockwise from north. */
  readonly bearingDegrees: number;
  /** The start and this many less one corners, evenly round the circle. */
  readonly corners: number;
}

/** A loop through the graph, start first, not repeating the start at the end. */
export interface Loop {
  readonly design: LoopDesign;
  readonly nodes: readonly number[];
  /** Whether the edge from `nodes[i]` to `nodes[i + 1]` (wrapping) is a bridge. */
  readonly bridge: readonly boolean[];
  readonly lengthMetres: number;
  /** Metres of street ridden more than once. */
  readonly reusedMetres: number;
  /** Nodes passed more than once, the start's return aside. */
  readonly crossings: number;
  /** Changes of direction sharper than {@link TURN_BACK_DEGREES}. */
  readonly turnsBack: number;
  /** Changes of direction sharper than {@link CORNER_DEGREES}: the corners a rider takes. */
  readonly turns: number;
  /** How round it is: 4πA / P², 1 for a circle, near 0 for a loop that doubles back. */
  readonly roundness: number;
}

/** The corner points of a design round `start`, start excluded. */
export function cornerPoints(start: LocalPoint, design: LoopDesign): readonly LocalPoint[] {
  const radians = (design.bearingDegrees * Math.PI) / 180;
  // `x` is WEST: east is −x.
  const centre = {
    x: start.x - Math.sin(radians) * design.radiusMetres,
    z: start.z + Math.cos(radians) * design.radiusMetres,
  };
  const startAngle = Math.atan2(start.z - centre.z, -(start.x - centre.x));
  const points: LocalPoint[] = [];
  for (let corner = 1; corner < design.corners; corner += 1) {
    const angle = startAngle + (corner * 2 * Math.PI) / design.corners;
    points.push({
      x: centre.x - Math.cos(angle) * design.radiusMetres,
      z: centre.z + Math.sin(angle) * design.radiusMetres,
    });
  }
  return points;
}

/** Draws one loop of `design` from node `start`; `undefined` when a corner or a leg cannot be reached. */
export function drawLoop(graph: RoadGraph, start: number, design: LoopDesign): Loop | undefined {
  const origin = graph.nodes[start] as LocalPoint;
  const stops: number[] = [start];
  for (const corner of cornerPoints(origin, design)) {
    const node = nearestNode(graph, corner, design.radiusMetres / 2);
    if (node === undefined) return undefined;
    if (stops.includes(node)) return undefined;
    stops.push(node);
  }
  stops.push(start);
  const used = new Set<number>();
  const passed = new Set<number>();
  const nodes: number[] = [start];
  const edges: number[] = [];
  for (let leg = 0; leg + 1 < stops.length; leg += 1) {
    const path = shortestPath(graph, stops[leg] as number, stops[leg + 1] as number, used, passed);
    if (path === undefined) return undefined;
    for (const node of path.nodes.slice(0, -1)) passed.add(node);
    for (const edge of path.edges) {
      edges.push(edge);
      used.add(edge);
    }
    nodes.push(...path.nodes.slice(1));
  }
  nodes.pop();
  const trimmed = trimStem(nodes, edges);
  return measureLoop(graph, design, trimmed.nodes, trimmed.edges);
}

/**
 * A loop with its stem cut off: a start off the loop is ridden out and back
 * along the same street, so while the first and last edges are one edge the
 * start moves one node along it. What is left starts where the stem met the
 * loop, a street's length from where it was asked to.
 */
export function trimStem(
  nodes: readonly number[],
  edges: readonly number[],
): { readonly nodes: readonly number[]; readonly edges: readonly number[] } {
  let keptNodes = nodes;
  let keptEdges = edges;
  while (keptNodes.length > 3 && keptEdges[0] === keptEdges[keptEdges.length - 1]) {
    keptNodes = keptNodes.slice(1, -1);
    keptEdges = keptEdges.slice(1, -1);
  }
  return { nodes: keptNodes, edges: keptEdges };
}

function edgeBetween(graph: RoadGraph, a: number, b: number, id: number): Edge {
  const edge = (graph.edges[a] ?? []).find((each) => each.id === id && each.to === b);
  if (edge === undefined) throw new Error('drawLoop: a path stepped along no edge');
  return edge;
}

/** The figures {@link scoreLoop} judges, for a loop's nodes and edges. */
export function measureLoop(
  graph: RoadGraph,
  design: LoopDesign,
  nodes: readonly number[],
  edges: readonly number[],
): Loop {
  const ridden = new Map<number, number>();
  let lengthMetres = 0;
  let reusedMetres = 0;
  const bridge: boolean[] = [];
  edges.forEach((id, at) => {
    const edge = edgeBetween(
      graph,
      nodes[at] as number,
      nodes[(at + 1) % nodes.length] as number,
      id,
    );
    lengthMetres += edge.length;
    bridge.push(edge.bridge);
    const times = (ridden.get(id) ?? 0) + 1;
    ridden.set(id, times);
    if (times > 1) reusedMetres += edge.length;
  });
  const seen = new Set<number>();
  let crossings = 0;
  for (const node of nodes) {
    if (seen.has(node)) crossings += 1;
    seen.add(node);
  }
  const points = nodes.map((node) => graph.nodes[node] as LocalPoint);
  return {
    design,
    nodes,
    bridge,
    lengthMetres,
    reusedMetres,
    crossings,
    turnsBack: turnsSharperThan(points, TURN_BACK_DEGREES),
    turns: turnsSharperThan(points, CORNER_DEGREES),
    roundness: roundnessOf(points, lengthMetres),
  };
}

/** {@link Loop.roundness}: the shoelace area against the perimeter. */
export function roundnessOf(points: readonly LocalPoint[], perimeter: number): number {
  if (perimeter <= 0) return 0;
  let twice = 0;
  points.forEach((a, at) => {
    const b = points[(at + 1) % points.length] as LocalPoint;
    twice += a.x * b.z - b.x * a.z;
  });
  return (4 * Math.PI * Math.abs(twice / 2)) / (perimeter * perimeter);
}

/**
 * How many times a closed line changes direction by more than `degrees`
 * between two runs of at least {@link TURN_SEGMENT_METRES}.
 */
export function turnsSharperThan(points: readonly LocalPoint[], degrees: number): number {
  // Merge short segments into runs so a junction's kink is not judged.
  const runs: LocalPoint[] = [];
  for (const point of points) {
    const last = runs[runs.length - 1];
    if (last === undefined || distance(last, point) >= TURN_SEGMENT_METRES) runs.push(point);
  }
  let count = 0;
  for (let at = 0; at < runs.length; at += 1) {
    const a = runs[(at - 1 + runs.length) % runs.length] as LocalPoint;
    const b = runs[at] as LocalPoint;
    const c = runs[(at + 1) % runs.length] as LocalPoint;
    const inbound = Math.atan2(b.z - a.z, b.x - a.x);
    const outbound = Math.atan2(c.z - b.z, c.x - b.x);
    let turn = Math.abs(outbound - inbound);
    if (turn > Math.PI) turn = 2 * Math.PI - turn;
    if ((turn * 180) / Math.PI > degrees) count += 1;
  }
  return count;
}

/** The length a circuit may be (ADR 0064, #2293: "about 3–8 km"). */
export interface LengthBounds {
  readonly minMetres: number;
  readonly maxMetres: number;
  readonly targetMetres: number;
}

/** Lower is better; `undefined` for a loop outside the length bounds. */
export function scoreLoop(loop: Loop, bounds: LengthBounds): number | undefined {
  if (loop.lengthMetres < bounds.minMetres || loop.lengthMetres > bounds.maxMetres) {
    return undefined;
  }
  return (
    loop.reusedMetres * 10 +
    loop.crossings * 500 +
    loop.turnsBack * 300 +
    loop.turns * 40 +
    (1 - loop.roundness) * 2000 +
    Math.abs(loop.lengthMetres - bounds.targetMetres) / 10
  );
}

/** The designs {@link searchLoops} tries. */
export function designGrid(): readonly LoopDesign[] {
  const designs: LoopDesign[] = [];
  for (const corners of [2, 3, 4]) {
    for (let radius = 300; radius <= 1300; radius += 100) {
      for (let bearing = 0; bearing < 360; bearing += 30) {
        designs.push({ radiusMetres: radius, bearingDegrees: bearing, corners });
      }
    }
  }
  return designs;
}

/** The best loop from `start` over `designs`, or `undefined` when none fits the bounds. */
export function searchLoops(
  graph: RoadGraph,
  start: number,
  bounds: LengthBounds,
  designs: readonly LoopDesign[] = designGrid(),
): Loop | undefined {
  let best: Loop | undefined;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const design of designs) {
    const loop = drawLoop(graph, start, design);
    if (loop === undefined) continue;
    const score = scoreLoop(loop, bounds);
    if (score !== undefined && score < bestScore) {
      best = loop;
      bestScore = score;
    }
  }
  return best;
}

/** A loop's points with no gap over `maxStep` metres; `bridge[i]` says whether point `i` is on a bridge. */
export function densify(
  points: readonly LocalPoint[],
  bridge: readonly boolean[],
  maxStep: number,
): { readonly points: readonly LocalPoint[]; readonly bridge: readonly boolean[] } {
  const out: LocalPoint[] = [];
  const onBridge: boolean[] = [];
  points.forEach((a, at) => {
    const b = points[(at + 1) % points.length] as LocalPoint;
    const isBridge = bridge[at] === true;
    const steps = Math.max(1, Math.ceil(distance(a, b) / maxStep));
    for (let step = 0; step < steps; step += 1) {
      const t = step / steps;
      out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
      // A point is on the bridge when the segment it starts is, except the
      // segment's first point, which is where the bridge meets the ground.
      onBridge.push(isBridge && step > 0);
    }
  });
  return { points: out, bridge: onBridge };
}

/**
 * Heights with every run of bridge points replaced by a straight ramp between
 * the ground points either side: a bare-earth model reads the valley under a
 * bridge, not its deck. The line is closed, so a run may wrap.
 */
export function bridgeHeights(heights: readonly number[], bridge: readonly boolean[]): number[] {
  const out = [...heights];
  const count = heights.length;
  if (!bridge.some((each) => !each)) return out;
  for (let at = 0; at < count; at += 1) {
    if (!bridge[at] || bridge[(at - 1 + count) % count]) continue;
    // `at` starts a run; find its end.
    let end = at;
    while (bridge[(end + 1) % count]) end += 1;
    const before = (at - 1 + count) % count;
    const after = (end + 1) % count;
    const span = end - at + 2;
    for (let step = 1; step < span; step += 1) {
      const from = heights[before] as number;
      const to = heights[after] as number;
      out[(before + step) % count] = from + ((to - from) * step) / span;
    }
  }
  return out;
}
