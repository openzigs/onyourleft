// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The circuits' loop search — #2293, ADR 0064 D-7.1 — on synthetic street
 * grids. No archive, no coordinate: a grid of streets in local metres.
 */

import { describe, expect, it } from 'vitest';

import {
  bridgeHeights,
  buildGraph,
  cornerPoints,
  densify,
  drawLoop,
  nearestNode,
  REUSE_PENALTY,
  roundnessOf,
  scoreLoop,
  searchLoops,
  shortestPath,
  trimStem,
  turnsSharperThan,
  type LocalPoint,
  type StreetLine,
} from './loop';

/** A grid of `count` × `count` blocks of `block` metres, one street per row and column. */
function grid(count: number, block: number): StreetLine[] {
  const lines: StreetLine[] = [];
  for (let at = 0; at <= count; at += 1) {
    const row: LocalPoint[] = [];
    const column: LocalPoint[] = [];
    for (let step = 0; step <= count; step += 1) {
      row.push({ x: step * block, z: at * block });
      column.push({ x: at * block, z: step * block });
    }
    lines.push({ points: row, bridge: false, weight: 1 });
    lines.push({ points: column, bridge: false, weight: 1 });
  }
  return lines;
}

function nodeAt(graph: ReturnType<typeof buildGraph>, point: LocalPoint): number {
  const node = graph.nodes.findIndex(
    (each) => Math.hypot(each.x - point.x, each.z - point.z) < 0.01,
  );
  expect(node, `a node at ${String(point.x)},${String(point.z)}`).toBeGreaterThanOrEqual(0);
  return node;
}

describe('buildGraph', () => {
  it('makes one node of points within a metre, and one edge of two copies of a street', () => {
    const graph = buildGraph([
      {
        points: [
          { x: 0, z: 0 },
          { x: 100, z: 0 },
        ],
        bridge: false,
        weight: 1,
      },
      // The same street from a neighbouring tile, a fraction of a metre off.
      {
        points: [
          { x: 0.3, z: 0.2 },
          { x: 100.4, z: -0.1 },
        ],
        bridge: false,
        weight: 1,
      },
    ]);
    expect(graph.nodes).toHaveLength(2);
    expect(graph.edges[0]).toHaveLength(1);
  });

  it('joins a loose end to the street it stops on, where the tile simplified the junction away', () => {
    const graph = buildGraph([
      {
        points: [
          { x: 0, z: 0 },
          { x: 200, z: 0 },
        ],
        bridge: false,
        weight: 1,
      },
      // A side street ending 0.5 m short of the main street's middle.
      {
        points: [
          { x: 100, z: 100 },
          { x: 100, z: 0.5 },
        ],
        bridge: false,
        weight: 1,
      },
    ]);
    const from = nodeAt(graph, { x: 0, z: 0 });
    const to = nodeAt(graph, { x: 100, z: 100 });
    const path = shortestPath(graph, from, to);
    expect(path).toBeDefined();
    expect(path?.nodes).toHaveLength(3);
  });

  it('does not join a loose end that stops short of any street', () => {
    const graph = buildGraph([
      {
        points: [
          { x: 0, z: 0 },
          { x: 200, z: 0 },
        ],
        bridge: false,
        weight: 1,
      },
      {
        points: [
          { x: 100, z: 100 },
          { x: 100, z: 5 },
        ],
        bridge: false,
        weight: 1,
      },
    ]);
    expect(
      shortestPath(graph, nodeAt(graph, { x: 0, z: 0 }), nodeAt(graph, { x: 100, z: 100 })),
    ).toBeUndefined();
  });
});

describe('shortestPath', () => {
  it('takes a longer way round rather than ride an edge already ridden, up to the penalty', () => {
    const graph = buildGraph(grid(2, 100));
    const a = nodeAt(graph, { x: 0, z: 0 });
    const b = nodeAt(graph, { x: 100, z: 0 });
    const direct = shortestPath(graph, a, b);
    expect(direct?.edges).toHaveLength(1);
    const used = new Set(direct?.edges);
    const around = shortestPath(graph, b, a, used);
    // Round the block (300 m) costs less than the ridden edge again (100 m × the penalty).
    expect(REUSE_PENALTY * 100).toBeGreaterThan(300);
    expect(around?.edges).toHaveLength(3);
    expect(around?.edges.some((edge) => used.has(edge))).toBe(false);
  });
});

describe('drawLoop and searchLoops', () => {
  it('draws a closed loop of a design that rides no street twice on an open grid', () => {
    const graph = buildGraph(grid(10, 100));
    const start = nodeAt(graph, { x: 500, z: 200 });
    const loop = drawLoop(graph, start, { radiusMetres: 250, bearingDegrees: 0, corners: 4 });
    expect(loop).toBeDefined();
    if (loop === undefined) return;
    expect(loop.reusedMetres).toBe(0);
    expect(loop.crossings).toBe(0);
    expect(loop.nodes[0]).toBe(start);
    // Closed: the last node joins the first by an edge.
    const last = loop.nodes.at(-1) as number;
    expect(graph.edges[last]?.some((edge) => edge.to === start)).toBe(true);
    expect(loop.lengthMetres).toBeGreaterThan(1000);
  });

  it('keeps, of every design, the best loop within the length bounds', () => {
    const graph = buildGraph(grid(20, 100));
    const start = nodeAt(graph, { x: 1000, z: 1000 });
    const loop = searchLoops(graph, start, {
      minMetres: 3000,
      maxMetres: 5000,
      targetMetres: 4000,
    });
    expect(loop).toBeDefined();
    if (loop === undefined) return;
    expect(loop.lengthMetres).toBeGreaterThanOrEqual(3000);
    expect(loop.lengthMetres).toBeLessThanOrEqual(5000);
    expect(loop.reusedMetres).toBe(0);
    expect(loop.crossings).toBe(0);
    expect(loop.turnsBack).toBe(0);
  });

  it('answers none when no loop fits the bounds', () => {
    const graph = buildGraph(grid(2, 100));
    const start = nodeAt(graph, { x: 100, z: 100 });
    expect(
      searchLoops(graph, start, { minMetres: 3000, maxMetres: 8000, targetMetres: 5000 }),
    ).toBeUndefined();
  });

  it('cuts the stem off a loop whose start is out and back along one street', () => {
    // nodes 9 → 1 → 2 → 3 → 1 → back to 9: edges e0 (9-1) … e0 again.
    const trimmed = trimStem([9, 1, 2, 3, 1], [100, 101, 102, 103, 100]);
    expect(trimmed.nodes).toStrictEqual([1, 2, 3]);
    expect(trimmed.edges).toStrictEqual([101, 102, 103]);
    // A loop with no stem is unchanged.
    expect(trimStem([1, 2, 3], [5, 6, 7]).nodes).toStrictEqual([1, 2, 3]);
  });

  it('places corners on the circle round the start, the start one of them', () => {
    const start = { x: 0, z: 0 };
    // Centre due north (x is WEST, so north is +z): the opposite corner is 2r north.
    const [opposite] = cornerPoints(start, { radiusMetres: 100, bearingDegrees: 0, corners: 2 });
    expect(opposite?.x).toBeCloseTo(0);
    expect(opposite?.z).toBeCloseTo(200);
    // Centre due east: east is −x.
    const [east] = cornerPoints(start, { radiusMetres: 100, bearingDegrees: 90, corners: 2 });
    expect(east?.x).toBeCloseTo(-200);
    expect(east?.z).toBeCloseTo(0);
  });

  it('finds the nearest node a loop can turn at, and none beyond the distance asked', () => {
    const graph = buildGraph(grid(2, 100));
    expect(nearestNode(graph, { x: 98, z: 3 }, 50)).toBe(nodeAt(graph, { x: 100, z: 0 }));
    expect(nearestNode(graph, { x: 1000, z: 1000 }, 50)).toBeUndefined();
  });
});

describe('the figures a loop is judged on', () => {
  it('counts a turn back and a corner, and not a kink shorter than a run', () => {
    const square = [
      { x: 0, z: 0 },
      { x: 100, z: 0 },
      { x: 100, z: 100 },
      { x: 0, z: 100 },
    ];
    expect(turnsSharperThan(square, 60)).toBe(4);
    expect(turnsSharperThan(square, 150)).toBe(0);
    const outAndBack = [
      { x: 0, z: 0 },
      { x: 100, z: 0 },
      { x: 50, z: 0.1 },
    ];
    expect(turnsSharperThan(outAndBack, 150)).toBeGreaterThan(0);
  });

  it('measures roundness: a square is π/4, a sliver near 0', () => {
    const square = [
      { x: 0, z: 0 },
      { x: 100, z: 0 },
      { x: 100, z: 100 },
      { x: 0, z: 100 },
    ];
    expect(roundnessOf(square, 400)).toBeCloseTo(Math.PI / 4);
    expect(
      roundnessOf(
        [
          { x: 0, z: 0 },
          { x: 100, z: 0 },
          { x: 0, z: 1 },
        ],
        201,
      ),
    ).toBeLessThan(0.02);
  });

  it('scores a loop outside the bounds as none, and a reused street worse than a corner', () => {
    const base = {
      design: { radiusMetres: 500, bearingDegrees: 0, corners: 3 },
      nodes: [],
      bridge: [],
      lengthMetres: 5000,
      reusedMetres: 0,
      crossings: 0,
      turnsBack: 0,
      turns: 4,
      roundness: 0.7,
    };
    const bounds = { minMetres: 3000, maxMetres: 8000, targetMetres: 5000 };
    expect(scoreLoop({ ...base, lengthMetres: 2000 }, bounds)).toBeUndefined();
    const clean = scoreLoop(base, bounds) as number;
    expect(scoreLoop({ ...base, reusedMetres: 50 }, bounds)).toBeGreaterThan(clean + 400);
    expect(scoreLoop({ ...base, turns: 5 }, bounds)).toBeGreaterThan(clean);
  });
});

describe('densify and bridgeHeights', () => {
  it('leaves no gap wider than the step, and marks a bridge’s inner points only', () => {
    const points = [
      { x: 0, z: 0 },
      { x: 100, z: 0 },
      { x: 100, z: 30 },
    ];
    const dense = densify(points, [true, false, false], 15);
    dense.points.forEach((point, at) => {
      const next = dense.points[(at + 1) % dense.points.length] as LocalPoint;
      expect(Math.hypot(next.x - point.x, next.z - point.z)).toBeLessThanOrEqual(15.0001);
    });
    expect(dense.bridge[0]).toBe(false);
    expect(dense.bridge.slice(1, 7).every(Boolean)).toBe(true);
    expect(dense.bridge.slice(7).some(Boolean)).toBe(false);
  });

  it('ramps a bridge between the ground either side, so the valley under it is not ridden', () => {
    const heights = [10, 2, 1, 2, 20, 20];
    const bridge = [false, true, true, true, false, false];
    expect(bridgeHeights(heights, bridge)).toStrictEqual([10, 12.5, 15, 17.5, 20, 20]);
  });

  it('ramps a bridge that wraps past the start of the closed line', () => {
    const out = bridgeHeights([0, 50, 50, 50, 40, 0], [true, false, false, false, false, true]);
    // Ground either side: index 4 (40) and index 1 (50), across 5 and 0.
    expect(out[5]).toBeCloseTo(40 + (50 - 40) / 3);
    expect(out[0]).toBeCloseTo(40 + (2 * (50 - 40)) / 3);
  });

  it('leaves heights alone with no ground to ramp from', () => {
    expect(bridgeHeights([1, 2], [true, true])).toStrictEqual([1, 2]);
  });
});
