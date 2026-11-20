// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';

import { decodeTile } from './decode';
import {
  DEFAULT_STREET_GRAPH_LIMITS,
  describeStreetGraphRefusal,
  inStreetGraph,
  StreetGraph,
  type StreetGraphEdge,
  type StreetGraphLimits,
  type StreetGraphNode,
  type StreetGraphRefusal,
} from './street-graph';
import {
  EAST_TILE,
  FIXTURE_FRAME,
  FIXTURE_TILE,
  fixturePixelMetres,
  GRAPH_FIXTURES,
  graphFixtureTile,
  SEAM_GRADE_STREETS,
  starTile,
  type GraphFixture,
  type GraphFixtureName,
  type Pixel,
} from './testing';
import type { DecodedStreetFeature, TileId } from './types';

/** The fixture's streets for one tile, as `decodeTile` hands them out: the path the web app takes. */
function decodedStreets(fixture: GraphFixture, tile: TileId): readonly DecodedStreetFeature[] {
  const result = decodeTile(graphFixtureTile(fixture.streets, tile), tile, FIXTURE_FRAME);
  if ('reason' in result) throw new Error(`refused: ${result.reason}`);
  return result.streets;
}

function graphOf(
  fixture: GraphFixture,
  order: readonly TileId[] = fixture.tiles,
  limits: StreetGraphLimits = DEFAULT_STREET_GRAPH_LIMITS,
): StreetGraph {
  const graph = new StreetGraph(FIXTURE_FRAME, limits);
  for (const tile of order) expect(graph.addTile(tile, decodedStreets(fixture, tile))).toBeNull();
  return graph;
}

/** The one node at a fixture pixel, to 1 cm. */
function nodeAt(nodes: readonly StreetGraphNode[], pixel: Pixel): StreetGraphNode {
  const want = fixturePixelMetres(pixel);
  const found = nodes.filter((node) => Math.hypot(node.x - want.x, node.z - want.z) < 0.01);
  expect(found, `one node at pixel ${String(pixel)}`).toHaveLength(1);
  return found[0] as StreetGraphNode;
}

/**
 * The graph is exactly the fixture's: as many nodes and edges, each where and
 * what it says, every edge's line running from its `from` node to its `to`,
 * and every node's edges ending at it. Read back through the graph's own
 * public reads: `nodes()`, `edges()`, `node()` and `edge()`.
 */
function expectExactly(graph: StreetGraph, fixture: GraphFixture): void {
  const nodes = graph.nodes();
  const edges = graph.edges();
  expect(nodes).toHaveLength(fixture.nodes.length);
  expect(edges).toHaveLength(fixture.edges.length);
  for (const expected of fixture.nodes) {
    const node = nodeAt(nodes, expected.at);
    expect([expected.at, node.kind, node.edges.length]).toEqual([
      expected.at,
      expected.kind,
      expected.degree,
    ]);
    expect(graph.node(node.id)).toEqual(node);
  }
  for (const expected of fixture.edges) {
    const from = nodeAt(nodes, expected.from);
    const to = nodeAt(nodes, expected.to);
    const matching = edges.filter((edge) => edge.from === from.id && edge.to === to.id);
    expect(matching, `one edge ${String(expected.from)} → ${String(expected.to)}`).toHaveLength(1);
    const edge = matching[0] as StreetGraphEdge;
    expect({
      kind: edge.kind,
      grade: edge.grade,
      oneway: edge.oneway,
      isLink: edge.isLink,
      points: edge.line.length / 2,
    }).toEqual({
      kind: expected.kind,
      grade: expected.grade ?? 'ground',
      oneway: expected.oneway ?? 'no',
      isLink: expected.isLink ?? false,
      points: expected.points,
    });
    const line = edge.line;
    const n = line.length;
    expect(Math.hypot((line[0] as number) - from.x, (line[1] as number) - from.z)).toBeLessThan(
      0.01,
    );
    expect(Math.hypot((line[n - 2] as number) - to.x, (line[n - 1] as number) - to.z)).toBeLessThan(
      0.01,
    );
    let metres = 0;
    for (let i = 2; i < n; i += 2) {
      metres += Math.hypot(
        (line[i] as number) - (line[i - 2] as number),
        (line[i + 1] as number) - (line[i - 1] as number),
      );
    }
    expect(Math.abs(edge.metres - metres)).toBeLessThan(0.01);
    expect(graph.edge(edge.id)).toEqual(edge);
  }
  // Every edge end is listed at its node, and no node lists an edge that is not there.
  for (const node of nodes) {
    expect(node.edges.length).toBeGreaterThan(0);
    for (const id of node.edges) {
      const edge = edges.find((e) => e.id === id) as StreetGraphEdge;
      expect(edge.from === node.id || edge.to === node.id).toBe(true);
    }
  }
  const ends = edges.flatMap((edge) => [edge.from, edge.to]).sort((a, b) => a - b);
  expect(nodes.flatMap((node) => node.edges.map(() => node.id)).sort((a, b) => a - b)).toEqual(
    ends,
  );
}

/** Everything a consumer can read, as plain values, for comparing two states of one graph. */
function snapshot(graph: StreetGraph): unknown {
  return {
    nodes: graph.nodes().sort((a, b) => a.id - b.id),
    edges: graph
      .edges()
      .sort((a, b) => a.id - b.id)
      .map((edge) => ({ ...edge, line: [...edge.line] })),
  };
}

describe('StreetGraph on the synthetic fixtures (#2894, ADR 0091 D-4)', () => {
  const names = Object.keys(GRAPH_FIXTURES) as GraphFixtureName[];
  for (const name of names) {
    it(`${name}: exactly the nodes and edges the fixture names`, () => {
      const fixture: GraphFixture = GRAPH_FIXTURES[name];
      expectExactly(graphOf(fixture), fixture);
    });
  }

  it('seamJunction and acrossSeam: the same graph whichever tile arrives first', () => {
    for (const fixture of [GRAPH_FIXTURES.seamJunction, GRAPH_FIXTURES.acrossSeam]) {
      expectExactly(graphOf(fixture, [EAST_TILE, FIXTURE_TILE]), fixture);
    }
  });

  it('onewayPair: every edge at a junction is offered, against its oneway too (D-5)', () => {
    const fixture = GRAPH_FIXTURES.onewayPair;
    const graph = graphOf(fixture);
    const nodes = graph.nodes();
    for (const pixel of [
      [2000, 1000],
      [2000, 1060],
    ] as const) {
      const junction = nodeAt(nodes, pixel);
      const ways = junction.edges.map((id) => graph.edge(id) as StreetGraphEdge);
      // Both halves of the carriageway: the one its traffic arrives on and the
      // one it leaves on, so the rider may take it either way.
      const carriageway = ways.filter((edge) => edge.kind === 'major_road');
      expect(carriageway).toHaveLength(2);
      expect(carriageway.filter((edge) => edge.to === junction.id)).toHaveLength(1);
      expect(carriageway.filter((edge) => edge.from === junction.id)).toHaveLength(1);
      expect(ways).toHaveLength(4);
    }
  });

  it('a tile whose every street is left out adds nothing, and is held', () => {
    const graph = new StreetGraph(FIXTURE_FRAME);
    const streets = decodedStreets(GRAPH_FIXTURES.leftOut, FIXTURE_TILE).filter(
      (street) => !inStreetGraph(street),
    );
    expect(streets).toHaveLength(4);
    expect(graph.addTile(FIXTURE_TILE, streets)).toBeNull();
    expect(graph.hasTile(FIXTURE_TILE)).toBe(true);
    expect([graph.nodes(), graph.edges()]).toEqual([[], []]);
  });
});

describe('StreetGraph is incremental across a seam', () => {
  const fixture = GRAPH_FIXTURES.acrossSeam;

  it('adding the east tile joins the street across the seam; removing it unjoins it, with no orphan', () => {
    const graph = graphOf(fixture, [FIXTURE_TILE]);
    const alone = snapshot(graph);
    // Alone, the street runs on into a tile that is not loaded.
    const nodes = graph.nodes();
    expect(nodes).toHaveLength(2);
    expect(nodeAt(nodes, [4096, 1000]).kind).toBe('tile-edge');
    expect(nodeAt(nodes, [2000, 1000]).kind).toBe('dead-end');

    expect(graph.addTile(EAST_TILE, decodedStreets(fixture, EAST_TILE))).toBeNull();
    expectExactly(graph, fixture);

    expect(graph.removeTile(EAST_TILE)).toBe(true);
    expect(graph.hasTile(EAST_TILE)).toBe(false);
    expect(graph.tileCount).toBe(1);
    // Exactly as it was before: the seam end is a tile edge again, its id and
    // every edge unchanged, and nothing of the east tile left.
    expect(snapshot(graph)).toEqual(alone);
    for (const node of graph.nodes()) expect(node.edges.length).toBeGreaterThan(0);
  });

  it('removing the first tile leaves the second whole, its seam end its own node', () => {
    const graph = graphOf(fixture);
    const joined = nodeAt(graph.nodes(), [4096, 1000]);
    expect(graph.removeTile(FIXTURE_TILE)).toBe(true);
    const nodes = graph.nodes();
    expect(nodes).toHaveLength(2);
    const seam = nodeAt(nodes, [4096, 1000]);
    expect(seam.kind).toBe('tile-edge');
    expect(seam.id).not.toBe(joined.id);
    expect(graph.node(joined.id)).toBeUndefined();
    expect(graph.edges()).toHaveLength(1);
    for (const node of nodes) expect(node.edges.length).toBe(1);
    // And adding it back joins them again.
    expect(graph.addTile(FIXTURE_TILE, decodedStreets(fixture, FIXTURE_TILE))).toBeNull();
    expectExactly(graph, fixture);
  });

  it('a seam end whose neighbour is loaded but has nothing to meet it is a dead end', () => {
    const graph = graphOf(fixture, [FIXTURE_TILE]);
    expect(graph.addTile(EAST_TILE, [])).toBeNull();
    expect(nodeAt(graph.nodes(), [4096, 1000]).kind).toBe('dead-end');
  });

  it('a seam end is never stitched to one of another grade: a street does not join a bridge at a seam', () => {
    const fixture: GraphFixture = {
      tiles: [FIXTURE_TILE, EAST_TILE],
      streets: SEAM_GRADE_STREETS,
      nodes: [],
      edges: [],
    };
    const graph = graphOf(fixture);
    const want = fixturePixelMetres([4096, 1000]);
    const atSeam = graph
      .nodes()
      .filter((node) => Math.hypot(node.x - want.x, node.z - want.z) < 0.01);
    // Two nodes, one a tile, each the end of its own street.
    expect(atSeam).toHaveLength(2);
    expect(atSeam.map((node) => [node.kind, node.edges.length])).toEqual([
      ['dead-end', 1],
      ['dead-end', 1],
    ]);
    expect(
      graph
        .edges()
        .map((edge) => edge.grade)
        .sort(),
    ).toEqual(['bridge', 'ground']);
  });

  it('removing a tile not held changes nothing', () => {
    const graph = graphOf(fixture, [FIXTURE_TILE]);
    const before = snapshot(graph);
    expect(graph.removeTile(EAST_TILE)).toBe(false);
    expect(snapshot(graph)).toEqual(before);
  });
});

describe('StreetGraph is bounded (ADR 0091 D-8)', () => {
  const crossroads = GRAPH_FIXTURES.crossroads;
  const tight = (overrides: Partial<StreetGraphLimits>): StreetGraphLimits => ({
    ...DEFAULT_STREET_GRAPH_LIMITS,
    ...overrides,
  });

  /** The message names the constraint and its limit, and holds no other number: no coordinate, no tile id. */
  function expectNamesOnly(refusal: StreetGraphRefusal | null, constraint: RegExp): void {
    expect(refusal).not.toBeNull();
    const message = describeStreetGraphRefusal(refusal as StreetGraphRefusal);
    expect(message).toMatch(constraint);
    expect(message.match(/\d+/g)).toEqual([String((refusal as StreetGraphRefusal).limit)]);
    expect(message).not.toContain(String(FIXTURE_TILE.x));
    expect(message).not.toContain(String(FIXTURE_TILE.y));
  }

  const cases: readonly {
    name: string;
    limits: Partial<StreetGraphLimits>;
    refusal: StreetGraphRefusal;
    constraint: RegExp;
  }[] = [
    {
      name: 'nodes a tile',
      limits: { maxNodesPerTile: 4 },
      refusal: { reason: 'too-many-nodes', scope: 'tile', limit: 4 },
      constraint: /more nodes than the limit of 4 a tile/,
    },
    {
      name: 'edges a tile',
      limits: { maxEdgesPerTile: 3 },
      refusal: { reason: 'too-many-edges', scope: 'tile', limit: 3 },
      constraint: /more edges than the limit of 3 a tile/,
    },
    {
      name: 'segments a tile',
      limits: { maxSegmentsPerTile: 1 },
      refusal: { reason: 'too-many-segments', limit: 1 },
      constraint: /more street segments than the limit of 1/,
    },
    {
      name: 'index work a tile',
      limits: { maxIndexWorkPerTile: 10 },
      refusal: { reason: 'too-dense', limit: 10 },
      constraint: /more index work than the limit of 10/,
    },
  ];
  for (const testCase of cases) {
    it(`a tile over the ${testCase.name} is refused, naming the constraint and no coordinate, and the graph is unchanged`, () => {
      const graph = new StreetGraph(FIXTURE_FRAME, tight(testCase.limits));
      const refusal = graph.addTile(FIXTURE_TILE, decodedStreets(crossroads, FIXTURE_TILE));
      expect(refusal).toEqual(testCase.refusal);
      expectNamesOnly(refusal, testCase.constraint);
      expect(graph.hasTile(FIXTURE_TILE)).toBe(false);
      expect([graph.nodes(), graph.edges(), graph.tileCount]).toEqual([[], [], 0]);
    });
  }

  it('the same tile at exactly each limit is added', () => {
    const graph = new StreetGraph(
      FIXTURE_FRAME,
      tight({ maxNodesPerTile: 5, maxEdgesPerTile: 4, maxSegmentsPerTile: 2 }),
    );
    expect(graph.addTile(FIXTURE_TILE, decodedStreets(crossroads, FIXTURE_TILE))).toBeNull();
    expectExactly(graph, crossroads);
  });

  it('a tile that would take the graph past its total is refused, and the tiles held are untouched', () => {
    const fixture = GRAPH_FIXTURES.seamJunction;
    for (const [limits, refusal] of [
      [{ maxNodes: 3 }, { reason: 'too-many-nodes', scope: 'graph', limit: 3 }],
      [{ maxEdges: 2 }, { reason: 'too-many-edges', scope: 'graph', limit: 2 }],
    ] as const) {
      const graph = graphOf(fixture, [FIXTURE_TILE], tight(limits));
      const before = snapshot(graph);
      const got = graph.addTile(EAST_TILE, decodedStreets(fixture, EAST_TILE));
      expect(got).toEqual(refusal);
      expectNamesOnly(got, /would take the graph past its limit/);
      expect(graph.hasTile(EAST_TILE)).toBe(false);
      expect(snapshot(graph)).toEqual(before);
    }
  });

  it('a hostile tile of 3,000 streets through one point is refused under the default limits', () => {
    const decoded = decodeTile(starTile(3000, 200), FIXTURE_TILE, FIXTURE_FRAME);
    if ('reason' in decoded) throw new Error(`refused: ${decoded.reason}`);
    expect(decoded.streets).toHaveLength(3000);
    const graph = new StreetGraph(FIXTURE_FRAME);
    const refusal = graph.addTile(FIXTURE_TILE, decoded.streets);
    expect(refusal).toEqual({
      reason: 'too-many-edges',
      scope: 'tile',
      limit: DEFAULT_STREET_GRAPH_LIMITS.maxEdgesPerTile,
    });
    expect(graph.tileCount).toBe(0);
  });

  it('a modest star is built whole: one junction, every arm an edge', () => {
    const decoded = decodeTile(starTile(12, 200), FIXTURE_TILE, FIXTURE_FRAME);
    if ('reason' in decoded) throw new Error(`refused: ${decoded.reason}`);
    const graph = new StreetGraph(FIXTURE_FRAME);
    expect(graph.addTile(FIXTURE_TILE, decoded.streets)).toBeNull();
    const junctions = graph.nodes().filter((node) => node.kind === 'junction');
    expect(junctions).toHaveLength(1);
    expect(junctions[0]?.edges).toHaveLength(24);
    expect(graph.edges()).toHaveLength(24);
  });
});

describe('StreetGraph on a caller error', () => {
  it('throws on a tile added twice, naming no tile id', () => {
    const graph = graphOf(GRAPH_FIXTURES.crossroads);
    expect(() => graph.addTile(FIXTURE_TILE, [])).toThrow(
      /^StreetGraph\.addTile: the tile is already in the graph$/,
    );
  });

  it('throws on a tile id that is not z15, naming no coordinate', () => {
    const graph = new StreetGraph(FIXTURE_FRAME);
    expect(() => graph.addTile({ ...FIXTURE_TILE, z: 14 } as unknown as TileId, [])).toThrow(
      /^StreetGraph\.addTile: the tile id is not a z15 tile$/,
    );
  });
});
