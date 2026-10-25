// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A village's street — #1535: a kerb and a pavement beside the road, on each
 * side of a village that has a house on it.
 *
 * ## What was wrong
 *
 * A village (`settlements.ts`, #460) was houses set back from a country road
 * whose grass verge ran straight through it: nothing said "street". Owner,
 * 2026-10-21 (#1533): *"Possibly some areas with city buildings, sidewalks in
 * areas."*
 *
 * ## ⚠️ Where a pavement goes — from the route, the seed and the layout only
 *
 * No map data: ADR 0032 D-1 still stands (#1533's phase A). A pavement is laid
 * along a side of a village exactly where that side's BUILT plots are, from
 * `settlements.ts` §`siteAt` and §`villagePlots` — the same decision the houses
 * are placed from, never a copy of it — from {@link PAVEMENT_END_INSET_METRES}
 * inside the first built plot's boundary to as far inside the last's. A side
 * with no house on it has no pavement, a farmstead has none (it is a farm, not
 * a street), and nothing outside a village has any. "A house" means a plot
 * `villagePlots` marks built: `structuresAt` may still drop that house for
 * clearance or the realistic budget, leaving its pavement without it.
 *
 * Its cross-section, from the road outwards:
 *
 * - a **kerb face**, {@link KERB_HEIGHT_METRES} high, standing on the road's
 *   own edge (`terrain.ts` §`ROAD_WIDTH_METRES` / 2) — the carriageway is never
 *   narrowed and never covered, and the road's surface and #628's wear are the
 *   road's mesh, untouched;
 * - the **pavement**, {@link PAVEMENT_WIDTH_METRES} wide, level with the kerb's
 *   top;
 * - a **back face** down to {@link PAVEMENT_FOOTING_METRES} below the road, so
 *   the verge `landform.ts` drops beside the road (0.25 m) never shows a gap
 *   under it.
 *
 * ## ⚠️ Never on the carriageway, never on water
 *
 * Sampled every {@link PAVEMENT_STEP_METRES} along the DRAWN road
 * (`terrain.ts` §`drawnRoadFrame`, the frame `settlements.ts` stands its
 * buildings in), and a sample is dropped — breaking the strip there — when:
 *
 * - any of its three edges comes within the road's half-width of ANY stretch of
 *   the drawn road (`road-grid.ts` §`distanceToDrawnRoad`), the rule
 *   `settlements.ts` §`structureClearance` holds a house to, at the
 *   carriageway's edge rather than the verge's because a kerb stands ON that
 *   edge. A hairpin's other leg, or the inside of a bend tighter than a village
 *   is built on, loses its pavement there rather than gaining one in the road;
 * - its middle stands in water or on a bank (`waterways.ts` §`inWater`).
 *
 * ## Where the map was read — #1551
 *
 * A {@link PavementSides} from `footways.ts` overrides the side rule, and only
 * the side rule, at every section whose stretch of road was read: there a
 * side has a pavement exactly where a sidewalk is mapped beside it, anywhere
 * along the village's street (the span from its first built plot on either
 * side to its last), and neither side has one where none is mapped. Where the
 * stretch was not read (`unknown`) the rule above stands. A village none of
 * whose street was read is laid by exactly the code it was before, so with
 * {@link NO_PAVEMENT_DATA} every street is byte-identical to #1535's. Covered
 * land can only move a pavement from one side of a village's street to the
 * other, or remove it: its cost is still a village's.
 *
 * ## Cost, and why it is computed once
 *
 * A pavement is fixed in the corridor's frame (one origin a ride), so each
 * village's street is built once per route and kept in a `WeakMap` keyed on
 * the profile OBJECT — `waterways.ts` §`computed`'s argument, and its pattern.
 * Origin and seed are not part of the key: both are derived from the profile in
 * production, as `waterways.ts` assumes of its seed.
 * A frame carries the streets in view by reference, and the renderer rebuilds
 * its one mesh only when that set changes. A 180 m village with both sides
 * built is about 2 × 92 samples, six vertices and six triangles a sample: about
 * 1 100 vertices and 1 100 triangles — `three-renderer.ts` §`PavementBelt`
 * draws every street in view in ONE call.
 *
 * ## A path to each front door — #1564
 *
 * Each built plot whose pavement is laid in front of it gets one short paved
 * path, {@link DOOR_PATH_WIDTH_METRES} wide, from just under the pavement's
 * back edge straight to its building's front door, on the plot's own side
 * ({@link DoorPath}). The door is read off the very plan the renderer draws
 * the building from (`buildings.ts` §`buildingPlan`): of its doors in a wall
 * turned to the road, the one nearest the middle — a house's only one, the
 * church tower's, and a row of shops' middle shop. A path follows the ground
 * {@link DOOR_PATH_LIFT_METRES} above it, leaves the pavement's top no faster
 * than {@link DOOR_PATH_FALL} a metre, and has a skirt down into the ground
 * along both edges so no gap shows under it.
 *
 * A plot gets none where its side's pavement is not laid in front of the
 * door, or where any section of the path would be on ANY stretch of the
 * carriageway or in water. "Built" is #1535's: a plot `villagePlots` marks
 * built, whose house `structuresAt` may still drop for clearance or the
 * budget, leaving its path as it leaves its pavement. The paths are part of
 * the street, so they are drawn in the pavements' ONE call, in their paving;
 * and they lie inside the
 * plot's cleared ground (`settlements.ts` §`SettlementFootprint` reaches from
 * the centreline past the house), so no tree, shrub or rock stands on one.
 *
 * ## Where people walk — #1541
 *
 * Each unbroken run of pavement carries the line a person walks along it,
 * {@link WALK_FROM_KERB_METRES} out from the kerb on the pavement's top
 * ({@link VillageStreet.walks}), and each front path its middle
 * ({@link DoorPath.walk}). `people.ts` walks them; nothing here places a
 * person.
 *
 * Pure, and names no rendering library.
 */

import { distanceOnRoute, elevationAt, type RouteProfile } from '@onyourleft/domain';

import { frontDoorOf, isBuiltKind } from './buildings';
import { VILLAGE_MOUTH_HALF_METRES } from './cross-streets';
import { villageAnchors, type DecorationAnchor, type DoorOfPlot } from './decorations';
import { NO_PAVEMENT_DATA, type PavementSide, type PavementSides } from './footways';
import { terrainHeightAt } from './landform';
import { distanceToDrawnRoad, nearestOnDrawnRoad } from './road-grid';
import { NO_LAND_CLASS, type LandClassMask } from './land-class';
import {
  PLOT_METRES,
  siteAt,
  siteOnMappedLand,
  siteSpacing,
  villagePlots,
  VILLAGE_METRES,
  type Plot,
} from './settlements';
import { drawnRoadFrame, ROAD_WIDTH_METRES, type CorridorOrigin } from './terrain';
import { inWater, waterways } from './waterways';

/** How far from the centreline the kerb's face stands, in metres: the road's own edge, **3.5**. */
export const KERB_LATERAL_METRES = ROAD_WIDTH_METRES / 2;

/** How high the kerb stands above the road, in metres: **0.12** — a common kerb's upstand. */
export const KERB_HEIGHT_METRES = 0.12;

/** How wide the pavement is, kerb included, in metres: **2**. */
export const PAVEMENT_WIDTH_METRES = 2;

/**
 * How far below the road the pavement's back face reaches, in metres:
 * **0.45** — past the verge's 0.25 m drop (`landform.ts` §`VERGE_DROP_METRES`)
 * with room to spare, so no gap shows under its outer edge.
 */
export const PAVEMENT_FOOTING_METRES = 0.45;

/**
 * How high the kerb stands at a dropped kerb, in metres: **0.02** — #1565:
 * where a village's pavement meets its crossroads
 * (`cross-streets.ts` §`villageJunction`), it is broken over the side road's
 * mouth and its kerb dropped over the {@link DROPPED_KERB_METRES} either side,
 * flush enough to cross.
 */
export const DROPPED_KERB_HEIGHT_METRES = 0.02;

/** How far from a side road's mouth a pavement's kerb is dropped, in metres: **2**, one section. */
export const DROPPED_KERB_METRES = 2;

/** How far apart a pavement's cross-sections are along the road, at most, in metres: **2**. */
export const PAVEMENT_STEP_METRES = 2;

/**
 * How far inside the first and last built plots' boundaries a pavement stops,
 * in metres: **1** — so it never reaches the signposts at a village's ways in,
 * which stand on the verge half a plot beyond its last plot.
 */
export const PAVEMENT_END_INSET_METRES = 1;

/**
 * The most triangles one village's street can be: **1 184**. Each side at its
 * longest — every plot built, {@link VILLAGE_METRES} and a plot, less the two
 * insets — is 98 steps of six triangles (the kerb's face, the top and the
 * back, two each) and its two ends; a section dropped takes twelve and its
 * break adds four, so a broken strip is never heavier. The SAME triangles in
 * both worlds, which is why `realistic-budget.ts` §`REALISTIC_FRAME_TRIANGLES`
 * does not count them, by its own rule for the corridor and the terrain; a
 * frame holds two villages at most (one ending, the next beginning, 700 m
 * apart against a 460 m view), so 2 368.
 *
 * @test-facing held by `streets.test.ts`
 */
export const PAVEMENT_TRIANGLES_PER_VILLAGE =
  2 *
  (6 *
    Math.ceil(
      (VILLAGE_METRES + PLOT_METRES - 2 * PAVEMENT_END_INSET_METRES) / PAVEMENT_STEP_METRES,
    ) +
    4);

/**
 * One village's pavements, as triangles in the corridor's local metres.
 *
 * `uvs` are in METRES of the surface — along the road and across it on the
 * top, along and up on the two faces and across and up on the ends — so a
 * renderer divides by its photograph's own size and a flag is the same size
 * everywhere.
 */
export interface PavementMesh {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly uvs: Float32Array;
  readonly indices: Uint32Array;
}

/**
 * What stands on a pavement — #1536: a lamp post, a bollard, a bench and a
 * bin. Each is one instanced draw (`three-renderer.ts` §`FurnitureBelt`).
 */
export type FurnitureKind = 'lamp-post' | 'bollard' | 'bench' | 'bin';

/** Every {@link FurnitureKind}, in a fixed order. */
export const FURNITURE_KINDS: readonly FurnitureKind[] = ['lamp-post', 'bollard', 'bench', 'bin'];

/**
 * One piece of street furniture, standing on the pavement's top in the
 * corridor's local metres, turned so its own +z faces the road.
 */
export interface FurnitureItem {
  readonly kind: FurnitureKind;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Yaw, radians: three's, so a shape's +z ends up facing the road. */
  readonly rotation: number;
}

/**
 * How far apart lamp posts stand along an unbroken run of pavement, in
 * metres: **24** — the first and last half that from its ends, so they are
 * spaced evenly about the run's middle and never among the bollards.
 */
export const LAMP_SPACING_METRES = 24;

/** How far in from the pavement's back edge a lamp post stands, in metres: **0.35**. */
export const LAMP_SETBACK_METRES = 0.35;

/** How far out from the kerb's face a bollard stands, in metres: **0.35**. */
export const BOLLARD_INSET_METRES = 0.35;

/**
 * Where the bollards stand at each end of a run, in metres in from the end:
 * **0.6** and **1.8** — a pair, where a pavement meets a road with none.
 */
export const BOLLARD_ENDS_METRES = [0.6, 1.8] as const;

/** How far in from the pavement's back edge a bench stands, in metres: **0.45**. */
export const BENCH_SETBACK_METRES = 0.45;

/** How far along from its bench a bin stands, in metres: **1.6**. */
export const BIN_BESIDE_METRES = 1.6;

/**
 * How far from the camera street furniture is drawn, in metres: **120** —
 * #1536's level of detail. A lamp post is 6 cm across and a bollard 20 cm, a
 * pixel or two at that distance on the tablet's screen and less under the
 * fog, so beyond it nothing is drawn at all; nearer, every piece is.
 */
export const FURNITURE_DRAW_METRES = 120;

/** How wide a front path is, in metres: **1.2** — a door's metre and a little either side. */
export const DOOR_PATH_WIDTH_METRES = 1.2;

/** How far above the ground a front path stands, in metres: **0.03** — a side road's lift. */
export const DOOR_PATH_LIFT_METRES = 0.03;

/**
 * How fast a front path may fall from the pavement's top towards the ground,
 * in metres a metre: **0.25** — so the kerb's 0.12 m and the verge's 0.25 m
 * drop (`landform.ts` §`VERGE_DROP_METRES`) are taken over about a metre and
 * a half, rather than as a step down off the pavement's back.
 */
export const DOOR_PATH_FALL = 0.25;

/** How far a front path's sections are apart, at most, in metres: **1**. */
const DOOR_PATH_STEP_METRES = 1;

/**
 * How far under the pavement's back edge a front path starts, in metres:
 * **0.3** — so a bend, where the pavement's edge and the path's square end
 * part a little, leaves no grass between them.
 */
const DOOR_PATH_UNDER_PAVEMENT_METRES = 0.3;

/** How far below the ground a front path's skirts reach, in metres: **0.1**. */
const DOOR_PATH_SKIRT_METRES = 0.1;

/**
 * The longest front path laid, in metres: **8** — a church's, the furthest
 * door from the pavement (`settlements.ts` §`CHURCH_SETBACK_METRES` less its
 * tower's reach, 7.8 m at most); a longer one is not laid, so the bound below
 * holds by construction.
 */
const DOOR_PATH_MOST_METRES = 8;

/**
 * The most triangles one village's front paths can be: **960** — every plot
 * but the two at its crossroads built (`settlements.ts` §`everyVillagePlot`),
 * each path at its longest, {@link DOOR_PATH_MOST_METRES} in
 * {@link DOOR_PATH_STEP_METRES} sections of six triangles (its top and its two
 * skirts). Two villages in a frame at most: 1 920.
 *
 * @test-facing held by `streets.test.ts`
 */
export const DOOR_PATH_TRIANGLES_PER_VILLAGE =
  (2 * (Math.floor(VILLAGE_METRES / PLOT_METRES) + 1) - 2) *
  6 *
  Math.ceil(DOOR_PATH_MOST_METRES / DOOR_PATH_STEP_METRES);

/** One front path — #1564: the plot it leads into, and its triangles. */
export interface DoorPath {
  /** Its plot's middle, on the odometer of the lap the street was built on, and its side. */
  readonly along: number;
  readonly side: 1 | -1;
  readonly mesh: PavementMesh;
  /**
   * #1541: the path's middle, from the pavement to the door, on its top — `x,
   * y, z` a section, corridor frame — which a person may walk.
   */
  readonly walk: Float32Array;
}

/**
 * How far out from the kerb's face a person walks a pavement, in metres:
 * **0.9** — #1541: inside the pavement's 2 m, clear of the bollards at 0.35
 * and of the lamp posts and benches at its back.
 */
export const WALK_FROM_KERB_METRES = 0.9;

/** One village's street: which village, where along the road, its pavements and what stands on them. */
export interface VillageStreet {
  /** The village's site on the route's first lap: one street per place, whichever lap. */
  readonly wrappedSite: number;
  /** Where its pavements start and end, on the odometer of the lap they were found on. */
  readonly from: number;
  readonly to: number;
  readonly pavement: PavementMesh;
  /** #1536: the lamp posts, bollards, benches and bins on its pavements, and nowhere else. */
  readonly furniture: readonly FurnitureItem[];
  /** #1564: a path from the pavement to each built plot's front door, in plot order. */
  readonly doorPaths: readonly DoorPath[];
  /**
   * #1541: each unbroken run of its pavements as the line a person walks —
   * {@link WALK_FROM_KERB_METRES} out from the kerb, on the pavement's top,
   * `x, y, z` a section, corridor frame.
   */
  readonly walks: readonly Float32Array[];
  /**
   * #1624: where a holiday's decorations may stand in this village — its
   * lamp posts, doorsteps, eaves and crossroads green, never its church
   * plot (`decorations.ts` §`villageAnchors`). Built with the street, once.
   */
  readonly anchors: readonly DecorationAnchor[];
}

/** One village's street, or `null` where its site has no village or no pavement. */
type Known = VillageStreet | null;

/**
 * Every street of each route, by site, built on first sight — per
 * {@link PavementSides} and land-class mask, both of which a ride fixes when
 * it starts: since #1564 a street's front paths stand on the ground the mask
 * levels. @see the header
 */
const built = new WeakMap<
  LandClassMask,
  WeakMap<PavementSides, WeakMap<RouteProfile, Map<number, Known>>>
>();

/**
 * Every village street whose pavements overlap the odometer span
 * `[fromMetres, toMetres)`, each once however many laps of a loop the span
 * covers. The same objects every call, so a renderer can tell "the same
 * streets" from "different ones" by identity.
 */
export function streetsAt(
  profile: RouteProfile,
  origin: CorridorOrigin,
  seed: number,
  fromMetres: number,
  toMetres: number,
  sides: PavementSides = NO_PAVEMENT_DATA,
  land: LandClassMask = NO_LAND_CLASS,
): readonly VillageStreet[] {
  const { sites, span } = siteSpacing(profile);
  const reach = VILLAGE_METRES / 2 + PLOT_METRES;
  const first = Math.floor((fromMetres - reach) / span);
  // Never more sites than the route has — `settlements.ts` §`settlementsAt`'s bound.
  const last = Math.min(Math.floor((toMetres + reach) / span), first + sites + 1);
  let byLand = built.get(land);
  if (byLand === undefined) {
    byLand = new WeakMap();
    built.set(land, byLand);
  }
  let bySides = byLand.get(sides);
  if (bySides === undefined) {
    bySides = new WeakMap();
    byLand.set(sides, bySides);
  }
  let known = bySides.get(profile);
  if (known === undefined) {
    known = new Map();
    bySides.set(profile, known);
  }
  const found: VillageStreet[] = [];
  for (let index = first; index <= last; index += 1) {
    const site = siteAt(profile, seed, index);
    if (site === undefined || site.kind !== 'village') continue;
    // #1546: a village not built on mapped land has no street either.
    if (siteOnMappedLand(profile, origin, site, land)) continue;
    let street = known.get(site.wrappedSite);
    if (street === undefined) {
      street = streetOf(profile, origin, seed, site.wrappedSite, index, sides, land);
      known.set(site.wrappedSite, street);
    }
    if (street === null || found.includes(street)) continue;
    // Where THIS lap's copy of it lies on the odometer.
    const lap = (index - site.wrappedSite) * span;
    if (street.from + lap < toMetres && street.to + lap >= fromMetres) found.push(street);
  }
  return found;
}

/** The street of the village at `site` (unwrapped `index`), or `null` if it has no pavement. */
function streetOf(
  profile: RouteProfile,
  origin: CorridorOrigin,
  seed: number,
  wrappedSite: number,
  index: number,
  sides: PavementSides,
  land: LandClassMask,
): Known {
  const site = siteAt(profile, seed, index);
  if (site === undefined) return null;
  const { span } = siteSpacing(profile);
  // Built on the first lap's odometer, whichever lap it was first seen from.
  const lap = (index - wrappedSite) * span;
  const plots = villagePlots(seed, site);
  const mesh = new MeshBuilder();
  const furniture: FurnitureItem[] = [];
  const walks: Float32Array[] = [];
  let from = Number.POSITIVE_INFINITY;
  let to = Number.NEGATIVE_INFINITY;
  const spans = ([1, -1] as const).map((side) => {
    const mine = plots.filter((plot) => plot.side === side).map((plot) => plot.along - lap);
    return mine.length === 0
      ? undefined
      : {
          start: Math.min(...mine) - PLOT_METRES / 2 + PAVEMENT_END_INSET_METRES,
          end: Math.max(...mine) + PLOT_METRES / 2 - PAVEMENT_END_INSET_METRES,
        };
  });
  const street = streetSpan(spans);
  if (street === undefined) return null;
  // #1565: the village's crossroads, at its centre, on this lap's odometer.
  const mouth = {
    from: site.centre - lap - VILLAGE_MOUTH_HALF_METRES,
    to: site.centre - lap + VILLAGE_MOUTH_HALF_METRES,
  };
  // #1551: whether any of the street's road was read. @see the header
  const read = wasRead(sides, street.start, street.end);
  const ways = waterways(profile, seed);
  const doorPaths: DoorPath[] = [];
  const doors: DoorOfPlot[] = [];
  for (const [at, side] of ([1, -1] as const).entries()) {
    const own = spans[at];
    let laid: boolean;
    let range: { readonly start: number; readonly end: number };
    let allowed: (along: number) => boolean = () => true;
    if (!read) {
      if (own === undefined) continue;
      range = own;
      laid = lay(
        mesh,
        furniture,
        profile,
        origin,
        seed,
        side,
        own.start,
        own.end,
        undefined,
        [mouth],
        walks,
      );
    } else {
      range = street;
      allowed = (along: number): boolean => {
        const here = sides.sideAt(along);
        if (here === 'unknown') return own !== undefined && along >= own.start && along <= own.end;
        return onSide(here, side);
      };
      laid = lay(
        mesh,
        furniture,
        profile,
        origin,
        seed,
        side,
        street.start,
        street.end,
        allowed,
        [mouth],
        walks,
      );
    }
    if (laid) {
      from = Math.min(from, read || own === undefined ? street.start : own.start);
      to = Math.max(to, read || own === undefined ? street.end : own.end);
      // #1564: wherever this side's pavement is laid in front of a door, a path to it.
      const paved = (along: number): boolean =>
        along >= range.start &&
        along <= range.end &&
        allowed(along) &&
        sectionAt(profile, origin, ways, side, along, false) !== undefined;
      for (const plot of plots) {
        if (plot.side !== side) continue;
        const path = doorPathOf(profile, origin, seed, ways, plot, lap, paved, land);
        if (path !== undefined) {
          doorPaths.push(path);
          doors.push({ plot, path });
        }
      }
    }
  }
  if (mesh.triangles === 0) return null;
  const anchors = villageAnchors(profile, origin, seed, site, doors, furniture, land);
  return { wrappedSite, from, to, pavement: mesh.done(), furniture, doorPaths, walks, anchors };
}

/**
 * The front path of one built plot — #1564 — or `undefined` where it gets
 * none. `lap` turns the plot's odometer into the street's; `paved` says
 * whether the side's pavement is laid at a reading of the street's. @see the
 * header
 */
function doorPathOf(
  profile: RouteProfile,
  origin: CorridorOrigin,
  seed: number,
  ways: ReturnType<typeof waterways>,
  plot: Plot,
  lap: number,
  paved: (along: number) => boolean,
  land: LandClassMask,
): DoorPath | undefined {
  if (!isBuiltKind(plot.kind)) return undefined;
  const door = frontDoorOf(plot.kind, plot.variant);
  if (door === null) return undefined;
  // The building as `settlements.ts` §`standing` places it: on the plot's
  // frame, `lateral` out on its side, turned to face the road.
  const frame = drawnRoadFrame(profile, origin, distanceOnRoute(profile, plot.along));
  if (frame === undefined) return undefined;
  const faceX = -frame.normalX * plot.side;
  const faceZ = -frame.normalZ * plot.side;
  const house = {
    x: frame.x + frame.normalX * plot.side * plot.lateral,
    z: frame.z + frame.normalZ * plot.side * plot.lateral,
  };
  // A yaw about y takes building-local +z to the face and +x to (faceZ, −faceX).
  const rightX = faceZ;
  const rightZ = -faceX;
  const doorX = house.x + rightX * door.x + faceX * door.z;
  const doorZ = house.z + rightZ * door.x + faceZ * door.z;
  const length =
    plot.lateral -
    door.z -
    (KERB_LATERAL_METRES + PAVEMENT_WIDTH_METRES - DOOR_PATH_UNDER_PAVEMENT_METRES);
  if (!(length > 0) || length > DOOR_PATH_MOST_METRES) return undefined;
  // From the pavement end, `s` = 0, to the door, `s` = `length`.
  const startX = doorX + faceX * length;
  const startZ = doorZ + faceZ * length;
  const mouth = nearestOnDrawnRoad(profile, origin, startX, startZ, PAVEMENT_WIDTH_METRES * 4);
  if (mouth === undefined || !paved(mouth.along)) return undefined;
  const pavementTop =
    elevationAt(profile, distanceOnRoute(profile, mouth.along)) -
    origin.elevation +
    KERB_HEIGHT_METRES;
  const steps = Math.ceil(length / DOOR_PATH_STEP_METRES);
  const half = DOOR_PATH_WIDTH_METRES / 2;
  const sections: PathSection[] = [];
  for (let step = 0; step <= steps; step += 1) {
    const s = (length * step) / steps;
    const x = startX - faceX * s;
    const z = startZ - faceZ * s;
    const near = nearestOnDrawnRoad(profile, origin, x, z, plot.lateral + PLOT_METRES);
    // Never on ANY stretch of the carriageway, never in water.
    if (near === undefined || near.distance < KERB_LATERAL_METRES) return undefined;
    if (inWater(ways, profile, near.along, near.lateral)) return undefined;
    const ground = terrainHeightAt(profile, origin, seed, near.along, near.lateral, land);
    const y = Math.max(
      ground + DOOR_PATH_LIFT_METRES,
      pavementTop - DOOR_PATH_LIFT_METRES - DOOR_PATH_FALL * s,
    );
    sections.push({
      s,
      leftX: x - rightX * half,
      leftZ: z - rightZ * half,
      rightX: x + rightX * half,
      rightZ: z + rightZ * half,
      y,
      foot: Math.min(y, ground) - DOOR_PATH_SKIRT_METRES,
    });
  }
  const mesh = new MeshBuilder();
  mesh.path(sections, { x: rightX, z: rightZ });
  // #1541: its middle, which a person walks.
  const walk = new Float32Array(sections.length * 3);
  sections.forEach((section, at) => {
    walk[at * 3] = (section.leftX + section.rightX) / 2;
    walk[at * 3 + 1] = section.y;
    walk[at * 3 + 2] = (section.leftZ + section.rightZ) / 2;
  });
  return { along: plot.along - lap, side: plot.side, mesh: mesh.done(), walk };
}

/**
 * The front path {@link streetsAt} would lay for `plot` (on the route's first
 * lap), where `paved` says the pavement is laid — by default everywhere.
 *
 * @test-facing `streets.test.ts` lays one across a stream and over a
 * hairpin's other leg, where the rules have something to refuse, which no
 * village a fixture builds reaches; a ride's paths come from
 * {@link streetsAt}, by the same function.
 */
export function doorPathFor(
  profile: RouteProfile,
  origin: CorridorOrigin,
  seed: number,
  plot: Plot,
  paved: (along: number) => boolean = () => true,
): DoorPath | undefined {
  return doorPathOf(profile, origin, seed, waterways(profile, seed), plot, 0, paved, NO_LAND_CLASS);
}

/** One cross-section of a front path: its two edges, its top and its skirts' foot. */
interface PathSection {
  /** Metres from the pavement end. */
  readonly s: number;
  readonly leftX: number;
  readonly leftZ: number;
  readonly rightX: number;
  readonly rightZ: number;
  readonly y: number;
  readonly foot: number;
}

/** The whole street: from the first side's start to the last side's end. */
function streetSpan(
  spans: readonly ({ start: number; end: number } | undefined)[],
): { start: number; end: number } | undefined {
  let start = Number.POSITIVE_INFINITY;
  let end = Number.NEGATIVE_INFINITY;
  for (const span of spans) {
    if (span === undefined) continue;
    start = Math.min(start, span.start);
    end = Math.max(end, span.end);
  }
  return start <= end ? { start, end } : undefined;
}

/** Whether any section {@link lay} would take from `start` to `end` is on road that was read. */
function wasRead(sides: PavementSides, start: number, end: number): boolean {
  if (sides === NO_PAVEMENT_DATA) return false;
  const steps = Math.max(1, Math.ceil((end - start) / PAVEMENT_STEP_METRES));
  for (let step = 0; step <= steps; step += 1) {
    if (sides.sideAt(start + ((end - start) * step) / steps) !== 'unknown') return true;
  }
  return false;
}

/** Whether a mapped `here` puts a pavement on `side` (+1 the road's normal, its right). */
function onSide(here: PavementSide, side: 1 | -1): boolean {
  return here === 'both' || here === (side === 1 ? 'right' : 'left');
}

/**
 * A pavement on `side` of the road from `start` to `end` (odometer), with
 * every rule a village's obeys, or `undefined` where none of it may stand.
 *
 * @test-facing `streets.test.ts` lays one along a hairpin and across a stream,
 * where the rules have something to refuse; a ride's pavements come from
 * {@link streetsAt}, which lays them by the same function.
 */
export function pavementAlong(
  profile: RouteProfile,
  origin: CorridorOrigin,
  seed: number,
  side: 1 | -1,
  start: number,
  end: number,
): PavementMesh | undefined {
  const mesh = new MeshBuilder();
  return lay(mesh, [], profile, origin, seed, side, start, end) ? mesh.done() : undefined;
}

/**
 * The street furniture {@link pavementAlong}'s pavement would carry.
 *
 * @test-facing `streets.test.ts` furnishes a hairpin's and a stream's
 * pavements, where a run is refused or broken; a ride's comes from
 * {@link streetsAt}, by the same function.
 */
export function furnitureAlong(
  profile: RouteProfile,
  origin: CorridorOrigin,
  seed: number,
  side: 1 | -1,
  start: number,
  end: number,
): readonly FurnitureItem[] {
  const furniture: FurnitureItem[] = [];
  lay(new MeshBuilder(), furniture, profile, origin, seed, side, start, end);
  return furniture;
}

/** One cross-section of a pavement: where its three edges are, and which way is along. */
interface Section {
  readonly along: number;
  readonly innerX: number;
  readonly innerZ: number;
  readonly outerX: number;
  readonly outerZ: number;
  /** The road's height here: the kerb's foot. */
  readonly y: number;
  /** How high the kerb stands here: {@link KERB_HEIGHT_METRES}, or dropped beside a mouth (#1565). */
  readonly kerb: number;
  /** Out from the road, on this side. */
  readonly outX: number;
  readonly outZ: number;
}

/**
 * Lays one side's pavement from `start` to `end` (odometer), as strips broken
 * wherever a section is dropped, and furnishes each strip (#1536). Whether any
 * strip was laid.
 */
function lay(
  mesh: MeshBuilder,
  furniture: FurnitureItem[],
  profile: RouteProfile,
  origin: CorridorOrigin,
  seed: number,
  side: 1 | -1,
  start: number,
  end: number,
  allowed: (along: number) => boolean = () => true,
  mouths: readonly { readonly from: number; readonly to: number }[] = [],
  walks: Float32Array[] = [],
): boolean {
  const ways = waterways(profile, seed);
  // #1565: no pavement over a side road's mouth, and a dropped kerb beside it.
  const inMouth = (along: number): boolean =>
    mouths.some((mouth) => along >= mouth.from && along <= mouth.to);
  const besideMouth = (along: number): boolean =>
    mouths.some(
      (mouth) =>
        along >= mouth.from - DROPPED_KERB_METRES && along <= mouth.to + DROPPED_KERB_METRES,
    );
  const steps = Math.max(1, Math.ceil((end - start) / PAVEMENT_STEP_METRES));
  const before = mesh.triangles;
  let run: Section[] = [];
  const close = (): void => {
    if (run.length >= 2) {
      mesh.strip(run, side);
      furnish(run, furniture);
      walks.push(walkOf(run));
    }
    run = [];
  };
  for (let step = 0; step <= steps; step += 1) {
    const along = start + ((end - start) * step) / steps;
    const section =
      allowed(along) && !inMouth(along)
        ? sectionAt(profile, origin, ways, side, along, besideMouth(along))
        : undefined;
    if (section === undefined) close();
    else run.push(section);
  }
  close();
  return mesh.triangles > before;
}

/** The cross-section at `along`, or `undefined` where a pavement may not stand. */
function sectionAt(
  profile: RouteProfile,
  origin: CorridorOrigin,
  ways: ReturnType<typeof waterways>,
  side: 1 | -1,
  along: number,
  dropped: boolean,
): Section | undefined {
  const wrapped = distanceOnRoute(profile, along);
  const frame = drawnRoadFrame(profile, origin, wrapped);
  if (frame === undefined) return undefined;
  const middle = KERB_LATERAL_METRES + PAVEMENT_WIDTH_METRES / 2;
  if (inWater(ways, profile, wrapped, middle * side)) return undefined;
  const outX = frame.normalX * side;
  const outZ = frame.normalZ * side;
  const outer = KERB_LATERAL_METRES + PAVEMENT_WIDTH_METRES;
  // Off EVERY stretch of the drawn road, at each of its three edges. @see the header
  for (const lateral of [KERB_LATERAL_METRES, middle, outer]) {
    const x = frame.x + outX * lateral;
    const z = frame.z + outZ * lateral;
    if (distanceToDrawnRoad(profile, origin, x, z, outer + 1) < KERB_LATERAL_METRES - CHORD_SLACK)
      return undefined;
  }
  return {
    along,
    innerX: frame.x + outX * KERB_LATERAL_METRES,
    innerZ: frame.z + outZ * KERB_LATERAL_METRES,
    outerX: frame.x + outX * outer,
    outerZ: frame.z + outZ * outer,
    y: elevationAt(profile, wrapped) - origin.elevation,
    kerb: dropped ? DROPPED_KERB_HEIGHT_METRES : KERB_HEIGHT_METRES,
    outX,
    outZ,
  };
}

/**
 * The line a person walks along one unbroken run of pavement — #1541:
 * {@link WALK_FROM_KERB_METRES} out from the kerb's face, on the pavement's
 * top, a point a section.
 */
function walkOf(run: readonly Section[]): Float32Array {
  const walk = new Float32Array(run.length * 3);
  run.forEach((section, at) => {
    walk[at * 3] = section.innerX + section.outX * WALK_FROM_KERB_METRES;
    walk[at * 3 + 1] = section.y + section.kerb;
    walk[at * 3 + 2] = section.innerZ + section.outZ * WALK_FROM_KERB_METRES;
  });
  return walk;
}

/**
 * The street furniture of one unbroken run of pavement — #1536, by rule and
 * from nothing but the run itself, so a piece can only stand where the
 * pavement does:
 *
 * - **lamp posts** every {@link LAMP_SPACING_METRES} at the pavement's back,
 *   the first and last half a spacing in from the run's ends;
 * - a pair of **bollards** at each end, at the kerb
 *   ({@link BOLLARD_ENDS_METRES});
 * - one **bench** at the back, half-way between the two lamp posts nearest
 *   the run's middle (a quarter-spacing past a lone lamp post, so the two never stand
 *   together; at the run's middle where it has none), facing
 *   the road, and a **bin** {@link BIN_BESIDE_METRES} along from it — only on
 *   a run long enough to hold both clear of the bollards.
 */
function furnish(run: readonly Section[], into: FurnitureItem[]): void {
  const start = (run[0] as Section).along;
  const end = (run[run.length - 1] as Section).along;
  const length = end - start;
  const place = (kind: FurnitureKind, along: number, fromKerb: number): void => {
    // The two sections either side of `along`, and how far between them.
    let index = 0;
    while (index + 2 < run.length && (run[index + 1] as Section).along < along) index += 1;
    const a = run[index] as Section;
    const b = run[index + 1] as Section;
    const t =
      b.along === a.along ? 0 : Math.min(1, Math.max(0, (along - a.along) / (b.along - a.along)));
    const outX = a.outX + (b.outX - a.outX) * t;
    const outZ = a.outZ + (b.outZ - a.outZ) * t;
    const out = Math.hypot(outX, outZ) || 1;
    into.push({
      kind,
      x: a.innerX + (b.innerX - a.innerX) * t + (outX / out) * fromKerb,
      y: a.y + (b.y - a.y) * t + a.kerb + (b.kerb - a.kerb) * t,
      z: a.innerZ + (b.innerZ - a.innerZ) * t + (outZ / out) * fromKerb,
      // Facing the road: back along `out`.
      rotation: Math.atan2(-outX / out, -outZ / out),
    });
  };
  const back = PAVEMENT_WIDTH_METRES;
  const lamps: number[] = [];
  for (
    let along = start + LAMP_SPACING_METRES / 2;
    along <= end - LAMP_SPACING_METRES / 2 + 1e-9;
    along += LAMP_SPACING_METRES
  ) {
    lamps.push(along);
    place('lamp-post', along, back - LAMP_SETBACK_METRES);
  }
  for (const inset of BOLLARD_ENDS_METRES) {
    if (length < 2 * inset) continue;
    place('bollard', start + inset, BOLLARD_INSET_METRES);
    place('bollard', end - inset, BOLLARD_INSET_METRES);
  }
  const clear = (BOLLARD_ENDS_METRES[1] as number) + 1;
  if (length < 2 * (clear + BIN_BESIDE_METRES)) return;
  const pair = Math.max(0, Math.floor((lamps.length - 2) / 2));
  const bench =
    lamps.length >= 2
      ? ((lamps[pair] as number) + (lamps[pair + 1] as number)) / 2
      : lamps.length === 1
        ? (lamps[0] as number) + LAMP_SPACING_METRES / 4
        : (start + end) / 2;
  place('bench', bench, back - BENCH_SETBACK_METRES);
  place('bin', bench + BIN_BESIDE_METRES, back - BENCH_SETBACK_METRES);
}

/**
 * How much nearer than the road's half-width the kerb's own foot may read:
 * **2 cm**. `distanceToDrawnRoad` measures to two-metre CHORDS of the drawn
 * road, which lie inside the arc, so a point exactly on the road's edge reads a
 * little nearer than it is on a bend (4 cm at a 10 m radius, its own note).
 * Without this the kerb's foot, which stands on the edge by design, would drop
 * a section on every gentle curve; with it a section whose foot is truly more
 * than 2 cm into the carriageway is still dropped.
 */
const CHORD_SLACK = 0.02;

/** Triangles, growing. */
class MeshBuilder {
  readonly #positions: number[] = [];
  readonly #normals: number[] = [];
  readonly #uvs: number[] = [];
  readonly #indices: number[] = [];

  get triangles(): number {
    return this.#indices.length / 3;
  }

  /** One unbroken run of sections: the kerb face, the top, the back face and both ends. */
  strip(run: readonly Section[], side: 1 | -1): void {
    const top = (section: Section): number => section.y + section.kerb;
    const foot = (section: Section): number => section.y - PAVEMENT_FOOTING_METRES;
    const first = run[0] as Section;
    const last = run[run.length - 1] as Section;
    for (let index = 0; index + 1 < run.length; index += 1) {
      const a = run[index] as Section;
      const b = run[index + 1] as Section;
      // The kerb's face, looking at the road.
      this.#quad(
        [a.innerX, a.y, a.innerZ, a.along, 0],
        [a.innerX, top(a), a.innerZ, a.along, a.kerb],
        [b.innerX, b.y, b.innerZ, b.along, 0],
        [b.innerX, top(b), b.innerZ, b.along, b.kerb],
        [-(a.outX + b.outX) / 2, 0, -(a.outZ + b.outZ) / 2],
      );
      // The pavement, looking up.
      this.#quad(
        [a.innerX, top(a), a.innerZ, a.along, 0],
        [a.outerX, top(a), a.outerZ, a.along, PAVEMENT_WIDTH_METRES],
        [b.innerX, top(b), b.innerZ, b.along, 0],
        [b.outerX, top(b), b.outerZ, b.along, PAVEMENT_WIDTH_METRES],
        [0, 1, 0],
      );
      // The back, looking away from the road.
      this.#quad(
        [a.outerX, foot(a), a.outerZ, a.along, -PAVEMENT_FOOTING_METRES],
        [a.outerX, top(a), a.outerZ, a.along, KERB_HEIGHT_METRES],
        [b.outerX, foot(b), b.outerZ, b.along, -PAVEMENT_FOOTING_METRES],
        [b.outerX, top(b), b.outerZ, b.along, KERB_HEIGHT_METRES],
        [(a.outX + b.outX) / 2, 0, (a.outZ + b.outZ) / 2],
      );
    }
    // The two ends, each looking along the road away from the strip. The
    // road's direction is the normal turned back a quarter: (normalZ, −normalX),
    // and `out` is the normal times the side.
    for (const [end, sign] of [
      [first, -1],
      [last, 1],
    ] as const) {
      const ax = end.outZ * side * sign;
      const az = -end.outX * side * sign;
      this.#quad(
        [end.innerX, end.y, end.innerZ, 0, 0],
        [end.innerX, top(end), end.innerZ, 0, KERB_HEIGHT_METRES],
        [end.outerX, foot(end), end.outerZ, PAVEMENT_WIDTH_METRES, -PAVEMENT_FOOTING_METRES],
        [end.outerX, top(end), end.outerZ, PAVEMENT_WIDTH_METRES, KERB_HEIGHT_METRES],
        [ax, 0, az],
      );
    }
  }

  /** One front path's run of sections: its top, and a skirt down each edge. @see doorPathOf */
  path(run: readonly PathSection[], right: { readonly x: number; readonly z: number }): void {
    for (let index = 0; index + 1 < run.length; index += 1) {
      const a = run[index] as PathSection;
      const b = run[index + 1] as PathSection;
      // The top, looking up: across in `u`, along in `v`.
      this.#quad(
        [a.leftX, a.y, a.leftZ, 0, a.s],
        [a.rightX, a.y, a.rightZ, DOOR_PATH_WIDTH_METRES, a.s],
        [b.leftX, b.y, b.leftZ, 0, b.s],
        [b.rightX, b.y, b.rightZ, DOOR_PATH_WIDTH_METRES, b.s],
        [0, 1, 0],
      );
      // The skirts, each looking out from its edge.
      for (const sign of [-1, 1] as const) {
        const ax = sign === -1 ? a.leftX : a.rightX;
        const az = sign === -1 ? a.leftZ : a.rightZ;
        const bx = sign === -1 ? b.leftX : b.rightX;
        const bz = sign === -1 ? b.leftZ : b.rightZ;
        this.#quad(
          [ax, a.foot, az, a.s, a.foot - a.y],
          [ax, a.y, az, a.s, 0],
          [bx, b.foot, bz, b.s, b.foot - b.y],
          [bx, b.y, bz, b.s, 0],
          [right.x * sign, 0, right.z * sign],
        );
      }
    }
  }

  /**
   * Two triangles over `a0 a1 b1 b0`, each corner `[x, y, z, u, v]`, wound so
   * the face is seen from the side `facing` points to.
   */
  #quad(
    a0: readonly [number, number, number, number, number],
    a1: readonly [number, number, number, number, number],
    b0: readonly [number, number, number, number, number],
    b1: readonly [number, number, number, number, number],
    facing: readonly [number, number, number],
  ): void {
    const base = this.#positions.length / 3;
    const length = Math.hypot(facing[0], facing[1], facing[2]) || 1;
    for (const corner of [a0, a1, b0, b1]) {
      this.#positions.push(corner[0], corner[1], corner[2]);
      this.#normals.push(facing[0] / length, facing[1] / length, facing[2] / length);
      this.#uvs.push(corner[3], corner[4]);
    }
    // The geometric normal of (a0, b0, a1) against the one wanted.
    const ex = b0[0] - a0[0];
    const ey = b0[1] - a0[1];
    const ez = b0[2] - a0[2];
    const fx = a1[0] - a0[0];
    const fy = a1[1] - a0[1];
    const fz = a1[2] - a0[2];
    const nx = ey * fz - ez * fy;
    const ny = ez * fx - ex * fz;
    const nz = ex * fy - ey * fx;
    const agrees = nx * facing[0] + ny * facing[1] + nz * facing[2] >= 0;
    const [p, q, r, s] = [base, base + 1, base + 2, base + 3];
    if (agrees) this.#indices.push(p, r, q, q, r, s);
    else this.#indices.push(p, q, r, q, s, r);
  }

  done(): PavementMesh {
    return {
      positions: new Float32Array(this.#positions),
      normals: new Float32Array(this.#normals),
      uvs: new Float32Array(this.#uvs),
      indices: new Uint32Array(this.#indices),
    };
  }
}
