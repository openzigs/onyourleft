// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The gradient a trainer is sent through a one-point turnaround — #3104.
 *
 * On the owner's tablet, just after the one-point 174° turnaround of a short
 * coast route, the HUD said "The trainer refused that gradient. The next one
 * will be sent again." with the gradient reading −0.5 % (+2.7 % before the
 * turn). Neither the value nor the machine's answer was recorded anywhere a
 * person could read, so nothing could say whether the refusal was ours.
 *
 * Two halves. The first rides the real `GameView` through such a turnaround
 * — +2.7 % up to a single vertex, 174° there, −0.5 % back — and reads every
 * gradient the trainer was handed through the real wire encoder: each finite,
 * inside the protocol client's ±40 %, signed as the road is, and no further
 * from the road's own grade at the rider than the deadband. That is the grade
 * path, and on this route it is clean. The second makes the next refusal say
 * which: a refusal from the real protocol client puts the gradient and the
 * machine's FTMS answer, or Bluetooth's, in the sentence the HUD shows.
 *
 * Arithmetic only: no coordinates or names of the owner's route.
 */

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  gradeAt,
  routeProfile,
  seconds,
  watts,
  type RoutePoint,
} from '@onyourleft/domain';
import {
  createTrainerControl,
  encodeControlRequest,
  MAX_PLAUSIBLE_GRADE_PERCENT,
  type FitnessMachineChannel,
  type SimulationParameters,
} from '@onyourleft/sensors/protocol';

import { GameView, type GamePort, type RidableRoute } from './GameView';
import { createGradientSession } from './gradient';
import type { GameRenderer, SceneFrame } from './port';
import { gameTrainerPortOver, type GameTrainerPort, type GradientTrainer } from './trainer-port';
import { mount, queryAll, settle, type Mounted } from '../testing/mount';

/**
 * The ride distance `GameView` last offered the gradient session: the real
 * session, every call passed through, so a write can be read against the road
 * where the rider was when it was offered.
 */
const offeredAt = vi.hoisted(() => ({ distance: 0 }));
vi.mock('./gradient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./gradient')>();
  return {
    ...actual,
    createGradientSession: (options: Parameters<typeof actual.createGradientSession>[0]) => {
      const session = actual.createGradientSession(options);
      return {
        ...session,
        sample: (...args: Parameters<typeof session.sample>) => {
          offeredAt.distance = args[1];
          session.sample(...args);
        },
      };
    },
  };
});

const METRES_PER_DEGREE_LATITUDE = 111_320;

/** How far the way out runs before it turns. */
const LEG_METRES = 300;

/**
 * North for {@link LEG_METRES} climbing 2.7 %, one vertex, and back 1 m east
 * falling 0.5 %: the first point back is as far from the vertex as turns the
 * road through 174° there.
 */
function reversal(): RidableRoute {
  const metresPerDegreeLongitude = METRES_PER_DEGREE_LATITUDE * Math.cos((51.5 * Math.PI) / 180);
  const points: RoutePoint[] = [];
  const push = (north: number, east: number, elevation: number): void => {
    points.push({
      position: geographicPosition(
        degreesLatitude(51.5 + north / METRES_PER_DEGREE_LATITUDE),
        degreesLongitude(-0.12 + east / metresPerDegreeLongitude),
      ),
      elevation: altitudeMetres(elevation),
    });
  };
  for (let north = 0; north <= LEG_METRES; north += 10) push(north, 0, 10 + 0.027 * north);
  const top = 10 + 0.027 * LEG_METRES;
  for (let north = LEG_METRES - 1 / Math.tan((6 * Math.PI) / 180); north >= 0; north -= 10) {
    push(north, 1, top - 0.005 * (LEG_METRES - north));
  }
  return {
    id: 'route-reversal',
    name: 'Test reversal',
    profile: routeProfile(points, { loop: false }),
    attempts: 0,
  };
}

function pedallingPort(route: RidableRoute): GamePort {
  return {
    listRoutes: () => Promise.resolve([route]),
    loadGhost: () => Promise.resolve(undefined),
    readSensors: () => ({
      rider: { power: watts(300), live: true, paired: true },
      cadence: { value: 88, live: true, paired: true },
      heartRate: { value: 142, live: true, paired: true },
    }),
  };
}

function capturingRenderer(frames: SceneFrame[]): GameRenderer {
  return {
    loadRealisticWorld: () => Promise.reject(new Error('no realistic world was chosen')),
    create: () => ({
      hasContext: true,
      prepare: () => Promise.resolve(),
      render: (frame: SceneFrame) => {
        frames.push(frame);
      },
      setQuality: () => undefined,
      setRiderKit: () => undefined,
      setSeason: () => undefined,
      resize: () => undefined,
      destroy: () => undefined,
    }),
  };
}

/** Each write, with the rider's distance on the frame it was offered. */
interface Written {
  readonly parameters: SimulationParameters;
  readonly distance: number;
}

/** A trainer port built as `main.tsx` builds one, over a controller double that records. */
function trainerPort(written: Written[], distance: () => number): GameTrainerPort {
  const control: GradientTrainer = {
    setSimulationParameters: async (parameters) => {
      written.push({ parameters, distance: distance() });
      return Promise.resolve();
    },
    letGo: async () => Promise.resolve({ kind: 'stopped' as const }),
  };
  return gameTrainerPortOver({
    getSnapshot: () => ({
      trainer: { paired: true, controllable: true, canSimulate: true, hasControl: true },
      workout: undefined,
    }),
    simulationControl: () => control,
    requestTrainerControl: async () => Promise.resolve(),
    noteGameRideEnded: () => undefined,
    subscribe: () => () => undefined,
  });
}

let pending: FrameRequestCallback[] = [];
let nowMs = 0;
let mounted: Mounted | undefined;

beforeEach(() => {
  offeredAt.distance = 0;
  pending = [];
  nowMs = 1_000_000;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    pending.push(callback);
    return pending.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
});

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  vi.unstubAllGlobals();
});

/** A quarter second a frame: four samples to each of the driver's one-second writes. */
const FRAME_MS = 250;

describe('the gradient sent through a one-point turnaround — #3104', () => {
  it('sends only finite grades inside the clamp, the road’s own, both sides of the turn', async () => {
    const route = reversal();
    const turn = route.profile.totalDistance / 2;
    const written: Written[] = [];
    const frames: SceneFrame[] = [];
    mounted = await mount(
      <GameView
        port={pedallingPort(route)}
        trainer={trainerPort(written, () => offeredAt.distance)}
        renderer={() => Promise.resolve(capturingRenderer(frames))}
        now={() => nowMs}
      />,
    );
    await settle();
    const ride = queryAll<HTMLButtonElement>(mounted.container, 'button').find((button) =>
      (button.textContent ?? '').startsWith('Ride '),
    );
    await act(async () => {
      ride?.click();
      await Promise.resolve();
    });
    await settle();
    // Up to the turn and 150 m back, a frame at a time.
    for (let frame = 0; frame < 2_000; frame += 1) {
      const next = pending.shift();
      if (next === undefined) break;
      nowMs += FRAME_MS;
      await act(async () => {
        next(nowMs);
        await Promise.resolve();
        await Promise.resolve();
      });
      if (offeredAt.distance > turn + 150) break;
    }
    await settle();

    // Clear of the profile's gradient windows (`route/profile.ts`): filling
    // from the start, and spanning the turn.
    const before = written.filter((write) => write.distance > 60 && write.distance < turn - 40);
    const after = written.filter((write) => write.distance > turn + 40);
    // Non-vacuity: the ride went round the turn, and was written to both sides of it.
    // (A steady grade is written once: the driver's deadband.)
    expect(before.length).toBeGreaterThan(0);
    expect(after.length).toBeGreaterThan(0);
    expect(written.length).toBeGreaterThan(10);
    for (const { parameters, distance } of written) {
      const { grade } = parameters;
      const at = `${grade.toFixed(2)} % at ${(distance - turn).toFixed(0)} m from the turn`;
      expect(Number.isFinite(grade), at).toBe(true);
      expect(Math.abs(grade), at).toBeLessThanOrEqual(MAX_PLAUSIBLE_GRADE_PERCENT);
      // The wire's own encoder takes it: it refuses what its field cannot carry.
      expect(
        () => encodeControlRequest({ opCode: 'set-simulation-parameters', parameters }),
        at,
      ).not.toThrow();
    }
    // Signed as the road is: a climb up to the turn and a descent from it.
    for (const { parameters } of before) expect(parameters.grade).toBeGreaterThan(2);
    for (const { parameters } of after) expect(parameters.grade).toBeLessThan(0);
    // And the road's own grade where the rider was when it was offered, to
    // within the profile's change over a frame's riding and the deadband.
    for (const { parameters, distance } of written) {
      expect(
        Math.abs(parameters.grade - gradeAt(route.profile, distance)),
        `${(distance - turn).toFixed(0)} m from the turn`,
      ).toBeLessThan(0.6);
    }
  });
});

describe('a refused gradient says which, and what refused it — #3104', () => {
  /**
   * The real protocol client over a channel that answers every Set Indoor
   * Bike Simulation Parameters with `result`, and grants control.
   */
  async function clientAnswering(
    simulation: number | 'att-error',
  ): Promise<ReturnType<typeof createTrainerControl>> {
    const listeners: ((value: DataView) => void)[] = [];
    const channel: FitnessMachineChannel = {
      enableControlPointIndications: () => Promise.resolve(),
      onControlPointIndication: (listener) => {
        listeners.push(listener);
        return () => undefined;
      },
      onStatus: () => () => undefined,
      writeControlPoint: (value) => {
        const op = value[0] as number;
        if (op === 0x11 && simulation === 'att-error') {
          return Promise.reject(new Error('GATT write failed'));
        }
        const result = op === 0x11 ? (simulation as number) : 0x01;
        queueMicrotask(() => {
          for (const listener of listeners) {
            listener(new DataView(Uint8Array.of(0x80, op, result).buffer));
          }
        });
        return Promise.resolve();
      },
    };
    const client = createTrainerControl(channel, {
      powerRange: { minimum: watts(0), maximum: watts(2_000), increment: watts(1) },
    });
    await client.requestControl();
    return client;
  }

  it.each([
    [0x03, 'it answered “invalid parameter”'],
    [0x04, 'it answered “operation failed”'],
    [0x02, 'it answered “not supported”'],
    [0x07, 'it answered with a code FTMS does not define'],
    ['att-error', 'Bluetooth refused the write'],
  ] as const)('names the gradient and the answer: %s', async (answer, words) => {
    const client = await clientAnswering(answer);
    const route = reversal();
    const session = createGradientSession({ profile: route.profile, control: client });
    const turn = route.profile.totalDistance / 2;
    // Just after the turn, where the road falls 0.5 %.
    session.sample(seconds(1), turn + 60);
    await session.settled();
    const asked = gradeAt(route.profile, turn + 60);
    expect(session.state().fault).toBe(
      `The trainer refused that gradient, ${asked.toFixed(1)} % (${words}). The next one will be sent again.`,
    );
  });
});
