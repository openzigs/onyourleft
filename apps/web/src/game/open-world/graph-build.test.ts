// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2990: the street graph built off the main thread. What the page's mirror
 * holds after each change is read back against a `StreetGraph` built directly
 * from the same tiles — the answer the session read before the graph moved to
 * a worker — so a stitch, an unjoin or a renamed end the delta missed is a
 * difference here. The worker's own file is driven through the global scope it
 * reads.
 */

import {
  decodeTile,
  StreetGraph,
  type StreetGraphEdge,
  type TileId,
} from '@onyourleft/map-features';
import {
  EAST_TILE,
  FIXTURE_FRAME,
  FIXTURE_TILE,
  GRAPH_FIXTURES,
  graphFixtureTile,
  starTile,
  type GraphFixture,
} from '@onyourleft/map-features/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  graphBuilder,
  graphWorkerCore,
  inlineGraphWorker,
  StreetMirror,
  workerGraphBuilder,
  type GraphChange,
  type GraphReply,
  type GraphTile,
  type GraphWorkerLike,
} from './graph-build';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

function tileOf(fixture: GraphFixture, tile: TileId): GraphTile {
  const decoded = decodeTile(graphFixtureTile(fixture.streets, tile), tile, FIXTURE_FRAME);
  if ('reason' in decoded) throw new Error(`refused: ${decoded.reason}`);
  return { tile, streets: decoded.streets };
}

/** The graph's answer, as the session reads it: each node's edges, each edge's ends and line. */
function answerOf(graph: {
  edges(): Iterable<StreetGraphEdge>;
  node(id: number): { readonly edges: readonly number[] } | undefined;
}): { nodes: Record<number, readonly number[]>; edges: Record<number, string> } {
  const nodes: Record<number, readonly number[]> = {};
  const edges: Record<number, string> = {};
  for (const edge of graph.edges()) {
    edges[edge.id] = `${String(edge.from)}>${String(edge.to)}:${Array.from(edge.line).join(',')}`;
    for (const end of [edge.from, edge.to]) {
      nodes[end] = graph.node(end)?.edges ?? [];
    }
  }
  return { nodes, edges };
}

/** A street straight across the seam and a side street from the seam: two tiles, one junction on the seam. */
const west = tileOf(GRAPH_FIXTURES.seamJunction, FIXTURE_TILE);
const east = tileOf(GRAPH_FIXTURES.seamJunction, EAST_TILE);

describe('the street graph built where the worker builds it — #2990', () => {
  it('mirrors the graph a tile at a time: added, stitched across the seam, and unjoined', async () => {
    const builder = workerGraphBuilder(FIXTURE_FRAME, inlineGraphWorker);
    const mirror = new StreetMirror();
    const direct = new StreetGraph(FIXTURE_FRAME);
    const steps: { change: GraphChange; apply: () => void }[] = [
      { change: { add: [west], remove: [] }, apply: () => direct.addTile(west.tile, west.streets) },
      { change: { add: [east], remove: [] }, apply: () => direct.addTile(east.tile, east.streets) },
      { change: { add: [], remove: [west.tile] }, apply: () => direct.removeTile(west.tile) },
      { change: { add: [west], remove: [] }, apply: () => direct.addTile(west.tile, west.streets) },
      { change: { add: [], remove: [east.tile] }, apply: () => direct.removeTile(east.tile) },
    ];
    let version = mirror.version;
    for (const { change, apply } of steps) {
      const delta = await builder.apply(change);
      expect(delta).toBeDefined();
      if (delta !== undefined) mirror.apply(delta);
      apply();
      expect(answerOf(mirror)).toStrictEqual(answerOf(direct));
      expect(mirror.version).toBeGreaterThan(version);
      version = mirror.version;
    }
    // A change that changes nothing moves no version.
    const none = await builder.apply({ add: [], remove: [] });
    if (none !== undefined) mirror.apply(none);
    expect(none?.nodes).toStrictEqual([]);
    expect(mirror.version).toBe(version);
    builder.stop();
  });

  it('sends only what changed: the second tile does not resend the first tile’s edges', () => {
    const core = graphWorkerCore();
    expect(core.handle({ kind: 'frame', frame: FIXTURE_FRAME })).toBeUndefined();
    const first = core.handle({ kind: 'change', id: 0, change: { add: [west], remove: [] } });
    const second = core.handle({ kind: 'change', id: 1, change: { add: [east], remove: [] } });
    if (first?.kind !== 'delta' || second?.kind !== 'delta') throw new Error('no delta');
    const firstIds = new Set(first.delta.edges.map((edge) => edge.id));
    expect(firstIds.size).toBeGreaterThan(0);
    expect(second.delta.edges.some((edge) => firstIds.has(edge.id))).toBe(false);
    // The seam node is stitched: the west tile's end of it now has the east tile's edges too.
    expect(second.delta.nodes.some((node) => node.edges.some((id) => firstIds.has(id)))).toBe(true);
  });

  it('hands a refused tile back as the graph’s own value, and leaves the graph as it was', async () => {
    const builder = workerGraphBuilder(FIXTURE_FRAME, inlineGraphWorker);
    const hostile = decodeTile(starTile(3000, 200), FIXTURE_TILE, FIXTURE_FRAME);
    if ('reason' in hostile) throw new Error('the star tile did not decode');
    const delta = await builder.apply({
      add: [{ tile: FIXTURE_TILE, streets: hostile.streets }],
      remove: [],
    });
    expect(delta?.refusals).toHaveLength(1);
    expect(delta?.edges).toStrictEqual([]);
    builder.stop();
  });

  it('fails a change with no frame before it, and ignores what is not a request', () => {
    const core = graphWorkerCore();
    expect(core.handle({ kind: 'change', id: 3, change: { add: [], remove: [] } })).toStrictEqual({
      kind: 'failed',
      id: 3,
    });
    expect(core.handle(null)).toBeUndefined();
    expect(core.handle('frame')).toBeUndefined();
    expect(core.handle({ kind: 'other' })).toBeUndefined();
  });

  it('fails a change the graph throws on, and the builder resolves it and every later one as nothing', async () => {
    const builder = workerGraphBuilder(FIXTURE_FRAME, inlineGraphWorker);
    // Not a whole tile id: `addTile` throws for a caller's error.
    const bad = await builder.apply({
      add: [{ tile: { z: 15, x: 1.5, y: 1 }, streets: [] }],
      remove: [],
    });
    expect(bad).toBeUndefined();
    expect(await builder.apply({ add: [west], remove: [] })).toBeUndefined();
  });
});

describe('the builder over a worker — #2990', () => {
  /** A worker that answers nothing until told to. */
  function silentWorker(): GraphWorkerLike & { posted: unknown[]; ended: number } {
    return {
      posted: [],
      ended: 0,
      postMessage(message) {
        this.posted.push(message);
      },
      terminate() {
        this.ended += 1;
      },
      onmessage: null,
      onerror: null,
    };
  }

  it('sends the frame first, and resolves what waits as nothing when the worker errors', async () => {
    const worker = silentWorker();
    const builder = workerGraphBuilder(FIXTURE_FRAME, () => worker);
    expect(worker.posted).toStrictEqual([{ kind: 'frame', frame: FIXTURE_FRAME }]);
    const waiting = builder.apply({ add: [], remove: [] });
    worker.onerror?.(new Event('error'));
    expect(await waiting).toBeUndefined();
    expect(worker.ended).toBe(1);
    expect(await builder.apply({ add: [], remove: [] })).toBeUndefined();
  });

  it('resolves what waits as nothing when stopped, and ends the worker once', async () => {
    const worker = silentWorker();
    const builder = workerGraphBuilder(FIXTURE_FRAME, () => worker);
    const waiting = builder.apply({ add: [], remove: [] });
    builder.stop();
    builder.stop();
    expect(await waiting).toBeUndefined();
    expect(worker.ended).toBe(1);
  });

  it('ignores a reply that is not one of its own', async () => {
    const worker = silentWorker();
    const builder = workerGraphBuilder(FIXTURE_FRAME, () => worker);
    const waiting = builder.apply({ add: [], remove: [] });
    worker.onmessage?.({ data: null });
    worker.onmessage?.({ data: { kind: 'delta', id: 99 } });
    const empty = { nodes: [], dropNodes: [], edges: [], dropEdges: [], refusals: [] };
    worker.onmessage?.({ data: { kind: 'delta', id: 0, delta: empty } satisfies GraphReply });
    expect(await waiting).toStrictEqual(empty);
    builder.stop();
  });

  it('uses the platform’s worker where there is one, and the same handler here where it refuses', async () => {
    const made: unknown[] = [];
    vi.stubGlobal(
      'Worker',
      class {
        constructor(url: URL, options: unknown) {
          made.push([String(url), options]);
          throw new Error('refused by the page’s policy');
        }
      },
    );
    const builder = graphBuilder(FIXTURE_FRAME);
    expect(made).toHaveLength(1);
    expect(String((made[0] as [string])[0])).toMatch(/graph-worker\.ts$/);
    // Refused, it rides on: the change is built on this thread.
    const delta = await builder.apply({ add: [west], remove: [] });
    expect(delta?.edges.length).toBeGreaterThan(0);
    builder.stop();
  });
});

describe('the worker’s own file — #2990', () => {
  it('answers each request on its scope with the handler’s reply', async () => {
    const posted: unknown[] = [];
    vi.stubGlobal('postMessage', (message: unknown) => {
      posted.push(message);
    });
    vi.stubGlobal('onmessage', null);
    await import('./graph-worker');
    const scope = globalThis as unknown as { onmessage: (event: { data: unknown }) => void };
    scope.onmessage({ data: { kind: 'frame', frame: FIXTURE_FRAME } });
    expect(posted).toStrictEqual([]);
    scope.onmessage({
      data: { kind: 'change', id: 7, change: { add: [west], remove: [] } },
    });
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({ kind: 'delta', id: 7 });
  });
});
