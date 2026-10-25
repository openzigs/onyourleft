// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The demo's camera director and its tour — #1649: behind the rider, overhead,
 * and a roadside pan, strung together with cuts and blends.
 *
 * ## Every shot is a `CameraPose`, so the renderer is untouched
 *
 * `three-renderer.ts` places its camera with `camera.ts` §`cameraRig`: the eye
 * {@link CAMERA_BEHIND_METRES} back along the heading from the pose's point and
 * {@link CAMERA_ABOVE_METRES} over `eyeRoadY`, looking at a target
 * {@link CAMERA_TARGET_AHEAD_METRES} ahead at `targetRoadY`. Any eye and any
 * line of sight that is not straight down can be written that way
 * ({@link poseLookingAt}): the heading is the sight line's direction on the
 * ground, and the target is wherever the sight line has travelled 29.5 m over
 * the ground. So the director hands the renderer an ordinary pose, the
 * renderer's scenery cull (`three-renderer.ts` §`inView`) reads a pose whose
 * eye is where the camera really is, and nothing in `src/game/` changes.
 *
 * ## The shots
 *
 * - **Behind** is the product's chase camera itself: `scene.ts`
 *   §`cameraPose`, called, for the same drawn distance and the same line across
 *   the road. Never a copy of its numbers (`camera-tour.test.ts` compares it
 *   field by field with the frame `sceneFrame` builds).
 * - **Overhead** rises {@link OVERHEAD_ABOVE_METRES} over the road
 *   {@link OVERHEAD_BEHIND_METRES} behind the rider and looks down at them, so
 *   the lead rider is the middle of the frame. It pitches about 50° down,
 *   which with the lens's 35° half-angle keeps every ray it sees ahead of the
 *   eye's own vertical plane — the assumption `three-renderer.ts`
 *   §`treeCanBeSeen` ranks the trees on. A camera straight down would see
 *   ground the cull has already thrown away.
 * - **Roadside** stands still on the verge {@link ROADSIDE_ACROSS_METRES} to
 *   the rider's left at a point the tour planned ({@link planTour}: where the
 *   lead is halfway through the shot) and turns to follow the rider past.
 *
 * ## Cuts and blends
 *
 * A shot is entered with a **cut** — one frame is the old shot, the next the
 * new — or a **blend**: for {@link BLEND_SECONDS} the eye and the point looked
 * at slide in a straight line from where the old shot would be to where the
 * new one is, both evaluated at the same ride time, so the blend moves with
 * the rider. A visitor who asked for reduced motion gets {@link reducedMotionTour}:
 * every blend a cut, and the roadside shot locked off rather than panning.
 *
 * ## Never underground
 *
 * Every eye but the chase camera's (which is the product's, and is two metres
 * over the road it stands on) is held at least {@link EYE_CLEARANCE_METRES}
 * over the ground under it, read through `people.ts` §`groundOf`, which is
 * `landform.ts` §`terrainHeightAt` at the nearest point of the drawn road: the
 * ground the renderer draws, not the road's height carried sideways.
 *
 * ## Pure
 *
 * {@link cameraAt} is a function of the planned tour, the ride time, the drawn
 * ride and the frame's corridor: no clock and no state, so the same ride is
 * the same film every time (#1655 renders it).
 */

import { seconds, type RouteProfile } from '@onyourleft/domain';

import {
  CAMERA_ABOVE_METRES,
  CAMERA_BEHIND_METRES,
  CAMERA_TARGET_AHEAD_METRES,
} from '../game/camera';
import type { RigPoint } from '../game/camera';
import { cameraRig } from '../game/camera';
import type { CameraPose } from '../game/port';
import { cameraPose } from '../game/scene';
import type { DrawnRide } from '../game/simulation';
import {
  drawnRoadFrame,
  drawnRoadPosition,
  type CorridorOrigin,
  type RoadCorridor,
} from '../game/terrain';
import { createDemoRide, demoRoad } from './runner';
import type { DemoPreset, DemoPresetId } from './script';

/** The three shots. */
export type ShotKind = 'behind' | 'overhead' | 'roadside';

/** How a shot is entered. */
export type Transition = 'cut' | 'blend';

/** One shot of a tour, authored. */
export interface TourShot {
  readonly kind: ShotKind;
  readonly seconds: number;
  /** How this shot is entered from the one before it, the last shot's for the first. */
  readonly into: Transition;
}

/**
 * A tour ready to direct: its shots, and where the lead rider is at each
 * whole second of the preset, so that a roadside shot knows where to stand.
 * The tour repeats for as long as the ride lasts.
 */
export interface CameraTour {
  readonly shots: readonly TourShot[];
  /** Whether a roadside shot pans to follow the rider (false under reduced motion). */
  readonly pans: boolean;
  /** The lead's odometer at each whole second of ride, from second zero. */
  readonly leadMetres: readonly number[];
}

/** What the director reads of the frame being drawn. */
export interface TourWorld {
  /** The frame's road, built around the drawn rider (`SceneFrame.corridor`). */
  readonly corridor: RoadCorridor;
  /** The route the road is drawn from, and its projection origin. */
  readonly profile: RouteProfile;
  readonly origin: CorridorOrigin;
  /** How far across the road the lead is drawn (`scene.ts` §`placedRiders`). */
  readonly riderLateral: number;
  /** The drawn ground's height at a point, local metres (`people.ts` §`groundOf`). */
  readonly groundAt: (x: number, z: number) => number;
}

/** The longest a blend lasts. #1649 bounds it at 1.5 s. */
export const BLEND_SECONDS = 1.5;

/** The least an eye ever stands over the ground under it: over #1649's 1.5 m, with room. */
export const EYE_CLEARANCE_METRES = 1.6;

/** How far behind the rider, along the road, the overhead camera stands. */
export const OVERHEAD_BEHIND_METRES = 14;

/** How far above the road under the rider the overhead camera stands. */
export const OVERHEAD_ABOVE_METRES = 18;

/** How far the roadside camera stands to the rider's left of the centreline: on the verge, clear of the scenery at 6.5 m. */
export const ROADSIDE_ACROSS_METRES = 5;

/** The roadside camera's eye over the ground it stands on. */
export const ROADSIDE_EYE_METRES = 1.7;

/** Under reduced motion, how far back along the road the still roadside camera looks. */
export const ROADSIDE_LOCKED_BACK_METRES = 15;

/** How high on the rider every shot but the chase looks: about the hips. */
const RIDER_AIM_METRES = 1;

/** A tour's shots, authored by hand for each preset. Each starts behind the rider, the product's own view. */
export const DEMO_TOURS: Readonly<Record<DemoPresetId, readonly TourShot[]>> = {
  climb: [
    { kind: 'behind', seconds: 20, into: 'cut' },
    { kind: 'overhead', seconds: 12, into: 'blend' },
    { kind: 'behind', seconds: 16, into: 'blend' },
    { kind: 'roadside', seconds: 8, into: 'cut' },
  ],
  sprint: [
    { kind: 'behind', seconds: 15, into: 'blend' },
    { kind: 'roadside', seconds: 8, into: 'cut' },
    { kind: 'behind', seconds: 12, into: 'cut' },
    { kind: 'overhead', seconds: 10, into: 'blend' },
  ],
  group: [
    { kind: 'behind', seconds: 15, into: 'cut' },
    { kind: 'overhead', seconds: 12, into: 'blend' },
    { kind: 'behind', seconds: 10, into: 'blend' },
    { kind: 'roadside', seconds: 8, into: 'cut' },
  ],
};

/** The longest a planned ride is looked ahead, so a preset that never ends still plans in bounded time. */
const PLAN_HORIZON_SECONDS = 1_800;

/** The step the plan rides the preset at: the simulation's own 20 Hz. */
const PLAN_STEP_SECONDS = 0.05;

/**
 * Plan `preset`'s tour: ride the preset once through the runner, at the
 * simulation's 20 Hz, and note where the lead is each second, so that a
 * roadside shot can stand where the lead will pass. Deterministic, as the
 * ride is. `profile` is the road the ride is drawn on: the preset's own, or
 * since #1652 a baked route's (`baked-route.ts`).
 */
export function planTour(
  preset: DemoPreset,
  shots: readonly TourShot[] = DEMO_TOURS[preset.id],
  profile: RouteProfile = demoRoad(preset.route),
): CameraTour {
  if (shots.length === 0) throw new RangeError('a camera tour needs at least one shot');
  const ride = createDemoRide(preset, profile);
  const leadMetres: number[] = [];
  const end = ride.profile.totalDistance;
  const stepsPerSecond = Math.round(1 / PLAN_STEP_SECONDS);
  let lead = ride.current().riders[0]?.state.distance ?? 0;
  leadMetres.push(lead);
  for (let second = 1; second <= PLAN_HORIZON_SECONDS && lead < end; second += 1) {
    for (let step = 1; step <= stepsPerSecond; step += 1) {
      ride.sample(seconds(second - 1 + step * PLAN_STEP_SECONDS));
    }
    lead = ride.current().riders[0]?.state.distance ?? lead;
    leadMetres.push(lead);
  }
  return { shots, pans: true, leadMetres };
}

/**
 * The same tour for a visitor who asked for reduced motion (WCAG 2.2 SC
 * 2.3.3): every blend is a cut, and the roadside camera holds still rather
 * than turning to follow the rider.
 */
export function reducedMotionTour(tour: CameraTour): CameraTour {
  return {
    ...tour,
    pans: false,
    shots: tour.shots.map((shot) => ({ ...shot, into: 'cut' })),
  };
}

/** One shot as it falls in the ride: which, from when, and the one before it. */
export interface Placed {
  readonly shot: TourShot;
  /** Ride seconds this occurrence started at. */
  readonly startedAt: number;
  /** The shot before, and when it started; none at the very start of the ride. */
  readonly previous: { readonly shot: TourShot; readonly startedAt: number } | undefined;
}

/** Which shot `rideSeconds` falls in. The tour repeats end to end. */
export function shotAt(tour: CameraTour, rideSeconds: number): Placed {
  const length = tour.shots.reduce((sum, shot) => sum + shot.seconds, 0);
  const t = Math.max(0, rideSeconds);
  const lap = Math.floor(t / length);
  let startedAt = lap * length;
  const within = t - startedAt;
  let index = 0;
  let from = 0;
  for (; index < tour.shots.length - 1; index += 1) {
    const next = from + (tour.shots[index] as TourShot).seconds;
    if (within < next) break;
    from = next;
  }
  startedAt += from;
  const shot = tour.shots[index] as TourShot;
  const before = index === 0 ? tour.shots.length - 1 : index - 1;
  const previousShot = tour.shots[before] as TourShot;
  const previous =
    startedAt <= 0
      ? undefined
      : { shot: previousShot, startedAt: startedAt - previousShot.seconds };
  return { shot, startedAt, previous };
}

/** The lead's planned odometer at `rideSeconds`, interpolated; held past the plan's end. */
function plannedLead(tour: CameraTour, rideSeconds: number): number {
  const { leadMetres } = tour;
  const last = leadMetres.length - 1;
  if (rideSeconds >= last) return leadMetres[last] as number;
  const whole = Math.floor(rideSeconds);
  const from = leadMetres[whole] as number;
  const to = leadMetres[whole + 1] as number;
  return from + (to - from) * (rideSeconds - whole);
}

/** An eye and the point it looks at. */
interface Sight {
  readonly eye: RigPoint;
  readonly look: RigPoint;
}

const lerp = (a: RigPoint, b: RigPoint, share: number): RigPoint => ({
  x: a.x + (b.x - a.x) * share,
  y: a.y + (b.y - a.y) * share,
  z: a.z + (b.z - a.z) * share,
});

/**
 * The pose whose rig (`camera.ts` §`cameraRig`) stands at `eye` and looks
 * along the line to `look`. The heading is that line on the ground, and the
 * rig's target is the point on it 29.5 m from the eye over the ground.
 *
 * @throws {RangeError} for a line straight up or down, which no rig can draw.
 */
export function poseLookingAt(eye: RigPoint, look: RigPoint): CameraPose {
  const dx = look.x - eye.x;
  const dy = look.y - eye.y;
  const dz = look.z - eye.z;
  const across = Math.hypot(dx, dz);
  if (!(across > 1e-6)) throw new RangeError('a camera cannot look straight up or down');
  const headingX = dx / across;
  const headingZ = dz / across;
  const reach = (CAMERA_BEHIND_METRES + CAMERA_TARGET_AHEAD_METRES) / across;
  return {
    x: eye.x + headingX * CAMERA_BEHIND_METRES,
    // The point the rig stands behind, on the sight line.
    y: eye.y + (dy * CAMERA_BEHIND_METRES) / across,
    z: eye.z + headingZ * CAMERA_BEHIND_METRES,
    headingX,
    headingZ,
    eyeRoadY: eye.y - CAMERA_ABOVE_METRES,
    targetRoadY: eye.y + dy * reach,
  };
}

/** Where the chase camera's eye is. */
function chaseEye(chase: CameraPose): RigPoint {
  return cameraRig(chase).eye;
}

/** `eye`, lifted if it would stand less than {@link EYE_CLEARANCE_METRES} over the ground. */
function aboveGround(eye: RigPoint, world: TourWorld): RigPoint {
  const floor = world.groundAt(eye.x, eye.z) + EYE_CLEARANCE_METRES;
  return eye.y >= floor ? eye : { ...eye, y: floor };
}

/** Where `shot`, started at `startedAt`, looks from and at, at `rideSeconds`. */
function sightOf(
  tour: CameraTour,
  shot: TourShot,
  startedAt: number,
  chase: CameraPose,
  world: TourWorld,
): Sight {
  const rider: RigPoint = { x: chase.x, y: chase.y + RIDER_AIM_METRES, z: chase.z };
  switch (shot.kind) {
    case 'behind': {
      const rig = cameraRig(chase);
      return { eye: rig.eye, look: rig.target };
    }
    case 'overhead':
      return {
        eye: aboveGround(
          {
            x: chase.x - chase.headingX * OVERHEAD_BEHIND_METRES,
            y: chase.eyeRoadY + OVERHEAD_ABOVE_METRES,
            z: chase.z - chase.headingZ * OVERHEAD_BEHIND_METRES,
          },
          world,
        ),
        look: rider,
      };
    case 'roadside': {
      // Where the drawn road is, read off the route rather than off the
      // frame's corridor, which is rebuilt around the moving rider: a point
      // read off it wanders by centimetres from frame to frame.
      const standAt = plannedLead(tour, startedAt + shot.seconds / 2);
      const road = drawnRoadFrame(world.profile, world.origin, standAt);
      if (road === undefined) return { eye: chaseEye(chase), look: rider };
      const x = road.x - road.normalX * ROADSIDE_ACROSS_METRES;
      const z = road.z - road.normalZ * ROADSIDE_ACROSS_METRES;
      const eye: RigPoint = { x, y: world.groundAt(x, z) + ROADSIDE_EYE_METRES, z };
      // Locked off, it looks at the road the rider is coming along.
      const coming = drawnRoadPosition(
        world.profile,
        world.origin,
        standAt - ROADSIDE_LOCKED_BACK_METRES,
      );
      const look: RigPoint = tour.pans
        ? rider
        : { ...coming, y: world.groundAt(coming.x, coming.z) + RIDER_AIM_METRES };
      return { eye: aboveGround(eye, world), look };
    }
  }
}

/**
 * The camera at `rideSeconds` of `tour`, with the lead drawn where `drawn`
 * says, in the frame whose road and ground `world` carries. Pure.
 */
export function cameraAt(
  tour: CameraTour,
  rideSeconds: number,
  drawn: DrawnRide,
  world: TourWorld,
): CameraPose {
  const chase = cameraPose(world.corridor, drawn.riderDistance, world.riderLateral);
  const { shot, startedAt, previous } = shotAt(tour, rideSeconds);
  const into = rideSeconds - startedAt;
  if (shot.into === 'blend' && previous !== undefined && into < BLEND_SECONDS) {
    const from = sightOf(tour, previous.shot, previous.startedAt, chase, world);
    const to = sightOf(tour, shot, startedAt, chase, world);
    const share = into / BLEND_SECONDS;
    return poseLookingAt(
      aboveGround(lerp(from.eye, to.eye, share), world),
      lerp(from.look, to.look, share),
    );
  }
  if (shot.kind === 'behind') return chase;
  const sight = sightOf(tour, shot, startedAt, chase, world);
  return poseLookingAt(sight.eye, sight.look);
}
