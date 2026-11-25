// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **How built-up each stretch of an open-world street is** — #3131.
 *
 * The owner's tablet ride of 2026-11-24, in a dense city centre: *"city
 * landscape not quite urban enough. Seeing wooden farm fences."* A street lined
 * with four- to six-storey buildings was dressed as countryside: a grass verge,
 * hedges on it, a rail fence. A route ride reads how built-up each stretch is
 * at the press (`urban-class.ts`, #1633) and lays a city centre's street where
 * it is one (`streets.ts`, #1637); an open-world ride had no class at all, so
 * every stretch was dressed alike.
 *
 * ## What it reads
 *
 * The mapped buildings planned round the rider (`tile-buildings.ts`, the
 * session's `buildings`), which reach past everything the frame draws: they
 * are planned `tile-buildings.ts` §`OPEN_WORLD_BUILDINGS_REACH_METRES` out and again every
 * 150 m, and the frame draws 400 m ahead. Each plan counts toward the window
 * ({@link URBAN_WINDOW_METRES} of the view's road) its centroid is nearest,
 * where it stands within {@link OPEN_WORLD_URBAN_BAND_METRES} of the road:
 *
 * - `coverage`: the plans' footprint area over the window's band, both sides;
 * - `medianStoreys` and `towers`: the plans' storeys — mapped, or inferred
 *   from their mapped neighbours (#1634) — as #1633 reads mapped heights;
 *
 * and the window is classed by #1633's own table and smoothing
 * (`urban-class.ts` §`urbanClassFromReadings`). There is no land mask here, so
 * no commercial or built-up share: a window is a city centre by its coverage
 * and its height alone. A window with no plan beside it is `unknown`, which is
 * today's dressing.
 *
 * ## Per view
 *
 * A class is read by distance along a profile, so each view has its own
 * ({@link openWorldUrbanClass}), built on its first ask and kept for as long
 * as both its profile and the plans are: the same object, so everything the
 * scene keys on it is kept too. The town round the rider
 * ({@link openWorldTown}) answers for any profile it is asked about, a way out
 * (#3051) included, from the same plans; ⚠️ the scene asks it for the road's
 * view alone today, so a way out not taken is dressed as before until a
 * choice makes it the road.
 *
 * ⚠️ Every threshold is #1633's, provisional until #1630 measures the archive;
 * the band is *#3131's choice*: a city block's depth, so it measures the
 * street's own frontage.
 *
 * Names no rendering library and formats no string (ADR 0004 D).
 */

import type { RouteProfile } from '@onyourleft/domain';

import { mappedTown } from '../footprint-buildings';
import type { MappedBuildings } from '../mapped-buildings';
import { nearestOnDrawnRoad } from '../road-grid';
import type { MappedTown } from '../settlements';
import { corridorOrigin } from '../terrain';
import {
  CITY_TOWER_REACH_METRES,
  CITY_TOWER_STOREYS,
  MIDRISE_STOREYS,
  NO_URBAN_CLASS,
  URBAN_WINDOW_METRES,
  urbanClassFromReadings,
  type UrbanClassMap,
  type WindowReadings,
} from '../urban-class';
import type { WorldCorridor } from '../world-data/corridor';

/** How far from the road a plan counts toward its window, metres: **60**. @see the header */
export const OPEN_WORLD_URBAN_BAND_METRES = 60;

const classes = new WeakMap<MappedBuildings, WeakMap<RouteProfile, UrbanClassMap>>();

/** The urban class of `profile`'s every window, from `buildings`. See the file's header. */
export function openWorldUrbanClass(
  profile: RouteProfile,
  buildings: MappedBuildings,
): UrbanClassMap {
  let byProfile = classes.get(buildings);
  if (byProfile === undefined) {
    byProfile = new WeakMap();
    classes.set(buildings, byProfile);
  }
  let known = byProfile.get(profile);
  if (known === undefined) {
    known = classOf(profile, buildings);
    byProfile.set(profile, known);
  }
  return known;
}

function classOf(profile: RouteProfile, buildings: MappedBuildings): UrbanClassMap {
  const total = profile.totalDistance;
  if (!(total > 0) || buildings.plans.length === 0) return NO_URBAN_CLASS;
  const windows = Math.ceil(total / URBAN_WINDOW_METRES);
  const origin = corridorOrigin(profile);
  const area = new Float64Array(windows);
  const counted = new Uint32Array(windows);
  const midrise = new Uint32Array(windows);
  const towers = new Uint32Array(windows);
  const storeys: number[][] = Array.from({ length: windows }, () => []);
  for (const plan of buildings.plans) {
    const near = nearestOnDrawnRoad(
      profile,
      origin,
      plan.centroid.x,
      plan.centroid.z,
      OPEN_WORLD_URBAN_BAND_METRES,
    );
    if (near === undefined || !(near.distance <= OPEN_WORLD_URBAN_BAND_METRES)) continue;
    const window = Math.min(windows - 1, Math.max(0, Math.floor(near.along / URBAN_WINDOW_METRES)));
    area[window] = (area[window] as number) + Math.abs(signedArea(plan.footprint));
    counted[window] = (counted[window] as number) + 1;
    (storeys[window] as number[]).push(plan.storeys);
    if (plan.storeys >= MIDRISE_STOREYS) midrise[window] = (midrise[window] as number) + 1;
    if (plan.storeys >= CITY_TOWER_STOREYS) towers[window] = (towers[window] as number) + 1;
  }
  const band = URBAN_WINDOW_METRES * 2 * OPEN_WORLD_URBAN_BAND_METRES;
  const towerWindows = Math.floor(CITY_TOWER_REACH_METRES / URBAN_WINDOW_METRES);
  const readings: (WindowReadings | undefined)[] = [];
  for (let window = 0; window < windows; window += 1) {
    const count = counted[window] as number;
    if (count === 0) {
      readings.push(undefined);
      continue;
    }
    let nearTowers = 0;
    for (
      let other = Math.max(0, window - towerWindows);
      other <= Math.min(windows - 1, window + towerWindows);
      other += 1
    ) {
      nearTowers += towers[other] as number;
    }
    readings.push({
      coverage: (area[window] as number) / band,
      commercial: 0,
      // No land mask: built-up as far as its footprints say, so a stretch with
      // any is never `rural` by its land alone.
      builtUp: 1,
      medianStoreys: medianOf(storeys[window] as number[]),
      towers: nearTowers,
      midriseShare: (midrise[window] as number) / count,
    });
  }
  return urbanClassFromReadings(readings, profile);
}

const towns = new WeakMap<MappedBuildings, MappedTown>();

/**
 * What an open-world ride's lots, field boundaries and streets read of its
 * mapped town (`settlements.ts` §`MappedTown`): the planned footprints, which
 * #2655 keeps every field boundary 31 m off, and each view's and way's urban
 * class ({@link openWorldUrbanClass}). The same object while the plans are.
 * `streets` is the held streets' corridor, whose land use (none, today) is
 * what the town reads railways and fenced grounds from.
 */
export function openWorldTown(buildings: MappedBuildings, streets: WorldCorridor): MappedTown {
  let town = towns.get(buildings);
  if (town === undefined) {
    town = {
      ...mappedTown(streets, buildings.plans),
      urbanOn: (profile) => openWorldUrbanClass(profile, buildings),
    };
    towns.set(buildings, town);
  }
  return town;
}

function signedArea(ring: Float32Array): number {
  let twice = 0;
  const n = ring.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i, i += 1) {
    twice +=
      (ring[j * 2] as number) * (ring[i * 2 + 1] as number) -
      (ring[i * 2] as number) * (ring[j * 2 + 1] as number);
  }
  return twice / 2;
}

function medianOf(values: number[]): number {
  if (values.length === 0) return 0;
  values.sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2);
  return values.length % 2 === 1
    ? (values[middle] as number)
    : ((values[middle - 1] as number) + (values[middle] as number)) / 2;
}
