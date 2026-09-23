// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * #365's wiring: a riding position a **rider** chose, reaching the physics.
 *
 * `rider.test.ts` proves `rideConditionsFor` builds the right coefficients.
 * That is exactly the evidence #365 says is not sufficient: *"A test that
 * constructs the conditions is not evidence that a ride uses them (#278)."*
 * `RideConditions.coefficients` was declared, optional and supplied by nobody
 * for the whole life of the game, which is the same shape as
 * `SceneInput.botDistance` (#237) and `SimulationSetup.wind` (#326) — and
 * neither the typechecker nor `check:wiring` can see an optional field nobody
 * fills in.
 *
 * So the assertion here is a **speed a rider is shown**, read off the HUD,
 * after choosing a position on the real picker control. Deleting the `sitting`
 * argument in `GameView.start` turns it red; nothing else in this repository
 * does.
 */

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GameView, type GamePort, type RidableRoute } from './GameView';
import type { GameRenderer, SceneFrame } from './port';
import { RIDING_POSITIONS } from './rider';
import { mount, queryAll, settle, type Mounted } from '../testing/mount';
import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  routeProfile,
  watts,
  type RoutePoint,
} from '@onyourleft/domain';

/**
 * Four kilometres of flat road.
 *
 * ⚠️ **Flat, because drag scales with the square of speed and gravity does
 * not.** On a climb a track racer and a rider sitting up are nearly
 * indistinguishable, which is how this defect survived #325's own suite; on the
 * flat the drag area is most of the answer. Long enough that a two-minute ride
 * does not reach the end and start wrapping.
 */
function flatRoute(): RidableRoute {
  const points: RoutePoint[] = [];
  for (let index = 0; index <= 400; index += 1) {
    points.push({
      position: geographicPosition(
        degreesLatitude(51.5 + (index * 10) / 111_320),
        degreesLongitude(-0.12),
      ),
      elevation: altitudeMetres(20),
    });
  }
  return { id: 'route-flat', name: 'Test flat', profile: routeProfile(points), attempts: 0 };
}

function pedallingPort(route: RidableRoute): GamePort {
  return {
    listRoutes: () => Promise.resolve([route]),
    loadGhost: () => Promise.resolve(undefined),
    readSensors: () => ({
      rider: { power: watts(150), live: true, paired: true },
      cadence: { value: 88, live: true, paired: true },
      heartRate: { value: 142, live: true, paired: true },
    }),
  };
}

function capturingRenderer(frames: SceneFrame[]): GameRenderer {
  return {
    // #475: never asked — no ride in this file chose the realistic world.
    loadRealisticWorld: () => Promise.reject(new Error('no realistic world was chosen')),
    create: () => ({
      hasContext: true,
      render: (frame: SceneFrame) => {
        frames.push(frame);
      },
      setQuality: () => undefined,
      resize: () => undefined,
      destroy: () => undefined,
    }),
  };
}

let pending: FrameRequestCallback[] = [];
let nowMs = 0;
let mounted: Mounted | undefined;

beforeEach(() => {
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

async function clickThrough(element: HTMLElement | undefined): Promise<void> {
  await act(async () => {
    element?.click();
    await Promise.resolve();
  });
  await settle();
}

/** The speed on the HUD, as a number — what the rider is shown. */
function hudSpeed(): number {
  const field = queryAll(mounted?.container ?? document, '.oyl-hud__field').find(
    (element) => (element.querySelector('.oyl-hud__label')?.textContent ?? '') === 'Speed',
  );
  return Number.parseFloat(field?.querySelector('.oyl-hud__value')?.textContent ?? '');
}

/**
 * Ride the flat at 150 W in one position, and return the speed reached.
 *
 * ⚠️ 200 frames of 500 ms — a hundred seconds of road, in steps well under the
 * simulation's own `MAXIMUM_STEPS_PER_ADVANCE`, so what is measured is the drag
 * and not the stall guard.
 */
async function rideSittingAs(position: string | undefined): Promise<number> {
  // ⚠️ Unmounts any previous ride itself, so a case comparing three positions
  // does not have to interleave teardown with measurement — and so the three
  // rides cannot share a `GameView` whose state carries over.
  mounted?.unmount();
  mounted = undefined;
  const frames: SceneFrame[] = [];
  mounted = await mount(
    <GameView
      port={pedallingPort(flatRoute())}
      renderer={() => Promise.resolve(capturingRenderer(frames))}
      now={() => nowMs}
    />,
  );
  await settle();

  if (position !== undefined) {
    const select = queryAll<HTMLSelectElement>(mounted.container, 'select').find((element) =>
      (element.closest('label')?.textContent ?? '').includes('How you are riding'),
    );
    expect(select).toBeDefined();
    await act(async () => {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
      descriptor?.set?.call(select, position);
      select?.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
    });
  }

  await clickThrough(
    queryAll<HTMLButtonElement>(mounted.container, 'button').find((button) =>
      (button.textContent ?? '').startsWith('Ride '),
    ),
  );
  for (let index = 0; index < 200; index += 1) {
    const next = pending.shift();
    if (next === undefined) {
      break;
    }
    nowMs += 500;
    await act(async () => {
      next(nowMs);
      await Promise.resolve();
    });
  }
  await settle();
  // The renderer really was driven, or "slower" could be "never started".
  expect(frames.length).toBeGreaterThan(10);
  return hudSpeed();
}

/**
 * ⚠️ **Fifteen seconds rather than Vitest's five, since #458–#460**, and the
 * number is a stop on a hung ride rather than a budget. Every case here rides
 * two or three hundred frames, and each frame now builds a landform, the water
 * and the villages beside the road as well as the road: about 0.4 ms of
 * `sceneFrame` where it was 0.17 ms, measured in Node, and several times that
 * under coverage on a CI runner, where the slowest case took more than five
 * seconds on #468's first run. The assertions are unchanged.
 */
const RIDE_TIMEOUT_MS = 15_000;

describe(
  'a riding position a rider chose on the picker reaches the physics',
  { timeout: RIDE_TIMEOUT_MS },
  () => {
    it('offers the choice at all, in words about hands rather than square metres', async () => {
      mounted = await mount(<GameView port={pedallingPort(flatRoute())} now={() => nowMs} />);
      await settle();
      const text = mounted.container.textContent ?? '';
      expect(text).toContain('How you are riding');
      expect(text).toContain(RIDING_POSITIONS.hoods.label);
      // A drag area is a wind-tunnel measurement nobody knows about themselves.
      expect(text).not.toContain('drag');
      expect(text).not.toContain('m²');
    });

    it('makes the same rider at the same power faster in the drops than sitting up', async () => {
      // ⚠️ **The assertion that goes red the moment `GameView.start` stops
      // passing the position to `rideConditionsFor`.** Everything else about the
      // two rides is identical: same route, same power, same frames, same clock.
      const upright = await rideSittingAs('upright');
      const drops = await rideSittingAs('drops');

      expect(drops).toBeGreaterThan(upright);
      // And by an amount a rider reads on the HUD rather than a rounding. The
      // HUD is rendered to one decimal place, so anything below about 0.1 would
      // be invisible on the screen this is read from.
      expect(drops - upright).toBeGreaterThan(1);
    });

    it('rides a rider who touched nothing at the hoods, not at Martin’s track racer', async () => {
      // The default is the middle rung, so a rider who never opens the control
      // sits between the two above — which is also the evidence that the default
      // is a *road* position rather than the paper's time-trial one.
      const untouched = await rideSittingAs(undefined);
      const upright = await rideSittingAs('upright');
      const drops = await rideSittingAs('drops');

      expect(untouched).toBeGreaterThan(upright);
      expect(untouched).toBeLessThan(drops);
    });
  },
);
