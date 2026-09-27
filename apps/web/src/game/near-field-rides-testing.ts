// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The rides #545's gate is held to, and the shapes they are measured against —
 * test support, never shipped. Split out of `near-field.test.ts` by #651.
 *
 * ⚠️ **Why a module and two files, when the gate is one claim.** The rides
 * are the dearest test in the Vitest suite by far: 216 s of one worker on the
 * CI runner, under coverage (run 36326090778) — twice the FIT fuzz's 99 s and
 * seven times anything else. As one file they ran in one worker from wherever
 * the scheduler happened to start them — 112 s in, on that run — and the whole
 * suite then waited on them for the last minute and a half. So each ride is
 * registered by one of `RIDE_GROUPS`, each group is a test file of its own
 * (`near-field-rides-<n>.test.ts`), the two run in parallel, and the root
 * `vitest.config.ts` starts them first. Nothing about what is measured
 * changed: every ride, every metre, every aspect, both worlds, held to the
 * same reference.
 *
 * ⚠️ **What the split must not lose**, and what holds each:
 *
 * - **A ride nobody runs.** `near-field.test.ts` §"the rides are split, and
 *   none is lost" requires every ride in `RIDES` in exactly one group, and a
 *   file for every group that registers exactly that group.
 * - **The findings, which were totals over every ride.** Each file now holds
 *   ITS rides to them: nothing a device draws is cut (a conjunction, so the
 *   same claim), and the control and the box-only count — which a total could
 *   meet on one ride's strength — must each be met by every group on its own,
 *   so the groups are chosen to meet them and the claim is if anything
 *   stronger. The per-ride counts that choice rests on are at `RIDE_GROUPS`.
 */

import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { metres, metresPerSecond, type RouteProfile } from '@onyourleft/domain';

import { isBuiltKind } from './buildings';
import {
  NEAR_PLANE_METRES,
  cameraRig,
  horizontalSpread,
  verticalHalfTangent,
  type CameraRig,
} from './camera';
import {
  clearOfTheCamera,
  intrudes,
  nearPyramid,
  type DrawnWorld,
  type NearPyramid,
  type ShapeTriangles,
  type ShapesOf,
} from './near-field';
import {
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
import type { SceneryKind, ScatterItem } from './scatter';
import { atStartLine } from './simulation';
import { corridorOrigin } from './terrain';
import { sceneryFitMetres } from './three-renderer';

export const WORLDS: readonly DrawnWorld[] = ['stylised', 'realistic'];

export const STYLISED_MODELS = fileURLToPath(new URL('./models/', import.meta.url));
const REALISTIC_MODELS = fileURLToPath(new URL('../../public/realistic/', import.meta.url));

/**
 * Every shape a natural kind is drawn as, in each world, in the item's own
 * frame at a scale of 1 — placed as the renderer places it.
 *
 * ⚠️ **Every shape of the kind, not the one an item's variant picks.** Which
 * shape a variant slot wears depends on how many the rung draws
 * (`quality.ts` §`sceneryVariants`), so the gate asks of all of them.
 */
export const SHAPES: Readonly<
  Record<DrawnWorld, ReadonlyMap<SceneryKind, readonly ShapeTriangles[]>>
> = {
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

/** The rides — fixture routes, with the camera on the rider's racing line. */
export const RIDES: Readonly<Record<string, () => RouteProfile>> = {
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

/**
 * The rides, in the groups the files run them in — #651. Each group is a file,
 * `near-field-rides-<index>.test.ts`, which calls {@link describeRides} with
 * its index and nothing else.
 *
 * ⚠️ **Two groups, and not more, because of the control.** Each group must
 * meet on its own rides the two findings a total over every ride used to
 * meet, and only two rides find the control's cut in BOTH worlds — measured
 * ride by ride on `f7a0325`: the mirrored planner's route (realistic 1,
 * stylised 3) and the right-hand circuit (17 and 22). Every other ride finds
 * it in one world or in none. The box-only count is no constraint: the least
 * any one ride finds in the realistic world is 210, the 300 m circuit's.
 *
 * Balanced on what each ride took on the CI runner under coverage (run
 * 36326090778, seconds): the level road 70.7 and the right-hand circuit 38.7
 * are 109.4; the other seven are 104.2.
 */
export const RIDE_GROUPS: readonly (readonly string[])[] = [
  ['a level road through villages', 'a 300 m right-hand circuit'],
  [
    "a planner's route, mirrored",
    'a 300 m circuit',
    'a 20 m left-hand hairpin',
    "a planner's route",
    'a 20 m hairpin',
    'an S-bend of 30 m',
    'an S-bend of 30 m, left first',
  ],
];

/** The least box-only item-frames a group must find in the realistic world. */
export const BOX_ONLY_AT_LEAST = 100;

/**
 * Registers the rides of one group — the describe `near-field.test.ts` used
 * to hold for every ride, unchanged but for which rides it is handed.
 */
export function describeRides(group: number): void {
  const names = RIDE_GROUPS[group];
  if (names === undefined) throw new Error(`no ride group ${String(group)}`);
  describe('a ride — nothing the camera passes is cut by the near plane (#545)', () => {
    /** Item-frames the plane cuts in the frame as `scene.ts` built it, by world and aspect. */
    const uncut = new Map<string, number>();
    /** Item-frames whose box met the pyramid and whose shapes did not, by world. */
    const boxOnly = new Map<DrawnWorld, number>();

    /** Frames measured, by ride, so a finding below cannot pass over rides that never ran. */
    const measured = new Map<string, number>();

    for (const name of names) {
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
      }, 120_000);
    }

    it('cuts nothing a device draws even before the cull — the owner’s tablet among them', () => {
      // The finding, pinned: on these routes the camera on its line never comes
      // within the plane of anything at the aspect of a phone or a tablet. If a
      // change to the camera, the line or the placement brings it there, this is
      // where it shows — before the cull quietly starts dropping trees.
      //
      // ⚠️ The counts are the rides' own, so every ride must have run: on its
      // own, with `-t`, this used to pass over empty counts (#545's review).
      for (const name of names) {
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
      expect(boxOnly.get('realistic') ?? 0).toBeGreaterThan(BOX_ONLY_AT_LEAST);
    });
  });
}
