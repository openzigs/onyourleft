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
 *    fixture routes, a metre at a time, at every aspect from an upright phone
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
import {
  clearOfTheCamera,
  intrudes,
  nearPyramid,
  sceneryReach,
  shapeMeets,
  triangleMeets,
  type DrawnWorld,
  type NearPyramid,
  type Reach,
  type ShapeTriangles,
  type ShapesOf,
} from './near-field';
import {
  boundsOf,
  fittedRealistic,
  fittedStylised,
  modelTriangles,
  referenceShapeMeets,
} from './near-field-testing';
import { REALISTIC_VEGETATION } from './realistic-assets';
import {
  circuitRoute,
  hairpinRoute,
  northRoute,
  plannerRoute,
  sBendRoute,
} from './route-fixtures-testing';
import { sceneFrame } from './scene';
import { SCENERY_MODELS } from './scenery-models';
import { SCATTER_KINDS, STRUCTURE_KINDS, type SceneryKind, type ScatterItem } from './scatter';
import { atStartLine } from './simulation';
import { corridorOrigin } from './terrain';
import {
  realisticStructureGeometry,
  realisticStructureSurfaces,
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
 * (`quality.ts` §`sceneryVariants`), so the gate asks of all of them.
 */
const SHAPES: Readonly<Record<DrawnWorld, ReadonlyMap<SceneryKind, readonly ShapeTriangles[]>>> = {
  stylised: new Map(
    Object.entries(SCENERY_MODELS)
      .filter(([kind]) => !isBuiltKind(kind))
      .map(([kind, models]) => [
        kind as SceneryKind,
        (models ?? []).map((model) =>
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
    // Every committed natural model, so a table that forgot one is a red count
    // rather than a shape nobody checked.
    const stylisedFiles = readdirSync(STYLISED_MODELS).filter(
      (file) => file.endsWith('.glb') && !file.startsWith('building-'),
    ).length;
    expect(checked).toBe(stylisedFiles + 7);
  });

  it('holds the stylised house, fitted and centred, as a box turned with the item', () => {
    for (const model of SCENERY_MODELS.building ?? []) {
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
  readonly rig: CameraRig;
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
  for (let distance = 0; distance < profile.totalDistance; distance += 1) {
    const frame = sceneFrame({
      profile,
      origin,
      state: { ...start, ride: { speed: metresPerSecond(8), distance: metres(distance) } },
    });
    frames.push({ rig: cameraRig(frame.camera), scatter: frame.scatter });
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
  // hot loop about three times over (CLAUDE.md §4c). 230 s is about three times the slowest ride,
  // so a ride that slows past it is red. ⚠️ It is NOT a hang guard, and it bounds nothing about
  // the file: each ride is synchronous, and Vitest cannot interrupt a synchronous case — its timer
  // is only read once the case returns — so a ride that never returns is caught only by the job's
  // own stop. And the nine rides run one after another, so a cull that slows every ride can cost
  // up to 9 × 230 s before the last one goes red.
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
