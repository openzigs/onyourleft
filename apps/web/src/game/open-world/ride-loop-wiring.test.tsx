// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * #2982 through the real game screen: an open-world ride ridden **past its
 * first view**, on hilly synthetic streets, with a trainer that takes the
 * road's grade. Everything is read back from what a consumer was handed —
 * the profile and distances `sceneFrame` was given each frame, and the grades
 * the trainer was asked for — never from the road itself.
 *
 * The session is a double that hands over a rolling route on
 * `@onyourleft/domain/rolling-testing`'s grid, because the map archive's
 * fixture is flat until #2899 reads heights, and a flat road would write one
 * grade for the whole ride. The game, the simulation, the road follower, the
 * gradient session and the trainer port are the product's.
 */

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  RollingRoute,
  distanceBetween,
  gradeAt,
  metres,
  positionAt,
  watts,
  type GeographicPosition,
  type RollingEdge,
} from '@onyourleft/domain';
import { gridGraph, roughGround } from '@onyourleft/domain/rolling-testing';
import type { SimulationParameters } from '@onyourleft/sensors/protocol';

import { mount, queryAll, settle, type Mounted } from '../../testing/mount';
import { GameView, type GamePort } from '../GameView';
import type { GameRenderer } from '../port';
import type { SceneInput } from '../scene';
import { gameTrainerPortOver, type GameTrainerPort, type GradientTrainer } from '../trainer-port';
import { fixtureStart, START_COLUMN, START_ROW } from './fixture-testing';
import { OPEN_WORLD_ROUTE_ID, type OpenWorldSessions } from './ride';
import { OpenWorldRoad } from './road';

const inputs: SceneInput[] = [];

vi.mock('../scene', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../scene')>();
  return {
    ...actual,
    sceneFrame: (input: SceneInput) => {
      inputs.push(input);
      return actual.sceneFrame(input);
    },
  };
});

/** Half a second a frame: the ride is long, and the simulation's fixed step is not the frame. */
const FRAME_MS = 2_000;

let pending: FrameRequestCallback[] = [];
let nowMs = 0;
let mounted: Mounted | undefined;

beforeEach(() => {
  inputs.length = 0;
  pending = [];
  nowMs = 0;
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

async function pump(): Promise<void> {
  const next = pending.shift();
  if (next === undefined) return;
  nowMs += FRAME_MS;
  await act(async () => {
    next(nowMs);
    await Promise.resolve();
  });
}

function capturingRenderer(): GameRenderer {
  return {
    loadRealisticWorld: () => Promise.reject(new Error('no realistic world was chosen')),
    create: () => ({
      hasContext: true,
      prepare: () => Promise.resolve(),
      render: () => undefined,
      setQuality: () => undefined,
      setRiderKit: () => undefined,
      setSeason: () => undefined,
      resize: () => undefined,
      destroy: () => undefined,
    }),
  };
}

/** A grid of hilly streets, spaced unevenly, ridden east from its corner along row 3. */
function hillyRoute(): RollingRoute {
  const { graph, edges } = gridGraph(
    [0, 180, 410, 600, 870, 1_050, 1_330, 1_520, 1_790, 2_000, 2_260, 2_450],
    [0, 230, 400, 650, 820, 1_090, 1_280, 1_510],
    roughGround,
    3,
  );
  return new RollingRoute(graph, edges.find((edge) => edge.id === 'h0,3') as RollingEdge);
}

/** The game port's open-world sessions: one start, ready at once on {@link hillyRoute}. */
function sessions(): OpenWorldSessions {
  let start = fixtureStart(START_COLUMN, START_ROW) as ReturnType<typeof fixtureStart> | undefined;
  return {
    take: () => {
      const taken = start;
      start = undefined;
      return taken;
    },
    open: () => ({
      ready: Promise.resolve({
        kind: 'ready' as const,
        route: {
          id: OPEN_WORLD_ROUTE_ID,
          name: 'Open world',
          profile: hillyRoute().view(),
          attempts: 0,
        },
        road: () => new OpenWorldRoad(hillyRoute()),
      }),
      stop: () => undefined,
    }),
  };
}

/** A trainer that takes the road, and keeps every grade it was asked for with the frame it came on. */
function trainer(written: { readonly grade: number; readonly frame: number }[]): GameTrainerPort {
  const facts = { paired: true, controllable: true, canSimulate: true, hasControl: true };
  const control: GradientTrainer = {
    setSimulationParameters: (parameters: SimulationParameters) => {
      written.push({ grade: parameters.grade, frame: inputs.length });
      return Promise.resolve();
    },
    letGo: () => Promise.resolve({ kind: 'stopped' as const }),
  };
  return gameTrainerPortOver({
    getSnapshot: () => ({ trainer: facts, workout: undefined }),
    simulationControl: () => control,
    requestTrainerControl: () => Promise.resolve(),
    noteGameRideEnded: () => undefined,
    subscribe: () => () => undefined,
  });
}

function port(): GamePort {
  return {
    listRoutes: () => Promise.resolve([]),
    loadGhost: () => Promise.resolve(undefined),
    readSensors: () => ({
      rider: { power: watts(300), live: true, paired: true },
      cadence: { value: 90, live: true, paired: true },
      heartRate: { value: 140, live: true, paired: true },
    }),
    openWorld: sessions(),
  };
}

function rideButton(): HTMLButtonElement | undefined {
  return queryAll<HTMLButtonElement>(mounted?.container ?? document, 'button').find((button) =>
    (button.textContent ?? '').startsWith('Ride '),
  );
}

/** Where the scene put the rider's odometer, as a place. */
function placeOf(input: SceneInput): GeographicPosition {
  return positionAt(input.profile, input.state.ride.distance);
}

describe('an open-world ride past its first view — #2982', () => {
  it('rides on through new views of the road with a moving origin, the rider never jumping, and the trainer on the road’s grade', async () => {
    const written: { grade: number; frame: number }[] = [];
    mounted = await mount(
      <GameView
        port={port()}
        trainer={trainer(written)}
        renderer={() => Promise.resolve(capturingRenderer())}
        now={() => nowMs}
      />,
    );
    for (let tries = 0; tries < 50 && rideButton()?.textContent !== 'Ride Open world'; tries++) {
      await settle();
    }
    expect(rideButton()?.textContent).toBe('Ride Open world');
    await act(async () => {
      rideButton()?.click();
      await Promise.resolve();
    });
    await settle();
    const firstView = () => inputs[0]?.profile;
    for (let frames = 0; frames < 400; frames += 1) {
      const last = inputs[inputs.length - 1];
      // Past the first view's 2 km, and past a second advance of the road.
      if (last !== undefined && last.profile !== firstView() && views() >= 3 && moved() > 1_500)
        break;
      await pump();
    }

    function views(): number {
      return new Set(inputs.map((input) => input.profile)).size;
    }
    function moved(): number {
      const last = inputs[inputs.length - 1];
      const first = firstView();
      if (last === undefined || first === undefined) return 0;
      // How far the view's distance zero is from the first view's: the origin.
      return distanceBetween(
        last.profile.positions[0] as GeographicPosition,
        first.positions[0] as GeographicPosition,
      );
    }

    expect(views()).toBeGreaterThanOrEqual(3);
    expect(moved()).toBeGreaterThan(1_500);
    // Frame to frame, the rider moved by the distance ridden, at most 90 km/h
    // down these hills — never by the kilometres between two views' origins,
    // which is what a distance read on the wrong view would be.
    let travelled = 0;
    for (let index = 1; index < inputs.length; index += 1) {
      const before = inputs[index - 1] as SceneInput;
      const after = inputs[index] as SceneInput;
      const step = distanceBetween(placeOf(before), placeOf(after));
      expect(step, `frame ${index}`).toBeLessThan(25 * (FRAME_MS / 1000));
      travelled += step;
    }
    expect(travelled).toBeGreaterThan(2_500);
    // The drawn rider is on the same view, within a step of the odometer.
    for (const input of inputs) {
      expect(
        distanceBetween(
          placeOf(input),
          positionAt(input.profile, metres(input.riderDistance ?? 0)),
        ),
      ).toBeLessThan(15);
    }
    // The simulation's grade is the view's at the rider: the hill the physics
    // rode is the hill drawn.
    for (const input of inputs) {
      expect(
        Math.abs(
          (input.state.grade as number) -
            (gradeAt(input.profile, input.state.ride.distance) as number),
        ),
      ).toBeLessThan(1e-6);
    }
    // The HUD reads the same view at the same distance: part of the way along
    // it, never the end of it, which is where the ride distance on a view a
    // kilometre and more behind would put it.
    const strip = queryAll(mounted.container, '[aria-label^="Route profile"]')[0];
    const percent = Number(/(\d+) per cent/.exec(strip?.getAttribute('aria-label') ?? '')?.[1]);
    expect(percent).toBeGreaterThan(10);
    expect(percent).toBeLessThan(90);
    // And each grade the trainer was asked for is the road's at the rider on
    // the view drawn that frame or the one before: the same road, read at the
    // same distance, past the first view as before it.
    const pastFirst = written.filter((write) => inputs[write.frame - 1]?.profile !== firstView());
    expect(pastFirst.length).toBeGreaterThan(5);
    for (const write of written) {
      const near = [inputs[write.frame - 1], inputs[write.frame]].filter(
        (input): input is SceneInput => input !== undefined,
      );
      const off = Math.min(
        ...near.map((input) =>
          Math.abs((gradeAt(input.profile, input.state.ride.distance) as number) - write.grade),
        ),
      );
      expect(off, `the write on frame ${write.frame}`).toBeLessThan(1e-6);
    }
  });
});
