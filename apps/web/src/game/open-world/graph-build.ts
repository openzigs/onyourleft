// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The open-world street graph, built off the main thread** — #2990.
 *
 * The ride's graph (`@onyourleft/map-features` §`StreetGraph`, #2894) grows
 * as the map round the rider is read (`world-data/area.ts`) and drops the
 * tiles left behind. Building a tile — clipping, snapping, crossing,
 * T-snapping and stitching up to 50,000 segments — is too much work for a
 * frame, so it is done in a worker (`graph-worker.ts`), and the page holds a
 * copy of the graph's answer, a {@link StreetMirror}, which the rolling route
 * reads synchronously as it extends.
 *
 * ## The protocol
 *
 * The page sends the frame once ({@link GraphRequest} `frame`), then each
 * change as the reader's held tiles change: the tiles to add, each with its
 * own decoded streets, and the tiles to remove. The worker applies it to its
 * `StreetGraph` and replies with what changed **in the graph's answer**: the
 * nodes and edges that are new or whose ends or edges changed (a seam
 * stitched or unjoined, an edge's end renamed when the node it was stitched
 * into went), and the ids that went. The worker works the difference out
 * against what it last sent, so what crosses the thread is the change, never
 * the whole graph, and a stitch is never worked out twice.
 *
 * Replies come back in the order the changes were sent, each under its
 * request's id. A worker that fails — an error, or a reply that is not one —
 * is stopped, and every change waiting or sent after resolves as `undefined`:
 * the ride rides on the graph it has.
 *
 * ## Where there is no worker
 *
 * {@link graphBuilder} makes the real one where the platform has `Worker`,
 * and otherwise — jsdom, or a platform that refuses to make one — runs the
 * SAME request handler ({@link graphWorkerCore}) on this thread, a microtask
 * later, so both answer one protocol. The worker's own file is three lines
 * over that handler.
 *
 * ⚠️ **Nothing here names a coordinate in words** (ADR 0004 D): a refusal is
 * handed back as the graph's own value and put into words by
 * `describeStreetGraphRefusal` alone, by the session.
 */

import {
  StreetGraph,
  type CorridorFrame,
  type DecodedStreetFeature,
  type StreetGraphEdge,
  type StreetGraphRefusal,
  type TileId,
} from '@onyourleft/map-features';

/** One tile to add: its id and its own decoded streets (`area.ts` §`HeldBlock.streets`). */
export interface GraphTile {
  readonly tile: TileId;
  readonly streets: readonly DecodedStreetFeature[];
}

/** One change to the graph: tiles added and tiles removed. */
export interface GraphChange {
  readonly add: readonly GraphTile[];
  readonly remove: readonly TileId[];
}

/** A node as the mirror holds it: its id and every edge end at it (`StreetGraphNode`). */
export interface GraphNodeEntry {
  readonly id: number;
  readonly edges: readonly number[];
}

/** What one change did to the graph's answer. */
export interface GraphDelta {
  /** Nodes new, or whose edges changed. */
  readonly nodes: readonly GraphNodeEntry[];
  readonly dropNodes: readonly number[];
  /** Edges new, or whose ends changed. */
  readonly edges: readonly StreetGraphEdge[];
  readonly dropEdges: readonly number[];
  /** Tiles the graph refused (`StreetGraph.addTile`), as values. */
  readonly refusals: readonly StreetGraphRefusal[];
}

/** What the page sends the worker. */
export type GraphRequest =
  | { readonly kind: 'frame'; readonly frame: CorridorFrame }
  | { readonly kind: 'change'; readonly id: number; readonly change: GraphChange };

/** What the worker sends back. */
export type GraphReply =
  | { readonly kind: 'delta'; readonly id: number; readonly delta: GraphDelta }
  | { readonly kind: 'failed'; readonly id: number };

const tileKey = (tile: TileId): string => `${String(tile.x)}/${String(tile.y)}`;

/** The graph where it is built, and what of its answer was last sent. */
class GraphBuild {
  readonly #graph: StreetGraph;
  readonly #nodes = new Map<number, string>();
  readonly #edges = new Map<number, string>();

  constructor(frame: CorridorFrame) {
    this.#graph = new StreetGraph(frame);
  }

  apply(change: GraphChange): GraphDelta {
    const refusals: StreetGraphRefusal[] = [];
    for (const tile of change.remove) this.#graph.removeTile(tile);
    const adding = new Set<string>();
    for (const { tile, streets } of change.add) {
      const key = tileKey(tile);
      if (this.#graph.hasTile(tile) || adding.has(key)) continue;
      adding.add(key);
      const refusal = this.#graph.addTile(tile, streets);
      if (refusal !== null) refusals.push(refusal);
    }
    const nodes: GraphNodeEntry[] = [];
    const seenNodes = new Set<number>();
    for (const node of this.#graph.nodes()) {
      seenNodes.add(node.id);
      const signature = node.edges.join(',');
      if (this.#nodes.get(node.id) === signature) continue;
      this.#nodes.set(node.id, signature);
      nodes.push({ id: node.id, edges: [...node.edges] });
    }
    const dropNodes: number[] = [];
    for (const id of [...this.#nodes.keys()]) {
      if (seenNodes.has(id)) continue;
      this.#nodes.delete(id);
      dropNodes.push(id);
    }
    const edges: StreetGraphEdge[] = [];
    const seenEdges = new Set<number>();
    for (const edge of this.#graph.edges()) {
      seenEdges.add(edge.id);
      const signature = `${String(edge.from)},${String(edge.to)}`;
      if (this.#edges.get(edge.id) === signature) continue;
      this.#edges.set(edge.id, signature);
      edges.push(edge);
    }
    const dropEdges: number[] = [];
    for (const id of [...this.#edges.keys()]) {
      if (seenEdges.has(id)) continue;
      this.#edges.delete(id);
      dropEdges.push(id);
    }
    return { nodes, dropNodes, edges, dropEdges, refusals };
  }
}

/**
 * The worker's request handler: the frame, then each change. A change with no
 * frame before it, or one the graph throws on, is `failed`; anything that is
 * not a request is ignored.
 */
export function graphWorkerCore(): { handle(data: unknown): GraphReply | undefined } {
  let build: GraphBuild | undefined;
  return {
    handle: (data) => {
      if (typeof data !== 'object' || data === null) return undefined;
      const request = data as GraphRequest;
      if (request.kind === 'frame') {
        build = new GraphBuild(request.frame);
        return undefined;
      }
      if (request.kind !== 'change' || typeof request.id !== 'number') return undefined;
      if (build === undefined) return { kind: 'failed', id: request.id };
      try {
        return { kind: 'delta', id: request.id, delta: build.apply(request.change) };
      } catch {
        return { kind: 'failed', id: request.id };
      }
    },
  };
}

/** The slice of a `Worker` the builder uses, so a test — and the fallback — can supply one. */
export interface GraphWorkerLike {
  postMessage(message: GraphRequest): void;
  terminate(): void;
  onmessage: ((event: { readonly data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

/**
 * The real worker.
 *
 * ⚠️ **This exact expression is what Vite looks for** — `new Worker(new
 * URL(…, import.meta.url), …)` — to bundle `graph-worker.ts` and what it
 * imports into a worker script (`camera/pose-estimator.ts` §`poseWorker`).
 */
function realGraphWorker(): GraphWorkerLike {
  return new Worker(new URL('./graph-worker.ts', import.meta.url), {
    type: 'module',
    name: 'oyl-street-graph',
  }) as unknown as GraphWorkerLike;
}

/** {@link graphWorkerCore} on this thread, answering a microtask later, as a worker would. */
export function inlineGraphWorker(): GraphWorkerLike {
  const core = graphWorkerCore();
  let live = true;
  const worker: GraphWorkerLike = {
    postMessage: (message) => {
      queueMicrotask(() => {
        if (!live) return;
        const reply = core.handle(message);
        if (reply !== undefined) worker.onmessage?.({ data: reply });
      });
    },
    terminate: () => {
      live = false;
    },
    onmessage: null,
    onerror: null,
  };
  return worker;
}

/** Where the graph is built, from the page's side. */
export interface GraphBuilder {
  /**
   * Applies `change`, and resolves with what it did to the graph's answer, in
   * the order changes were made; `undefined` once the builder has failed or
   * been stopped. Never rejects.
   */
  apply(change: GraphChange): Promise<GraphDelta | undefined>;
  /** Ends the worker. Everything waiting resolves as `undefined`. Safe to call twice. */
  stop(): void;
}

/**
 * A builder over the worker `make` makes — {@link graphBuilder} chooses one.
 * A `make` that throws is a builder that has failed.
 */
export function workerGraphBuilder(
  frame: CorridorFrame,
  make: () => GraphWorkerLike,
): GraphBuilder {
  let worker: GraphWorkerLike | undefined;
  let next = 0;
  const waiting = new Map<number, (delta: GraphDelta | undefined) => void>();
  const end = (): void => {
    worker?.terminate();
    worker = undefined;
    for (const settle of waiting.values()) settle(undefined);
    waiting.clear();
  };
  let dead = false;
  const fail = (): void => {
    dead = true;
    end();
  };
  try {
    worker = make();
    worker.onmessage = ({ data }) => {
      const reply = data as GraphReply | null | undefined;
      const settle = typeof reply?.id === 'number' ? waiting.get(reply.id) : undefined;
      if (reply === null || reply === undefined || settle === undefined) return;
      waiting.delete(reply.id);
      if (reply.kind === 'delta') settle(reply.delta);
      else {
        settle(undefined);
        fail();
      }
    };
    worker.onerror = fail;
    worker.postMessage({ kind: 'frame', frame });
  } catch {
    fail();
  }
  return {
    apply: (change) => {
      if (dead || worker === undefined) return Promise.resolve(undefined);
      const id = next++;
      const answer = new Promise<GraphDelta | undefined>((resolve) => {
        waiting.set(id, resolve);
      });
      worker.postMessage({ kind: 'change', id, change });
      return answer;
    },
    stop: () => {
      dead = true;
      end();
    },
  };
}

/** The product's builder: the real worker where there is one, else the same handler here. */
export function graphBuilder(frame: CorridorFrame): GraphBuilder {
  const make = typeof Worker === 'undefined' ? inlineGraphWorker : realGraphWorker;
  return workerGraphBuilder(frame, () => {
    try {
      return make();
    } catch {
      // A platform that has `Worker` and refuses to make one still rides.
      return inlineGraphWorker();
    }
  });
}

/**
 * The page's copy of the graph's answer: what the rolling route reads as it
 * extends (`session.ts` §`GraphStreets`). {@link version} moves on each
 * change, so a reader can tell that streets were added or went.
 */
export class StreetMirror {
  readonly #nodes = new Map<number, GraphNodeEntry>();
  readonly #edges = new Map<number, StreetGraphEdge>();
  #version = 0;

  get version(): number {
    return this.#version;
  }

  apply(delta: GraphDelta): void {
    for (const id of delta.dropEdges) this.#edges.delete(id);
    for (const id of delta.dropNodes) this.#nodes.delete(id);
    for (const edge of delta.edges) this.#edges.set(edge.id, edge);
    for (const node of delta.nodes) this.#nodes.set(node.id, node);
    if (
      delta.dropEdges.length + delta.dropNodes.length + delta.edges.length + delta.nodes.length >
      0
    ) {
      this.#version += 1;
    }
  }

  node(id: number): GraphNodeEntry | undefined {
    return this.#nodes.get(id);
  }

  edge(id: number): StreetGraphEdge | undefined {
    return this.#edges.get(id);
  }

  edges(): IterableIterator<StreetGraphEdge> {
    return this.#edges.values();
  }
}
