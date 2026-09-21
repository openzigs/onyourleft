// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The HUD's one live region, fed by the announcer — #397.
 *
 * ⚠️ **Through the client's own composition**: `AppShell`, the component
 * `main.tsx` renders, at `#/game`, with the ports `main.tsx` hands it — not a
 * `HudPanel` handed a sentence, and not the announcer called directly. That
 * shape is what #278 found five defects in: a correct, tested unit wired to
 * nothing. The announcer's wiring is `GameView` reading the preference off
 * this device and calling `announce` in its frame loop, and a test that
 * skipped either would pass with the region silent in the shipped app.
 *
 * ⚠️ `check:wiring` is NOT sufficient evidence here and is not claimed: the
 * region's prop is REQUIRED (the compiler forces `GameView` to supply one), but
 * an empty string supplied for ever would satisfy the compiler and the gate.
 * The first case below is what goes red.
 *
 * What only a person can establish: that TalkBack in the Capacitor WebView
 * speaks what lands here, and that the throttle makes USABLE speech at ride
 * intensity. `docs/validation/0003` (#393), with empty tables.
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

import { AppShell } from '../../shell/AppShell';
import type { CapabilityProbe } from '../../support/bluetooth-support';
import { mount, queryAll, settle, type Mounted } from '../../testing/mount';
import type { GamePort, RidableRoute } from '../GameView';
import type { GameRenderer } from '../port';

import { ANNOUNCEMENTS_STORAGE_KEY, DEFAULT_ANNOUNCEMENTS } from './announce-preference';

const NO_BLUETOOTH: CapabilityProbe = { bluetooth: undefined, secureContext: true };

function flatRoute(): RidableRoute {
  const points: RoutePoint[] = [];
  for (let index = 0; index <= 400; index += 1) {
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
    rider: { power: watts(230), live: true, paired: true },
    cadence: { value: 90, live: true, paired: true },
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
  // The frame loop's clock: `AppShell` passes `GameView` no `now`, exactly as
  // in the shipped app, so the one it reads is `performance.now`.
  vi.spyOn(performance, 'now').mockImplementation(() => nowMs);
  localStorage.clear();
});

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

/** Half a second of ride per frame. */
async function pump(frames: number): Promise<void> {
  for (let index = 0; index < frames; index += 1) {
    const next = pending.shift();
    if (next === undefined) return;
    nowMs += 500;
    await act(async () => {
      next(nowMs);
      await Promise.resolve();
    });
  }
}

function button(words: string): HTMLButtonElement | undefined {
  return queryAll<HTMLButtonElement>(document.body, 'button').find((each) =>
    (each.textContent ?? '').startsWith(words),
  );
}

async function press(element: HTMLElement | undefined): Promise<void> {
  await act(async () => {
    element?.click();
    await Promise.resolve();
  });
  await settle();
}

async function startRide(): Promise<void> {
  globalThis.location.hash = '#/game';
  mounted = await mount(
    <AppShell
      capabilities={NO_BLUETOOTH}
      game={PORT}
      gameRenderer={() => Promise.resolve(RENDERER)}
    />,
  );
  await settle();
  await press(button('Ride '));
}

const region = (): HTMLElement | null =>
  document.querySelector<HTMLElement>('[data-oyl-announcer="hud"]');

function chooseAnnouncements(): void {
  localStorage.setItem(
    ANNOUNCEMENTS_STORAGE_KEY,
    JSON.stringify({ ...DEFAULT_ANNOUNCEMENTS, enabled: true, powerEverySeconds: 15 }),
  );
}

describe('the HUD’s one live region — #397', () => {
  it('receives a sentence during a ride, through the client’s own composition', async () => {
    chooseAnnouncements();
    await startRide();
    expect(region()?.textContent, 'the region was populated at mount').toBe('');
    await pump(40);
    expect(region()?.textContent).toBe('Power 230 watts');
  });

  it('says nothing to a rider who has chosen nothing — OFF by default', async () => {
    await startRide();
    await pump(200);
    expect(region()?.textContent).toBe('');
  });

  it('is exactly ONE region in the HUD', async () => {
    chooseAnnouncements();
    await startRide();
    await pump(4);
    // A ride with no notice standing, so every `status` in the HUD is the
    // announcer's. Notices are event messages of their own (#394).
    expect(
      document.querySelectorAll('.oyl-hud [role="status"], .oyl-hud [aria-live]'),
    ).toHaveLength(1);
  });

  it('is visually hidden by clip, never taken out of the accessibility tree', async () => {
    await startRide();
    const live = region();
    expect(live?.getAttribute('role')).toBe('status');
    expect(live?.className).toContain('oyl-visually-hidden');
    expect(live?.hasAttribute('hidden')).toBe(false);
    expect(live?.getAttribute('aria-hidden')).toBeNull();
    expect(live?.style.display).not.toBe('none');
  });

  it('does not carry the last ride’s sentence into the next', async () => {
    chooseAnnouncements();
    await startRide();
    await pump(40);
    expect(region()?.textContent).not.toBe('');

    await press(button('End ride'));
    await press(button('Ride '));
    expect(region()?.textContent).toBe('');
  });

  it('keeps the 3D world aria-hidden — everything it shows is in the HUD as text', async () => {
    await startRide();
    expect(document.querySelector('canvas.oyl-game__world')?.getAttribute('aria-hidden')).toBe(
      'true',
    );
  });
});
