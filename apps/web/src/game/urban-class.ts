// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * How built-up each stretch of the route is — #1633, epic #1628: `unknown`,
 * `rural`, `village`, `town` or `city-centre`, per {@link URBAN_WINDOW_METRES}
 * of route.
 *
 * Built ONCE, at the press, beside `land-class.ts` §`landClassMask` and from
 * nothing the device does not already hold: the route's corridor
 * (`world-data/corridor.ts`) and its land-class mask. Never per frame:
 * {@link UrbanClassMap.classAt} is one typed-array index.
 *
 * ## What each window measures
 *
 * Every window is swept across the corridor, out to
 * `CORRIDOR_HALF_WIDTH_METRES` either side of the drawn road, every
 * {@link URBAN_SAMPLE_METRES} — the mask's own cell:
 *
 * - `coverage`: the area of the footprints whose centroid is beside the
 *   window, over the covered land that is not water;
 * - `commercial`: the share of that land whose `kindAt` is one of
 *   {@link URBAN_COMMERCIAL_KINDS};
 * - `builtUp`: the share of it the mask classes `built-up`;
 * - `tall`: the median storeys (`footprint-buildings.ts` §`storeysFor`) of the
 *   window's footprints with a MAPPED height, and how many footprints of
 *   {@link CITY_TOWER_STOREYS} or more stand within
 *   {@link CITY_TOWER_REACH_METRES} of it.
 *
 * Only `building` features count, not `building_part`: a part stands inside
 * its building, and counting both would count its area twice.
 *
 * ## The place prior (#1632, ADR 0055 D-5)
 *
 * A window {@link classify} puts at `town` whose coverage is at least
 * {@link PLACE_PRIOR_MIN_COVERAGE} — with no upper bound: a downtown whose
 * towers carry no mapped height is the case this is for — is lifted to
 * `city-centre` when a **lifting point** stands within
 * {@link PLACE_PRIOR_REACH_METRES} of the window's centre on the drawn road: a
 * `locality`/`city` of rank {@link PLACE_PRIOR_MIN_CITY_RANK} or more, or a
 * `neighbourhood`/`suburb` of any rank. Nothing else is lifted and nothing is
 * lowered: rural and village built form stay as they are whatever stands
 * near, and an `unknown` window stays `unknown`. The prior is applied before
 * the smoothing, so a lifted run still needs {@link URBAN_MIN_RUN_METRES}. A
 * `town`, `village`, `hamlet` or `quarter` point lifts nothing (D-5.5).
 *
 * ## No map data, no class
 *
 * A window less than {@link URBAN_MIN_COVERED_SHARE} covered is `unknown` —
 * no corridor, outside the archive, offline, a privacy zone, map tiles off,
 * or the stylised world (ADR 0054 D-4) — and ⚠️ **an `unknown` window is
 * never filled from its neighbours**: a privacy-zone gap inside a city reads
 * as today's world, not as city.
 *
 * ## Smoothing
 *
 * A class must hold for {@link URBAN_MIN_RUN_METRES} to stand. A shorter run
 * takes the class of its neighbours — both, where they agree; the longer,
 * where they do not — and that minimum run is the hysteresis: one window of
 * town inside a city is not a change of class, and the class changes only
 * once the evidence has persisted for 300 m. Runs are merged only within a
 * stretch of covered windows; an `unknown` run is never merged and never
 * merged into.
 *
 * ⚠️ **Every threshold is provisional** until #1630's spike reads what the
 * archive actually holds (the research of 2026-10-24 on #1628 is their only
 * source). Each is named here, with that source, so the spike's readings
 * change a number rather than a rule.
 *
 * Names no rendering library, formats no string, and so prints no coordinate
 * and no distance along the route (ADR 0004 D).
 */

import type { RouteProfile } from '@onyourleft/domain';
import type { Box, PlaceFeature } from '@onyourleft/map-features';

import { storeysFor } from './footprint-buildings';
import { kindAt, type LandClassMask } from './land-class';
import {
  drawnRoadPoints,
  nearestOnRoadSegments,
  nearestOnWholeRoad,
  otherRoadWithin,
  roadSegmentsNear,
  type BesideTheRoad,
} from './road-grid';
import { corridorOrigin } from './terrain';
import { CORRIDOR_HALF_WIDTH_METRES, type WorldCorridor } from './world-data/corridor';

export type UrbanClass = 'unknown' | 'rural' | 'village' | 'town' | 'city-centre';

/** Answers "how built-up is the route here?" by distance along it. */
export interface UrbanClassMap {
  /** O(1), allocation-free: a typed-array lookup by window. `unknown` off the route. */
  classAt(alongMetres: number): UrbanClass;
}

/** Every query `unknown`: today's world, and what the press takes with no corridor. */
export const NO_URBAN_CLASS: UrbanClassMap = Object.freeze({
  classAt: (): UrbanClass => 'unknown',
});

/** One window's length along the route: **100 m** (#1633). */
export const URBAN_WINDOW_METRES = 100;

/** The sweep's spacing, along and across: **5 m**, `land-class.ts`' cell. */
export const URBAN_SAMPLE_METRES = 5;

/**
 * The share of a window's samples that must be covered for it to be classed:
 * **0.5**. Below it, the window is mostly where no map data was read, and is
 * `unknown`. Provisional (#1630).
 */
export const URBAN_MIN_COVERED_SHARE = 0.5;

/** The shortest run a class stands for: **300 m** (#1633's smoothing). Provisional (#1630). */
export const URBAN_MIN_RUN_METRES = 300;

/**
 * The `landuse` kinds that count as commercial: **`commercial`** — #1633,
 * "plus any kind #1630 confirms". Provisional (#1630).
 */
export const URBAN_COMMERCIAL_KINDS: ReadonlySet<string> = new Set(['commercial']);

/** `rural` below this share of built-up land… **10 %** (#1633). Provisional (#1630). */
export const RURAL_MAX_BUILT_UP = 0.1;

/** …and below this footprint coverage: **3 %** (#1633). Provisional (#1630). */
export const RURAL_MAX_COVERAGE = 0.03;

/**
 * A `village` has "almost no footprints of 3+ storeys": at most this share of
 * its footprints, **5 %** (#1633). Provisional (#1630).
 */
export const VILLAGE_MAX_MIDRISE_SHARE = 0.05;

/** The storeys a footprint is mid-rise from, for {@link VILLAGE_MAX_MIDRISE_SHARE}: **3**. */
export const MIDRISE_STOREYS = 3;

/** `town` from this footprint coverage: **15 %** (#1633). Provisional (#1630). */
export const TOWN_COVERAGE = 0.15;

/** …or from this commercial share: **20 %** (#1633). Provisional (#1630). */
export const TOWN_COMMERCIAL = 0.2;

/** `city-centre` needs this footprint coverage: **35 %** (#1633). Provisional (#1630). */
export const CITY_COVERAGE = 0.35;

/** …and a median mapped height of this many storeys: **4** (#1633). Provisional (#1630). */
export const CITY_MEDIAN_STOREYS = 4;

/**
 * …or this many footprints of {@link CITY_TOWER_STOREYS} or more within
 * {@link CITY_TOWER_REACH_METRES}: **3** (#1633). Provisional (#1630).
 */
export const CITY_TOWER_COUNT = 3;

/** A tower's storeys, for {@link CITY_TOWER_COUNT}: **5**, `footprint-buildings.ts` §`TOWER_STOREYS`. */
export const CITY_TOWER_STOREYS = 5;

/**
 * How far from a window its towers are counted, by window centre: **200 m**
 * (#1633), so the windows two either side. Provisional (#1630).
 */
export const CITY_TOWER_REACH_METRES = 200;

/** …or this commercial share: **50 %** (#1633). Provisional (#1630). */
export const CITY_COMMERCIAL = 0.5;

/**
 * The place prior lifts only a `town` window of at least this footprint
 * coverage: **0.25** (ADR 0055 D-5.1), with no upper bound. Provisional (#1630).
 */
export const PLACE_PRIOR_MIN_COVERAGE = 0.25;

/**
 * …when a lifting point stands within this of the window's centre on the
 * drawn road: **800 m** (ADR 0055 D-5.1). Provisional (#1630).
 */
export const PLACE_PRIOR_REACH_METRES = 800;

/**
 * A `locality`/`city` point lifts only at this `population_rank` or more:
 * **9**, a population of 100,000 or more by the archive's breaks (ADR 0055
 * D-5.2, the owner's Q1 ruling of 2026-10-25). Provisional (#1630).
 */
export const PLACE_PRIOR_MIN_CITY_RANK = 9;

/** Whether a place point may lift a window (ADR 0055 D-5.2). */
function liftsAWindow(place: PlaceFeature): boolean {
  if (place.kind === 'locality' && place.kindDetail === 'city') {
    return place.populationRank >= PLACE_PRIOR_MIN_CITY_RANK;
  }
  return place.kind === 'neighbourhood' && place.kindDetail === 'suburb';
}

/** The classes by code; 0 is `unknown`. */
const CLASS_OF_CODE: readonly UrbanClass[] = ['unknown', 'rural', 'village', 'town', 'city-centre'];
const UNKNOWN = 0;
const RURAL = 1;
const VILLAGE = 2;
const TOWN = 3;
const CITY = 4;

/** What one window measured. */
interface WindowReadings {
  readonly coverage: number;
  readonly commercial: number;
  readonly builtUp: number;
  readonly medianStoreys: number;
  readonly towers: number;
  readonly midriseShare: number;
}

/** #1633's table, for one covered window. */
function classify(readings: WindowReadings): number {
  const { coverage, commercial } = readings;
  if (
    coverage >= CITY_COVERAGE &&
    (readings.medianStoreys >= CITY_MEDIAN_STOREYS ||
      readings.towers >= CITY_TOWER_COUNT ||
      commercial >= CITY_COMMERCIAL)
  ) {
    return CITY;
  }
  if (coverage >= TOWN_COVERAGE || commercial >= TOWN_COMMERCIAL) return TOWN;
  if (readings.builtUp < RURAL_MAX_BUILT_UP && coverage < RURAL_MAX_COVERAGE) return RURAL;
  return readings.midriseShare <= VILLAGE_MAX_MIDRISE_SHARE ? VILLAGE : TOWN;
}

/** The reaches a footprint's nearest stretch of road is looked for within, out to the corridor's edge. */
const FOOTPRINT_REACHES = [32, 64, 128, CORRIDOR_HALF_WIDTH_METRES] as const;

/** The middle value of `values`, which it sorts; 0 for none. */
function medianOf(values: number[]): number {
  if (values.length === 0) return 0;
  values.sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2);
  return values.length % 2 === 1
    ? (values[middle] as number)
    : ((values[middle - 1] as number) + (values[middle] as number)) / 2;
}

/** A ring's area by the shoelace, unsigned. */
function ringArea(ring: Float32Array): number {
  let twice = 0;
  const n = ring.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i, i += 1) {
    twice +=
      (ring[j * 2] as number) * (ring[i * 2 + 1] as number) -
      (ring[i * 2] as number) * (ring[j * 2 + 1] as number);
  }
  return Math.abs(twice) / 2;
}

/** A polygon's box, for the commercial test's first, cheap check. */
function boxOf(ring: Float32Array): Box {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (let i = 0; i + 1 < ring.length; i += 2) {
    minX = Math.min(minX, ring[i] as number);
    maxX = Math.max(maxX, ring[i] as number);
    minZ = Math.min(minZ, ring[i + 1] as number);
    maxZ = Math.max(maxZ, ring[i + 1] as number);
  }
  return { minX, maxX, minZ, maxZ };
}

/**
 * The urban class of every window of the route, from its corridor and mask.
 * Built once, at the press.
 */
export function urbanClassMap(
  corridor: WorldCorridor,
  mask: LandClassMask,
  profile: RouteProfile,
): UrbanClassMap {
  const total = profile.totalDistance;
  if (!(total > 0)) return NO_URBAN_CLASS;
  const origin = corridorOrigin(profile);
  const windows = Math.ceil(total / URBAN_WINDOW_METRES);

  // 1. The sweep: every sample's class, counted into its window.
  const samples = new Uint32Array(windows);
  const covered = new Uint32Array(windows);
  const land = new Uint32Array(windows);
  const builtUp = new Uint32Array(windows);
  const commercial = new Uint32Array(windows);
  const commercialBoxes: Box[] = [];
  for (const feature of corridor.landUse) {
    const outer = feature.rings[0];
    if (feature.layer !== 'landuse' || outer === undefined || outer.length < 6) continue;
    if (URBAN_COMMERCIAL_KINDS.has(feature.kind)) commercialBoxes.push(boxOf(outer));
  }
  const inCommercialBox = (x: number, z: number): boolean => {
    for (const box of commercialBoxes) {
      if (x >= box.minX && x <= box.maxX && z >= box.minZ && z <= box.maxZ) return true;
    }
    return false;
  };
  const sweepBeside: BesideTheRoad = { along: 0, lateral: 0, distance: 0 };
  const road = drawnRoadPoints(profile, origin);
  const points = road.points;
  const count = points.length / 2;
  const stride = Math.max(1, Math.round(URBAN_SAMPLE_METRES / road.step));
  // The nearest road point may be a sweep step away, not exactly this one.
  const alongTolerance = stride * road.step;
  const reach = Math.floor(CORRIDOR_HALF_WIDTH_METRES / URBAN_SAMPLE_METRES);
  for (let point = 0; point < count; point += stride) {
    const along = Math.min(total, point * road.step);
    const ownWindow = Math.min(windows - 1, Math.floor(along / URBAN_WINDOW_METRES));
    // The road's heading here: forward, or backward at its last point.
    const from = point + 1 < count ? point : point - 1;
    if (from < 0) break;
    const dx = (points[from * 2 + 2] as number) - (points[from * 2] as number);
    const dz = (points[from * 2 + 3] as number) - (points[from * 2 + 1] as number);
    const length = Math.hypot(dx, dz);
    if (!(length > 0)) continue;
    const normalX = -dz / length;
    const normalZ = dx / length;
    const x0 = points[point * 2] as number;
    const z0 = points[point * 2 + 1] as number;
    // #1696: each half of the normal is cleared at once where it can be. Every sample on it is the
    // centre of a disc through this road point and inside the disc of its far end, so where no other
    // stretch of road comes into that one, none is nearer any sample than this point is. The own
    // stretch is the segments whose every point is strictly within the tolerance. A millimetre of
    // slack sends a tie at the disc's edge — a loop's closing segment ends on its first point — to
    // the search below, which breaks it as the cells did.
    const far = reach * URBAN_SAMPLE_METRES;
    const leftClear = !otherRoadWithin(
      road,
      x0 - normalX * far,
      z0 - normalZ * far,
      far + 1e-3,
      along,
      alongTolerance,
    );
    const rightClear = !otherRoadWithin(
      road,
      x0 + normalX * far,
      z0 + normalZ * far,
      far + 1e-3,
      along,
      alongTolerance,
    );
    for (let step = -reach; step <= reach; step += 1) {
      const lateral = step * URBAN_SAMPLE_METRES;
      const x = x0 + normalX * lateral;
      const z = z0 + normalZ * lateral;
      // Counted only by the sweep at the road point nearest it, as step 2 counts a footprint once: where
      // the route passes within the sweep of itself, a second pass reaches the same land and must not
      // count it again, or coverage is divided by the number of passes.
      // #1696: and where that half is not clear, from the road's tree of boxes rather than its cells,
      // which within `|lateral|` of a sample 250 m out held a few hundred segments.
      if (step !== 0 && !(step < 0 ? leftClear : rightClear)) {
        if (
          nearestOnWholeRoad(road, x, z, Math.abs(lateral) + 1, sweepBeside) &&
          Math.abs(sweepBeside.along - along) > alongTolerance
        ) {
          continue;
        }
      }
      const window = ownWindow;
      samples[window] = (samples[window] as number) + 1;
      const here = mask.classAt(x, z);
      if (here === 'unknown') continue;
      covered[window] = (covered[window] as number) + 1;
      if (here === 'water') continue;
      land[window] = (land[window] as number) + 1;
      if (here !== 'built-up') continue;
      builtUp[window] = (builtUp[window] as number) + 1;
      if (inCommercialBox(x, z)) {
        const kind = kindAt(corridor, x, z);
        if (kind !== undefined && URBAN_COMMERCIAL_KINDS.has(kind)) {
          commercial[window] = (commercial[window] as number) + 1;
        }
      }
    }
  }

  // 2. The footprints, each to the window its centroid is beside.
  const area = new Float64Array(windows);
  const footprints = new Uint32Array(windows);
  const midrise = new Uint32Array(windows);
  const towers = new Uint32Array(windows);
  const mapped: number[][] = Array.from({ length: windows }, () => []);
  const near: number[] = [];
  const beside: BesideTheRoad = { along: 0, lateral: 0, distance: 0 };
  for (const building of corridor.buildings) {
    const outer = building.rings[0];
    if (building.kind !== 'building' || outer === undefined || outer.length < 6) continue;
    let cx = 0;
    let cz = 0;
    const vertices = outer.length / 2;
    for (let i = 0; i + 1 < outer.length; i += 2) {
      cx += outer[i] as number;
      cz += outer[i + 1] as number;
    }
    cx /= vertices;
    cz /= vertices;
    let found = false;
    for (const within of FOOTPRINT_REACHES) {
      const nearRoad = roadSegmentsNear(profile, origin, cx, cz, within, near);
      if (nearestOnRoadSegments(nearRoad, near, cx, cz, beside) && beside.distance <= within) {
        found = true;
        break;
      }
    }
    if (!found) continue;
    const window = Math.min(windows - 1, Math.floor(beside.along / URBAN_WINDOW_METRES));
    let footprintArea = ringArea(outer);
    for (let hole = 1; hole < building.rings.length; hole += 1) {
      footprintArea -= ringArea(building.rings[hole] as Float32Array);
    }
    area[window] = (area[window] as number) + Math.max(0, footprintArea);
    footprints[window] = (footprints[window] as number) + 1;
    const storeys = storeysFor(building.heightMetres);
    if (storeys >= MIDRISE_STOREYS) midrise[window] = (midrise[window] as number) + 1;
    if (building.heightMetres !== null && Number.isFinite(building.heightMetres)) {
      (mapped[window] as number[]).push(storeys);
      if (storeys >= CITY_TOWER_STOREYS) towers[window] = (towers[window] as number) + 1;
    }
  }

  // 3. Each window's class, before smoothing.
  // Each sample stands for its share of the window: the sweep's spacing along, by its spacing across.
  const cellArea = stride * road.step * URBAN_SAMPLE_METRES;
  const towerWindows = Math.floor(CITY_TOWER_REACH_METRES / URBAN_WINDOW_METRES);
  const lifting = (corridor.places ?? []).filter(liftsAWindow);
  const reachSquared = PLACE_PRIOR_REACH_METRES * PLACE_PRIOR_REACH_METRES;
  /** Whether a lifting point stands within reach of the window's centre on the drawn road. */
  const nearLiftingPoint = (window: number): boolean => {
    const centre = Math.min(total, (window + 0.5) * URBAN_WINDOW_METRES);
    const point = Math.min(count - 1, Math.max(0, Math.round(centre / road.step)));
    const x = points[point * 2] as number;
    const z = points[point * 2 + 1] as number;
    return lifting.some((place) => {
      const dx = place.x - x;
      const dz = place.z - z;
      return dx * dx + dz * dz <= reachSquared;
    });
  };
  const codes = new Uint8Array(windows);
  for (let window = 0; window < windows; window += 1) {
    const sampled = samples[window] as number;
    if (sampled === 0 || (covered[window] as number) < sampled * URBAN_MIN_COVERED_SHARE) {
      codes[window] = UNKNOWN;
      continue;
    }
    const landSamples = land[window] as number;
    let nearTowers = 0;
    for (
      let other = Math.max(0, window - towerWindows);
      other <= Math.min(windows - 1, window + towerWindows);
      other += 1
    ) {
      nearTowers += towers[other] as number;
    }
    const footprintCount = footprints[window] as number;
    const coverage = landSamples === 0 ? 0 : (area[window] as number) / (landSamples * cellArea);
    const code = classify({
      coverage,
      commercial: landSamples === 0 ? 0 : (commercial[window] as number) / landSamples,
      builtUp: landSamples === 0 ? 0 : (builtUp[window] as number) / landSamples,
      medianStoreys: medianOf(mapped[window] as number[]),
      towers: nearTowers,
      midriseShare: footprintCount === 0 ? 0 : (midrise[window] as number) / footprintCount,
    });
    // 3a. The place prior, before the smoothing (ADR 0055 D-5.3).
    codes[window] =
      code === TOWN && coverage >= PLACE_PRIOR_MIN_COVERAGE && nearLiftingPoint(window)
        ? CITY
        : code;
  }

  // 4. The smoothing, within each stretch of covered windows.
  smooth(codes, Math.ceil(URBAN_MIN_RUN_METRES / URBAN_WINDOW_METRES));

  const loop = profile.loop;
  return {
    classAt: (alongMetres: number): UrbanClass => {
      let along = alongMetres;
      if (loop) along = ((along % total) + total) % total;
      // `NaN` fails both comparisons, so it is `unknown` too.
      if (!(along >= 0 && along <= total)) return 'unknown';
      const window = Math.min(windows - 1, Math.floor(along / URBAN_WINDOW_METRES));
      return CLASS_OF_CODE[codes[window] as number] as UrbanClass;
    },
  };
}

/** One run of equal codes. */
interface Run {
  code: number;
  length: number;
}

/**
 * Merges every run shorter than `minRun` windows into its neighbours, within
 * each stretch between `unknown` windows, in place.
 */
function smooth(codes: Uint8Array, minRun: number): void {
  let start = 0;
  while (start < codes.length) {
    if (codes[start] === UNKNOWN) {
      start += 1;
      continue;
    }
    let end = start;
    while (end < codes.length && codes[end] !== UNKNOWN) end += 1;
    smoothStretch(codes, start, end, minRun);
    start = end;
  }
}

/** {@link smooth} over the covered windows `[start, end)`. */
function smoothStretch(codes: Uint8Array, start: number, end: number, minRun: number): void {
  const runs: Run[] = [];
  for (let window = start; window < end; window += 1) {
    const last = runs[runs.length - 1];
    if (last !== undefined && last.code === codes[window]) last.length += 1;
    else runs.push({ code: codes[window] as number, length: 1 });
  }
  for (;;) {
    if (runs.length < 2) break;
    // The shortest run that is too short, the first of equals.
    let shortest = -1;
    for (const [index, run] of runs.entries()) {
      if (run.length >= minRun) continue;
      if (shortest === -1 || run.length < (runs[shortest] as Run).length) shortest = index;
    }
    if (shortest === -1) break;
    const run = runs[shortest] as Run;
    const before = runs[shortest - 1];
    const after = runs[shortest + 1];
    let into: Run;
    if (before === undefined) into = after as Run;
    else if (after === undefined) into = before;
    else into = after.length > before.length ? after : before;
    into.length += run.length;
    runs.splice(shortest, 1);
    // Its two neighbours, now side by side, are one run where they agree.
    if (before !== undefined && after !== undefined && before.code === after.code) {
      before.length += after.length;
      runs.splice(shortest, 1);
    }
  }
  let window = start;
  for (const run of runs) {
    codes.fill(run.code, window, window + run.length);
    window += run.length;
  }
}
