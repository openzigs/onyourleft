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

import {
  ANNOUNCEMENTS_STORAGE_KEY,
  DEFAULT_ANNOUNCEMENTS,
  type AnnouncementPreference,
} from './announce-preference';

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

/**
 * 1 km flat, then 500 m at 6 %, then flat again — #399's climb, on a real
 * profile built through the domain's own three windows.
 */
function hillyRoute(): RidableRoute {
  const points: RoutePoint[] = [];
  for (let index = 0; index <= 300; index += 1) {
    const climbed = Math.min(Math.max(index - 100, 0), 50) * 0.6;
    points.push({
      position: geographicPosition(
        degreesLatitude(51.5 + (index * 10) / 111_320),
        degreesLongitude(-0.12),
      ),
      elevation: altitudeMetres(10 + climbed),
    });
  }
  return { id: 'route-hilly', name: 'Hilly', profile: routeProfile(points), attempts: 0 };
}

/** What the picker offers. Reset to the flat route before every case. */
let routes: RidableRoute[] = [flatRoute()];

const PORT: GamePort = {
  listRoutes: () => Promise.resolve(routes),
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
  routes = [flatRoute()];
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

function chooseAnnouncements(choice: Partial<AnnouncementPreference> = {}): void {
  localStorage.setItem(
    ANNOUNCEMENTS_STORAGE_KEY,
    JSON.stringify({ ...DEFAULT_ANNOUNCEMENTS, enabled: true, powerEverySeconds: 15, ...choice }),
  );
}

/** Pump frames until the region says something matching, or give up. */
async function pumpUntil(pattern: RegExp, frames: number): Promise<string> {
  for (let frame = 0; frame < frames; frame += 1) {
    await pump(1);
    const text = region()?.textContent ?? '';
    if (pattern.test(text)) return text;
  }
  return region()?.textContent ?? '';
}

/** The HUD's rendered "To go" value, as a number. */
function renderedToGo(): number {
  const field = [...document.querySelectorAll('.oyl-hud__field')].find(
    (each) => each.querySelector('.oyl-hud__label')?.textContent === 'To go',
  );
  return Number(field?.querySelector('.oyl-hud__value')?.firstChild?.textContent);
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

  it('is the HUD’s only CONTINUOUS region — the only region at all while no notice stands', async () => {
    chooseAnnouncements();
    await startRide();
    await pump(4);
    // ⚠️ Scoped, and PR #444's review is why the name says so: this test used
    // to be called "is exactly ONE region in the HUD", and it holds only with
    // no notice standing. A road notice and a gradient fault are #394's event
    // regions, each live while it is shown, so the HUD can carry three. What
    // #395 asks for is ONE region fed from a throttle; those two are one-off
    // events the throttle does not see — `announce.ts` §"Ranks 1, 2 and 4".
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

describe('the road ahead, through the same region — #399', () => {
  it('says a climb is coming, from the ride the rider is on', async () => {
    routes = [hillyRoute()];
    chooseAnnouncements({
      powerEverySeconds: 'never',
      distanceEvery: 'never',
      climbLeadMetres: 250,
    });
    await startRide();
    const said = await pumpUntil(/^Climb/, 400);
    expect(said).toMatch(/^Climb in 250 metres, [5-7] percent$/);
  });

  it('says nothing about a climb when that row is never', async () => {
    routes = [hillyRoute()];
    chooseAnnouncements({
      powerEverySeconds: 'never',
      distanceEvery: 'never',
      climbLeadMetres: 'never',
    });
    await startRide();
    await pump(400);
    expect(region()?.textContent).toBe('');
  });

  it('says the distance to go the HUD is showing, on the rider’s tick', async () => {
    chooseAnnouncements({ powerEverySeconds: 'never', distanceEvery: 0.5 });
    await startRide();
    const said = await pumpUntil(/to go$/, 400);
    const mark = Number(/^([\d.]+) kilometres to go$/.exec(said)?.[1]);
    // The screen, read at the moment it was said: the mark just crossed, so
    // the rendered countdown is under it and not a whole tick under it. Read
    // off the HUD rather than restated, so the two cannot drift apart.
    const shown = renderedToGo();
    expect(Number.isFinite(mark), `nothing was said: "${said}"`).toBe(true);
    expect(shown).toBeLessThanOrEqual(mark);
    expect(shown).toBeGreaterThan(mark - 0.5);
  });
});
