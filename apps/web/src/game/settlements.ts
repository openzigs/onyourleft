// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Places, not houses — #460. Villages and farmsteads beside the road, and the
 * walls, hedges and fences that divide the fields.
 *
 * ## What was wrong
 *
 * Every building was one scatter kind drawn by the same field as the trees
 * (`scatter.ts`), so a house stood wherever a tree could: alone, at any angle,
 * anywhere in the band. Nothing divided the land. Owner, 2026-09-21: *"we have
 * more than just houses."*
 *
 * ## ⚠️ Where a settlement goes — the rule, from the route and a seed only
 *
 * ADR 0009 and ADR 0022's procedural placement: no map, no place data, no
 * names. The route is divided into sites {@link SETTLEMENT_SPACING_METRES}
 * apart (stretched to divide it evenly, as `scatter.ts` §`cellSpanMetres`
 * stretches its cells, so a loop's seam is an ordinary boundary). Each site
 * hashes a kind — a **village** with {@link VILLAGE_CHANCE}, a **farmstead**
 * with {@link FARMSTEAD_CHANCE}, otherwise nothing — and a place along the
 * site. It is then built only if the ground there would be built on:
 *
 * - **level** — no steeper than `scatter.ts` §`SETTLEMENT_GRADE_PERCENT` along
 *   its whole length (people build on the valley floor, not on the pitch);
 * - **low** — within `scatter.ts` §`SETTLEMENT_TREE_LINE_FRACTION` of the local
 *   tree line;
 * - **dry** — no part of it in water or on a bank (`waterways.ts` §`inWater`).
 *
 * ## How a place is laid out
 *
 * A village is plots {@link PLOT_METRES} apart along the road, both sides, each
 * building's front turned to face the road at one setback — a row of houses
 * with a **row of shops** at its middle and a **church** at one end, and a
 * **signpost** at each way in. A farmstead is a farmhouse with a **barn** and a
 * **shed** grouped on one side, set further back. Five kinds of building, each
 * with its own silhouette (`three-renderer.ts` §`STRUCTURE_STYLE`).
 *
 * ⚠️ **A signpost carries no words.** No real name, no brand, no copied
 * signage: a white board on a post says "a place" and nothing more.
 *
 * ## Fields, and what divides them
 *
 * The land beside the road is divided into fields `landform.ts`
 * §`FIELD_SPAN_METRES` long, each side, stretched to divide the route evenly —
 * the grid the ground's own patchwork is drawn on (#425), so a wall stands
 * where one field's colour meets the next. A field is enclosed
 * with {@link ENCLOSED_SHARE}, on ground that is below the trees and no steeper
 * than {@link FIELD_GRADE_PERCENT}: along the verge at
 * {@link FIELD_EDGE_LATERAL_METRES} from the centreline, and out from the road
 * along its first edge to {@link FIELD_DEPTH_METRES}. What encloses it is
 * where it is: **stone walls** on higher or steeper ground, and **hedges** or
 * **fences** on the low flat land, hashed per field. Each is one instanced
 * draw, whatever the count (`three-renderer.ts` §`ScatterBelt`).
 *
 * Every item is a {@link ScatterItem}, admitted on its own unwrapped `along`
 * half-open exactly as `scatter.ts` admits one, so two adjacent spans are a
 * partition and lap two is the same place as lap one.
 *
 * Pure, and names no rendering library.
 */

import {
  distanceOnRoute,
  elevationAt,
  gradeAt,
  positionAt,
  type RouteProfile,
} from '@onyourleft/domain';

import { fieldSpanMetres, terrainHeightAt } from './landform';
import {
  SETTLEMENT_GRADE_PERCENT,
  SETTLEMENT_TREE_LINE_FRACTION,
  type ScatterItem,
  type StructureKind,
} from './scatter';
import { slotHash, uniformFrom } from './seeded';
import { localGroundPosition, type CorridorOrigin } from './terrain';
import { inWater, waterways } from './waterways';
import { treeLineMetres } from './world';

/**
 * How far apart the places a settlement may stand are, along the route, in
 * metres: **700**. Nominal — stretched so the route holds a whole number.
 * About one village or farmstead every one to two kilometres of level valley
 * road, once the chances and the ground have had their say.
 */
export const SETTLEMENT_SPACING_METRES = 700;

/** The share of sites that are villages: **0.3**. */
export const VILLAGE_CHANCE = 0.3;

/** The share of sites that are farmsteads: **0.35**. The rest are open country. */
export const FARMSTEAD_CHANCE = 0.35;

/** How long a village is along the road, in metres: **180**. */
export const VILLAGE_METRES = 180;

/** How far apart a village's plots are along the road, in metres: **18**. */
export const PLOT_METRES = 18;

/** The share of a village's plots that are built on: **0.8**. */
export const PLOT_BUILT_SHARE = 0.8;

/**
 * How far from the centreline a village's buildings stand, in metres: **15** —
 * one setback for the whole street, which is what makes it a street. Past the
 * 3.5 m road, the verge and its wall, and a front garden.
 */
export const SETBACK_METRES = 15;

/** How far back the church stands, in metres: **20** — it has a churchyard. */
export const CHURCH_SETBACK_METRES = 20;

/** How far back a farmstead's buildings stand, in metres: **24** to **30**. */
export const FARM_SETBACK_METRES = [24, 30] as const;

/** How far from the centreline a signpost stands, in metres: **5.5** — on the verge. */
export const SIGNPOST_LATERAL_METRES = 5.5;

/** The share of fields that are enclosed: **0.55**. */
export const ENCLOSED_SHARE = 0.55;

/** The steepest ground a field is enclosed on, in percent: **6**. */
export const FIELD_GRADE_PERCENT = 6;

/**
 * How far from the centreline a field's roadside boundary runs, in metres:
 * **5.6** — inside the 3 m verge `scatter.ts` keeps bare (3.5 m to 6.5 m), so
 * the wall and the first trees behind it do not stand in each other.
 */
export const FIELD_EDGE_LATERAL_METRES = 5.6;

/** How far out from the road a field's side boundary runs, in metres: **48**. */
export const FIELD_DEPTH_METRES = 48;

/**
 * How long one piece of wall, hedge or fence is, in metres: **8** — the length
 * `three-renderer.ts` §`STRUCTURE_STYLE` builds each of them.
 */
export const BOUNDARY_PIECE_METRES = 8;

/**
 * The share of the tree line above which a boundary is a stone wall whatever
 * the hash says: **0.12**. Higher ground is walled.
 */
export const WALL_TREE_LINE_FRACTION = 0.12;

/** The gradient above which a boundary is a stone wall, in percent: **4**. */
export const WALL_GRADE_PERCENT = 4;

/** The share of low, flat boundaries that are hedges rather than fences: **0.6**. */
export const HEDGE_SHARE = 0.6;

/** The most structures one frame may carry, at the target rung. @see QualitySettings.structureItems */
export const STRUCTURE_MAX_ITEMS = 240;

/** The keys the sites and fields are hashed under, outside anything else's. */
const SITE_KEY = 0x4_0000;
const FIELD_KEY = 0x5_0000;

/** One uniform per quantity a site draws, one stream each. */
const STREAM_KIND = 0;
const STREAM_PLACE = 1;
const STREAM_SIDE = 2;
const STREAM_PLOT = 3;
const STREAM_VARIANT = 4;

/**
 * Every structure beside the road between two odometer readings — buildings,
 * signposts and field boundaries.
 *
 * ⚠️ **Buildings and signposts first, then the boundaries nearest the rider**,
 * and the budget cuts from the end: a rung that takes structures away takes
 * the far walls and hedges before it takes a house.
 */
export function structuresAt(
  profile: RouteProfile,
  origin: CorridorOrigin,
  seed: number,
  fromMetres: number,
  toMetres: number,
  budget: { readonly maxItems: number; readonly riderMetres: number },
): readonly ScatterItem[] {
  const found: ScatterItem[] = [];
  const villages: (readonly [number, number])[] = [];
  settlementsAt(profile, origin, seed, fromMetres, toMetres, found, villages);
  const edges: { readonly item: ScatterItem; readonly along: number }[] = [];
  fieldEdgesAt(profile, origin, seed, fromMetres, toMetres, villages, edges);
  edges.sort(
    (first, second) =>
      Math.abs(first.along - budget.riderMetres) - Math.abs(second.along - budget.riderMetres),
  );
  for (const edge of edges) {
    found.push(edge.item);
  }
  return found.slice(0, Math.max(0, budget.maxItems));
}

/** Where on the route something is, and which way the road runs there. */
interface Frame {
  readonly x: number;
  readonly z: number;
  /** The left normal, `terrain.ts`'s convention. */
  readonly normalX: number;
  readonly normalZ: number;
}

function frameAt(
  profile: RouteProfile,
  origin: CorridorOrigin,
  wrapped: number,
): Frame | undefined {
  const here = localGroundPosition(origin, positionAt(profile, wrapped));
  const ahead = localGroundPosition(
    origin,
    positionAt(profile, distanceOnRoute(profile, wrapped + 5)),
  );
  const behind = localGroundPosition(
    origin,
    positionAt(profile, distanceOnRoute(profile, wrapped - 5)),
  );
  const dx = ahead.x - behind.x;
  const dz = ahead.z - behind.z;
  const length = Math.hypot(dx, dz);
  if (!(length > 0)) {
    return undefined;
  }
  return { x: here.x, z: here.z, normalX: -dz / length, normalZ: dx / length };
}

/** Whether a stretch of the route would be built on: level, low and dry. */
function buildable(
  profile: RouteProfile,
  seed: number,
  from: number,
  to: number,
  lateral: number,
): boolean {
  const ways = waterways(profile, seed);
  for (let at = from; at <= to + 1e-9; at += 10) {
    const wrapped = distanceOnRoute(profile, at);
    if (Math.abs(gradeAt(profile, wrapped)) > SETTLEMENT_GRADE_PERCENT) return false;
    const latitude = Math.abs(positionAt(profile, wrapped).latitude);
    if (elevationAt(profile, wrapped) > treeLineMetres(latitude) * SETTLEMENT_TREE_LINE_FRACTION) {
      return false;
    }
    if (inWater(ways, profile, wrapped, lateral) || inWater(ways, profile, wrapped, -lateral)) {
      return false;
    }
  }
  return true;
}

/** An item standing on the ground at `along` (odometer), `signedLateral` out, facing the road. */
function standing(
  profile: RouteProfile,
  origin: CorridorOrigin,
  seed: number,
  kind: StructureKind,
  along: number,
  signedLateral: number,
  variant: number,
  facing: 'road' | 'along',
): ScatterItem | undefined {
  const wrapped = distanceOnRoute(profile, along);
  const frame = frameAt(profile, origin, wrapped);
  if (frame === undefined) return undefined;
  // Facing the road is facing back along the normal from its side; facing
  // along is the road's own direction, (normalZ, −normalX).
  const [fx, fz] =
    facing === 'road'
      ? [-frame.normalX * Math.sign(signedLateral), -frame.normalZ * Math.sign(signedLateral)]
      : [frame.normalZ, -frame.normalX];
  return {
    kind,
    x: frame.x + frame.normalX * signedLateral,
    y: terrainHeightAt(profile, origin, seed, wrapped, signedLateral),
    z: frame.z + frame.normalZ * signedLateral,
    rotation: Math.atan2(fx, fz),
    scale: 1,
    variant,
  };
}

/** The villages and farmsteads, and their signposts. */
function settlementsAt(
  profile: RouteProfile,
  origin: CorridorOrigin,
  seed: number,
  fromMetres: number,
  toMetres: number,
  found: ScatterItem[],
  villages: (readonly [number, number])[],
): void {
  const total = profile.totalDistance;
  const sites = Math.max(1, Math.round(total / SETTLEMENT_SPACING_METRES));
  const span = total / sites;
  const reach = VILLAGE_METRES / 2 + PLOT_METRES;
  const first = Math.floor((fromMetres - reach) / span);
  const last = Math.floor((toMetres + reach) / span);
  for (let site = first; site <= last; site += 1) {
    if (!profile.loop && (site < 0 || site >= sites)) continue;
    const wrappedSite = ((site % sites) + sites) % sites;
    const base = slotHash(seed, wrappedSite, SITE_KEY);
    const roll = uniformFrom(base, STREAM_KIND);
    const kind =
      roll < VILLAGE_CHANCE
        ? 'village'
        : roll < VILLAGE_CHANCE + FARMSTEAD_CHANCE
          ? 'farm'
          : undefined;
    if (kind === undefined) continue;
    // Where in its site, clear of the site's ends so two neighbours' plots
    // never overlap.
    const centre = site * span + span * (0.3 + 0.4 * uniformFrom(base, STREAM_PLACE));
    const half = kind === 'village' ? VILLAGE_METRES / 2 : 20;
    if (!buildable(profile, seed, centre - half, centre + half, SETBACK_METRES)) continue;
    const side = uniformFrom(base, STREAM_SIDE) < 0.5 ? 1 : -1;
    const admit = (item: ScatterItem | undefined, along: number): void => {
      if (item !== undefined && along >= fromMetres && along < toMetres) found.push(item);
    };
    if (kind === 'village') {
      villages.push([centre - half - PLOT_METRES, centre + half + PLOT_METRES]);
      const plots = Math.floor(VILLAGE_METRES / PLOT_METRES) + 1;
      const middle = Math.floor(plots / 2);
      for (let plot = 0; plot < plots; plot += 1) {
        const along = centre - half + plot * PLOT_METRES;
        for (const plotSide of [1, -1] as const) {
          const hash = slotHash(seed, wrappedSite * 64 + plot, SITE_KEY + (plotSide === 1 ? 1 : 2));
          if (uniformFrom(hash, STREAM_PLOT) >= PLOT_BUILT_SHARE) continue;
          // The church at the far end on the site's own side, the shops at the
          // middle on the other, houses on every other plot.
          const [building, lateral]: readonly [StructureKind, number] =
            plot === plots - 1 && plotSide === side
              ? ['church', CHURCH_SETBACK_METRES]
              : plot === middle && plotSide === -side
                ? ['shop-row', SETBACK_METRES - 1]
                : ['building', SETBACK_METRES];
          const variant = Math.min(5, Math.floor(uniformFrom(hash, STREAM_VARIANT) * 6));
          admit(
            standing(profile, origin, seed, building, along, lateral * plotSide, variant, 'road'),
            along,
          );
        }
      }
      // A signpost at each way in, on the verge, turned along the road.
      for (const [along, verge] of [
        [centre - half - PLOT_METRES / 2, -1],
        [centre + half + PLOT_METRES / 2, 1],
      ] as const) {
        admit(
          standing(
            profile,
            origin,
            seed,
            'signpost',
            along,
            SIGNPOST_LATERAL_METRES * verge,
            0,
            'along',
          ),
          along,
        );
      }
    } else {
      // A farmstead: a farmhouse, a barn and a shed, grouped on one side.
      const [near, far] = FARM_SETBACK_METRES;
      const layout: readonly (readonly [StructureKind, number, number])[] = [
        ['building', 0, near],
        ['barn', 17, far],
        ['shed', -15, far - 2],
      ];
      for (const [building, offset, lateral] of layout) {
        const along = centre + offset;
        const variant = Math.min(5, Math.floor(uniformFrom(base, STREAM_VARIANT) * 6));
        admit(
          standing(profile, origin, seed, building, along, lateral * side, variant, 'road'),
          along,
        );
      }
    }
  }
}

/** The walls, hedges and fences, each with the odometer it stands at. */
function fieldEdgesAt(
  profile: RouteProfile,
  origin: CorridorOrigin,
  seed: number,
  fromMetres: number,
  toMetres: number,
  villages: readonly (readonly [number, number])[],
  found: { item: ScatterItem; along: number }[],
): void {
  const total = profile.totalDistance;
  // The ground's own field grid, so the patchwork and the walls agree (#425).
  const span = fieldSpanMetres(profile);
  const fields = Math.max(1, Math.round(total / span));
  const ways = waterways(profile, seed);
  const first = Math.floor(fromMetres / span) - 1;
  const last = Math.floor(toMetres / span);
  const inVillage = (along: number): boolean =>
    villages.some(([from, to]) => along >= from && along <= to);
  for (let field = first; field <= last; field += 1) {
    if (!profile.loop && (field < 0 || field >= fields)) continue;
    const wrappedField = ((field % fields) + fields) % fields;
    const start = field * span;
    const middle = distanceOnRoute(profile, start + span / 2);
    const latitude = Math.abs(positionAt(profile, middle).latitude);
    const treeLine = treeLineMetres(latitude);
    const altitude = elevationAt(profile, middle);
    const steep = Math.abs(gradeAt(profile, middle));
    if (altitude >= treeLine || steep > FIELD_GRADE_PERCENT) continue;
    for (const side of [1, -1] as const) {
      const hash = slotHash(seed, wrappedField, FIELD_KEY + (side === 1 ? 1 : 2));
      if (uniformFrom(hash, 0) >= ENCLOSED_SHARE) continue;
      const kind: StructureKind =
        altitude > treeLine * WALL_TREE_LINE_FRACTION || steep > WALL_GRADE_PERCENT
          ? 'wall'
          : uniformFrom(hash, 1) < HEDGE_SHARE
            ? 'hedge'
            : 'fence';
      // Along the verge, the whole length of the field.
      const pieces = Math.max(1, Math.round(span / BOUNDARY_PIECE_METRES));
      const piece = span / pieces;
      for (let index = 0; index < pieces; index += 1) {
        const along = start + (index + 0.5) * piece;
        if (along < fromMetres || along >= toMetres || inVillage(along)) continue;
        const wrapped = distanceOnRoute(profile, along);
        if (inWater(ways, profile, wrapped, FIELD_EDGE_LATERAL_METRES * side)) continue;
        const item = standing(
          profile,
          origin,
          seed,
          kind,
          along,
          FIELD_EDGE_LATERAL_METRES * side,
          0,
          'along',
        );
        if (item !== undefined) found.push({ item, along });
      }
      // Out from the road along the field's first edge.
      if (start < fromMetres || start >= toMetres || inVillage(start)) continue;
      const frame = frameAt(profile, origin, distanceOnRoute(profile, start));
      if (frame === undefined) continue;
      const outward = Math.round(
        (FIELD_DEPTH_METRES - FIELD_EDGE_LATERAL_METRES) / BOUNDARY_PIECE_METRES,
      );
      for (let index = 0; index < outward; index += 1) {
        const lateral = FIELD_EDGE_LATERAL_METRES + (index + 0.5) * BOUNDARY_PIECE_METRES;
        const wrapped = distanceOnRoute(profile, start);
        if (inWater(ways, profile, wrapped, lateral * side)) continue;
        found.push({
          item: {
            kind,
            x: frame.x + frame.normalX * lateral * side,
            y: terrainHeightAt(profile, origin, seed, wrapped, lateral * side),
            z: frame.z + frame.normalZ * lateral * side,
            // Out from the road: its own length runs along the normal.
            rotation: Math.atan2(frame.normalX * side, frame.normalZ * side),
            scale: 1,
            variant: 0,
          },
          along: start,
        });
      }
    }
  }
}

/**
 * How close to a building nothing scattered may stand, in metres: **9** — a
 * house's half-depth and a little garden. The scenery `scatter.ts` places knows
 * nothing about villages, so a tree could otherwise stand in a kitchen.
 */
export const BUILDING_CLEARANCE_METRES = 9;

/** The kinds that are buildings, which the natural scenery keeps clear of. */
const BUILDINGS: ReadonlySet<StructureKind> = new Set([
  'building',
  'barn',
  'church',
  'shop-row',
  'shed',
]);

/**
 * The natural scenery, less anything standing within
 * {@link BUILDING_CLEARANCE_METRES} of a building. Pure, and a function of
 * positions only, so it is the same on every lap.
 */
export function clearOfBuildings(
  natural: readonly ScatterItem[],
  structures: readonly ScatterItem[],
): readonly ScatterItem[] {
  const buildings = structures.filter((item) => BUILDINGS.has(item.kind as StructureKind));
  if (buildings.length === 0) {
    return natural;
  }
  return natural.filter((item) =>
    buildings.every(
      (building) =>
        Math.hypot(item.x - building.x, item.z - building.z) >= BUILDING_CLEARANCE_METRES,
    ),
  );
}
