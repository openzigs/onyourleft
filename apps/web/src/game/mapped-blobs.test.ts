// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #1657: a ground blob under every drawn mapped building, in Node. The blobs
 * are read back off `GroundBlobBelt`'s own mesh — its instance count, its
 * instance matrices and its clip planes, which are what the GPU is handed —
 * after the belts run exactly as `three-renderer.ts` §`RealisticDrawing.groundScenery`
 * runs them: the structures' casters, then the mapped belt's
 * `grounded`, in one `update`. What needs a GPU (the lever reaching the
 * owner's page) is `realistic.browser.spec.ts` §"#1657".
 */

import { getHeapStatistics, GCProfiler } from 'node:v8';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { metres } from '@onyourleft/domain';

import type * as FootprintModule from './footprint-buildings';
import { footprintPlans, minimumAreaRectangle, type FootprintPlan } from './footprint-buildings';
import {
  buildingBeside,
  landBeside,
  mixedTownFixture,
  rectangleBeside,
  rowTownFixture,
} from './footprint-fixtures-testing';
import {
  blobCasters,
  GROUND_BLOB_LIFT_METRES,
  groundBlobAlpha,
  keptByRoadClip,
  ROAD_EDGE_METRES,
  type BlobCasters,
} from './ground-blob';
import { landClassMask } from './land-class';
import { mappedBuildingsOf, type MappedBuildings } from './mapped-buildings';
import {
  MAPPED_BUILDING_MAX,
  MAPPED_BUILDING_REACH_METRES,
  REALISTIC_GROUND_BLOBS,
  REALISTIC_STRUCTURE_ITEMS,
} from './realistic-budget';
import { PHOTOGRAPHIC_STRUCTURE_SURFACES } from './realistic-assets';
import { northRoute, hillRoute } from './route-fixtures-testing';
import { sceneFrame } from './scene';
import { atStartLine } from './simulation';
import { corridorOrigin, type CorridorPoint } from './terrain';
import {
  GroundBlobBelt,
  MappedBuildingBelt,
  refillMappedBuildings,
  structureCasters,
} from './three-renderer';
import type { SunStyle } from './world';

// The one function #1657 must call at a refill and never on a frame: counted.
vi.mock('./footprint-buildings', async (importOriginal) => {
  const actual = await importOriginal<typeof FootprintModule>();
  return { ...actual, minimumAreaRectangle: vi.fn(actual.minimumAreaRectangle) };
});
const rectangles = vi.mocked(minimumAreaRectangle);

/** A texture three would have loaded: the fields a material and a release read. */
function aTexture(): never {
  return { image: { width: 512, height: 512 }, dispose: () => undefined } as never;
}

const textures = new Map(
  PHOTOGRAPHIC_STRUCTURE_SURFACES.map((surface) => [
    surface,
    { colour: aTexture(), normal: aTexture() },
  ]),
);

const town = rowTownFixture();
const buildings = mappedBuildingsOf(
  footprintPlans(town.corridor, landClassMask(town.corridor), town.profile, town.origin).plans,
);
const mixed = mixedTownFixture();
const mixedLand = landClassMask(mixed.corridor);
const mixedBuildings = mappedBuildingsOf(
  footprintPlans(mixed.corridor, mixedLand, mixed.profile, mixed.origin).plans,
);

/** A sun straight overhead: no throw, so a blob is its caster's footprint exactly. */
const OVERHEAD: SunStyle = { x: 0, y: 1, z: 0, ambient: 0.4, direct: 0.6 };

const disposals: { dispose(): void }[] = [];

function kept<T extends { dispose(): void }>(thing: T): T {
  disposals.push(thing);
  return thing;
}

beforeEach(() => {
  rectangles.mockClear();
});

afterEach(() => {
  for (const thing of disposals.splice(0)) thing.dispose();
});

type Frame = ReturnType<typeof sceneFrame>;

/** The row town with the rider at `along`, as a realistic rung carries it. */
function townFrame(along: number, of: MappedBuildings = buildings): Frame {
  const start = atStartLine(town.profile);
  return sceneFrame({
    profile: town.profile,
    origin: town.origin,
    state: { ...start, ride: { ...start.ride, distance: metres(along) } },
    mappedBuildings: of,
    structureItems: REALISTIC_STRUCTURE_ITEMS,
  });
}

/** The heights `RealisticStructureBelts.heightOf` would answer; any will do here. */
const heightOf = (): number => 6;

/**
 * One frame of `RealisticDrawing`'s blob step: the mapped buildings refilled
 * (at a new chunk), the structures' casters written, and the belt updated from
 * the structures' list and then `mapped.grounded`, in that order.
 */
function groundFrame(
  frame: Frame,
  grounding: GroundBlobBelt,
  procedural: BlobCasters,
  mapped: MappedBuildingBelt | undefined,
  sun: SunStyle = OVERHEAD,
): void {
  const view = frame.mappedBuildings;
  if (mapped !== undefined && view !== undefined) {
    refillMappedBuildings(
      mapped,
      view,
      frame.scatter,
      frame.billboards.length,
      REALISTIC_STRUCTURE_ITEMS,
    );
  }
  structureCasters(frame.scatter, frame.camera, Number.POSITIVE_INFINITY, heightOf, procedural);
  const lists = mapped === undefined ? [procedural] : [procedural, mapped.grounded];
  grounding.update(lists, frame.corridor, frame.terrain.mesh, sun);
}

/** What one instance of the blob belt's mesh says, read off its matrix. */
interface DrawnBlob {
  readonly x: number;
  readonly z: number;
  /** The horizontal unit vector along its long axis. */
  readonly alongX: number;
  readonly alongZ: number;
  readonly halfAlong: number;
  readonly halfAcross: number;
}

function blobAt(grounding: GroundBlobBelt, slot: number): DrawnBlob {
  const m = grounding.mesh.instanceMatrix.array;
  const e = (at: number): number => m[slot * 16 + at] as number;
  // Column 1 is the ground's unit normal; the middle is lifted along it.
  const lift = GROUND_BLOB_LIFT_METRES;
  // Column 2 is the long axis laid into the ground's plane
  // (`ground-blob.ts` §`groundBlobAxes`): `h - n (h · n)` for the horizontal
  // `h`. Taken back out of the plane, through the normal, to the yaw it was.
  const back = e(9) / e(5);
  const hx = e(8) - e(4) * back;
  const hz = e(10) - e(6) * back;
  const flat = Math.hypot(hx, hz);
  return {
    x: e(12) - e(4) * lift,
    z: e(14) - e(6) * lift,
    alongX: hx / flat,
    alongZ: hz / flat,
    halfAlong: Math.hypot(e(8), e(9), e(10)),
    halfAcross: Math.hypot(e(0), e(1), e(2)),
  };
}

/** The drawn plans, nearest first, as the belt's own record says. */
function drawnPlans(belt: MappedBuildingBelt): number[] {
  const plans: number[] = [];
  for (let place = 0; ; place += 1) {
    const drawn = belt.drawnAt(place);
    if (drawn === undefined) return plans;
    plans.push(drawn.plan);
  }
}

/** Whether `(x, z)` is inside `ring`, by the even-odd rule. */
function inside(ring: Float32Array, x: number, z: number): boolean {
  let within = false;
  const n = ring.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i, i += 1) {
    const xi = ring[i * 2] as number;
    const zi = ring[i * 2 + 1] as number;
    const xj = ring[j * 2] as number;
    const zj = ring[j * 2 + 1] as number;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) within = !within;
  }
  return within;
}

describe('a ground blob under every drawn mapped building — #1657', () => {
  it('draws one per drawn building after the procedural ones, each its footprint’s minimum-area rectangle', () => {
    // #1581's mixed town: oblongs and Ls turned off the road, so a blob's
    // long and short halves, and its yaw, are each a claim.
    const start = atStartLine(mixed.profile);
    const frame = sceneFrame({
      profile: mixed.profile,
      origin: mixed.origin,
      state: { ...start, ride: { ...start.ride, distance: metres(1_300) } },
      worldCorridor: mixed.corridor,
      landClass: mixedLand,
      mappedBuildings: mixedBuildings,
      structureItems: REALISTIC_STRUCTURE_ITEMS,
    });
    const buildings = mixedBuildings;
    const grounding = kept(new GroundBlobBelt());
    const mapped = kept(new MappedBuildingBelt(buildings, textures));
    const procedural = blobCasters(REALISTIC_STRUCTURE_ITEMS);
    groundFrame(frame, grounding, procedural, mapped);
    // The control: the same frame with no mapped building, as `main` drew it.
    const before = kept(new GroundBlobBelt());
    groundFrame(frame, before, blobCasters(REALISTIC_STRUCTURE_ITEMS), undefined);

    const plans = drawnPlans(mapped);
    expect(plans.length).toBe(mapped.stats.buildings);
    expect(plans.length).toBeGreaterThan(0);
    // Non-vacuity: oblong footprints, turned off the axes.
    const oblong = plans.filter((index) => {
      const rectangle = minimumAreaRectangle((buildings.plans[index] as FootprintPlan).footprint);
      return rectangle.halfLong - rectangle.halfShort > 0.5 && Math.abs(rectangle.ux) > 0.05;
    });
    expect(oblong.length).toBeGreaterThan(plans.length / 2);
    expect(grounding.mesh.visible).toBe(true);
    // The ground the frame built starts at the corridor's first row, some
    // 60 m behind the rider: a blob whose middle is behind it has nothing to
    // lie on (`GroundBlobBelt.update`'s rule, #620's), and none is drawn.
    const [first, second] = frame.corridor.centre;
    if (first === undefined || second === undefined) throw new Error('the frame has no road');
    const headX = second.x - first.x;
    const headZ = second.z - first.z;
    const onGround = plans.filter((index) => {
      const rectangle = minimumAreaRectangle((buildings.plans[index] as FootprintPlan).footprint);
      return (rectangle.cx - first.x) * headX + (rectangle.cz - first.z) * headZ > 0;
    });
    // Non-vacuity both ways: most are on it, and the reach behind the rider is not.
    expect(onGround.length).toBeGreaterThan(plans.length / 2);
    expect(onGround.length).toBeLessThan(plans.length);
    expect(grounding.mesh.count).toBe(before.mesh.count + onGround.length);
    onGround.forEach((index, place) => {
      const plan = buildings.plans[index] as FootprintPlan;
      const rectangle = minimumAreaRectangle(plan.footprint);
      const blob = blobAt(grounding, before.mesh.count + place);
      expect(Math.hypot(blob.x - rectangle.cx, blob.z - rectangle.cz)).toBeLessThan(0.01);
      expect(Math.abs(blob.halfAlong - rectangle.halfLong)).toBeLessThan(0.01);
      expect(Math.abs(blob.halfAcross - rectangle.halfShort)).toBeLessThan(0.01);
      // The long axis, compared at its ends: within 1 cm, whichever way it points.
      const sign = Math.sign(blob.alongX * rectangle.ux + blob.alongZ * rectangle.uz) || 1;
      const endX = (blob.alongX * sign - rectangle.ux) * rectangle.halfLong;
      const endZ = (blob.alongZ * sign - rectangle.uz) * rectangle.halfLong;
      expect(Math.hypot(endX, endZ)).toBeLessThan(0.01);
    });
  });

  it('grounds exactly the drawn set where more than MAPPED_BUILDING_MAX are in reach, and nothing undrawn', () => {
    const frame = townFrame(1_500);
    const view = frame.mappedBuildings;
    if (view === undefined) throw new Error('the frame carries no mapped buildings');
    const inReach = buildings.plans.filter(
      (plan) =>
        Math.hypot(plan.centroid.x - view.x, plan.centroid.z - view.z) <=
        MAPPED_BUILDING_REACH_METRES,
    ).length;
    expect(inReach).toBeGreaterThan(MAPPED_BUILDING_MAX);
    const grounding = kept(new GroundBlobBelt());
    const mapped = kept(new MappedBuildingBelt(buildings, textures));
    const procedural = blobCasters(REALISTIC_STRUCTURE_ITEMS);
    groundFrame(frame, grounding, procedural, mapped);
    const drawn = new Set(drawnPlans(mapped));
    expect(drawn.size).toBeLessThanOrEqual(MAPPED_BUILDING_MAX);
    expect(drawn.size).toBeLessThan(inReach);
    const first = grounding.mesh.count - mapped.grounded.count;
    expect(mapped.grounded.count).toBe(drawn.size);
    let under = 0;
    for (let slot = first; slot < grounding.mesh.count; slot += 1) {
      const blob = blobAt(grounding, slot);
      buildings.plans.forEach((plan, index) => {
        if (!inside(plan.footprint, blob.x, blob.z)) return;
        expect(drawn.has(index), 'a blob stands under a building the selection did not draw').toBe(
          true,
        );
        under += 1;
      });
    }
    // Each blob's middle is inside its own footprint, and in no other.
    expect(under).toBe(drawn.size);
  });

  it('grounds no mapped building while the belt draws none: switched off, hidden or not carried', () => {
    const frame = townFrame(1_500);
    const mapped = kept(new MappedBuildingBelt(buildings, textures));
    const view = frame.mappedBuildings;
    if (view === undefined) throw new Error('the frame carries no mapped buildings');
    refillMappedBuildings(mapped, view, frame.scatter, 0, REALISTIC_STRUCTURE_ITEMS);
    expect(mapped.grounded.count).toBeGreaterThan(0);
    mapped.switchOn(false);
    expect(mapped.grounded.count).toBe(0);
    mapped.switchOn(true);
    mapped.setShown(false);
    expect(mapped.grounded.count).toBe(0);
    mapped.setShown(true);
    mapped.setCarried(false);
    expect(mapped.grounded.count).toBe(0);
    mapped.setCarried(true);
    expect(mapped.grounded.count).toBe(mapped.stats.buildings);
  });
});

describe('no per-frame work for the mapped blobs — #1657, #240 NFR-3', () => {
  it('works out the rectangles at a refill, and not on the 10 frames after it in one chunk', () => {
    const grounding = kept(new GroundBlobBelt());
    const mapped = kept(new MappedBuildingBelt(buildings, textures));
    const procedural = blobCasters(REALISTIC_STRUCTURE_ITEMS);
    groundFrame(townFrame(1_510), grounding, procedural, mapped);
    // Non-vacuity: the refill did call it, once a drawn building.
    expect(rectangles).toHaveBeenCalledTimes(mapped.stats.buildings);
    expect(mapped.refills).toBe(1);
    rectangles.mockClear();
    for (let at = 0; at < 10; at += 1) {
      groundFrame(townFrame(1_511 + at * 5), grounding, procedural, mapped);
    }
    expect(mapped.refills).toBe(1);
    expect(rectangles).not.toHaveBeenCalled();
    expect(grounding.mesh.count).toBeGreaterThan(mapped.stats.buildings);
  });

  /*
   * ⚠️ **The caster fill, not `GroundBlobBelt.update`.** On `main` the belt's
   * update itself is collected under on every attempt in Node (#1657's PR
   * records it), whatever list it is handed, so it is left out of this
   * window: what #1657 adds to a frame is the fill below.
   */
  it('allocates nothing filling the casters on a frame that is not a refill', () => {
    const frame = townFrame(1_510);
    const view = frame.mappedBuildings;
    if (view === undefined) throw new Error('the frame carries no mapped buildings');
    const grounding = kept(new GroundBlobBelt());
    const mapped = kept(new MappedBuildingBelt(buildings, textures));
    const procedural = blobCasters(REALISTIC_STRUCTURE_ITEMS);
    groundFrame(frame, grounding, procedural, mapped);
    const lists: BlobCasters[] = [procedural, mapped.grounded];
    let sink = 0;
    const frames = (count: number): void => {
      for (let at = 0; at < count; at += 1) {
        refillMappedBuildings(mapped, view, frame.scatter, 0, REALISTIC_STRUCTURE_ITEMS);
        structureCasters(frame.scatter, frame.camera, Infinity, heightOf, procedural);
        const grounded = mapped.grounded;
        lists[1] = grounded;
        sink += grounded.count;
      }
    };
    frames(20_000);
    const attempts: string[] = [];
    let measured = false;
    for (let attempt = 0; attempt < 8 && !measured; attempt += 1) {
      const profiler = new GCProfiler();
      profiler.start();
      const before = getHeapStatistics().used_heap_size;
      frames(20_000);
      const after = getHeapStatistics().used_heap_size;
      const { statistics } = profiler.stop();
      if (statistics.length > 0) {
        attempts.push('collected');
        continue;
      }
      measured = true;
      expect(after - before).toBeLessThan(64 * 1024);
    }
    expect(measured, attempts.join(', ')).toBe(true);
    expect(mapped.refills).toBe(1);
    expect(sink).toBeGreaterThan(0);
  });
});

describe('the procedural blobs, unchanged by the mapped ones — #1657', () => {
  /** Every buffer the blob belt hands the GPU, up to what it draws, as bytes. */
  function bytesOf(grounding: GroundBlobBelt, count = grounding.mesh.count): number[] {
    const geometry = grounding.mesh.geometry;
    const of = (array: ArrayLike<number>, size: number): number[] =>
      Array.from(
        new Uint8Array(Float32Array.from(Array.from(array).slice(0, count * size)).buffer),
      );
    return [
      ...of(grounding.mesh.instanceMatrix.array, 16),
      ...of(geometry.getAttribute('blobClipFirst').array, 3),
      ...of(geometry.getAttribute('blobClipSecond').array, 3),
      ...of(geometry.getAttribute('blobStrength').array, 1),
    ];
  }

  it('draws a village with no corridor byte for byte as before, the mapped list empty', () => {
    const profile = hillRoute();
    const start = atStartLine(profile);
    // A village on the hill route, with no corridor: 20 structures in the frame.
    const frame = sceneFrame({
      profile,
      origin: corridorOrigin(profile),
      state: { ...start, ride: { ...start.ride, distance: metres(1_000) } },
      structureItems: REALISTIC_STRUCTURE_ITEMS,
    });
    const casters = blobCasters(REALISTIC_STRUCTURE_ITEMS);
    structureCasters(frame.scatter, frame.camera, Infinity, heightOf, casters);
    expect(casters.count).toBeGreaterThan(0);
    expect(frame.mappedBuildings).toBeUndefined();
    const before = kept(new GroundBlobBelt());
    groundFrame(frame, before, blobCasters(REALISTIC_STRUCTURE_ITEMS), undefined);
    // A mapped belt that this frame does not carry, as `updateMapped` leaves it.
    const idle = kept(new MappedBuildingBelt(buildings, textures));
    idle.setCarried(false);
    const after = kept(new GroundBlobBelt());
    groundFrame(frame, after, blobCasters(REALISTIC_STRUCTURE_ITEMS), idle);
    expect(before.mesh.count).toBeGreaterThan(0);
    expect(after.mesh.count).toBe(before.mesh.count);
    expect(bytesOf(after)).toEqual(bytesOf(before));
  });

  it('keeps every procedural blob in its slot, byte for byte, with the town grounded after them', () => {
    const frame = townFrame(1_500);
    const before = kept(new GroundBlobBelt());
    groundFrame(frame, before, blobCasters(REALISTIC_STRUCTURE_ITEMS), undefined);
    const after = kept(new GroundBlobBelt());
    const mapped = kept(new MappedBuildingBelt(buildings, textures));
    groundFrame(frame, after, blobCasters(REALISTIC_STRUCTURE_ITEMS), mapped);
    expect(after.mesh.count).toBeGreaterThan(before.mesh.count);
    expect(bytesOf(after, before.mesh.count)).toEqual(bytesOf(before));
  });
});

describe('room for every blob a frame can carry — #1657, ruling (d)', () => {
  it('draws a full list of each kind at once: the vegetation’s, the structures’ and the town’s', () => {
    const frame = townFrame(1_500);
    // Every caster at one point beside the road, where there is ground to lie on.
    const point = frame.corridor.centre[Math.floor(frame.corridor.centre.length / 2)];
    if (point === undefined) throw new Error('the frame has no road');
    const full = (capacity: number): BlobCasters => {
      const list = blobCasters(capacity);
      for (const caster of list.casters) {
        caster.x = point.x + 40;
        caster.z = point.z;
        caster.y = point.y;
        caster.halfAcross = 2;
        caster.halfAlong = 2;
        caster.height = 4;
      }
      list.count = capacity;
      return list;
    };
    const vegetation = REALISTIC_GROUND_BLOBS - REALISTIC_STRUCTURE_ITEMS - MAPPED_BUILDING_MAX;
    const grounding = kept(new GroundBlobBelt());
    grounding.update(
      [full(vegetation), full(REALISTIC_STRUCTURE_ITEMS), full(MAPPED_BUILDING_MAX)],
      frame.corridor,
      frame.terrain.mesh,
      OVERHEAD,
    );
    // #620's 62 and the town's 36: every one drawn, the last list included.
    expect(vegetation).toBe(26);
    expect(grounding.mesh.count).toBe(62 + MAPPED_BUILDING_MAX);
  });
});

describe('a mapped building beside the carriageway darkens none of it — #1657', () => {
  const profile = northRoute(3_000, () => 10);
  const origin = corridorOrigin(profile);
  /** Its near wall 4.3 m from the centreline: 0.8 m off the carriageway's edge. */
  const corridor = {
    routeId: 'kerbside',
    origin,
    covered: () => true,
    coveredBoxes: [{ minX: -1_000, maxX: 1_000, minZ: -500, maxZ: 3_500 }],
    landUse: [landBeside(profile, origin, 'landuse', 'residential', 900, 1_100, -100, 100)],
    buildings: [buildingBeside(profile, origin, [rectangleBeside(1_000, 8.3, 8, 8)], 6)],
    paths: [],
    streets: [],
  };
  const kerbside = mappedBuildingsOf(
    footprintPlans(corridor, landClassMask(corridor), profile, origin).plans,
  );

  /** The distance from `(x, z)` to the drawn centreline, over its chords. */
  function fromCentre(centre: readonly CorridorPoint[], x: number, z: number): number {
    let nearest = Number.POSITIVE_INFINITY;
    for (let at = 0; at + 1 < centre.length; at += 1) {
      const a = centre[at] as CorridorPoint;
      const b = centre[at + 1] as CorridorPoint;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const length = dx * dx + dz * dz;
      const t =
        length > 0 ? Math.min(1, Math.max(0, ((x - a.x) * dx + (z - a.z) * dz) / length)) : 0;
      nearest = Math.min(nearest, Math.hypot(a.x + dx * t - x, a.z + dz * t - z));
    }
    return nearest;
  }

  it('clips its blob at the road’s edge, under a sun that throws it across the road', () => {
    expect(kerbside.plans.length).toBe(1);
    const plan = kerbside.plans[0] as FootprintPlan;
    const start = atStartLine(profile);
    const frame = sceneFrame({
      profile,
      origin,
      state: { ...start, ride: { ...start.ride, distance: metres(990) } },
      mappedBuildings: kerbside,
      structureItems: REALISTIC_STRUCTURE_ITEMS,
    });
    const centre = frame.corridor.centre;
    // The fixture's own claim: the rectangle comes within 1 m of the carriageway.
    let nearest = Number.POSITIVE_INFINITY;
    for (let at = 0; at + 1 < plan.footprint.length; at += 2) {
      nearest = Math.min(
        nearest,
        fromCentre(centre, plan.footprint[at] as number, plan.footprint[at + 1] as number),
      );
    }
    expect(nearest - ROAD_EDGE_METRES).toBeGreaterThan(0);
    expect(nearest - ROAD_EDGE_METRES).toBeLessThan(1);
    // A low sun beyond the house, so its shadow is thrown towards the road:
    // the road runs north, so the house is across it in x.
    const side = Math.sign(plan.centroid.x - (centre[0]?.x ?? 0)) || 1;
    const sun: SunStyle = { x: side * 0.8, y: 0.6, z: 0, ambient: 0.4, direct: 0.6 };
    const grounding = kept(new GroundBlobBelt());
    const mapped = kept(new MappedBuildingBelt(kerbside, textures));
    groundFrame(frame, grounding, blobCasters(REALISTIC_STRUCTURE_ITEMS), mapped, sun);
    expect(mapped.grounded.count).toBe(1);
    const slot = grounding.mesh.count - 1;
    expect(slot).toBeGreaterThanOrEqual(0);
    const m = grounding.mesh.instanceMatrix.array;
    const e = (at: number): number => m[slot * 16 + at] as number;
    const geometry = grounding.mesh.geometry;
    const planes = new Float32Array(6);
    planes.set(
      Array.from(geometry.getAttribute('blobClipFirst').array).slice(slot * 3, slot * 3 + 3),
    );
    planes.set(
      Array.from(geometry.getAttribute('blobClipSecond').array).slice(slot * 3, slot * 3 + 3),
      3,
    );
    let onRoad = 0;
    let darkenedOnRoad = 0;
    let darkened = 0;
    for (let i = -20; i <= 20; i += 1) {
      for (let j = -20; j <= 20; j += 1) {
        const u = i / 20;
        const v = j / 20;
        if (groundBlobAlpha(Math.hypot(u, v)) <= 0) continue;
        // Where the fragment is from the middle, horizontally: the shader's frame.
        const dx = e(0) * u + e(8) * v;
        const dz = e(2) * u + e(10) * v;
        const road = fromCentre(centre, e(12) + dx, e(14) + dz) < ROAD_EDGE_METRES;
        if (road) onRoad += 1;
        if (!keptByRoadClip(planes, 0, dx, dz)) continue;
        darkened += 1;
        if (road) darkenedOnRoad += 1;
      }
    }
    // Non-vacuity: the blob reaches over the road, and darkens the verge.
    expect(onRoad).toBeGreaterThan(0);
    expect(darkened).toBeGreaterThan(0);
    expect(darkenedOnRoad).toBe(0);
  });
});
