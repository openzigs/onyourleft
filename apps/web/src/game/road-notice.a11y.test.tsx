// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * "The road is not reaching your trainer" is announced when it appears — #394.
 *
 * Its neighbour, the gradient FAULT, was already `live`; this notice was not,
 * so a rider who cannot see the screen was told when a write failed and never
 * told that no write would be made at all. It is absent until a ride starts on
 * a trainer the road cannot reach, which is exactly the case `StatusMessage`'s
 * `live` exists for.
 *
 * ⚠️ What this cannot say: whether a screen reader in the Android WebView
 * speaks it. That is `docs/validation/0003` (#393), and its tables are empty.
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

import { mount, queryAll, settle, type Mounted } from '../testing/mount';

import { GameView, type GamePort, type RidableRoute } from './GameView';
import type { GameRenderer } from './port';
import { gameTrainerFrom, type GameTrainerPort, type GradientTrainer } from './trainer-port';

function flatRoute(): RidableRoute {
  const points: RoutePoint[] = [];
  for (let index = 0; index <= 100; index += 1) {
    points.push({
      position: geographicPosition(
        degreesLatitude(51.5 + (index * 10) / 111_320),
        degreesLongitude(-0.12),
      ),
      elevation: altitudeMetres(10),
    });
  }
  return { id: 'route-flat', name: 'Flat', profile: routeProfile(points), attempts: 0 };
}

const PORT: GamePort = {
  listRoutes: () => Promise.resolve([flatRoute()]),
  loadGhost: () => Promise.resolve(undefined),
  readSensors: () => ({
    rider: { power: watts(200), live: true, paired: true },
    cadence: { value: 88, live: true, paired: true },
    heartRate: { value: 140, live: true, paired: true },
  }),
};

const RENDERER: GameRenderer = {
  create: () => ({
    hasContext: true,
    render: () => undefined,
    setQuality: () => undefined,
    resize: () => undefined,
    destroy: () => undefined,
  }),
};

/** A trainer a running workout already owns — one of the four noticed states. */
const WORKOUT_OWNS_IT: GameTrainerPort = {
  readTrainer: () =>
    gameTrainerFrom(
      { paired: true, controllable: true, canSimulate: true, hasControl: true },
      {
        setSimulationParameters: () => Promise.resolve(),
        letGo: () => Promise.resolve({ kind: 'stopped' as const }),
      } satisfies GradientTrainer,
      true,
    ),
};

let pending: FrameRequestCallback[] = [];
let mounted: Mounted | undefined;

beforeEach(() => {
  pending = [];
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

describe('the road notice — #394', () => {
  it('is a live region, carrying the sentence, once the ride starts', async () => {
    mounted = await mount(
      <GameView port={PORT} trainer={WORKOUT_OWNS_IT} renderer={() => Promise.resolve(RENDERER)} />,
    );
    await settle();
    const ride = queryAll<HTMLButtonElement>(document.body, 'button').find((button) =>
      (button.textContent ?? '').startsWith('Ride '),
    );
    await act(async () => {
      ride?.click();
      await Promise.resolve();
    });
    await settle();

    const notice = [...document.querySelectorAll('.oyl-hud__notices [role="status"]')].find(
      (element) => (element.textContent ?? '').includes('workout is driving your trainer'),
    );
    expect(notice, 'the road notice is not in a live region').toBeDefined();
  });
});
