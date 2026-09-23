// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * "The road is not reaching your trainer" is announced when it appears — #394,
 * and since #445 through the HUD's ONE region.
 *
 * Its neighbour, the gradient FAULT, was already `live`; this notice was not,
 * so a rider who cannot see the screen was told when a write failed and never
 * told that no write would be made at all. #394 made it `live`. ⚠️ #445 took
 * that back out, and a reviewer who remembers this file asserting a live
 * region inside `.oyl-hud__notices` is reading the old one: a second region
 * beside the announcer's was a second voice, and the HUD carried three while
 * a notice stood. The notice is now a rank-1 event fed to the announcer on the
 * ride's first frame — and still on the screen.
 *
 * Since #503 it also holds the picker's PROMISE — the sentence that says the
 * trainer will follow the route's hills before the Ride press asks it for
 * control, audited here so it is inside `test:a11y`.
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

import { auditAccessibility, formatViolations } from '../a11y/audit';
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
  // #475: never asked — no ride in this file chose the realistic world.
  loadRealisticWorld: () => Promise.reject(new Error('no realistic world was chosen')),
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
  // #503: the Ride press's request for control — this double changes nothing.
  askForControlOnRide: () => Promise.resolve(),
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

describe('the road notice — #394, #445', () => {
  it('is said by the HUD’s one region once the ride starts, and shown without a region of its own', async () => {
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
    // One frame: the notice is the ride's first frame's event.
    await act(async () => {
      pending.shift()?.(performance.now());
      await Promise.resolve();
    });

    const region = document.querySelector('[data-oyl-announcer="hud"]');
    expect(region?.textContent).toMatch(
      /^The road is not reaching your trainer: .*workout is driving your trainer/,
    );
    const shown = [...document.querySelectorAll('.oyl-hud__notices .oyl-status')].find((element) =>
      (element.textContent ?? '').includes('workout is driving your trainer'),
    );
    expect(shown, 'the road notice is no longer on the screen').toBeDefined();
    expect(shown?.getAttribute('role'), 'the notice is a second voice').toBeNull();
  });
});

describe('the picker says what the Ride press will do, before it — #503', () => {
  /** Paired, would take a gradient, and not yet given control. */
  const AWAITING_CONTROL: GameTrainerPort = {
    readTrainer: () =>
      gameTrainerFrom(
        { paired: true, controllable: true, canSimulate: true, hasControl: false },
        {
          setSimulationParameters: () => Promise.resolve(),
          letGo: () => Promise.resolve({ kind: 'stopped' as const }),
        } satisfies GradientTrainer,
        false,
      ),
    askForControlOnRide: () => Promise.resolve(),
  };

  it('states that the trainer will follow the route’s hills, above the Ride button, with no violation', async () => {
    // Inside the landmark and heading the shell supplies, as
    // `picker.a11y.test.tsx` mounts it — a bare screen would fail the audit
    // for a landmark that ships.
    mounted = await mount(
      <main>
        <h1>Trainer game</h1>
        <GameView
          port={PORT}
          trainer={AWAITING_CONTROL}
          renderer={() => Promise.resolve(RENDERER)}
        />
      </main>,
    );
    await settle();

    const promise = [...document.querySelectorAll('.oyl-game__picker .oyl-status')].find(
      (element) =>
        (element.textContent ?? '').includes('Your trainer will follow this route’s hills'),
    );
    expect(promise, 'the picker does not say what Ride will do').toBeDefined();
    expect(promise?.textContent).toContain('Pressing Ride asks it for control');
    // BEFORE the press: the sentence precedes the button in document order.
    const ride = queryAll<HTMLButtonElement>(document.body, 'button').find((button) =>
      (button.textContent ?? '').startsWith('Ride '),
    );
    expect(ride).toBeDefined();
    expect(
      (promise?.compareDocumentPosition(ride as Node) ?? 0) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // No longer the detour: nothing here sends the rider to the Ride screen.
    expect(document.body.textContent).not.toContain('Take control on the Ride screen');
    expect(formatViolations(auditAccessibility(document))).toBe('');
  });
});
