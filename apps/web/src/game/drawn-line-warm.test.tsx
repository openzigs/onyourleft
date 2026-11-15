// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The drawn path is built while the rider chooses, not in the ride's first
 * frame — #2422's review. `drawn-line.ts` §`drawnLine` costs about 0.2 s on a
 * 100 km route on a laptop, and it was paid inside the first `sceneFrame`: a
 * stall at the start of a long imported ride. The real `GameView`'s chooser
 * builds the chosen route's path a moment after the choice settles
 * (`GameView.tsx` §`DRAWN_LINE_WARM_DELAY_MS`), and only that route's — and
 * since #2470 only for a ride drawn along it (§`drawnAlongPath`): not for a
 * lap race or a Delivery round, whose riders are drawn beside the road.
 */

import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  routeProfile,
  watts,
  type RoutePoint,
} from '@onyourleft/domain';

import { mount, settle, type Mounted } from '../testing/mount';

import { drawnLineBuilt } from './drawn-line';
import { DRAWN_LINE_WARM_DELAY_MS, GameView, type GamePort, type RidableRoute } from './GameView';
import { DELIVERY_CHOICE_TEXT, LAP_RACE_CHOICE_TEXT } from './StageChooser';
import { writeRealisticWorldChoice } from './world-preference';

function ridableRoute(id: string, name: string): RidableRoute {
  const points: RoutePoint[] = [];
  for (let index = 0; index <= 40; index += 1) {
    points.push({
      position: geographicPosition(
        degreesLatitude(51.5 + (index * 10) / 111_320),
        degreesLongitude(-0.12 + (index > 20 ? ((index - 20) * 10) / 69_000 : 0)),
      ),
      elevation: altitudeMetres(index * 0.3),
    });
  }
  return { id, name, profile: routeProfile(points), attempts: 0 };
}

/** A 400 m square, ridden as a loop: a lap race is offered on it. */
function loopRoute(id: string, name: string): RidableRoute {
  const points: RoutePoint[] = [];
  const corners = [
    [0, 0],
    [100, 0],
    [100, 100],
    [0, 100],
  ] as const;
  for (let side = 0; side < 4; side += 1) {
    const [fromNorth, fromEast] = corners[side] as readonly [number, number];
    const [toNorth, toEast] = corners[(side + 1) % 4] as readonly [number, number];
    for (let step = 0; step < 10; step += 1) {
      const north = fromNorth + ((toNorth - fromNorth) * step) / 10;
      const east = fromEast + ((toEast - fromEast) * step) / 10;
      points.push({
        position: geographicPosition(
          degreesLatitude(51.5 + north / 111_320),
          degreesLongitude(-0.12 + east / 69_000),
        ),
        elevation: altitudeMetres(30),
      });
    }
  }
  points.push(points[0] as RoutePoint);
  return { id, name, profile: routeProfile(points, { loop: true }), attempts: 0 };
}

function portWith(routes: readonly RidableRoute[]): GamePort {
  return {
    listRoutes: () => Promise.resolve(routes),
    loadGhost: () => Promise.resolve(undefined),
    readSensors: () => ({
      rider: { power: watts(0), live: false, paired: false },
      cadence: { value: undefined, live: false, paired: false },
      heartRate: { value: undefined, live: false, paired: false },
    }),
  };
}

/** Longer than the warm-up's delay. */
async function pastTheDelay(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, DRAWN_LINE_WARM_DELAY_MS + 100));
  });
}

async function clickThrough(element: HTMLElement | null | undefined): Promise<void> {
  expect(element).toBeDefined();
  expect(element).not.toBeNull();
  await act(async () => {
    element?.click();
    await Promise.resolve();
  });
  await settle();
}

/** The chooser's switch whose label holds `label`. */
function switchLabelled(label: string): HTMLInputElement | undefined {
  return [
    ...(mounted?.container ?? document).querySelectorAll<HTMLInputElement>('input[role="switch"]'),
  ].find((box) => (box.closest('label')?.textContent ?? '').includes(label));
}

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  localStorage.clear();
  globalThis.location.hash = '';
});

describe('the drawn path is built while the rider chooses — #2422’s review', () => {
  it('builds the chosen route’s path a moment after the chooser shows it, and no other route’s', async () => {
    const chosen = ridableRoute('a', 'Quarry climb');
    const other = ridableRoute('b', 'Reservoir road');
    mounted = await mount(<GameView port={portWith([chosen, other])} />);
    await settle();
    // Not at once: a rider stepping through the picker builds nothing.
    expect(drawnLineBuilt(chosen.profile)).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, DRAWN_LINE_WARM_DELAY_MS + 100));
    expect(drawnLineBuilt(chosen.profile)).toBe(true);
    expect(drawnLineBuilt(other.profile)).toBe(false);
  });

  it('builds nothing for a route the rider moved on from before the delay ended — #2470', async () => {
    // `GameView`'s warm effect clears its timer when the choice changes.
    // Without that, every route the rider stepped through was built.
    const first = ridableRoute('a', 'Quarry climb');
    const next = ridableRoute('b', 'Reservoir road');
    mounted = await mount(<GameView port={portWith([first, next])} />);
    await settle();
    await clickThrough(
      mounted.container.querySelector<HTMLInputElement>('input[type="radio"][value="b"]'),
    );
    await pastTheDelay();
    expect(drawnLineBuilt(next.profile)).toBe(true);
    expect(drawnLineBuilt(first.profile)).toBe(false);
  });
});

describe('the drawn path is built only for a ride drawn along it — #2470', () => {
  it('builds none for a lap race, and builds it once the race is switched off', async () => {
    // A lap race draws its racers beside the road at their race places
    // (`scene.ts` §`easingLine`), so the path would be built for nothing:
    // about 0.2 s on the main thread while the rider chooses.
    globalThis.location.hash = '#/game?play=lap-race';
    const loop = loopRoute('loop', 'Park loop');
    mounted = await mount(<GameView port={portWith([loop])} />);
    await settle();
    expect(switchLabelled(LAP_RACE_CHOICE_TEXT.label)?.checked).toBe(true);
    await pastTheDelay();
    expect(drawnLineBuilt(loop.profile)).toBe(false);
    // Non-vacuity: the same route, as an ordinary ride, is built.
    await clickThrough(switchLabelled(LAP_RACE_CHOICE_TEXT.label));
    await pastTheDelay();
    expect(drawnLineBuilt(loop.profile)).toBe(true);
  });

  it('builds none for a Delivery round, and builds it once the round is switched off', async () => {
    // A round's riders are drawn where its obstacles meet them, beside the
    // road. Offered only with the realistic world chosen (DL6).
    writeRealisticWorldChoice(localStorage, true);
    globalThis.location.hash = '#/game?play=delivery';
    const route = ridableRoute('a', 'Quarry climb');
    mounted = await mount(<GameView port={portWith([route])} />);
    await settle();
    expect(switchLabelled(DELIVERY_CHOICE_TEXT.label)?.checked).toBe(true);
    await pastTheDelay();
    expect(drawnLineBuilt(route.profile)).toBe(false);
    await clickThrough(switchLabelled(DELIVERY_CHOICE_TEXT.label));
    await pastTheDelay();
    expect(drawnLineBuilt(route.profile)).toBe(true);
  });
});
