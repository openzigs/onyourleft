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

import { afterEach, describe, expect, it } from 'vitest';

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
import { corridorOrigin, roadCorridor } from './terrain';
import { horizonRelief, terrainCorridor } from './landform';

import { QUALITY_LADDER, qualitySettings } from './quality';
import {
  SCATTER_BAND_METRES,
  SCATTER_KINDS,
  SCATTER_MAX_ITEMS,
  SCATTER_VERGE_METRES,
  type ScatterItem,
  type ScatterKind,
} from './scatter';
import { ROAD_WIDTH_METRES, VIEW_AHEAD_METRES, VIEW_BEHIND_METRES } from './terrain';
import {
  BICYCLE_COLOURS,
  BICYCLE_FRONT_METRES,
  BICYCLE_LENGTH_METRES,
  CRANK_AXIS_Y,
  CRANK_AXIS_Z,
  LEG_BONE_COUNT,
} from './bicycle';
import { MAXIMUM_SCENERY_VARIANTS, SCENERY_MODELS } from './scenery-models';
import { MAXIMUM_LIT_CHANNEL } from './scenery-palette';
import {
  CAMERA_ABOVE_METRES,
  CAMERA_BEHIND_METRES,
  CAMERA_FIELD_OF_VIEW_DEGREES,
  CAMERA_TARGET_AHEAD_METRES,
  FRUSTUM_SPREAD,
  MAXIMUM_FIELD_OF_VIEW_DEGREES,
  NARROWEST_ASPECT,
  REFERENCE_ASPECT,
  vergeEntersFrameMetres,
  WORST_CASE_ASPECT,
} from './camera';
import {
  FOGGED_OUT_METRES,
  lateralReachMetres,
  loadSceneryModels,
  prepareSceneryGeometry,
  RiderBelt,
  SCATTER_INSTANCE_CAPACITY,
  sceneryFitMetres,
  SCATTER_LATERAL_METRES,
  ScatterBelt,
  threeGameRenderer,
  WorldLamps,
  LIT_COLOURS,
  BRIDGE_COLOUR,
} from './three-renderer';
import type { CameraPose, RiderMarker, SceneFrame } from './port';
import {
  fogFactor,
  irradianceOn,
  MINIMUM_VIEW_END_OCCLUSION,
  PEAK_IRRADIANCE,
  worldStyle,
} from './world';

/** A rider at the origin, facing +z, so `along` is `z` and `across` is `x`. */
const POSE: CameraPose = {
  x: 0,
  y: 0,
  z: 0,
  headingX: 0,
  headingZ: 1,
  eyeRoadY: 0,
  targetRoadY: 0,
};

function item(overrides: Partial<ScatterItem> = {}): ScatterItem {
  return { kind: 'shrub', x: 3, y: 0, z: 10, rotation: 0, scale: 1, variant: 0, ...overrides };
}

/**
 * The mesh one kind's variant is drawn by — #367.
 *
 * ⚠️ **`ScatterBelt.meshes` is keyed by kind AND variant since #367**, where it
 * used to be keyed by kind alone, so nearly every assertion in this file goes
 * through here. A belt built with no models has one shape a kind, which is what
 * makes variant 0 the right default for everything that is not about variants.
 */
function meshFor(
  belt: ScatterBelt,
  kind: ScatterKind,
  variant = 0,
): ReturnType<ScatterBelt['meshesOf']>[number] | undefined {
  // ⚠️ The type is read off the belt rather than named: `three-seam.test.ts`
  // allows exactly one file in this repository to import the rendering
  // library, and a test that spelt `InstancedMesh` would be a second.
  return belt.meshesOf(kind)[variant];
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
  const mesh = meshFor(belt, kind);
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
      expect(meshFor(belt, kind)).toBeDefined();
    }
  });

  it('gives each kind its own geometry and the whole belt one material', () => {
    // Two kinds sharing a mesh would draw a conifer as a rock.
    //
    // ⚠️ **One material for all of them since #366, where it used to be one
    // each** — a reviewer who remembers this asserting six materials is
    // reading the old file. Every vertex carries its own colour now, so a
    // material holds none and there is nothing left for a kind to have its own
    // of; the old reason for six ("two kinds sharing a material would make the
    // colour of one depend on the other") has no content once no material has
    // a colour. What it buys is that twelve meshes cost two materials rather
    // than twelve, and a shading swap is one assignment a mesh.
    const belt = new ScatterBelt();
    const geometries = new Set<unknown>();
    const materials = new Set<unknown>();

    for (const mesh of belt.meshes.values()) {
      geometries.add(mesh.geometry);
      materials.add(mesh.material);
    }

    expect(geometries.size).toBe(belt.meshes.size);
    expect(materials.size).toBe(1);
  });

  it('paints its primitives on their vertices, which is what makes that safe — #366', () => {
    // ⚠️ **The half of the sentence above that is load-bearing.** One material
    // for every kind is only harmless because no kind's colour is in it: a
    // primitive that arrived without a `color` attribute would be drawn in
    // whatever the shared material's default is — black — for `post` always
    // and for any kind whose model failed to load.
    const belt = new ScatterBelt();

    for (const kind of SCATTER_KINDS) {
      const geometry = meshFor(belt, kind)?.geometry;
      const colour = geometry?.getAttribute('color');

      expect(colour, kind).toBeDefined();
      expect(colour?.count).toBe(geometry?.getAttribute('position').count);
    }
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
    const conifer = meshFor(belt, 'tree-conifer');
    const meshAtFirstFrame = conifer;
    const attributeAtFirstFrame = conifer?.instanceMatrix;
    const bufferAtFirstFrame = conifer?.instanceMatrix.array;
    const countAtFirstFrame = conifer?.count;

    for (let index = 1; index < 100; index += 1) {
      belt.update(frame(index), POSE);
    }

    expect(meshFor(belt, 'tree-conifer')).toBe(meshAtFirstFrame);
    expect(meshFor(belt, 'tree-conifer')?.instanceMatrix).toBe(attributeAtFirstFrame);
    expect(meshFor(belt, 'tree-conifer')?.instanceMatrix.array).toBe(bufferAtFirstFrame);
    // Non-vacuity: the count has to have moved, or the three lines above are a
    // claim about a belt that was handed the same frame a hundred times.
    expect(meshFor(belt, 'tree-conifer')?.count).not.toBe(countAtFirstFrame);
  });

  it('reserves room for every kind before the first frame, not when a kind appears', () => {
    // ⚠️ The reason this is asserted rather than left to the growth path:
    // three creates a GPU buffer the first time it *draws* an object, so a belt
    // that sized a kind's matrices the frame that kind first appeared would
    // allocate four hundred metres into a ride — a per-frame allocation late
    // enough that no gate would catch it.
    const belt = new ScatterBelt();

    for (const kind of SCATTER_KINDS) {
      expect(meshFor(belt, kind)?.instanceMatrix.count).toBe(SCATTER_INSTANCE_CAPACITY);
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

    const before = meshFor(belt, 'rock');
    belt.update(items, POSE);

    expect(meshFor(belt, 'rock')).toBe(before);
    expect(meshFor(belt, 'rock')?.instanceMatrix.count).toBeGreaterThanOrEqual(tooMany);
    expect(meshFor(belt, 'rock')?.count).toBe(tooMany);
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
    const grown = meshFor(belt, 'rock')?.instanceMatrix;
    expect(grown?.count).toBeGreaterThanOrEqual(SCATTER_INSTANCE_CAPACITY * 2);

    // One more item, and the buffer is the same object: the growth already
    // made room. Sized to `needed`, this would be a second allocation.
    belt.update(rocks(SCATTER_INSTANCE_CAPACITY + 2), POSE);
    expect(meshFor(belt, 'rock')?.instanceMatrix).toBe(grown);
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
    const rock = meshFor(belt, 'rock');
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

    const post = meshFor(belt, 'post');
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

    expect(meshFor(belt, 'shrub')?.count).toBe(2);
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

    expect(meshFor(belt, 'shrub')?.count).toBe(1);
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

    expect(meshFor(belt, 'shrub')?.count).toBe(2);
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
    expect(meshFor(belt, 'rock')?.count).toBe(1);
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
    expect(meshFor(belt, 'rock')?.count).toBe(0);

    belt.update([item({ kind: 'rock', x: aside, z: 20 })], POSE);
    expect(meshFor(belt, 'rock')?.count).toBe(1);
  });

  it('opens the cone from the CAMERA, which is behind the rider', () => {
    // ⚠️ **#424, and a gap that was already there.** `lateralReachMetres` adds
    // `CAMERA_BEHIND_METRES` back on because the cone's apex is at the camera
    // and not at the rider — its own comment says so — and deleting that term
    // left every test in this file green, on `main` as well as here: the 43 m
    // floor is wider than the 19 m the term contributes beside the rider, so
    // "nothing on screen is culled" holds without it. It holds by the floor's
    // generosity rather than by the geometry being right, and the floor is the
    // number #353 and #355 each narrowed. So the apex is pinned where it is.
    expect(lateralReachMetres(-CAMERA_BEHIND_METRES)).toBe(SCATTER_LATERAL_METRES);
    expect(lateralReachMetres(0) - SCATTER_LATERAL_METRES).toBeCloseTo(
      FRUSTUM_SPREAD * CAMERA_BEHIND_METRES,
      10,
    );

    // And through the belt rather than only through the function: level with
    // the rider, the cone has already opened by the camera's setback.
    const belt = new ScatterBelt();
    const opened = SCATTER_LATERAL_METRES + FRUSTUM_SPREAD * CAMERA_BEHIND_METRES;
    belt.update(
      [item({ kind: 'rock', x: opened - 1, z: 0 }), item({ kind: 'rock', x: opened + 1, z: 0 })],
      POSE,
    );
    expect(meshFor(belt, 'rock')?.count).toBe(1);
    // `toBeCloseTo`: an instance matrix is 32-bit and `opened` is not a whole number.
    expect(instancePosition(belt, 'rock', 0)[0]).toBeCloseTo(opened - 1, 3);
  });

  it('keeps the whole placement band beside a rider the cone has not opened for', () => {
    // At the rider the cone is `FRUSTUM_SPREAD` × `CAMERA_BEHIND_METRES` wide —
    // 18.9 m since #424, 27.7 m on the camera before it — and that is
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
    expect(meshFor(belt, 'rock')?.count).toBe(2);
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
    expect(meshFor(belt, 'rock')?.count).toBe(1);
    expect(instancePosition(belt, 'rock', 0)[0]).toBe(FOGGED_OUT_METRES - 1);
  });

  it('pins the worst case the whole bound is stated against', () => {
    // ⚠️ **The one thing "nothing on screen is culled" cannot catch, said where
    // somebody would look for it.** That property re-derives the frustum from
    // `WORST_CASE_ASPECT` — the same constant the bound is built from — so it
    // is self-consistent at *any* value and would stay green on a worst case
    // narrowed to 16 : 9. ⚠️ **What makes 6 safe changed in #423**: it used to
    // be a reading of `theme.css` that no test could re-derive, and it is now
    // a `max-width` in that stylesheet which `browser/ride.browser.spec.ts`
    // measures at a 6.5 : 1 viewport. This still pins the number, because the
    // two are in different languages and nothing else ties them: lower it here
    // and the stylesheet's `600vh` has to come down with it.
    expect(WORST_CASE_ASPECT).toBe(6);
    // ⚠️ 3.4641 until #424 widened the lens from 60° to 70°: 6 × tan 35°.
    expect(FRUSTUM_SPREAD).toBeCloseTo(4.2012, 4);
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

    expect(meshFor(belt, 'rock')?.count).toBe(3);
  });

  it("measures along the rider's heading rather than along an axis", () => {
    // Facing -x, an item 50 m up the road is at x = -50 and an item at
    // z = 50 is 50 m to the side. A cull written against the world axes would
    // agree with this file's other tests exactly and be wrong on every bend.
    const belt = new ScatterBelt();
    const facingWest: CameraPose = { ...POSE, headingX: -1, headingZ: 0 };

    belt.update(
      [
        item({ kind: 'shrub', x: -300, z: 0 }),
        item({ kind: 'shrub', x: 300, z: 0 }),
        item({ kind: 'shrub', x: 0, z: 300 }),
      ],
      facingWest,
    );

    expect(meshFor(belt, 'shrub')?.count).toBe(1);
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
    const first = meshFor(belt, 'rock')?.boundingSphere?.center.z ?? NaN;
    belt.update([item({ kind: 'rock', x: 0, z: 300 })], POSE);
    const second = meshFor(belt, 'rock')?.boundingSphere?.center.z ?? NaN;

    expect(first).toBeCloseTo(20, 1);
    expect(second).toBeCloseTo(300, 1);
  });

  it('hides a kind that has nothing in it, as well as counting it out', () => {
    // `count` is the claim; `visible` is what keeps an empty mesh out of the
    // render list altogether. A kind that emptied and stayed visible would be
    // projected and bound every frame for no pixels.
    const belt = new ScatterBelt();

    belt.update([item({ kind: 'shrub', z: 20 })], POSE);
    expect(meshFor(belt, 'shrub')?.visible).toBe(true);

    belt.update([item({ kind: 'rock', z: 20 })], POSE);
    expect(meshFor(belt, 'shrub')?.visible).toBe(false);
    expect(meshFor(belt, 'shrub')?.count).toBe(0);
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
        const seen = asTheCameraSeesIt(each, frame.camera, WORST_CASE_ASPECT);
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
   * behind the rider, so a large share of the scenery a frame carries is
   * genuinely off screen there and is genuinely dropped. That number is quoted
   * in `three-renderer.ts` §`lateralReachMetres`, so it is pinned here the way
   * its predecessors were: widen the bound again and this goes red, and the
   * comment has to be re-measured in the same change rather than left
   * describing a cull that has moved.
   *
   * ⚠️ **Re-measured for #348, again for #351 and again for #353** — a reviewer
   * who remembers "a fifth" here, or 0.4390, is reading an older file. #348
   * took the scenery band from 16 m deep to 35 m and pushed the verge back, so
   * an item stood up to 44.5 m from the centreline rather than 21 m and the
   * share dropped on a hairpin roughly doubled; #351 narrowed the band to 25 m
   * and it came back part of the way. What is being pinned is the *band*, seen
   * through the cull, rather than the cull itself. The assertion that matters is
   * unchanged and still holds through all three: **none of what was dropped was
   * on screen.**
   *
   * ⚠️ **#353 narrowed the band again, to 15 m, and this figure did not move at
   * all** — measured 0.5514 either side of it. `three-renderer.ts`
   * §`lateralReachMetres` records where the effect actually turned up instead,
   * which is at radii tighter than this one and in the opposite direction to
   * the one that paragraph predicted.
   *
   * ⚠️ **#355 narrowed the VERGE, and this is the one of the four that did move
   * it**: 0.5243, against 0.5514 before. The mechanism is the same one — a
   * 6.5 m verge leaves reach on a bend where a 9.5 m one left none, so
   * `scatter.ts`'s `bandsAt` admits radii down to about 16 m and plants more of
   * a hairpin behind its own fold. The band on a bend therefore has to be
   * pinned by the ceiling below rather than by the sentence above it.
   *
   * #348 is also why the non-vacuity floor moved to 40. The scenery is
   * clustered now, so the emptiest frame of a sweep is genuinely emptier — 58
   * items on this radius then, 142 since #351 put the density back — and a
   * floor of a hundred would have been red on a world behaving as designed.
   * The floor stays at 40 rather than being raised to match today's number:
   * it is a guard against a vacuous ratio, not a second density assertion, and
   * `scatter.test.ts` §"#351" is where density is measured.
   */
  it('drops a measured share of a 100 m hairpin, all of it off screen', () => {
    const { lowest, items, tightestRadius, onScreenButCulled, onScreenAndClear } =
      keptAlongTheRoute(100);

    expect(items).toBeGreaterThan(40);
    expect(tightestRadius).toBeGreaterThan(99);
    expect(tightestRadius).toBeLessThan(101);
    // 0.4390 when this was measured for #348; 0.5514 for #351, 0.5514 again
    // for #353, 0.5243 for #355 and **0.5568** for #424 — a nearer camera and
    // a wider lens put a little more of a hairpin's fold inside the cone.
    expect(lowest).toBeGreaterThan(0.5);
    expect(lowest).toBeLessThan(0.6);
    // The dropped half is the point: none of it was visible.
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

    // 49 169 across the ten sweeps when this was written; **35 718** when #348
    // re-measured it, because that issue roughly halved how much scenery a
    // stretch of road carries; **47 871** since #353, **48 089** since #355 and
    // **50 395** since #424 — which is two changes at once: a wider lens puts
    // more on screen, and "not yet fogged out" is judged at the depth three
    // fogs by rather than at the straight-line distance (`asTheCameraSeesIt`).
    // The floor moved with the measurement rather than the measurement being
    // left to describe a world that has changed.
    expect(clear).toBeGreaterThan(30_000);
  });
});

/**
 * #355 — the verge and the camera cone, which is the interaction three passes
 * of constant-tuning went by without computing — **re-derived for #423 and
 * #424, which between them moved every quantity in it.**
 *
 * ## The relationship, in one sentence
 *
 * A perspective camera's cone has an **apex**. An item standing `across` metres
 * from the centreline is off the side of the screen until it is
 * `across / spread` metres ahead of the **camera**, and the camera sits
 * {@link CAMERA_BEHIND_METRES} behind the rider — so the verge decides not only
 * how far away the nearest scenery stands but **whether a rider sees it beside
 * them at all**.
 *
 * ## ⚠️ What #424 did to it, and why the old first assertion is gone
 *
 * A reviewer who remembers `expect(entersFrameAt(nearest)).toBeLessThan(0)` —
 * *"puts the nearest thing the verge permits in shot beside the rider"* — is
 * reading the old file, and it was not loosened: **it cannot hold beside the
 * thing #424 asks for.** `camera.ts`'s header has the law. The rider's share
 * of frame height and the verge's entry point both depend on the camera
 * through the one product `B · tan(fov / 2)`, so with the verge in shot level
 * with the rider the most the rider can fill on this lens is 23.2 % of a 16 : 9
 * frame, **20.6 % of the owner's 16 : 10 tablet** and 16.9 % at 4 : 3 — against
 * the 18.1 % #424 was filed about. `camera.test.ts` asserts those three, so the
 * trade is a checked fact rather than an excuse.
 *
 * What replaces it is stated against the rider's own bicycle rather than
 * against a number: the nearest scenery is in shot **before the rider's front
 * wheel is level with it** at 16 : 9, and within a bicycle's length on the
 * 16 : 10 tablet. Scenery and rider overlap in the frame; they no longer
 * overlap in depth all the way back to the saddle.
 *
 * ## ⚠️ And what #423 did to it: there is no one "narrowest frame" any more
 *
 * #355's 72 % bound was taken at 16 : 9 because 16 : 9 was the narrowest the
 * canvas could be. The world is full-bleed now. The bound is **kept where it
 * was taken** ({@link REFERENCE_ASPECT}) rather than re-pointed at a frame it
 * was never measured in, and the narrower frames get rows of their own.
 *
 * ## How every floor below is set, which is #355's own method made executable
 *
 * #355 put its bound *"between the two and nearer the new one, so the
 * arrangement this issue replaces goes red on it"* — and that sentence was a
 * comment. Here it is an assertion: each row measures the shipped verge **and
 * the 6 m verge #355 was filed against, seen through today's camera**, and
 * requires the floor to separate them. So a floor cannot be re-pinned to
 * whatever a new constant happens to produce: move the camera, and either the
 * shipped arrangement falls under its floor or the rejected one climbs over it,
 * and the row goes red either way.
 *
 * The 6 m verge is emulated by standing every item 3 m further out. That is
 * exact rather than approximate — `scatter.test.ts` §"#353" asserts nothing in
 * `fillCell` reads the verge, so moving it moves where scenery stands and never
 * how much there is.
 *
 * ## ⚠️ What this block does NOT claim, and #355's own arithmetic overstates
 *
 * The issue says *"roughly 15 items fall in the first 25 m — they are simply
 * not in frame"*. Measured: **13.7** items a frame stand there, and most are in
 * shot at every landscape aspect. ⚠️ **The count of frames carrying nothing in
 * shot in the first 25 m does not move with the verge at all**, because nearly
 * all of those frames have nothing *placed* there — the clustering field
 * `OPEN_GROUND_SHARE` parameterises doing what #348 asked it to, and not the
 * cone.
 *
 * ⚠️ **It is still a proxy and not the device**, in the sense `scatter.test.ts`
 * §"#351" means. A frame count cannot say the world looks right.
 */
describe('the verge and the camera cone — #355, re-derived for #423 and #424', () => {
  /** How far from the centreline the nearest thing `scatter.ts` can place stands. */
  const NEAREST = ROAD_WIDTH_METRES / 2 + SCATTER_VERGE_METRES;

  /** The owner's tablet in landscape, which is where this app is ridden. */
  const TABLET_ASPECT = 16 / 10;

  /**
   * How far ahead of the **rider** an item standing `across` metres from the
   * centreline first enters a frame of this aspect. Negative means it is
   * already in shot at the rider's own position.
   *
   * ⚠️ **Derived here rather than imported**, and that is the point of it:
   * `camera.ts` §`vergeEntersFrameMetres` is the production statement of this
   * relationship, so a version that called it would be checking one
   * arrangement of these constants against the same arrangement. It is the
   * posture `asTheCameraSeesIt` takes towards the cull. The last case in this
   * block is what ties the two together.
   */
  const entersFrameAt = (across: number, aspect: number): number =>
    across / lensSpread(aspect) - CAMERA_BEHIND_METRES;

  it('gave up the verge level with the rider, and says so', () => {
    // ⚠️ **Why the old gate is gone.** The rider's share of frame height and
    // the verge's entry point depend on the camera through one product,
    // `B · tan(fov / 2)` — `camera.ts`'s header has the law — so holding the
    // verge level with the rider pins the camera back, and `camera.test.ts`
    // §"is out of reach of any camera on this lens that holds #355’s old gate"
    // asserts what that leaves: 23.2 % of the frame at 16 : 9, 20.6 % on the
    // owner's tablet, against the quarter #424 sets as the floor.
    //
    // What is asserted HERE is the other side of that trade, so that it cannot
    // be mistaken for an oversight: the verge really is no longer level with
    // the rider, at any landscape aspect. A future change that quietly made
    // this negative again would have made the rider small again to do it.
    for (const aspect of [REFERENCE_ASPECT, TABLET_ASPECT, 4 / 3]) {
      expect(entersFrameAt(NEAREST, aspect)).toBeGreaterThan(0);
    }
    // And the camera that satisfied #355 did it from 8 m back on a 60° lens.
    expect(NEAREST / (REFERENCE_ASPECT * Math.tan((30 * Math.PI) / 180)) - 8).toBeCloseTo(-1.67, 2);
  });

  it('has the nearest scenery in shot before the rider’s front wheel is level with it', () => {
    // Measured: **+0.72 m** at 16 : 9, against −1.67 m with the camera 8 m back
    // and +1.83 m with this camera on the old 60° lens. The front of the
    // rider's bicycle is 0.86 m ahead of the point the marker is placed at, so
    // a tree at the verge and the rider's front wheel are in the frame together.
    const entersAt = entersFrameAt(NEAREST, REFERENCE_ASPECT);

    expect(entersAt).toBeLessThan(BICYCLE_FRONT_METRES);
    // Non-vacuity, and the honest half of the trade: it is NOT level with the
    // rider any more, and a test that still said so would be a test of 0 < 1.
    expect(entersAt).toBeGreaterThan(0);
  });

  it('has it in shot within a bicycle’s length on the owner’s tablet', () => {
    // Measured: **+1.30 m** at 16 : 10, inside the 1.70 m the bicycle is long.
    // ⚠️ A 4 : 3 tablet measures +2.46 m and is NOT gated: the only 4 : 3
    // tablets in numbers are iPads, and Web Bluetooth does not exist on iOS
    // (CLAUDE.md §8), so nobody can ride this there. It is recorded so that the
    // number is not rediscovered as a regression.
    expect(entersFrameAt(NEAREST, TABLET_ASPECT)).toBeLessThan(BICYCLE_LENGTH_METRES);
    expect(entersFrameAt(NEAREST, 4 / 3)).toBeCloseTo(2.46, 1);
  });

  it('still leaves the far edge of the band entering frame up the road, not beside it', () => {
    // ⚠️ **Non-vacuity in the other direction, and the reason it is here.**
    // Every bound above is satisfied perfectly by a verge of zero — which is a
    // tree on the tarmac, the defect `SCATTER_VERGE_METRES` exists to
    // prevent. What says the verge is still a verge is `scatter.test.ts`'s own
    // carriageway assertions; what this one says is that the *band* is still
    // deep enough to reach out of the near cone, so the world is a band seen in
    // perspective rather than a hedge drawn at one remove. Measured: the far
    // edge stands 21.5 m out and enters a 16 : 9 frame **12.8 m** up the road.
    const farthest = NEAREST + SCATTER_BAND_METRES;

    expect(entersFrameAt(farthest, REFERENCE_ASPECT)).toBeGreaterThan(8);
  });

  it('agrees with the statement of the same thing in `camera.ts`', () => {
    // The two are derived separately on purpose; this is the one place they
    // meet. A drift between them means one of the two files is describing a
    // different camera from the one that ships.
    for (const aspect of [
      WORST_CASE_ASPECT,
      REFERENCE_ASPECT,
      TABLET_ASPECT,
      1,
      NARROWEST_ASPECT,
    ]) {
      expect(vergeEntersFrameMetres(NEAREST, aspect)).toBeCloseTo(
        entersFrameAt(NEAREST, aspect),
        10,
      );
    }
  });

  /**
   * The same claim against the real `sceneFrame`, which is what stops the cases
   * above being arithmetic that agrees with itself.
   *
   * ⚠️ **Twelve kilometres and a hundred frames, matching `scatter.test.ts`
   * §"#351"** — a shorter fixture runs off its own end, and a route that is
   * clamped measures the clamp.
   */
  const LATITUDE_DEGREES = 45;

  const levelRoute = (): RoutePoint[] => {
    const points: RoutePoint[] = [];
    const metresPerDegreeLongitude = 111_320 * Math.cos((LATITUDE_DEGREES * Math.PI) / 180);
    for (let index = 0; index <= 1200; index += 1) {
      points.push({
        position: geographicPosition(
          degreesLatitude(LATITUDE_DEGREES),
          degreesLongitude((index * 10) / metresPerDegreeLongitude),
        ),
        elevation: altitudeMetres(0),
      });
    }
    return points;
  };

  interface NearField {
    /** Items standing in the nearest {@link NEAR_FIELD_METRES} of road. */
    readonly placed: number;
    /** How many of those are inside the frame. */
    readonly inShot: number;
    /** Frames with nothing at all in shot there. */
    readonly blankFrames: number;
    readonly frames: number;
  }

  /** The stretch of road a rider is actually looking at, in metres. */
  const NEAR_FIELD_METRES = 25;

  /** How much further out a 6 m verge stands than the 3 m one that ships. */
  const REJECTED_VERGE_EXTRA_METRES = 3;

  /** The hundred frames, built once: `sceneFrame` is the expensive half. */
  const frames = ((): readonly SceneFrame[] => {
    const profile = routeProfile(levelRoute());
    const origin = corridorOrigin(profile);
    const start = atStartLine(profile);
    const built: SceneFrame[] = [];
    for (let step = 0; step < 100; step += 1) {
      built.push(
        sceneFrame({
          profile,
          origin,
          state: { ...start, ride: { ...start.ride, distance: metres(500 + step * 100) } },
        }),
      );
    }
    return built;
  })();

  /**
   * @param vergeExtraMetres stand every item this much further from the
   * centreline — see "How every floor below is set" above.
   */
  const nearField = (aspect: number, vergeExtraMetres = 0): NearField => {
    let placed = 0;
    let inShot = 0;
    let blankFrames = 0;
    for (const frame of frames) {
      let visible = 0;
      for (const each of frame.scatter) {
        const dx = each.x - frame.camera.x;
        const dz = each.z - frame.camera.z;
        const along = dx * frame.camera.headingX + dz * frame.camera.headingZ;
        if (along < 0 || along >= NEAR_FIELD_METRES) {
          continue;
        }
        placed += 1;
        // Outwards along the rider's own lateral axis, which on this straight
        // level fixture is the road's.
        const across = dx * frame.camera.headingZ - dz * frame.camera.headingX;
        const push = Math.sign(across) * vergeExtraMetres;
        const moved: ScatterItem = {
          ...each,
          x: each.x + push * frame.camera.headingZ,
          z: each.z - push * frame.camera.headingX,
        };
        if (asTheCameraSeesIt(moved, frame.camera, aspect).insideHorizontally) {
          visible += 1;
        }
      }
      inShot += visible;
      blankFrames += visible === 0 ? 1 : 0;
    }
    return { placed, inShot, blankFrames, frames: frames.length };
  };

  const share = (field: NearField): number => field.inShot / field.placed;

  /**
   * Each frame, the share of the first 25 m a rider must be shown, and what was
   * measured either side of it when the floor was set.
   *
   * | frame | shipped, 3 m verge | floor | rejected, 6 m verge |
   * |---|--:|--:|--:|
   * | 16 : 9 — {@link REFERENCE_ASPECT}, #355's own | 73.8 % | **72 %** | 64.7 % |
   * | 16 : 10 — the owner's tablet | 69.4 % | **65 %** | 59.1 % |
   * | 4 : 3 | 59.4 % | **54 %** | 47.4 % |
   * | 9 : 21 — {@link NARROWEST_ASPECT}, a phone upright | 12.7 % | **9 %** | 3.1 % |
   *
   * ⚠️ **The 16 : 9 floor is #355's, unmoved**, and the camera was solved
   * against it: this position on the old 60° lens measures 64.7 %, which is
   * under the 67.8 % #355 was *filed about*. 70° is what clears it.
   *
   * ⚠️ **The last row is not a defect and must not be tuned as one.** A frame
   * less than half as wide as it is tall shows an eighth of what stands beside
   * the road because that is what such a frame is; the verge would have to be
   * inside the carriageway to change it. It is gated so that it cannot fall to
   * *nothing* unnoticed — which is what a fixed 70° lens does to it, measured
   * on this fixture before `camera.ts` §`verticalHalfTangent` opened the lens
   * on a narrow frame: **2.1 %**.
   */
  const ROWS = [
    { name: '16 : 9, where #355 took its bound', aspect: REFERENCE_ASPECT, floor: 0.72 },
    { name: '16 : 10, the owner’s tablet', aspect: TABLET_ASPECT, floor: 0.65 },
    { name: '4 : 3', aspect: 4 / 3, floor: 0.54 },
    { name: '9 : 21, a phone upright', aspect: NARROWEST_ASPECT, floor: 0.09 },
  ] as const;

  it.each(ROWS)('shows a rider enough of the first 25 m of road — $name', ({ aspect, floor }) => {
    const shipped = nearField(aspect);
    const rejected = nearField(aspect, REJECTED_VERGE_EXTRA_METRES);

    // Non-vacuity: a sweep that found nothing placed would report a share of
    // 0/0, and the supply must be the same in both or the comparison is of two
    // different worlds.
    expect(shipped.placed / shipped.frames).toBeGreaterThan(10);
    expect(rejected.placed).toBe(shipped.placed);

    expect(share(shipped)).toBeGreaterThan(floor);
    // ⚠️ The half that stops the floor being re-pinned — see this block's
    // header. The arrangement #355 replaced must still FAIL, through this
    // camera, at this aspect.
    expect(share(rejected)).toBeLessThan(floor);
  });

  it('is not the reason a frame occasionally carries nothing in the near field', () => {
    // ⚠️ **The half of #355's diagnosis that the measurement does not support,
    // pinned so that it is not rediscovered as a fourth cause.** Some frames in
    // a hundred carry nothing in shot in the first 25 m, and nearly all of
    // them have nothing *placed* there at all, which is the clustering behaving
    // as #348 designed it. Narrowing the verge cannot fix a frame with nothing
    // in it, and an issue that reads a blank near field as a cone problem is
    // diagnosing the wrong constant. ⚠️ **Both directions are asserted**,
    // because a world that never opened out would be a regression of #348's
    // third bullet and a world that opened out everywhere would be #348's own
    // overcorrection.
    const { blankFrames, frames: count } = nearField(REFERENCE_ASPECT);

    expect(blankFrames).toBeLessThan(count / 5);
    expect(blankFrames).toBeGreaterThan(0);
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
 * looks at the ROAD `CAMERA_TARGET_AHEAD_METRES` ahead of them — so on the flat
 * its axis is pitched down by about 3.9° (5.2° until #424 lowered and closed
 * it), and the depth of a point is its projection on that pitched axis, not its
 * distance up the road.
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
 *
 * ⚠️ **The aspect ratio is a parameter since #355, and it is required rather
 * than defaulted.** Two blocks ask this function two opposite questions: the
 * cull's property needs {@link WORST_CASE_ASPECT}, because a cull that drops
 * something visible on the *widest* frame is the defect; the near-field gate
 * needs the narrow ones — {@link REFERENCE_ASPECT}, where #355's bound was
 * taken, down to {@link NARROWEST_ASPECT} — because scenery that misses a
 * *narrow* frame is the defect there. A default would silently give one of them
 * the other one's answer, and the wide one is the answer that makes both look
 * fine.
 */
function asTheCameraSeesIt(
  each: ScatterItem,
  pose: CameraPose,
  aspect: number,
): { readonly insideHorizontally: boolean; readonly depth: number } {
  const dx = each.x - pose.x;
  const dz = each.z - pose.z;
  const along = dx * pose.headingX + dz * pose.headingZ;
  const across = dx * pose.headingZ - dz * pose.headingX;
  // From the camera rather than from the rider, in its own three axes. ⚠️ Both
  // heights are the ROAD's since #424 — under the camera and at the look-ahead
  // — so the axis follows the hill rather than staying level behind the rider.
  const forward = along + CAMERA_BEHIND_METRES;
  const rise = each.y - pose.eyeRoadY - CAMERA_ABOVE_METRES;
  const axisRun = CAMERA_TARGET_AHEAD_METRES + CAMERA_BEHIND_METRES;
  const axisDrop = pose.targetRoadY - pose.eyeRoadY - CAMERA_ABOVE_METRES;
  const axisLength = Math.hypot(axisRun, axisDrop);
  const depthOnAxis = (forward * axisRun + rise * axisDrop) / axisLength;
  return {
    // The near plane the renderer constructs its camera with.
    insideHorizontally: depthOnAxis > 0.5 && Math.abs(across) <= lensSpread(aspect) * depthOnAxis,
    // ⚠️ **The depth three FOGS by, which until #424 this was not.** It was
    // `hypot(forward, across, rise)` — the straight-line distance — and
    // `fog_vertex.glsl` is `vFogDepth = -mvPosition.z`: the depth along the
    // view axis. They agree on the axis and part company off it, in the
    // direction that made this file's central property *weaker*: an item 200 m
    // to the side and 60 m deep was counted as 209 m away and three-quarters
    // fogged, excusing a cull of something three draws almost clear. #424 asks
    // for the fog's coupling to the camera to be re-derived; this is what that
    // turned up. The property still holds with the honest depth — asserted
    // below at ten radii — so the cull was right and its proof was not.
    depth: depthOnAxis,
  };
}

/**
 * `aspect · tan(fov / 2)` for the lens a frame of this shape gets — the same
 * policy `camera.ts` §`verticalHalfTangent` states, **restated from the two
 * angles rather than imported**, for the reason this whole helper is
 * independent: a test that called the production function would be checking
 * one arrangement of the constants against itself.
 *
 * A frame at least as wide as it is tall gets the reference lens. A narrower
 * one is opened until it sees to the side what a square frame would, and stops
 * at the maximum.
 */
function lensSpread(aspect: number): number {
  const reference = Math.tan((CAMERA_FIELD_OF_VIEW_DEGREES / 2) * (Math.PI / 180));
  const widest = Math.tan((MAXIMUM_FIELD_OF_VIEW_DEGREES / 2) * (Math.PI / 180));
  return aspect * Math.min(widest, Math.max(reference, reference / aspect));
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
    markers: [{ kind: 'rider', x: 0, y: 0, z: 0, headingX: 0, headingZ: 1 }],
    world: {
      skyColour: 0x88aaff,
      groundColour: 0x557744,
      horizonColour: 0xb8c2c9,
      fogDensity: 0.004,
      // A real one rather than a hand-written literal, because #286's
      // intensities are *solved* and a made-up pair would be a world this
      // program cannot produce. @see world.ts §`sunFor`
      sun: worldStyle(routeProfile(flatRouteAt(120))).sun,
    },
    scatter: [item({ kind: 'tree-conifer', z: 30 }), item({ kind: 'rock', z: 60 })],
    // #458. A real landform, from a real corridor, so this frame is one the
    // program can produce rather than one with the ground left out.
    terrain: (() => {
      const profile = routeProfile(flatRouteAt(120));
      const origin = corridorOrigin(profile);
      return {
        mesh: terrainCorridor(profile, origin, roadCorridor(profile, origin, 100), 7),
        horizon: horizonRelief(profile, origin, 7),
      };
    })(),
    water: {
      surface: {
        vertices: new Float32Array(0),
        shore: new Float32Array(0),
        indices: new Uint32Array(0),
      },
      bridges: [],
      seconds: 0,
    },
  };
}

/**
 * sRGB to linear, three's own transfer function.
 *
 * ⚠️ **three's, not WCAG's**, even though the two agree to the last digit:
 * `design/contrast.ts` linearises for a contrast ratio and this linearises to
 * ask what the shader will do with a colour. Copied from
 * `three/src/math/ColorManagement.js` §`SRGBToLinear`, which is the function
 * `Color.setHex` runs a material's colour through on its way to the GPU, and
 * written out here because this file must not import `three`.
 */
function toLinear(channel: number): number {
  const proportion = channel / 255;
  return proportion < 0.04045
    ? proportion * 0.0773993808
    : Math.pow(proportion * 0.9478672986 + 0.0521327014, 2.4);
}

/**
 * The world's two lamps — #286.
 *
 * ⚠️ **What is checkable here and what is not.** That the lamps exist, that
 * there are two of them, that they are the two classes `three-seam.test.ts`
 * allows, and — the one that matters — that `world.ts`'s normalised shares
 * arrive in three's own units. What is **not** checkable here is that anything
 * is lit by them: a `WorldLamps` that {@link ThreeGameView} never added to the
 * scene satisfies every assertion below, which is #240's named defect shape
 * for this epic one more time. `game.browser.spec.ts` reads the rider's marker
 * back out of the drawing buffer for exactly that reason.
 */
describe('the world has a light direction — #286', () => {
  /** The real sun of a real route, never a hand-written pair of intensities. */
  const harnessSun = () => worldStyle(routeProfile(flatRouteAt(0))).sun;

  it('is exactly two lamps, an ambient and a directional', () => {
    const lamps = new WorldLamps();

    expect(lamps.lamps.map((lamp) => lamp.type)).toEqual(['AmbientLight', 'DirectionalLight']);
  });

  it('starts dark, so an unapplied sun cannot look like a lit one', () => {
    // Both lamps are built at intensity 0 for the reason `UNSET_COLOUR` is
    // black: three's own default is 1, and a renderer that stopped calling
    // `apply` would then light the world with a sun that came from nowhere —
    // and every assertion about *a* lit scene would pass over it.
    const lamps = new WorldLamps();

    for (const lamp of lamps.lamps) {
      expect(lamp.intensity).toBe(0);
    }
  });

  it('converts the normalised shares into three own units, with the π', () => {
    // ⚠️ **The one line in this change that a reviewer cannot check by
    // reading.** three's Lambert path divides every irradiance by π
    // (`BRDF_Lambert`), so a share of 1 is an intensity of π and not of 1.
    // Drop the factor and the whole world renders at 32 % of its colours — a
    // scene that is plausibly "moodier" rather than obviously broken, which is
    // why it is asserted rather than eyeballed.
    const sun = harnessSun();
    const lamps = new WorldLamps();
    lamps.apply(sun);
    const [ambient, directional] = lamps.lamps;

    expect(ambient.intensity).toBeCloseTo(sun.ambient * Math.PI, 12);
    expect(directional.intensity).toBeCloseTo(sun.direct * Math.PI, 12);
    // And the property the two numbers exist to satisfy, restated through the
    // shader's own arithmetic: a horizontal surface comes out at its own
    // colour, which is what lets the ground plane and the road stay unlit.
    const horizontal = (ambient.intensity + directional.intensity * sun.y) / Math.PI;
    expect(horizontal).toBeCloseTo(1, 12);
  });

  it('points the directional lamp at the route own sun', () => {
    const sun = harnessSun();
    const lamps = new WorldLamps();
    lamps.apply(sun);
    const [, directional] = lamps.lamps;

    // three takes the direction as `position − target`, and the target is left
    // at the origin — so the position *is* the direction. A lamp positioned
    // anywhere else is a lamp shining somewhere else.
    expect([directional.position.x, directional.position.y, directional.position.z]).toEqual([
      sun.x,
      sun.y,
      sun.z,
    ]);
    expect([
      directional.target.position.x,
      directional.target.position.y,
      directional.target.position.z,
    ]).toEqual([0, 0, 0]);
  });

  it('lights no colour past white', () => {
    // ⚠️ **What keeps `SUN_ELEVATION_AT_POLE_DEGREES` honest, and the only
    // place both halves of that constraint are visible at once.** `world.ts`
    // solves `direct` from the requirement that a horizontal surface receive
    // exactly 1, so a lower sun means a brighter direct lamp; a face square-on
    // to it receives `PEAK_IRRADIANCE`, and a colour that then exceeds white
    // is clamped — which turns a shaded model into a flat white patch and
    // takes away exactly the form #286 added.
    //
    // Lower the elevation floor, or add a brighter scenery or marker colour,
    // and this goes red. That is the intended way to find out.
    expect(LIT_COLOURS.length).toBeGreaterThan(6);
    for (const colour of LIT_COLOURS) {
      for (const shift of [16, 8, 0]) {
        const channel = (colour >> shift) & 0xff;
        expect(toLinear(channel) * PEAK_IRRADIANCE).toBeLessThanOrEqual(1);
      }
    }
  });

  it('covers every lit material in the scene, not a sample of them', () => {
    // The list is derived from the style tables rather than typed out, so this
    // states the size it must have: one per scenery kind, one per **solid**
    // marker, and the rider's own palette. A kind added without a colour in the
    // list would make the bound above pass vacuously for it.
    //
    // ⚠️ **Two solid markers rather than three, since #349** — the rider is a
    // bicycle now, and its four colours arrive from `bicycle.ts` instead.
    //
    // ⚠️ **And one more since #459: the bridges' stone**, which is lit like
    // the scenery and is this file's own colour. (The ground is lit too since
    // #458, but its colour is `world.ts`'s ground colour, a horizontal
    // surface's, which `world.test.ts` bounds.)
    expect(LIT_COLOURS).toHaveLength(SCATTER_KINDS.length + 2 + BICYCLE_COLOURS.length + 1);
    expect(LIT_COLOURS).toContain(BRIDGE_COLOUR);
    expect(new Set(LIT_COLOURS).size).toBe(LIT_COLOURS.length);
  });
});

/**
 * The floor rung takes the shading back off — #286, and #245's question.
 *
 * ADR 0008 D-2's rendering gate was **waived rather than passed**, so nobody
 * knows what a shading pass costs on the device floor. The answer #286 records
 * is a rung: `QUALITY_LADDER`'s last entry is `shading: 'flat'`, and what
 * follows from that is asserted here.
 */
describe('the scenery can lose its shading — #286', () => {
  it('wears the lit material at the target quality', () => {
    const belt = new ScatterBelt();
    belt.setShading(qualitySettings(0).shading);

    for (const kind of SCATTER_KINDS) {
      expect(materialTypeOf(belt, kind)).toBe('MeshLambertMaterial');
    }
  });

  it('wears the unlit one at the floor rung', () => {
    const belt = new ScatterBelt();
    belt.setShading(qualitySettings(3).shading);

    for (const kind of SCATTER_KINDS) {
      expect(materialTypeOf(belt, kind)).toBe('MeshBasicMaterial');
    }
  });

  it('swaps back and forth without building anything', () => {
    // ⚠️ **Identity, not type.** The rung is reached on a phone that is
    // already too hot, and a material built on the way down is an allocation
    // on the worst frame of the ride — #240's NFR-3. Both materials exist from
    // construction, so going down and back up has to return the *same objects*
    // rather than equivalent ones.
    const belt = new ScatterBelt();
    const first = meshFor(belt, 'tree-conifer')?.material;
    belt.setShading('flat');
    const flat = meshFor(belt, 'tree-conifer')?.material;
    belt.setShading('lit');

    expect(flat).not.toBe(first);
    expect(meshFor(belt, 'tree-conifer')?.material).toBe(first);
    belt.setShading('flat');
    expect(meshFor(belt, 'tree-conifer')?.material).toBe(flat);
  });

  it('keeps the colour it was given, whichever material is on', () => {
    // The rung gives up the *shading*, not the palette: a flat conifer is the
    // colour a lit conifer averages around, which is what `three-renderer.ts`
    // drew before #286 at all.
    //
    // ⚠️ **Read off the GEOMETRY since #366, where it used to be read off the
    // material's `color`.** A reviewer who remembers `material.color.getHex()`
    // here is reading the old file — a vertex-coloured material holds white,
    // and asserting that white survives a shading swap would be a test that
    // cannot fail. The palette is in the vertices now, and swapping a material
    // does not touch them.
    const belt = new ScatterBelt();
    const colourOf = () => {
      const colour = meshFor(belt, 'rock')?.geometry.getAttribute('color');
      return colour === undefined ? [] : [colour.getX(0), colour.getY(0), colour.getZ(0)];
    };
    belt.setShading('lit');
    const lit = colourOf();
    belt.setShading('flat');

    expect(colourOf()).toEqual(lit);
    expect(Math.max(...lit)).toBeGreaterThan(0);
    // …and both materials take their colour from there rather than holding one.
    for (const shading of ['lit', 'flat'] as const) {
      belt.setShading(shading);
      const material = meshFor(belt, 'rock')?.material;

      expect((material as unknown as { vertexColors: boolean } | undefined)?.vertexColors).toBe(
        true,
      );
    }
  });

  it('releases both materials of every pair, not the one that is mounted', () => {
    // ⚠️ **A leak no other assertion here can see, and it is the cost of
    // holding two materials instead of one.** `mesh.material` is whichever is
    // mounted, so a `dispose` written the obvious way releases half of them
    // and strands the other half's program in the driver for the life of the
    // context — for six kinds, on a device that has just told us it is short
    // of resources. three has no "was disposed" flag; the event its own
    // `dispose()` fires is what there is, so that is what is counted.
    const belt = new ScatterBelt();
    const released = new Set<unknown>();
    const watch = (material: unknown) => {
      (
        material as { addEventListener: (type: string, listener: () => void) => void }
      ).addEventListener('dispose', () => released.add(material));
      return material;
    };
    belt.setShading('lit');
    const lit = [...belt.meshes.values()].map((mesh) => watch(mesh.material));
    belt.setShading('flat');
    const flat = [...belt.meshes.values()].map((mesh) => watch(mesh.material));

    // ⚠️ **Two rather than twelve, since #366** — one pair for the whole belt
    // instead of one a kind. The leak this guards is unchanged in kind and
    // smaller in size: whichever material is mounted is the one a `dispose`
    // written the obvious way releases, and the other's program is stranded in
    // the driver for the life of the context.
    expect(new Set([...lit, ...flat]).size).toBe(2);
    belt.dispose();

    for (const material of [...lit, ...flat]) {
      expect(released.has(material)).toBe(true);
    }
  });

  it('is the last rung of the ladder that gives it up, and only that one', () => {
    // Resolution and frame rate are each given up twice before the sun goes,
    // because a rider notices a softer world far less than a world that has
    // stopped having a light direction in it.
    expect(qualitySettings(0).shading).toBe('lit');
    expect(qualitySettings(1).shading).toBe('lit');
    expect(qualitySettings(2).shading).toBe('lit');
    expect(qualitySettings(3).shading).toBe('flat');
  });
});

/**
 * The material a belt's mesh is wearing, by three's own `type` string.
 *
 * Read as a string rather than with an `instanceof`, because this file must
 * not import `three` — `three-seam.test.ts` is what says so.
 */
function materialTypeOf(belt: ScatterBelt, kind: ScatterKind): string {
  const material = meshFor(belt, kind)?.material;
  if (material === undefined || Array.isArray(material)) {
    return 'none';
  }
  return material.type;
}

/**
 * What the shader would put on a face, from the lamps rather than from the
 * shares — the round trip through three's units and back.
 *
 * @unwired the arithmetic `irradianceOn` states in normalised units, restated
 * through the two lamp intensities so that the π conversion is covered by a
 * property rather than only by an equality.
 */
function irradianceFromLamps(lamps: WorldLamps, nx: number, ny: number, nz: number): number {
  const [ambient, directional] = lamps.lamps;
  const { x, y, z } = directional.position;
  const length = Math.hypot(x, y, z);
  const facing = Math.max(0, (nx * x + ny * y + nz * z) / length);
  return (ambient.intensity + directional.intensity * facing) / Math.PI;
}

describe('the lamps and the arithmetic agree — #286', () => {
  it('reproduces `irradianceOn` for every face, through three own units', () => {
    // ⚠️ Two independent statements of the same quantity: `world.ts` computes
    // it in shares of a horizontal surface's light, and this reads it back off
    // the two lamp intensities the renderer actually set. They can only agree
    // while the π conversion is right in both directions.
    const sun = worldStyle(routeProfile(flatRouteAt(0))).sun;
    const lamps = new WorldLamps();
    lamps.apply(sun);

    const normals: readonly (readonly [number, number, number])[] = [
      [0, 1, 0],
      [1, 0, 0],
      [0, 0, 1],
      [-1, 0, 0],
      [sun.x, sun.y, sun.z],
      [-sun.x, -sun.y, -sun.z],
    ];
    for (const [nx, ny, nz] of normals) {
      expect(irradianceFromLamps(lamps, nx, ny, nz)).toBeCloseTo(irradianceOn(sun, nx, ny, nz), 12);
    }
  });
});

describe('the scenery belt spends a budget it never sets — #245', () => {
  /**
   * In-view scenery, one item a metre up the road.
   *
   * ⚠️ A metre apart rather than anything wider, so that three hundred items
   * all sit inside {@link VIEW_AHEAD_METRES} and the *cull* is not what bounds
   * the count. Spaced two metres apart the first of these assertions read 201
   * rather than 240 and would have been a test of the corridor's length.
   */
  function belt(count: number, kind: ScatterKind = 'shrub'): readonly ScatterItem[] {
    return Array.from({ length: count }, (_, at) => item({ kind, x: 3, z: at }));
  }

  it('submits no more instances than the rung allows', () => {
    // #245's fifth criterion. `count` is what a driver is asked to draw, so
    // `count` is what this reads — a belt that left the matrices in place and
    // only moved `visible` would submit every one of them.
    const scenery = new ScatterBelt();
    const floor = qualitySettings(3).scatterItems;

    scenery.setBudget(floor);
    scenery.update(belt(floor + 40), POSE);

    expect(submitted(scenery)).toBe(floor);
  });

  it('is unbudgeted until a rung says otherwise', () => {
    // ⚠️ **The control for the test above, and a decision rather than a
    // default.** `grows the buffer, and keeps the mesh, when a caller exceeds
    // the budget` is the assertion that a caller who ignores `scatter.ts`'s
    // figure is grown for rather than silently truncated — scenery placed and
    // never shown is #240's named defect shape. A belt that budgeted itself at
    // `SCATTER_MAX_ITEMS` from construction would convert that decision into
    // exactly the truncation it refuses, and would do it invisibly.
    const scenery = new ScatterBelt();
    const many = SCATTER_INSTANCE_CAPACITY + 30;

    scenery.update(belt(many, 'rock'), POSE);

    expect(submitted(scenery)).toBe(many);
  });

  it('changes what is submitted across all four rungs, and reallocates for none of them', () => {
    // #245's sixth criterion, NFR-3. The rungs are reached on a phone that is
    // already too hot, so a buffer replaced on the way down is an allocation on
    // the worst frame of the ride — and on the same JavaScript thread GATT
    // notifications arrive on.
    const scenery = new ScatterBelt();
    const frame = belt(SCATTER_MAX_ITEMS + 60, 'tree-conifer');
    const mesh = meshFor(scenery, 'tree-conifer');
    scenery.setBudget(qualitySettings(0).scatterItems);
    scenery.update(frame, POSE);
    const attributeAtTheTop = mesh?.instanceMatrix;
    const bufferAtTheTop = mesh?.instanceMatrix.array;

    const counts = [0, 1, 2, 3].map((level) => {
      scenery.setBudget(qualitySettings(level as 0 | 1 | 2 | 3).scatterItems);
      scenery.update(frame, POSE);
      return submitted(scenery);
    });

    expect(counts).toEqual(QUALITY_LADDER.map((rung) => rung.scatterItems));
    // Non-vacuity: the counts have to have actually moved, or the three
    // identity assertions below are a claim about a belt nobody disturbed.
    expect(new Set(counts).size).toBe(QUALITY_LADDER.length);
    expect(meshFor(scenery, 'tree-conifer')).toBe(mesh);
    expect(meshFor(scenery, 'tree-conifer')?.instanceMatrix).toBe(attributeAtTheTop);
    expect(meshFor(scenery, 'tree-conifer')?.instanceMatrix.array).toBe(bufferAtTheTop);
  });

  it('never grows a buffer for scenery a rung has already refused', () => {
    // ⚠️ **What the two passes' identical guards actually buy**, and the
    // mutation that finds it: a budget that stopped the *writing* pass and not
    // the *counting* pass leaves `mesh.count` correct — so every assertion
    // above stays green — while {@link reserve} sizes for everything that was
    // placed. A caller over `SCATTER_INSTANCE_CAPACITY` would then strand a GL
    // buffer on the floor rung, which is a per-frame allocation on the one
    // device that has already said it is short of resources. NFR-3.
    const scenery = new ScatterBelt();
    const mesh = meshFor(scenery, 'rock');
    const attributeBefore = mesh?.instanceMatrix;
    scenery.setBudget(qualitySettings(3).scatterItems);

    scenery.update(belt(SCATTER_INSTANCE_CAPACITY + 60, 'rock'), POSE);

    expect(submitted(scenery)).toBe(qualitySettings(3).scatterItems);
    expect(meshFor(scenery, 'rock')?.instanceMatrix).toBe(attributeBefore);
    expect(meshFor(scenery, 'rock')?.instanceMatrix.count).toBe(SCATTER_INSTANCE_CAPACITY);
  });

  it('takes the frame in the order it was given rather than choosing for itself', () => {
    // ⚠️ **"The renderer applies the budget and never decides it"**, asserted
    // rather than asserted-about. The thinning that decides *which* scenery
    // survives is `scatter.ts`'s, it is biased towards the rider, and it runs
    // where jsdom can see it. A belt that ranked its own items would be a
    // scenery decision inside the render loop — code whose first execution is
    // on a rider's phone at minute fifty, which is the whole reason
    // `quality.ts` is a pure function in a file of its own.
    const scenery = new ScatterBelt();
    scenery.setBudget(3);

    scenery.update(belt(9), POSE);

    expect(submitted(scenery)).toBe(3);
    expect(instancePosition(scenery, 'shrub', 0)[2]).toBe(0);
    expect(instancePosition(scenery, 'shrub', 1)[2]).toBe(1);
    expect(instancePosition(scenery, 'shrub', 2)[2]).toBe(2);
  });

  it('counts the same items it writes, kind by kind', () => {
    // ⚠️ The defect the two passes' identical guards exist to prevent, and it
    // is this program's named shape one layer below a frame: a budget that
    // stopped the *counting* pass and the *writing* pass at different items
    // leaves `mesh.count` disagreeing with the matrices behind it — a submitted
    // instance whose matrix was never written, drawn at whatever the buffer
    // last held.
    const scenery = new ScatterBelt();
    const mixed = Array.from({ length: 10 }, (_, at) =>
      item({ kind: at % 2 === 0 ? 'rock' : 'post', x: 3, z: at * 2 }),
    );
    scenery.setBudget(7);

    scenery.update(mixed, POSE);

    expect(meshFor(scenery, 'rock')?.count).toBe(4);
    expect(meshFor(scenery, 'post')?.count).toBe(3);
    expect(instancePosition(scenery, 'rock', 3)[2]).toBe(12);
    expect(instancePosition(scenery, 'post', 2)[2]).toBe(10);
  });

  it('spends the budget on what survives the cull, not on what was placed', () => {
    // A budget counted before the cull would be spent on scenery behind the
    // rider and off the side of the road, and the rung would thin the view a
    // second time on a frame that had already lost most of it.
    const scenery = new ScatterBelt();
    scenery.setBudget(2);

    scenery.update(
      [
        item({ kind: 'shrub', z: 900 }),
        item({ kind: 'shrub', x: 900, z: 10 }),
        item({ kind: 'shrub', z: 20 }),
        item({ kind: 'shrub', z: 30 }),
        item({ kind: 'shrub', z: 40 }),
      ],
      POSE,
    );

    expect(submitted(scenery)).toBe(2);
    expect(instancePosition(scenery, 'shrub', 0)[2]).toBe(20);
    expect(instancePosition(scenery, 'shrub', 1)[2]).toBe(30);
  });

  it('draws nothing, and hides everything, when a rung allows nothing', () => {
    // Not a rung the ladder has — `QualitySettings.scatterItems` says why the
    // floor is sixty rather than zero — and the behaviour is asserted anyway,
    // because `mesh.visible` is the half a `count` of zero does not state.
    const scenery = new ScatterBelt();
    scenery.setBudget(0);

    scenery.update(belt(40), POSE);

    expect(submitted(scenery)).toBe(0);
    expect([...scenery.meshes.values()].every((mesh) => !mesh.visible)).toBe(true);
  });
});

/**
 * The shapes the models bring — #341, and ADR 0022 D-3, D-4 and D-7.
 *
 * ## Why every fixture here is built out of the belt's own primitives
 *
 * ⚠️ **This file may not import `three`.** `three-seam.test.ts` allows exactly
 * one importer in the whole repository, and a test that reached for a
 * `BufferGeometry` to build a fake model with would be the second — which is
 * the erosion that rule exists to stop, arriving through the door marked "it is
 * only a test".
 *
 * So a fake model's parts are real geometries taken out of a real
 * {@link ScatterBelt}: `SCATTER_STYLE`'s own primitives, cloned and shifted
 * with `BufferGeometry`'s own methods. That costs nothing in fidelity for what
 * is being asserted — {@link prepareSceneryGeometry} reads `isMesh`, a
 * geometry and a world matrix, and a cylinder is as good a stand-in for a tree
 * as a tree is.
 *
 * ## What is here, and what is deliberately left to the browser
 *
 * Here: the fit, the base, the centring, the merge, the fallback, and the one
 * that matters most — **that a belt a real view builds actually draws the
 * loaded shape**, which is this program's named defect shape one layer below a
 * store. In `game.browser.spec.ts`: that the committed `.glb` files parse in a
 * real engine at all, that the atlas is never requested, and that the result
 * reaches the drawing buffer. Neither is the other's superset.
 */
describe('the shapes the models bring — #341', () => {
  /** A belt's own primitive for a kind, cloned so the belt keeps its own. */
  const primitiveOf = (belt: ScatterBelt, kind: ScatterKind) => {
    const geometry = meshFor(belt, kind)?.geometry;
    if (geometry === undefined) {
      throw new Error(`no geometry for ${kind}`);
    }
    return geometry;
  };

  /**
   * A stand-in for a loaded glTF scene, holding one part per geometry given.
   *
   * `prepareSceneryGeometry` walks a scene with `traverse` and reads `isMesh`,
   * `geometry` and `matrixWorld` off each node. Everything else an `Object3D`
   * has is irrelevant to it, which is why a plain object is a fair fixture
   * rather than a mock that agrees with the implementation by construction.
   */
  const sceneOf = (
    parts: readonly { geometry: unknown; matrixWorld: unknown; material?: unknown }[],
  ): Parameters<typeof prepareSceneryGeometry>[0] =>
    ({
      updateWorldMatrix: () => undefined,
      traverse: (visit: (node: unknown) => void) => {
        for (const part of parts) {
          visit({ isMesh: true, ...part });
        }
      },
    }) as unknown as Parameters<typeof prepareSceneryGeometry>[0];

  /** The bounding box of a prepared geometry, as six plain numbers. */
  const boxOf = (geometry: ReturnType<typeof prepareSceneryGeometry>) => {
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    if (box === null) {
      throw new Error('no bounding box');
    }
    return { min: box.min, max: box.max };
  };

  /** Everything `loadSceneryModels` needs from a loader, over one fake part. */
  const loaderFrom = (belt: ScatterBelt, donor: ScatterKind) => {
    const mesh = meshFor(belt, donor);
    if (mesh === undefined) {
      throw new Error(`no mesh for ${donor}`);
    }
    return () =>
      Promise.resolve(
        sceneOf([{ geometry: mesh.geometry.clone(), matrixWorld: mesh.matrixWorld }]),
      );
  };

  afterEach(async () => {
    // ⚠️ `loadSceneryModels` writes module state, which is the whole of how a
    // synchronous `create` gets asynchronous shapes. Left set, it would leak
    // into whatever ran next in this file and make an assertion about
    // primitives pass or fail for a reason nobody wrote down.
    await loadSceneryModels(() => Promise.reject(new Error('no models in this test')));
  });

  it('measures how much room a shape may take from the solid it replaces', () => {
    // ⚠️ The numbers are the primitives' own extents, written out so that a
    // change to `SCATTER_STYLE` — a taller conifer, a wider building — is
    // visible here rather than silently rescaling every model with it.
    expect(sceneryFitMetres('tree-broadleaf')).toBeCloseTo(4.4, 6);
    expect(sceneryFitMetres('tree-conifer')).toBeCloseTo(7, 6);
    expect(sceneryFitMetres('shrub')).toBeCloseTo(1.6, 6);
    expect(sceneryFitMetres('rock')).toBeCloseTo(1.8, 6);
    expect(sceneryFitMetres('post')).toBeCloseTo(1.1, 6);
    expect(sceneryFitMetres('building')).toBeCloseTo(9, 6);
  });

  it('scales a model to the space the solid occupied, whichever way round it is', () => {
    // The stand-in is the post's cylinder: 0.14 m across and 1.1 m tall, so its
    // largest extent is its height. Refitted as a building it must end up 9 m
    // in its largest dimension and no more in any other — which is the
    // assertion a "match the height" rule would fail on a flat boulder.
    const belt = new ScatterBelt();
    const prepared = prepareSceneryGeometry(
      sceneOf([
        {
          geometry: primitiveOf(belt, 'post').clone(),
          matrixWorld: meshFor(belt, 'post')?.matrixWorld,
        },
      ]),
      'building',
    );
    const { min, max } = boxOf(prepared);

    expect(Math.max(max.x - min.x, max.y - min.y, max.z - min.z)).toBeCloseTo(9, 5);
    expect(max.y - min.y).toBeCloseTo(9, 5);
    expect(max.x - min.x).toBeLessThan(9);
    belt.dispose();
  });

  it('sits a model on the ground and centres it over its own spot', () => {
    // A `ScatterItem`'s `y` is the ground under it, so a model left on its own
    // origin is half buried — which is why `SCATTER_STYLE` translates every
    // primitive and why a model has to be given the same treatment. The
    // stand-in is deliberately off-centre and deliberately below zero: the
    // rock's octahedron sits from −0.4 to 1.4, and it is shifted 5 m east and
    // 3 m north before it is handed over.
    const belt = new ScatterBelt();
    const prepared = prepareSceneryGeometry(
      sceneOf([
        {
          geometry: primitiveOf(belt, 'rock').clone().translate(5, 0, -3),
          matrixWorld: meshFor(belt, 'rock')?.matrixWorld,
        },
      ]),
      'rock',
    );
    const { min, max } = boxOf(prepared);

    expect(min.y).toBeCloseTo(0, 5);
    expect((min.x + max.x) / 2).toBeCloseTo(0, 5);
    expect((min.z + max.z) / 2).toBeCloseTo(0, 5);
    belt.dispose();
  });

  it('merges a model of several parts into one geometry, because one draw call', () => {
    // ⚠️ #341's own words: *"One geometry per kind, instanced… Six packs of
    // individually-drawn models would multiply draw calls by the item count and
    // undo #245's budget entirely."* A tree in this pack is two parts, because
    // its trunk and its canopy were different materials.
    const belt = new ScatterBelt();
    const trunk = primitiveOf(belt, 'post').clone();
    const canopy = primitiveOf(belt, 'shrub').clone().translate(0, 2, 0);
    const vertices = (geometry: { getAttribute: (name: string) => { count: number } }) =>
      geometry.getAttribute('position').count;
    const parted = vertices(trunk) + vertices(canopy);

    const prepared = prepareSceneryGeometry(
      sceneOf([
        { geometry: trunk, matrixWorld: meshFor(belt, 'post')?.matrixWorld },
        { geometry: canopy, matrixWorld: meshFor(belt, 'shrub')?.matrixWorld },
      ]),
      'tree-broadleaf',
    );

    expect(vertices(prepared)).toBe(parted);
    // Position, normal and — since #366 — the colour baked off each part's own
    // material, and nothing else. ⚠️ A reviewer who remembers this expecting
    // two attributes is reading the old file: the third is #366's whole
    // change. A **UV** kept for a texture that is never uploaded is still a
    // third of a vertex buffer uploaded for nothing, and an attribute set that
    // disagrees between parts is still what refuses the merge.
    expect(Object.keys(prepared.attributes).sort()).toEqual(['color', 'normal', 'position']);
    expect(prepared.getAttribute('color').count).toBe(parted);
    belt.dispose();
  });

  it("bakes a part's own material colour onto vertices that had none — #366", () => {
    // ⚠️ **The assertion #366 actually turns on, and the one the merge test
    // above CANNOT make.** That fixture clones a belt's own primitives, and a
    // primitive already carries a `color` attribute since #366 — so it would
    // report three attributes whether or not this function added one, which
    // was measured rather than reasoned about: deleting the call to
    // `paintFromMaterial` leaves it green. A part with no colour of its own,
    // and a material that has one, is the only shape that can tell them apart.
    const belt = new ScatterBelt();
    const bare = primitiveOf(belt, 'rock').clone();
    bare.deleteAttribute('color');

    const prepared = prepareSceneryGeometry(
      sceneOf([
        {
          geometry: bare,
          matrixWorld: meshFor(belt, 'rock')?.matrixWorld,
          // Mid-grey in the linear space a glTF's `baseColorFactor` is defined
          // in, which is what three's loader puts on `material.color`. Well
          // under the ceiling, so the toning leaves it exactly alone.
          material: { color: { r: 0.25, g: 0.5, b: 0.125 } },
        },
      ]),
      'rock',
    );
    const colour = prepared.getAttribute('color');

    expect(colour).toBeDefined();
    expect(colour.count).toBe(prepared.getAttribute('position').count);
    // Straight through with no conversion: a `baseColorFactor` is linear and so
    // is a `COLOR_0`. A hex triple taking three's `Color` path would land at
    // about 0.05, 0.21 and 0.015 instead.
    expect([colour.getX(0), colour.getY(0), colour.getZ(0)]).toEqual([0.25, 0.5, 0.125]);
    expect([colour.getX(colour.count - 1), colour.getY(colour.count - 1)]).toEqual([0.25, 0.5]);
    belt.dispose();
  });

  it('samples a textured part at each vertex, once, and keeps no image — #366', () => {
    // ⚠️ **The building's whole colour arrives this way**, and the three things
    // that could go wrong are all invisible from outside: sampling the wrong
    // texel, sampling once for the whole part, and keeping the image. The first
    // two are here; the third is `game.browser.spec.ts`, which counts
    // `gl.createTexture`.
    const belt = new ScatterBelt();
    const bare = primitiveOf(belt, 'rock').clone();
    bare.deleteAttribute('color');
    // One `u` per vertex, spread across a two-texel image, so a sampler that
    // read one texel for the part gives every vertex the same answer.
    const vertices = bare.getAttribute('position').count;
    const uv = new Float32Array(vertices * 2);
    for (let at = 0; at < vertices; at += 1) {
      uv[at * 2] = at % 2 === 0 ? 0.25 : 0.75;
      uv[at * 2 + 1] = 0.5;
    }
    bare.setAttribute(
      'uv',
      new (
        bare.getAttribute('position').constructor as new (
          array: Float32Array,
          size: number,
        ) => never
      )(uv, 2),
    );

    const prepared = prepareSceneryGeometry(
      sceneOf([
        {
          geometry: bare,
          matrixWorld: meshFor(belt, 'rock')?.matrixWorld,
          material: { color: { r: 1, g: 1, b: 1 }, map: { image: { width: 2, height: 1 } } },
        },
      ]),
      'rock',
      // Two texels: pure red, then pure blue.
      () => ({
        width: 2,
        height: 1,
        data: new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255]),
      }),
    );
    const colour = prepared.getAttribute('color');
    const channelsAt = (at: number) => [colour.getX(at), colour.getY(at), colour.getZ(at)];

    // The left texel for the even vertices and the right one for the odd, both
    // brought under the ceiling by the toning — which is what a pure channel
    // needs and is why neither reads as exactly one.
    expect(channelsAt(0)[0]).toBeCloseTo(MAXIMUM_LIT_CHANNEL, 6);
    expect(channelsAt(0)[2]).toBe(0);
    expect(channelsAt(1)[2]).toBeCloseTo(MAXIMUM_LIT_CHANNEL, 6);
    expect(channelsAt(1)[0]).toBe(0);
    // ⚠️ And the UV is gone, which is the half that costs a phone something: a
    // texture coordinate kept for an image that is never uploaded is a third of
    // a vertex buffer sent for nothing.
    expect(Object.keys(prepared.attributes).sort()).toEqual(['color', 'normal', 'position']);
    belt.dispose();
  });

  it('refuses a scene with no mesh in it rather than drawing nothing', () => {
    expect(() => prepareSceneryGeometry(sceneOf([]), 'rock')).toThrow(/holds no mesh/);
  });

  it('refuses a model with no size rather than dividing by its extent', () => {
    // A part collapsed onto its own origin has a largest extent of zero, and
    // the fit is a division by it: without the guard every vertex comes back
    // `NaN`, three quietly draws nothing, and the kind looks like one whose
    // file was missing. A throw puts it back on the fallback path instead.
    const belt = new ScatterBelt();
    const flattened = primitiveOf(belt, 'rock').clone().scale(0, 0, 0);

    expect(() =>
      prepareSceneryGeometry(
        sceneOf([{ geometry: flattened, matrixWorld: meshFor(belt, 'rock')?.matrixWorld }]),
        'rock',
      ),
    ).toThrow(/no extent/);
    belt.dispose();
  });

  it('walks past a scene node that is not a mesh, and computes a missing normal', () => {
    // ⚠️ Both halves are things a real file does and this file's stand-ins do
    // not. A glTF scene's root is a group, and the pack's own trees hang their
    // meshes under one — a walk that assumed every node was a mesh would read
    // `undefined.geometry`. And a primitive set that ships no normals is legal
    // glTF; a model with none would be drawn black by a lit material.
    const belt = new ScatterBelt();
    const bare = primitiveOf(belt, 'shrub').clone();
    bare.deleteAttribute('normal');

    const prepared = prepareSceneryGeometry(
      {
        updateWorldMatrix: () => undefined,
        traverse: (visit: (node: unknown) => void) => {
          visit({ isMesh: false, name: 'a group' });
          visit({
            isMesh: true,
            geometry: bare,
            matrixWorld: meshFor(belt, 'shrub')?.matrixWorld,
          });
        },
      } as unknown as Parameters<typeof prepareSceneryGeometry>[0],
      'shrub',
    );

    expect(prepared.getAttribute('normal').count).toBe(prepared.getAttribute('position').count);
    belt.dispose();
  });

  it('draws the loaded shape through the belt a view actually builds', () => {
    // ⚠️ **The assertion this whole change turns on.** `loadSceneryModels`
    // writes module state and `new ScatterBelt()` reads it, and a write that
    // reports success where the read cannot see it is this program's named
    // defect shape. So the read is the one the shipped client makes: no
    // argument, no injected map, the same constructor `ThreeGameView` calls.
    const donor = new ScatterBelt();
    const before = meshFor(donor, 'rock')?.geometry.getAttribute('position').count ?? 0;
    const modelVertices =
      meshFor(donor, 'tree-conifer')?.geometry.getAttribute('position').count ?? 0;

    return loadSceneryModels(loaderFrom(donor, 'tree-conifer')).then(() => {
      const belt = new ScatterBelt();

      // Every kind with a model in the table now draws the loaded shape…
      for (const kind of Object.keys(SCENERY_MODELS) as ScatterKind[]) {
        expect(meshFor(belt, kind)?.geometry.getAttribute('position').count).toBe(modelVertices);
      }
      // …and `post`, which ADR 0022 D-3 leaves alone, still draws its cylinder.
      expect(meshFor(belt, 'post')?.geometry.getAttribute('position').count).toBe(
        meshFor(donor, 'post')?.geometry.getAttribute('position').count,
      );
      expect(modelVertices).not.toBe(before);
      belt.dispose();
      donor.dispose();
    });
  });

  it('keeps the primitive for a kind whose model could not be read', () => {
    // The risky half of this change, asserted rather than assumed: a rider
    // mid-ride loses a tree's shape, not the ride. `game.browser.spec.ts` is
    // what stops that graceful fallback becoming the shipped world in silence.
    const donor = new ScatterBelt();
    const counts = new Map(
      SCATTER_KINDS.map((kind) => [
        kind,
        meshFor(donor, kind)?.geometry.getAttribute('position').count,
      ]),
    );

    return loadSceneryModels(() => Promise.reject(new Error('404'))).then(() => {
      const belt = new ScatterBelt();

      for (const kind of SCATTER_KINDS) {
        expect(meshFor(belt, kind)?.geometry.getAttribute('position').count).toBe(counts.get(kind));
      }
      belt.dispose();
      donor.dispose();
    });
  });

  it('gives each belt its own copy, so a teardown does not empty the next ride', () => {
    // ⚠️ A leak in the other direction, and the one a `dispose` written the
    // obvious way produces: the loaded geometries are shared by every belt this
    // tab builds, and `ScatterBelt.dispose` releases every geometry it is
    // wearing. A belt wearing the shared model would take the model with it.
    const donor = new ScatterBelt();

    return loadSceneryModels(loaderFrom(donor, 'shrub')).then(() => {
      const first = new ScatterBelt();
      const worn = meshFor(first, 'rock')?.geometry;
      first.dispose();
      const second = new ScatterBelt();

      expect(meshFor(second, 'rock')?.geometry).not.toBe(worn);
      expect(meshFor(second, 'rock')?.geometry.getAttribute('position').count).toBe(
        worn?.getAttribute('position').count,
      );
      second.dispose();
      donor.dispose();
    });
  });
});

/**
 * The riders are bicycles, and they are drawn as such — #349, #368.
 *
 * ## What this file can say about it, and what it cannot
 *
 * `bicycle.test.ts` owns the **shape**: where the parts are, which way round
 * they face, where the knee goes, how far the cranks turn for a cadence. None
 * of that needs a renderer. What needs one is everything below — that the parts
 * become three meshes rather than twenty *however many riders a frame carries*,
 * that each marker's heading reaches its own instance, that the crank angle
 * reaches the crankset and the legs, and that both materials are released.
 *
 * ⚠️ **What is still not checkable here: that {@link ThreeGameView} ever calls
 * any of it.** A `RiderBelt` the view never added, or added and never placed,
 * satisfies every assertion below — #240's named defect shape, one more time.
 * `game.browser.spec.ts` reads the riders' own pixels back for exactly that
 * reason.
 */
describe('the riders are bicycles rather than solids — #349, #368', () => {
  /** A marker on the road, facing up it. */
  function riderAt(
    over: { readonly x?: number; readonly y?: number; readonly z?: number } = {},
    facing: { readonly headingX?: number; readonly headingZ?: number } = {},
    crankAngle?: number,
    kind: RiderMarker['kind'] = 'rider',
  ): RiderMarker {
    return {
      kind,
      x: over.x ?? 0,
      y: over.y ?? 0,
      z: over.z ?? 0,
      headingX: facing.headingX ?? 0,
      headingZ: facing.headingZ ?? 1,
      ...(crankAngle === undefined ? {} : { crankAngle }),
    };
  }

  /** The translation one instance matrix carries. */
  function originOf(
    mesh: { readonly instanceMatrix: { readonly array: ArrayLike<number> } },
    index: number,
  ): readonly [number, number, number] {
    const at = index * 16;
    const matrix = mesh.instanceMatrix.array;
    return [matrix[at + 12] ?? NaN, matrix[at + 13] ?? NaN, matrix[at + 14] ?? NaN];
  }

  /** Where one rider's leg segment's instance matrix puts it. */
  function boneAt(belt: RiderBelt, slot: number, index: number): readonly [number, number, number] {
    return originOf(belt.meshes.limbs, slot * LEG_BONE_COUNT + index);
  }

  /** The instance tint one slot wears, as three numbers. */
  function tintOf(
    mesh: { readonly instanceColor: { readonly array: ArrayLike<number> } | null },
    slot: number,
  ): readonly [number, number, number] {
    const channels = mesh.instanceColor?.array;
    if (channels === undefined) {
      return [NaN, NaN, NaN];
    }
    return [
      channels[slot * 3] ?? NaN,
      channels[slot * 3 + 1] ?? NaN,
      channels[slot * 3 + 2] ?? NaN,
    ];
  }

  it('is three draw calls for three riders, not three each', () => {
    // #240's NFR-2: draw calls are the budget, and `bicycle.ts` describes about
    // two dozen solids. #368's whole affordability argument is that the bot and
    // the ghost are two more instances in buffers that already exist.
    const belt = new RiderBelt();
    const { bodies, cranksets, limbs } = belt.meshes;

    expect(belt.group.children).toHaveLength(3);
    expect(new Set([bodies, cranksets, limbs]).size).toBe(3);
    // One material across all three, which is what the vertex colours buy.
    expect(new Set([bodies.material, cranksets.material, limbs.material]).size).toBe(1);
    belt.place([riderAt(), riderAt({ z: 40 }, {}, 0, 'bot'), riderAt({ z: 80 }, {}, 0, 'ghost')]);
    // …and still three after a frame carrying all three.
    expect(belt.group.children).toHaveLength(3);
    belt.dispose();
  });

  it('carries a colour on every vertex, which is what keeps it one material', () => {
    const belt = new RiderBelt();
    for (const mesh of [belt.meshes.bodies, belt.meshes.cranksets, belt.meshes.limbs]) {
      const colour = mesh.geometry.getAttribute('color');
      const position = mesh.geometry.getAttribute('position');
      expect(colour).toBeDefined();
      expect(colour.count).toBe(position.count);
      expect(position.count).toBeGreaterThan(20);
    }
    belt.dispose();
  });

  it('merges the parts rather than leaving them as children', () => {
    // A merge that silently failed would be a rider missing from the scene, and
    // `mergeGeometries` returns `null` rather than throwing. The body carries
    // far more vertices than any one solid could.
    const belt = new RiderBelt();
    expect(belt.meshes.bodies.geometry.getAttribute('position').count).toBeGreaterThan(300);
    expect(belt.meshes.cranksets.geometry.getAttribute('position').count).toBeGreaterThan(100);
    belt.dispose();
  });

  it('reserves every rider and every leg segment before the first frame', () => {
    // ⚠️ **Read off the buffers rather than off `count`**, which is rewound to
    // zero so that a belt drawn before its first frame draws nothing. A belt
    // that grew its buffers on the frame a ghost appeared would allocate in the
    // render loop, which is #240's NFR-3.
    const belt = new RiderBelt();
    expect(belt.meshes.bodies.instanceMatrix.count).toBe(3);
    expect(belt.meshes.limbs.instanceMatrix.count).toBe(3 * LEG_BONE_COUNT);
    expect(belt.meshes.bodies.count).toBe(0);
    belt.dispose();
  });

  it('allocates a colour buffer wide enough for every rider', () => {
    // ⚠️ **The trap this is here for.** three sizes `instanceColor` from
    // `count` at the moment it is first written, and the constructor rewinds
    // `count` to zero — so writing the tints after the rewind gives every mesh
    // a zero-length colour buffer and silently drops all three.
    const belt = new RiderBelt();
    for (const mesh of [belt.meshes.bodies, belt.meshes.cranksets]) {
      expect(mesh.instanceColor?.count).toBe(3);
    }
    expect(belt.meshes.limbs.instanceColor?.count).toBe(3 * LEG_BONE_COUNT);
    belt.dispose();
  });

  it('draws nothing until a frame carries a rider', () => {
    const belt = new RiderBelt();
    expect(belt.group.visible).toBe(false);
    belt.place([riderAt()]);
    expect(belt.group.visible).toBe(true);
    expect(belt.meshes.bodies.count).toBe(1);
    belt.hide();
    expect(belt.group.visible).toBe(false);
    expect(belt.meshes.bodies.count).toBe(0);
    belt.dispose();
  });

  it('draws one instance per marker the frame carries — #368', () => {
    const belt = new RiderBelt();

    belt.place([riderAt(), riderAt({ z: 40 }, {}, 0, 'bot')]);
    expect(belt.meshes.bodies.count).toBe(2);
    expect(belt.meshes.limbs.count).toBe(2 * LEG_BONE_COUNT);

    belt.place([riderAt(), riderAt({ z: 40 }, {}, 0, 'bot'), riderAt({ z: 80 }, {}, 0, 'ghost')]);
    expect(belt.meshes.bodies.count).toBe(3);
    expect(belt.meshes.cranksets.count).toBe(3);
    belt.dispose();
  });

  it('draws no rider for a kind the tint table does not hold', () => {
    // ⚠️ **`RIDER_TINTS` is an object literal, so `in` reaches its
    // prototype** — `'toString' in RIDER_TINTS` is true, and a marker that got
    // past a membership test on that basis would be handed `setHex(undefined)`
    // and drawn in a `NaN` colour, which three resolves to black or to nothing
    // at all depending on the driver. The cast is what a frame built from
    // parsed data could produce and what `port.ts`'s three-value union stops
    // anybody writing by hand.
    const belt = new RiderBelt();

    belt.place([{ ...riderAt(), kind: 'toString' as RiderMarker['kind'] }, riderAt()]);

    expect(belt.meshes.bodies.count).toBe(1);
    expect(tintOf(belt.meshes.bodies, 0)).toEqual([1, 1, 1]);
    belt.dispose();
  });

  it("stands each bicycle at its marker's own height, unlifted", () => {
    // ⚠️ **None of the three is lifted, and until #368 two of them were.** The
    // bot and the ghost were solids centred on their own origin and had to be
    // raised by their radius; `bicycle.ts` puts its wheels on zero itself, so a
    // lift here is a bicycle floating 80 cm above the road.
    const belt = new RiderBelt();
    belt.place([
      riderAt({ x: 4, y: 12.5, z: -7 }),
      riderAt({ x: 1, y: 9, z: 3 }, {}, 0, 'bot'),
      riderAt({ x: -2, y: 6, z: 11 }, {}, 0, 'ghost'),
    ]);

    expect(originOf(belt.meshes.bodies, 0)).toEqual([4, 12.5, -7]);
    expect(originOf(belt.meshes.bodies, 1)).toEqual([1, 9, 3]);
    expect(originOf(belt.meshes.bodies, 2)).toEqual([-2, 6, 11]);
    belt.dispose();
  });

  it('tells the three apart by the tint on their own instance — #368', () => {
    // ⚠️ **#93's third criterion, at the one place it can be checked without a
    // browser.** The shape no longer distinguishes them, so what does is this:
    // three different multipliers on one shared palette. The rider's is white,
    // which is no tint at all and is what keeps `bicycle.ts`'s palette the
    // literal thing a rider sees.
    const belt = new RiderBelt();
    belt.place([riderAt(), riderAt({ z: 40 }, {}, 0, 'bot'), riderAt({ z: 80 }, {}, 0, 'ghost')]);

    const tints = [0, 1, 2].map((slot) => tintOf(belt.meshes.bodies, slot));

    expect(tints[0]).toEqual([1, 1, 1]);
    expect(new Set(tints.map((tint) => tint.join(','))).size).toBe(3);
    // The bot leads on red and the ghost is very nearly neutral, which is the
    // direction `game.browser.spec.ts` reads back off the screen.
    const spread = (tint: readonly number[]) => Math.max(...tint) - Math.min(...tint);

    expect(tints[1]?.[0] ?? 0).toBeGreaterThan(tints[1]?.[2] ?? 1);
    // ⚠️ **Stated as a comparison rather than as a threshold.** The ghost is
    // not neutral — `0x64748b` is a cool grey and leads on blue — and a fixed
    // bound on how far from neutral it may be would be a number nobody could
    // defend. What is true and is the claim #93 needs is that it is *far* less
    // saturated than the bot, which is what a rider reads as colourless.
    expect(spread(tints[2] ?? [])).toBeLessThan(spread(tints[1] ?? []) / 2);
    belt.dispose();
  });

  it('gives a rider the tint of the kind it is, not of the slot it landed in', () => {
    // ⚠️ **The defect a fixed slot per kind would have hidden and compaction
    // makes possible.** A frame with a ghost and no bot puts the ghost in slot
    // 1, which is where the bot's tint was on the frame before.
    const belt = new RiderBelt();
    belt.place([riderAt(), riderAt({ z: 40 }, {}, 0, 'bot')]);
    const botTint = tintOf(belt.meshes.bodies, 1);

    belt.place([riderAt(), riderAt({ z: 80 }, {}, 0, 'ghost')]);

    expect(tintOf(belt.meshes.bodies, 1)).not.toEqual(botTint);
    belt.dispose();
  });

  it('faces each rider the way its own marker is heading', () => {
    // A bicycle has a front; the solids it replaced did not, which is why no
    // marker carried a heading before #349. Two riders on a bend face
    // different ways, which is what `scene.ts` takes each marker's own heading
    // from the corridor for.
    const belt = new RiderBelt();
    const root = Math.SQRT1_2;
    belt.place([
      riderAt({}, { headingX: 1, headingZ: 0 }),
      riderAt({ z: 40 }, { headingX: -root, headingZ: -root }, 0, 'bot'),
    ]);

    // A rotation about +Y by `atan2(headingX, headingZ)` takes (0,0,1) onto the
    // heading, so the model's own forward axis lands there. Read out of the
    // matrix rather than off a rotation, because an instance has no Euler.
    const forward = (slot: number): readonly [number, number] => {
      const at = slot * 16;
      const matrix = belt.meshes.bodies.instanceMatrix.array;
      return [matrix[at + 8] ?? NaN, matrix[at + 10] ?? NaN];
    };

    // ⚠️ **Six places, not nine.** An instance matrix is a `Float32Array`, so
    // the value read back has been through single precision and agrees with a
    // double to about seven significant figures. A `RiderModel` read its
    // rotation off a `Matrix4`'s own Euler and could afford nine.
    expect(forward(0)[0]).toBeCloseTo(1, 6);
    expect(forward(0)[1]).toBeCloseTo(0, 6);
    expect(forward(1)[0]).toBeCloseTo(-root, 6);
    expect(forward(1)[1]).toBeCloseTo(-root, 6);
    belt.dispose();
  });

  it('turns each crankset by the angle its own marker carries', () => {
    // ⚠️ **Read as a displacement rather than as a rotation.** The crankset is
    // an instance now, so there is no `rotation.x` to look at — and the thing
    // that would break is exactly what this checks: the crank geometry is
    // written in the bottom bracket's frame, so its instance is *mounted* there
    // and turns about its own origin. Baked into the vertices instead, the
    // rotation would swing the whole crankset round the bicycle.
    const belt = new RiderBelt();

    belt.place([riderAt({}, {}, 0)]);
    const atTop = originOf(belt.meshes.cranksets, 0);
    belt.place([riderAt({}, {}, Math.PI / 2)]);
    const quarterOn = originOf(belt.meshes.cranksets, 0);

    // The axis itself does not move: the offset is a rotation about it.
    expect(atTop).toEqual(quarterOn);
    // Six places, for the reason the heading assertion above gives.
    expect(atTop[1]).toBeCloseTo(CRANK_AXIS_Y, 6);
    expect(atTop[2]).toBeCloseTo(CRANK_AXIS_Z, 6);
    belt.dispose();
  });

  it('gives each rider its own crank angle', () => {
    // The rider's comes from a cadence and the other two from their odometers,
    // so on any real frame all three differ. A belt that wrote one angle to
    // every slot would be three riders pedalling in lockstep.
    const belt = new RiderBelt();
    belt.place([riderAt({}, {}, 0), riderAt({ z: 40 }, {}, Math.PI / 2, 'bot')]);

    expect(boneAt(belt, 0, 0)).not.toEqual(boneAt(belt, 1, 0));
    belt.dispose();
  });

  it('moves every leg segment when the cranks move, and uploads them', () => {
    // ⚠️ `instanceMatrix.needsUpdate` has a setter and no getter, so `version`
    // is what is read — the same reason `ScatterBelt`'s own test does.
    const belt = new RiderBelt();
    belt.place([riderAt({}, {}, 0)]);
    const before = [0, 1, 2, 3].map((index) => boneAt(belt, 0, index));
    const uploads = belt.meshes.limbs.instanceMatrix.version;

    belt.place([riderAt({}, {}, Math.PI / 2)]);
    const after = [0, 1, 2, 3].map((index) => boneAt(belt, 0, index));

    expect(belt.meshes.limbs.instanceMatrix.version).toBeGreaterThan(uploads);
    for (const index of [0, 1, 2, 3]) {
      expect(after[index]).not.toEqual(before[index]);
      for (const number of after[index] as readonly number[]) {
        expect(Number.isFinite(number)).toBe(true);
      }
    }
    belt.dispose();
  });

  it('poses the legs on the first frame rather than leaving them at the origin', () => {
    // An `InstancedMesh` starts every slot at the identity matrix, which puts
    // all four segments inside the bottom bracket.
    const belt = new RiderBelt();
    belt.place([riderAt({ x: 100, z: 200 }, {}, 0)]);

    for (const index of [0, 1, 2, 3]) {
      const bone = boneAt(belt, 0, index);
      // ⚠️ **Two claims, and the second is the one that was measured rather
      // than assumed.** Away from the bottom bracket, so the identity matrix an
      // `InstancedMesh` starts with has been overwritten — and *carried to
      // where the rider is*, because a leg written in the model's own frame and
      // never multiplied by the rider's transform lands at the world origin.
      // A bound of "further than nothing from the rider" is satisfied by both,
      // which is what a mutation of the multiply showed: it stayed green.
      expect(Math.hypot(bone[1] - 0.4, bone[2] - 200)).toBeGreaterThan(0.1);
      expect(Math.abs(bone[0] - 100)).toBeLessThan(0.5);
      expect(Math.abs(bone[2] - 200)).toBeLessThan(0.8);
      expect(bone[1]).toBeGreaterThan(0);
      expect(bone[1]).toBeLessThan(1.2);
    }
    belt.dispose();
  });

  it('does no leg work at all on a frame where nothing about a rider moved', () => {
    // A stationary bot, or a rider on a paused ride: the same place, the same
    // heading and the same crank angle twice. #240's NFR-3.
    //
    // ⚠️ **The rider is held STILL here, and until #366–#368's review it was
    // moved** — this assertion used to be made across a frame that put the
    // rider 30 m further up the road, which is the defect the test below
    // covers rather than a saving. A reviewer who remembers this case moving
    // the rider is reading the old file.
    const belt = new RiderBelt();
    belt.place([riderAt({ z: 30 }, {}, 1.1)]);
    const uploads = belt.meshes.limbs.instanceMatrix.version;

    belt.place([riderAt({ z: 30 }, {}, 1.1)]);

    expect(belt.meshes.limbs.instanceMatrix.version).toBe(uploads);
    // …and something was drawn, which is what makes the line above a saving
    // rather than an empty belt.
    expect(originOf(belt.meshes.bodies, 0)[2]).toBe(30);
    belt.dispose();
  });

  it('carries the legs with a rider who is moving and not pedalling', () => {
    // ⚠️ **The most common frame there is, and the one no gate could see.**
    // `advanceCrank` returns the angle unchanged when no cadence is being
    // reported, and `GameView` supplies that angle every frame — so this is
    // every frame of every power-only ride, and every frame after a rider
    // stops pedalling. The legs' matrices are composed in **world** space
    // (`#rider` times the bone's own local transform), so a cache keyed on the
    // crank angle alone leaves them where the first frame put them and the
    // screen shows a legless bicycle riding away from a pair of legs.
    //
    // On `main` the limbs sat in a `Group` carrying the world transform and
    // the skip was sound; the belt writes world matrices now, and
    // `POSE_KEY` is what makes the cache agree with that.
    const belt = new RiderBelt();
    belt.place([riderAt({ z: 0 }, {}, 1.1)]);

    belt.place([riderAt({ z: 100 }, {}, 1.1)]);

    for (const index of [0, 1, 2, 3]) {
      // Within a bicycle's length of the rider, rather than 100 m behind it.
      expect(boneAt(belt, 0, index)[2]).toBeCloseTo(100, 0);
    }
    // And re-uploaded: writing the matrices without raising the flag is the
    // half of an instanced update that cannot be seen from the buffer.
    expect(belt.meshes.limbs.instanceMatrix.version).toBeGreaterThan(0);
    belt.dispose();
  });

  it('draws a rider whose frame carries no crank angle at all', () => {
    // ⚠️ **`crankAngle` is optional on `RiderMarker`**, so a slot's first frame
    // can arrive with nothing to hold over from. The held angle is `NaN` until
    // a slot has been posed, and a `NaN` reaching a matrix is not a wrong
    // bicycle but no bicycle: three drops a mesh whose instance matrix is not
    // finite, silently.
    const belt = new RiderBelt();

    belt.place([riderAt({ z: 12 })]);

    for (const origin of [originOf(belt.meshes.cranksets, 0), boneAt(belt, 0, 0)]) {
      for (const number of origin) {
        expect(Number.isFinite(number)).toBe(true);
      }
    }
    belt.dispose();
  });

  it('carries the legs with a rider who turns without pedalling', () => {
    // The other half of the world transform. A rider freewheeling round a bend
    // keeps their crank angle and their position for a frame and changes only
    // their heading; a key holding the place and not the heading would leave
    // the legs facing the way they came.
    const belt = new RiderBelt();
    belt.place([riderAt({}, { headingX: 0, headingZ: 1 }, 1.1)]);
    const before = [0, 1, 2, 3].map((index) => boneAt(belt, 0, index));

    belt.place([riderAt({}, { headingX: 1, headingZ: 0 }, 1.1)]);

    expect([0, 1, 2, 3].map((index) => boneAt(belt, 0, index))).not.toEqual(before);
    belt.dispose();
  });

  it('re-poses a slot whose occupant changed, even at the same angle', () => {
    // ⚠️ **What the saving above would otherwise cost.** A slot that held the
    // bot last frame and the ghost this frame is a different rider at the same
    // index; a cache keyed on the angle alone would leave the ghost's legs
    // where the bot's were, which is a ride's worth of wrong legs.
    const belt = new RiderBelt();
    belt.place([riderAt(), riderAt({ z: 40 }, {}, 1.1, 'bot')]);
    const uploads = belt.meshes.limbs.instanceMatrix.version;

    belt.place([riderAt(), riderAt({ z: 80 }, {}, 1.1, 'ghost')]);

    expect(belt.meshes.limbs.instanceMatrix.version).toBeGreaterThan(uploads);
    belt.dispose();
  });

  it('gives up its shading at the floor rung, on all three meshes', () => {
    const belt = new RiderBelt();
    belt.setShading('lit');
    const lit = [belt.meshes.bodies.material, belt.meshes.cranksets.material];
    belt.setShading('flat');

    expect(belt.meshes.bodies.material).not.toBe(lit[0]);
    expect(belt.meshes.cranksets.material).toBe(belt.meshes.bodies.material);
    expect(belt.meshes.limbs.material).toBe(belt.meshes.bodies.material);
    belt.dispose();
  });

  it('releases both materials of the pair, not the one that is mounted', () => {
    const belt = new RiderBelt();
    const released = new Set<unknown>();
    const watch = (material: unknown) => {
      (
        material as { addEventListener: (type: string, listener: () => void) => void }
      ).addEventListener('dispose', () => released.add(material));
      return material;
    };
    belt.setShading('lit');
    const lit = watch(belt.meshes.bodies.material);
    belt.setShading('flat');
    const flat = watch(belt.meshes.bodies.material);
    expect(lit).not.toBe(flat);

    belt.dispose();

    expect(released.has(lit)).toBe(true);
    expect(released.has(flat)).toBe(true);
  });
});

/**
 * The belt draws a kind as several shapes, and the ladder can take them away —
 * #367.
 *
 * ⚠️ **What this file can say, and what it cannot.** It can say how many meshes
 * the belt holds, which one an item lands in, and that the count moves with the
 * rung. It cannot say what any of them **cost**, which is the number #367 is
 * actually about — `game.browser.spec.ts` measures the draw calls in a driver
 * and prints them, because a count of `Map` entries is not a claim about a GPU.
 */
describe('a kind is drawn as several shapes — #367', () => {
  /** The geometry a belt draws one kind's variant with. */
  type Shape = NonNullable<ReturnType<typeof meshFor>>['geometry'];

  /** Distinct geometries, one per variant, so a belt can tell them apart. */
  function shapesFor(kind: ScatterKind, count: number): ReadonlyMap<ScatterKind, readonly Shape[]> {
    const donor = new ScatterBelt();
    const built: Shape[] = [];
    for (let at = 0; at < count; at += 1) {
      // A different primitive per variant, so the geometries differ in vertex
      // count and an item drawn by the wrong one is visible as a number.
      const geometry = meshFor(
        donor,
        SCATTER_KINDS[at % SCATTER_KINDS.length] as ScatterKind,
      )?.geometry;
      if (geometry === undefined) {
        throw new Error('no geometry to clone');
      }
      built.push(geometry.clone());
    }
    donor.dispose();
    return new Map([[kind, built]]);
  }

  it('holds one mesh per variant, and one per kind for the rest', () => {
    const belt = new ScatterBelt(shapesFor('rock', 3));

    expect(belt.meshesOf('rock')).toHaveLength(3);
    expect(belt.meshesOf('shrub')).toHaveLength(1);
    // Six kinds, of which one has three shapes.
    expect(belt.meshes.size).toBe(SCATTER_KINDS.length + 2);
    belt.dispose();
  });

  it('refuses to hold more shapes than the budget allows', () => {
    // ⚠️ **The guard half of #367's sixth criterion.** `scenery-models.test.ts`
    // is the gate a pull request has to get past; this is what stops a table
    // that got past it spending draw calls on a rider's phone.
    const belt = new ScatterBelt(shapesFor('rock', MAXIMUM_SCENERY_VARIANTS + 4));

    expect(belt.meshesOf('rock')).toHaveLength(MAXIMUM_SCENERY_VARIANTS);
    belt.dispose();
  });

  it('draws an item with the shape its own variant names', () => {
    const belt = new ScatterBelt(shapesFor('rock', 3));
    const vertices = (variant: number) =>
      meshFor(belt, 'rock', variant)?.geometry.getAttribute('position').count ?? -1;

    belt.update(
      [item({ kind: 'rock', variant: 0 }), item({ kind: 'rock', x: -3, variant: 1 })],
      POSE,
    );

    expect(meshFor(belt, 'rock', 0)?.count).toBe(1);
    expect(meshFor(belt, 'rock', 1)?.count).toBe(1);
    expect(meshFor(belt, 'rock', 2)?.count).toBe(0);
    // Non-vacuity: three meshes that were all the same shape would satisfy the
    // counts above and would be the world #367 exists to replace.
    expect(new Set([vertices(0), vertices(1), vertices(2)]).size).toBe(3);
    belt.dispose();
  });

  it('folds a slot past the end onto a shape that exists', () => {
    // `scatter.ts` draws a variant from six slots and knows nothing about how
    // many shapes a kind has, which is the whole of that seam. A belt that
    // indexed straight into its list would draw nothing at all for four items
    // in six.
    const belt = new ScatterBelt(shapesFor('rock', 2));

    belt.update(
      [0, 1, 2, 3, 4, 5].map((variant) => item({ kind: 'rock', x: variant - 3, variant })),
      POSE,
    );

    expect(meshFor(belt, 'rock', 0)?.count).toBe(3);
    expect(meshFor(belt, 'rock', 1)?.count).toBe(3);
    belt.dispose();
  });

  it('draws fewer shapes when the rung says so, and still draws every item', () => {
    // ⚠️ **#367's own suggestion, and the ordering it implies**: a throttling
    // phone falls back toward fewer distinct meshes *before* it loses items.
    // So the second assertion is the one that matters — the items are all still
    // there, in fewer meshes.
    const belt = new ScatterBelt(shapesFor('rock', 3));
    const items = [0, 1, 2, 3, 4, 5].map((variant) =>
      item({ kind: 'rock', x: variant - 3, variant }),
    );

    belt.setVariants(1);
    belt.update(items, POSE);

    expect(meshFor(belt, 'rock', 0)?.count).toBe(6);
    expect(meshFor(belt, 'rock', 1)?.count).toBe(0);
    expect(meshFor(belt, 'rock', 2)?.count).toBe(0);
    // …and back up, without anything being rebuilt.
    const mesh = meshFor(belt, 'rock', 1);
    belt.setVariants(3);
    belt.update(items, POSE);

    expect(meshFor(belt, 'rock', 1)).toBe(mesh);
    expect(meshFor(belt, 'rock', 1)?.count).toBe(2);
    belt.dispose();
  });

  it('draws an item whose variant is not a number, rather than dropping it', () => {
    // ⚠️ **`NaN % 2` is `NaN`, which names no mesh, which drops the item** —
    // scenery a caller placed and the screen never showed, which is #240's
    // named defect shape for this epic. `scatter.ts` cannot produce one; a
    // caller that built a frame some other way can.
    const belt = new ScatterBelt(shapesFor('rock', 2));

    belt.update([item({ kind: 'rock', variant: Number.NaN })], POSE);

    expect(meshFor(belt, 'rock', 0)?.count).toBe(1);
    belt.dispose();
  });

  it('never divides by a rung of zero', () => {
    // `quality.ts` floors its own figure at one, and so does this: a belt asked
    // for no shapes at all would be a world with nothing beside the road.
    const belt = new ScatterBelt(shapesFor('rock', 2));

    belt.setVariants(0);
    belt.update([item({ kind: 'rock', variant: 3 })], POSE);

    expect(meshFor(belt, 'rock', 0)?.count).toBe(1);
    belt.dispose();
  });

  it('sizes each variant its own instance buffer up front', () => {
    // #244's allocation discipline, per mesh rather than per kind: a belt that
    // sized only the first variant would grow a buffer on the frame the second
    // shape first appeared, which is 400 m into a ride.
    const belt = new ScatterBelt(shapesFor('rock', 3));

    for (const mesh of belt.meshesOf('rock')) {
      expect(mesh.instanceMatrix.count).toBe(SCATTER_INSTANCE_CAPACITY);
    }
    belt.dispose();
  });

  it('keeps every variant on one material, whichever shading is mounted', () => {
    const belt = new ScatterBelt(shapesFor('rock', 3));

    for (const shading of ['lit', 'flat'] as const) {
      belt.setShading(shading);

      expect(new Set(belt.meshesOf('rock').map((mesh) => mesh.material)).size).toBe(1);
    }
    belt.dispose();
  });

  it('keeps the primitive for a kind whose second file failed, rather than a hole', () => {
    // ⚠️ **What `loadSceneryModels` filtering out the holes buys.** A kind left
    // holding `[geometry, undefined]` would have its variant-1 items drawn by
    // nothing at all — every other item on the road gone — where losing the
    // *variety* is the documented trade.
    const belt = new ScatterBelt(shapesFor('rock', 1));

    belt.update(
      [0, 1, 2, 3, 4, 5].map((variant) => item({ kind: 'rock', x: variant - 3, variant })),
      POSE,
    );

    expect(belt.meshesOf('rock')).toHaveLength(1);
    expect(meshFor(belt, 'rock', 0)?.count).toBe(6);
    belt.dispose();
  });
});
