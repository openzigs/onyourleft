// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The demo's camera director and tour — #1649. Every pose is read back off
 * the frame the demo player hands the renderer (`DemoPlayer.frame`), and every
 * rider off that frame's own markers, projected through `camera-tour-testing.ts`.
 */

import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { RIDER_HEIGHT_METRES } from '../game/bicycle';
import { cameraRig, REFERENCE_ASPECT, riderFrameBox, type RigPoint } from '../game/camera';
import { NO_LAND_CLASS } from '../game/land-class';
import { groundOf } from '../game/people';
import type { CameraPose, SceneFrame } from '../game/port';
import { scatterSeed } from '../game/scatter';
import { placedRiders, sceneFrame, type SceneInput } from '../game/scene';
import { corridorOrigin, roadCorridor } from '../game/terrain';
import {
  BLEND_SECONDS,
  cameraAt,
  DEMO_TOURS,
  planTour,
  poseLookingAt,
  reducedMotionTour,
  shotAt,
  type CameraTour,
  type ShotKind,
  type TourWorld,
} from './camera-tour';
import { inFrame, projectThrough } from './camera-tour-testing';
import { createDemoPlayer, type DemoPlayer } from './player';
import { DEMO_PRESETS, GROUP_PRESET, SPRINT_PRESET } from './presets';
import type { DemoPreset } from './script';

/** The demo draws no scenery the camera reads, so the cheapest rung will do. */
const BARE = { scatterItems: 0, structureItems: 0, people: 0 } as const;
const FRAME_MS = 50;
const ASPECT = REFERENCE_ASPECT;

const lapSeconds = (tour: CameraTour): number =>
  tour.shots.reduce((sum, shot) => sum + shot.seconds, 0);

interface Shot {
  readonly seconds: number;
  readonly kind: ShotKind;
  readonly startedAt: number;
  readonly frame: SceneFrame;
}

/**
 * Ride `player` at 20 Hz for `forSeconds`, keeping every frame it would draw,
 * or, given `only`, every frame of those shots: the ride still advances at
 * 20 Hz, but a frame nobody reads is never built.
 */
function film(player: DemoPlayer, forSeconds: number, only?: ReadonlySet<ShotKind>): Shot[] {
  player.play();
  const shots: Shot[] = [];
  for (let ms = 0; ms <= forSeconds * 1000; ms += FRAME_MS) {
    player.advance(ms);
    const placed = shotAt(player.tour, player.rideMs / 1000);
    if (only !== undefined && !only.has(placed.shot.kind)) continue;
    shots.push({
      seconds: player.rideMs / 1000,
      kind: placed.shot.kind,
      startedAt: placed.startedAt,
      frame: player.frame(BARE),
    });
  }
  return shots;
}

const eyeOf = (pose: CameraPose): RigPoint => cameraRig(pose).eye;
const gap = (a: RigPoint, b: RigPoint): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const riderOf = (frame: SceneFrame, up = 0): RigPoint => {
  const rider = frame.markers[0];
  if (rider === undefined) throw new Error('a frame with no rider');
  return { x: rider.x, y: rider.y + up, z: rider.z };
};

const groundFor = (player: DemoPlayer) =>
  groundOf(
    player.profile,
    corridorOrigin(player.profile),
    scatterSeed(player.profile),
    NO_LAND_CLASS,
  );

/** Two laps of every preset's tour, filmed once for the file. */
const FILMS = new Map(
  DEMO_PRESETS.map((preset) => {
    const player = createDemoPlayer(preset);
    return [preset.id, { player, shots: film(player, 2 * lapSeconds(player.tour)) }] as const;
  }),
);

const filmOf = (preset: DemoPreset) => {
  const found = FILMS.get(preset.id);
  if (found === undefined) throw new Error(`no film of ${preset.id}`);
  return found;
};

/** The shots the reduced-motion test reads frames of. */
const CHECKED_UNDER_REDUCED_MOTION: ReadonlySet<ShotKind> = new Set(['overhead', 'roadside']);

describe('the demo camera tour — #1649', () => {
  it('every preset tour opens behind the rider, has all three shots, and blends for at most 1.5 s', () => {
    expect(BLEND_SECONDS).toBeLessThanOrEqual(1.5);
    for (const preset of DEMO_PRESETS) {
      const shots = DEMO_TOURS[preset.id];
      expect(shots[0]?.kind).toBe('behind');
      expect(new Set(shots.map((shot) => shot.kind))).toEqual(
        new Set(['behind', 'overhead', 'roadside']),
      );
    }
  });

  it('the projection the tests use agrees with camera.ts §riderFrameBox (its control)', () => {
    const { shots } = filmOf(SPRINT_PRESET);
    const first = shots.find((shot) => shot.kind === 'behind' && shot.seconds > 5);
    if (first === undefined) throw new Error('no behind shot');
    const box = riderFrameBox(ASPECT);
    const foot = projectThrough(first.frame.camera, riderOf(first.frame), ASPECT);
    // `riderFrameBox`'s bottom is the rear tyre, a little nearer the eye.
    expect((1 - foot.y) / 2).toBeGreaterThan(box.top);
    expect((1 - foot.y) / 2).toBeLessThan(box.bottom + 0.02);
    expect(Math.abs(foot.x)).toBeLessThan(0.05);
  });

  it(
    'is pure: the same ride gives the same poses, pinned at ten times per preset',
    { timeout: 30_000 },
    () => {
      const pins: Record<string, string> = {};
      for (const preset of DEMO_PRESETS) {
        const { player, shots } = filmOf(preset);
        const lap = lapSeconds(player.tour);
        const poses = Array.from({ length: 10 }, (_, index) => {
          const at = Math.round(((index + 0.5) * lap * 1000) / 10 / FRAME_MS) * FRAME_MS;
          const shot = shots[at / FRAME_MS];
          if (shot === undefined) throw new Error(`no frame at ${at} ms`);
          const pose: Readonly<Record<string, number>> = { ...shot.frame.camera };
          return Object.values(pose).map((value) => value.toFixed(6));
        });
        // A second player, filmed afresh, shoots the same.
        const again = film(createDemoPlayer(preset), lap);
        for (let index = 0; index < 10; index += 1) {
          const at = Math.round(((index + 0.5) * lap * 1000) / 10 / FRAME_MS);
          expect(again[at]?.frame.camera).toEqual(shots[at]?.frame.camera);
        }
        pins[preset.id] = createHash('sha256').update(JSON.stringify(poses)).digest('hex');
      }
      expect(pins).toMatchInlineSnapshot(`
      {
        "climb": "5f45b97c3d48c95886abae4cea8b1e07abbb5ffaba22a92af9d5dec6f6cc6955",
        "group": "53a7e3fe54febde909eba1f2355c203bb13b741db42f54bfb6e2f96cf64b84e2",
        "sprint": "91c00ab7e0a3663019fb67353143d0184fdf6ae2c3eb2abd1fa19b96a109a7d5",
      }
    `);
    },
  );

  it('behind is the product’s chase pose for the same drawn ride, field by field', () => {
    for (const preset of [GROUP_PRESET, SPRINT_PRESET]) {
      const player = createDemoPlayer(preset);
      const origin = corridorOrigin(player.profile);
      const groundAt = groundFor(player);
      for (const riderDistance of [0, 137.25, 905.5]) {
        const input: SceneInput = {
          profile: player.profile,
          origin,
          state: player.state,
          riderDistance,
          remoteRiders: [
            { riderId: 1, distanceMetres: riderDistance + 1, speedMetresPerSecond: 9 },
          ],
        };
        const frame = sceneFrame(input);
        const world: TourWorld = {
          corridor: frame.corridor,
          profile: player.profile,
          origin,
          riderLateral: placedRiders(input, frame.corridor)[0]?.lateral ?? Number.NaN,
          groundAt,
        };
        const pose = cameraAt(player.tour, 3, { riderDistance }, world);
        expect(shotAt(player.tour, 3).shot.kind).toBe('behind');
        for (const field of Object.keys(frame.camera) as (keyof CameraPose)[]) {
          expect(pose[field], field).toBe(frame.camera[field]);
        }
      }
    }
  });

  it('never puts the eye less than 1.5 m over the ground, at any 20 Hz frame of any tour', () => {
    for (const preset of DEMO_PRESETS) {
      const { player, shots } = filmOf(preset);
      const groundAt = groundFor(player);
      let lowest = Number.POSITIVE_INFINITY;
      for (const shot of shots) {
        const eye = eyeOf(shot.frame.camera);
        lowest = Math.min(lowest, eye.y - groundAt(eye.x, eye.z));
      }
      expect(lowest, preset.id).toBeGreaterThanOrEqual(1.5);
    }
  });

  it('reads the ground: on ground far over the road, every shot but the chase rises with it', () => {
    for (const preset of DEMO_PRESETS) {
      const player = createDemoPlayer(preset);
      const { tour, profile } = player;
      const origin = corridorOrigin(profile);
      const real = groundFor(player);
      // A hill 40 m over the drawn ground, everywhere.
      const hill = (x: number, z: number): number => real(x, z) + 40;
      for (let ms = 0; ms <= lapSeconds(tour) * 1000; ms += FRAME_MS) {
        const seconds = ms / 1000;
        const placed = shotAt(tour, seconds);
        const blending =
          placed.shot.into === 'blend' &&
          placed.previous !== undefined &&
          seconds - placed.startedAt < BLEND_SECONDS;
        if (placed.shot.kind === 'behind' && !blending) continue;
        const riderDistance = tour.leadMetres[Math.floor(seconds)] as number;
        const world: TourWorld = {
          corridor: roadCorridor(profile, origin, riderDistance),
          profile,
          origin,
          riderLateral: 0,
          groundAt: hill,
        };
        const eye = eyeOf(cameraAt(tour, seconds, { riderDistance }, world));
        expect(eye.y - hill(eye.x, eye.z), `${preset.id} at ${seconds}`).toBeGreaterThanOrEqual(
          1.5,
        );
      }
    }
  });

  it('overhead keeps the lead rider in the middle third of the frame', () => {
    for (const preset of DEMO_PRESETS) {
      const { shots } = filmOf(preset);
      const overhead = shots.filter(
        (shot) => shot.kind === 'overhead' && shot.seconds - shot.startedAt >= BLEND_SECONDS,
      );
      expect(overhead.length, preset.id).toBeGreaterThan(100);
      for (const shot of overhead) {
        for (const height of [0, RIDER_HEIGHT_METRES]) {
          const at = projectThrough(shot.frame.camera, riderOf(shot.frame, height), ASPECT);
          expect(at.depth).toBeGreaterThan(0);
          expect(Math.abs(at.x), `${preset.id} at ${shot.seconds}`).toBeLessThanOrEqual(1 / 3);
          expect(Math.abs(at.y), `${preset.id} at ${shot.seconds}`).toBeLessThanOrEqual(1 / 3);
        }
      }
    }
  });

  it('roadside stands still, turns to follow the rider, and has them in frame for at least 3 s', () => {
    for (const preset of DEMO_PRESETS) {
      const { shots } = filmOf(preset);
      const starts = [
        ...new Set(shots.filter((s) => s.kind === 'roadside').map((s) => s.startedAt)),
      ];
      expect(starts.length, preset.id).toBeGreaterThanOrEqual(1);
      for (const startedAt of starts) {
        const shot = shots.filter((s) => s.kind === 'roadside' && s.startedAt === startedAt);
        const eyes = shot.map((s) => eyeOf(s.frame.camera));
        const first = eyes[0] as RigPoint;
        for (const eye of eyes) expect(gap(eye, first)).toBeLessThan(1e-9);
        const headings = shot.map((s) =>
          Math.atan2(s.frame.camera.headingX, s.frame.camera.headingZ),
        );
        const turned = Math.max(...headings) - Math.min(...headings);
        expect(turned, `${preset.id} turns`).toBeGreaterThan(Math.PI / 4);
        const seen = shot.filter((s) => {
          const rider = riderOf(s.frame, 1);
          return gap(rider, first) <= 40 && inFrame(projectThrough(s.frame.camera, rider, ASPECT));
        });
        expect(
          seen.length * (FRAME_MS / 1000),
          `${preset.id} at ${startedAt}`,
        ).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('a cut is one frame, and a blend is continuous: no eye moves 2 m between 20 Hz frames', () => {
    for (const preset of DEMO_PRESETS) {
      const { player, shots } = filmOf(preset);
      let blended = 0;
      for (let index = 1; index < shots.length; index += 1) {
        const before = shots[index - 1] as Shot;
        const now = shots[index] as Shot;
        const moved = gap(eyeOf(before.frame.camera), eyeOf(now.frame.camera));
        const entered = now.startedAt !== before.startedAt;
        const shot = shotAt(player.tour, now.seconds).shot;
        if (entered && shot.into === 'cut') continue;
        if (now.seconds - now.startedAt < BLEND_SECONDS && shot.into === 'blend') blended += 1;
        expect(moved, `${preset.id} at ${now.seconds}`).toBeLessThan(2);
      }
      // There were blends to measure.
      expect(blended, preset.id).toBeGreaterThan(20);
      // And one frame into a cut is the new shot itself, not a step towards it.
      const roadside = shots.find((s) => s.kind === 'roadside');
      if (roadside === undefined) throw new Error('no roadside shot');
      const next = shots.find(
        (s) => s.kind === 'roadside' && s.startedAt === roadside.startedAt && s !== roadside,
      );
      expect(gap(eyeOf(roadside.frame.camera), eyeOf((next as Shot).frame.camera))).toBeLessThan(
        1e-9,
      );
    }
  });

  it('a blend is a blend: half way through, the eye is between the two shots', () => {
    const { shots } = filmOf(GROUP_PRESET);
    const into = shots.findIndex((s) => s.kind === 'overhead');
    const halfway = shots[into + Math.round(BLEND_SECONDS / 2 / (FRAME_MS / 1000))] as Shot;
    const at = projectThrough(halfway.frame.camera, riderOf(halfway.frame, 1), ASPECT);
    // Neither the chase camera's framing (rider low) nor overhead's (rider centred).
    expect(Math.abs(at.y)).toBeGreaterThan(0.02);
    const settled = shots[into + Math.round(BLEND_SECONDS / (FRAME_MS / 1000)) + 1] as Shot;
    const centred = projectThrough(settled.frame.camera, riderOf(settled.frame, 1), ASPECT);
    expect(Math.abs(centred.y)).toBeLessThan(1e-6);
  });

  it(
    'under reduced motion there is no blend and no pan: every change of shot is a cut',
    { timeout: 30_000 },
    () => {
      const reduced = reducedMotionTour(planTour(GROUP_PRESET));
      expect(reduced.shots.every((shot) => shot.into === 'cut')).toBe(true);
      for (const preset of DEMO_PRESETS) {
        const player = createDemoPlayer(preset, { reducedMotion: true });
        expect(player.tour.shots.map((shot) => shot.into)).not.toContain('blend');
        // One lap holds every shot of the tour, and only the overhead and
        // roadside frames are read: #1716's coverage run took 46 s filming two
        // laps of every frame of every preset.
        const shots = film(player, lapSeconds(player.tour), CHECKED_UNDER_REDUCED_MOTION);
        expect(shots.some((shot) => shot.kind === 'overhead')).toBe(true);
        expect(shots.some((shot) => shot.kind === 'roadside')).toBe(true);
        for (const shot of shots) {
          if (shot.kind !== 'overhead') continue;
          // From its first frame, overhead is overhead: the rider is centred.
          const at = projectThrough(shot.frame.camera, riderOf(shot.frame, 1), ASPECT);
          expect(Math.abs(at.x) + Math.abs(at.y), `${preset.id} at ${shot.seconds}`).toBeLessThan(
            1e-6,
          );
        }
        for (const shot of shots) {
          if (shot.kind !== 'roadside') continue;
          const first = shots.find((s) => s.startedAt === shot.startedAt) as Shot;
          expect(shot.frame.camera.headingX).toBe(first.frame.camera.headingX);
          expect(shot.frame.camera.headingZ).toBe(first.frame.camera.headingZ);
        }
      }
    },
  );

  it('poseLookingAt is the inverse of cameraRig for any sight that is not vertical', () => {
    const eye = { x: 3, y: 20, z: -4 };
    const look = { x: 10, y: 1, z: 2 };
    const rig = cameraRig(poseLookingAt(eye, look));
    expect(gap(rig.eye, eye)).toBeLessThan(1e-9);
    const along = { x: look.x - eye.x, y: look.y - eye.y, z: look.z - eye.z };
    const seen = { x: rig.target.x - eye.x, y: rig.target.y - eye.y, z: rig.target.z - eye.z };
    const scale = seen.x / along.x;
    expect(seen.y / along.y).toBeCloseTo(scale, 9);
    expect(seen.z / along.z).toBeCloseTo(scale, 9);
    expect(() => poseLookingAt(eye, { ...eye, y: 0 })).toThrow(RangeError);
  });
});
