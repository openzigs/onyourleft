// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * #2319 through the real game: a solo lap race on one of the rider's own
 * loops offers each whole lap it rides to `GamePort.recordBestLap`, and
 * `main.tsx` keeps it in the store, on the route, and lists it back.
 *
 * The real `GameView`, chooser, simulation and race. The doubles are the
 * port's list and its keep (which records what it was handed), the
 * recording's lap (`GameTrainerPort.courseLine`, answering each line with
 * one whole lap of the loop), the GL context and the animation frame. That
 * the store keeps the faster lap, on the rider's own route only, and reads it
 * back, is `@onyourleft/store` §`route-store.test.ts` §"the best lap of a
 * loop", through the real store; that `main.tsx` joins the two is held on its
 * source below, as `circuits-wiring.test.tsx` holds `listCircuits`.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { metres, seconds, unixSeconds, watts } from '@onyourleft/domain';
import { circuitRouteId } from '@onyourleft/store';

import type { CourseLineEvent } from '../../recording/laps';
import { activateWithKeyboard, mount, queryAll, settle, type Mounted } from '../../testing/mount';
import { stripComments } from '../../units/no-inline-units';
import { GameView, type GamePort, type RidableRoute } from '../GameView';
import type { GameRenderer } from '../port';
import { circuitRoute } from '../route-fixtures-testing';
import { LAP_RACE_CHOICE_TEXT } from '../StageChooser';
import { gameTrainerPortOver, type GameTrainerPort } from '../trainer-port';

const LOOP: RidableRoute = {
  id: 'park-loop',
  name: 'Park loop',
  profile: circuitRoute(60),
  attempts: 0,
};

const CIRCUIT: RidableRoute = { ...LOOP, id: circuitRouteId('fixture-ring'), name: 'Ring' };

/** The lap the recording states at each line: the whole loop, in 61.5 s. */
const LAP = {
  startedAt: unixSeconds(1_000),
  elapsedTime: seconds(61.5),
  movingTime: seconds(61.5),
  distance: metres(LOOP.profile.totalDistance),
  averagePower: watts(250),
};

const RENDERER: GameRenderer = {
  loadRealisticWorld: () =>
    Promise.resolve({ loaded: false, offline: false, detail: 'no realistic world here' }),
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

let pending: FrameRequestCallback[] = [];
let nowMs = 1_000_000;
let mounted: Mounted | undefined;

beforeEach(() => {
  pending = [];
  nowMs = 1_000_000;
  localStorage.clear();
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
  localStorage.clear();
});

/** What the port was asked to keep, as `[route, lap]`. */
type Kept = [string, number][];

function portOver(route: RidableRoute, kept: Kept): GamePort {
  return {
    listRoutes: () => Promise.resolve([route]),
    listCircuits: () => Promise.resolve([CIRCUIT]),
    loadGhost: () => Promise.resolve(undefined),
    readSensors: () => ({
      rider: { power: watts(300), live: true, paired: true },
      cadence: { value: 88, live: true, paired: true },
      heartRate: { value: 142, live: true, paired: true },
    }),
    recordBestLap: (id, lap) => {
      kept.push([id, lap]);
      return Promise.resolve();
    },
  };
}

/** A recording that answers each line with one whole lap of the loop. */
function linePort(lines: string[]): GameTrainerPort {
  return {
    ...gameTrainerPortOver(undefined),
    courseLine: (event: CourseLineEvent) => {
      lines.push(event.kind);
      return event.kind === 'lap' ? [LAP] : undefined;
    },
  };
}

async function game(port: GamePort, lines: string[]): Promise<void> {
  mounted = await mount(
    <GameView
      port={port}
      trainer={linePort(lines)}
      renderer={() => Promise.resolve(RENDERER)}
      now={() => nowMs}
    />,
  );
  await settle();
}

function switchNamed(words: string): HTMLInputElement | undefined {
  return queryAll<HTMLInputElement>(document.body, 'input[role="switch"]').find(
    (box) => (box.closest('label')?.textContent ?? '').trim() === words,
  );
}

function button(words: string): HTMLButtonElement | undefined {
  return queryAll<HTMLButtonElement>(document.body, 'button').find((each) =>
    (each.textContent ?? '').startsWith(words),
  );
}

/** The chooser's card for `route`, once the lists have been read. */
async function card(route: RidableRoute): Promise<HTMLInputElement | undefined> {
  const find = (): HTMLInputElement | undefined =>
    queryAll<HTMLInputElement>(document.body, 'input[type="radio"]').find(
      (each) => each.value === route.id,
    );
  for (let tries = 0; tries < 200 && find() === undefined; tries += 1) await settle();
  return find();
}

/** Frames of ride until the line has been crossed `count` times as a lap. */
async function rideLaps(lines: string[], count: number): Promise<void> {
  for (let frame = 0; frame < 4_000; frame += 1) {
    if (lines.filter((kind) => kind === 'lap').length >= count) break;
    const due = pending;
    pending = [];
    nowMs += 500;
    await act(async () => {
      for (const callback of due) callback(nowMs);
      await Promise.resolve();
      await Promise.resolve();
    });
  }
  await settle();
  expect(lines.filter((kind) => kind === 'lap').length).toBeGreaterThanOrEqual(count);
}

describe('a solo lap race on the rider’s own loop offers each whole lap to be kept — #2319', () => {
  it('hands the port the loop and the lap’s moving time at each line', async () => {
    const kept: Kept = [];
    const lines: string[] = [];
    await game(portOver(LOOP, kept), lines);
    await activateWithKeyboard(switchNamed(LAP_RACE_CHOICE_TEXT.label) as HTMLElement);
    await activateWithKeyboard(button('Ride ') as HTMLElement);
    await rideLaps(lines, 1);
    expect(kept.length).toBeGreaterThanOrEqual(1);
    expect(new Set(kept.map(([route, lap]) => `${route} ${String(lap)}`))).toEqual(
      new Set([`${LOOP.id} 61.5`]),
    );
  });

  it('offers nothing on a ride of the same loop with no race — the control', async () => {
    const kept: Kept = [];
    const lines: string[] = [];
    await game(portOver(LOOP, kept), lines);
    expect(switchNamed(LAP_RACE_CHOICE_TEXT.label)?.checked).toBe(false);
    await activateWithKeyboard(button('Ride ') as HTMLElement);
    await rideLaps(lines, 1);
    expect(kept).toEqual([]);
  });

  it('offers nothing on a built-in circuit, which keeps no lap', async () => {
    const kept: Kept = [];
    const lines: string[] = [];
    await game(portOver(LOOP, kept), lines);
    const circuit = await card(CIRCUIT);
    expect(circuit, 'the circuit is offered').toBeDefined();
    await act(async () => {
      circuit?.click();
      await Promise.resolve();
    });
    await settle();
    expect(circuit?.checked).toBe(true);
    await activateWithKeyboard(button('Ride ') as HTMLElement);
    await rideLaps(lines, 1);
    expect(kept).toEqual([]);
  });
});

describe('main.tsx keeps the lap in the store and lists it back — #2319', () => {
  const SOURCE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const main = stripComments(readFileSync(join(SOURCE_ROOT, 'main.tsx'), 'utf8'));

  it('builds the game port with recordBestLap over the rider’s own store', () => {
    expect(main).toMatch(
      /recordBestLap: async \(route: string, lap: number\): Promise<void> => \{\s*await store\.recordBestLap\(LOCAL_ATHLETE, routeId\(route\), seconds\(lap\)\);/,
    );
  });

  it('lists each route with the best lap kept on it', () => {
    expect(main).toMatch(/bestLapSeconds: route\.bestLap,/);
  });
});
