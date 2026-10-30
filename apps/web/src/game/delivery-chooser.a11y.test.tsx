// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * A Delivery round offered in the chooser, and the notice for a ride with no
 * round — #1818, audited inside `test:a11y`.
 *
 * Mounted through the real `GameView`, inside the landmark and heading the
 * shell supplies (`picker.a11y.test.tsx`'s reason), with the realistic world
 * chosen on the device. What is read is what a screen reader reaches: the
 * switch, its name, the two sentences it is described by and its state; and,
 * once *Ride* is pressed on a route with no mapped houses, the notice on the
 * HUD, shown without a live region of its own, and the sentence the HUD's one
 * region says (#445: the notices are not regions; `hud/delivery-announce.ts`
 * §`HOUSES_NOT_READY_TEXT`, the sentence for no houses read; its
 * too-few-houses twin is drawn by the same notice).
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

import { DELIVERY_PROGRESS_STORAGE_KEY } from './delivery/delivery-progress';
import { GameView, type GamePort, type RidableRoute } from './GameView';
import { ANNOUNCEMENTS_STORAGE_KEY, DEFAULT_ANNOUNCEMENTS } from './hud/announce-preference';
import { HOUSES_NOT_READY_TEXT, NO_ROUND_LABEL } from './hud/delivery-announce';
import type { GameRenderer } from './port';
import { DELIVERY_CHOICE_TEXT } from './StageChooser';
import { writeRealisticWorldChoice } from './world-preference';

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

/** No corridor is read, so the press has no mapped houses to count: the fallback's ride. */
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
  // The realistic world is chosen and does not load here: the ride is drawn in the standard world.
  loadRealisticWorld: () =>
    Promise.resolve({ loaded: false, offline: false, detail: 'no realistic world in this test' }),
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
let mounted: Mounted | undefined;

beforeEach(() => {
  pending = [];
  localStorage.clear();
  writeRealisticWorldChoice(localStorage, true);
  localStorage.setItem(
    DELIVERY_PROGRESS_STORAGE_KEY,
    JSON.stringify({ day: 3, houses: 9, score: 14 }),
  );
  localStorage.setItem(
    ANNOUNCEMENTS_STORAGE_KEY,
    JSON.stringify({ ...DEFAULT_ANNOUNCEMENTS, enabled: true }),
  );
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

async function game(): Promise<Mounted> {
  mounted = await mount(
    <main>
      <h1>Trainer game</h1>
      <GameView port={PORT} renderer={() => Promise.resolve(RENDERER)} />
    </main>,
  );
  await settle();
  return mounted;
}

function deliverySwitch(): HTMLInputElement | undefined {
  return queryAll<HTMLInputElement>(document.body, 'input[role="switch"]').find((box) =>
    (box.closest('label')?.textContent ?? '').includes(DELIVERY_CHOICE_TEXT.label),
  );
}

/** The switch's description, as a screen reader reads it after its name. */
function described(box: HTMLInputElement): string {
  return (box.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .map((id) => document.getElementById(id)?.textContent ?? `(no element ${id})`)
    .join(' ');
}

async function click(element: HTMLElement | undefined): Promise<void> {
  await act(async () => {
    element?.click();
    await Promise.resolve();
  });
  await settle();
}

describe('#1818 — the Delivery choice in the chooser', () => {
  it('is a named switch, described by the week’s progress and what a round is, with no violation', async () => {
    await game();
    const box = deliverySwitch();
    expect(box, 'no Delivery switch with the realistic world chosen').toBeDefined();
    if (box === undefined) return;
    expect(box.type).toBe('checkbox');
    expect(box.closest('label')?.textContent).toBe(DELIVERY_CHOICE_TEXT.label);
    expect(described(box)).toBe(
      `Day 3 of 7 · up to 9 houses on the round ${DELIVERY_CHOICE_TEXT.hint}`,
    );
    expect(box.checked).toBe(false);
    expect(formatViolations(auditAccessibility(document))).toBe('');
    // Reached by keyboard like every other switch in the loadout.
    box.focus();
    expect(document.activeElement).toBe(box);
    await click(box);
    expect(deliverySwitch()?.checked).toBe(true);
    expect(formatViolations(auditAccessibility(document))).toBe('');
  });
});

describe('#1818 — the notice for a ride whose map’s houses were not ready', () => {
  it('is shown on the HUD without a region of its own, said once by the one region, with no violation', async () => {
    await game();
    await click(deliverySwitch());
    await click(
      queryAll<HTMLButtonElement>(document.body, 'button').find((button) =>
        (button.textContent ?? '').startsWith('Ride '),
      ),
    );
    for (let frame = 0; frame < 3; frame += 1) {
      await act(async () => {
        pending.shift()?.(performance.now() + frame * 50);
        await Promise.resolve();
      });
    }
    await settle();
    const shown = [...document.querySelectorAll('.oyl-hud__notices .oyl-status')].find((element) =>
      (element.textContent ?? '').includes(HOUSES_NOT_READY_TEXT),
    );
    expect(shown, 'the fallback is not on the HUD').toBeDefined();
    expect(shown?.textContent).toContain(NO_ROUND_LABEL);
    expect(shown?.getAttribute('role'), 'the notice is a second voice').toBeNull();
    expect(document.querySelector('[data-oyl-announcer="hud"]')?.textContent).toBe(
      HOUSES_NOT_READY_TEXT,
    );
    // An ordinary ride: no throw control to reach.
    expect(document.querySelector('[aria-label="Throw a parcel"]')).toBeNull();
    expect(formatViolations(auditAccessibility(document))).toBe('');
  });
});
