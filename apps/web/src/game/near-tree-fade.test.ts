// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A scatter tree near the chase camera fades out, and never pops — #545, the
 * owner's ruling of 2026-11-02. `near-tree-fade.ts` says what the rule is.
 *
 * Four claims, each separately:
 *
 * 1. **The rule**: a tree's keep, from the camera's eye, over the band.
 * 2. **The belt draws it**: what `RealisticVegetationBelt` writes into the
 *    instance attribute the tree shader's dither reads (`vOylKeep`, from
 *    `instanceColor.xy`) — read back off the meshes, never off the function.
 * 3. **Over a ride** on the fixture routes, with the camera on the racing
 *    line: no tree is drawn nearer the eye than `gone`, every tree keeps
 *    exactly its keep across all its levels, and no tree's keep moves by more
 *    than a fade's step between two frames — where the control, the same
 *    trees dropped whole, moves by all of it.
 * 4. **The fade ends before the near plane's cull starts**: at every frame
 *    the stylesheet allows, every tree `near-field.ts` §`clearOfTheCamera`
 *    drops is already faded to nothing, so the cull never drops a tree that
 *    is drawn — and at 8 : 1, a frame nothing produces, it would.
 *
 * ⚠️ No `three` is imported here, for `three-seam.test.ts`.
 */

import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { metres, metresPerSecond, type RouteProfile } from '@onyourleft/domain';

import { CAMERA_BEHIND_METRES, CAMERA_TARGET_AHEAD_METRES, cameraRig } from './camera';
import { drawnCamera } from './chase-camera-testing';
import { clearOfTheCamera, type ShapeTriangles, type ShapesOf } from './near-field';
import { fittedRealistic, modelTriangles } from './near-field-testing';
import { NEAR_TREE_FADE_METRES, nearTreeKeep, type NearTreeFade } from './near-tree-fade';
import type { CameraPose } from './port';
import { REALISTIC_VEGETATION } from './realistic-assets';
import {
  circuitRoute,
  hairpinRoute,
  northRoute,
  plannerRoute,
  sBendRoute,
} from './route-fixtures-testing';
import type { ScatterItem, SceneryKind } from './scatter';
import { sceneFrame, type SceneInput } from './scene';
import { atStartLine } from './simulation';
import { corridorOrigin } from './terrain';
import {
  prepareRealisticShape,
  RealisticVegetationBelt,
  ScatterBelt,
  sceneryFitMetres,
  type RealisticShape,
} from './three-renderer';

const { gone, whole } = NEAR_TREE_FADE_METRES;

/** A camera at the origin looking up +z: its eye is {@link CAMERA_BEHIND_METRES} back, at z = −4.5. */
const POSE: CameraPose = {
  x: 0,
  y: 0,
  z: 0,
  headingX: 0,
  headingZ: 1,
  targetAheadMetres: CAMERA_TARGET_AHEAD_METRES,
  eyeRoadY: 0,
  targetRoadY: 0,
};

/** A point `distance` from POSE's eye in plan, 3 m to its right and ahead of it. */
function fromEye(distance: number): { readonly x: number; readonly z: number } {
  return { x: 3, z: -CAMERA_BEHIND_METRES + Math.sqrt(distance ** 2 - 9) };
}

describe('nearTreeKeep — the rule', () => {
  it('keeps a tree whole from 6 m out, none of it from 4.5 m in, and evenly between', () => {
    expect(NEAR_TREE_FADE_METRES).toEqual({ gone: 4.5, whole: 6 });
    const at = (distance: number): number => {
      const { x, z } = fromEye(distance);
      return nearTreeKeep(x, z, POSE, 'fade');
    };
    expect(at(30)).toBe(1);
    expect(at(whole)).toBeCloseTo(1, 12);
    expect(at(5.625)).toBeCloseTo(0.75, 12);
    expect(at(5.25)).toBeCloseTo(0.5, 12);
    expect(at(4.875)).toBeCloseTo(0.25, 12);
    expect(at(gone)).toBeCloseTo(0, 12);
    expect(at(3.2)).toBe(0);
  });

  it('measures from the EYE, behind the pose along its heading, wherever the camera faces', () => {
    // 5.25 m from the pose itself, and 9.75 m from the eye: whole.
    expect(nearTreeKeep(0, 5.25, POSE, 'fade')).toBe(1);
    // 0.75 m in front of the pose is 5.25 m from the eye: half.
    expect(nearTreeKeep(0, 0.75, POSE, 'fade')).toBeCloseTo(0.5, 12);
    // The same camera turned to look up +x: its eye is at x = −4.5 now.
    const turned: CameraPose = { ...POSE, headingX: 1, headingZ: 0 };
    expect(nearTreeKeep(0.75, 0, turned, 'fade')).toBeCloseTo(0.5, 12);
    // …where the unturned camera's eye, at z = −4.5, is 4.56 m from it.
    expect(nearTreeKeep(0.75, 0, POSE, 'fade')).toBeLessThan(0.05);
  });

  it('draws it whole with the fade off, and drops it whole at the middle with the cut — the controls', () => {
    const { x, z } = fromEye(4);
    expect(nearTreeKeep(x, z, POSE, 'off')).toBe(1);
    const mid = (gone + whole) / 2;
    const near = fromEye(mid - 0.01);
    const far = fromEye(mid + 0.01);
    expect(nearTreeKeep(near.x, near.z, POSE, 'cut')).toBe(0);
    expect(nearTreeKeep(far.x, far.z, POSE, 'cut')).toBe(1);
  });
});

/** A geometry three built, taken off a belt so this file names no `three` type. */
function aGeometry(): NonNullable<ReturnType<ScatterBelt['meshesOf']>[number]>['geometry'] {
  const mesh = new ScatterBelt(new Map()).meshesOf('rock')[0];
  if (mesh === undefined) throw new Error('no rock primitive');
  return mesh.geometry.clone();
}

/** What `GLTFLoader` leaves on a mesh: the fields `prepareRealisticShape` reads. */
function loaderMaterial(name: string, transparent = false): Record<string, unknown> {
  return {
    name,
    transparent,
    alphaTest: 0,
    alphaHash: false,
    map: { image: { width: 512, height: 512 }, dispose: () => undefined },
    normalMap: null,
    dispose: () => undefined,
  };
}

const IDENTITY = { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] };

/** A loaded tree, bark and leaves, with its impostor's strip. */
function aTree(): RealisticShape {
  const extras = {
    oyl_scan_height: 8,
    oyl_scan_width: 4,
    oyl_impostor_scale: 8.2,
    oyl_impostor_frames: 8,
  };
  const scene = {
    updateWorldMatrix: () => undefined,
    traverse: (visit: (node: unknown) => void) => {
      visit({ isMesh: false, userData: extras });
      for (const material of [loaderMaterial('bark'), loaderMaterial('leaves', true)]) {
        visit({
          isMesh: true,
          geometry: aGeometry(),
          material,
          matrixWorld: IDENTITY,
          userData: {},
        });
      }
    },
  } as unknown as Parameters<typeof prepareRealisticShape>[0];
  return prepareRealisticShape(scene, 'tree', {
    image: { width: 2048, height: 512 },
  } as unknown as Parameters<typeof prepareRealisticShape>[2]);
}

/** A loaded tree that also carries a middle level (#617), as every committed tree does. */
function aTreeWithMiddle(): RealisticShape {
  const near = aTree();
  return {
    ...near,
    middle: {
      parts: near.parts.map((part) => ({ geometry: aGeometry(), material: part.material })),
      triangles: 12,
    },
  };
}

/** A shrub or a rock: one part, no impostor. */
function aPlant(): RealisticShape {
  const scene = {
    updateWorldMatrix: () => undefined,
    traverse: (visit: (node: unknown) => void) => {
      visit({ isMesh: false, userData: { oyl_scan_height: 1, oyl_scan_width: 1 } });
      visit({
        isMesh: true,
        geometry: aGeometry(),
        material: loaderMaterial('plant'),
        matrixWorld: IDENTITY,
        userData: {},
      });
    },
  } as unknown as Parameters<typeof prepareRealisticShape>[0];
  return prepareRealisticShape(scene, 'plant');
}

/** A belt of every realistic kind, its trees carrying a middle level. */
function aBeltWithMiddle(): RealisticVegetationBelt {
  return new RealisticVegetationBelt(
    new Map([
      ['tree-broadleaf', [aTreeWithMiddle()]],
      ['tree-conifer', [aTreeWithMiddle()]],
      ['shrub', [aPlant()]],
      ['rock', [aPlant()]],
    ] as const),
  );
}

/** A belt of every realistic kind, as a view builds one. */
function aBelt(): RealisticVegetationBelt {
  return new RealisticVegetationBelt(
    new Map([
      ['tree-broadleaf', [aTree()]],
      ['tree-conifer', [aTree()]],
      ['shrub', [aPlant()]],
      ['rock', [aPlant()]],
    ] as const),
  );
}

/** What this reads of an instanced mesh, without naming three. */
interface DrawnMesh {
  readonly count: number;
  readonly instanceMatrix: { readonly array: ArrayLike<number> };
  readonly instanceColor: { readonly array: ArrayLike<number> } | null;
}

/**
 * The share of the dither's hash one instance keeps, read as the shader reads
 * `vOylKeep`: `[0, 0)` keeps every fragment, and otherwise `[low, high)` of
 * `[0, 1)` — an edge written −1 or 2 is the hash's own end (`tree-levels.ts`
 * §`writeInterval`).
 */
function keptShare(mesh: DrawnMesh, slot: number): number {
  const low = mesh.instanceColor?.array[slot * 3] ?? 0;
  const high = mesh.instanceColor?.array[slot * 3 + 1] ?? 0;
  if (!(high > low)) return 1;
  return Math.max(0, Math.min(1, high) - Math.max(0, low));
}

/**
 * Every tree the belt's last frame submitted, by where it stands: the share
 * of its pixels kept, summed over every level it was drawn at.
 */
function treesDrawn(
  belt: RealisticVegetationBelt,
): Map<string, { readonly x: number; readonly z: number; share: number }> {
  const out = new Map<string, { x: number; z: number; share: number }>();
  for (const kind of ['tree-broadleaf', 'tree-conifer'] as const) {
    const levels = belt.levelsOf(kind);
    // A level's parts each carry the same instances: one part a level is the tree's.
    const meshes = [
      ...levels.full.map((parts) => parts[0]),
      ...levels.middle.map((parts) => parts?.[0]),
      ...levels.impostor,
    ].filter((mesh) => mesh !== undefined) as unknown as DrawnMesh[];
    for (const mesh of meshes) {
      for (let slot = 0; slot < mesh.count; slot += 1) {
        const x = mesh.instanceMatrix.array[slot * 16 + 12] ?? Number.NaN;
        const z = mesh.instanceMatrix.array[slot * 16 + 14] ?? Number.NaN;
        const key = `${x.toFixed(3)},${z.toFixed(3)}`;
        const tree = out.get(key) ?? { x, z, share: 0 };
        tree.share += keptShare(mesh, slot);
        out.set(key, tree);
      }
    }
  }
  return out;
}

/** A broadleaf standing at `(x, z)`. */
function tree(x: number, z: number): ScatterItem {
  return { kind: 'tree-broadleaf', x, y: 0, z, rotation: 0, scale: 1, variant: 0 };
}

describe('RealisticVegetationBelt — what the tree shader is handed near the camera', () => {
  it('keeps half of a tree 5.25 m from the eye, at the level it is drawn at, and all of one 10 m off', () => {
    const belt = aBelt();
    const half = fromEye(5.25);
    const far = fromEye(10);
    belt.update([tree(far.x, far.z), tree(half.x, half.z)], POSE);
    const drawn = [...treesDrawn(belt).values()];
    expect(drawn).toHaveLength(2);
    const near = drawn.find((each) => Math.abs(each.z - half.z) < 1e-3);
    const whole = drawn.find((each) => Math.abs(each.z - far.z) < 1e-3);
    expect(near?.share).toBeCloseTo(0.5, 6);
    expect(whole?.share).toBe(1);
    // Read as the shader reads it: the nearest tree is the full mesh alone,
    // and keeps the hash's [0, 0.5) — written as the open end −1 and 0.5.
    const [full] = belt.levelsOf('tree-broadleaf').full[0] as unknown as DrawnMesh[];
    if (full === undefined) throw new Error('no full mesh');
    const slot = Array.from({ length: full.count }, (_, at) => at).find(
      (at) => Math.abs((full.instanceMatrix.array[at * 16 + 14] ?? 0) - half.z) < 1e-3,
    );
    if (slot === undefined) throw new Error('the near tree is not the full mesh');
    expect(full.instanceColor?.array[slot * 3]).toBe(-1);
    expect(full.instanceColor?.array[slot * 3 + 1]).toBeCloseTo(0.5, 6);
  });

  it('draws nothing of a tree 4 m from the eye and grounds no blob under it, where the fade off draws it whole', () => {
    const belt = aBelt();
    const near = fromEye(4);
    belt.update([tree(near.x, near.z)], POSE);
    expect(treesDrawn(belt).size).toBe(0);
    expect(belt.drawnItems).toBe(0);
    expect(belt.grounded.count).toBe(0);
    // The control: the same frame with the fade off.
    belt.setNearTreeFade('off');
    belt.update([tree(near.x, near.z)], POSE);
    expect([...treesDrawn(belt).values()].map((each) => each.share)).toEqual([1]);
    expect(belt.drawnItems).toBe(1);
    expect(belt.grounded.count).toBe(1);
  });

  it('keeps half of every tree 5.25 m from the eye at whatever level its rank draws it, the middle level and its impostor too', () => {
    const belt = aBeltWithMiddle();
    // Eight trees on the 5.25 m ring, spread across the view: by their
    // distance from the pose they take the full mesh, the middle level and
    // the middle-to-impostor band, each a keep of one half.
    const ring = [-60, -45, -30, -15, 15, 30, 45, 60].map((degrees) => {
      const angle = (degrees * Math.PI) / 180;
      return tree(5.25 * Math.sin(angle), -CAMERA_BEHIND_METRES + 5.25 * Math.cos(angle));
    });
    for (let frame = 0; frame < 30; frame += 1) belt.update(ring, POSE);
    const levels = belt.levelsOf('tree-broadleaf');
    expect(levels.middle.some((parts) => (parts?.[0] as unknown as DrawnMesh).count > 0)).toBe(
      true,
    );
    const drawn = [...treesDrawn(belt).values()];
    expect(drawn).toHaveLength(ring.length);
    for (const each of drawn) expect(each.share).toBeCloseTo(0.5, 6);
  });

  it('fades the blob under a fading tree with it', () => {
    const belt = aBelt();
    const near = fromEye(5.625);
    belt.update([tree(near.x, near.z)], POSE);
    expect(belt.grounded.count).toBe(1);
    expect(belt.grounded.casters[0]?.strength).toBeCloseTo(0.75, 6);
  });

  it('ranks a tree faded to nothing out, so the next tree in the picture is the full mesh alone', () => {
    const belt = aBelt();
    const near = fromEye(4);
    const behind = [14, 20, 26, 32].map(fromEye);
    const items = [near, ...behind].map(({ x, z }) => tree(x, z));
    const next = behind[0] as { readonly z: number };
    /**
     * The z of every broadleaf a level drew, to the millimetre. This belt's
     * trees have no middle level, so band A splits a tree between its full
     * mesh and its impostor (`three-renderer.ts` §`update`).
     */
    const at = (level: 'full' | 'impostor'): number[] => {
      const levels = belt.levelsOf('tree-broadleaf');
      const mesh = (level === 'full' ? levels.full[0]?.[0] : levels.impostor[0]) as unknown as
        DrawnMesh | undefined;
      return mesh === undefined
        ? []
        : Array.from({ length: mesh.count }, (_, slot) =>
            Math.round((mesh.instanceMatrix.array[slot * 16 + 14] ?? 0) * 1000),
          );
    };
    const settle = (): void => {
      for (let frame = 0; frame < 30; frame += 1) belt.update(items, POSE);
    };
    settle();
    // The near tree is not drawn, and the next is the nearest ranked: the
    // full mesh, whole — not band A's split between two levels.
    expect(at('full')).toContain(Math.round(next.z * 1000));
    expect(at('full')).not.toContain(Math.round(near.z * 1000));
    expect(at('impostor')).not.toContain(Math.round(next.z * 1000));
    // The control: with the fade off the near tree is ranked first and takes
    // the full mesh, and the next is the band tree, at both levels.
    belt.setNearTreeFade('off');
    settle();
    expect(at('full')).toContain(Math.round(near.z * 1000));
    expect(at('impostor')).toContain(Math.round(next.z * 1000));
  });
});

/** The rides — `near-field.test.ts`' fixture routes, with the camera on the rider's racing line. */
const RIDES: Readonly<Record<string, () => RouteProfile>> = {
  'a level road through villages': () => northRoute(4_000, () => 50),
  'a 20 m hairpin': () => hairpinRoute(20),
  'an S-bend of 30 m': () => sBendRoute(30),
  'a 20 m left-hand hairpin': () => hairpinRoute(20, 'left'),
  'an S-bend of 30 m, left first': () => sBendRoute(30, 'left'),
  "a planner's route": () => plannerRoute(),
  'a 300 m circuit': () => circuitRoute(300, () => 20),
  "a planner's route, mirrored": () => plannerRoute({ mirrored: true }),
  'a 300 m right-hand circuit': () => circuitRoute(300, () => 20, 'right'),
};

interface RideFrame {
  readonly pose: CameraPose;
  readonly scatter: readonly ScatterItem[];
}

/**
 * A ride a metre at a time, at 8 m/s, with the camera `GameView` draws: since
 * #1994 `sceneFrame`'s, turned to the heading damped from frame to frame.
 */
function ride(profile: RouteProfile, extra: Partial<SceneInput> = {}): readonly RideFrame[] {
  const origin = corridorOrigin(profile);
  const start = atStartLine(profile);
  const frames: RideFrame[] = [];
  const inputAt = (distance: number): SceneInput => ({
    profile,
    origin,
    state: { ...start, ride: { speed: metresPerSecond(8), distance: metres(distance) } },
    ...extra,
  });
  const drawn = drawnCamera(inputAt, 8);
  for (let distance = 0; distance < profile.totalDistance; distance += 1) {
    const frame = sceneFrame(inputAt(distance));
    frames.push({ pose: drawn(distance, frame.camera), scatter: frame.scatter });
  }
  return frames;
}

const isTree = (item: ScatterItem): boolean =>
  item.kind === 'tree-broadleaf' || item.kind === 'tree-conifer';

const keyOf = (x: number, z: number): string => `${x.toFixed(3)},${z.toFixed(3)}`;

/**
 * The most a tree's keep may move between two frames at 60 fps and 8 m/s: a
 * tenth — so a tree fades over ten frames or more, never in one. A metre
 * ridden is 7.5 frames here, so this is 0.75 of a keep a metre.
 */
const MOST_KEEP_A_FRAME = 0.1;
const FRAMES_A_METRE = 60 / 8;

describe('a ride — no tree near the camera pops (#545)', () => {
  for (const [name, route] of Object.entries(RIDES)) {
    it(`${name}: draws no tree within ${String(gone)} m of the eye, each at its keep, fading over frames`, () => {
      const frames = ride(route());
      const fadeOver = (fade: NearTreeFade): { most: number; fading: number; least: number } => {
        let previous = new Map<string, number>();
        let most = 0;
        let fading = 0;
        let least = 1;
        for (const { pose, scatter } of frames) {
          const now = new Map<string, number>();
          for (const item of scatter) {
            if (!isTree(item)) continue;
            const keep = nearTreeKeep(item.x, item.z, pose, fade);
            now.set(keyOf(item.x, item.z), keep);
            if (keep > 0 && keep < 1) fading += 1;
            if (keep > 0) least = Math.min(least, keep);
            const before = previous.get(keyOf(item.x, item.z));
            if (before !== undefined) most = Math.max(most, Math.abs(keep - before));
          }
          previous = now;
        }
        return { most, fading, least };
      };
      const product = fadeOver('fade');
      const control = fadeOver('cut');
      // The fade is ridden through on every route here but the 300 m circuit,
      // whose trees never come within 6 m of the eye (measured, 6.94 m).
      if (name !== 'a 300 m circuit') {
        expect(product.fading, 'tree-frames mid-fade').toBeGreaterThan(0);
      }
      // The control pops wherever a tree passes the middle of the band: it
      // goes from whole to nothing between two metres, which is what the
      // measure below would see of a pop. (The level road's nearest tree
      // passes 5.44 m from the eye, short of the middle, 5.25 m.)
      if (product.least < 0.5) expect(control.most, 'the cut control').toBe(1);
      expect(product.most / FRAMES_A_METRE, 'keep moved in a frame').toBeLessThanOrEqual(
        MOST_KEEP_A_FRAME,
      );

      // Through the belt, read back off its meshes: what the shader is handed.
      const belt = aBelt();
      let checked = 0;
      for (const { pose, scatter } of frames) {
        belt.update(scatter, pose);
        const eye = cameraRig(pose).eye;
        for (const drawn of treesDrawn(belt).values()) {
          const distance = Math.hypot(drawn.x - eye.x, drawn.z - eye.z);
          expect(distance, `${name}: a tree drawn near the eye`).toBeGreaterThan(gone);
          // Every tree keeps exactly its keep, summed over its levels — a hand-
          // over splits [0, keep) between them and never draws past it.
          expect(drawn.share).toBeCloseTo(nearTreeKeep(drawn.x, drawn.z, pose, 'fade'), 4);
          if (distance < whole) checked += 1;
        }
      }
      if (name !== 'a 300 m circuit') expect(checked, 'fading trees read back').toBeGreaterThan(0);
    }, 120_000);
  }
});

/** The realistic trees' shapes, off the committed files, as the near-plane cull asks of them. */
const TREE_SHAPES: ReadonlyMap<SceneryKind, readonly ShapeTriangles[]> = new Map(
  (['tree-broadleaf', 'tree-conifer'] as const).map((kind) => [
    kind,
    REALISTIC_VEGETATION[kind].map((model) => {
      const { triangles, extras } = modelTriangles(
        fileURLToPath(new URL(`../../public/realistic/${model.file}`, import.meta.url)),
      );
      return fittedRealistic(triangles, extras, sceneryFitMetres(kind));
    }),
  ]),
);
const treeShapes: ShapesOf = (kind) => TREE_SHAPES.get(kind);

describe('the fade ends before the near plane’s cull begins (#545)', () => {
  it('leaves the cull no drawn tree to drop at any frame the stylesheet allows, where 8 : 1 would', () => {
    /** Trees the cull drops, at an aspect: how many, and the most of any of them still drawn. */
    const dropped = new Map<number, { count: number; mostKept: number }>();
    const aspects = [9 / 19.5, 10 / 16, 4 / 3, 16 / 10, 16 / 9, 19.5 / 9, 6, 8];
    // Both cameras a ride draws since #2422: an ordinary ride's, on the drawn
    // path, and the one beside the road a Delivery round and a lap race keep
    // (`uneased: true` draws it).
    for (const route of Object.values(RIDES)) {
      for (const { pose, scatter } of [...ride(route()), ...ride(route(), { uneased: true })]) {
        const trees = scatter.filter(isTree);
        const rig = cameraRig(pose);
        for (const aspect of aspects) {
          const kept = new Set(clearOfTheCamera(trees, rig, aspect, 'realistic', treeShapes));
          for (const item of trees) {
            if (kept.has(item)) continue;
            const seen = dropped.get(aspect) ?? { count: 0, mostKept: 0 };
            seen.count += 1;
            seen.mostKept = Math.max(seen.mostKept, nearTreeKeep(item.x, item.z, pose, 'fade'));
            dropped.set(aspect, seen);
          }
        }
      }
    }
    // Non-vacuity: at 6 : 1, the widest frame there is, the cull does drop trees.
    expect(dropped.get(6)?.count ?? 0).toBeGreaterThan(0);
    for (const aspect of aspects.filter((each) => each <= 6)) {
      expect(dropped.get(aspect)?.mostKept ?? 0, `at ${aspect.toFixed(2)} : 1`).toBe(0);
    }
    // The control: at 8 : 1 a tree the cull drops is still partly drawn — so
    // the bound above is the fade's `gone`, not a measure that sees nothing.
    // ⚠️ Since #2422 only the camera beside the road comes that near: the one
    // on the drawn path, its eye held in from the kerb, reached none.
    expect(dropped.get(8)?.mostKept ?? 0).toBeGreaterThan(0);
  }, 300_000);
});
