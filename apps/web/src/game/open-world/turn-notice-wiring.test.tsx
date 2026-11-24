// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * #3058 through the real game screen: what an open-world ride shows and says
 * about a turn that is not a junction's choice.
 *
 * - **A U-turn** shows *Turning round* in the junction's pop-up (#3053) and
 *   says it, and a second press while it stands is harmless: a double press is
 *   one U-turn, not a U-turn and its undoing.
 * - **Left with no junction near** shows and says *No junction yet*, and
 *   chooses nothing.
 * - **A dead end** that turns the rider round by itself (ADR 0088 D-1.7)
 *   shows and says *Dead end: turning round*.
 *
 * Read back from what a consumer was handed: the pop-up the HUD drew, the
 * sentences its one live region said, the places `sceneFrame` put the rider,
 * and the grades the trainer was asked for, which no press changes. The
 * session is a double that hands over a rolling route on
 * `@onyourleft/domain/rolling-testing`'s grid, as `junction-wiring.test.tsx`'s
 * does; the game, the simulation, the road, the junction choice, the pop-up
 * and the trainer port are the product's.
 */

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  RollingRoute,
  distanceBetween,
  positionAt,
  watts,
  type GeographicPosition,
  type RollingEdge,
} from '@onyourleft/domain';
import { gridGraph, placeAt, roughGround } from '@onyourleft/domain/rolling-testing';
import type { SimulationParameters } from '@onyourleft/sensors/protocol';

import { mount, queryAll, settle, type Mounted } from '../../testing/mount';
import { GameView, type GamePort } from '../GameView';
import type { GameRenderer } from '../port';
import type { SceneInput } from '../scene';
import { ANNOUNCEMENTS_STORAGE_KEY, DEFAULT_ANNOUNCEMENTS } from '../hud/announce-preference';
import { TURN_NOTICE_WORDS } from '../hud/junction-text';
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

/** Half a second a frame: a 2 s notice stands for four of them. */
const FRAME_MS = 500;

let pending: FrameRequestCallback[] = [];
let nowMs = 0;
let mounted: Mounted | undefined;
/** Everything the HUD's region said, frame by frame. */
const said: string[] = [];

beforeEach(() => {
  inputs.length = 0;
  said.length = 0;
  pending = [];
  nowMs = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    pending.push(callback);
    return pending.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  localStorage.setItem(
    ANNOUNCEMENTS_STORAGE_KEY,
    JSON.stringify({ ...DEFAULT_ANNOUNCEMENTS, enabled: true }),
  );
});

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  localStorage.clear();
  vi.unstubAllGlobals();
});

const spoken = (): string =>
  mounted?.container.querySelector('[data-oyl-announcer="hud"]')?.textContent ?? '';

async function pump(): Promise<void> {
  const next = pending.shift();
  if (next === undefined) return;
  nowMs += FRAME_MS;
  await act(async () => {
    next(nowMs);
    await Promise.resolve();
  });
  said.push(spoken());
}

async function pumpUntil(done: () => boolean, frames = 400): Promise<void> {
  for (let frame = 0; frame < frames && !done(); frame += 1) await pump();
  expect(done()).toBe(true);
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

/** Streets a kilometre apart, ridden east from the corner along row 0: no junction for 750 m. */
function wideGrid(): RollingRoute {
  const { graph, edges } = gridGraph([0, 1_000, 2_000], [0, 1_000], roughGround, 0);
  return new RollingRoute(graph, edges.find((edge) => edge.id === 'h0,0') as RollingEdge);
}

/** One street, 400 m long, with no way on from its far end but back. */
function deadEnd(): RollingRoute {
  const { graph, edges } = gridGraph([0, 400], [0], roughGround);
  return new RollingRoute(graph, edges[0] as RollingEdge);
}

function port(route: () => RollingRoute): GamePort {
  let start = fixtureStart(START_COLUMN, START_ROW) as ReturnType<typeof fixtureStart> | undefined;
  const sessions: OpenWorldSessions = {
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
          profile: route().view(),
          attempts: 0,
        },
        road: () => new OpenWorldRoad(route()),
      }),
      stop: () => undefined,
    }),
  };
  return {
    listRoutes: () => Promise.resolve([]),
    loadGhost: () => Promise.resolve(undefined),
    readSensors: () => ({
      rider: { power: watts(300), live: true, paired: true },
      cadence: { value: 90, live: true, paired: true },
      heartRate: { value: 140, live: true, paired: true },
    }),
    openWorld: sessions,
  };
}

/** A trainer that takes the road, and keeps every grade it was asked for. */
function trainer(written: number[]): GameTrainerPort {
  const facts = { paired: true, controllable: true, canSimulate: true, hasControl: true };
  const control: GradientTrainer = {
    setSimulationParameters: (parameters: SimulationParameters) => {
      written.push(parameters.grade);
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

function rideButton(): HTMLButtonElement | undefined {
  return queryAll<HTMLButtonElement>(mounted?.container ?? document, 'button').find((button) =>
    (button.textContent ?? '').startsWith('Ride '),
  );
}

async function startRide(route: () => RollingRoute, written: number[]): Promise<void> {
  mounted = await mount(
    <GameView
      port={port(route)}
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
}

async function pressKey(key: string): Promise<void> {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, code: key, bubbles: true }));
    await Promise.resolve();
  });
}

/** The notice the pop-up draws, by its kind and its words, or `undefined`. */
function poppedUp(): { readonly kind: string; readonly words: string } | undefined {
  const line = mounted?.container.querySelector<HTMLElement>(
    '.oyl-hud__junction-popup [data-oyl-notice]',
  );
  return line === null || line === undefined
    ? undefined
    : { kind: line.dataset['oylNotice'] ?? '', words: line.textContent ?? '' };
}

/** Where the scene put the rider on the last frame drawn. */
function riderPlace(): GeographicPosition {
  const input = inputs[inputs.length - 1] as SceneInput;
  return positionAt(input.profile, input.state.ride.distance);
}

/** The ride distance on the last frame drawn. */
function ridden(): number {
  const input = inputs[inputs.length - 1] as SceneInput;
  return input.state.ride.distance;
}

describe('an open-world ride says what a turn press did, and what a dead end does — #3058', () => {
  it('shows and says Turning round on a U-turn, and a second press while it stands is harmless', async () => {
    const written: number[] = [];
    await startRide(wideGrid, written);
    await pumpUntil(() => inputs.length > 0 && ridden() > 150);
    const home = placeAt(0, 0);
    const before = distanceBetween(riderPlace(), home);
    const writes = written.length;

    // A double press, as a rider's double tap or a bouncing key sends it.
    await pressKey('ArrowDown');
    await pressKey('ArrowDown');
    expect(written.length, 'a press wrote to the trainer').toBe(writes);
    expect(poppedUp()).toEqual({
      kind: 'turning-round',
      words: TURN_NOTICE_WORDS['turning-round'].shown,
    });
    // Within the announcer's window and the next (`announce.ts`
    // §`ANNOUNCE_WINDOW_SECONDS`): a climb said a moment before holds it.
    await pumpUntil(() => said.includes(TURN_NOTICE_WORDS['turning-round'].said), 14);

    // Turned round once: the rider rides back toward where they started.
    await pumpUntil(() => distanceBetween(riderPlace(), home) < before - 60, 40);
    // And the notice went once it had stood its time.
    await pumpUntil(() => poppedUp() === undefined, 8);
    const sayings = said.filter(
      (sentence, index) =>
        sentence === TURN_NOTICE_WORDS['turning-round'].said && said[index - 1] !== sentence,
    );
    expect(sayings).toHaveLength(1);

    // Once it has gone, a U-turn press turns the rider round again (D-1.6).
    const back = distanceBetween(riderPlace(), home);
    await pressKey('ArrowDown');
    expect(poppedUp()?.kind).toBe('turning-round');
    await pumpUntil(() => distanceBetween(riderPlace(), home) > back + 60, 40);
  });

  it('shows and says No junction yet for a left with no junction near, and chooses nothing', async () => {
    const written: number[] = [];
    await startRide(wideGrid, written);
    await pumpUntil(() => inputs.length > 0 && ridden() > 50);
    expect(
      mounted?.container.querySelector('.oyl-hud__junction-popup button[data-oyl-way]'),
    ).toBeNull();
    const writes = written.length;
    await pressKey('ArrowLeft');
    expect(written.length, 'a press wrote to the trainer').toBe(writes);
    expect(poppedUp()).toEqual({
      kind: 'no-junction',
      words: TURN_NOTICE_WORDS['no-junction'].shown,
    });
    await pumpUntil(() => said.includes(TURN_NOTICE_WORDS['no-junction'].said), 14);
    // Nothing was chosen: on along row 0, straight over the first junction.
    await pumpUntil(() => distanceBetween(riderPlace(), placeAt(1_100, 0)) < 15);
  });

  it('shows and says Dead end: turning round where the road turns the rider round', async () => {
    await startRide(deadEnd, []);
    await pumpUntil(() => poppedUp()?.kind === 'dead-end');
    expect(poppedUp()?.words).toBe(TURN_NOTICE_WORDS['dead-end'].shown);
    expect(ridden()).toBeGreaterThan(390);
    await pumpUntil(() => said.includes(TURN_NOTICE_WORDS['dead-end'].said), 14);
    // Said once, as the turn-round is passed, and never before it.
    const first = said.indexOf(TURN_NOTICE_WORDS['dead-end'].said);
    expect(first).toBeGreaterThan(0);
  });
});
