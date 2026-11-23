// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * #2902 through the real game screen: an open-world ride hands the scene the
 * mapped buildings its road planned (`OpenWorldRoad.buildings`) and the ways
 * on from the next junction it ranks them by (`OpenWorldRoad.branchesAhead`).
 * Both are optional members of the scene's input, which `check:wiring` cannot
 * follow (§Limits): a `GameView` that stopped passing them would leave every
 * gate green and draw no building in an open world. So this reads them back
 * off the input `sceneFrame` was handed, frame by frame.
 *
 * The session is a double over `@onyourleft/domain/rolling-testing`'s grid, as
 * `junction-wiring.test.tsx`'s is; the game, the road and the scene are the
 * product's. The buildings are an empty index: what is asserted is that the
 * road's own object reaches the scene, not what it holds.
 */

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RollingRoute, watts, type RollingEdge } from '@onyourleft/domain';
import { gridGraph, roughGround } from '@onyourleft/domain/rolling-testing';

import { mount, queryAll, settle, type Mounted } from '../../testing/mount';
import { GameView, type GamePort } from '../GameView';
import { mappedBuildingsOf } from '../mapped-buildings';
import type { GameRenderer } from '../port';
import type { SceneInput } from '../scene';
import { corridorOrigin } from '../terrain';
import { fixtureStart, START_COLUMN, START_ROW } from './fixture-testing';
import { OPEN_WORLD_ROUTE_ID, type OpenWorldSessions } from './ride';
import { OpenWorldRoad } from './road';
import { openWorldStreetCorridor } from './street-corridor';

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

const FRAME_MS = 1_000;
const COLUMNS = [0, 180, 410, 600, 870];
const ROWS = [0, 230, 400, 650];
const RIDE_FRAME = { latitude: 40, longitude: -105, elevation: 0 };
const BUILDINGS = mappedBuildingsOf([]);
const STREETS = openWorldStreetCorridor(RIDE_FRAME, []);

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

function renderer(): GameRenderer {
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

function route(): RollingRoute {
  const { graph, edges } = gridGraph(COLUMNS, ROWS, roughGround, 1);
  return new RollingRoute(graph, edges.find((edge) => edge.id === 'h0,1') as RollingEdge);
}

function port(): GamePort {
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
        road: () =>
          new OpenWorldRoad(route(), {
            frame: RIDE_FRAME,
            buildings: () => BUILDINGS,
            streets: () => STREETS,
          }),
      }),
      stop: () => undefined,
    }),
  };
  return {
    listRoutes: () => Promise.resolve([]),
    loadGhost: () => Promise.resolve(undefined),
    readSensors: () => ({
      rider: { power: watts(250), live: true, paired: true },
      cadence: { value: 90, live: true, paired: true },
      heartRate: { value: 140, live: true, paired: true },
    }),
    openWorld: sessions,
  };
}

function rideButton(): HTMLButtonElement | undefined {
  return queryAll<HTMLButtonElement>(mounted?.container ?? document, 'button').find((button) =>
    (button.textContent ?? '').startsWith('Ride '),
  );
}

describe('an open-world ride hands the scene its planned buildings — #2902', () => {
  it('passes the road’s buildings, in the ride’s frame, and the next junction’s ways not taken', async () => {
    mounted = await mount(
      <GameView port={port()} renderer={() => Promise.resolve(renderer())} now={() => nowMs} />,
    );
    for (let tries = 0; tries < 50 && rideButton()?.textContent !== 'Ride Open world'; tries++) {
      await settle();
    }
    await act(async () => {
      rideButton()?.click();
      await Promise.resolve();
    });
    await settle();
    for (let frame = 0; frame < 20; frame += 1) await pump();
    const ridden = inputs.filter((input) => input.mappedBuildings !== undefined);
    expect(ridden.length).toBeGreaterThan(0);
    for (const input of ridden) {
      expect(input.mappedBuildings).toBe(BUILDINGS);
      // #2903: and its streets, as the corridor the scene draws them from.
      expect(input.worldCorridor).toBe(STREETS);
      // The whole ride is drawn in the road's frame, whatever its view.
      expect(corridorOrigin(input.profile)).toBe(RIDE_FRAME);
    }
    // The first junction is 180 m on: within the ranked reach from the start.
    expect(ridden.some((input) => input.mappedBranches !== undefined)).toBe(true);
  });
});
