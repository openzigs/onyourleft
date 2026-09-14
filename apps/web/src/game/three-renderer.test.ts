// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The scenery belt — #244 — asserted where the rest of `game/` is asserted.
 *
 * ## Why there is a renderer test at all, when there never was one before
 *
 * `three-renderer.ts` has had no unit test since #91, and that was the right
 * answer while everything in it needed a GL context: jsdom implements no WebGL,
 * `new WebGLRenderer(...)` throws there, and `game/port.ts` records that the
 * browser gate is what checks the part that genuinely needs a driver.
 *
 * #244 adds something different in kind. **One `InstancedMesh` per
 * `ScatterKind`, grown and reused, with a cull** is arithmetic over three
 * objects that need no context at all — an `InstancedMesh` is a matrix buffer
 * and a count, and both can be read in a terminal. Every claim #244's criteria
 * make about instancing is therefore checkable here, which is where it belongs:
 * a phone is a slow place to discover that five hundred trees became five
 * hundred draw calls.
 *
 * ## What this file deliberately cannot check, said plainly
 *
 * ⚠️ **That the belt is in the scene, and that it reaches the screen.** A
 * `ScatterBelt` that {@link ThreeGameView} never added, or added and then never
 * updated, satisfies every assertion below — that is #240's named defect shape
 * for this epic (*"geometry that is computed, asserted in jsdom, and never
 * drawn"*), and no assertion at this level can see it. `game.browser.spec.ts`
 * is the half that can: it counts the driver's own draw calls and reads the
 * drawing buffer back beside the road, with scenery and without.
 *
 * ⚠️ **And `instanceMatrix.needsUpdate` is asserted through `version`**, which
 * is not a workaround. three's `BufferAttribute` declares a **setter and no
 * getter** for `needsUpdate`: reading it back gives `undefined` whatever was
 * assigned, and `version` is both what the setter increments and what the
 * renderer actually consults before it re-uploads. A test that read the flag
 * would pass against a renderer that never set it.
 */

import { describe, expect, it } from 'vitest';

import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  metres,
  routeProfile,
  type RoutePoint,
} from '@onyourleft/domain';

import { sceneFrame } from './scene';
import { atStartLine } from './simulation';
import { corridorOrigin } from './terrain';

import { qualitySettings } from './quality';
import { SCATTER_KINDS, type ScatterItem, type ScatterKind } from './scatter';
import { VIEW_AHEAD_METRES, VIEW_BEHIND_METRES } from './terrain';
import {
  SCATTER_INSTANCE_CAPACITY,
  SCATTER_LATERAL_METRES,
  ScatterBelt,
  threeGameRenderer,
} from './three-renderer';
import type { CameraPose, SceneFrame } from './port';

/** A rider at the origin, facing +z, so `along` is `z` and `across` is `x`. */
const POSE: CameraPose = { x: 0, y: 0, z: 0, headingX: 0, headingZ: 1 };

function item(overrides: Partial<ScatterItem> = {}): ScatterItem {
  return { kind: 'shrub', x: 3, y: 0, z: 10, rotation: 0, scale: 1, ...overrides };
}

/** How many instances the belt would submit in total, across every kind. */
function submitted(belt: ScatterBelt): number {
  let total = 0;
  for (const mesh of belt.meshes.values()) {
    total += mesh.count;
  }
  return total;
}

/**
 * The position of one instance, read out of the matrix buffer three uploads.
 *
 * Column-major, so the translation is elements 12 to 14 of each sixteen-float
 * block. Read from the buffer rather than from a `Matrix4` the test composed
 * itself, which is the "wrong harness" cause of this program's named defect:
 * an assertion against the object the test just built proves nothing about what
 * was written.
 */
function instancePosition(
  belt: ScatterBelt,
  kind: ScatterKind,
  index: number,
): readonly [number, number, number] {
  const mesh = belt.meshes.get(kind);
  if (mesh === undefined) {
    throw new Error(`no mesh for ${kind}`);
  }
  const at = index * 16;
  const matrix = mesh.instanceMatrix.array;
  return [matrix[at + 12] ?? NaN, matrix[at + 13] ?? NaN, matrix[at + 14] ?? NaN];
}

describe('the scenery belt is one mesh per kind, not one per item', () => {
  it('holds six meshes for five hundred items', () => {
    // #244's first criterion, and the failure it prevents is invisible until a
    // phone is in hand: a per-item `Mesh` is a per-item draw call, and #240's
    // NFR-2 says draw calls are the budget.
    const belt = new ScatterBelt();
    const items: ScatterItem[] = [];
    for (let index = 0; index < 500; index += 1) {
      items.push(
        item({
          kind: SCATTER_KINDS[index % SCATTER_KINDS.length] as ScatterKind,
          x: (index % 21) - 10,
          z: index % 300,
        }),
      );
    }

    belt.update(items, POSE);

    expect(belt.meshes.size).toBeLessThanOrEqual(SCATTER_KINDS.length);
    expect(belt.meshes.size).toBe(6);
    // Non-vacuity: six meshes holding nothing would pass the line above.
    expect(submitted(belt)).toBe(500);
  });

  it('has a mesh for every kind `scatter.ts` can place', () => {
    // A kind with no mesh is scenery that is placed and never drawn, silently.
    const belt = new ScatterBelt();

    for (const kind of SCATTER_KINDS) {
      expect(belt.meshes.get(kind)).toBeDefined();
    }
  });

  it('gives each kind its own geometry and its own material', () => {
    // Two kinds sharing a mesh would draw a conifer as a rock, and two kinds
    // sharing a material would make the colour of one depend on the other.
    const belt = new ScatterBelt();
    const geometries = new Set<unknown>();
    const materials = new Set<unknown>();

    for (const mesh of belt.meshes.values()) {
      geometries.add(mesh.geometry);
      materials.add(mesh.material);
    }

    expect(geometries.size).toBe(SCATTER_KINDS.length);
    expect(materials.size).toBe(SCATTER_KINDS.length);
  });

  it('submits nothing before a frame has arrived', () => {
    // three's own `InstancedMesh` constructor fills every slot with the
    // identity matrix and sets `count` to the capacity, so a belt that did not
    // rewind would draw a stack of scenery at the corridor origin.
    const belt = new ScatterBelt();

    expect(submitted(belt)).toBe(0);
  });
});

describe('the belt is reused rather than reallocated', () => {
  it('holds the same meshes and the same buffers at frame 100 as at frame 1', () => {
    // #244's second criterion. #240's NFR-3, and the rebuild runs on the same
    // JavaScript thread GATT notifications arrive on — an allocation here is a
    // dropped sensor sample, not only a stutter.
    const belt = new ScatterBelt();
    const frame = (index: number): readonly ScatterItem[] =>
      Array.from({ length: 1 + (index % 40) }, (_, at) =>
        item({ kind: 'tree-conifer', x: (at % 9) - 4, z: at * 3 + (index % 7) }),
      );

    belt.update(frame(0), POSE);
    const conifer = belt.meshes.get('tree-conifer');
    const meshAtFirstFrame = conifer;
    const attributeAtFirstFrame = conifer?.instanceMatrix;
    const bufferAtFirstFrame = conifer?.instanceMatrix.array;
    const countAtFirstFrame = conifer?.count;

    for (let index = 1; index < 100; index += 1) {
      belt.update(frame(index), POSE);
    }

    expect(belt.meshes.get('tree-conifer')).toBe(meshAtFirstFrame);
    expect(belt.meshes.get('tree-conifer')?.instanceMatrix).toBe(attributeAtFirstFrame);
    expect(belt.meshes.get('tree-conifer')?.instanceMatrix.array).toBe(bufferAtFirstFrame);
    // Non-vacuity: the count has to have moved, or the three lines above are a
    // claim about a belt that was handed the same frame a hundred times.
    expect(belt.meshes.get('tree-conifer')?.count).not.toBe(countAtFirstFrame);
  });

  it('reserves room for every kind before the first frame, not when a kind appears', () => {
    // ⚠️ The reason this is asserted rather than left to the growth path:
    // three creates a GPU buffer the first time it *draws* an object, so a belt
    // that sized a kind's matrices the frame that kind first appeared would
    // allocate four hundred metres into a ride — a per-frame allocation late
    // enough that no gate would catch it.
    const belt = new ScatterBelt();

    for (const kind of SCATTER_KINDS) {
      expect(belt.meshes.get(kind)?.instanceMatrix.count).toBe(SCATTER_INSTANCE_CAPACITY);
    }
  });

  it('grows the buffer, and keeps the mesh, when a caller exceeds the budget', () => {
    // A caller that ignores `SCATTER_MAX_ITEMS` is handed more room rather than
    // silently truncated: scenery a caller placed and the screen never showed
    // is #240's named defect shape for this epic.
    const belt = new ScatterBelt();
    const tooMany = SCATTER_INSTANCE_CAPACITY + 17;
    const items = Array.from({ length: tooMany }, (_, at) =>
      item({ kind: 'rock', x: (at % 21) - 10, z: at % 300 }),
    );

    const before = belt.meshes.get('rock');
    belt.update(items, POSE);

    expect(belt.meshes.get('rock')).toBe(before);
    expect(belt.meshes.get('rock')?.instanceMatrix.count).toBeGreaterThanOrEqual(tooMany);
    expect(belt.meshes.get('rock')?.count).toBe(tooMany);
  });

  it('grows geometrically, so a caller one over the budget does not reallocate every frame', () => {
    // ⚠️ Replacing `instanceMatrix` **strands the previous GL buffer**: three
    // frees an instance buffer only in `onInstancedMeshDispose`, which removes
    // the attribute the mesh holds at that moment. Sizing the replacement to
    // exactly what was asked for would strand one buffer per frame for a caller
    // that sits one item over the budget — the per-frame-allocation shape
    // #240's NFR-3 forbids, arriving on the one path built for a caller who
    // ignores the budget.
    const belt = new ScatterBelt();
    const rocks = (count: number): ScatterItem[] =>
      Array.from({ length: count }, (_, at) =>
        item({ kind: 'rock', x: (at % 21) - 10, z: at % 300 }),
      );

    belt.update(rocks(SCATTER_INSTANCE_CAPACITY + 1), POSE);
    const grown = belt.meshes.get('rock')?.instanceMatrix;
    expect(grown?.count).toBeGreaterThanOrEqual(SCATTER_INSTANCE_CAPACITY * 2);

    // One more item, and the buffer is the same object: the growth already
    // made room. Sized to `needed`, this would be a second allocation.
    belt.update(rocks(SCATTER_INSTANCE_CAPACITY + 2), POSE);
    expect(belt.meshes.get('rock')?.instanceMatrix).toBe(grown);
  });
});

describe('the matrices that are written are the matrices that are uploaded', () => {
  it('raises the upload version when an item moves', () => {
    // #244's third criterion, and the "wrong time" cause of this epic's named
    // defect in its purest form: three uploads an instance buffer the first
    // time it binds it and thereafter only when this version has moved, so
    // without it the matrix is written, the test asserting the matrix passes,
    // and the screen never changes.
    const belt = new ScatterBelt();
    belt.update([item({ kind: 'rock', x: 4, z: 20 })], POSE);
    const rock = belt.meshes.get('rock');
    const versionBefore = rock?.instanceMatrix.version ?? -1;

    belt.update([item({ kind: 'rock', x: 4, z: 30 })], POSE);

    expect(rock?.instanceMatrix.version).toBeGreaterThan(versionBefore);
    // And the matrix really did move, so the version above is not being raised
    // over an unchanged buffer.
    expect(instancePosition(belt, 'rock', 0)).toEqual([4, 0, 30]);
  });

  it('writes position, rotation and scale into the instance matrix', () => {
    // The scale is the one that would be silently dropped: an item drawn at
    // scale 0 is an item that is submitted, counted, and invisible.
    const belt = new ScatterBelt();

    belt.update(
      [item({ kind: 'post', x: -6, y: 2, z: 40, rotation: Math.PI / 2, scale: 1.4 })],
      POSE,
    );

    const post = belt.meshes.get('post');
    expect(instancePosition(belt, 'post', 0)).toEqual([-6, 2, 40]);
    // Column-major: the first column is the rotated, scaled x axis. A quarter
    // turn about y sends it to (0, 0, -scale).
    const matrix = post?.instanceMatrix.array ?? new Float32Array(16);
    expect(matrix[0] ?? NaN).toBeCloseTo(0, 5);
    expect(matrix[2] ?? NaN).toBeCloseTo(-1.4, 5);
    // The middle of the diagonal is the y scale, untouched by a yaw.
    expect(matrix[5] ?? NaN).toBeCloseTo(1.4, 5);
  });

  it('packs the survivors from the front, leaving no hole for a culled item', () => {
    // A belt that wrote each item at its index in the caller's array and then
    // set `count` to the number of survivors would draw the wrong subset —
    // and every count assertion in this file would still pass.
    const belt = new ScatterBelt();

    belt.update(
      [
        item({ kind: 'shrub', x: 0, z: 900 }),
        item({ kind: 'shrub', x: 1, z: 50 }),
        item({ kind: 'shrub', x: 0, z: 900 }),
        item({ kind: 'shrub', x: 2, z: 60 }),
      ],
      POSE,
    );

    expect(belt.meshes.get('shrub')?.count).toBe(2);
    expect(instancePosition(belt, 'shrub', 0)).toEqual([1, 0, 50]);
    expect(instancePosition(belt, 'shrub', 1)).toEqual([2, 0, 60]);
  });
});

describe('the cull, which is the thing this renderer has never had to do', () => {
  it('drops what is too far ahead and what is too far behind', () => {
    // #244's fourth criterion. `count` is what a driver is asked to draw, so
    // `count` is what this asserts — a belt that left the instances in place
    // and only set `visible` would submit all three.
    const belt = new ScatterBelt();

    belt.update(
      [
        item({ kind: 'shrub', z: 800 }),
        item({ kind: 'shrub', z: -300 }),
        item({ kind: 'shrub', z: 50 }),
      ],
      POSE,
    );

    expect(belt.meshes.get('shrub')?.count).toBe(1);
    expect(instancePosition(belt, 'shrub', 0)[2]).toBe(50);
  });

  it('keeps what is exactly at the corridor bounds', () => {
    // The corridor is built to these two distances, so scenery that stopped a
    // metre short of them would leave a visible bare strip at the far end of
    // the road. Stated against the imported constants, so the two cannot drift.
    const belt = new ScatterBelt();

    belt.update(
      [
        item({ kind: 'shrub', z: VIEW_AHEAD_METRES }),
        item({ kind: 'shrub', z: -VIEW_BEHIND_METRES }),
      ],
      POSE,
    );

    expect(belt.meshes.get('shrub')?.count).toBe(2);
  });

  it('drops what is far off the road to the side', () => {
    // The lateral half of #244's fourth criterion, and the bound nothing in
    // this repository had before it.
    const belt = new ScatterBelt();

    belt.update(
      [
        item({ kind: 'rock', x: 200, z: 10 }),
        item({ kind: 'rock', x: -200, z: 10 }),
        item({ kind: 'rock', x: 10, z: 10 }),
      ],
      POSE,
    );

    expect(belt.meshes.get('rock')?.count).toBe(1);
    expect(instancePosition(belt, 'rock', 0)[0]).toBe(10);
  });

  it('keeps everything the placement band can actually reach', () => {
    // `scatter.ts` never puts anything further than 21 m from the centreline,
    // so a cull that clipped the band would be culling the scenery it exists
    // to draw. The bound is twice that, and both edges of the band survive.
    const belt = new ScatterBelt();

    belt.update(
      [
        item({ kind: 'rock', x: SCATTER_LATERAL_METRES / 2, z: 10 }),
        item({ kind: 'rock', x: -SCATTER_LATERAL_METRES / 2, z: 10 }),
        item({ kind: 'rock', x: SCATTER_LATERAL_METRES, z: 10 }),
      ],
      POSE,
    );

    expect(belt.meshes.get('rock')?.count).toBe(3);
  });

  it("measures along the rider's heading rather than along an axis", () => {
    // Facing -x, an item 50 m up the road is at x = -50 and an item at
    // z = 50 is 50 m to the side. A cull written against the world axes would
    // agree with this file's other tests exactly and be wrong on every bend.
    const belt = new ScatterBelt();
    const facingWest: CameraPose = { x: 0, y: 0, z: 0, headingX: -1, headingZ: 0 };

    belt.update(
      [
        item({ kind: 'shrub', x: -300, z: 0 }),
        item({ kind: 'shrub', x: 300, z: 0 }),
        item({ kind: 'shrub', x: 0, z: 300 }),
      ],
      facingWest,
    );

    expect(belt.meshes.get('shrub')?.count).toBe(1);
    expect(instancePosition(belt, 'shrub', 0)[0]).toBe(-300);
  });

  it('leaves `frustumCulled` alone on every scatter mesh', () => {
    // #244's fifth criterion, which exists because copying the road's
    // `frustumCulled = false` across is the specific mistake to make here. The
    // road is one ribbon rebuilt in front of the camera every frame; a scatter
    // belt stands beside the road and three's own culling is worth having.
    const belt = new ScatterBelt();

    for (const mesh of belt.meshes.values()) {
      expect(mesh.frustumCulled).not.toBe(false);
    }
  });

  it('recomputes the bounding sphere three culls it against', () => {
    // The price of leaving `frustumCulled` alone: three caches a bounding
    // sphere until something asks for a new one, and the instances move every
    // frame. Without this the belt is culled against where it stood when the
    // sphere was first needed and the scenery vanishes as the rider rides.
    const belt = new ScatterBelt();

    belt.update([item({ kind: 'rock', x: 0, z: 20 })], POSE);
    const first = belt.meshes.get('rock')?.boundingSphere?.center.z ?? NaN;
    belt.update([item({ kind: 'rock', x: 0, z: 300 })], POSE);
    const second = belt.meshes.get('rock')?.boundingSphere?.center.z ?? NaN;

    expect(first).toBeCloseTo(20, 1);
    expect(second).toBeCloseTo(300, 1);
  });

  it('hides a kind that has nothing in it, as well as counting it out', () => {
    // `count` is the claim; `visible` is what keeps an empty mesh out of the
    // render list altogether. A kind that emptied and stayed visible would be
    // projected and bound every frame for no pixels.
    const belt = new ScatterBelt();

    belt.update([item({ kind: 'shrub', z: 20 })], POSE);
    expect(belt.meshes.get('shrub')?.visible).toBe(true);

    belt.update([item({ kind: 'rock', z: 20 })], POSE);
    expect(belt.meshes.get('shrub')?.visible).toBe(false);
    expect(belt.meshes.get('shrub')?.count).toBe(0);
  });
});

describe('the cull against what `scene.ts` actually hands it', () => {
  /**
   * ⚠️ **Every other test in this file builds its own items, and that is the
   * "wrong harness" cause of this program's named defect waiting to happen**:
   * a cull written in the wrong frame, or against the wrong units, or measured
   * from the camera rather than the rider, agrees with a hand-built fixture
   * perfectly and throws away most of a real frame. #244 is the first consumer
   * `scatter.ts` has ever had — `port.ts` §`scatter` says so — and the first
   * consumer is where that surfaces.
   *
   * So these drive the **real** `sceneFrame`, built from the **real**
   * `packages/domain` route profile, at thirty-two rider positions.
   *
   * ## Why the fixture is a constant-radius arc, and why its radius is asserted
   *
   * ⚠️ **This block first shipped in #268 with a fixture that did not bend the
   * way its own name claimed, and the review of that pull request is what found
   * it.** The route was `east = 0.0002 · s²` — a parabola, whose radius of
   * curvature is at its **tightest where s = 0** and *loosens* from there:
   * 2 500 m at the start, 9 500 m three kilometres in. A fixture written to
   * tighten did the opposite, so the test named for the hard case was asserted
   * on a motorway curve and `lowest > 0.9` could not fail for the reason given.
   *
   * A constant-radius arc has one radius of curvature everywhere, and
   * {@link tightestRadiusMetres} computes it back out of the points the fixture
   * actually generated rather than trusting the algebra. A fixture that stops
   * bending goes red on that assertion before it reaches the cull at all —
   * which is the only thing that makes the numbers below mean anything.
   */
  const LATITUDE_DEGREES = 51.5;
  const METRES_PER_DEGREE_LATITUDE = 111_320;

  /** A fixture point in flat metres — northing, easting — before it is a coordinate. */
  type LocalPoint = readonly [number, number];

  /** A route of one constant radius of curvature, or straight when `radius` is `null`. */
  const arcRoute = (radius: number | null): { points: RoutePoint[]; local: LocalPoint[] } => {
    const points: RoutePoint[] = [];
    const local: LocalPoint[] = [];
    for (let along = 0; along <= 3000; along += 10) {
      const turned = radius === null ? 0 : along / radius;
      const north = radius === null ? along : radius * Math.sin(turned);
      const east = radius === null ? 0 : radius * (1 - Math.cos(turned));
      local.push([north, east]);
      points.push({
        position: geographicPosition(
          degreesLatitude(LATITUDE_DEGREES + north / METRES_PER_DEGREE_LATITUDE),
          degreesLongitude(
            -0.12 +
              east / (METRES_PER_DEGREE_LATITUDE * Math.cos((LATITUDE_DEGREES * Math.PI) / 180)),
          ),
        ),
        // A climb and a descent, so the profile is not degenerate in height
        // either. Nothing in the cull reads it; `scatterAt` does.
        elevation: altitudeMetres(along <= 1500 ? along * 0.04 : (3000 - along) * 0.04),
      });
    }
    return { points, local };
  };

  /**
   * The tightest radius of curvature the fixture actually has, in metres.
   *
   * The circumradius of each consecutive triple — `abc / 4A` — which is the
   * radius of curvature of the circle through those three points. Collinear
   * triples have zero area and an infinite radius, which is what a straight
   * route should report.
   */
  const tightestRadiusMetres = (local: readonly LocalPoint[]): number => {
    let tightest = Number.POSITIVE_INFINITY;
    for (let at = 1; at < local.length - 1; at += 1) {
      const [ax, ay] = local[at - 1] ?? [0, 0];
      const [bx, by] = local[at] ?? [0, 0];
      const [cx, cy] = local[at + 1] ?? [0, 0];
      const a = Math.hypot(bx - ax, by - ay);
      const b = Math.hypot(cx - bx, cy - by);
      const c = Math.hypot(cx - ax, cy - ay);
      const area = Math.abs((bx - ax) * (cy - ay) - (by - ay) * (cx - ax)) / 2;
      tightest = Math.min(
        tightest,
        area === 0 ? Number.POSITIVE_INFINITY : (a * b * c) / (4 * area),
      );
    }
    return tightest;
  };

  const keptAlongTheRoute = (radius: number | null): { lowest: number; items: number } => {
    const { points, local } = arcRoute(radius);
    // ⚠️ Non-vacuity of the *fixture*, checked before the cull is measured at
    // all: this is the assertion the parabola would have failed.
    const bend = tightestRadiusMetres(local);
    if (radius === null) {
      expect(bend).toBeGreaterThan(100_000);
    } else {
      expect(bend).toBeGreaterThan(radius * 0.98);
      expect(bend).toBeLessThan(radius * 1.02);
    }

    const profile = routeProfile(points);
    const origin = corridorOrigin(profile);
    const start = atStartLine(profile);
    const belt = new ScatterBelt();
    let lowest = 1;
    let items = 0;
    for (let at = 0; at < 1500; at += 47) {
      const frame = sceneFrame({
        profile,
        origin,
        state: { ...start, ride: { ...start.ride, distance: metres(at) } },
      });
      belt.update(frame.scatter, frame.camera);
      items = Math.min(items === 0 ? frame.scatter.length : items, frame.scatter.length);
      lowest = Math.min(lowest, submitted(belt) / Math.max(1, frame.scatter.length));
    }
    return { lowest, items };
  };

  it('keeps what a straight route puts beside the road', () => {
    const { lowest, items } = keptAlongTheRoute(null);

    // Non-vacuity: a route that placed nothing would make the ratio 0/0.
    expect(items).toBeGreaterThan(100);
    expect(lowest).toBeGreaterThan(0.95);
  });

  /**
   * ⚠️ **These two assert a band rather than a floor, and the ceiling is the
   * half that matters.** They are not "the cull keeps enough" — it does not; a
   * box measured in the rider's frame throws away scenery a rider can see on an
   * ordinary corner, which is
   * {@link https://github.com/openzigs/onyourleft/issues/269 | #269} and is
   * stated in `three-renderer.ts` §`SCATTER_LATERAL_METRES`. They are the
   * measurement that comment quotes, pinned where it cannot age: widen the
   * bound and the ceiling goes red, so the comment has to be re-measured in the
   * same change rather than left describing the cull it used to have.
   *
   * The floor is still a real regression guard. Swapping `along` and `across`,
   * measuring from the camera rather than the rider, or quartering
   * `SCATTER_LATERAL_METRES` all take these below it.
   */
  it('loses a measured share of what a 450 m corner puts beside the road', () => {
    // 450 m is the radius `SCATTER_LATERAL_METRES`'s own comment names as where
    // the far end of the belt starts leaving the box before the road does.
    const { lowest, items } = keptAlongTheRoute(450);

    expect(items).toBeGreaterThan(100);
    expect(lowest).toBeGreaterThan(0.5);
    expect(lowest).toBeLessThan(0.7);
  });

  it('loses more of what an ordinary 200 m corner puts beside the road', () => {
    // Tighter than a 450 m sweep and entirely ordinary — a 200 m radius is a
    // fast country-lane bend, not a hairpin.
    const { lowest, items } = keptAlongTheRoute(200);

    expect(items).toBeGreaterThan(100);
    expect(lowest).toBeGreaterThan(0.35);
    expect(lowest).toBeLessThan(0.5);
  });
});

describe('a ride with no GL context keeps its HUD — FR-5', () => {
  it('renders a frame carrying scenery without throwing', () => {
    // jsdom implements no WebGL, so this is exactly the degradation
    // `game/port.ts` describes: `hasContext` is false, the ride screen keeps
    // the HUD and loses the world, and a rider mid-effort is not handed a
    // blank page because the GPU blinked. A belt that reached for a context it
    // does not have would turn that into a crash.
    const view = threeGameRenderer.create(document.createElement('canvas'), qualitySettings(0));

    expect(view.hasContext).toBe(false);
    expect(() => {
      view.render(frameWithScatter());
    }).not.toThrow();
    expect(() => {
      view.destroy();
    }).not.toThrow();
  });
});

/** A frame with scenery on it and the least corridor a renderer will accept. */
function frameWithScatter(): SceneFrame {
  return {
    corridor: {
      vertices: new Float32Array(18),
      colours: new Float32Array(18),
      indices: new Uint32Array([0, 1, 2, 3, 4, 5]),
      centre: [],
      quadCount: 1,
    },
    camera: POSE,
    markers: [{ kind: 'rider', x: 0, y: 0, z: 0 }],
    world: {
      skyColour: 0x88aaff,
      groundColour: 0x557744,
      horizonColour: 0xb8c2c9,
      fogDensity: 0.004,
    },
    scatter: [item({ kind: 'tree-conifer', z: 30 }), item({ kind: 'rock', z: 60 })],
  };
}
