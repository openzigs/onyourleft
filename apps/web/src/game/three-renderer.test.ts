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
  CAMERA_ABOVE_METRES,
  CAMERA_FIELD_OF_VIEW_DEGREES,
  CAMERA_TARGET_AHEAD_METRES,
  FOGGED_OUT_METRES,
  FRUSTUM_SPREAD,
  lateralReachMetres,
  SCATTER_INSTANCE_CAPACITY,
  SCATTER_LATERAL_METRES,
  ScatterBelt,
  threeGameRenderer,
  WORST_CASE_ASPECT,
} from './three-renderer';
import { CAMERA_BEHIND_METRES, type CameraPose, type SceneFrame } from './port';
import { fogFactor, MINIMUM_VIEW_END_OCCLUSION, worldStyle } from './world';

/** A rider at the origin, facing +z, so `along` is `z` and `across` is `x`. */
const POSE: CameraPose = { x: 0, y: 0, z: 0, headingX: 0, headingZ: 1 };

function item(overrides: Partial<ScatterItem> = {}): ScatterItem {
  return { kind: 'shrub', x: 3, y: 0, z: 10, rotation: 0, scale: 1, ...overrides };
}

/** A short level route at an altitude, for the one question the fog floor answers. */
function flatRouteAt(altitude: number): RoutePoint[] {
  const points: RoutePoint[] = [];
  for (let step = 0; step <= 20; step += 1) {
    points.push({
      position: geographicPosition(
        degreesLatitude(51.5 + (step * 10) / 111_320),
        degreesLongitude(-0.12),
      ),
      elevation: altitudeMetres(altitude),
    });
  }
  return points;
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
    // this repository had before it. Ten metres up the road the cone is about
    // 104 m wide to each side, so 200 is outside it at any aspect ratio the
    // canvas can take.
    const belt = new ScatterBelt();

    belt.update(
      [
        item({ kind: 'rock', x: 200, z: 10 }),
        item({ kind: 'rock', x: -200, z: 10 }),
        item({ kind: 'rock', x: 10, z: 10 }),
      ],
      POSE,
    );

    expect(lateralReachMetres(10)).toBeLessThan(200);
    expect(belt.meshes.get('rock')?.count).toBe(1);
    expect(instancePosition(belt, 'rock', 0)[0]).toBe(10);
  });

  it('widens the bound with distance, because what a camera sees is a cone', () => {
    // #269's whole substance in one assertion. The same item, the same
    // distance to the side, dropped beside the rider and kept up the road —
    // which a constant half-width cannot do at any value, and which is why the
    // box threw away scenery that was on screen on every bend.
    const belt = new ScatterBelt();
    const aside = SCATTER_LATERAL_METRES + 48;

    belt.update([item({ kind: 'rock', x: aside, z: 0 })], POSE);
    expect(belt.meshes.get('rock')?.count).toBe(0);

    belt.update([item({ kind: 'rock', x: aside, z: 20 })], POSE);
    expect(belt.meshes.get('rock')?.count).toBe(1);
  });

  it('keeps the whole placement band beside a rider the cone has not opened for', () => {
    // At the camera itself the cone is `FRUSTUM_SPREAD` × 8 m wide and that is
    // narrower than the band `scatter.ts` places into, so the floor is what
    // stops the rider riding through a bare strip. Behind the camera the cone
    // term is clamped to zero rather than allowed to go negative, which is the
    // same floor arriving from the other side.
    const belt = new ScatterBelt();
    const edgeOfBand = SCATTER_LATERAL_METRES / 2;

    belt.update(
      [
        item({ kind: 'rock', x: edgeOfBand, z: -VIEW_BEHIND_METRES }),
        item({ kind: 'rock', x: -edgeOfBand, z: 0 }),
      ],
      POSE,
    );

    expect(lateralReachMetres(-VIEW_BEHIND_METRES)).toBe(SCATTER_LATERAL_METRES);
    expect(belt.meshes.get('rock')?.count).toBe(2);
  });

  it('caps the bound where the fog has taken everything anyway', () => {
    // Without the cap the cone is 1.3 km wide at the far end of the corridor,
    // which is a lateral test that no longer tests anything. With it, an item
    // beyond `FOGGED_OUT_METRES` to the side is dropped however far up the road
    // it is — and it is dropped because it is invisible, not because it is off
    // screen: at that distance it is at least three-quarters horizon colour.
    const belt = new ScatterBelt();

    belt.update(
      [
        item({ kind: 'rock', x: FOGGED_OUT_METRES + 1, z: 350 }),
        item({ kind: 'rock', x: FOGGED_OUT_METRES - 1, z: 350 }),
      ],
      POSE,
    );

    expect(lateralReachMetres(350)).toBe(FOGGED_OUT_METRES);
    expect(belt.meshes.get('rock')?.count).toBe(1);
    expect(instancePosition(belt, 'rock', 0)[0]).toBe(FOGGED_OUT_METRES - 1);
  });

  it('pins the worst case the whole bound is stated against', () => {
    // ⚠️ **The one thing "nothing on screen is culled" cannot catch, said where
    // somebody would look for it.** That property re-derives the frustum from
    // `WORST_CASE_ASPECT` — the same constant the bound is built from — so it
    // is self-consistent at *any* value and would stay green on a worst case
    // narrowed to the 16 : 9 the canvas is designed at. What makes 6 safe is
    // the reading of `design/tokens.ts` and `theme.css` recorded on
    // `WORST_CASE_ASPECT` itself, and a reading is not something a test can
    // re-derive. So this pins the number instead: lower it and come back here.
    expect(WORST_CASE_ASPECT).toBeGreaterThanOrEqual(6);
    expect(FRUSTUM_SPREAD).toBeCloseTo(3.4641, 4);
    // And the spread really is the camera's, rather than a number beside it.
    expect(FRUSTUM_SPREAD).toBeCloseTo(
      WORST_CASE_ASPECT * Math.tan((CAMERA_FIELD_OF_VIEW_DEGREES / 2) * (Math.PI / 180)),
      10,
    );
  });

  it('rests the far cap on a premise `world.ts` still holds', () => {
    // ⚠️ The cap is only honest while the fog it appeals to is really there.
    // `world.ts` floors the density so that the corridor's cut end is at least
    // `MINIMUM_VIEW_END_OCCLUSION` faded at `VIEW_AHEAD_METRES`, on the
    // thinnest air a route can be ridden in; `FogExp2` only thickens with
    // depth from there. Lower that floor and the cap starts hiding scenery a
    // rider could still make out, with nothing else in the suite to notice —
    // so this asserts the premise rather than the bound.
    expect(MINIMUM_VIEW_END_OCCLUSION).toBeGreaterThanOrEqual(0.75);
    expect(FOGGED_OUT_METRES).toBe(VIEW_AHEAD_METRES);
    // Driven through the real `worldStyle`, on the thinnest air a route can
    // reach, because that is the one case where the floor is what binds.
    const thinnest = worldStyle(routeProfile(flatRouteAt(5000)));
    expect(fogFactor(thinnest.fogDensity, FOGGED_OUT_METRES)).toBeGreaterThanOrEqual(0.75);
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

  /**
   * The worst frame of a 1.5 km sweep, and everything it took to get there.
   *
   * ⚠️ **`tightestRadius` is returned rather than only asserted inside**, so
   * that #269's first criterion — *"with the fixture's minimum radius of
   * curvature stated in the test"* — is stated where somebody reads the number,
   * not buried in a helper. It is computed back out of the points the fixture
   * generated; a fixture that stops bending goes red on the radius before the
   * cull is measured at all.
   *
   * `onScreenButCulled` is #269's third criterion, evaluated on every item of
   * every frame: the count of items that are inside the camera's horizontal
   * frustum at {@link WORST_CASE_ASPECT}, less than
   * {@link MINIMUM_VIEW_END_OCCLUSION} faded at their depth, and dropped
   * anyway. `onScreenAndClear` is its non-vacuity partner — a probe that found
   * nothing on screen would report zero violations for the wrong reason.
   */
  interface Sweep {
    readonly lowest: number;
    readonly items: number;
    readonly tightestRadius: number;
    readonly onScreenButCulled: number;
    readonly onScreenAndClear: number;
  }

  const keptAlongTheRoute = (radius: number | null): Sweep => {
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
    let onScreenButCulled = 0;
    let onScreenAndClear = 0;
    for (let at = 0; at < 1500; at += 47) {
      const frame = sceneFrame({
        profile,
        origin,
        state: { ...start, ride: { ...start.ride, distance: metres(at) } },
      });
      belt.update(frame.scatter, frame.camera);
      items = Math.min(items === 0 ? frame.scatter.length : items, frame.scatter.length);
      lowest = Math.min(lowest, submitted(belt) / Math.max(1, frame.scatter.length));
      // ⚠️ **The one thing that makes `wouldBeDrawn` evidence about the belt.**
      // It restates the cull so that the property below can say *which* item
      // was dropped, which a `count` cannot — and a restatement that drifted
      // from `#inView` would let the property pass over a belt that culls
      // something else entirely. That is the "wrong harness" cause of this
      // program's named defect shape, so the two are reconciled every frame
      // rather than trusted: if they ever disagree the totals differ.
      expect(frame.scatter.filter((each) => wouldBeDrawn(each, frame.camera))).toHaveLength(
        submitted(belt),
      );
      for (const each of frame.scatter) {
        const seen = asTheCameraSeesIt(each, frame.camera);
        if (!seen.insideHorizontally) {
          continue;
        }
        if (fogFactor(frame.world.fogDensity, seen.depth) >= MINIMUM_VIEW_END_OCCLUSION) {
          continue;
        }
        onScreenAndClear += 1;
        if (!wouldBeDrawn(each, frame.camera)) {
          onScreenButCulled += 1;
        }
      }
    }
    return { lowest, items, tightestRadius: bend, onScreenButCulled, onScreenAndClear };
  };

  it('keeps what a straight route puts beside the road', () => {
    const { lowest, items, tightestRadius } = keptAlongTheRoute(null);

    // Non-vacuity: a route that placed nothing would make the ratio 0/0.
    expect(items).toBeGreaterThan(100);
    expect(tightestRadius).toBeGreaterThan(100_000);
    expect(lowest).toBeGreaterThan(0.95);
  });

  /**
   * ⚠️ **These used to assert a band with a ceiling, and the ceiling is gone
   * because what it pinned has been fixed.** #268 shipped the cull as a
   * constant-width box and wrote the loss down as a measurement — 56.7 % kept
   * on a 450 m corner, 41.3 % on a 200 m one — with a ceiling on each so that
   * widening the bound could not happen without re-measuring the comment that
   * quoted them. #269 is that widening. The ceilings did their job: both went
   * red on the first run of the new bound, which is what sent me back to
   * `lateralReachMetres`'s own comment.
   *
   * What replaces them is a floor at 90 %, which is #269's first two criteria
   * verbatim, and the far stronger assertion below it: **nothing that is on
   * screen is dropped at all**. A floor alone would be met by a cull that kept
   * 95 % of the scenery and threw away the five per cent directly in front of
   * the rider.
   */
  it('keeps almost all of what a 450 m corner puts beside the road', () => {
    // 450 m is the radius the box's own comment named as where the far end of
    // the belt started leaving it: it kept 56.7 % here.
    const { lowest, items, tightestRadius } = keptAlongTheRoute(450);

    expect(items).toBeGreaterThan(100);
    expect(tightestRadius).toBeGreaterThan(445);
    expect(tightestRadius).toBeLessThan(455);
    expect(lowest).toBeGreaterThan(0.9);
  });

  it('keeps almost all of what an ordinary 200 m corner puts beside the road', () => {
    // #269's first criterion, at its own radius. A 200 m bend is a fast
    // country-lane corner rather than a hairpin, and the box kept 41.3 % of it.
    const { lowest, items, tightestRadius } = keptAlongTheRoute(200);

    expect(items).toBeGreaterThan(100);
    expect(tightestRadius).toBeGreaterThan(198);
    expect(tightestRadius).toBeLessThan(202);
    expect(lowest).toBeGreaterThan(0.9);
  });

  /**
   * ⚠️ **The one place a ceiling survives, and it is the new bound's own
   * "what this gets wrong".** A 100 m hairpin folds the road back beside and
   * behind the rider, so a fifth of the scenery a frame carries is genuinely
   * off screen there and is genuinely dropped. That number is quoted in
   * `three-renderer.ts` §`lateralReachMetres`, so it is pinned here the way its
   * predecessors were: widen the bound again and this goes red, and the comment
   * has to be re-measured in the same change rather than left describing a cull
   * that has moved.
   */
  it('drops a measured share of a 100 m hairpin, all of it off screen', () => {
    const { lowest, items, tightestRadius, onScreenButCulled, onScreenAndClear } =
      keptAlongTheRoute(100);

    expect(items).toBeGreaterThan(100);
    expect(tightestRadius).toBeGreaterThan(99);
    expect(tightestRadius).toBeLessThan(101);
    expect(lowest).toBeGreaterThan(0.75);
    expect(lowest).toBeLessThan(0.85);
    // The dropped fifth is the point: none of it was visible.
    expect(onScreenAndClear).toBeGreaterThan(1000);
    expect(onScreenButCulled).toBe(0);
  });

  /**
   * #269's third criterion, which is the only one that is a *property* rather
   * than a number: **no item that is inside the camera's frustum at the
   * worst-case aspect ratio, and less than `MINIMUM_VIEW_END_OCCLUSION` faded
   * at its depth, is culled.**
   *
   * ⚠️ **The frustum is re-derived from the camera's three numbers rather than
   * read off the renderer's own `PerspectiveCamera`**, and it has to be:
   * `three-seam.test.ts` forbids this file importing `three` at all, and a test
   * that asked the object under test where it was looking would be checking the
   * code against itself. {@link asTheCameraSeesIt} is an independent
   * implementation of the same projection — the posture `packages/store`'s
   * `identity-verifier.test.ts` takes towards a signature.
   *
   * ⚠️ **Ten radii, four of them tighter than anything #268 measured**, because
   * the bound's error is worst where the road bends hardest and a sweep that
   * stopped at 200 m would have called the box correct too.
   */
  it('never drops an item that is on screen and not yet fogged out', () => {
    let clear = 0;
    for (const radius of [null, 3000, 1000, 450, 300, 200, 150, 100, 75, 50]) {
      const sweep = keptAlongTheRoute(radius);

      // Non-vacuity, per radius: a probe that found nothing on screen would
      // report no violations for entirely the wrong reason.
      expect(sweep.onScreenAndClear).toBeGreaterThan(1000);
      expect(sweep.onScreenButCulled).toBe(0);
      clear += sweep.onScreenAndClear;
    }

    // 49 169 across the ten sweeps when this was written.
    expect(clear).toBeGreaterThan(40_000);
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

/**
 * Where an item sits in the camera's own frame, derived from nothing but the
 * four numbers that configure the camera.
 *
 * ⚠️ **This is the independent half of #269's third criterion and it is
 * deliberately not the implementation's arithmetic rearranged.**
 * `lateralReachMetres` approximates; this does not. The camera sits
 * `CAMERA_BEHIND_METRES` behind the rider and `CAMERA_ABOVE_METRES` above, and
 * looks at a point `CAMERA_TARGET_AHEAD_METRES` up the road at the rider's own
 * height — so its axis is pitched down by about 5.2° and the depth of a point
 * is its projection on that pitched axis, not its distance up the road.
 *
 * The camera's *right* axis is exactly the rider's lateral one: three builds
 * the basis from a world up of (0, 1, 0) and this camera has no roll, so the
 * right vector is horizontal and perpendicular to a heading the pose already
 * gives in the ground plane. That is why a horizontal frustum test needs no
 * matrix here.
 *
 * `insideHorizontally` is the horizontal half alone — the vertical half is left
 * out on purpose, because the cull under test does not test vertically either
 * and including it would make the property *weaker* by excusing a drop that
 * happened to be above the top of the screen.
 */
function asTheCameraSeesIt(
  each: ScatterItem,
  pose: CameraPose,
): { readonly insideHorizontally: boolean; readonly depth: number } {
  const dx = each.x - pose.x;
  const dz = each.z - pose.z;
  const along = dx * pose.headingX + dz * pose.headingZ;
  const across = dx * pose.headingZ - dz * pose.headingX;
  // From the camera rather than from the rider, in its own three axes.
  const forward = along + CAMERA_BEHIND_METRES;
  const rise = each.y - pose.y - CAMERA_ABOVE_METRES;
  const axisRun = CAMERA_TARGET_AHEAD_METRES + CAMERA_BEHIND_METRES;
  const axisDrop = -CAMERA_ABOVE_METRES;
  const axisLength = Math.hypot(axisRun, axisDrop);
  const depthOnAxis = (forward * axisRun + rise * axisDrop) / axisLength;
  const halfAngleTangent =
    WORST_CASE_ASPECT * Math.tan((CAMERA_FIELD_OF_VIEW_DEGREES / 2) * (Math.PI / 180));
  return {
    // The near plane the renderer constructs its camera with.
    insideHorizontally: depthOnAxis > 0.5 && Math.abs(across) <= halfAngleTangent * depthOnAxis,
    depth: Math.hypot(forward, across, rise),
  };
}

/**
 * Whether the belt would submit this item — the cull, read back through the
 * bound rather than through a `count`.
 *
 * Counting a mesh cannot say *which* item survived, and "which" is the whole of
 * the property above. The longitudinal half is restated from the same two
 * imported constants `#inView` uses; the lateral half calls the exported bound.
 */
function wouldBeDrawn(each: ScatterItem, pose: CameraPose): boolean {
  const dx = each.x - pose.x;
  const dz = each.z - pose.z;
  const along = dx * pose.headingX + dz * pose.headingZ;
  if (along > VIEW_AHEAD_METRES || along < -VIEW_BEHIND_METRES) {
    return false;
  }
  const across = dx * pose.headingZ - dz * pose.headingX;
  return Math.abs(across) <= lateralReachMetres(along);
}

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
