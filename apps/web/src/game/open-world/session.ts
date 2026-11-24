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
 * itself, so the start is the frame's origin. The graph is built in a worker
 * (`graph-build.ts`, #2990), and the rolling route reads the page's copy of
 * it, a `StreetMirror`. The start snaps to the nearest
 * point on any edge within {@link OPEN_WORLD_START_REACH_METRES}; none is
 * `no-street`. The snapped street is split there: the ride begins along it
 * towards its `to` end, the street's own vertex order, unless that half is
 * too short to be a way, and the other half is the way on from the start if
 * the route turns round onto it. Heights are flat (0 m) until #2899 reads
 * real ones, so every grade of the first view is 0 %.
 *
 * ## As the ride goes (#2990)
 *
 * Each frame the road tells the reader where the rider is (`road.ts`
 * §`OpenWorldRoadHooks.at`), so the blocks round them are read as they go
 * (`area.ts` §`moveTo`). Whenever what the reader holds changes, the tiles it
 * gained are sent to the worker and the ones it dropped are taken out, so the
 * graph is the 3 × 3 round the rider, 36 tiles at most. A street that ran off
 * the map held — where the rolling route turned round, at what was a dead end
 * only for want of the next block — goes on once that block is in, and the
 * road takes the way on there (`RollingRoute.reopen`) while the rider is far
 * enough short of it that no grade sent changes.
 *
 * ## The map's tiles (#2901)
 *
 * Every block held is handed to a tile planner too (`tile-planner.ts`), which
 * plans the tiles the road asks for (`road.ts` §`OpenWorldRoadHooks.ahead`):
 * the rider's, the ones ahead and the ones on every way on from the next
 * junction (`tiles-ahead.ts`), in a worker, in the same frame as the graph.
 * A block let go takes its tiles' plans with it.
 *
 * A loop (`from === to`) is offered as two ways, `id` and `id:reverse`, of
 * one street, so a choice by id can tell them apart (`GraphStreets`).
 *
 * ## Teardown
 *
 * {@link OpenWorldSession.stop} stops the reader — its running read
 * abandoned, its waiting ones dropped and its held blocks let go — the
 * start's deadline, the graph's worker and the tile planner's. Each worker is
 * made with the first tile to build, so a start stopped before any is read
 * never makes one.
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
  positionAt as positionAlong,
  RollingRoute,
  ROLLING_LEAST_WAY_METRES,
  type GeographicPosition,
  type RollingEdge,
  type RollingPoint,
  type RollingStreetGraph,
} from '@onyourleft/domain';
import {
  describeStreetGraphRefusal,
  localMetres,
  METRES_PER_DEGREE_LATITUDE,
  type CorridorFrame,
  type StreetGraphEdge,
  type TileId,
} from '@onyourleft/map-features';

import { sceneryAnchor } from '../scenery-anchor';
import { createAreaReader, type HeldBlock } from '../world-data/area';
import type { CorridorArchive, WorldCorridor } from '../world-data/corridor';
import {
  graphBuilder,
  StreetMirror,
  type GraphBuilder,
  type GraphNodeEntry,
  type GraphTile,
} from './graph-build';
import {
  OPEN_WORLD_ROUTE_ID,
  OPEN_WORLD_START_REACH_METRES,
  type OpenWorldReady,
  type OpenWorldRefusal,
  type OpenWorldSession,
} from './ride';
import { OpenWorldRoad } from './road';
import { streetNameLabels, type NamedStreetLine, type StreetNameLabel } from '../street-names';
import type { OpenWorldStart } from './start';
import { openWorldStreetCorridor } from './street-corridor';
import { OPEN_WORLD_BUILDINGS_REPLAN_METRES } from './tile-buildings';
import type { TileBlockFeatures } from './tile-plan';
import { createTilePlanner, type TilePlanner, type TilePlannerOptions } from './tile-planner';
import { tilesToPlan } from './tiles-ahead';

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
  /** Where the graph is built: `graph-build.ts` §`graphBuilder`, a worker, when absent. */
  readonly graphBuilder?: ((frame: CorridorFrame) => GraphBuilder) | undefined;
  /** Where the tiles are planned (#2901): `tile-planner.ts` §`createTilePlanner`, a worker, when absent. */
  readonly tilePlanner?: ((options: TilePlannerOptions) => TilePlanner) | undefined;
}

/**
 * How far the rider rides between two askings for the tiles to plan: **25 m**.
 * *#2901's choice*: a tile is a kilometre across, so asking each frame would
 * walk the route sixty times a second for the same answer; a new view (a
 * choice, a turn-round, an extension) asks at once.
 */
export const TILE_ASK_METRES = 25;

/** A held block's features as the tile planner is handed them: the same object while it is held. */
const blockFeatures = new WeakMap<HeldBlock, TileBlockFeatures>();

function featuresOf(block: HeldBlock): TileBlockFeatures {
  let features = blockFeatures.get(block);
  if (features === undefined) {
    features = {
      buildings: block.features.buildings,
      landUse: block.features.landUse,
      tiles: block.streets,
    };
    blockFeatures.set(block, features);
  }
  return features;
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

/** What the session reads of the graph: the page's copy of it (`graph-build.ts`). */
interface StreetLookup {
  readonly version: number;
  node(id: number): GraphNodeEntry | undefined;
  edge(id: number): StreetGraphEdge | undefined;
  edges(): Iterable<StreetGraphEdge>;
}

const tileKey = (tile: TileId): string => `${String(tile.x)}/${String(tile.y)}`;

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
function snapStart(graph: StreetLookup): Snap | undefined {
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

/**
 * The rolling route's view of the graph: each edge leaving a node, oriented
 * away from it. It reads the graph as it is now, so a street added since the
 * route last extended is a way on the next time it does (#2990).
 */
class GraphStreets implements RollingStreetGraph {
  readonly #graph: StreetLookup;
  readonly #frame: CorridorFrame;
  readonly #fromStart: readonly RollingEdge[];
  readonly #oriented = new Map<string, RollingEdge>();
  #version: number;

  constructor(graph: StreetLookup, frame: CorridorFrame, fromStart: readonly RollingEdge[]) {
    this.#graph = graph;
    this.#frame = frame;
    this.#fromStart = fromStart;
    this.#version = graph.version;
  }

  edgesFrom(node: string): readonly RollingEdge[] {
    if (node === START_NODE) return this.#fromStart;
    // An edge's ends are renamed when the node one was stitched into goes, so
    // what was oriented before a change to the graph is oriented again after.
    if (this.#graph.version !== this.#version) {
      this.#version = this.#graph.version;
      this.#oriented.clear();
    }
    const found = this.#graph.node(Number(node));
    if (found === undefined) return [];
    const out: RollingEdge[] = [];
    const loops = new Set<number>();
    for (const id of found.edges) {
      // The mirror is handed a node's edges with it: one missing is skipped, never thrown on.
      const edge = this.#graph.edge(id);
      if (edge === undefined) continue;
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
    const street = String(edge.id);
    // #2990: a loop's two ways leave and reach one node, so only their ids can
    // tell a choice between them apart; the way back from it is either one.
    const loop = edge.from === edge.to;
    const oriented: RollingEdge = {
      id: loop && !forward ? `${street}:reverse` : street,
      ...(loop ? { street } : {}),
      from: String(forward ? edge.from : edge.to),
      to: String(forward ? edge.to : edge.from),
      points,
      roadClass: ROAD_CLASS[edge.kind] ?? 0,
      // #3052: the mapped name, for the junction prompt (ADR 0096).
      ...(edge.name === undefined ? {} : { name: edge.name }),
    };
    this.#oriented.set(key, oriented);
    return oriented;
  }
}

/**
 * The ways from the snapped start, the one the ride begins on first, or
 * `undefined` when no street is within reach.
 */
function startWays(
  graph: StreetLookup,
  frame: CorridorFrame,
): readonly [RollingEdge, RollingEdge] | undefined {
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
  const named = edge.name === undefined ? {} : { name: edge.name };
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
    ...named,
  };
  const other: RollingEdge = {
    id: `${id}:behind`,
    from: START_NODE,
    to: String(forwards ? edge.from : edge.to),
    points: points(forwards ? behind : ahead),
    roadClass,
    ...named,
  };
  return [first, other];
}

/**
 * The rolling route from the snapped start's ways, reading `graph` as it is
 * each time it extends. The first way is at least `ROLLING_LEAST_WAY_METRES`
 * long (the snap takes no edge shorter than twice that), so the rolling route
 * takes it as a start.
 */
function rollingRouteFrom(
  graph: StreetLookup,
  frame: CorridorFrame,
  ways: readonly [RollingEdge, RollingEdge],
): RollingRoute {
  return new RollingRoute(new GraphStreets(graph, frame, ways), ways[0]);
}

/** A session on `options.start`: its start is under way when this returns. */
export function createOpenWorldSession(options: OpenWorldSessionOptions): OpenWorldSession {
  const { start } = options;
  const frame: CorridorFrame = {
    latitude: start.position.latitude,
    longitude: start.position.longitude,
  };
  const schedule = options.schedule ?? defaultSchedule;
  const mirror = new StreetMirror();
  /** #3052: the graph's street names, where to paint each, built again only when the graph changes. */
  let named: { readonly version: number; readonly labels: readonly StreetNameLabel[] } | undefined;
  const streetNames = (): readonly StreetNameLabel[] => {
    if (named?.version !== mirror.version) {
      const streets: NamedStreetLine[] = [];
      for (const edge of mirror.edges()) {
        if (edge.name !== undefined)
          streets.push({ id: String(edge.id), line: edge.line, name: edge.name });
      }
      named = { version: mirror.version, labels: streetNameLabels(streets) };
    }
    return named.labels;
  };
  let builder: GraphBuilder | undefined;
  /** Whether the graph could not be built: the ride rides on what it has. */
  let graphFailed = false;
  /** The tiles sent to the graph, by key. */
  const sent = new Map<string, TileId>();
  let syncing: Promise<void> = Promise.resolve();
  let stopped = false;
  /**
   * #2901: where the ride's tiles are planned — made with the first block
   * held, so a start stopped before any is read never makes its worker.
   */
  let planner: TilePlanner | undefined;
  /** What the planner was last asked for: the view and the rider. @see TILE_ASK_METRES */
  let asked: { readonly view: unknown; readonly rider: number } | undefined;
  function holdTiles(): void {
    if (stopped) return;
    const blocks = new Map<string, TileBlockFeatures>();
    for (const block of reader.held()) {
      blocks.set(`${String(block.block.x)}/${String(block.block.y)}`, featuresOf(block));
    }
    if (blocks.size === 0 && planner === undefined) return;
    planner ??= (options.tilePlanner ?? createTilePlanner)({ frame, log: options.log });
    planner.hold(blocks);
    // #2903: the streets of the held blocks, for the scene — a new corridor
    // only when what is held changed, since the scene keeps what it draws
    // from one against the corridor object.
    const same =
      heldFeatures !== undefined &&
      heldFeatures.size === blocks.size &&
      [...blocks].every(([key, features]) => heldFeatures?.get(key) === features);
    if (!same) {
      heldFeatures = blocks;
      streetCorridor = openWorldStreetCorridor(frame, blocks.values());
    }
  }
  /** #2903: the held blocks the street corridor was built from, and that corridor. */
  let heldFeatures: ReadonlyMap<string, TileBlockFeatures> | undefined;
  let streetCorridor: WorldCorridor | undefined;
  function planAhead(route: RollingRoute, rider: number): void {
    if (planner === undefined || !Number.isFinite(rider)) return;
    const view = route.view();
    if (asked?.view !== view || Math.abs(rider - asked.rider) >= TILE_ASK_METRES) {
      asked = { view, rider };
      planner.want(tilesToPlan(route, rider));
    } else if (buildingsAsked !== undefined) {
      return;
    }
    // #2902: and the mapped buildings round the rider, against this view,
    // whenever the view or the tiles planned changed, or the rider has ridden
    // on far enough that the reach planned no longer covers the belt's. Until
    // they are first asked for, every call looks, so a standing start asks as
    // soon as its first tile is planned rather than 25 m on.
    const along = rider - route.origin;
    if (!(along >= 0 && along <= route.end - route.origin)) return;
    const tiles = [...planner.plans()].length;
    if (tiles === 0) return;
    const at = positionAlong(view, along);
    const { x, z } = localMetres(frame, at.longitude, at.latitude);
    const last = buildingsAsked;
    if (
      last !== undefined &&
      last.view === view &&
      last.tiles === tiles &&
      Math.hypot(x - last.x, z - last.z) < OPEN_WORLD_BUILDINGS_REPLAN_METRES
    ) {
      return;
    }
    buildingsAsked = { view, tiles, x, z };
    // #3094: and what the road keyed the view on, which a worker's copy lacks.
    const anchor = sceneryAnchor(view);
    planner.planBuildings({
      profile: view,
      x,
      z,
      ...(anchor === undefined ? {} : { scenery: { seed: anchor.seed, origin: anchor.origin } }),
    });
  }
  /** What the buildings were last planned for. @see planAhead */
  let buildingsAsked:
    | { readonly view: unknown; readonly tiles: number; readonly x: number; readonly z: number }
    | undefined;
  const reader = createAreaReader({
    archive: options.archive,
    frame,
    mapTilesOn: options.mapTilesOn,
    random: options.random,
    schedule,
    log: options.log,
    yieldToIdle: options.yieldToIdle,
    onChange: () => {
      holdTiles();
      void sync();
    },
  });
  /**
   * What the reader holds now, against what the graph was sent: the tiles
   * gained go in and the tiles dropped come out, in one change. Resolves when
   * every change made so far is in the mirror.
   */
  function sync(): Promise<void> {
    if (stopped || graphFailed) return syncing;
    const now = new Map<string, GraphTile>();
    for (const block of reader.held()) {
      for (const each of block.streets) now.set(tileKey(each.tile), each);
    }
    const add = [...now].filter(([key]) => !sent.has(key)).map(([, each]) => each);
    const remove = [...sent].filter(([key]) => !now.has(key)).map(([, tile]) => tile);
    if (add.length === 0 && remove.length === 0) return syncing;
    for (const each of add) sent.set(tileKey(each.tile), each.tile);
    for (const tile of remove) sent.delete(tileKey(tile));
    builder ??= (options.graphBuilder ?? graphBuilder)(frame);
    const applied = builder.apply({ add, remove });
    syncing = syncing.then(async () => {
      const delta = await applied;
      if (stopped) return;
      if (delta === undefined) {
        graphFailed = true;
        return;
      }
      mirror.apply(delta);
      // A tile the graph cannot take is refused by `addTile`, never thrown.
      for (const refusal of delta.refusals) options.log?.(describeStreetGraphRefusal(refusal));
    });
    return syncing;
  }
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
    holdTiles();
    await sync();
    if (stopped) return { kind: 'stopped' };
    if (graphFailed) return refused('unavailable');
    const ways = startWays(mirror, frame);
    if (ways === undefined) return refused('no-street');
    const route = rollingRouteFrom(mirror, frame, ways);
    return {
      kind: 'ready',
      route: {
        id: OPEN_WORLD_ROUTE_ID,
        name: OPEN_WORLD_ROUTE_NAME,
        profile: route.view(),
        attempts: 0,
      },
      // #2982: each ride its own rolling route from the same snapped start's
      // ways, over the graph as it is, so its first view is the card's while
      // the rider has not moved. #2990: the road tells the reader where the
      // rider is, and reopens a turn-round once the graph has grown past it.
      road: () =>
        new OpenWorldRoad(rollingRouteFrom(mirror, frame, ways), {
          at: (position) => {
            reader.moveTo(position);
          },
          graphVersion: () => mirror.version,
          ahead: planAhead,
          // #2902: the whole ride drawn in the start's frame, the tiles' own.
          frame: { latitude: frame.latitude, longitude: frame.longitude, elevation: 0 },
          buildings: () => planner?.buildings,
          // #2903: every held street, drawn to the fog as road.
          streets: () => streetCorridor,
          // #3052: and where each named one's name is painted on it.
          streetNames,
        }),
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
      builder?.stop();
      planner?.stop();
    },
  };
}
