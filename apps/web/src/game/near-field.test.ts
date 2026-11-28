// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Does the camera's near plane cut the scenery it passes? — #545.
 *
 * `near-field-testing.ts` says what is measured and why it takes two steps.
 * Three claims are held here, each separately:
 *
 * 1. **The bounds are true.** Every shape either world draws for a kind fits
 *    inside `sceneryReach`, read off the committed files and fitted as the
 *    renderer fits them. A bound that is too small lets a cut shape through the
 *    first step with every test here green.
 * 2. **The tests are right.** The box and the triangle tests are held to cases
 *    worked by hand and to an independent sampling of the same solid.
 * 3. **A ride cuts nothing**, with the camera on the racing line, on the
 *    fixture routes, a metre at a time — the camera `GameView` draws, its
 *    heading damped between those metres as a screen's frames damp it
 *    (`chase-camera-testing.ts`, since #1994) — at every aspect from an upright phone
 *    to 6 : 1, in both worlds — and at 8 : 1 the frame as built DOES meet the
 *    plane, which is the control that makes the first half mean something.
 *    What the cull drops is held, item for item, to `referenceShapeMeets`,
 *    which clips triangles where `shapeMeets` separates them and shares none
 *    of its code (#545's review).
 */

import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { metres, metresPerSecond, type RouteProfile } from '@onyourleft/domain';

import {
  BUILDING_ROLES,
  BUILDING_VARIANTS,
  BUILT_KINDS,
  buildingPlan,
  isBuiltKind,
} from './buildings';
import {
  NEAR_PLANE_METRES,
  cameraRig,
  horizontalSpread,
  verticalHalfTangent,
  type CameraRig,
  type RigPoint,
} from './camera';
import { drawnCamera } from './chase-camera-testing';
import {
  clearOfTheCamera,
  FENCE_TOPS,
  intrudes,
  itemReach,
  nearPyramid,
  peopleClearOfTheCamera,
  sceneryReach,
  shapeMeets,
  triangleMeets,
  type DrawnWorld,
  type NearPyramid,
  type Reach,
  type ShapeTriangles,
  type ShapesOf,
} from './near-field';
import type { Person } from './people';
import {
  boundsOf,
  fittedRealistic,
  fittedStylised,
  modelTriangles,
  referenceShapeMeets,
} from './near-field-testing';
import { REALISTIC_CONIFERS, REALISTIC_VEGETATION } from './realistic-assets';
import {
  circuitRoute,
  hairpinRoute,
  northRoute,
  plannerRoute,
  sBendRoute,
} from './route-fixtures-testing';
import { sceneFrame, sideRoadNaturalMargin, type SceneInput } from './scene';
import { SCENERY_MODELS, STYLISED_FOLD_MODELS } from './scenery-models';
import { drawnScale } from './scenery-plan';
import { GROWN_SPECIES, growTree } from './grown-trees';
import { REALISTIC_CHAIN_LINK } from './realistic-assets';
import { chainLinkFacts } from './realistic-bytes-testing';
import { SCATTER_KINDS, STRUCTURE_KINDS, type SceneryKind, type ScatterItem } from './scatter';
import { atStartLine } from './simulation';
import { corridorOrigin } from './terrain';
import {
  builtFenceGeometry,
  CHAIN_LINK_PART_ATTRIBUTE,
  chainLinkFenceGeometry,
  realisticStructureGeometry,
  realisticStructureSurfaces,
  ScatterBelt,
  sceneryFitMetres,
} from './three-renderer';

const WORLDS: readonly DrawnWorld[] = ['stylised', 'realistic'];

const STYLISED_MODELS = fileURLToPath(new URL('./models/', import.meta.url));
const REALISTIC_MODELS = fileURLToPath(new URL('../../public/realistic/', import.meta.url));

/**
 * Every shape a natural kind is drawn as, in each world, in the item's own
 * frame at a scale of 1 — placed as the renderer places it.
 *
 * ⚠️ **Every shape of the kind, not the one an item's variant picks.** Which
 * shape a variant slot wears depends on how many the rung draws
 * (`quality.ts` §`sceneryVariants`), so the gate asks of all of them — and,
 * since #3287, of every file folded into a mesh beside its model, which an
 * item is drawn as by where it stands.
 */
const SHAPES: Readonly<Record<DrawnWorld, ReadonlyMap<SceneryKind, readonly ShapeTriangles[]>>> = {
  stylised: new Map(
    Object.entries(SCENERY_MODELS)
      .filter(([kind]) => !isBuiltKind(kind))
      .map(([kind, models]) => [
        kind as SceneryKind,
        [...(models ?? []), ...(STYLISED_FOLD_MODELS[kind as SceneryKind] ?? []).flat()].map(
          (model) =>
            fittedStylised(
              modelTriangles(`${STYLISED_MODELS}${model.name}.glb`).triangles,
              sceneryFitMetres(kind as SceneryKind),
            ),
        ),
      ]),
  ),
  realistic: new Map(
    Object.entries(REALISTIC_VEGETATION).map(([kind, models]) => [
      kind as SceneryKind,
      models.map((model) => {
        const { triangles, extras } = modelTriangles(`${REALISTIC_MODELS}${model.file}`);
        return fittedRealistic(triangles, extras, sceneryFitMetres(kind as SceneryKind));
      }),
    ]),
  ),
};

/** Holds a shape's box, in the item's own frame at scale 1, inside a reach. */
function expectInside(
  label: string,
  reach: Reach,
  box: {
    readonly min: readonly [number, number, number];
    readonly max: readonly [number, number, number];
  },
  radial: boolean,
): void {
  const tolerance = 1e-6;
  if (radial) {
    // About the pivot, whichever way it turns: the farthest corner in plan.
    const across = Math.hypot(
      Math.max(Math.abs(box.min[0]), Math.abs(box.max[0])),
      Math.max(Math.abs(box.min[2]), Math.abs(box.max[2])),
    );
    expect(across, `${label}: across`).toBeLessThanOrEqual(reach.x + tolerance);
  } else {
    const across = Math.max(Math.abs(box.min[0]), Math.abs(box.max[0]));
    expect(across, `${label}: across`).toBeLessThanOrEqual(reach.x + tolerance);
    expect(box.min[2], `${label}: back`).toBeGreaterThanOrEqual(reach.back - tolerance);
    expect(box.max[2], `${label}: front`).toBeLessThanOrEqual(reach.front + tolerance);
  }
  expect(box.min[1], `${label}: bottom`).toBeGreaterThanOrEqual(reach.bottom - tolerance);
  expect(box.max[1], `${label}: top`).toBeLessThanOrEqual(reach.top + tolerance);
}

describe('the bounds — every shape a kind is drawn as fits inside its reach', () => {
  it('holds every natural model of both worlds, fitted as the renderer fits it', () => {
    let checked = 0;
    for (const world of WORLDS) {
      for (const [kind, shapes] of SHAPES[world]) {
        for (const shape of shapes) {
          expectInside(`${world} ${kind}`, sceneryReach(kind, world), boundsOf(shape), true);
          checked += 1;
        }
      }
    }
    // #1294: and the scanned firs, which a ride no longer draws and the
    // owner's page still can — the same reach holds them. (The scanned
    // broadleaves were held here too, until #1293 deleted them.)
    for (const model of REALISTIC_CONIFERS.scanned) {
      const { triangles, extras } = modelTriangles(`${REALISTIC_MODELS}${model.file}`);
      expectInside(
        `scanned ${model.name}`,
        sceneryReach('tree-conifer', 'realistic'),
        boundsOf(fittedRealistic(triangles, extras, sceneryFitMetres('tree-conifer'))),
        true,
      );
      checked += 1;
    }
    // What a ride draws as a conifer is the generated firs (#1294): the loop
    // above held THEM to the conifer's reach, not the scans a second time.
    expect(REALISTIC_VEGETATION['tree-conifer']).toBe(REALISTIC_CONIFERS.generated);
    // Every committed natural model, so a table that forgot one is a red count
    // rather than a shape nobody checked: the stylised kit's, and the realistic
    // world's four generated broadleaves, two generated firs, two shrubs and a
    // rock, with the two scanned firs — 11, where it was 13 with the two
    // scanned broadleaves #1293 deleted.
    const stylisedFiles = readdirSync(STYLISED_MODELS).filter(
      (file) => file.endsWith('.glb') && !file.startsWith('building-'),
    ).length;
    expect(checked).toBe(stylisedFiles + 11);
  });

  it('holds the stylised house, fitted and centred, as a box turned with the item', () => {
    // #3287: and the houses and commercial buildings folded in beside them. A
    // folded building is turned half a turn about its own middle, which a
    // box centred on its place does not see.
    const houses = [
      ...(SCENERY_MODELS.building ?? []),
      ...(STYLISED_FOLD_MODELS.building ?? []).flat(),
    ];
    expect(houses).toHaveLength(9);
    for (const model of houses) {
      const shape = fittedStylised(
        modelTriangles(`${STYLISED_MODELS}${model.name}.glb`).triangles,
        sceneryFitMetres('building'),
      );
      expectInside(model.name, sceneryReach('building', 'stylised'), boundsOf(shape), false);
    }
  });

  it('holds every structure either world builds, every variant', () => {
    let checked = 0;
    for (const kind of STRUCTURE_KINDS) {
      const variants = isBuiltKind(kind) ? BUILDING_VARIANTS : 1;
      for (let variant = 0; variant < variants; variant += 1) {
        for (const surface of realisticStructureSurfaces(kind)) {
          const geometry = realisticStructureGeometry(kind, surface, variant);
          if (geometry === undefined) continue;
          geometry.computeBoundingBox();
          const box = geometry.boundingBox;
          if (box === null) throw new Error(`${kind}: no extent`);
          for (const world of WORLDS) {
            expectInside(
              `${kind} ${String(variant)} ${surface}`,
              sceneryReach(kind, world),
              { min: [box.min.x, box.min.y, box.min.z], max: [box.max.x, box.max.y, box.max.z] },
              false,
            );
          }
          geometry.dispose();
          checked += 1;
        }
      }
    }
    expect(checked).toBeGreaterThan(STRUCTURE_KINDS.length);
    // And `buildings.ts`' plans directly, which the stylised world paints.
    for (const kind of BUILT_KINDS) {
      for (let variant = 0; variant < BUILDING_VARIANTS; variant += 1) {
        const plan = buildingPlan(kind, variant);
        const heights = BUILDING_ROLES.flatMap((role) =>
          plan.triangles[role].filter((_, at) => at % 3 === 1),
        );
        const reach = sceneryReach(kind, 'stylised');
        expect(Math.max(...heights), kind).toBeLessThanOrEqual(reach.top);
        expect(Math.min(...heights), kind).toBeGreaterThanOrEqual(reach.bottom);
      }
    }
  });

  it('has a top no lower than the fitted size of the kind with no model — the post', () => {
    // ADR 0022 D-3: the post is a primitive in both worlds, and the largest
    // extent `sceneryFitMetres` measures is at least its height.
    for (const world of WORLDS) {
      expect(sceneryReach('post', world).top).toBeGreaterThanOrEqual(
        sceneryFitMetres('post') - 1e-6,
      );
    }
  });
});

/** A level camera at the origin looking north (+z), 2 m up. */
const LEVEL: CameraRig = { eye: { x: 0, y: 2, z: 0 }, target: { x: 0, y: 2, z: 25 } };

function item(
  kind: SceneryKind,
  x: number,
  y: number,
  z: number,
  rotation = 0,
  scale = 1,
): ScatterItem {
  return { kind, x, y, z, rotation, scale, variant: 0 };
}

/**
 * Points filling the pyramid — the oracle, written from the lens in
 * `camera.ts` rather than from `near-field-testing.ts`. It can miss a sliver
 * thinner than its grid and cannot report one that is not there.
 */
function pyramidSamples(rig: CameraRig, aspect: number): readonly RigPoint[] {
  const ahead = {
    x: rig.target.x - rig.eye.x,
    y: rig.target.y - rig.eye.y,
    z: rig.target.z - rig.eye.z,
  };
  const length = Math.hypot(ahead.x, ahead.y, ahead.z);
  const forward = { x: ahead.x / length, y: ahead.y / length, z: ahead.z / length };
  const flat = Math.hypot(forward.x, forward.z);
  const right = { x: -forward.z / flat, y: 0, z: forward.x / flat };
  const up = {
    x: right.y * forward.z - right.z * forward.y,
    y: right.z * forward.x - right.x * forward.z,
    z: right.x * forward.y - right.y * forward.x,
  };
  const spread = horizontalSpread(aspect);
  const rise = verticalHalfTangent(aspect);
  const points: RigPoint[] = [];
  for (let depth = 1; depth <= 10; depth += 1) {
    const d = (NEAR_PLANE_METRES * depth) / 10;
    for (let across = -20; across <= 20; across += 1) {
      for (let height = -6; height <= 6; height += 1) {
        const a = (d * spread * across) / 20;
        const h = (d * rise * height) / 6;
        points.push({
          x: rig.eye.x + forward.x * d + right.x * a + up.x * h,
          y: rig.eye.y + forward.y * d + right.y * a + up.y * h,
          z: rig.eye.z + forward.z * d + right.z * a + up.z * h,
        });
      }
    }
  }
  return points;
}

/** Whether any sample lies inside an item's box, turned the way `settlements.ts` turns it. */
function sampledIntrusion(
  subject: ScatterItem,
  samples: readonly RigPoint[],
  world: DrawnWorld,
): boolean {
  const reach = sceneryReach(subject.kind, world);
  const s = subject.scale;
  const cos = Math.cos(subject.rotation);
  const sin = Math.sin(subject.rotation);
  return samples.some((point) => {
    const dx = point.x - subject.x;
    const dz = point.z - subject.z;
    const x = dx * cos - dz * sin;
    const z = dx * sin + dz * cos;
    const y = point.y - subject.y;
    return (
      Math.abs(x) <= reach.x * s &&
      z >= reach.back * s &&
      z <= reach.front * s &&
      y >= reach.bottom * s &&
      y <= reach.top * s
    );
  });
}

describe('the pyramid grown for a shape that moves — #630', () => {
  it('meets a point within the growth of the pyramid, and not one well past it', () => {
    const aspect = 16 / 10;
    const plain = nearPyramid(LEVEL, aspect);
    const grown = nearPyramid(LEVEL, aspect, NEAR_PLANE_METRES, 0.12);
    const [eye, ...corners] = plain.points as [RigPoint, ...RigPoint[]];
    const point = (at: RigPoint): [RigPoint, RigPoint, RigPoint] => [at, at, at];
    // Each corner of the near plane, moved 0.11 m straight out from the
    // pyramid's middle: outside the plain pyramid, inside the grown one.
    const middle = {
      x: corners.reduce((sum, each) => sum + each.x, 0) / 4,
      y: corners.reduce((sum, each) => sum + each.y, 0) / 4,
      z: corners.reduce((sum, each) => sum + each.z, 0) / 4,
    };
    for (const corner of corners) {
      const out = { x: corner.x - middle.x, y: corner.y - middle.y, z: corner.z - middle.z };
      const length = Math.hypot(out.x, out.y, out.z);
      const moved = {
        x: corner.x + (out.x / length) * 0.11,
        y: corner.y + (out.y / length) * 0.11,
        z: corner.z + (out.z / length) * 0.11,
      };
      expect(triangleMeets(...point(moved), plain)).toBe(false);
      expect(triangleMeets(...point(moved), grown)).toBe(true);
    }
    // And behind the eye by the growth: the grown pyramid reaches it.
    const forward = { x: middle.x - eye.x, y: middle.y - eye.y, z: middle.z - eye.z };
    const f = Math.hypot(forward.x, forward.y, forward.z);
    const behind = {
      x: eye.x - (forward.x / f) * 0.1,
      y: eye.y - (forward.y / f) * 0.1,
      z: eye.z - (forward.z / f) * 0.1,
    };
    expect(triangleMeets(...point(behind), plain)).toBe(false);
    expect(triangleMeets(...point(behind), grown)).toBe(true);
    // A metre past the plane, neither.
    const far = {
      x: middle.x + forward.x / f,
      y: middle.y + forward.y / f,
      z: middle.z + forward.z / f,
    };
    expect(triangleMeets(...point(far), grown)).toBe(false);
  });
});

describe('intrudes — whether an item’s box meets the near pyramid', () => {
  const pyramid = nearPyramid(LEVEL, 16 / 10);

  it('finds a tree the eye is inside, and a post standing on the plane', () => {
    expect(intrudes(item('tree-conifer', 1, 0, 0), pyramid, 'realistic')).toBe(true);
    expect(intrudes(item('post', 0, 1.5, NEAR_PLANE_METRES), pyramid, 'stylised')).toBe(true);
  });

  it('lets go of what is behind the eye, beyond the plane, beside it, or below it', () => {
    expect(intrudes(item('post', 0, 1.5, -0.2), pyramid, 'stylised')).toBe(false);
    expect(intrudes(item('post', 0, 1.5, 1.5), pyramid, 'stylised')).toBe(false);
    // At 16 : 10 the rectangle reaches 0.56 m to each side, and this post's
    // near edge is 1.1 m out — inside a 6 : 1 rectangle, not this one.
    expect(intrudes(item('post', 1.2, 1.5, NEAR_PLANE_METRES), pyramid, 'stylised')).toBe(false);
    expect(
      intrudes(item('post', 1.2, 1.5, NEAR_PLANE_METRES), nearPyramid(LEVEL, 6), 'stylised'),
    ).toBe(true);
    // A wall's top is 1.1 m, and the rectangle's bottom edge 1.65 m up.
    expect(intrudes(item('wall', 0, 0, NEAR_PLANE_METRES), pyramid, 'stylised')).toBe(false);
  });

  it('turns a structure with its yaw, the way `settlements.ts` does', () => {
    // A hedge runs 4 m either way along its own z. Turned a quarter, it runs
    // across the road in front of the eye; unturned, along the road 2 m out.
    const across = item('hedge', 2, 0.8, NEAR_PLANE_METRES / 2, Math.PI / 2);
    expect(intrudes(across, pyramid, 'stylised')).toBe(true);
    expect(intrudes({ ...across, rotation: 0 }, pyramid, 'stylised')).toBe(false);
  });

  it('agrees with the sampled oracle wherever the oracle finds a point', () => {
    let state = 545;
    const next = (): number => {
      state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
      return state / 2_147_483_648;
    };
    const aspects = [9 / 19.5, 1, 16 / 10, 6];
    const samples = aspects.map((aspect) => pyramidSamples(LEVEL, aspect));
    const kinds = [...SCATTER_KINDS, ...STRUCTURE_KINDS];
    let found = 0;
    let agreed = 0;
    const trials = 3_000;
    for (let trial = 0; trial < trials; trial += 1) {
      const kind = kinds[Math.floor(next() * kinds.length)] as SceneryKind;
      const world = WORLDS[Math.floor(next() * 2)] as DrawnWorld;
      const which = Math.floor(next() * aspects.length);
      const reach = sceneryReach(kind, world);
      const span = Math.max(reach.x, reach.front) + 1;
      const subject = item(
        kind,
        (next() * 2 - 1) * span,
        2 - next() * reach.top,
        (next() * 2 - 1) * span,
        next() * Math.PI * 2,
        0.7 + next() * 0.7,
      );
      const oracle = sampledIntrusion(subject, samples[which] as readonly RigPoint[], world);
      const answer = intrudes(subject, nearPyramid(LEVEL, aspects[which] as number), world);
      if (oracle) {
        found += 1;
        expect(answer, JSON.stringify({ subject, world, which })).toBe(true);
      }
      if (oracle === answer) agreed += 1;
    }
    // Both answers occur, so an `intrudes` that said either everywhere fails;
    // and what the oracle can miss — a sliver thinner than its grid — is rare.
    expect(found).toBeGreaterThan(300);
    expect(found).toBeLessThan(trials - 300);
    expect(agreed / trials).toBeGreaterThan(0.97);
  });
});

describe('triangleMeets — whether one triangle meets the near pyramid', () => {
  const pyramid = nearPyramid(LEVEL, 16 / 10);
  const at = (x: number, y: number, z: number): RigPoint => ({ x, y, z });

  it('finds a small triangle on the plane in front of the eye', () => {
    expect(triangleMeets(at(-0.1, 1.9, 0.4), at(0.1, 1.9, 0.4), at(0, 2.1, 0.4), pyramid)).toBe(
      true,
    );
  });

  it('finds a large card cutting through the pyramid with every corner outside it', () => {
    // Eight metres wide, square to the view 0.3 m ahead: no corner is inside
    // the pyramid, and it cuts it clean across. A test of corners alone — the
    // shortcut this file does not take — says no.
    expect(triangleMeets(at(-4, 0, 0.3), at(4, 0, 0.3), at(0, 6, 0.3), pyramid)).toBe(true);
  });

  it('lets go of a triangle behind the eye, beyond the plane, or off to the side', () => {
    expect(triangleMeets(at(-0.1, 1.9, -0.4), at(0.1, 1.9, -0.4), at(0, 2.1, -0.4), pyramid)).toBe(
      false,
    );
    expect(triangleMeets(at(-0.1, 1.9, 0.6), at(0.1, 1.9, 0.6), at(0, 2.1, 0.6), pyramid)).toBe(
      false,
    );
    expect(triangleMeets(at(0.8, 1.9, 0.4), at(1, 1.9, 0.4), at(0.9, 2.1, 0.4), pyramid)).toBe(
      false,
    );
  });
});

describe('triangleMeets — where only an edge of each separates them', () => {
  const pyramid = nearPyramid(LEVEL, 16 / 10);

  it('lets go of a sliver slanting past the plane’s corner, which no face separates', () => {
    // Found by searching for a triangle every face of either solid says might
    // meet the pyramid, and that an edge of each says does not. It passes just
    // outside the top right corner of the near rectangle.
    const a = { x: 0.46, y: 2.65, z: 0.67 };
    const b = { x: 0.58, y: 2.09, z: 0.7 };
    const c = { x: 0.59, y: 2.07, z: 0.46 };
    expect(triangleMeets(a, b, c, pyramid)).toBe(false);
    // Held to the oracle, so the answer is the geometry's and not this file's:
    // no point of the triangle, sampled finely, is inside the pyramid.
    const spread = horizontalSpread(16 / 10);
    const rise = verticalHalfTangent(16 / 10);
    for (let u = 0; u <= 200; u += 1) {
      for (let v = 0; v <= 200 - u; v += 1) {
        const w = 200 - u - v;
        const x = (a.x * u + b.x * v + c.x * w) / 200;
        const y = (a.y * u + b.y * v + c.y * w) / 200 - LEVEL.eye.y;
        const z = (a.z * u + b.z * v + c.z * w) / 200;
        const inside =
          z > 0 && z <= NEAR_PLANE_METRES && Math.abs(x) <= z * spread && Math.abs(y) <= z * rise;
        expect(inside).toBe(false);
      }
    }
  });
});

describe('shapeMeets — a shape placed as the renderer places an instance', () => {
  // One triangle, 0.2 m wide, at (1, 2, 0) in its own frame.
  const shape = new Float32Array([0.9, 1.9, 0, 1.1, 1.9, 0, 1, 2.1, 0]);

  it('turns, scales and stands the shape where the item is', () => {
    const pyramid = nearPyramid(LEVEL, 16 / 10);
    // Unturned at (−1, 0, 0.4): the triangle lands on the plane's axis.
    expect(shapeMeets(item('rock', -1, 0, 0.4), shape, pyramid)).toBe(true);
    // Turned half a turn it lands at x = −2, off to the side.
    expect(shapeMeets(item('rock', -1, 0, 0.4, Math.PI), shape, pyramid)).toBe(false);
    // Turned a quarter anticlockwise seen from above — three's +y — its own +x
    // points along −z, so it lands a metre nearer the eye than the item; turned
    // the other way, a metre further off.
    expect(shapeMeets(item('rock', 0, 0, 0.4 + 1, Math.PI / 2), shape, pyramid)).toBe(true);
    expect(shapeMeets(item('rock', 0, 0, 0.4 + 1, -Math.PI / 2), shape, pyramid)).toBe(false);
    // Scaled twice it lands at x = 2 − 2 = 0, and 4 m up, above the plane.
    expect(shapeMeets(item('rock', -2, 0, 0.4, 0, 2), shape, pyramid)).toBe(false);
    expect(shapeMeets(item('rock', -2, -2, 0.4, 0, 2), shape, pyramid)).toBe(true);
  });
});

describe('shapeMeets — the committed shapes, against a test worked another way', () => {
  it('agrees with the clipping reference for every shape placed about the eye', () => {
    // The shipped test skips whole chunks of a shape on a sphere, skips a
    // triangle on its corners in the shape's own frame, and only then asks
    // the separating axes (#545's review). Each of those is a way to let a cut
    // triangle go, so every committed shape is placed about the eye — close
    // enough that some of it meets the pyramid and some does not — and held to
    // `referenceShapeMeets`, which clips every triangle and skips none.
    let state = 5_450;
    const next = (): number => {
      state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
      return state / 2_147_483_648;
    };
    const aspects = [9 / 19.5, 16 / 10, 6];
    let meets = 0;
    let clear = 0;
    for (const world of WORLDS) {
      for (const [kind, shapes] of SHAPES[world]) {
        const reach = sceneryReach(kind, world);
        for (const shape of shapes) {
          for (let trial = 0; trial < 24; trial += 1) {
            const aspect = aspects[trial % aspects.length] as number;
            const scale = 0.7 + next() * 0.7;
            const subject = item(
              kind,
              (next() * 2 - 1) * reach.x * scale,
              LEVEL.eye.y - next() * reach.top * scale,
              (next() * 2 - 1) * reach.x * scale,
              next() * Math.PI * 2,
              scale,
            );
            const shipped = shapeMeets(subject, shape, nearPyramid(LEVEL, aspect));
            const reference = referenceShapeMeets(
              subject,
              shape,
              LEVEL,
              horizontalSpread(aspect),
              verticalHalfTangent(aspect),
              NEAR_PLANE_METRES,
            );
            expect(
              shipped,
              `${world} ${kind} ${JSON.stringify(subject)} at ${String(aspect)}`,
            ).toBe(reference);
            if (reference) meets += 1;
            else clear += 1;
          }
        }
      }
    }
    // Both answers, many times, so a `shapeMeets` that said either everywhere fails.
    expect(meets).toBeGreaterThan(100);
    expect(clear).toBeGreaterThan(100);
  });
});

describe('clearOfTheCamera — what the renderer is handed', () => {
  // One triangle square to the view, 0.2 m across: in the plane when stood at
  // (0, 0, 0.4), and 30 m up the road otherwise.
  const card = new Float32Array([-0.1, 1.9, 0, 0.1, 1.9, 0, 0, 2.1, 0]);
  const shapes: ShapesOf = (kind) => (kind === 'rock' ? [card] : undefined);
  const aspect = 16 / 10;

  it('hands back the very same array when nothing is cut', () => {
    const items = [item('rock', 0, 0, 30), item('post', 8, 0, 20)];
    expect(clearOfTheCamera(items, LEVEL, aspect, 'stylised', shapes)).toBe(items);
  });

  it('drops an item whose triangles the plane cuts, and keeps the rest in order', () => {
    const before = item('rock', 0, 0, 30);
    const cut = item('rock', 0, 0, 0.4);
    const after = item('post', 8, 0, 20);
    expect(clearOfTheCamera([before, cut, after], LEVEL, aspect, 'stylised', shapes)).toEqual([
      before,
      after,
    ]);
  });

  it('keeps an item whose box reaches the plane and whose triangles do not', () => {
    // The rock's box reaches 1.3 m; its one card, stood 1 m to the side, does not.
    const beside = item('rock', 1, 0, 0.4);
    expect(intrudes(beside, nearPyramid(LEVEL, aspect), 'stylised')).toBe(true);
    const items = [beside];
    expect(clearOfTheCamera(items, LEVEL, aspect, 'stylised', shapes)).toBe(items);
  });

  it('drops a kind whose shape is not known on its box, the safe way round', () => {
    const post = item('post', 0, 1.5, NEAR_PLANE_METRES);
    expect(clearOfTheCamera([post], LEVEL, aspect, 'stylised', shapes)).toEqual([]);
  });
});

describe('peopleClearOfTheCamera — the people the renderer is handed (#1835)', () => {
  /** A person standing at `(x, z)`, on the road's plane under the {@link LEVEL} eye. */
  const person = (x: number, z: number): Person => ({
    x,
    y: 0,
    z,
    yaw: 0,
    gait: 'walk',
    phase: 0,
    height: 1.75,
    look: { skin: 0, top: 0, bottoms: 0, shoes: 0, hair: 0, build: 0 },
    distance: z,
    on: 'footway',
  });
  const pyramid = nearPyramid(LEVEL, 16 / 10);

  it('hands back the very same people when nobody is cut, and anyone with the cull off', () => {
    const people = { near: [person(0, 20), person(3, 0.4)], far: [person(0, 80)] };
    expect(peopleClearOfTheCamera(people, pyramid)).toBe(people);
    const inside = { near: [person(0, 0.4)], far: [] };
    expect(peopleClearOfTheCamera(inside, undefined)).toBe(inside);
    expect(peopleClearOfTheCamera(undefined, pyramid)).toBeUndefined();
  });

  it('drops a person standing in the plane, near or far, and keeps the rest in order', () => {
    const before = person(0, 20);
    const after = person(-3, 30);
    const far = person(0, 80);
    const kept = peopleClearOfTheCamera(
      { near: [before, person(0, 0.4), after], far: [person(0.2, 0.3), far] },
      pyramid,
    );
    expect(kept?.near).toEqual([before, after]);
    expect(kept?.far).toEqual([far]);
  });

  it('drops a person whose box reaches the plane from beside it, and not one 0.75 m further out', () => {
    // The 16 : 10 plane is 0.56 m to either side of the axis; a person's box
    // reaches `PERSON_REACH_METRES`, 0.5 m, from their feet.
    expect(peopleClearOfTheCamera({ near: [person(0.9, 0.45)], far: [] }, pyramid)?.near).toEqual(
      [],
    );
    const beyond = { near: [person(1.65, 0.45)], far: [] };
    expect(peopleClearOfTheCamera(beyond, pyramid)).toBe(beyond);
  });
});

/** The rides — fixture routes, with the camera on the rider's racing line. */
const RIDES: Readonly<Record<string, () => RouteProfile>> = {
  // Long enough to pass villages, farmsteads and their field boundaries, on
  // the straight #546 puts the rider on the right of.
  'a level road through villages': () => northRoute(4_000, () => 50),
  'a 20 m hairpin': () => hairpinRoute(20),
  'an S-bend of 30 m': () => sBendRoute(30),
  // ⚠️ Both hands since #583. Until then the world was a mirror of its map, so
  // the two fixtures above were drawn as these two are now, and the control
  // below — a conifer's branches cut at 8 : 1 — was found on THEIR frames. The
  // right-handed ones place the scenery the other way round, and on those the
  // stylised world finds no cut at 8 : 1 at all; the mirrored pair keeps the
  // control finding one and keeps both hands measured.
  'a 20 m left-hand hairpin': () => hairpinRoute(20, 'left'),
  'an S-bend of 30 m, left first': () => sBendRoute(30, 'left'),
  "a planner's route": () => plannerRoute(),
  'a 300 m circuit': () => circuitRoute(300, () => 20),
  // ⚠️ Both hands of these two since #583. Until then the world was a mirror
  // of its map, so the two above were drawn as these two are now — and the
  // control below, a conifer's branches cut at 8 : 1 in the STYLISED world,
  // was found on those frames and on no other ride. Drawn the right way round
  // the stylised world finds no cut at 8 : 1 on any ride here; the mirrored
  // pair keeps the control able to find one, and both hands measured.
  "a planner's route, mirrored": () => plannerRoute({ mirrored: true }),
  'a 300 m right-hand circuit': () => circuitRoute(300, () => 20, 'right'),
  // #1994: the far end of an out-and-back course, where `GameView`'s damped
  // camera swings round the rider (`camera.ts` §`turnedPose`) and its eye
  // leaves the line `scene.ts` keeps it on furthest of any ride here.
  'a turnaround, the legs 4 m apart': () => hairpinRoute(2),
  'a left-hand turnaround, the legs 4 m apart': () => hairpinRoute(2, 'left'),
};

/**
 * The frames the renderer is handed, from an upright phone to the widest the
 * stylesheet allows — and one wider than any of them, which is the control's.
 */
const ASPECTS: Readonly<Record<string, number>> = {
  'a phone in landscape': 19.5 / 9,
  '16 : 9': 16 / 9,
  "the owner's tablet": 16 / 10,
  '4 : 3': 4 / 3,
  'a tablet upright': 10 / 16,
  'a phone upright': 9 / 19.5,
  'the widest frame': 6,
  // ⚠️ **The control's frame, and no frame the stylesheet can produce** —
  // #571. The control was 6 : 1 until then, and what the stylised world met
  // there was ONE conifer inside a 20 m hairpin, 5.8 m from the drawn road's
  // centreline — inside the 6.5 m the scatter's verge keeps clear — because it
  // was placed beside the route's arc rather than the ribbon, which runs
  // inside it. Placed beside the ribbon, nothing on any ride here reaches a
  // 6 : 1 plane in either world. 8 : 1 widens the near rectangle to 5.6 m:
  // measured, every ride but the S-bend meets it in at least one world, and
  // the circuit and the planner's route in both.
  'the control frame': 8,
};

interface RideFrame {
  /** The camera `GameView` draws: `sceneFrame`'s, turned to the damped heading — #1994. */
  readonly rig: CameraRig;
  /** The camera `sceneFrame` built, before the damping: the control that the damping was ridden. */
  readonly undamped: CameraRig;
  readonly scatter: readonly ScatterItem[];
}

const rides = new Map<string, readonly RideFrame[]>();

function ride(name: string): readonly RideFrame[] {
  const cached = rides.get(name);
  if (cached !== undefined) return cached;
  const profile = (RIDES[name] as () => RouteProfile)();
  const origin = corridorOrigin(profile);
  const start = atStartLine(profile);
  const frames: RideFrame[] = [];
  const inputAt = (distance: number): SceneInput => ({
    profile,
    origin,
    state: { ...start, ride: { speed: metresPerSecond(8), distance: metres(distance) } },
  });
  // Since #1994 the camera drawn is `GameView`'s, its heading damped from
  // frame to frame, and not the undamped one `sceneFrame` builds.
  const drawn = drawnCamera(inputAt, 8);
  for (let distance = 0; distance < profile.totalDistance; distance += 1) {
    const frame = sceneFrame(inputAt(distance));
    frames.push({
      rig: cameraRig(drawn(distance, frame.camera)),
      undamped: cameraRig(frame.camera),
      scatter: frame.scatter,
    });
  }
  rides.set(name, frames);
  return frames;
}

/**
 * Whether the near plane cuts `subject` as `world` draws it, for a frame of
 * this aspect. The box is `intrudes`' — the bound the first two describes hold
 * — and the triangles are {@link referenceShapeMeets}': clipped, not
 * separated, and sharing no code with `shapeMeets`, so that a ride holds the
 * cull to an answer it did not compute itself (#545's review).
 */
function cutBy(
  subject: ScatterItem,
  rig: CameraRig,
  pyramid: NearPyramid,
  aspect: number,
  world: DrawnWorld,
): 'no' | 'box only' | 'geometry' {
  if (!intrudes(subject, pyramid, world)) return 'no';
  const shapes = SHAPES[world].get(subject.kind);
  // A structure or a post has no shape here and is held to its box — the
  // stronger claim, and the one the rides make good.
  if (shapes === undefined) return 'geometry';
  const spread = horizontalSpread(aspect);
  const rise = verticalHalfTangent(aspect);
  return shapes.some((shape) =>
    referenceShapeMeets(subject, shape, rig, spread, rise, NEAR_PLANE_METRES),
  )
    ? 'geometry'
    : 'box only';
}

/** The shapes the gate reads, off the committed files, for `clearOfTheCamera`. */
function shapesFromFiles(world: DrawnWorld): ShapesOf {
  return (kind) => SHAPES[world].get(kind);
}

/** The aspects a device draws — every one but the widest the stylesheet allows. */
const DEVICE_ASPECTS = Object.entries(ASPECTS).filter(
  ([label]) => label !== 'the widest frame' && label !== 'the control frame',
);

describe('a ride — nothing the camera passes is cut by the near plane (#545)', () => {
  /** Item-frames the plane cuts in the frame as `scene.ts` built it, by world and aspect. */
  const uncut = new Map<string, number>();
  /** Item-frames whose box met the pyramid and whose shapes did not, by world. */
  const boxOnly = new Map<DrawnWorld, number>();

  /** Frames measured, by ride, so a finding below cannot pass over rides that never ran. */
  const measured = new Map<string, number>();

  // ⚠️ **230 s a ride, a ceiling rather than a budget — #682.** It was 120 s, and the slowest
  // ride came within 45 s of it: under coverage on CI, over thirteen green `main` runs on
  // 2026-09-28 (36370135206 to 36405580515), 'a level road through villages' took 37.9 s to
  // 75.2 s — 63 % of 120 s, the slowest on 36371441351, the slower of the two runners (a job over
  // 1 000 s) — and 'a 300 m right-hand circuit' up to 42.1 s. Coverage instruments the cull's
  // hot loop about three times over (docs/agents/ci.md §4c). 230 s is about three times the slowest ride,
  // so a ride that slows past it is red. ⚠️ It is NOT a hang guard, and it bounds nothing about
  // the file: each ride is synchronous, and Vitest cannot interrupt a synchronous case — its timer
  // is only read once the case returns — so a ride that never returns is caught only by the job's
  // own stop. And the eleven rides run one after another, so a cull that slows every ride can cost
  // up to 11 × 230 s before the last one goes red.
  for (const name of Object.keys(RIDES)) {
    it(`${name}: what the renderer draws, every aspect, both worlds`, () => {
      for (const { rig, scatter } of ride(name)) {
        for (const world of WORLDS) {
          for (const [label, aspect] of Object.entries(ASPECTS)) {
            const pyramid = nearPyramid(rig, aspect);
            const key = `${world} ${label}`;
            const cut = new Set<ScatterItem>();
            for (const subject of scatter) {
              const answer = cutBy(subject, rig, pyramid, aspect, world);
              if (answer === 'geometry') {
                cut.add(subject);
                uncut.set(key, (uncut.get(key) ?? 0) + 1);
              }
              if (answer === 'box only') boxOnly.set(world, (boxOnly.get(world) ?? 0) + 1);
            }
            // Exactly what the reference would cut is dropped, and nothing
            // else: a cull that dropped too much is a tree missing from a
            // frame, which is a defect as well.
            const drawn = clearOfTheCamera(scatter, rig, aspect, world, shapesFromFiles(world));
            const expected = scatter.filter((subject) => !cut.has(subject));
            if (drawn.length !== expected.length || drawn.some((at, i) => at !== expected[i])) {
              throw new Error(
                `${name}, ${world}, ${label}: the cull dropped ${String(scatter.length - drawn.length)} where the reference cuts ${String(cut.size)}`,
              );
            }
          }
        }
        measured.set(name, (measured.get(name) ?? 0) + 1);
      }
    }, 230_000);
  }

  it('rides the camera GameView draws, whose eye leaves sceneFrame’s in a bend (#1994)', () => {
    // The control that the damping was ridden at all: were the rides handed
    // `sceneFrame`'s undamped camera, as they were until #545's last lane, the
    // two eyes would be one on every frame. Measured: up to 0.17 m off in the
    // 20 m hairpins, 0.11 m in the S-bends, 0.16 m on the planner's routes and
    // 0.73 m at the turnarounds; none on the level road, which never bends.
    // ⚠️ Since #2422 the undamped camera stands on the drawn path, which turns
    // smoothly, so there is less for the damping to trail: 0.42 m at the
    // turnarounds, and over 0.1 m still in the hairpins and on the planner's
    // route. ⚠️ Since #2989 the heading settles in 0.04 s, not 0.1 s, so it
    // trails less again: 0.079 m and 0.082 m in the hairpins, 0.047 m on the
    // planner's route and 0.15 m at the turnarounds. The floors are below
    // those, as before.
    const most = (name: string): number => {
      let off = 0;
      for (const { rig, undamped } of ride(name)) {
        off = Math.max(off, Math.hypot(rig.eye.x - undamped.eye.x, rig.eye.z - undamped.eye.z));
      }
      return off;
    };
    expect(most('a level road through villages')).toBeLessThan(1e-6);
    for (const name of ['a 20 m hairpin', 'a 20 m left-hand hairpin']) {
      expect(most(name), name).toBeGreaterThan(0.05);
    }
    expect(most("a planner's route")).toBeGreaterThan(0.03);
    for (const name of [
      'a turnaround, the legs 4 m apart',
      'a left-hand turnaround, the legs 4 m apart',
    ]) {
      expect(most(name), name).toBeGreaterThan(0.1);
    }
  }, 600_000);

  it('cuts nothing a device draws even before the cull — the owner’s tablet among them', () => {
    // The finding, pinned: on these routes the camera on its line never comes
    // within the plane of anything at the aspect of a phone or a tablet. If a
    // change to the camera, the line or the placement brings it there, this is
    // where it shows — before the cull quietly starts dropping trees.
    //
    // ⚠️ The counts are the rides' own, so every ride must have run: on its
    // own, with `-t`, this used to pass over empty counts (#545's review).
    for (const name of Object.keys(RIDES)) {
      expect(measured.get(name) ?? 0, `${name}: frames measured`).toBeGreaterThan(0);
    }
    for (const world of WORLDS) {
      for (const [label] of DEVICE_ASPECTS) {
        expect(uncut.get(`${world} ${label}`) ?? 0, `${world} ${label}`).toBe(0);
      }
    }
  });

  it('the control: at 8 : 1 the plane DOES cut the frame as built, in both worlds', () => {
    // What makes the green rides mean something: the same measure, on the same
    // frames, finds a cut where the rectangle is 5.6 m across (4.2 m at 6 : 1
    // until #571 — see 'the control frame') — conifers'
    // lowest branches beside the eye. A measure that could not find one — a
    // shape placed in the wrong frame, a pyramid facing backwards, a reader
    // that returned no triangles — would pass every ride over nothing. And it
    // is exactly what `clearOfTheCamera` removed in the rides above.
    for (const world of WORLDS) {
      expect(uncut.get(`${world} the control frame`) ?? 0, world).toBeGreaterThan(0);
    }
  });

  it('and the boxes alone meet the pyramid where no triangle does — why the cull reads the triangles', () => {
    // A cull on the box, the first thing #545's branch tried, would have
    // dropped a visible tree this many times to prevent nothing.
    expect(boxOnly.get('realistic') ?? 0).toBeGreaterThan(100);
  });
});

describe('the bounds hold what #3252 draws — its review', () => {
  it('holds every species grown in code, fitted as the renderer fits it', () => {
    for (const species of GROWN_SPECIES) {
      const grown = growTree(species);
      const fit = sceneryFitMetres(species.kind) / Math.max(grown.heightMetres, grown.widthMetres);
      const numbers: number[] = [];
      for (const part of [grown.full.bark, grown.full.leaves]) {
        for (const vertex of part.indices) {
          for (const axis of [0, 1, 2])
            numbers.push((part.positions[vertex * 3 + axis] as number) * fit);
        }
      }
      const box = boundsOf(Float32Array.from(numbers));
      // A leaf may hang a little below the foot of a bush: the box's own bottom.
      expectInside(species.id, sceneryReach(species.kind, 'realistic'), box, true);
    }
  });

  /** A geometry's box over the vertices `keep` admits. */
  const boxOf = (
    geometry: {
      getAttribute(name: string): {
        readonly count: number;
        getComponent(at: number, axis: number): number;
      };
    },
    keep: (at: number) => boolean = () => true,
  ) => {
    const position = geometry.getAttribute('position');
    const min: [number, number, number] = [Infinity, Infinity, Infinity];
    const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    for (let at = 0; at < position.count; at += 1) {
      if (!keep(at)) continue;
      for (const axis of [0, 1, 2] as const) {
        min[axis] = Math.min(min[axis], position.getComponent(at, axis));
        max[axis] = Math.max(max[axis], position.getComponent(at, axis));
      }
    }
    return { min, max };
  };

  it('holds EVERY fence, wall and hedge either world draws, each to its own height', () => {
    const plain = realisticStructureGeometry('fence', 'planks');
    if (plain === undefined) throw new Error('a realistic fence wears planks');
    const chained = chainLinkFenceGeometry(
      plain,
      chainLinkFacts(`${REALISTIC_MODELS}${REALISTIC_CHAIN_LINK.model}`),
    );
    const built = builtFenceGeometry(chained);
    const partOf = (geometry: typeof chained) => {
      const parts = geometry.getAttribute(CHAIN_LINK_PART_ATTRIBUTE).array as Float32Array;
      return (wanted: (part: number) => boolean) => (at: number) => wanted(parts[at] as number);
    };
    const fences = [
      {
        name: 'field fence',
        item: {},
        box: boxOf(
          chained,
          partOf(chained)((part) => part === 0),
        ),
      },
      {
        name: 'chain-link',
        item: { chainLink: true as const },
        box: boxOf(
          chained,
          partOf(chained)((part) => part > 0),
        ),
      },
      {
        name: 'timber fence',
        item: { boundary: 'timber-fence' as const },
        box: boxOf(
          built,
          partOf(built)((part) => part === 0),
        ),
      },
      {
        name: 'noise barrier',
        item: { boundary: 'noise-barrier' as const },
        box: boxOf(
          built,
          partOf(built)((part) => part === 1),
        ),
      },
    ];
    for (const { name, item: mark, box } of fences) {
      for (const world of WORLDS) {
        const reach = itemReach({ kind: 'fence', ...mark }, world);
        expectInside(name, reach, box, false);
        // The TRUE bound, not a loose one: within 15 cm of the shape's own top.
        expect(reach.top - box.max[1], `${name}: slack`).toBeLessThan(0.15);
      }
    }
    expect(itemReach({ kind: 'fence' }, 'realistic')).toEqual(sceneryReach('fence', 'realistic'));
    expect(FENCE_TOPS['noise-barrier']).toBeGreaterThan(sceneryReach('fence', 'realistic').top * 2);
    // The walls and hedges: the realistic world's own shape, and the stylised one's.
    const stylised = new ScatterBelt(new Map());
    for (const kind of ['wall', 'hedge', 'fence'] as const) {
      const shapes = [
        ...realisticStructureSurfaces(kind).map((surface) =>
          realisticStructureGeometry(kind, surface),
        ),
        ...stylised.meshesOf(kind).map((mesh) => mesh.geometry),
      ];
      expect(shapes.length).toBeGreaterThanOrEqual(2);
      for (const geometry of shapes) {
        if (geometry === undefined) throw new Error(`${kind}: no shape`);
        for (const world of WORLDS) {
          expectInside(kind, itemReach({ kind }, world), boxOf(geometry), false);
        }
      }
    }
    stylised.dispose();
    for (const geometry of [plain, chained, built]) geometry.dispose();
  });

  it('cuts a noise barrier and a timber fence by its own height, where the field fence’s box is clear', () => {
    const pyramid = nearPyramid(LEVEL, 16 / 10);
    const fence = (extra: Partial<ScatterItem>): ScatterItem => ({
      ...item('fence', 0, 0.2, NEAR_PLANE_METRES),
      ...extra,
    });
    // The eye is 2 m up and the rectangle's bottom edge 1.65 m: the item stands
    // 0.2 m up, so the field fence's 1.3 m tops out 15 cm under it.
    expect(intrudes(fence({}), pyramid, 'realistic')).toBe(false);
    expect(intrudes(fence({ boundary: 'timber-fence', variant: 1 }), pyramid, 'realistic')).toBe(
      true,
    );
    expect(intrudes(fence({ boundary: 'noise-barrier', variant: 1 }), pyramid, 'realistic')).toBe(
      true,
    );
    expect(intrudes(fence({ chainLink: true }), pyramid, 'realistic')).toBe(true);
  });
});

describe('every guard reads the size an item is DRAWN at — #3252’s review', () => {
  /**
   * A park's tree drawn at its widest, and an eye beside it: far enough off
   * that the tree's box stops well short of the eye at its `scale` alone, and
   * near enough that the box reaches it at the size the tree is drawn. Found
   * by asking place after place, since how old and how stout a tree is
   * depends on where it stands.
   */
  const reach = sceneryReach('tree-broadleaf', 'realistic').x;
  const found = (() => {
    for (let place = 0; place < 5_000; place += 1) {
      const tree: ScatterItem = {
        ...item('tree-broadleaf', place * 3.7, 0, place * 5.3),
        setting: 'park',
      };
      const { across } = drawnScale(tree);
      if (across > 1.45) return { tree, across, off: reach * across - 0.1 };
    }
    throw new Error('no park tree drawn wide enough');
  })();
  const eye = { x: found.tree.x - found.off, y: 2, z: found.tree.z };
  const pyramid = nearPyramid({ eye, target: { ...eye, z: eye.z + 25 } }, 16 / 10);
  const bare: ScatterItem = { ...found.tree };
  delete (bare as { setting?: string }).setting;

  it('non-vacuity: the tree is drawn wider than its scale, and is clear of the eye at its scale', () => {
    expect(found.across).toBeGreaterThan(1.1);
    expect(drawnScale(bare).across).toBe(1);
    // Further off than the near rectangle is wide, which is under a metre at this aspect.
    expect(found.off - reach).toBeGreaterThanOrEqual(1.2);
  });

  it('finds the box of the tree as it is drawn', () => {
    expect(intrudes(found.tree, pyramid, 'realistic')).toBe(true);
    // CONTROL: the same tree with no setting is drawn at its scale, and is clear.
    expect(intrudes(bare, pyramid, 'realistic')).toBe(false);
  });

  it('cuts a triangle of the tree where it is drawn, across and up', () => {
    // A wall of two triangles at the shape's own edge nearest the eye, from
    // 0.5 m to 1.9 m up at a scale of 1: under the 2 m eye until it is drawn taller.
    const near = -(found.off / found.across);
    const wall = (low: number, high: number): ShapeTriangles => {
      const [a, b] = [near - 0.2, near + 0.2];
      return Float32Array.from([
        ...[a, low, 0.05, b, low, 0.05, b, high, 0.05],
        ...[a, low, 0.05, b, high, 0.05, a, high, 0.05],
      ]);
    };
    expect(shapeMeets(found.tree, wall(0.5, 3.5), pyramid)).toBe(true);
    expect(shapeMeets(bare, wall(0.5, 3.5), pyramid)).toBe(false);
    // And UP by its own number: a tree drawn tall enough lifts a wall under the eye into it.
    const tall = (() => {
      // Tall AND slim: its height lifts the wall to the eye, and its girth would not.
      for (let z = -40; z > -40_000; z -= 1.37) {
        const tree: ScatterItem = { ...item('tree-broadleaf', 0, 0, z), setting: 'park' };
        const drawn = drawnScale(tree);
        if (drawn.up > 1.32 && drawn.across < 1.2) return tree;
      }
      throw new Error('no park tree drawn tall enough');
    })();
    const up = drawnScale(tall).up;
    // Stood at the eye's feet, the wall across it at z = 0.05: its top at 1.55 m × up.
    const across = drawnScale(tall).across;
    const front = Float32Array.from([
      ...[
        -0.5 / across,
        0.5,
        0.05 / across,
        0.5 / across,
        0.5,
        0.05 / across,
        0.5 / across,
        1.55,
        0.05 / across,
      ],
      ...[
        -0.5 / across,
        0.5,
        0.05 / across,
        0.5 / across,
        1.55,
        0.05 / across,
        -0.5 / across,
        1.55,
        0.05 / across,
      ],
    ]);
    // The hash is of where it stands, so the tall tree is asked where it was found.
    const eyeAt = nearPyramid(
      { eye: { x: tall.x, y: 2, z: tall.z }, target: { x: tall.x, y: 2, z: tall.z + 25 } },
      16 / 10,
    );
    expect(1.55 * up).toBeGreaterThan(2.04);
    expect(1.55 * across).toBeLessThan(1.9);
    expect(shapeMeets(tall, front, eyeAt)).toBe(true);
    const plainTall: ScatterItem = { ...tall };
    delete (plainTall as { setting?: string }).setting;
    expect(shapeMeets(plainTall, front, eyeAt)).toBe(false);
  });

  it('keeps it off a side road by its drawn reach', () => {
    const wide = sideRoadNaturalMargin(found.tree);
    const plain = sideRoadNaturalMargin(bare);
    expect(wide).toBeGreaterThan(plain * 1.05);
    // The sway is added once, not scaled: the difference is the reach's alone.
    expect(wide - plain).toBeCloseTo(Math.hypot(reach, reach) * (found.across - 1), 6);
  });
});
