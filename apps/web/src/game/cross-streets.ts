// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cross streets — #1565: the side roads that join the route, drawn a short way
 * off it at their junctions, with a give-way line at each mouth.
 *
 * ## Where a junction is
 *
 * - **Mapped** ({@link mappedJunctions}): from #1539's corridor, the `roads`
 *   features #1544's decoder keeps as streets since #1565
 *   (`@onyourleft/map-features` §`STREET_KINDS`). Each street is resampled every
 *   {@link SIDE_ROAD_STEP_METRES}; a point is ON the route when it lies within
 *   {@link JUNCTION_TOLERANCE_METRES} of ANY stretch of the drawn road
 *   (`road-grid.ts` §`nearestOnDrawnRoad`). Wherever a street leaves the route
 *   — an on point followed by an off one, either way along the street — an
 *   ARM leaves there: a T is one arm, a crossroads two. An arm is kept only if
 *   it runs at least {@link SIDE_ROAD_MIN_METRES} off the route and its heading
 *   is at least {@link JUNCTION_MIN_ANGLE_DEGREES} from the road's, either way:
 *   a street that runs ALONG the route — the route's own street, mapped — is
 *   never a side road. Arms within {@link JUNCTION_MERGE_METRES} of each other
 *   along the route are one junction, and two arms of it on the same side
 *   within {@link ARM_SAME_DEGREES} of each other (a street split at the
 *   junction's node) are one arm.
 * - **Procedural** ({@link villageJunction}): one crossroads at the centre of
 *   every procedural village (`settlements.ts` §`Site`), square to the road,
 *   so that the world with no map data (ADR 0054 D-4) has them too. The plots
 *   either side of it are empty (`settlements.ts` §`everyVillagePlot`).
 *
 * A junction records its distance along the route, its sides and each arm's
 * angle — degrees from the road's forward direction to the arm's, so 90 is
 * square and a T leaning forward is under 90.
 *
 * ## What is drawn
 *
 * Each arm is a strip {@link SIDE_ROAD_METRES} long from the main road's edge,
 * at its width class ({@link SIDE_ROAD_WIDTHS}), along the mapped line (a
 * village's is straight). Its mouth is cut along the main road's edge, so it
 * neither covers the carriageway nor leaves a gap. It stands
 * {@link SIDE_ROAD_LIFT_METRES} above the ground (`landform.ts`
 * §`terrainHeightAt`), and leaves the main road's height over
 * {@link SIDE_ROAD_RAMP_METRES} rather than dropping the verge's 0.25 m at
 * once, with a skirt down to the ground along that stretch. ⚠️ **It fades by
 * going under the ground**: over its last {@link SIDE_ROAD_FADE_METRES} it
 * sinks to {@link SIDE_ROAD_SINK_METRES} below it, and the ground covers it —
 * no transparency, so it costs no sorting and shares the road's own material
 * (`three-renderer.ts` §`SideRoadBelt`): the photograph, #628's wear and
 * the stylised road's grain, with no texture of its own. A **give-way line**
 * — two broken lines across the arm — stands at its mouth.
 *
 * An arm stops early where it would run on water (`waterways.ts` §`inWater`),
 * onto another stretch of the route, or off the land that was read.
 *
 * ## ⚠️ What may not stand on one
 *
 * {@link clearOfSideRoads} takes every scatter item and structure off a side
 * road in view, and {@link boardsClearOfSideRoads} every billboard; a
 * village's pavement is broken at its crossroads with a dropped kerb either
 * side (`streets.ts`). A mapped building is #1540's, which reads
 * {@link onSideRoad} when it lands.
 *
 * ⚠️ **Location data** (ADR 0004 D): nothing here formats a message. It reads
 * a street's `kind`, `kindDetail` and line, and never a name, which #1544
 * never decodes.
 *
 * Pure, built once a corridor or a village and cached, and names no rendering
 * library.
 */

import { distanceOnRoute, elevationAt, type RouteProfile } from '@onyourleft/domain';
import type { StreetFeature } from '@onyourleft/map-features';

import { NO_LAND_CLASS, type LandClassMask } from './land-class';
import { terrainHeightAt, VERGE_DROP_METRES } from './landform';
import { nearestOnDrawnRoad, type NearestOnRoad } from './road-grid';
import type { ScatterItem } from './scatter';
import {
  siteAt,
  siteOnMappedLand,
  siteSpacing,
  STRUCTURE_FOOTPRINTS,
  VILLAGE_METRES,
  PLOT_METRES,
  type Footprint,
  type Site,
} from './settlements';
import {
  drawnRoadFrame,
  MARKING_COLOUR,
  roadTint,
  ROAD_WIDTH_METRES,
  type CorridorOrigin,
} from './terrain';
import { inWater, waterways } from './waterways';
import type { WorldCorridor } from './world-data/corridor';

/** Half the main carriageway, in metres: **3.5**. */
const ROAD_HALF_WIDTH_METRES = ROAD_WIDTH_METRES / 2;

/** How long a side road is drawn, from the main road's edge, in metres: **60**. */
export const SIDE_ROAD_METRES = 60;

/** How far apart a side road's cross-sections are, and a street is resampled, in metres: **2**. */
export const SIDE_ROAD_STEP_METRES = 2;

/** How near the drawn road a street's point is ON the route, in metres: **8**. @see the header */
export const JUNCTION_TOLERANCE_METRES = 8;

/** An arm whose heading is within this many degrees of the road's, either way, is not one: **30**. */
export const JUNCTION_MIN_ANGLE_DEGREES = 30;

/** Arms within this many metres of each other along the route are one junction: **12**. */
export const JUNCTION_MERGE_METRES = 12;

/** Two arms of one junction on one side within this many degrees are one arm: **20**. */
export const ARM_SAME_DEGREES = 20;

/** An arm that runs less than this far off the route, in metres, is not drawn: **10**. */
export const SIDE_ROAD_MIN_METRES = 10;

/** How far above the ground a side road stands, in metres: **0.03**. */
export const SIDE_ROAD_LIFT_METRES = 0.03;

/** Over how many metres from its mouth a side road comes down from the main road's height: **6**. */
export const SIDE_ROAD_RAMP_METRES = 6;

/** The last this many metres of a side road go under the ground: **20**. @see the header */
export const SIDE_ROAD_FADE_METRES = 20;

/** How far below the ground a side road's far end is, in metres: **0.3**. */
export const SIDE_ROAD_SINK_METRES = 0.3;

/** A side road's width class, from its mapped `kind` and `kind_detail`. */
export type WidthClass = 'highway' | 'major' | 'minor' | 'service';

/**
 * How wide each class is drawn, in metres: a highway **9**, a major road the
 * main road's **7**, a minor road **5.5**, a service road or an alley **3.5**.
 */
export const SIDE_ROAD_WIDTHS: Readonly<Record<WidthClass, number>> = {
  highway: 9,
  major: ROAD_WIDTH_METRES,
  minor: 5.5,
  service: 3.5,
};

/** The `kind_detail` values that make a minor street a service road. */
const SERVICE_DETAILS: readonly string[] = [
  'service',
  'alley',
  'driveway',
  'parking_aisle',
  'drive-through',
  'emergency_access',
];

/** The width class of a mapped street. */
export function widthClassOf(street: Pick<StreetFeature, 'kind' | 'kindDetail'>): WidthClass {
  if (street.kind === 'highway') return 'highway';
  if (street.kind === 'major_road') return 'major';
  return SERVICE_DETAILS.includes(street.kindDetail) ? 'service' : 'minor';
}

/**
 * The most junctions one route keeps: **4 000**, in route order. A street
 * network is an imported file's; past this the route has no more cross
 * streets rather than an unbounded list.
 */
export const MAX_JUNCTIONS = 4_000;

/** One side road leaving a junction. */
export interface SideRoadArm {
  /** `+1` on the road's normal (the rider's right), `−1` the other. */
  readonly side: 1 | -1;
  /** Degrees from the road's forward direction to the arm's, 0 to 180. */
  readonly angleDegrees: number;
  readonly widthClass: WidthClass;
  /** Its centreline from the junction on the route outwards, `x0, z0, x1, z1, …`, local metres. */
  readonly line: Float32Array;
}

/** Where a side road or two meet the route. */
export interface Junction {
  /** The route distance of the junction, on the first lap. */
  readonly along: number;
  readonly source: 'mapped' | 'village';
  readonly arms: readonly SideRoadArm[];
}

/**
 * One junction's side roads as triangles, in the corridor's local metres:
 * what `three-renderer.ts` §`SideRoadBelt` merges and draws in the road's own
 * material. `colours` are linear, as `terrain.ts` §`RoadCorridor.colours` are;
 * `across` is how far across its arm a vertex is, which #628's wear reads as
 * it reads the main road's.
 */
export interface SideRoadMesh {
  readonly positions: Float32Array;
  readonly colours: Float32Array;
  readonly across: Float32Array;
  readonly indices: Uint32Array;
}

/** A junction in view and its mesh: what a frame carries (`SceneFrame.sideRoads`). */
export interface SideRoad {
  readonly junction: Junction;
  readonly mesh: SideRoadMesh;
  /** Each arm's centreline segments, for the clearances. Four floats a segment. */
  readonly segments: Float32Array;
  /** Each segment's half-width, one float a segment. */
  readonly halfWidths: Float32Array;
}

// --- Mapped junctions ----------------------------------------------------

/** A street's points every {@link SIDE_ROAD_STEP_METRES}, its own vertices kept. */
function resampled(line: Float32Array): number[] {
  const out: number[] = [];
  for (let at = 0; at + 1 < line.length; at += 2) {
    const ax = line[at] as number;
    const az = line[at + 1] as number;
    if (!Number.isFinite(ax) || !Number.isFinite(az)) return out;
    if (at === 0) out.push(ax, az);
    if (at + 3 >= line.length) break;
    const bx = line[at + 2] as number;
    const bz = line[at + 3] as number;
    if (!Number.isFinite(bx) || !Number.isFinite(bz)) return out;
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / SIDE_ROAD_STEP_METRES));
    for (let step = 1; step <= steps; step += 1) {
      out.push(ax + ((bx - ax) * step) / steps, az + ((bz - az) * step) / steps);
    }
  }
  return out;
}

/** How far out an arm's heading is read, in metres: **15**, past a junction's own kerb radius. */
const HEADING_METRES = 15;

/** A candidate arm, before arms are grouped into junctions. */
interface Candidate {
  readonly along: number;
  readonly arm: SideRoadArm;
  readonly metres: number;
}

/** The road's frame at `along`: where, and its forward and normal directions. */
function roadAt(
  profile: RouteProfile,
  origin: CorridorOrigin,
  along: number,
): { x: number; z: number; forwardX: number; forwardZ: number; normalX: number; normalZ: number } {
  const frame = drawnRoadFrame(profile, origin, along);
  if (frame === undefined) {
    return { x: 0, z: 0, forwardX: 0, forwardZ: 1, normalX: -1, normalZ: 0 };
  }
  // The heading is the normal turned back a quarter (`terrain.ts` §`drawnRoadFrame`).
  return {
    x: frame.x,
    z: frame.z,
    forwardX: frame.normalZ,
    forwardZ: -frame.normalX,
    normalX: frame.normalX,
    normalZ: frame.normalZ,
  };
}

/** Whether a point is on another stretch of the route than the one at `along`. */
function onOtherStretch(
  near: NearestOnRoad | undefined,
  along: number,
  profile: RouteProfile,
): boolean {
  if (near === undefined) return false;
  const gap = Math.abs(near.along - along);
  const wrapped = profile.loop ? Math.min(gap, profile.totalDistance - gap) : gap;
  return wrapped > SIDE_ROAD_METRES;
}

/**
 * The arm leaving the route at `points[start]`, along the street in
 * direction `step` (`+2` or `−2` floats), or `undefined` where it is no arm.
 *
 * Its heading is the street's own, from the last point on the route to the
 * point {@link HEADING_METRES} past it; its junction is where that heading,
 * produced back, meets the drawn road's centreline — not the last point on
 * the route, which a street leaving at 60° passes 4 m further on.
 */
function armFrom(
  points: readonly number[],
  start: number,
  step: number,
  street: StreetFeature,
  corridor: WorldCorridor,
  profile: RouteProfile,
  origin: CorridorOrigin,
  seed: number,
): Candidate | undefined {
  const x0 = points[start] as number;
  const z0 = points[start + 1] as number;
  const leaves = nearestOnDrawnRoad(profile, origin, x0, z0, JUNCTION_TOLERANCE_METRES);
  if (leaves === undefined) return undefined;
  const ways = waterways(profile, seed);
  const outward: number[] = [];
  let metres = 0;
  let px = x0;
  let pz = z0;
  let headingX = 0;
  let headingZ = 0;
  for (let at = start + step; at >= 0 && at + 1 < points.length; at += step) {
    const x = points[at] as number;
    const z = points[at + 1] as number;
    if (!corridor.covered(x, z)) break;
    const near = nearestOnDrawnRoad(profile, origin, x, z, SIDE_ROAD_METRES + 20);
    // Back onto the route, onto another stretch of it, or into water: the arm ends.
    if (near !== undefined && near.distance <= JUNCTION_TOLERANCE_METRES) break;
    if (near !== undefined && near.distance < 15 && onOtherStretch(near, leaves.along, profile)) {
      break;
    }
    if (near !== undefined && inWater(ways, profile, near.along, near.lateral)) break;
    metres += Math.hypot(x - px, z - pz);
    outward.push(x, z);
    px = x;
    pz = z;
    if (headingX === 0 && headingZ === 0 && metres >= HEADING_METRES) {
      headingX = x - x0;
      headingZ = z - z0;
    }
    if (metres >= SIDE_ROAD_METRES + SIDE_ROAD_STEP_METRES) break;
  }
  if (metres < SIDE_ROAD_MIN_METRES) return undefined;
  if (headingX === 0 && headingZ === 0) {
    headingX = px - x0;
    headingZ = pz - z0;
  }
  const length = Math.hypot(headingX, headingZ);
  if (!(length > 0)) return undefined;
  const dx = headingX / length;
  const dz = headingZ / length;
  const there = roadAt(profile, origin, leaves.along);
  const cosine = dx * there.forwardX + dz * there.forwardZ;
  const angleDegrees = (Math.acos(Math.max(-1, Math.min(1, cosine))) * 180) / Math.PI;
  if (
    angleDegrees < JUNCTION_MIN_ANGLE_DEGREES ||
    angleDegrees > 180 - JUNCTION_MIN_ANGLE_DEGREES
  ) {
    return undefined;
  }
  // Back along the heading to the centreline: `lateral` falls by `rate` a metre.
  const rate = dx * there.normalX + dz * there.normalZ;
  const back = leaves.lateral / rate;
  const meets = nearestOnDrawnRoad(
    profile,
    origin,
    x0 - dx * back,
    z0 - dz * back,
    JUNCTION_TOLERANCE_METRES + Math.abs(back),
  );
  const along = meets?.along ?? leaves.along;
  const road = roadAt(profile, origin, along);
  const side = rate >= 0 ? 1 : -1;
  return {
    along,
    metres,
    arm: {
      side,
      angleDegrees,
      widthClass: widthClassOf(street),
      line: Float32Array.from([road.x, road.z, x0, z0, ...outward]),
    },
  };
}

/** Candidates within {@link JUNCTION_MERGE_METRES} of the first, as junctions, in route order. */
function grouped(candidates: Candidate[]): Junction[] {
  candidates.sort((a, b) => a.along - b.along);
  const junctions: Junction[] = [];
  let group: Candidate[] = [];
  const close = (): void => {
    if (group.length === 0) return;
    const kept: Candidate[] = [];
    for (const candidate of [...group].sort((a, b) => b.metres - a.metres)) {
      const twin = kept.some(
        (other) =>
          other.arm.side === candidate.arm.side &&
          Math.abs(other.arm.angleDegrees - candidate.arm.angleDegrees) < ARM_SAME_DEGREES,
      );
      if (!twin) kept.push(candidate);
    }
    kept.sort((a, b) => a.arm.side - b.arm.side || a.arm.angleDegrees - b.arm.angleDegrees);
    const along = kept.reduce((sum, candidate) => sum + candidate.along, 0) / kept.length;
    junctions.push({ along, source: 'mapped', arms: kept.map((candidate) => candidate.arm) });
    group = [];
  };
  for (const candidate of candidates) {
    if (
      group.length > 0 &&
      candidate.along - (group[0] as Candidate).along > JUNCTION_MERGE_METRES
    ) {
      close();
    }
    if (junctions.length >= MAX_JUNCTIONS) break;
    group.push(candidate);
  }
  if (junctions.length < MAX_JUNCTIONS) close();
  return junctions;
}

/** One corridor's junctions, kept with the profile they were found against. */
const junctionsFound = new WeakMap<
  WorldCorridor,
  { profile: RouteProfile; junctions: readonly Junction[] }
>();

/**
 * Every junction where a mapped street meets the route, in route order — #1565.
 * Built once per corridor, the same array after. @see the header
 */
export function mappedJunctions(
  corridor: WorldCorridor,
  profile: RouteProfile,
  origin: CorridorOrigin,
  seed: number,
): readonly Junction[] {
  const cached = junctionsFound.get(corridor);
  if (cached?.profile === profile) return cached.junctions;
  const candidates: Candidate[] = [];
  for (const street of corridor.streets) {
    const points = resampled(street.line);
    const count = points.length / 2;
    if (count < 2) continue;
    const on = new Uint8Array(count);
    for (let index = 0; index < count; index += 1) {
      const x = points[index * 2] as number;
      const z = points[index * 2 + 1] as number;
      on[index] =
        corridor.covered(x, z) &&
        nearestOnDrawnRoad(profile, origin, x, z, JUNCTION_TOLERANCE_METRES) !== undefined
          ? 1
          : 0;
    }
    for (let index = 0; index < count; index += 1) {
      if (on[index] !== 1) continue;
      for (const direction of [1, -1] as const) {
        const next = index + direction;
        if (next < 0 || next >= count || on[next] === 1) continue;
        const arm = armFrom(
          points,
          index * 2,
          direction * 2,
          street,
          corridor,
          profile,
          origin,
          seed,
        );
        if (arm !== undefined) candidates.push(arm);
      }
    }
  }
  const junctions = grouped(candidates);
  junctionsFound.set(corridor, { profile, junctions });
  return junctions;
}

// --- A village's crossroads -----------------------------------------------

/**
 * A procedural village's crossroads — #1565: at its centre, one arm each
 * side, square to the road, a minor road's width, {@link SIDE_ROAD_METRES}
 * and the main road's half-width long.
 */
export function villageJunction(
  profile: RouteProfile,
  origin: CorridorOrigin,
  site: Site,
): Junction {
  const along: number = distanceOnRoute(profile, site.centre);
  const road = roadAt(profile, origin, along);
  const reach = ROAD_HALF_WIDTH_METRES + SIDE_ROAD_METRES;
  const arms = ([-1, 1] as const).map((side): SideRoadArm => {
    const line: number[] = [];
    for (let out = 0; out <= reach + 1e-9; out += SIDE_ROAD_STEP_METRES) {
      line.push(road.x + road.normalX * side * out, road.z + road.normalZ * side * out);
    }
    return { side, angleDegrees: 90, widthClass: 'minor', line: Float32Array.from(line) };
  });
  return { along, source: 'village', arms };
}

/** How far past a side road's edge a pavement stops at its mouth, in metres: **0.5**. */
const MOUTH_MARGIN_METRES = 0.5;

/**
 * Half the span of road a village's crossroads takes from the pavement on
 * either side, in metres: **3.25** — a minor road's half-width and
 * {@link MOUTH_MARGIN_METRES}. `streets.ts` breaks the pavement over it.
 */
export const VILLAGE_MOUTH_HALF_METRES = SIDE_ROAD_WIDTHS.minor / 2 + MOUTH_MARGIN_METRES;

// --- The mesh -------------------------------------------------------------

/** Linear-light from an sRGB byte, `terrain.ts`' transfer function. */
function linear(byte: number): number {
  const proportion = byte / 255;
  return proportion <= 0.04045 ? proportion / 12.92 : Math.pow((proportion + 0.055) / 1.055, 2.4);
}

function linearColour(packed: number): readonly [number, number, number] {
  return [linear((packed >> 16) & 0xff), linear((packed >> 8) & 0xff), linear(packed & 0xff)];
}

/** The side road's tarmac: the level road's own tint. */
const TARMAC = linearColour(roadTint(0));

/** Its give-way line: the main road's paint, which #628's wear reads as paint. */
const PAINT = linearColour(MARKING_COLOUR);

/** A give-way line's two broken lines: how far out from the first section, in metres, and how deep. */
const GIVE_WAY_LINES_METRES = [0.4, 0.9] as const;
const GIVE_WAY_DEPTH_METRES = 0.2;
/** Each dash across the arm, and the gap after it, in metres: **0.6** and **0.3**. */
const GIVE_WAY_DASH_METRES = 0.6;
const GIVE_WAY_GAP_METRES = 0.3;
/** How far above the side road its paint stands, in metres: **0.012**. */
const PAINT_LIFT_METRES = 0.012;
/** How far below the ground a skirt reaches, in metres. */
const SKIRT_FOOT_METRES = 0.05;

/**
 * The most triangles one arm can be: **120** — the mouth's row and a row
 * every {@link SIDE_ROAD_STEP_METRES} of {@link SIDE_ROAD_METRES} after it,
 * 32 rows and so 31 quads (62); a skirt each side under the rows within
 * {@link SIDE_ROAD_RAMP_METRES} of the mouth, four quads a side (16); and a
 * highway's give-way line, two lines of ten dashes (40); with one quad (2)
 * for the rounding of the last row. A mapped arm's mouth slid at an acute
 * angle starts its rows further out, which only removes rows.
 * `cross-streets.test.ts` builds the heaviest arms and holds them under this.
 */
export const SIDE_ROAD_TRIANGLES_PER_ARM = 120;

/**
 * The most arms a frame draws: **24**, nearest the rider first — a junction
 * every 40 m of a 460 m view, both sides, is 23. So a frame's side roads are
 * at most **2 880** triangles ({@link SIDE_ROAD_FRAME_TRIANGLES}), the same in
 * both worlds, and ONE draw call.
 */
export const SIDE_ROADS_PER_FRAME = 24;

/**
 * The most triangles a frame's side roads add: **2 880**, in either world.
 * ⚠️ **Outside `realistic-budget.ts` §`REALISTIC_FRAME_TRIANGLES`, by that
 * constant's own rule**, as the pavements are: they are the SAME triangles in
 * both worlds.
 *
 * @test-facing held by `cross-streets.test.ts` and `three-renderer.test.ts`
 * §"#1565", which counts the belt's own mesh
 */
export const SIDE_ROAD_FRAME_TRIANGLES = SIDE_ROADS_PER_FRAME * SIDE_ROAD_TRIANGLES_PER_ARM;

/** Triangles, growing. */
class MeshBuilder {
  readonly positions: number[] = [];
  readonly colours: number[] = [];
  readonly across: number[] = [];
  readonly indices: number[] = [];

  vertex(x: number, y: number, z: number, colour: readonly number[], across: number): number {
    this.positions.push(x, y, z);
    this.colours.push(colour[0] as number, colour[1] as number, colour[2] as number);
    this.across.push(across);
    return this.positions.length / 3 - 1;
  }

  /** Two triangles over `a b c d`, a quad in order round its edge. Wound both ways is not needed: the road is double-sided. */
  quad(a: number, b: number, c: number, d: number): void {
    this.indices.push(a, b, c, a, c, d);
  }

  done(): SideRoadMesh {
    return {
      positions: Float32Array.from(this.positions),
      colours: Float32Array.from(this.colours),
      across: Float32Array.from(this.across),
      indices: Uint32Array.from(this.indices),
    };
  }
}

/** A point along a polyline, by arc length, and its direction there. */
interface Station {
  readonly x: number;
  readonly z: number;
  readonly dx: number;
  readonly dz: number;
}

function stationAt(line: Float32Array, metres: number): Station {
  let travelled = 0;
  for (let at = 0; at + 3 < line.length; at += 2) {
    const ax = line[at] as number;
    const az = line[at + 1] as number;
    const bx = line[at + 2] as number;
    const bz = line[at + 3] as number;
    const length = Math.hypot(bx - ax, bz - az);
    if (!(length > 0)) continue;
    const isLast = at + 5 >= line.length;
    if (travelled + length >= metres || isLast) {
      const t = (metres - travelled) / length;
      return {
        x: ax + (bx - ax) * t,
        z: az + (bz - az) * t,
        dx: (bx - ax) / length,
        dz: (bz - az) / length,
      };
    }
    travelled += length;
  }
  return { x: line[0] as number, z: line[1] as number, dx: 0, dz: 1 };
}

function lineMetres(line: Float32Array): number {
  let total = 0;
  for (let at = 0; at + 3 < line.length; at += 2) {
    total += Math.hypot(
      (line[at + 2] as number) - (line[at] as number),
      (line[at + 3] as number) - (line[at + 1] as number),
    );
  }
  return total;
}

/**
 * The height a side road's vertex stands at: the ground under it and the
 * lift, never under the main road's height less the verge's drop spread over
 * {@link SIDE_ROAD_RAMP_METRES}, and sunk over the last
 * {@link SIDE_ROAD_FADE_METRES}. `out` is how far from the mouth.
 */
function heightAt(
  profile: RouteProfile,
  origin: CorridorOrigin,
  seed: number,
  x: number,
  z: number,
  out: number,
): { readonly y: number; readonly ground: number } {
  const near = nearestOnDrawnRoad(profile, origin, x, z, SIDE_ROAD_METRES + 40);
  if (near === undefined) return { y: SIDE_ROAD_LIFT_METRES, ground: 0 };
  const ground = terrainHeightAt(profile, origin, seed, near.along, near.lateral);
  const road = elevationAt(profile, distanceOnRoute(profile, near.along)) - origin.elevation;
  const ramp = Math.min(
    1,
    Math.max(0, (Math.abs(near.lateral) - ROAD_HALF_WIDTH_METRES) / SIDE_ROAD_RAMP_METRES),
  );
  let y = Math.max(
    ground + SIDE_ROAD_LIFT_METRES,
    road + SIDE_ROAD_LIFT_METRES - VERGE_DROP_METRES * ramp,
  );
  const fading = (out - (SIDE_ROAD_METRES - SIDE_ROAD_FADE_METRES)) / SIDE_ROAD_FADE_METRES;
  if (fading > 0) {
    const share = Math.min(1, fading);
    y =
      ground +
      SIDE_ROAD_LIFT_METRES -
      (SIDE_ROAD_LIFT_METRES + SIDE_ROAD_SINK_METRES) * share * share * (3 - 2 * share);
  }
  return { y, ground };
}

/**
 * How far along an arm's centreline its mouth is: where the centreline
 * leaves the main carriageway, in metres from the junction.
 */
function mouthMetres(
  profile: RouteProfile,
  origin: CorridorOrigin,
  line: Float32Array,
  length: number,
): number {
  for (let metres = 0; metres <= length; metres += 0.25) {
    const at = stationAt(line, metres);
    const near = nearestOnDrawnRoad(profile, origin, at.x, at.z, ROAD_HALF_WIDTH_METRES + 1);
    if (near === undefined || near.distance >= ROAD_HALF_WIDTH_METRES) return metres;
  }
  return length;
}

/** One arm into `mesh`, and its centreline segments into `segments`. */
function armMesh(
  mesh: MeshBuilder,
  segments: number[],
  halfWidths: number[],
  arm: SideRoadArm,
  profile: RouteProfile,
  origin: CorridorOrigin,
  seed: number,
): void {
  const half = SIDE_ROAD_WIDTHS[arm.widthClass] / 2;
  const length = lineMetres(arm.line);
  const mouth = mouthMetres(profile, origin, arm.line, length);
  const end = Math.min(length, mouth + SIDE_ROAD_METRES);
  if (end - mouth < SIDE_ROAD_MIN_METRES) return;
  const first = stationAt(arm.line, mouth);
  // Across the arm: its direction turned a quarter.
  const acrossOf = (station: Station): readonly [number, number] => [station.dz, -station.dx];
  // The mouth's two corners, each slid along the arm onto the main road's edge.
  const [fx, fz] = acrossOf(first);
  const corner = (sign: 1 | -1): { x: number; z: number; slide: number } => {
    let x = first.x + fx * half * sign;
    let z = first.z + fz * half * sign;
    let slide = 0;
    for (let pass = 0; pass < 4; pass += 1) {
      const near = nearestOnDrawnRoad(profile, origin, x, z, ROAD_HALF_WIDTH_METRES + half + 10);
      if (near === undefined) break;
      const frame = roadAt(profile, origin, near.along);
      const rate = Math.abs(first.dx * frame.normalX + first.dz * frame.normalZ);
      if (!(rate > 0.2)) break;
      const move = (ROAD_HALF_WIDTH_METRES - near.distance) / rate;
      if (Math.abs(move) < 0.01) break;
      x += first.dx * move;
      z += first.dz * move;
      slide += move;
    }
    return { x, z, slide };
  };
  const left = corner(-1);
  const right = corner(1);
  const regular = mouth + Math.max(0, left.slide, right.slide) + 0.5;
  type Row = {
    readonly l: number;
    readonly r: number;
    readonly out: number;
    readonly station: Station;
  };
  const rows: Row[] = [];
  const row = (
    station: Station,
    out: number,
    l?: { x: number; z: number },
    r?: { x: number; z: number },
  ): Row => {
    const [ax, az] = acrossOf(station);
    const lx = l?.x ?? station.x - ax * half;
    const lz = l?.z ?? station.z - az * half;
    const rx = r?.x ?? station.x + ax * half;
    const rz = r?.z ?? station.z + az * half;
    const lh = heightAt(profile, origin, seed, lx, lz, out);
    const rh = heightAt(profile, origin, seed, rx, rz, out);
    return {
      l: mesh.vertex(lx, lh.y, lz, TARMAC, -half),
      r: mesh.vertex(rx, rh.y, rz, TARMAC, half),
      out,
      station,
    };
  };
  rows.push(row(first, 0, left, right));
  let metres = regular;
  for (; metres <= end + 1e-9; metres += SIDE_ROAD_STEP_METRES) {
    rows.push(row(stationAt(arm.line, metres), metres - mouth));
  }
  // The last row at the stated length exactly, however short its step.
  if (metres - SIDE_ROAD_STEP_METRES < end - 0.01)
    rows.push(row(stationAt(arm.line, end), end - mouth));
  for (let index = 0; index + 1 < rows.length; index += 1) {
    const a = rows[index] as Row;
    const b = rows[index + 1] as Row;
    mesh.quad(a.l, b.l, b.r, a.r);
    segments.push(a.station.x, a.station.z, b.station.x, b.station.z);
    halfWidths.push(half);
    // A skirt down to the ground each side, where the arm stands above it.
    if (a.out <= SIDE_ROAD_RAMP_METRES) {
      for (const [ta, tb, sign] of [
        [a.l, b.l, -1],
        [a.r, b.r, 1],
      ] as const) {
        const p = mesh.positions;
        const footA =
          heightAt(profile, origin, seed, p[ta * 3] as number, p[ta * 3 + 2] as number, a.out)
            .ground - SKIRT_FOOT_METRES;
        const footB =
          heightAt(profile, origin, seed, p[tb * 3] as number, p[tb * 3 + 2] as number, b.out)
            .ground - SKIRT_FOOT_METRES;
        const fa = mesh.vertex(
          p[ta * 3] as number,
          footA,
          p[ta * 3 + 2] as number,
          TARMAC,
          sign * half,
        );
        const fb = mesh.vertex(
          p[tb * 3] as number,
          footB,
          p[tb * 3 + 2] as number,
          TARMAC,
          sign * half,
        );
        mesh.quad(ta, tb, fb, fa);
      }
    }
  }
  // The give-way line: two broken lines across the arm, just past its mouth.
  for (const offset of GIVE_WAY_LINES_METRES) {
    const near = stationAt(arm.line, regular + offset);
    const far = stationAt(arm.line, regular + offset + GIVE_WAY_DEPTH_METRES);
    const [ax, az] = acrossOf(near);
    for (
      let from = -half + 0.15;
      from + GIVE_WAY_DASH_METRES <= half - 0.15 + 1e-9;
      from += GIVE_WAY_DASH_METRES + GIVE_WAY_GAP_METRES
    ) {
      const to = from + GIVE_WAY_DASH_METRES;
      const corners = [
        [near.x + ax * from, near.z + az * from],
        [far.x + ax * from, far.z + az * from],
        [far.x + ax * to, far.z + az * to],
        [near.x + ax * to, near.z + az * to],
      ] as const;
      const ids = corners.map(([x, z], index) =>
        mesh.vertex(
          x,
          heightAt(profile, origin, seed, x, z, regular + offset - mouth).y + PAINT_LIFT_METRES,
          z,
          PAINT,
          index < 2 ? from : to,
        ),
      );
      mesh.quad(ids[0] as number, ids[1] as number, ids[2] as number, ids[3] as number);
    }
  }
}

/** Every junction's side roads, built on first sight. */
const built = new WeakMap<Junction, SideRoad>();

/** A junction's side roads: its mesh and its clearance segments, built once. */
function sideRoadOf(
  junction: Junction,
  profile: RouteProfile,
  origin: CorridorOrigin,
  seed: number,
): SideRoad {
  const known = built.get(junction);
  if (known !== undefined) return known;
  const mesh = new MeshBuilder();
  const segments: number[] = [];
  const halfWidths: number[] = [];
  for (const arm of junction.arms) armMesh(mesh, segments, halfWidths, arm, profile, origin, seed);
  const road: SideRoad = {
    junction,
    mesh: mesh.done(),
    segments: Float32Array.from(segments),
    halfWidths: Float32Array.from(halfWidths),
  };
  built.set(junction, road);
  return road;
}

/** Every village's crossroads of each route, by its site on the first lap. */
const villages = new WeakMap<RouteProfile, Map<number, Junction>>();

/**
 * Every side road whose junction lies within the odometer span
 * `[fromMetres, toMetres)`, widened by {@link SIDE_ROAD_METRES} — the mapped
 * ones from `mapped`, and a crossroads at every procedural village not on
 * mapped land (`settlements.ts` §`siteOnMappedLand`, the rule its houses
 * obey). Each once however many laps the span covers, the nearest
 * {@link SIDE_ROADS_PER_FRAME} arms' junctions to `riderMetres` and no more,
 * and the same objects every call.
 */
export function sideRoadsAt(
  profile: RouteProfile,
  origin: CorridorOrigin,
  seed: number,
  fromMetres: number,
  toMetres: number,
  riderMetres: number,
  mapped: readonly Junction[] = [],
  land: LandClassMask = NO_LAND_CLASS,
): readonly SideRoad[] {
  const from = fromMetres - SIDE_ROAD_METRES;
  const to = toMetres + SIDE_ROAD_METRES;
  const total: number = profile.totalDistance;
  const found: { junction: Junction; gap: number }[] = [];
  const consider = (junction: Junction): void => {
    if (found.some((entry) => entry.junction === junction)) return;
    // The lap of the span this junction falls in, if any.
    const laps = profile.loop && total > 0 ? Math.floor(from / total) : 0;
    const last = profile.loop && total > 0 ? Math.floor(to / total) : 0;
    for (let lap = laps; lap <= last; lap += 1) {
      const at = junction.along + lap * total;
      if (at >= from && at < to) {
        found.push({ junction, gap: Math.abs(at - riderMetres) });
        return;
      }
    }
  };
  for (const junction of mapped) consider(junction);
  const { sites, span } = siteSpacing(profile);
  const reach = VILLAGE_METRES / 2 + PLOT_METRES;
  const first = Math.floor((fromMetres - reach) / span);
  const lastSite = Math.min(Math.floor((toMetres + reach) / span), first + sites + 1);
  let known = villages.get(profile);
  if (known === undefined) {
    known = new Map();
    villages.set(profile, known);
  }
  for (let index = first; index <= lastSite; index += 1) {
    const site = siteAt(profile, seed, index);
    if (site === undefined || site.kind !== 'village') continue;
    if (siteOnMappedLand(profile, origin, site, land)) continue;
    let junction = known.get(site.wrappedSite);
    if (junction === undefined) {
      junction = villageJunction(profile, origin, site);
      known.set(site.wrappedSite, junction);
    }
    consider(junction);
  }
  found.sort((a, b) => a.gap - b.gap);
  const roads: SideRoad[] = [];
  let arms = 0;
  for (const { junction } of found) {
    if (arms + junction.arms.length > SIDE_ROADS_PER_FRAME) break;
    arms += junction.arms.length;
    roads.push(sideRoadOf(junction, profile, origin, seed));
  }
  // In route order, so a frame's list is stable while the same junctions are in view.
  roads.sort((a, b) => a.junction.along - b.junction.along);
  return roads;
}

// --- Clearance -----------------------------------------------------------

/** The squared distance from a point to a segment. */
function squaredToSegment(
  x: number,
  z: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): number {
  const dx = bx - ax;
  const dz = bz - az;
  const span = dx * dx + dz * dz;
  const t = span > 0 ? Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / span)) : 0;
  const ox = x - (ax + dx * t);
  const oz = z - (az + dz * t);
  return ox * ox + oz * oz;
}

/**
 * Whether a footprint standing at `at` comes within `margin` of any side
 * road in `roads` — its box sampled every half-metre round its edge and
 * through its middle, against each arm's centreline less its half-width.
 */
export function onSideRoad(
  roads: readonly SideRoad[],
  at: { readonly x: number; readonly z: number; readonly rotation: number },
  footprint: Footprint,
  margin: number,
): boolean {
  if (roads.length === 0) return false;
  const cos = Math.cos(at.rotation);
  const sin = Math.sin(at.rotation);
  // The footprint's own frame: `x` across, `z` the way it faces.
  const points: number[] = [];
  const stepsX = Math.max(1, Math.ceil((2 * footprint.x) / 0.5));
  const stepsZ = Math.max(1, Math.ceil((footprint.front - footprint.back) / 0.5));
  for (let i = 0; i <= stepsX; i += 1) {
    for (let j = 0; j <= stepsZ; j += 1) {
      if (i !== 0 && i !== stepsX && j !== 0 && j !== stepsZ && j !== Math.floor(stepsZ / 2))
        continue;
      const lx = -footprint.x + (2 * footprint.x * i) / stepsX;
      const lz = footprint.back + ((footprint.front - footprint.back) * j) / stepsZ;
      points.push(at.x + lx * cos + lz * sin, at.z - lx * sin + lz * cos);
    }
  }
  const reach = Math.hypot(footprint.x, Math.max(-footprint.back, footprint.front)) + margin + 10;
  for (const road of roads) {
    const s = road.segments;
    for (let segment = 0; segment * 4 + 3 < s.length; segment += 1) {
      const ax = s[segment * 4] as number;
      const az = s[segment * 4 + 1] as number;
      const bx = s[segment * 4 + 2] as number;
      const bz = s[segment * 4 + 3] as number;
      const clear = (road.halfWidths[segment] as number) + margin;
      // A cheap reject: the segment's middle further than it could reach.
      if (Math.hypot((ax + bx) / 2 - at.x, (az + bz) / 2 - at.z) > reach + SIDE_ROAD_STEP_METRES)
        continue;
      for (let p = 0; p + 1 < points.length; p += 2) {
        if (
          squaredToSegment(points[p] as number, points[p + 1] as number, ax, az, bx, bz) <
          clear * clear
        ) {
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * How far off a side road's edge nothing scattered may stand, in metres:
 * **1.5** — a trunk and a little verge.
 */
export const SIDE_ROAD_SCENERY_MARGIN_METRES = 1.5;

/** How far off a side road's edge no structure's footprint may come, in metres: **0.5**. */
export const SIDE_ROAD_STRUCTURE_MARGIN_METRES = 0.5;

/** A point: what a tree, a shrub or a rock is measured as. */
const POINT: Footprint = { x: 0, back: 0, front: 0 };

/**
 * `items`, less every one standing on a side road in view: a structure by
 * its whole footprint (`settlements.ts` §`STRUCTURE_FOOTPRINTS`), anything
 * else by where it stands, {@link SIDE_ROAD_SCENERY_MARGIN_METRES} clear.
 * The same array where there is no side road.
 */
export function clearOfSideRoads(
  items: readonly ScatterItem[],
  roads: readonly SideRoad[],
): readonly ScatterItem[] {
  if (roads.length === 0) return items;
  return items.filter((item) => {
    const footprint = (STRUCTURE_FOOTPRINTS as Readonly<Record<string, Footprint>>)[item.kind];
    return footprint === undefined
      ? !onSideRoad(roads, item, POINT, SIDE_ROAD_SCENERY_MARGIN_METRES)
      : !onSideRoad(roads, item, footprint, SIDE_ROAD_STRUCTURE_MARGIN_METRES);
  });
}

/** `boards`, less every one whose footprint stands on a side road in view. */
export function boardsClearOfSideRoads<
  Board extends { readonly x: number; readonly z: number; readonly rotation: number },
>(boards: readonly Board[], roads: readonly SideRoad[], footprint: Footprint): readonly Board[] {
  if (roads.length === 0) return boards;
  return boards.filter(
    (board) => !onSideRoad(roads, board, footprint, SIDE_ROAD_STRUCTURE_MARGIN_METRES),
  );
}
