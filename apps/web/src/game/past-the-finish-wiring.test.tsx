// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * #3336's wiring: a ride on a point-to-point route, ridden past its end
 * through the real `GameView`, the real `GameSimulation` and the real scene.
 *
 * The owner's ruling of 2026-11-26: at the route's end, a finish with *End
 * ride* or *Keep riding*; *Keep riding* rides on along a road drawn on with
 * its scenery, so the world is never empty. What is read back is the question
 * the HUD shows at the line and the frames the renderer was handed past it —
 * for an ordinary ride on a power meter, for the picker's *Preview without a
 * trainer*, and for the address switch's simulated ride, which must all do
 * the same.
 *
 * ⚠️ Every route here is synthetic: a straight line north from 0° 0°.
 */

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  routeProfile,
  watts,
  type RoutePoint,
} from '@onyourleft/domain';

import { END_RIDE_TEXT } from '../ride/EndRideQuestion';
import { mount, queryAll, settle, typeInto, type Mounted } from '../testing/mount';

import { endRideAnswer } from './end-ride-testing';
import { GameView, type GamePort, type RidableRoute } from './GameView';
import type { GameRenderer, SceneFrame } from './port';
import { circuitRoute } from './route-fixtures-testing';
import { NO_SENSORS, type GameSensors } from './sensors';
import type { CorridorPoint } from './terrain';
import { NO_GAME_TRAINER, type GameTrainerPort } from './trainer-port';

/** 400 m north from 0° 0°, level: short, so a ride at 1× reaches its end in a test. */
function shortRoute(): RidableRoute {
  const points: RoutePoint[] = [];
  for (let index = 0; index <= 40; index += 1) {
    points.push({
      position: geographicPosition(degreesLatitude((index * 10) / 111_320), degreesLongitude(0)),
      elevation: altitudeMetres(20),
    });
  }
  return { id: 'route-short', name: 'A short road', profile: routeProfile(points), attempts: 0 };
}

const ROUTE = shortRoute();
const END: number = ROUTE.profile.totalDistance;
const POWER = 250;

const PEDALLING: GameSensors = {
  rider: { power: watts(POWER), live: true, paired: true },
  cadence: { value: 88, live: true, paired: true },
  heartRate: { value: 142, live: true, paired: true },
};

function gamePort(sensors: GameSensors = NO_SENSORS, route: RidableRoute = ROUTE): GamePort {
  return {
    listRoutes: () => Promise.resolve([route]),
    loadGhost: () => Promise.resolve(undefined),
    readSensors: () => sensors,
  };
}

/** What the renderer was handed, with the odometer `sceneFrame` was asked at. */
interface Drawn {
  readonly odometer: number;
  readonly frame: SceneFrame;
}

const built = vi.hoisted((): { readonly odometer: number }[] => []);
vi.mock('./scene', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./scene')>();
  return {
    ...actual,
    sceneFrame: (...args: Parameters<typeof actual.sceneFrame>) => {
      built.push({ odometer: args[0].state.ride.distance });
      return actual.sceneFrame(...args);
    },
  };
});

function capturingRenderer(frames: Drawn[]): GameRenderer {
  return {
    loadRealisticWorld: () => Promise.reject(new Error('no realistic world was chosen')),
    create: () => ({
      hasContext: true,
      prepare: () => Promise.resolve(),
      render: (frame: SceneFrame) => {
        frames.push({ odometer: built.at(-1)?.odometer ?? Number.NaN, frame });
      },
      setQuality: () => undefined,
      setRiderKit: () => undefined,
      setSeason: () => undefined,
      resize: () => undefined,
      destroy: () => undefined,
    }),
  };
}

let pending: FrameRequestCallback[] = [];
let nowMs = 1_000_000;
let mounted: Mounted | undefined;
let drawn: Drawn[] = [];

beforeEach(() => {
  pending = [];
  nowMs = 1_000_000;
  built.length = 0;
  drawn = [];
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
  globalThis.location.hash = '';
});

async function clickThrough(element: HTMLElement | undefined): Promise<void> {
  expect(element).toBeDefined();
  await act(async () => {
    element?.click();
    await Promise.resolve();
  });
  await settle();
}

function buttonStarting(words: string): HTMLButtonElement | undefined {
  return queryAll<HTMLButtonElement>(mounted?.container ?? document, 'button').find((button) =>
    (button.textContent ?? '').startsWith(words),
  );
}

const FRAME_MS = 500;

/** Run frames until `until` holds, or `most` have run. */
async function pumpUntil(until: () => boolean, most: number): Promise<void> {
  for (let index = 0; index < most && !until(); index += 1) {
    const next = pending.shift();
    if (next === undefined) return;
    nowMs += FRAME_MS;
    await act(async () => {
      next(nowMs);
      await Promise.resolve();
      await Promise.resolve();
    });
  }
  await settle();
}

async function open(hash: string, port: GamePort, trainer?: GameTrainerPort): Promise<void> {
  globalThis.location.hash = hash;
  mounted = await mount(
    <GameView
      port={port}
      trainer={trainer}
      renderer={() => Promise.resolve(capturingRenderer(drawn))}
      now={() => nowMs}
    />,
  );
  await settle();
}

/** An ordinary ride, or the address switch's simulated one, from Ride. */
async function rideFromRide(
  hash: string,
  port: GamePort,
  trainer?: GameTrainerPort,
): Promise<void> {
  await open(hash, port, trainer);
  await clickThrough(buttonStarting('Ride '));
}

/** The picker's *Preview without a trainer*, at `speedup`. */
async function rideAPreview(speedup: 1 | 2 | 4 | 8): Promise<void> {
  await open('#/game', gamePort());
  const container = mounted?.container ?? document.body;
  const box = container.querySelector<HTMLInputElement>('.oyl-chooser__preview input[type=number]');
  expect(box).not.toBeNull();
  if (box !== null) await typeInto(box, String(POWER));
  const choice = queryAll<HTMLLabelElement>(container, '.oyl-chooser__preview label').find(
    (label) => label.textContent === `${String(speedup)}×`,
  );
  await clickThrough(choice);
  await clickThrough(buttonStarting('Preview '));
  for (let index = 0; index < 5; index += 1) await settle();
}

/** What the HUD's one live region says. */
function hudRegion(): string {
  return document.querySelector('[data-oyl-announcer="hud"]')?.textContent ?? '';
}

/** A trainer port with a savable recording under the ride, so the question can discard. */
function recordingTrainer(): GameTrainerPort {
  return {
    readTrainer: () => NO_GAME_TRAINER,
    askForControlOnRide: () => Promise.resolve(),
    workoutRescue: () => undefined,
    recordingMayStop: () => false,
    gameRideEnded: () => undefined,
    rideMovingSeconds: () => undefined,
    watchRide: () => () => undefined,
    rideRecording: () => ({ savable: true }),
    saveRideRecording: () => Promise.resolve(),
    discardRideRecording: () => Promise.resolve(true),
  };
}

/** The end-of-ride question on screen, or `null`. */
function question(): HTMLElement | null {
  return (mounted?.container ?? document).querySelector<HTMLElement>('[data-oyl-end-ride]');
}

function answersOffered(): string[] {
  return queryAll<HTMLButtonElement>(question() ?? document.createElement('div'), 'button').map(
    (button) => (button.textContent ?? '').trim(),
  );
}

/** The furthest the renderer was handed a frame. */
function furthest(): number {
  return Math.max(0, ...drawn.map((each) => each.odometer));
}

/** How far the drawn road reaches, end to end, in metres. */
function roadReach(frame: SceneFrame): number {
  const centre = frame.corridor.centre;
  let length = 0;
  for (let index = 1; index < centre.length; index += 1) {
    const here = centre[index - 1] as CorridorPoint;
    const next = centre[index] as CorridorPoint;
    length += Math.hypot(next.x - here.x, next.z - here.z);
  }
  return length;
}

/** Every frame drawn at least `past` metres past the end draws a road and scenery. */
function expectAWorldPastTheEnd(past: number): void {
  const beyond = drawn.filter((each) => each.odometer >= END + past);
  expect(beyond.length).toBeGreaterThan(0);
  for (const { frame } of beyond) {
    expect(roadReach(frame)).toBeGreaterThan(400);
    expect(frame.scatter.length).toBeGreaterThan(0);
  }
}

/** Rides on to `past` metres past the end, then checks the finish's question and the world. */
async function expectTheFinish(): Promise<void> {
  await pumpUntil(() => furthest() >= END + 60, 400);
  expect(furthest()).toBeGreaterThanOrEqual(END + 60);
  // The finish: the question, labelled as the finish, with nothing recorded to save.
  expect(question()?.getAttribute('aria-label')).toBe(END_RIDE_TEXT.finishLabel);
  expect(answersOffered()).toEqual([END_RIDE_TEXT.keep, END_RIDE_TEXT.end]);
  // Opened by the line, not a press: focus was not moved into it.
  expect(question()?.contains(document.activeElement)).toBe(false);
  // …so the HUD's one live region is the only thing that says it appeared.
  expect(hudRegion()).toBe(`${END_RIDE_TEXT.finishLabel} ${END_RIDE_TEXT.askNotRecorded}`);
  // …and the ride rode on into a world.
  expectAWorldPastTheEnd(50);
}

describe('a ride past a point-to-point route’s end — #3336', () => {
  it('an ordinary ride: finishes with End ride or Keep riding, and rides on into a world', async () => {
    await rideFromRide('#/game', gamePort(PEDALLING));
    await expectTheFinish();

    // Keep riding: the question goes, and the ride rides on along the road drawn on.
    await clickThrough(endRideAnswer(mounted?.container ?? document, 'Keep riding'));
    expect(question()).toBeNull();
    const kept = furthest();
    await pumpUntil(() => furthest() >= kept + 80, 200);
    expect(furthest()).toBeGreaterThanOrEqual(kept + 80);
    expect(question()).toBeNull();
    expectAWorldPastTheEnd(50);
  });

  it('the picker’s Preview: the same finish, and End ride ends it', async () => {
    await rideAPreview(8);
    await expectTheFinish();

    await clickThrough(endRideAnswer(mounted?.container ?? document, 'End ride'));
    expect(question()).toBeNull();
    expect(buttonStarting('Ride ')).toBeDefined();
  });

  it('the address switch’s simulated ride: the same finish', async () => {
    await rideFromRide(`#/game?simulate=${String(POWER)}&at=${String(END - 30)}`, gamePort());
    await expectTheFinish();
  });

  it('asks nothing short of the end — the control', async () => {
    await rideFromRide('#/game', gamePort(PEDALLING));
    await pumpUntil(() => furthest() >= END - 60, 400);
    expect(furthest()).toBeGreaterThanOrEqual(END - 60);
    expect(furthest()).toBeLessThan(END);
    expect(question()).toBeNull();
  });

  it('asks nothing at a loop’s line, which it carries on round', async () => {
    const loop: RidableRoute = {
      id: 'route-loop',
      name: 'A small loop',
      profile: circuitRoute(40),
      attempts: 0,
    };
    expect(loop.profile.loop).toBe(true);
    const lap: number = loop.profile.totalDistance;
    await rideFromRide('#/game', gamePort(PEDALLING, loop));
    await pumpUntil(() => furthest() >= lap + 60, 400);
    expect(furthest()).toBeGreaterThanOrEqual(lap + 60);
    expect(question()).toBeNull();
  });

  it('never resets a question the rider already has open: the Discard step stays when the line is crossed', async () => {
    await rideFromRide('#/game', gamePort(PEDALLING), recordingTrainer());
    await pumpUntil(() => furthest() >= END - 60, 400);
    expect(furthest()).toBeLessThan(END);
    // Short of the line, the rider opens End ride, and goes on to Discard.
    await clickThrough(buttonStarting('End ride'));
    await clickThrough(endRideAnswer(mounted?.container ?? document, 'Discard ride'));
    expect(question()?.getAttribute('data-oyl-end-ride')).toBe('discard');
    // …and the ride, which asking changed nothing of, crosses the line.
    await pumpUntil(() => furthest() >= END + 60, 400);
    expect(furthest()).toBeGreaterThanOrEqual(END + 60);
    expect(question()?.getAttribute('data-oyl-end-ride')).toBe('discard');
    expect(question()?.getAttribute('aria-label')).toBe(END_RIDE_TEXT.discardLabel);
  });
});
