// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The open-world ride session** — #2896, part (a) of the scope split of
 * 2026-11-20: the start (#2889's `entry.ts`) → the start's blocks
 * (`world-data/area.ts`, #2890) → a street graph over them
 * (`StreetGraph`, #2894) → the start snapped to a street → a
 * `RollingRoute` (#2895) → its **first view**, handed to the game as a
 * picker card (`ride.ts`). The ride loop past that first view follows a fresh
 * rolling route from the same start (`road.ts`, #2982).
 *
 * ## The start
 *
 * {@link createOpenWorldSession} asks the area reader for the start's 3 × 3
 * blocks at once (ADR 0090 D-2.3), and that is the only read it waits for.
 * ⚠️ **The start is bounded** (#2963's review, `area.ts` §`start`): the
 * reader's start waits on all nine blocks, and an archive that never answers
 * would hold it for about 18 minutes, nine reads each waiting its own
 * `READ_TIMEOUT_MS`. So the session stops the reader after
 * {@link OPEN_WORLD_START_TIMEOUT_MS} and says the map could not be read.
 *
 * ## The graph and the snap
 *
 * Every tile held is added to one `StreetGraph`, with that tile's own streets
 * (`HeldBlock.streets`), in the frame the tiles were decoded in: the start
 * itself, so the start is the frame's origin. The start snaps to the nearest
 * point on any edge within {@link OPEN_WORLD_START_REACH_METRES}; none is
 * `no-street`. The snapped street is split there: the ride begins along it
 * towards its `to` end, the street's own vertex order, unless that half is
 * too short to be a way, and the other half is the way on from the start if
 * the route turns round onto it. Heights are flat (0 m) until #2899 reads
 * real ones, so every grade of the first view is 0 %.
 *
 * ## Teardown
 *
 * {@link OpenWorldSession.stop} stops the reader — its running read
 * abandoned, its waiting ones dropped and its held blocks let go — and the
 * start's deadline. The graph is built on the main thread, once, at the start
 * (36 tiles at most, `MAX_HELD_TILES`), so there is no worker to stop yet.
 *
 * ⚠️ **Nothing here logs, stores or sends the start** (ADR 0090, the start
 * "never leaves the device"): what is asked for is the start's blocks, which
 * `area.ts` derives from the block alone (R-1), and a failure is said only in
 * `describeCorridorFailure`'s and `describeStreetGraphRefusal`'s words, which
 * name no coordinate, tile or block (R-2).
 */

import {
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  altitudeMetres,
  RollingRoute,
  ROLLING_LEAST_WAY_METRES,
  type GeographicPosition,
  type RollingEdge,
  type RollingPoint,
  type RollingStreetGraph,
} from '@onyourleft/domain';
import {
  describeStreetGraphRefusal,
  METRES_PER_DEGREE_LATITUDE,
  StreetGraph,
  type CorridorFrame,
  type StreetGraphEdge,
} from '@onyourleft/map-features';

import { createAreaReader, type HeldBlock } from '../world-data/area';
import type { CorridorArchive } from '../world-data/corridor';
import {
  OPEN_WORLD_ROUTE_ID,
  OPEN_WORLD_START_REACH_METRES,
  type OpenWorldReady,
  type OpenWorldRefusal,
  type OpenWorldSession,
} from './ride';
import { OpenWorldRoad } from './road';
import type { OpenWorldStart } from './start';

/**
 * How long the start may take before the session gives up on the map:
 * **90 s**. *#2896's choice*: 36 tiles over a slow connection with room to
 * spare, and a twelfth of the 18 minutes the reader's own timeouts allow.
 */
export const OPEN_WORLD_START_TIMEOUT_MS = 90_000;

/** The open-world ride's name on its picker card. */
const OPEN_WORLD_ROUTE_NAME = 'Open world';

/** The node the snapped start is, in the rolling route's graph. No graph node is named so. */
const START_NODE = 'start';

/** Higher is the bigger road: ADR 0088 D-1.4's tie-break. */
const ROAD_CLASS: Readonly<Record<string, number>> = { major_road: 2, minor_road: 1 };

export interface OpenWorldSessionOptions {
  readonly start: OpenWorldStart;
  /** `corridor-source.ts` §`corridorArchive` in the product; `undefined` when none is configured. */
  readonly archive: CorridorArchive | undefined;
  /** The map-tiles switch (ADR 0090 D-7.1), read before every request. */
  readonly mapTilesOn: () => boolean;
  /** Runs `run` after `ms`; returns what cancels it. `setTimeout` in the product. */
  readonly schedule?: ((run: () => void, ms: number) => () => void) | undefined;
  /** The draw for R-8's delay. `Math.random` in the product. */
  readonly random?: (() => number) | undefined;
  /** Where failures are said, in `describeCorridorFailure`'s and the graph's words only. */
  readonly log?: ((line: string) => void) | undefined;
  readonly yieldToIdle?: (() => Promise<void>) | undefined;
  /** The start's bound: {@link OPEN_WORLD_START_TIMEOUT_MS} when absent. */
  readonly startTimeoutMs?: number | undefined;
}

const defaultSchedule = (run: () => void, ms: number): (() => void) => {
  const timer = setTimeout(run, ms);
  return () => {
    clearTimeout(timer);
  };
};

/** A local `x` (metres WEST) and `z` (north) in `frame`, as a position: `localMetres` inverted. */
function positionAt(frame: CorridorFrame, x: number, z: number): GeographicPosition {
  const perDegreeLongitude =
    METRES_PER_DEGREE_LATITUDE * Math.cos((frame.latitude * Math.PI) / 180);
  const longitude = frame.longitude - x / perDegreeLongitude;
  return geographicPosition(
    degreesLatitude(frame.latitude + z / METRES_PER_DEGREE_LATITUDE),
    degreesLongitude(((((longitude + 180) % 360) + 360) % 360) - 180),
  );
}

/** A point of a street, flat until #2899 reads real heights. */
function pointAt(frame: CorridorFrame, x: number, z: number): RollingPoint {
  return { position: positionAt(frame, x, z), elevation: altitudeMetres(0) };
}

/** One graph over every tile held, each with its own streets. */
function streetGraphOf(
  held: readonly HeldBlock[],
  frame: CorridorFrame,
  log: ((line: string) => void) | undefined,
): StreetGraph {
  const graph = new StreetGraph(frame);
  for (const block of held) {
    for (const { tile, streets } of block.streets) {
      const refusal = graph.addTile(tile, streets);
      if (refusal !== null) log?.(describeStreetGraphRefusal(refusal));
    }
  }
  return graph;
}

/** Where the start meets a street: the edge, the segment and how far along it. */
interface Snap {
  readonly edge: StreetGraphEdge;
  readonly segment: number;
  readonly share: number;
  readonly x: number;
  readonly z: number;
}

/**
 * The nearest point to the frame's origin — the start — on any edge long
 * enough to be split into a way either side, within the reach; or `undefined`.
 */
function snapStart(graph: StreetGraph): Snap | undefined {
  let best: Snap | undefined;
  let bestDistance = OPEN_WORLD_START_REACH_METRES;
  for (const edge of graph.edges()) {
    if (!(edge.metres >= 2 * ROLLING_LEAST_WAY_METRES)) continue;
    const line = edge.line;
    for (let i = 0; i + 3 < line.length; i += 2) {
      const ax = line[i] as number;
      const az = line[i + 1] as number;
      const dx = (line[i + 2] as number) - ax;
      const dz = (line[i + 3] as number) - az;
      const lengthSquared = dx * dx + dz * dz;
      const share =
        lengthSquared === 0 ? 0 : Math.min(1, Math.max(0, -(ax * dx + az * dz) / lengthSquared));
      const x = ax + share * dx;
      const z = az + share * dz;
      const distance = Math.hypot(x, z);
      if (distance <= bestDistance) {
        bestDistance = distance;
        best = { edge, segment: i / 2, share, x, z };
      }
    }
  }
  return best;
}

/** The rolling route's view of the graph: each edge leaving a node, oriented away from it. */
class GraphStreets implements RollingStreetGraph {
  readonly #graph: StreetGraph;
  readonly #frame: CorridorFrame;
  readonly #fromStart: readonly RollingEdge[];
  readonly #oriented = new Map<string, RollingEdge>();

  constructor(graph: StreetGraph, frame: CorridorFrame, fromStart: readonly RollingEdge[]) {
    this.#graph = graph;
    this.#frame = frame;
    this.#fromStart = fromStart;
  }

  edgesFrom(node: string): readonly RollingEdge[] {
    if (node === START_NODE) return this.#fromStart;
    const found = this.#graph.node(Number(node));
    if (found === undefined) return [];
    const out: RollingEdge[] = [];
    const loops = new Set<number>();
    for (const id of found.edges) {
      // A node's edges are held while it is: `StreetGraph.node` lists no other.
      const edge = this.#graph.edge(id) as StreetGraphEdge;
      let forward = edge.from === found.id;
      // A loop is listed once an end: once each way.
      if (edge.from === found.id && edge.to === found.id) {
        forward = !loops.has(id);
        loops.add(id);
      }
      out.push(this.#orient(edge, forward));
    }
    return out;
  }

  #orient(edge: StreetGraphEdge, forward: boolean): RollingEdge {
    const key = `${String(edge.id)}${forward ? '+' : '-'}`;
    const known = this.#oriented.get(key);
    if (known !== undefined) return known;
    const points: RollingPoint[] = [];
    for (let i = 0; i + 1 < edge.line.length; i += 2) {
      points.push(pointAt(this.#frame, edge.line[i] as number, edge.line[i + 1] as number));
    }
    if (!forward) points.reverse();
    const oriented: RollingEdge = {
      id: String(edge.id),
      from: String(forward ? edge.from : edge.to),
      to: String(forward ? edge.to : edge.from),
      points,
      roadClass: ROAD_CLASS[edge.kind] ?? 0,
    };
    this.#oriented.set(key, oriented);
    return oriented;
  }
}

/**
 * The rolling route from the snapped start along the default ways, or
 * `undefined` when no street is within reach.
 */
function rollingRouteFrom(graph: StreetGraph, frame: CorridorFrame): RollingRoute | undefined {
  const snap = snapStart(graph);
  if (snap === undefined) return undefined;
  const { edge, segment } = snap;
  const vertex = (index: number): readonly [number, number] => [
    edge.line[index * 2] as number,
    edge.line[index * 2 + 1] as number,
  ];
  const vertices = edge.line.length / 2;
  // Towards `to`: the snap, then every vertex after its segment.
  const ahead: (readonly [number, number])[] = [[snap.x, snap.z]];
  for (let index = segment + 1; index < vertices; index += 1) ahead.push(vertex(index));
  // Towards `from`: the snap, then its segment's first vertex and every one before it.
  const behind: (readonly [number, number])[] = [[snap.x, snap.z]];
  for (let index = segment; index >= 0; index -= 1) behind.push(vertex(index));
  const metres = (line: readonly (readonly [number, number])[]): number => {
    let total = 0;
    for (let index = 1; index < line.length; index += 1) {
      const [ax, az] = line[index - 1] as readonly [number, number];
      const [bx, bz] = line[index] as readonly [number, number];
      total += Math.hypot(bx - ax, bz - az);
    }
    return total;
  };
  const points = (line: readonly (readonly [number, number])[]): RollingPoint[] =>
    line.map(([x, z]) => pointAt(frame, x, z));
  const id = String(edge.id);
  const roadClass = ROAD_CLASS[edge.kind] ?? 0;
  // The way the ride begins carries the street's id, so the way back at the
  // node it reaches is the whole street and is never the way on. The other
  // half has its own id: the way on from the start if the route turns round
  // onto it, which the rolling route must not take for the way it came.
  const forwards = metres(ahead) >= ROLLING_LEAST_WAY_METRES;
  const first: RollingEdge = {
    id,
    from: START_NODE,
    to: String(forwards ? edge.to : edge.from),
    points: points(forwards ? ahead : behind),
    roadClass,
  };
  const other: RollingEdge = {
    id: `${id}:behind`,
    from: START_NODE,
    to: String(forwards ? edge.from : edge.to),
    points: points(forwards ? behind : ahead),
    roadClass,
  };
  // `first` is at least `ROLLING_LEAST_WAY_METRES` long (the snap takes no
  // edge shorter than twice that), so the rolling route takes it as a start.
  return new RollingRoute(new GraphStreets(graph, frame, [first, other]), first);
}

/** A session on `options.start`: its start is under way when this returns. */
export function createOpenWorldSession(options: OpenWorldSessionOptions): OpenWorldSession {
  const { start } = options;
  const frame: CorridorFrame = {
    latitude: start.position.latitude,
    longitude: start.position.longitude,
  };
  const schedule = options.schedule ?? defaultSchedule;
  const reader = createAreaReader({
    archive: options.archive,
    frame,
    mapTilesOn: options.mapTilesOn,
    random: options.random,
    schedule,
    log: options.log,
    yieldToIdle: options.yieldToIdle,
  });
  let stopped = false;
  let deadline: (() => void) | undefined;
  const endDeadline = (): void => {
    deadline?.();
    deadline = undefined;
  };
  const refused = (refusal: OpenWorldRefusal): OpenWorldReady => ({ kind: 'refused', refusal });

  const ready = (async (): Promise<OpenWorldReady> => {
    let late = false;
    // A scheduler may run its callback at once; `late` and `stopped` are read after.
    const cancel = schedule(() => {
      late = true;
      deadline = undefined;
      reader.stop();
    }, options.startTimeoutMs ?? OPEN_WORLD_START_TIMEOUT_MS);
    if (!late) deadline = cancel;
    const begun = await reader.start(start.position);
    endDeadline();
    if (stopped) return { kind: 'stopped' };
    if (begun.kind === 'off') {
      return refused(
        begun.why === 'map-tiles-off'
          ? 'map-tiles-off'
          : begun.why === 'no-archive'
            ? 'no-map'
            : 'wrong-schema',
      );
    }
    if (begun.kind !== 'ready' || late) return refused('unavailable');
    // A tile the graph cannot take is refused by `addTile`, never thrown.
    const graph = streetGraphOf(reader.held(), frame, options.log);
    const route = rollingRouteFrom(graph, frame);
    if (route === undefined) return refused('no-street');
    return {
      kind: 'ready',
      route: {
        id: OPEN_WORLD_ROUTE_ID,
        name: OPEN_WORLD_ROUTE_NAME,
        profile: route.view(),
        attempts: 0,
      },
      // #2982: each ride its own rolling route from the same snapped start, over
      // the same graph, so its first view is the card's. The snap found a street
      // once, and the graph has not changed, so it finds the same one again.
      road: () => new OpenWorldRoad(rollingRouteFrom(graph, frame) as RollingRoute),
    };
  })();

  return {
    ready,
    stop: () => {
      if (stopped) return;
      stopped = true;
      // The reader's start then resolves at once, and the start's deadline
      // is cancelled there, as it is after any start.
      reader.stop();
    },
  };
}
