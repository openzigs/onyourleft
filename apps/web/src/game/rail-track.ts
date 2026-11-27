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
 *   track — the same bed, sleepers and rails on a plate girder
 *   {@link DECK_GIRDER_METRES} deep with a flange and stiffeners, the edge of
 *   its ballast showing over the girder and a railing over that, on capped,
 *   battered piers wherever it is high over the ground — level from one end
 *   of the mapped span to the other, so it crosses water and low ground
 *   instead of following them.
 *   Where it crosses the route it clears the road by
 *   {@link DECK_CLEARANCE_METRES} ({@link overLift}) as an open span
 *   {@link DECK_SPAN_HALF_METRES} each side, on two piers a side; it ends at
 *   an abutment — a short face under the girder's bearing with a wing wall
 *   each side — in a grass embankment whose sides fall at 1 in
 *   {@link EMBANKMENT_RUN}, and the track climbs to it on that bank.
 * - **A disused line** keeps its track, rusted and grown over
 *   ({@link BALLAST_OVERGROWN}), and stands no sign at a crossing.
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

/** A deck's plate girder under its track, in metres deep: **1.2**. */
export const DECK_GIRDER_METRES = 1.2;

/**
 * The edge of the deck's ballast, seen from beside and below, in metres deep:
 * **0.35** — a band of ballast along each side, over the girder.
 */
export const DECK_KERB_METRES = 0.35;

/** How high over the deck's ballast its railing's top rail is, in metres: **1.1**. */
export const DECK_RAILING_METRES = 1.1;

/** How far each side of the route's crossing a rail bridge is an open span, in metres: **32**. Past it, an abutment and walls. */
export const DECK_SPAN_HALF_METRES = 32;

/** How far from the route's crossing a bridge's piers stand, each side, in metres: **8** and **24**, so spans of 16 m. */
export const DECK_PIERS_FROM_CROSSING_METRES = [8, 24] as const;

/**
 * How far over the road a rail bridge's track is where it crosses the route,
 * in metres: **6.8** — its {@link DECK_KERB_METRES} of ballast, its
 * {@link DECK_GIRDER_METRES} girder and 5.25 m clear under it.
 */
export const DECK_CLEARANCE_METRES = 6.8;

/**
 * How far each side of the route's crossing a rail bridge holds its full
 * height, in metres: its whole open span, {@link DECK_SPAN_HALF_METRES} — a
 * girder is level from abutment to abutment, and the climb is the bank's.
 */
export const DECK_LEVEL_METRES = DECK_SPAN_HALF_METRES;

/** How many metres out an embankment's side runs for each metre it falls: **2**, as `overpasses.ts`' banks do. */
export const EMBANKMENT_RUN = 2;

/** The farthest an embankment's side runs out, in metres: **20**. */
export const EMBANKMENT_MAX_RUN_METRES = 20;

/**
 * How far off the carriageway's edge a bank's foot stops, in metres: **2** — a
 * bank is steeper than 1 in {@link EMBANKMENT_RUN} before it is run across
 * the road — and how far off it a deck stays an open span.
 */
export const EMBANKMENT_CLEAR_METRES = 2;

/**
 * How far under the track an abutment's seat is, in metres: **2.4** — the
 * ballast's edge, the girder and a short face under its bearing. Below the
 * seat the bank comes forward under the span as grass.
 */
export const ABUTMENT_SEAT_METRES = 2.4;

/** How far past the bed each side an abutment's face runs, in metres: **0.5**. */
export const ABUTMENT_CHEEK_METRES = 0.5;

/** How far back into the bank an abutment's wing wall is turned, in metres: **2**. */
export const ABUTMENT_WING_BACK_METRES = 2;

/** Over how many metres past that the track comes down to the ground: **150**. */
export const DECK_RAMP_METRES = 150;

/** A deck that crosses no route stands on a pier every this many stations: **6**, so every 24 m. */
export const DECK_PIER_EVERY_STATIONS = 6;

/** A pier under its cap, in metres across the track and along it: **2.2** by **1.2**. */
export const DECK_PIER_METRES = [2.2, 1.2] as const;

/** How much wider a pier is at its foot than under its cap: **1.4** times, a batter both ways. */
export const DECK_PIER_BATTER = 1.4;

/** A pier's cap, in metres across the track, along it and deep: **3.8** by **1.6** by **0.45** — wider than the deck, so both girders bear on it. */
export const DECK_PIER_CAP_METRES = [3.8, 1.6, 0.45] as const;

/** A deck's girder must be this far over the ground for a pier to stand under it, in metres: **1**. */
export const DECK_PIER_OVER_METRES = 1;

/** How far off the carriageway's edge the nearest pier stands, in metres: **2**. */
export const DECK_PIER_CLEAR_METRES = 2;

/**
 * How far from the road's centreline a deck's row holds its clearance whole,
 * in metres: the carriageway, the half bed and {@link EMBANKMENT_CLEAR_METRES}.
 */
const HELD_CORE_METRES = ROAD_WIDTH_METRES / 2 + BALLAST_CROWN_METRES / 2 + EMBANKMENT_CLEAR_METRES;

/**
 * Over how many metres more that hold eases off: what an abutment's face, its
 * wings turned back and the bank's front under it reach from the bed.
 */
const HELD_EDGE_METRES =
  EMBANKMENT_RUN * ABUTMENT_SEAT_METRES + ABUTMENT_WING_BACK_METRES + EMBANKMENT_CLEAR_METRES;

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
/** A girder's bottom flange and its stiffeners, and the railing's posts over them: the same paint in shadow. */
export const DECK_FLANGE = linearColour(0x26302d);
/** A deck's railing: galvanised steel. */
export const DECK_RAILING = linearColour(0x9da3a4);
/** A pier's cap: newer, paler concrete than the pier under it. */
export const PIER_CAP = linearColour(0xa3a097);
/** A pier's foot: its concrete stained by the ground. */
export const PIER_FOOT = linearColour(0x5f5d55);
/** An embankment's side: grass, in the road's material — the ground's own photograph is not this mesh's. */
export const EMBANKMENT_GRASS = linearColour(0x4f6b38);
/** An abutment's concrete: older and darker than a pier's. */
export const ABUTMENT = linearColour(0x6b6860);
/** A disused line's ballast: grown over. */
export const BALLAST_OVERGROWN = linearColour(0x56613f);
/** A pier's concrete, under its cap. */
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
  /** A line mapped as disused: rusted rails, ballast grown over. */
  readonly disused: boolean;
  /** A deck's whole mapped span in view: its two ends and its length. */
  readonly span?: {
    readonly from: readonly [number, number];
    readonly to: readonly [number, number];
    readonly fromMetres: number;
    readonly metres: number;
  };
  /** The places this piece's track is joined to a bridge over the route at. */
  readonly overs: readonly RailOver[];
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

/** Where a bridge crosses the route: its point on the route, and where in its mapped span that is. */
export interface RailOver {
  readonly x: number;
  readonly z: number;
  /** The mapped span's two ends: the deck's level is the line between the ground at them. */
  readonly from: readonly [number, number];
  readonly to: readonly [number, number];
  /** How far from `from` to `to` the crossing is, `0` to `1`. */
  readonly share: number;
}

/** A corridor's railway, read once. */
export interface RailTrack {
  readonly pieces: readonly RailTrackPiece[];
  /** The corridor it was read from: its level crossings and their tags. */
  readonly corridor: WorldCorridor;
  /** Whether the only line at grade through `(x, z)` is disused: a crossing nobody signs. */
  readonly disusedAt: (x: number, z: number) => boolean;
}

/** How far a point is from a polyline, in metres. */
function distanceToLine(line: Float32Array, x: number, z: number): number {
  let least = Infinity;
  for (let at = 0; at + 3 < line.length; at += 2) {
    const ax = line[at] as number;
    const az = line[at + 1] as number;
    const dx = (line[at + 2] as number) - ax;
    const dz = (line[at + 3] as number) - az;
    const span = dx * dx + dz * dz;
    const t = span > 0 ? Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / span)) : 0;
    least = Math.min(least, Math.hypot(x - ax - dx * t, z - az - dz * t));
  }
  return least;
}

/** How near a crossing's point a line must pass to be the crossing's own, in metres: **10**. */
const CROSSING_LINE_METRES = 10;

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
    const oversOf = new Map<number, RailOver[]>();
    for (const [index, rail] of rails.entries()) {
      if (rail.grade !== 'bridge') continue;
      for (const run of runs[index] as Run[]) {
        let best: { x: number; z: number; distance: number; station: number } | undefined;
        for (let at = 0; at + 1 < run.points.length; at += 2) {
          const x = run.points[at] as number;
          const z = run.points[at + 1] as number;
          const on = nearestOnDrawnRoad(profile, origin, x, z, RAIL_TRACK_STEP_METRES);
          if (on !== undefined && (best === undefined || on.distance < best.distance)) {
            best = { x, z, distance: on.distance, station: at / 2 };
          }
        }
        if (best === undefined) continue;
        const group = groups[index] as number;
        const overs = oversOf.get(group) ?? [];
        const last = run.points.length - 2;
        overs.push({
          x: best.x,
          z: best.z,
          from: [run.points[0] as number, run.points[1] as number],
          to: [run.points[last] as number, run.points[last + 1] as number],
          share: last > 0 ? (best.station * 2) / last : 0,
        });
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
            disused: rail.kindDetail === 'disused',
            ...(span === undefined ? {} : { span }),
            overs: overs.filter(
              ({ x, z }) =>
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
  const atGrade = rails.filter((rail) => rail.grade === 'ground');
  const through = (disused: boolean, x: number, z: number): boolean =>
    atGrade.some(
      (rail) =>
        (rail.kindDetail === 'disused') === disused &&
        distanceToLine(rail.line, x, z) <= CROSSING_LINE_METRES,
    );
  const track: RailTrack = {
    pieces,
    corridor,
    disusedAt: (x, z) => through(true, x, z) && !through(false, x, z),
  };
  found.set(corridor, { profile, track });
  return track;
}

// --- A piece as triangles -------------------------------------------------------

/** `0` at `0`, `1` at `1`, level at both ends. */
function smooth(share: number): number {
  const s = Math.min(1, Math.max(0, share));
  return s * s * (3 - 2 * s);
}

/** A crossing and how far over the ground its deck stands there, in metres: see {@link overAmplitude}. */
interface Lifting {
  readonly x: number;
  readonly z: number;
  readonly amplitude: number;
}

/**
 * How far a point of track joined to a rail bridge stands over the ground it
 * would otherwise stand on, in metres: each crossing's `amplitude` within
 * {@link DECK_LEVEL_METRES} of where the bridge crosses the route, easing to
 * nothing over {@link DECK_RAMP_METRES} more; `0` for a track that crosses on
 * no bridge. `hold` is how far, `0` to `1`, a deck row is held in the road's
 * corridor: that share of the nearest crossing's whole amplitude, however far
 * along the line it is, so a bridge that crosses at a shallow angle keeps its
 * clearance as far as the road runs under it.
 */
export function overLift(overs: readonly Lifting[], x: number, z: number, hold = 0): number {
  let lift = 0;
  let nearest: Lifting | undefined;
  let least = Infinity;
  for (const over of overs) {
    const away = Math.hypot(x - over.x, z - over.z);
    if (away < least) {
      least = away;
      nearest = over;
    }
    const out = away - DECK_LEVEL_METRES;
    lift = Math.max(lift, over.amplitude * (1 - smooth(out / DECK_RAMP_METRES)));
  }
  return nearest === undefined ? lift : Math.max(lift, nearest.amplitude * hold);
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

/**
 * How far over the deck's own level a bridge's track is lifted where it
 * crosses the route, in metres, so that it is {@link DECK_CLEARANCE_METRES}
 * over the ROAD there — #3270: the deck is level between the ground at its
 * mapped span's two ends, which is not the road's height at the crossing, and a
 * lift that ignored the road left the girder 1 to 12 m over it. Never under
 * `0`: a road in a cutting is under more than the clearance, not a deck sunk
 * into the ground.
 */
function overAmplitude(ground: Ground, over: RailOver): number {
  const here = standingAt(ground, over.x, over.z);
  const from = standingAt(ground, over.from[0], over.from[1]);
  const to = standingAt(ground, over.to[0], over.to[1]);
  const end = from?.y ?? to?.y;
  if (here === undefined || end === undefined) return DECK_CLEARANCE_METRES;
  // The deck slopes with the ground at its ends: its lowest level over the carriageway, a
  // half road and a half bed either side of the crossing along the line, is what clears.
  const metres = Math.hypot(over.to[0] - over.from[0], over.to[1] - over.from[1]);
  const reach = metres > 0 ? (ROAD_WIDTH_METRES / 2 + BALLAST_CROWN_METRES / 2) / metres : 0;
  const slope = (to?.y ?? end) - end;
  const level = end + slope * Math.min(1, Math.max(0, over.share + (slope < 0 ? reach : -reach)));
  // The road's own height at the crossing, whichever side of its edge the point is on.
  const road = standingBesideRoad(
    ground.profile,
    ground.origin,
    ground.seed,
    { ...here.near, lateral: 0 },
    ground.land,
  ).standing;
  return Math.max(
    0,
    road + DECK_CLEARANCE_METRES - level - BALLAST_DEPTH_METRES - SIDE_ROAD_LIFT_METRES,
  );
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
    /** The colour of `c` and `d`, where the face shades from one edge to the other. */
    far: readonly number[] = colour,
  ): void {
    const first = this.positions.length / 3;
    for (const [index, corner] of [a, b, c, d].entries()) {
      const tone = index < 2 ? colour : far;
      this.positions.push(corner[0], corner[1], corner[2]);
      this.colours.push(tone[0] as number, tone[1] as number, tone[2] as number);
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
  /** How far across the track its farther foot is, in metres: what the scenery keeps off. */
  readonly reach: number;
  /** A deck's row in its open span: a girder on piers. A deck's other rows are an abutment's walls. */
  readonly open: boolean;
  /** How far from where its track's bridge crosses the route; `Infinity` where it crosses none. */
  readonly over: number;
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
  const lifting: Lifting[] = piece.overs.map((over) => ({
    x: over.x,
    z: over.z,
    amplitude: overAmplitude(ground, over),
  }));
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
    // A deck over the road's corridor, and where an abutment's wings would reach into it, holds
    // its clearance and is open, however far along its line.
    const hold =
      piece.deck && piece.overs.length > 0
        ? 1 - smooth((centre.near.distance - HELD_CORE_METRES) / HELD_EDGE_METRES)
        : 0;
    const held = hold > 0;
    const lift = overLift(lifting, x, z, hold);
    let over = Infinity;
    for (const crossing of piece.overs) {
      over = Math.min(over, Math.hypot(x - crossing.x, z - crossing.z));
    }
    // A bridge over the route is an open span beside the road and an abutment past it.
    const open = piece.deck && (piece.overs.length === 0 || over <= DECK_SPAN_HALF_METRES || held);
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
    const l = at(-half);
    const r = at(half);
    if (l === undefined || r === undefined) return undefined;
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
    // A shoulder falls to the ground beside the bed; track over the ground is on a bank, whose
    // side runs out two metres for each it falls.
    const runOf = (crownHere: number, stood: Standing): number =>
      lifted || piece.deck
        ? Math.min(
            EMBANKMENT_MAX_RUN_METRES,
            Math.max(BALLAST_SHOULDER_METRES, EMBANKMENT_RUN * (crownHere - stood.ground)),
          )
        : BALLAST_SHOULDER_METRES;
    // A bank is never run across the carriageway: steeper than 1 in 2 instead.
    const keep = ROAD_WIDTH_METRES / 2 + EMBANKMENT_CLEAR_METRES;
    const kept = (sign: 1 | -1, run: number): number => {
      let reach = run;
      while (reach > BALLAST_SHOULDER_METRES && centre.near.distance - half - reach < keep) {
        const foot = at(sign * (half + reach));
        if (
          foot !== undefined &&
          foot.stood.near.distance >= keep &&
          Math.sign(foot.stood.near.lateral) === Math.sign(centre.near.lateral)
        ) {
          break;
        }
        reach = Math.max(BALLAST_SHOULDER_METRES, reach - 1);
      }
      return reach;
    };
    const runs = {
      left: kept(-1, runOf(top.left, l.stood)),
      right: kept(1, runOf(top.right, r.stood)),
    };
    const fl = at(-half - runs.left);
    const fr = at(half + runs.right);
    if (fl === undefined || fr === undefined) return undefined;
    const footOf = (stood: Standing): number => stood.ground - FOOT_METRES;
    return {
      x,
      z,
      ax,
      az,
      footLeft: [fl.x, footOf(fl.stood), fl.z],
      left: [l.x, top.left, l.z],
      right: [r.x, top.right, r.z],
      footRight: [fr.x, footOf(fr.stood), fr.z],
      onRoad: !piece.deck && !lifted && centre.near.distance <= ON_CARRIAGEWAY_METRES,
      lifted,
      distance: centre.near.distance,
      under: centre.y,
      reach: half + Math.max(runs.left, runs.right),
      open,
      over,
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
  const crownColour = piece.disused ? BALLAST_OVERGROWN : BALLAST;
  // A disused line's running surface is as rusted as the rest of its rail.
  const steel = piece.disused ? RAIL_WEB : RAIL_STEEL;
  /**
   * One side of an open span between two rows — #3253: the edge of the deck's
   * ballast, the plate girder's web under it with its bottom flange, and the
   * railing's top rail over it; near the rider a stiffener on the web run up
   * as the railing's post too. `sign` is the side, `−1` the left.
   */
  const fascia = (a: Row, b: Row, sign: 1 | -1): void => {
    const edge = (row: Row, drop: number, out = 0): Point => {
      const from = sign < 0 ? row.left : row.right;
      return [from[0] + row.ax * sign * out, from[1] - drop, from[2] + row.az * sign * out];
    };
    const band = (colour: readonly number[], top: number, bottom: number, out = 0): void => {
      mesh.quad(
        colour,
        edge(a, bottom, out),
        edge(b, bottom, out),
        edge(b, top, out),
        edge(a, top, out),
      );
    };
    const webFoot = DECK_KERB_METRES + DECK_GIRDER_METRES;
    band(crownColour, 0, DECK_KERB_METRES);
    band(DECK_GIRDER, DECK_KERB_METRES, webFoot);
    band(DECK_RAILING, -DECK_RAILING_METRES, -DECK_RAILING_METRES + 0.08, 0.02);
    if (!near) return;
    band(DECK_FLANGE, webFoot - 0.14, webFoot, 0.06);
    // A stiffener at the step's first row, and the post over it: one upright strip.
    const t = Math.min(1, 0.12 / Math.hypot(b.x - a.x, b.z - a.z));
    const along = (drop: number): Point => mix(edge(a, drop, 0.05), edge(b, drop, 0.05), t);
    mesh.quad(
      DECK_FLANGE,
      edge(a, webFoot, 0.05),
      along(webFoot),
      along(-DECK_RAILING_METRES),
      edge(a, -DECK_RAILING_METRES, 0.05),
    );
  };
  /** The track from row `a` to row `b`: `metres` of it, starting `from` along the mapped line. */
  const stretch = (a: Row, b: Row, from: number, metres: number): void => {
    const paved = a.onRoad && b.onRoad;
    const span = a.open && b.open;
    // The bed: a shoulder or a wall each side, or an open span's girder, and the crown.
    if (span) {
      fascia(a, b, -1);
      fascia(a, b, 1);
    } else {
      // Over the ground the track is on a grass bank; on it, its ballast's shoulder.
      const side = a.lifted || b.lifted || piece.deck ? EMBANKMENT_GRASS : BALLAST_SHOULDER;
      mesh.quad(side, a.left, b.left, b.footLeft, a.footLeft);
      mesh.quad(side, a.right, b.right, b.footRight, a.footRight);
    }
    mesh.quad(paved ? CROSSING_PANEL : crownColour, a.left, b.left, b.right, a.right);
    // Far off, an open span is its girder and its railing: what is on its deck is over the rider's eye.
    if (span && !near) return;
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
      // An open span's rails are over the rider's eye: one face each, as far off.
      if (near && !span) {
        mesh.quad(
          RAIL_WEB,
          onCrown(a, outer, footLift(a)),
          onCrown(b, outer, footLift(b)),
          onCrown(b, outer, headOf(b)),
          onCrown(a, outer, headOf(a)),
        );
        mesh.quad(
          steel,
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
          steel,
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
      halfWidths.push(Math.max(a.reach, b.reach));
    }
  };
  /**
   * A pier under an open span, `t` of the way from row `a` to row `b`: a
   * battered shaft, wider and stained at its foot, under a paler cap that
   * carries the girder — two faces crossed for each, so it has width from
   * every side. None where the girder is under {@link DECK_PIER_OVER_METRES}
   * over the ground, nor within {@link DECK_PIER_CLEAR_METRES} of the
   * carriageway. Far off it is its shaft alone, up to the girder.
   */
  const pier = (a: Row, b: Row, t: number): void => {
    const x = a.x + (b.x - a.x) * t;
    const z = a.z + (b.z - a.z) * t;
    const crown = Math.min(a.left[1], a.right[1]) * (1 - t) + Math.min(b.left[1], b.right[1]) * t;
    const girder = crown - DECK_KERB_METRES - DECK_GIRDER_METRES;
    const foot = a.under + (b.under - a.under) * t - FOOT_METRES;
    if (girder - foot < DECK_PIER_OVER_METRES) return;
    const distance = a.distance + (b.distance - a.distance) * t;
    if (distance < ROAD_WIDTH_METRES / 2 + DECK_PIER_CLEAR_METRES) return;
    const { ax, az } = a;
    /** Two faces crossed, `across` by `along` at `low` and at `high`. */
    const crossed = (
      low: number,
      high: number,
      widths: readonly [number, number],
      spread: number,
      lowColour: readonly number[],
      highColour: readonly number[],
    ): void => {
      const [across, along] = [widths[0] / 2, widths[1] / 2];
      // Across the track, then along it: its direction is the across direction turned back a quarter.
      for (const [ux, uz, halfWidth] of [
        [ax, az, across],
        [az, -ax, along],
      ] as const) {
        const wide = halfWidth * spread;
        mesh.quad(
          lowColour,
          [x - ux * wide, low, z - uz * wide],
          [x + ux * wide, low, z + uz * wide],
          [x + ux * halfWidth, high, z + uz * halfWidth],
          [x - ux * halfWidth, high, z - uz * halfWidth],
          highColour,
        );
      }
    };
    const shaftTop = near ? girder - DECK_PIER_CAP_METRES[2] : girder;
    crossed(foot, shaftTop, DECK_PIER_METRES, DECK_PIER_BATTER, PIER_FOOT, TRACK_WALL);
    if (near) {
      crossed(
        shaftTop,
        girder,
        [DECK_PIER_CAP_METRES[0], DECK_PIER_CAP_METRES[1]],
        1,
        PIER_CAP,
        PIER_CAP,
      );
    }
  };
  /** The piers under the open span from row `a` to row `b`, the `station`th of the mapped line. */
  const piers = (a: Row, b: Row, station: number): void => {
    if (!a.open || !b.open) return;
    if (piece.overs.length === 0) {
      // A deck that crosses no route: at every sixth station of its line.
      if (station % DECK_PIER_EVERY_STATIONS === 0) pier(a, b, 0);
      return;
    }
    // A bridge over the route: at its stated distances from the crossing, each side.
    for (const out of DECK_PIERS_FROM_CROSSING_METRES) {
      if ((a.over <= out && out < b.over) || (b.over <= out && out < a.over)) {
        pier(a, b, (out - a.over) / (b.over - a.over));
      }
    }
  };
  /**
   * An abutment, where an open span's last row `end` meets the bank that
   * runs on through `bank` — #3253: a short concrete face under the girder's
   * bearing, {@link ABUTMENT_SEAT_METRES} under the track at its foot, with a
   * wing wall each side turned back into the bank; and below that seat the
   * bank comes forward under the span as grass, at the bank's own slope.
   * Where the track is no higher than the seat the face stands in the ground
   * and there is no slope. Far off the face and its wings are one face.
   */
  const abutment = (end: Row, bank: { readonly x: number; readonly z: number }): void => {
    const length = Math.hypot(end.x - bank.x, end.z - bank.z);
    if (!(length > 0)) return;
    // Forward: out of the bank, under the span.
    const ux = (end.x - bank.x) / length;
    const uz = (end.z - bank.z) / length;
    const crown = (end.left[1] + end.right[1]) / 2;
    const top = crown - DECK_KERB_METRES;
    const foot = end.under - FOOT_METRES;
    const at = (across: number, y: number, forward = 0): Point => [
      end.x + end.ax * across + ux * forward,
      y,
      end.z + end.az * across + uz * forward,
    ];
    // How far the bank's front can come forward under the span before it meets the road: the
    // whole width of it, which a bridge that crosses at an angle brings across the road's corner.
    const side = Math.sign(standingAt(ground, end.x, end.z)?.near.lateral ?? 0);
    const keep = ROAD_WIDTH_METRES / 2 + EMBANKMENT_CLEAR_METRES;
    const clearAhead = (run: number): boolean =>
      [-1, -0.5, 0, 0.5, 1].every((share) => {
        const toe = at(share * end.reach, 0, run);
        const stood = standingAt(ground, toe[0], toe[2], end.distance + run + end.reach + 1);
        return (
          stood !== undefined &&
          stood.near.distance >= keep &&
          Math.sign(stood.near.lateral) === side
        );
      });
    let room = EMBANKMENT_MAX_RUN_METRES;
    while (room > 0 && !clearAhead(room)) room -= 1;
    // A face near the road has no room for a slope under the span: it goes down to the ground.
    const seated =
      crown - foot > ABUTMENT_SEAT_METRES + 0.5 &&
      room >=
        Math.min(EMBANKMENT_MAX_RUN_METRES, EMBANKMENT_RUN * (crown - ABUTMENT_SEAT_METRES - foot));
    const seat = seated ? crown - ABUTMENT_SEAT_METRES : foot;
    const cheek = half + ABUTMENT_CHEEK_METRES;
    // Where the bank's side is at the seat's height, so far as it is clear of the road.
    const standsClear = (across: number): boolean => {
      const wing = at(across, 0, -ABUTMENT_WING_BACK_METRES);
      const stood = standingAt(ground, wing[0], wing[2], end.distance + Math.abs(across) + 3);
      return (
        stood !== undefined && stood.near.distance >= keep && Math.sign(stood.near.lateral) === side
      );
    };
    let shoulder = half + EMBANKMENT_RUN * (crown - seat);
    while (shoulder > cheek && !(standsClear(shoulder) && standsClear(-shoulder))) shoulder -= 1;
    shoulder = Math.max(cheek, shoulder);
    if (near) {
      mesh.quad(
        ABUTMENT,
        at(-cheek, top, 0.05),
        at(cheek, top, 0.05),
        at(cheek, seat, 0.05),
        at(-cheek, seat, 0.05),
        PIER_FOOT,
      );
      for (const sign of [-1, 1]) {
        mesh.quad(
          ABUTMENT,
          at(sign * cheek, top, 0.05),
          at(sign * shoulder, seat + 0.3, -ABUTMENT_WING_BACK_METRES),
          at(sign * shoulder, seat, -ABUTMENT_WING_BACK_METRES),
          at(sign * cheek, seat, 0.05),
          PIER_FOOT,
        );
      }
    } else {
      mesh.quad(
        ABUTMENT,
        at(-half, top),
        at(half, top),
        at(shoulder, seat),
        at(-shoulder, seat),
        PIER_FOOT,
      );
    }
    if (!seated) return;
    // The ground under the span is not the ground at the abutment: the front runs out to
    // where it meets it, found in two steps.
    let run = EMBANKMENT_RUN * (seat - foot);
    let ahead = foot;
    for (let pass = 0; pass < 2; pass += 1) {
      const toe = at(0, 0, run);
      const stood = standingAt(ground, toe[0], toe[2], end.distance + run + 1);
      ahead = (stood?.ground ?? end.under) - FOOT_METRES;
      run = Math.min(EMBANKMENT_MAX_RUN_METRES, room, Math.max(0, EMBANKMENT_RUN * (seat - ahead)));
    }
    mesh.quad(
      EMBANKMENT_GRASS,
      at(-shoulder, seat),
      at(shoulder, seat),
      at(end.reach, ahead, run),
      at(-end.reach, ahead, run),
    );
    if (!near) return;
    // The corner each side, between the bank's side and its front.
    for (const [sign, low] of [
      [-1, end.footLeft],
      [1, end.footRight],
    ] as const) {
      const corner = at(sign * end.reach, ahead, run);
      mesh.quad(EMBANKMENT_GRASS, at(sign * shoulder, seat), low, corner, corner);
    }
  };
  const spanEnd = piece.span === undefined ? 0 : piece.span.fromMetres + piece.span.metres;
  const startsSpan = piece.span !== undefined && piece.fromMetres === piece.span.fromMetres;
  const endsSpan =
    piece.span !== undefined &&
    Math.abs(piece.fromMetres + (count - 1) * RAIL_TRACK_STEP_METRES - spanEnd) < 0.01;
  let cuts = 0;
  let a = rowAt(0);
  for (let index = 1; index < count; index += 1) {
    const b = rowAt(index);
    if (a !== undefined && b !== undefined) {
      piers(a, b, Math.round(piece.fromMetres / RAIL_TRACK_STEP_METRES) + index - 1);
      if (a.open !== b.open) abutment(a.open ? a : b, a.open ? b : a);
      // A bridge mapped shorter than its open span ends where the mapped span does.
      if (index === 1 && startsSpan && a.open && a.over <= DECK_SPAN_HALF_METRES) {
        abutment(a, { x: 2 * a.x - b.x, z: 2 * a.z - b.z });
      }
      if (index === count - 1 && endsSpan && b.open && b.over <= DECK_SPAN_HALF_METRES) {
        abutment(b, { x: 2 * b.x - a.x, z: 2 * b.z - a.z });
      }
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
      const here = drawnRoadPosition(profile, origin, junction.along);
      signs =
        // A disused line's crossing keeps its rails in the road and stands no sign.
        track.disusedAt(here.x, here.z)
          ? null
          : (crossingFurniture(
              junction,
              track.corridor.railCrossings ?? [],
              profile,
              origin,
              seed,
              land,
            ) ?? null);
      byJunction.set(junction, signs);
    }
    if (signs !== null) roads.push(signs);
  }
  chosen.set(track, { land, profile, at, roads });
  return roads;
}
