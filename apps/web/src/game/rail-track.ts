// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Railway track — #3253: the mapped railway lines of the corridor
 * (`WorldCorridor.rails`) drawn as track along their whole length in view,
 * not only where one crosses the route. Until #3253 a line was drawn for 60 m
 * each side of a level crossing, as ballast with two upright strips on it
 * (`cross-streets.ts` §`levelCrossings`, #2660), and nowhere else.
 *
 * ## What is built — in code, and from no file
 *
 * [ADR 0099](../../../../docs/adr/0099-model-sources-for-modern-buildings-trees-and-track-and-what-a-new-model-owes.md)
 * D-1: *"Track is better built than downloaded."* Every triangle here is made
 * from the numbers below; no model and no texture is added, so `ASSETS.toml`
 * gains no row.
 *
 * - **A ballast bed with shoulders**: a crown {@link BALLAST_CROWN_METRES}
 *   wide standing {@link BALLAST_DEPTH_METRES} over the ground, and a shoulder
 *   each side falling to the ground {@link BALLAST_SHOULDER_METRES} out.
 * - **Sleepers at real spacing**: {@link SLEEPER_LENGTH_METRES} by
 *   {@link SLEEPER_WIDTH_METRES}, one every {@link SLEEPER_SPACING_METRES},
 *   counted from the line's own start so that two pieces of one line never
 *   break the rhythm where they meet.
 * - **Two steel rails** at standard gauge (`cross-streets.ts`
 *   §`RAIL_HALF_GAUGE_METRES`), each a web {@link RAIL_HEIGHT_METRES} high
 *   with a bright running surface {@link RAIL_HEAD_WIDTH_METRES} wide on top.
 * - **A level crossing** wherever a line at grade is on the carriageway: the
 *   bed gives way to the road's own surface between and beside the rails
 *   ({@link CROSSING_PANEL}), with the rails' heads `cross-streets.ts`
 *   §`RAIL_ON_ROAD_METRES` proud of it, and a **crossbuck** each way the road
 *   is ridden ({@link crossingFurniture}); **lights** and **gates** only at a
 *   crossing the map tags (`WorldCorridor.railCrossings`).
 * - **A rail bridge**: a line mapped on a bridge is a deck carrying the same
 *   track — the same bed, sleepers and rails on a girder
 *   {@link DECK_GIRDER_METRES} deep, on a pier every
 *   {@link DECK_PIER_EVERY_STATIONS} stations wherever it is high over the
 *   ground — level from one end of the mapped span to the other, so it
 *   crosses water and low ground instead of following them.
 *   Where it crosses the route it clears the road by
 *   {@link DECK_CLEARANCE_METRES} ({@link overLift}), and the track joined to
 *   it climbs to it between walls.
 *
 * A line in a tunnel is under the ground and is not drawn.
 *
 * ## ⚠️ Grounded on the road's own heights
 *
 * Every vertex stands on `cross-streets.ts` §`standingBesideRoad`: the road's
 * height on the carriageway, the drawn ground's (`landform.ts`
 * §`terrainHeightAt`, with the ride's land mask) past the ramp, blended
 * between — the ONE formula a side road stands on. So the track meets the
 * road at a crossing and lies on the drawn ground everywhere else, on
 * whatever heights the ride has: real ones, or the level fallback when none
 * could be read. It reads no height of its own from anywhere.
 *
 * ## Cost — no mesh, texture or material more
 *
 * Each piece in view is a `cross-streets.ts` §`SideRoad`, appended to the
 * frame's side roads (`scene.ts`), so `three-renderer.ts` §`SideRoadBelt`
 * draws all of it in the road's own material in its ONE draw call, and
 * `clearOfSideRoads` keeps the scenery off it. ⚠️ That mesh is hidden on a
 * frame with no side road, so track in view of a frame that had none makes
 * the side roads' call where none was made: one, however much track. The village draw-call ceilings
 * are frozen (`realistic-budget.ts`), which is why the track wears vertex
 * colours and not a material of its own.
 *
 * A frame draws at most `realistic-budget.ts` §`RAIL_TRACK_PIECES_PER_FRAME`
 * pieces of {@link RAIL_TRACK_PIECE_STEPS} steps, nearest the rider first; the
 * nearest `RAIL_TRACK_NEAR_PIECES` of them within
 * {@link RAIL_TRACK_NEAR_METRES} carry their sleepers and their rails' three
 * faces, and the rest a sleeper-toned strip and each rail's one upright face.
 * So at most `REALISTIC_RAIL_TRACK_TRIANGLES` a frame however much railway a
 * town has. The choice is made again only every
 * {@link RAIL_TRACK_REFRESH_METRES} ridden, and each piece's mesh is built the
 * first time it is in view and kept.
 *
 * ⚠️ **Location data** (ADR 0004 D): nothing here formats a message. It reads
 * a line's detail-free geometry and grade, and never a name.
 *
 * Pure, cached per corridor, and names no rendering library.
 */

import type { RouteProfile } from '@onyourleft/domain';

import {
  BALLAST,
  levelCrossings,
  linearColour,
  RAIL_HALF_GAUGE_METRES,
  RAIL_MAX_METRES,
  RAIL_ON_ROAD_METRES,
  RAIL_STEEL,
  SIDE_ROAD_LIFT_METRES,
  standingBesideRoad,
  TARMAC,
  type Junction,
  type SideRoad,
  type SideRoadMesh,
} from './cross-streets';
import { NO_LAND_CLASS, type LandClassMask } from './land-class';
import { TERRAIN_COLUMN_OFFSETS } from './landform';
import {
  RAIL_CROSSINGS_PER_FRAME,
  RAIL_TRACK_NEAR_PIECES,
  RAIL_TRACK_PIECES_PER_FRAME,
} from './realistic-budget';
import { nearestOnDrawnRoad, roadNeighbourhood, type NearestOnRoad } from './road-grid';
import {
  drawnRoadFrame,
  drawnRoadPosition,
  ROAD_WIDTH_METRES,
  type CorridorOrigin,
} from './terrain';
import { inWater, waterways, type Waterways } from './waterways';
import type { RailCrossingTag, WorldCorridor } from './world-data/corridor';

// --- The track's own numbers ---------------------------------------------------

/** How far apart the track's cross-sections are, in metres: **4**. */
export const RAIL_TRACK_STEP_METRES = 4;

/** How many steps one piece is at most: **10**, so 40 m of track. */
export const RAIL_TRACK_PIECE_STEPS = 10;

/** How far from the rider track is drawn, in metres: **400**, the fog's depth, as a nearby street is. */
export const RAIL_TRACK_VIEW_METRES = 400;

/** How far the rider moves before the pieces in view are chosen again, in metres: **40**. */
export const RAIL_TRACK_REFRESH_METRES = 40;

/** Within this of the rider a piece may carry its sleepers, in metres: **140**. */
export const RAIL_TRACK_NEAR_METRES = 140;

/** A ballast bed's crown, in metres: **3.4**, the width a crossing's bed has had since #2660. */
export const BALLAST_CROWN_METRES = 3.4;

/** How far beyond the crown a shoulder reaches the ground, in metres: **0.45**, a slope of 1 in 1.5. */
export const BALLAST_SHOULDER_METRES = 0.45;

/** How high the crown stands over the ground, in metres: **0.3**. None on a carriageway. */
export const BALLAST_DEPTH_METRES = 0.3;

/** A sleeper's length across the track, in metres: **2.6**. */
export const SLEEPER_LENGTH_METRES = 2.6;

/** A sleeper's width along the track, in metres: **0.25**. */
export const SLEEPER_WIDTH_METRES = 0.25;

/** From one sleeper's centre to the next, in metres: **0.6**. */
export const SLEEPER_SPACING_METRES = 0.6;

/** How far a sleeper's top stands over the ballast it is bedded in, in metres: **0.04**. */
export const SLEEPER_PROUD_METRES = 0.04;

/** A rail's height from the sleeper to its running surface, in metres: **0.16**. */
export const RAIL_HEIGHT_METRES = 0.16;

/** A rail's running surface, in metres across: **0.07**. */
export const RAIL_HEAD_WIDTH_METRES = 0.07;

/** A deck's girder under its track, in metres deep: **1.2**. */
export const DECK_GIRDER_METRES = 1.2;

/**
 * How far over the road a rail bridge's track is where it crosses the route,
 * in metres: **6.4** — its {@link DECK_GIRDER_METRES} girder and 5.2 m clear
 * under it.
 */
export const DECK_CLEARANCE_METRES = 6.4;

/** How far each side of the route's crossing a rail bridge holds its full height, in metres: **14**. */
export const DECK_LEVEL_METRES = 14;

/** Over how many metres past that the track comes down to the ground: **150**. */
export const DECK_RAMP_METRES = 150;

/** A deck stands on a pier every this many stations: **3**, so every 12 m. */
export const DECK_PIER_EVERY_STATIONS = 3;

/** A pier, in metres across the track and along it: **1.8** by **0.9**. */
export const DECK_PIER_METRES = [1.8, 0.9] as const;

/** A deck's girder must be this far over the ground for a pier to stand under it, in metres: **1**. */
export const DECK_PIER_OVER_METRES = 1;

/** How far off the carriageway's edge the nearest pier stands, in metres: **2**. */
export const DECK_PIER_CLEAR_METRES = 2;

/** Under this much lift a line is on the ground, in metres: **0.05**. */
const LIFTED_METRES = 0.05;

/** How far below the ground a shoulder's or a wall's foot is, in metres. */
const FOOT_METRES = 0.05;

/**
 * A row is on the carriageway within this of the road's centreline, in
 * metres: the road's half-width and **0.5** — a crossing's surface runs just
 * past the road's edge.
 */
const ON_CARRIAGEWAY_METRES = ROAD_WIDTH_METRES / 2 + 0.5;

/**
 * The most steps of one piece cut at the carriageway's edge: **2**, a
 * crossing's two edges. A line that weaves on and off the road more often in
 * 40 m keeps its bed up to the next station instead, so a piece's triangles
 * stay bounded (`realistic-budget.ts` §`RAIL_TRACK_NEAR_PIECE_TRIANGLES`).
 */
export const CROSSING_CUTS_PER_PIECE = 2;

/** How close two lines' ends must be to be one track, in metres: **2**. */
const JOINED_METRES = 2;

/** The farthest column of drawn ground from the road, in metres. */
const GROUND_LATERAL_METRES = TERRAIN_COLUMN_OFFSETS[TERRAIN_COLUMN_OFFSETS.length - 1] as number;

/** A shoulder's ballast: the crown's, a shade darker, because the road's material lights every face as level. */
export const BALLAST_SHOULDER = linearColour(0x5c564e);
/** A timber sleeper. */
export const SLEEPER = linearColour(0x453b33);
/** Sleepers and the ballast between them, seen too far off to tell apart. */
export const SLEEPER_FAR = linearColour(0x58504a);
/** A rail's web: rusted, as every part of a rail but its running surface is. */
export const RAIL_WEB = linearColour(0x5a4538);
/** The road's surface carried across the track at a level crossing. */
export const CROSSING_PANEL = TARMAC;
/** A deck's painted steel girder. */
export const DECK_GIRDER = linearColour(0x3c4743);
/** The concrete wall under track that climbs to a bridge. */
export const TRACK_WALL = linearColour(0x86837b);
/** A crossbuck's boards and a gate's white bands. */
export const CROSSBUCK_WHITE = linearColour(0xe9e7df);
/** A signal's post. */
export const SIGNAL_POST = linearColour(0xa9aaa6);
/** A light's backing board. */
export const SIGNAL_BLACK = linearColour(0x1b1b1b);
/** A crossing light, unlit: no train is coming. */
export const SIGNAL_RED = linearColour(0x8f1d15);
/** A gate's red bands. */
export const GATE_RED = linearColour(0xb3261a);

// --- A corridor's track ---------------------------------------------------------

/** A stretch of one mapped line, at most {@link RAIL_TRACK_PIECE_STEPS} steps. */
export interface RailTrackPiece {
  /** Its stations, `x0, z0, x1, z1, …` in local metres, {@link RAIL_TRACK_STEP_METRES} apart. */
  readonly line: Float32Array;
  /** How far along its mapped line the first station is, in metres: the sleepers' phase. */
  readonly fromMetres: number;
  /** A line mapped on a bridge: a deck, level between {@link span}'s ends. */
  readonly deck: boolean;
  /** A deck's whole mapped span in view: its two ends and its length. */
  readonly span?: {
    readonly from: readonly [number, number];
    readonly to: readonly [number, number];
    readonly fromMetres: number;
    readonly metres: number;
  };
  /** The points of the route this piece's track is joined to a bridge over, `x, z` pairs. */
  readonly overs: readonly (readonly [number, number])[];
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

/** A corridor's railway, read once. */
export interface RailTrack {
  readonly pieces: readonly RailTrackPiece[];
  /** The corridor it was read from: its level crossings and their tags. */
  readonly corridor: WorldCorridor;
}

const found = new WeakMap<WorldCorridor, { profile: RouteProfile; track: RailTrack }>();

/** One mapped line resampled: its stations within reach of the drawn ground, in runs. */
interface Run {
  readonly points: number[];
  readonly fromMetres: number;
}

/**
 * A line's stations every {@link RAIL_TRACK_STEP_METRES} of its length, as
 * runs unbroken by a stretch the drawn ground does not reach. A segment off
 * the road's neighbourhood is stepped over without a station, and the whole
 * corridor's railway takes at most `cross-streets.ts` §`RAIL_MAX_METRES` from
 * `budget`, in file order.
 */
function runsOf(
  line: Float32Array,
  budget: { metres: number },
  near: (x: number, z: number) => boolean,
): Run[] {
  const runs: Run[] = [];
  let run: Run | undefined;
  let travelled = 0;
  /** How far along the line the next station is. */
  let next = 0;
  for (let at = 0; at + 3 < line.length; at += 2) {
    const ax = line[at] as number;
    const az = line[at + 1] as number;
    const bx = line[at + 2] as number;
    const bz = line[at + 3] as number;
    if (![ax, az, bx, bz].every(Number.isFinite)) break;
    const length = Math.hypot(bx - ax, bz - az);
    if (!(length > 0)) continue;
    if (length > budget.metres) {
      budget.metres = 0;
      break;
    }
    budget.metres -= length;
    for (; next <= travelled + length; next += RAIL_TRACK_STEP_METRES) {
      const t = (next - travelled) / length;
      const x = ax + (bx - ax) * t;
      const z = az + (bz - az) * t;
      if (!near(x, z)) {
        run = undefined;
        continue;
      }
      if (run === undefined) {
        run = { points: [], fromMetres: next };
        runs.push(run);
      }
      run.points.push(x, z);
    }
    travelled += length;
  }
  return runs.filter((each) => each.points.length >= 4);
}

/** A point's cell, for finding the ends of lines that meet. */
function endKey(x: number, z: number): string {
  return `${String(Math.round(x / JOINED_METRES))},${String(Math.round(z / JOINED_METRES))}`;
}

/**
 * Which lines are one track: every line by the index of the first line it is
 * joined to, end to end, through any number of lines between. A mapped line
 * is cut wherever its tags change, so a bridge is a line of its own between
 * the two lines of the track it carries.
 */
function joinedLines(lines: readonly Float32Array[]): number[] {
  const group = lines.map((_, index) => index);
  const root = (index: number): number => {
    let at = index;
    while (group[at] !== at) at = group[at] as number;
    return at;
  };
  const ends = new Map<string, number>();
  for (const [index, line] of lines.entries()) {
    if (line.length < 4) continue;
    for (const at of [0, line.length - 2]) {
      const x = line[at] as number;
      const z = line[at + 1] as number;
      for (let dx = -1; dx <= 1; dx += 1) {
        for (let dz = -1; dz <= 1; dz += 1) {
          const other = ends.get(endKey(x + dx * JOINED_METRES, z + dz * JOINED_METRES));
          if (other === undefined) continue;
          const a = root(index);
          const b = root(other);
          if (a !== b) group[Math.max(a, b)] = Math.min(a, b);
        }
      }
      ends.set(endKey(x, z), index);
    }
  }
  return group.map((_, index) => root(index));
}

/**
 * A corridor's railway as pieces — #3253. Every line at grade and every line
 * on a bridge, resampled, kept where the drawn ground reaches, and cut into
 * pieces that share their end stations so one line drawn as several has no
 * gap. Built once a corridor and route, the same object after.
 */
export function railTrack(
  corridor: WorldCorridor,
  profile: RouteProfile,
  origin: CorridorOrigin,
): RailTrack {
  const cached = found.get(corridor);
  if (cached?.profile === profile) return cached.track;
  const rails = (corridor.rails ?? []).filter((rail) => rail.grade !== 'tunnel');
  const pieces: RailTrackPiece[] = [];
  if (rails.length > 0) {
    const neighbourhood = roadNeighbourhood(profile, origin, GROUND_LATERAL_METRES);
    // Conservative: a station a cell past the drawn ground is kept here and has no row when its
    // piece is built (`pieceMesh`), which costs a search only for a piece that comes into view.
    const near = (x: number, z: number): boolean =>
      corridor.covered(x, z) && neighbourhood.near(x, x, z, z);
    const budget = { metres: RAIL_MAX_METRES };
    const runs = rails.map((rail) => runsOf(rail.line, budget, near));
    // Where a line on a bridge crosses the route: the station of each run nearest the road, if on it.
    const groups = joinedLines(rails.map((rail) => rail.line));
    const oversOf = new Map<number, [number, number][]>();
    for (const [index, rail] of rails.entries()) {
      if (rail.grade !== 'bridge') continue;
      for (const run of runs[index] as Run[]) {
        let best: { x: number; z: number; distance: number } | undefined;
        for (let at = 0; at + 1 < run.points.length; at += 2) {
          const x = run.points[at] as number;
          const z = run.points[at + 1] as number;
          const on = nearestOnDrawnRoad(profile, origin, x, z, RAIL_TRACK_STEP_METRES);
          if (on !== undefined && (best === undefined || on.distance < best.distance)) {
            best = { x, z, distance: on.distance };
          }
        }
        if (best === undefined) continue;
        const group = groups[index] as number;
        const overs = oversOf.get(group) ?? [];
        overs.push([best.x, best.z]);
        oversOf.set(group, overs);
      }
    }
    for (const [index, rail] of rails.entries()) {
      const deck = rail.grade === 'bridge';
      const overs = oversOf.get(groups[index] as number) ?? [];
      for (const run of runs[index] as Run[]) {
        const stations = run.points.length / 2;
        const span = deck
          ? {
              from: [run.points[0] as number, run.points[1] as number] as const,
              to: [
                run.points[run.points.length - 2] as number,
                run.points[run.points.length - 1] as number,
              ] as const,
              fromMetres: run.fromMetres,
              metres: (stations - 1) * RAIL_TRACK_STEP_METRES,
            }
          : undefined;
        for (let first = 0; first + 1 < stations; first += RAIL_TRACK_PIECE_STEPS) {
          const last = Math.min(stations - 1, first + RAIL_TRACK_PIECE_STEPS);
          const line = Float32Array.from(run.points.slice(first * 2, last * 2 + 2));
          let minX = Infinity;
          let maxX = -Infinity;
          let minZ = Infinity;
          let maxZ = -Infinity;
          for (let at = 0; at + 1 < line.length; at += 2) {
            minX = Math.min(minX, line[at] as number);
            maxX = Math.max(maxX, line[at] as number);
            minZ = Math.min(minZ, line[at + 1] as number);
            maxZ = Math.max(maxZ, line[at + 1] as number);
          }
          const reach = DECK_LEVEL_METRES + DECK_RAMP_METRES;
          pieces.push({
            line,
            fromMetres: run.fromMetres + first * RAIL_TRACK_STEP_METRES,
            deck,
            ...(span === undefined ? {} : { span }),
            overs: overs.filter(
              ([x, z]) =>
                Math.hypot(Math.max(minX - x, x - maxX, 0), Math.max(minZ - z, z - maxZ, 0)) <
                reach,
            ),
            minX,
            maxX,
            minZ,
            maxZ,
          });
        }
      }
    }
  }
  const track: RailTrack = { pieces, corridor };
  found.set(corridor, { profile, track });
  return track;
}

// --- A piece as triangles -------------------------------------------------------

/** `0` at `0`, `1` at `1`, level at both ends. */
function smooth(share: number): number {
  const s = Math.min(1, Math.max(0, share));
  return s * s * (3 - 2 * s);
}

/**
 * How far a point of track joined to a rail bridge stands over the ground it
 * would otherwise stand on, in metres: {@link DECK_CLEARANCE_METRES} within
 * {@link DECK_LEVEL_METRES} of where the bridge crosses the route, easing to
 * nothing over {@link DECK_RAMP_METRES} more; `0` for a track that crosses on
 * no bridge.
 */
export function overLift(
  overs: readonly (readonly [number, number])[],
  x: number,
  z: number,
): number {
  let lift = 0;
  for (const [ox, oz] of overs) {
    const out = Math.hypot(x - ox, z - oz) - DECK_LEVEL_METRES;
    lift = Math.max(lift, DECK_CLEARANCE_METRES * (1 - smooth(out / DECK_RAMP_METRES)));
  }
  return lift;
}

/** What a ride draws its track on. */
interface Ground {
  readonly profile: RouteProfile;
  readonly origin: CorridorOrigin;
  readonly seed: number;
  readonly land: LandClassMask;
  readonly ways: Waterways;
}

/** Where a point of the track stands. */
interface Standing {
  /** `cross-streets.ts` §`standingBesideRoad`'s height: the road's, the ground's, or between. */
  readonly y: number;
  readonly ground: number;
  readonly share: number;
  readonly near: NearestOnRoad;
}

/** How far the first search for the road reaches, doubled until it finds it, in metres. */
const FIRST_REACH_METRES = 32;

/**
 * Where a point of the track stands, or `undefined` past the drawn ground.
 * `within` is how far off the road the point can be at most, where the
 * caller knows — a point `d` from one whose distance is known is at most `d`
 * farther — so the search reads the few cells that can hold the answer and
 * not every cell out to the drawn ground's edge.
 */
function standingAt(ground: Ground, x: number, z: number, within?: number): Standing | undefined {
  const { profile, origin } = ground;
  let near: NearestOnRoad | undefined;
  for (
    let reach = Math.min(within ?? FIRST_REACH_METRES, GROUND_LATERAL_METRES);
    near === undefined;
    reach = Math.min(reach * 2, GROUND_LATERAL_METRES)
  ) {
    near = nearestOnDrawnRoad(profile, origin, x, z, reach);
    if (reach >= GROUND_LATERAL_METRES) break;
  }
  if (near === undefined) return undefined;
  const stood = standingBesideRoad(profile, origin, ground.seed, near, ground.land);
  return { y: stood.standing, ground: stood.ground, share: stood.share, near };
}

/** Triangles, growing: every quad its own four vertices, so each face has its own colour. */
class Builder {
  readonly positions: number[] = [];
  readonly colours: number[] = [];
  readonly indices: number[] = [];

  quad(
    colour: readonly number[],
    a: readonly [number, number, number],
    b: readonly [number, number, number],
    c: readonly [number, number, number],
    d: readonly [number, number, number],
  ): void {
    const first = this.positions.length / 3;
    for (const corner of [a, b, c, d]) {
      this.positions.push(corner[0], corner[1], corner[2]);
      this.colours.push(colour[0] as number, colour[1] as number, colour[2] as number);
    }
    this.indices.push(first, first + 1, first + 2, first, first + 2, first + 3);
  }

  done(): SideRoadMesh {
    return {
      positions: Float32Array.from(this.positions),
      colours: Float32Array.from(this.colours),
      // #628's wheel tracks and dust read `across`; a track has neither.
      across: new Float32Array(this.positions.length / 3),
      indices: Uint32Array.from(this.indices),
    };
  }
}

type Point = readonly [number, number, number];

/** One cross-section of the track. */
interface Row {
  readonly x: number;
  readonly z: number;
  /** Across the track: its direction turned a quarter. */
  readonly ax: number;
  readonly az: number;
  /** The crown's two edges and the shoulders' or the walls' feet. */
  readonly footLeft: Point;
  readonly left: Point;
  readonly right: Point;
  readonly footRight: Point;
  /** On the carriageway: the road's surface, and no bed. */
  readonly onRoad: boolean;
  /** Standing over the ground on a wall or a girder. */
  readonly lifted: boolean;
  /** How far from the drawn road's centreline. */
  readonly distance: number;
  /** What its centre stands over: the road on the carriageway, the ground past the ramp. */
  readonly under: number;
}

/** A point of a row's crown, `offset` metres across it. */
function onCrown(row: Row, offset: number, lift = 0): Point {
  const t = (offset + BALLAST_CROWN_METRES / 2) / BALLAST_CROWN_METRES;
  return [
    row.x + row.ax * offset,
    row.left[1] + (row.right[1] - row.left[1]) * t + lift,
    row.z + row.az * offset,
  ];
}

function mix(a: Point, b: Point, t: number): Point {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** What {@link pieceMesh} made of a piece. */
interface PieceMesh {
  readonly mesh: SideRoadMesh;
  readonly segments: Float32Array;
  readonly halfWidths: Float32Array;
}

/**
 * One piece as triangles. `near` carries its sleepers and each rail's three
 * faces; otherwise a sleeper-toned strip and each rail's one upright face.
 */
function pieceMesh(piece: RailTrackPiece, ground: Ground, near: boolean): PieceMesh {
  const mesh = new Builder();
  const segments: number[] = [];
  const halfWidths: number[] = [];
  const half = BALLAST_CROWN_METRES / 2;
  const count = piece.line.length / 2;
  // A deck is level from one end of its mapped span to the other.
  const spanEnds =
    piece.span === undefined
      ? undefined
      : {
          from: standingAt(ground, piece.span.from[0], piece.span.from[1]),
          to: standingAt(ground, piece.span.to[0], piece.span.to[1]),
        };
  /** How far off the road the last row's centre was, where it had one. */
  let lastDistance: number | undefined;
  /** The row at `(x, z)`, `along` metres from the piece's first station, the track running `(dx, dz)` there. */
  const rowOf = (x: number, z: number, dx: number, dz: number, along: number): Row | undefined => {
    const length = Math.hypot(dx, dz);
    if (!(length > 0)) return undefined;
    const ax = dz / length;
    const az = -dx / length;
    // A row is a step or less from the last, so no farther off the road than that and its distance.
    const centre = standingAt(
      ground,
      x,
      z,
      lastDistance === undefined ? undefined : lastDistance + RAIL_TRACK_STEP_METRES + 1,
    );
    lastDistance = centre?.near.distance;
    if (centre === undefined) return undefined;
    const lift = overLift(piece.overs, x, z);
    const lifted = lift > LIFTED_METRES;
    // A line at grade stops at water, as a street does; a deck, and a track on its way up to one, crosses it.
    if (
      !piece.deck &&
      !lifted &&
      inWater(ground.ways, ground.profile, centre.near.along, centre.near.lateral)
    ) {
      return undefined;
    }
    const at = (offset: number): { x: number; z: number; stood: Standing } | undefined => {
      const px = x + ax * offset;
      const pz = z + az * offset;
      const stood = standingAt(ground, px, pz, centre.near.distance + Math.abs(offset) + 1);
      return stood === undefined ? undefined : { x: px, z: pz, stood };
    };
    const foot = piece.deck || lifted ? half : half + BALLAST_SHOULDER_METRES;
    const points = [at(-foot), at(-half), at(half), at(foot)];
    const [fl, l, r, fr] = points;
    if (fl === undefined || l === undefined || r === undefined || fr === undefined)
      return undefined;
    let level: number | undefined;
    if (piece.deck && piece.span !== undefined && spanEnds !== undefined) {
      const from = spanEnds.from?.y ?? spanEnds.to?.y ?? centre.y;
      const to = spanEnds.to?.y ?? from;
      const metres = piece.fromMetres - piece.span.fromMetres + along;
      level = from + (to - from) * (piece.span.metres > 0 ? metres / piece.span.metres : 0);
    }
    const crown = (stood: Standing): number =>
      (level ?? stood.y) +
      BALLAST_DEPTH_METRES * (level === undefined ? stood.share : 1) +
      lift +
      SIDE_ROAD_LIFT_METRES;
    const top = { left: crown(l.stood), right: crown(r.stood) };
    const footOf = (stood: Standing, crownHere: number): number =>
      piece.deck ? crownHere - DECK_GIRDER_METRES : stood.ground - FOOT_METRES;
    return {
      x,
      z,
      ax,
      az,
      footLeft: [fl.x, footOf(fl.stood, top.left), fl.z],
      left: [l.x, top.left, l.z],
      right: [r.x, top.right, r.z],
      footRight: [fr.x, footOf(fr.stood, top.right), fr.z],
      onRoad: !piece.deck && !lifted && centre.near.distance <= ON_CARRIAGEWAY_METRES,
      lifted,
      distance: centre.near.distance,
      under: centre.y,
    };
  };
  const rowAt = (index: number): Row | undefined => {
    const before = Math.max(0, index - 1);
    const after = Math.min(count - 1, index + 1);
    return rowOf(
      piece.line[index * 2] as number,
      piece.line[index * 2 + 1] as number,
      (piece.line[after * 2] as number) - (piece.line[before * 2] as number),
      (piece.line[after * 2 + 1] as number) - (piece.line[before * 2 + 1] as number),
      index * RAIL_TRACK_STEP_METRES,
    );
  };
  /** The track from row `a` to row `b`: `metres` of it, starting `from` along the mapped line. */
  const stretch = (a: Row, b: Row, from: number, metres: number): void => {
    const paved = a.onRoad && b.onRoad;
    const side = piece.deck ? DECK_GIRDER : a.lifted || b.lifted ? TRACK_WALL : BALLAST_SHOULDER;
    // The bed: a shoulder, a wall or a girder each side, and the crown.
    mesh.quad(side, a.footLeft, b.footLeft, b.left, a.left);
    mesh.quad(paved ? CROSSING_PANEL : BALLAST, a.left, b.left, b.right, a.right);
    mesh.quad(side, a.right, b.right, b.footRight, a.footRight);
    const sleepers = SLEEPER_LENGTH_METRES / 2;
    const al = onCrown(a, -sleepers, SLEEPER_PROUD_METRES);
    const ar = onCrown(a, sleepers, SLEEPER_PROUD_METRES);
    const bl = onCrown(b, -sleepers, SLEEPER_PROUD_METRES);
    const br = onCrown(b, sleepers, SLEEPER_PROUD_METRES);
    if (!paved && near) {
      // Each sleeper whose centre is in this stretch, counted from the line's start.
      for (
        let k = Math.ceil(from / SLEEPER_SPACING_METRES);
        k * SLEEPER_SPACING_METRES < from + metres;
        k += 1
      ) {
        const t = (k * SLEEPER_SPACING_METRES - from) / metres;
        const w = SLEEPER_WIDTH_METRES / 2 / metres;
        // Not held to the stretch: a sleeper across a station is whole, run on along this stretch's lines.
        mesh.quad(
          SLEEPER,
          mix(al, bl, t - w),
          mix(al, bl, t + w),
          mix(ar, br, t + w),
          mix(ar, br, t - w),
        );
      }
    } else if (!paved) {
      mesh.quad(SLEEPER_FAR, al, bl, br, ar);
    }
    // The rails: on the sleepers, or their heads just proud of the road's surface.
    const headOf = (row: Row): number =>
      row.onRoad ? RAIL_ON_ROAD_METRES : SLEEPER_PROUD_METRES + RAIL_HEIGHT_METRES;
    const footLift = (row: Row): number => (row.onRoad ? 0 : SLEEPER_PROUD_METRES);
    for (const centre of [-RAIL_HALF_GAUGE_METRES, RAIL_HALF_GAUGE_METRES]) {
      const outer = centre - RAIL_HEAD_WIDTH_METRES / 2;
      const inner = centre + RAIL_HEAD_WIDTH_METRES / 2;
      if (near) {
        mesh.quad(
          RAIL_WEB,
          onCrown(a, outer, footLift(a)),
          onCrown(b, outer, footLift(b)),
          onCrown(b, outer, headOf(b)),
          onCrown(a, outer, headOf(a)),
        );
        mesh.quad(
          RAIL_STEEL,
          onCrown(a, outer, headOf(a)),
          onCrown(b, outer, headOf(b)),
          onCrown(b, inner, headOf(b)),
          onCrown(a, inner, headOf(a)),
        );
        mesh.quad(
          RAIL_WEB,
          onCrown(a, inner, headOf(a)),
          onCrown(b, inner, headOf(b)),
          onCrown(b, inner, footLift(b)),
          onCrown(a, inner, footLift(a)),
        );
      } else {
        // #2660's reason: far off, a rail's top is under a pixel and its upright face is not.
        mesh.quad(
          RAIL_STEEL,
          onCrown(a, centre, footLift(a)),
          onCrown(b, centre, footLift(b)),
          onCrown(b, centre, headOf(b)),
          onCrown(a, centre, headOf(a)),
        );
      }
    }
    // The scenery keeps off the bed, but nothing is kept off the carriageway for it.
    if ((a.distance + b.distance) / 2 > ROAD_WIDTH_METRES / 2) {
      segments.push(a.x, a.z, b.x, b.z);
      halfWidths.push(half + BALLAST_SHOULDER_METRES);
    }
  };
  /**
   * A pier under a deck's row: two faces crossed, from the girder to the
   * ground, where the deck is {@link DECK_PIER_OVER_METRES} over it and clear
   * of the carriageway — so a deck stands on something and never hangs.
   */
  const pier = (row: Row): void => {
    const top = Math.min(row.left[1], row.right[1]) - DECK_GIRDER_METRES;
    const foot = row.under - FOOT_METRES;
    if (top - foot < DECK_PIER_OVER_METRES) return;
    if (row.distance < ROAD_WIDTH_METRES / 2 + DECK_PIER_CLEAR_METRES) return;
    const across = DECK_PIER_METRES[0] / 2;
    const along = DECK_PIER_METRES[1] / 2;
    mesh.quad(
      TRACK_WALL,
      [row.x - row.ax * across, foot, row.z - row.az * across],
      [row.x + row.ax * across, foot, row.z + row.az * across],
      [row.x + row.ax * across, top, row.z + row.az * across],
      [row.x - row.ax * across, top, row.z - row.az * across],
    );
    // Along the track: its direction is the across direction turned back a quarter.
    mesh.quad(
      TRACK_WALL,
      [row.x + row.az * along, foot, row.z - row.ax * along],
      [row.x - row.az * along, foot, row.z + row.ax * along],
      [row.x - row.az * along, top, row.z + row.ax * along],
      [row.x + row.az * along, top, row.z - row.ax * along],
    );
  };
  let cuts = 0;
  let a = rowAt(0);
  for (let index = 1; index < count; index += 1) {
    // Every third station of the mapped line, and never a piece's last, which is the next one's first.
    const station = Math.round(piece.fromMetres / RAIL_TRACK_STEP_METRES) + index - 1;
    if (piece.deck && a !== undefined && station % DECK_PIER_EVERY_STATIONS === 0) pier(a);
    const b = rowAt(index);
    if (a !== undefined && b !== undefined) {
      const from = piece.fromMetres + (index - 1) * RAIL_TRACK_STEP_METRES;
      // Where a step leaves or enters the carriageway it is cut there, so the
      // road's surface stops at the road's edge and not a step past it.
      const t = (ON_CARRIAGEWAY_METRES - a.distance) / (b.distance - a.distance);
      const edge =
        a.onRoad !== b.onRoad && cuts < CROSSING_CUTS_PER_PIECE && t > 0.02 && t < 0.98
          ? rowOf(
              a.x + (b.x - a.x) * t,
              a.z + (b.z - a.z) * t,
              b.x - a.x,
              b.z - a.z,
              (index - 1 + t) * RAIL_TRACK_STEP_METRES,
            )
          : undefined;
      if (edge === undefined) {
        stretch(a, b, from, RAIL_TRACK_STEP_METRES);
      } else {
        cuts += 1;
        // The cut is the carriageway's last row, whichever side of it the arithmetic lands.
        const last: Row = { ...edge, onRoad: true };
        stretch(a, last, from, t * RAIL_TRACK_STEP_METRES);
        stretch(last, b, from + t * RAIL_TRACK_STEP_METRES, (1 - t) * RAIL_TRACK_STEP_METRES);
      }
    }
    a = b;
  }
  return {
    mesh: mesh.done(),
    segments: Float32Array.from(segments),
    halfWidths: Float32Array.from(halfWidths),
  };
}

// --- A level crossing's signs ---------------------------------------------------

/** How far off the carriageway's edge a crossing's sign stands, in metres: **1.5**. */
export const CROSSBUCK_VERGE_METRES = 1.5;
/** How far short of the track's centreline, square to it, in metres: **4**. */
export const CROSSBUCK_SETBACK_METRES = 4;
/** A crossbuck's post, in metres high: **3.2**. */
export const CROSSBUCK_POST_METRES = 3.2;
/** How high its boards cross, in metres: **2.8**. */
export const CROSSBUCK_HEIGHT_METRES = 2.8;
/** Each board, in metres: **1.2** by **0.22**. */
export const CROSSBUCK_BOARD_METRES = [1.2, 0.22] as const;
/** How high a crossing's pair of lights is, in metres: **2.05**. */
export const CROSSING_LIGHT_HEIGHT_METRES = 2.05;
/** A raised gate's arm, in metres long: **4**. */
export const CROSSING_GATE_METRES = 4;
/** How near a level crossing a tag must be to be its own, in metres: **25**. */
export const CROSSING_TAG_METRES = 25;

/** A crossing's tags: the nearest within {@link CROSSING_TAG_METRES}. */
function tagNear(
  tags: readonly RailCrossingTag[],
  x: number,
  z: number,
): RailCrossingTag | undefined {
  let best: RailCrossingTag | undefined;
  let least = CROSSING_TAG_METRES;
  for (const tag of tags) {
    const distance = Math.hypot(tag.x - x, tag.z - z);
    if (distance <= least) {
      least = distance;
      best = tag;
    }
  }
  return best;
}

/**
 * One level crossing's signs as triangles — #3253: a **crossbuck** on the
 * rider's right each way the road is ridden, {@link CROSSBUCK_SETBACK_METRES}
 * short of the track; under it a pair of **lights** where the crossing is
 * tagged with lights or gates, and a **gate**, raised, where it is tagged
 * with gates. `undefined` where the track leaves the road too shallowly to
 * stand a sign before it.
 */
export function crossingFurniture(
  junction: Junction,
  tags: readonly RailCrossingTag[],
  profile: RouteProfile,
  origin: CorridorOrigin,
  seed: number,
  land: LandClassMask = NO_LAND_CLASS,
): SideRoad | undefined {
  const frame = drawnRoadFrame(profile, origin, junction.along);
  const arm = junction.arms[0];
  if (frame === undefined || arm === undefined || arm.line.length < 4) return undefined;
  const nx = frame.normalX;
  const nz = frame.normalZ;
  // The road's forward direction is its normal turned back a quarter (`terrain.ts`).
  const fx = nz;
  const fz = -nx;
  let tx = (arm.line[2] as number) - (arm.line[0] as number);
  let tz = (arm.line[3] as number) - (arm.line[1] as number);
  const length = Math.hypot(tx, tz);
  if (!(length > 0)) return undefined;
  tx /= length;
  tz /= length;
  const alongRoad = tx * fx + tz * fz;
  const acrossRoad = tx * nx + tz * nz;
  if (Math.abs(acrossRoad) < 0.2) return undefined;
  const tag = tagNear(tags, frame.x, frame.z);
  const lights = tag !== undefined && (tag.lights || tag.gates);
  const gates = tag?.gates === true;
  const ground: Ground = { profile, origin, seed, land, ways: waterways(profile, seed, land) };
  const mesh = new Builder();
  for (const way of [1, -1] as const) {
    // The rider's right, this way along the road.
    const lateral = way * (ROAD_WIDTH_METRES / 2 + CROSSBUCK_VERGE_METRES);
    const meets = (lateral * alongRoad) / acrossRoad;
    const ahead = meets - (way * CROSSBUCK_SETBACK_METRES) / Math.abs(acrossRoad);
    const x = frame.x + fx * ahead + nx * lateral;
    const z = frame.z + fz * ahead + nz * lateral;
    const stood = standingAt(ground, x, z);
    if (stood === undefined) continue;
    const base = stood.y;
    /** A point of the sign: `across` along the road's normal, `up`, and `toward` the rider it faces. */
    const at = (across: number, up: number, toward = 0): Point => [
      x + nx * across - fx * way * toward,
      base + up,
      z + nz * across - fz * way * toward,
    ];
    /** A board in the sign's plane about `(across, up)`, `w` by `h`, turned `turn` radians. */
    const board = (
      colour: readonly number[],
      across: number,
      up: number,
      w: number,
      h: number,
      turn: number,
      toward: number,
    ): void => {
      const c = Math.cos(turn);
      const s = Math.sin(turn);
      const corner = (u: number, v: number): Point =>
        at(across + u * c - v * s, up + u * s + v * c, toward);
      mesh.quad(
        colour,
        corner(-w / 2, -h / 2),
        corner(w / 2, -h / 2),
        corner(w / 2, h / 2),
        corner(-w / 2, h / 2),
      );
    };
    // The post: two faces crossed, so it has width from every side.
    board(
      SIGNAL_POST,
      0,
      (CROSSBUCK_POST_METRES - FOOT_METRES) / 2,
      0.1,
      CROSSBUCK_POST_METRES + FOOT_METRES,
      0,
      0,
    );
    mesh.quad(
      SIGNAL_POST,
      at(0, -FOOT_METRES, -0.05),
      at(0, -FOOT_METRES, 0.05),
      at(0, CROSSBUCK_POST_METRES, 0.05),
      at(0, CROSSBUCK_POST_METRES, -0.05),
    );
    for (const turn of [Math.PI / 4, -Math.PI / 4]) {
      board(
        CROSSBUCK_WHITE,
        0,
        CROSSBUCK_HEIGHT_METRES,
        CROSSBUCK_BOARD_METRES[0],
        CROSSBUCK_BOARD_METRES[1],
        turn,
        0.06,
      );
    }
    if (lights) {
      for (const across of [-0.4, 0.4]) {
        board(SIGNAL_BLACK, across, CROSSING_LIGHT_HEIGHT_METRES, 0.5, 0.5, 0, 0.08);
        // The lamp: an octagon of two squares, one turned an eighth.
        board(SIGNAL_RED, across, CROSSING_LIGHT_HEIGHT_METRES, 0.26, 0.26, 0, 0.1);
        board(SIGNAL_RED, across, CROSSING_LIGHT_HEIGHT_METRES, 0.26, 0.26, Math.PI / 4, 0.1);
      }
    }
    if (gates) {
      // Its mechanism on the post, and the arm raised: no train is coming.
      board(SIGNAL_POST, 0, 1.15, 0.4, 0.5, 0, -0.1);
      const lean = (-way * 10 * Math.PI) / 180;
      const bands = 5;
      for (let band = 0; band < bands; band += 1) {
        const middle = ((band + 0.5) * CROSSING_GATE_METRES) / bands;
        board(
          band % 2 === 0 ? GATE_RED : CROSSBUCK_WHITE,
          -Math.sin(lean) * middle,
          1.15 + Math.cos(lean) * middle,
          0.14,
          CROSSING_GATE_METRES / bands,
          lean,
          -0.14,
        );
      }
    }
  }
  if (mesh.indices.length === 0) return undefined;
  return {
    junction: { along: junction.along, source: 'rail', arms: [] },
    mesh: mesh.done(),
    segments: new Float32Array(0),
    halfWidths: new Float32Array(0),
  };
}

// --- The pieces in view -----------------------------------------------------------

/** Each piece's side roads on a land mask, built the first time each is in view. */
const built = new WeakMap<
  LandClassMask,
  WeakMap<RailTrackPiece, { near?: SideRoad | undefined; far?: SideRoad | undefined }>
>();

function sideRoadOf(piece: RailTrackPiece, ground: Ground, near: boolean): SideRoad {
  let byPiece = built.get(ground.land);
  if (byPiece === undefined) {
    byPiece = new WeakMap();
    built.set(ground.land, byPiece);
  }
  let known = byPiece.get(piece);
  if (known === undefined) {
    known = {};
    byPiece.set(piece, known);
  }
  const held = near ? known.near : known.far;
  if (held !== undefined) return held;
  const made = pieceMesh(piece, ground, near);
  const first = nearestOnDrawnRoad(
    ground.profile,
    ground.origin,
    piece.line[0] as number,
    piece.line[1] as number,
    GROUND_LATERAL_METRES,
  );
  const road: SideRoad = {
    // No junction of its own: its `along` is where on the route it is beside.
    junction: { along: first?.along ?? 0, source: 'rail', arms: [] },
    mesh: made.mesh,
    segments: made.segments,
    halfWidths: made.halfWidths,
  };
  if (near) known.near = road;
  else known.far = road;
  return road;
}

/** Each crossing's signs on a land mask, built once. */
const furnished = new WeakMap<LandClassMask, WeakMap<Junction, SideRoad | null>>();

/** The last choice of pieces in view, by track: reused until the rider moves on. */
const chosen = new WeakMap<
  RailTrack,
  { land: LandClassMask; profile: RouteProfile; at: number; roads: readonly SideRoad[] }
>();

const NO_TRACK: readonly SideRoad[] = [];

/**
 * The railway in view of a rider `riderMetres` along — #3253: the
 * `RAIL_TRACK_PIECES_PER_FRAME` pieces nearest the last multiple of
 * {@link RAIL_TRACK_REFRESH_METRES} behind the rider, within
 * {@link RAIL_TRACK_VIEW_METRES} and that much more of it, the nearest
 * `RAIL_TRACK_NEAR_PIECES` within {@link RAIL_TRACK_NEAR_METRES} with their
 * sleepers; then the signs of the nearest `RAIL_CROSSINGS_PER_FRAME` level
 * crossings in the same reach. The same array, and the same objects, until
 * the rider reaches the next multiple, so the side roads' mesh is not rebuilt
 * between.
 */
export function railTrackAt(
  track: RailTrack,
  profile: RouteProfile,
  origin: CorridorOrigin,
  seed: number,
  riderMetres: number,
  land: LandClassMask = NO_LAND_CLASS,
): readonly SideRoad[] {
  if (track.pieces.length === 0) return NO_TRACK;
  const at = Math.floor(riderMetres / RAIL_TRACK_REFRESH_METRES) * RAIL_TRACK_REFRESH_METRES;
  const last = chosen.get(track);
  if (last?.at === at && last.land === land && last.profile === profile) return last.roads;
  const centre = drawnRoadPosition(profile, origin, at);
  const reach = RAIL_TRACK_VIEW_METRES + RAIL_TRACK_REFRESH_METRES;
  const ground: Ground = { profile, origin, seed, land, ways: waterways(profile, seed, land) };
  const inView: { index: number; gap: number }[] = [];
  for (const [index, piece] of track.pieces.entries()) {
    const gapX = Math.max(piece.minX - centre.x, centre.x - piece.maxX, 0);
    const gapZ = Math.max(piece.minZ - centre.z, centre.z - piece.maxZ, 0);
    const gap = Math.hypot(gapX, gapZ);
    if (gap <= reach) inView.push({ index, gap });
  }
  inView.sort((a, b) => a.gap - b.gap || a.index - b.index);
  const roads = inView
    .slice(0, RAIL_TRACK_PIECES_PER_FRAME)
    .map(({ index, gap }, rank) => ({
      index,
      near: rank < RAIL_TRACK_NEAR_PIECES && gap <= RAIL_TRACK_NEAR_METRES,
    }))
    .sort((a, b) => a.index - b.index)
    .map(({ index, near }) => sideRoadOf(track.pieces[index] as RailTrackPiece, ground, near))
    .filter((road) => road.mesh.indices.length > 0);
  // The crossings' signs: the nearest few whose crossing is in the same reach.
  let byJunction = furnished.get(land);
  if (byJunction === undefined) {
    byJunction = new WeakMap();
    furnished.set(land, byJunction);
  }
  const crossings = levelCrossings(track.corridor, profile, origin, seed, land)
    .map((junction) => {
      const here = drawnRoadPosition(profile, origin, junction.along);
      return { junction, gap: Math.hypot(here.x - centre.x, here.z - centre.z) };
    })
    .filter(({ gap }) => gap <= reach)
    .sort((a, b) => a.gap - b.gap || a.junction.along - b.junction.along)
    .slice(0, RAIL_CROSSINGS_PER_FRAME);
  for (const { junction } of crossings) {
    let signs = byJunction.get(junction);
    if (signs === undefined) {
      signs =
        crossingFurniture(
          junction,
          track.corridor.railCrossings ?? [],
          profile,
          origin,
          seed,
          land,
        ) ?? null;
      byJunction.set(junction, signs);
    }
    if (signs !== null) roads.push(signs);
  }
  chosen.set(track, { land, profile, at, roads });
  return roads;
}
