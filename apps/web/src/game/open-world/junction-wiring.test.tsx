// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * #3013 through the real game screen: an open-world ride is offered its next
 * junction, and the rider turns there by key and by tap, and the ride follows
 * the way chosen (ADR 0088). The junction prompt (#2898) and the junction
 * choice (#2897) were each tested on their own and wired to no ride, so the
 * rolling route took its default at every junction and no rider was ever
 * offered a turn. This is the case that goes red when `GameView` stops handing
 * the HUD its `junction` again: the wiring gate cannot see an optional prop
 * nobody supplies (`wiring-gate.md` §Limits).
 *
 * Everything is read back from what a consumer was handed: the prompt the HUD
 * drew, the sentences its one live region said, the places `sceneFrame` put
 * the rider and the grades the trainer was asked for — never from the route.
 * The session is a double that hands over a rolling route on
 * `@onyourleft/domain/rolling-testing`'s grid, as `ride-loop-wiring.test.tsx`'s
 * does; the game, the simulation, the road, the junction choice, the prompt
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
import { tap } from '../../design/touch-lock-testing';
import { ANNOUNCEMENTS_STORAGE_KEY, DEFAULT_ANNOUNCEMENTS } from '../hud/announce-preference';
import { CONTROLS_HIDE_MILLISECONDS, HIDES_ATTRIBUTE } from '../hud/controls-reveal';
import { JUNCTION_PROMPT_TITLE } from '../hud/junction-text';
import { gameTrainerPortOver, type GameTrainerPort, type GradientTrainer } from '../trainer-port';
import { fixtureStart, START_COLUMN, START_ROW } from './fixture-testing';
import { OPEN_WORLD_ROUTE_ID, type OpenWorldSessions } from './ride';
import { OpenWorldRoad } from './road';
import { pad } from './turn-input-testing';

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

/** Two seconds a frame: at 300 W about 20 m a frame, well inside a prompt's 150 m before its lock. */
const FRAME_MS = 2_000;

const COLUMNS = [0, 180, 410, 600, 870, 1_050, 1_330, 1_520, 1_790, 2_000, 2_260, 2_450];
const ROWS = [0, 230, 400, 650, 820, 1_090, 1_280, 1_510];

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
  // Every junction sentence is said in the HUD's one region (#2898).
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

/** Everything the HUD's region said, frame by frame. */
const said: string[] = [];

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

/**
 * A grid of hilly streets ridden east from its corner along row 3, the major
 * road, so its default at every junction on it is straight on: a turn the
 * ride takes is the rider's, never the default's.
 */
function hillyRoute(): RollingRoute {
  const { graph, edges } = gridGraph(COLUMNS, ROWS, roughGround, 3);
  return new RollingRoute(graph, edges.find((edge) => edge.id === 'h0,3') as RollingEdge);
}

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

/**
 * The prompt's way buttons, from the furthest left to the furthest right: in
 * the junction's pop-up and nowhere else (#3053).
 */
function wayButtons(): HTMLButtonElement[] {
  return queryAll<HTMLButtonElement>(
    mounted?.container ?? document,
    '.oyl-hud__junction-popup button[data-oyl-way]',
  );
}

const wayIds = (): string[] => wayButtons().map((button) => button.dataset['oylWay'] ?? '');

/** The way the prompt shows as chosen. */
const chosen = (): string | undefined =>
  wayButtons().find((button) => button.classList.contains('oyl-hud__junction-way--chosen'))
    ?.dataset['oylWay'];

/** Where the scene put the rider on the last frame drawn: the road the physics rode. */
function riderPlace(): GeographicPosition {
  const input = inputs[inputs.length - 1] as SceneInput;
  return positionAt(input.profile, input.state.ride.distance);
}

/** The closest the rider was drawn to `place` on any frame. */
function closestTo(place: GeographicPosition): number {
  return Math.min(
    ...inputs.map((input) =>
      distanceBetween(positionAt(input.profile, input.state.ride.distance), place),
    ),
  );
}

async function pumpUntil(done: () => boolean, frames = 120): Promise<void> {
  for (let frame = 0; frame < frames && !done(); frame += 1) await pump();
  expect(done()).toBe(true);
}

async function startRide(written: number[]): Promise<void> {
  said.length = 0;
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
}

/** A turn key, as the keyboard or a bar remote sends it. */
async function pressKey(key: string): Promise<void> {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, code: key, bubbles: true }));
    await Promise.resolve();
  });
}

describe('an open-world ride offers its junctions, and turns where the rider chooses — #3013', () => {
  it('turns left by key at one junction and right by tap at the next, the ride following each, and says the prompt', async () => {
    const written: number[] = [];
    await startRide(written);

    // The first junction, 180 m on at column 1, row 3: north, east and south,
    // from the furthest left; offered before its lock, its default straight on.
    await pumpUntil(() => wayIds().length > 0, 5);
    expect(wayIds()).toEqual(['v1,3', 'h1,3', 'v1,2']);
    expect(chosen()).toBe('h1,3');
    expect(wayButtons()[0]?.getAttribute('aria-disabled')).toBeNull();

    // Left, by key. The press is the junction's alone: nothing is written to
    // the trainer by it (ADR 0088 D-5); the grade comes from the road ridden.
    const writesBefore = written.length;
    await pressKey('ArrowLeft');
    expect(written.length).toBe(writesBefore);
    expect(chosen()).toBe('v1,3');

    // Past it, the next junction is offered: north up column 1 to row 4,
    // which only a ride that turned left can be offered.
    await pumpUntil(() => wayIds().includes('v1,4'));
    expect(wayIds()).toEqual(['h0,4', 'v1,4', 'h1,4']);
    expect(chosen()).toBe('v1,4');
    expect(wayButtons()[2]?.getAttribute('aria-disabled')).toBeNull();

    // Right, by a tap on the furthest-right way.
    await act(async () => {
      wayButtons()[2]?.click();
      await Promise.resolve();
    });
    expect(chosen()).toBe('h1,4');

    // And the ride followed both: drawn up column 1 north of row 3, then east
    // along row 4 — places a ride on its defaults never comes within 80 m of.
    const upColumn = placeAt(COLUMNS[1] as number, (ROWS[3] as number) + 85);
    const alongRow = placeAt((COLUMNS[1] as number) + 115, ROWS[4] as number);
    await pumpUntil(() => distanceBetween(riderPlace(), alongRow) < 60);
    await pumpUntil(() => closestTo(alongRow) < 15, 10);
    expect(closestTo(upColumn)).toBeLessThan(15);

    // Said, not only shown: the junction as its prompt appears, a choice as
    // it changes, and each choice as it locks (`hud/junction-text.ts`).
    const heard = said.join('\n');
    expect(heard).toContain(`${JUNCTION_PROMPT_TITLE}: left, straight on or right.`);
    expect(heard).toContain('Junction choice locked: left.');
    expect(heard).toContain('Chosen: right.');
    expect(heard).toContain('Junction choice locked: right.');
    // Each said once, never again once said: the sentences the region moved to, in turn.
    const turns = said.filter((sentence, index) => sentence !== said[index - 1]);
    for (const sentence of [
      'Junction choice locked: left.',
      'Chosen: right.',
      'Junction choice locked: right.',
    ]) {
      expect(
        turns.filter((each) => each === sentence),
        sentence,
      ).toHaveLength(1);
    }
  });

  it('turns right by a pad’s face button', async () => {
    // A standard pad, connected and nothing held, until its right-turn button
    // (face button 1, ADR 0088 D-3) goes down.
    let held: number[] = [];
    Object.defineProperty(navigator, 'getGamepads', {
      configurable: true,
      value: () => [pad('standard', held)],
    });
    try {
      await startRide([]);
      await pumpUntil(() => wayIds().length > 0, 5);
      expect(chosen()).toBe('h1,3');
      held = [1];
      await pumpUntil(() => chosen() === 'v1,2', 4);
      const downColumn = placeAt(COLUMNS[1] as number, (ROWS[3] as number) - 85);
      await pumpUntil(() => closestTo(downColumn) < 15);
    } finally {
      Reflect.deleteProperty(navigator, 'getGamepads');
    }
  });

  /**
   * #3053: the prompt was drawn in the ride controls' panel, which fades and
   * is clipped after `CONTROLS_HIDE_MILLISECONDS` with no touch, and a rider
   * who was not touching the screen did not see the junction coming. It is a
   * pop-up of the HUD's own now: drawn whatever the wait, and its first tap
   * takes the way, up to the lock.
   */
  it('keeps the pop-up drawn and pressable with no touch for longer than the fade, up to the lock', async () => {
    // From the first render, so the controls' wait is one this test can run.
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'clearTimeout'] });
    try {
      await startRide([]);
      await pumpUntil(() => wayIds().length > 0, 5);
      await act(async () => {
        vi.advanceTimersByTime(CONTROLS_HIDE_MILLISECONDS + 500);
        await Promise.resolve();
      });
      const hud = mounted?.container.querySelector('.oyl-hud');
      expect(hud?.getAttribute('data-oyl-controls')).toBe('hidden');
      const drawn = (): void => {
        const popup = mounted?.container.querySelector('.oyl-hud__junction-popup');
        expect(popup?.parentElement).toBe(hud);
        for (const way of wayButtons()) {
          expect(popup?.contains(way)).toBe(true);
          expect(way.closest(`[${HIDES_ATTRIBUTE}], .oyl-hud__actions`)).toBeNull();
        }
      };
      drawn();
      // The first tap, a finger's, takes the furthest-left way.
      tap(wayButtons()[0] as HTMLButtonElement);
      expect(chosen()).toBe('v1,3');
      // And it stays drawn, with no touch, until the choice is final.
      await act(async () => {
        vi.advanceTimersByTime(CONTROLS_HIDE_MILLISECONDS + 500);
        await Promise.resolve();
      });
      expect(hud?.getAttribute('data-oyl-controls')).toBe('hidden');
      await pumpUntil(() => {
        drawn();
        return wayButtons()[0]?.getAttribute('aria-disabled') === 'true';
      });
      expect(chosen()).toBe('v1,3');
    } finally {
      vi.useRealTimers();
    }
  });

  it('rides its default straight on where the rider presses nothing', async () => {
    await startRide([]);
    await pumpUntil(() => wayIds().length > 0, 5);
    expect(chosen()).toBe('h1,3');
    // On along row 3, past column 2's junction: never up column 1.
    const onRow = placeAt((COLUMNS[2] as number) + 60, ROWS[3] as number);
    await pumpUntil(() => closestTo(onRow) < 15);
    expect(closestTo(placeAt(COLUMNS[1] as number, (ROWS[3] as number) + 85))).toBeGreaterThan(60);
  });
});
