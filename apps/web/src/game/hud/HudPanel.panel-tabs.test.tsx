// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * #2600 — each HUD panel collapses to a tab with one tap, and the choice is
 * kept between rides, per panel (`ride-chrome-preference.ts`).
 *
 * What is asserted is what a rider and the next ride read back: the panel's
 * content gone from the document and a tab in its place, and what the device
 * has stored — read through `readRideChrome`, and through a second HUD mounted
 * on the same storage, which is how the next ride reads it. Where a tab is
 * DRAWN, and that a collapsed panel is small, is the browser gate's
 * (`ride-chrome.browser.spec.ts`): jsdom lays nothing out, and has no
 * `matchMedia`, which `panel-tabs.ts` reads as a tablet.
 */

import { act, type JSX } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  routeProfile,
  seconds,
  unixSeconds,
  watts,
  type RoutePoint,
} from '@onyourleft/domain';

import { tap } from '../../design/touch-lock-testing';
import { TOUCH_LOCK_NAME } from '../../design/TouchLockButton';
import { activateWithKeyboard, mount, queryAll, type Mounted } from '../../testing/mount';
import { atStartLine } from '../simulation';
import { CONTROLS_HIDE_MILLISECONDS, HIDES_ATTRIBUTE } from './controls-reveal';
import { PANEL_TAB_SUFFIX } from './HudCore';
import { HudPanel, type HudPanelProps } from './HudPanel';
import { RIDE_CHROME_STORAGE_KEY, readRideChrome, writeRideChrome } from './ride-chrome-preference';

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  localStorage.removeItem(RIDE_CHROME_STORAGE_KEY);
});

function route(loop = false): ReturnType<typeof routeProfile> {
  const points: RoutePoint[] = [];
  for (let index = 0; index <= 8; index += 1) {
    const out = loop && index > 4 ? 8 - index : index;
    points.push({
      position: geographicPosition(
        degreesLatitude(51.5 + (out * 100) / 111_320),
        degreesLongitude(-0.12),
      ),
      elevation: altitudeMetres(loop ? 60 : index),
    });
  }
  return routeProfile(points, { loop });
}

const profile = route();
const loop = route(true);
const laps = [
  {
    startedAt: unixSeconds(1_800_000_000),
    elapsedTime: seconds(312),
    movingTime: seconds(312),
    distance: loop.totalDistance,
    averagePower: watts(205),
  },
];
const standings = {
  place: 1,
  of: 2,
  lines: [
    { riderId: 3, place: 1, who: 'You', gap: '', figure: '3.5 W/kg', flagged: false, you: true },
    {
      riderId: 7,
      place: 2,
      who: 'Bea',
      gap: '+4 s',
      figure: '3.1 W/kg',
      flagged: false,
      you: false,
    },
  ],
};

function ride(more: Partial<HudPanelProps> = {}): JSX.Element {
  return (
    <HudPanel
      profile={profile}
      state={atStartLine(profile)}
      cadence={{ value: 88, live: true }}
      heartRate={{ value: 150, live: true }}
      chases={[]}
      announcement=""
      paused={false}
      onPause={() => undefined}
      onEnd={() => undefined}
      {...more}
    />
  );
}

async function hud(more: Partial<HudPanelProps> = {}): Promise<void> {
  mounted?.unmount();
  mounted = await mount(ride(more));
}

/** A panel's tab, by the word drawn on it. */
function tab(word: string): HTMLButtonElement | undefined {
  return queryAll<HTMLButtonElement>(mounted?.container ?? document, 'button.oyl-hud__tab').find(
    (each) => (each.textContent ?? '').startsWith(`${word}${PANEL_TAB_SUFFIX}`),
  );
}

function tabWords(): string[] {
  return queryAll(mounted?.container ?? document, 'button.oyl-hud__tab').map(
    (each) => (each.textContent ?? '').split(PANEL_TAB_SUFFIX)[0] ?? '',
  );
}

function within(selector: string): Element | null {
  return mounted?.container.querySelector(selector) ?? null;
}

describe('a HUD panel collapses to a tab — #2600', () => {
  it('offers one tab for each panel the ride draws, every one open', async () => {
    await hud();
    expect(tabWords()).toEqual(['Power', 'Readings', 'Route']);
    for (const word of tabWords()) expect(tab(word)?.getAttribute('aria-expanded')).toBe('true');

    await hud({ trainer: { gradePercent: 3, writes: 1 }, profile: loop, laps, lapSeconds: 75 });
    expect(tabWords()).toEqual(['Power', 'Readings', 'Route', 'Laps', 'Trainer']);

    await hud({ profile: loop, laps, lapSeconds: 75, standings });
    expect(tabWords()).toEqual(['Power', 'Readings', 'Route', 'Race']);

    // The focus readout is one panel (#2383), and its tab is the primary's.
    await hud({ layout: { hidden: [], textSize: 'normal', arrangement: 'focus' } });
    expect(tabWords()).toEqual(['Power', 'Route']);
  });

  it('collapses a panel with one tap, keeps it on the device, and the next ride opens collapsed', async () => {
    await hud();
    expect(within('.oyl-hud__route .oyl-hud__profile')).not.toBeNull();

    tap(tab('Route') as HTMLElement);

    // The panel's content is gone, and its tab stands in its place.
    expect(within('.oyl-hud__profile')).toBeNull();
    const collapsed = within('.oyl-hud__route.oyl-hud__panel--collapsed');
    expect(collapsed).not.toBeNull();
    expect(collapsed?.querySelector('button')?.getAttribute('aria-expanded')).toBe('false');
    expect(readRideChrome(localStorage).collapsed).toEqual(['route']);

    // The next ride, from the same device.
    await hud();
    expect(within('.oyl-hud__profile')).toBeNull();
    expect(tab('Route')?.getAttribute('aria-expanded')).toBe('false');

    // And one tap opens it again, for this ride and the next.
    tap(tab('Route') as HTMLElement);
    expect(within('.oyl-hud__route .oyl-hud__profile')).not.toBeNull();
    expect(readRideChrome(localStorage).collapsed).toEqual([]);
  });

  it('collapses each panel on its own, and remembers each', async () => {
    await hud({ trainer: { gradePercent: 3, writes: 1 }, profile: loop, laps, lapSeconds: 75 });
    tap(tab('Power') as HTMLElement);
    tap(tab('Trainer') as HTMLElement);
    tap(tab('Laps') as HTMLElement);
    tap(tab('Readings') as HTMLElement);

    expect(within('.oyl-hud__fields--primary dl, dl.oyl-hud__fields--primary')).toBeNull();
    expect(within('dl.oyl-hud__fields--secondary')).toBeNull();
    expect(within('.oyl-hud__laps.oyl-hud__panel--collapsed')).not.toBeNull();
    expect(within('.oyl-hud__laps-row')).toBeNull();
    // The trainer's line is gone, and its tab is where it stood.
    const trainer = within('.oyl-hud__actions > .oyl-hud__trainer');
    expect(trainer?.textContent).toMatch(/^Trainer/);
    expect(trainer?.textContent).not.toMatch(/%/);
    // The route panel stayed open.
    expect(within('.oyl-hud__route .oyl-hud__profile')).not.toBeNull();
    expect(readRideChrome(localStorage).collapsed).toEqual([
      'primary',
      'trainer',
      'standings',
      'secondary',
    ]);
  });

  it('moves focus to the tab that takes the pressed one’s place', async () => {
    await hud();
    await activateWithKeyboard(tab('Readings') as HTMLElement);
    expect(document.activeElement).toBe(tab('Readings'));
    expect(tab('Readings')?.getAttribute('aria-expanded')).toBe('false');
    await activateWithKeyboard(tab('Readings') as HTMLElement);
    expect(document.activeElement).toBe(tab('Readings'));
    expect(tab('Readings')?.getAttribute('aria-expanded')).toBe('true');
  });

  it('hides an open panel’s tab with the controls, and never a collapsed one’s', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    writeRideChrome(localStorage, { autoHide: true, collapsed: ['route'] });
    await hud();
    expect(tab('Readings')?.hasAttribute(HIDES_ATTRIBUTE)).toBe(true);
    expect(tab('Route')?.hasAttribute(HIDES_ATTRIBUTE)).toBe(false);
    act(() => {
      vi.advanceTimersByTime(CONTROLS_HIDE_MILLISECONDS);
    });
    expect(within('.oyl-hud')?.getAttribute('data-oyl-controls')).toBe('hidden');

    // A hidden tab's first tap only shows the controls.
    tap(tab('Readings') as HTMLElement);
    expect(tab('Readings')?.getAttribute('aria-expanded')).toBe('true');
    act(() => {
      vi.advanceTimersByTime(CONTROLS_HIDE_MILLISECONDS);
    });
    // A collapsed panel's tab is drawn all along, and opens it at once.
    tap(tab('Route') as HTMLElement);
    expect(tab('Route')?.getAttribute('aria-expanded')).toBe('true');
  });

  it('is refused by the touch lock, and answers a key under it', async () => {
    await hud();
    const lock = queryAll<HTMLButtonElement>(mounted?.container ?? document, 'button').find(
      (each) => (each.textContent ?? '').trim() === TOUCH_LOCK_NAME,
    );
    tap(lock as HTMLElement);
    tap(tab('Power') as HTMLElement);
    expect(tab('Power')?.getAttribute('aria-expanded')).toBe('true');
    expect(readRideChrome(localStorage).collapsed).toEqual([]);
    await activateWithKeyboard(tab('Power') as HTMLElement);
    expect(tab('Power')?.getAttribute('aria-expanded')).toBe('false');
  });

  it('offers no tab on a phone, and draws every panel open whatever is stored', async () => {
    vi.stubGlobal(
      'matchMedia',
      (query: string) =>
        ({
          matches: false,
          media: query,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
        }) as unknown as MediaQueryList,
    );
    writeRideChrome(localStorage, { autoHide: true, collapsed: ['route', 'primary'] });
    await hud();
    expect(tabWords()).toEqual([]);
    expect(within('.oyl-hud__route .oyl-hud__profile')).not.toBeNull();
    expect(within('dl.oyl-hud__fields--primary')).not.toBeNull();
    // Nothing a phone drew changed what the tablet will open with.
    expect(readRideChrome(localStorage).collapsed).toEqual(['route', 'primary']);
  });
});
