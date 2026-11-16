// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * #2600 — tap a HUD panel to tuck it away, tap its tab to bring it back (the
 * owner's ruling of 2026-11-16, "tap out, tap in"), and the choice is kept
 * between rides, per panel (`ride-chrome-preference.ts`).
 *
 * What is asserted is what a rider and the next ride read back: the panel's
 * content gone from the document and a tab in its place, each panel's one
 * control and the name it says, and what the device has stored — read through
 * `readRideChrome`, and through a second HUD mounted on the same storage,
 * which is how the next ride reads it. Where a tab is DRAWN, and that a tucked
 * panel is small, is the browser gate's (`ride-chrome.browser.spec.ts`): jsdom
 * lays nothing out, and has no `matchMedia`, which `panel-tabs.ts` reads as a
 * tablet.
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
import { panelToggleName } from './HudCore';
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

/** Each panel's one control, in document order. */
function controls(): HTMLButtonElement[] {
  return queryAll<HTMLButtonElement>(mounted?.container ?? document, 'button[data-oyl-tab]');
}

/** The name a control is heard by. */
function nameOf(control: Element): string {
  return control.getAttribute('aria-label') ?? (control.textContent ?? '').trim();
}

function names(): string[] {
  return controls().map(nameOf);
}

/** A panel's control, whichever way it stands. */
function control(word: string): HTMLButtonElement | undefined {
  return controls().find((each) => nameOf(each).startsWith(`${word} panel,`));
}

function within(selector: string): Element | null {
  return mounted?.container.querySelector(selector) ?? null;
}

/** Wait the controls out, under fake timers the caller installed. */
function hidden(): void {
  act(() => {
    vi.advanceTimersByTime(CONTROLS_HIDE_MILLISECONDS);
  });
  expect(within('.oyl-hud')?.getAttribute('data-oyl-controls')).toBe('hidden');
}

const shown = (word: string): string => panelToggleName(word, true);
const tucked = (word: string): string => panelToggleName(word, false);

describe('tap a HUD panel to tuck it away, and its tab to bring it back — #2600', () => {
  it('gives each panel the ride draws one control, whose name says it is shown', async () => {
    await hud();
    expect(names()).toEqual(['Power panel, shown', 'Readings panel, shown', 'Route panel, shown']);
    // No box is drawn on an open panel to press: its control is the keyboard's.
    expect(within('.oyl-hud__tab')).toBeNull();

    await hud({ trainer: { gradePercent: 3, writes: 1 }, profile: loop, laps, lapSeconds: 75 });
    expect(names()).toEqual([
      shown('Power'),
      shown('Readings'),
      shown('Route'),
      shown('Laps'),
      shown('Trainer'),
    ]);

    await hud({ profile: loop, laps, lapSeconds: 75, standings });
    expect(names()).toEqual([shown('Power'), shown('Readings'), shown('Route'), shown('Race')]);

    // The focus readout is one panel (#2383), and its control is the primary's.
    await hud({ layout: { hidden: [], textSize: 'normal', arrangement: 'focus' } });
    expect(names()).toEqual([shown('Power'), shown('Route')]);
  });

  it('tucks a panel away with one tap on it, keeps that on the device, and the next ride opens it tucked', async () => {
    await hud();
    const strip = within('.oyl-hud__route .oyl-hud__profile');
    expect(strip).not.toBeNull();

    tap(strip as Element);

    // The panel's content is gone, and its tab stands in its place.
    expect(within('.oyl-hud__profile')).toBeNull();
    const collapsed = within('.oyl-hud__route.oyl-hud__panel--collapsed');
    expect(collapsed?.querySelector('button.oyl-hud__tab')?.textContent).toBe('Route');
    expect(nameOf(control('Route') as Element)).toBe('Route panel, hidden');
    expect(readRideChrome(localStorage).collapsed).toEqual(['route']);

    // The next ride, from the same device.
    await hud();
    expect(within('.oyl-hud__profile')).toBeNull();
    expect(nameOf(control('Route') as Element)).toBe(tucked('Route'));

    // And one tap on its tab brings it back, for this ride and the next.
    tap(within('button.oyl-hud__tab') as Element);
    expect(within('.oyl-hud__route .oyl-hud__profile')).not.toBeNull();
    expect(nameOf(control('Route') as Element)).toBe(shown('Route'));
    expect(readRideChrome(localStorage).collapsed).toEqual([]);
  });

  it('tucks each panel away on its own, and remembers each', async () => {
    await hud({ trainer: { gradePercent: 3, writes: 1 }, profile: loop, laps, lapSeconds: 75 });
    tap(within('dl.oyl-hud__fields--primary dd') as Element);
    tap(within('.oyl-hud__actions > .oyl-hud__trainer') as Element);
    tap(within('.oyl-hud__laps-row') as Element);
    tap(within('dl.oyl-hud__fields--secondary dd') as Element);

    expect(within('dl.oyl-hud__fields--primary')).toBeNull();
    expect(within('dl.oyl-hud__fields--secondary')).toBeNull();
    expect(within('.oyl-hud__laps.oyl-hud__panel--collapsed')).not.toBeNull();
    expect(within('.oyl-hud__laps-row')).toBeNull();
    // The trainer's line is gone, and its tab is where it stood.
    const trainer = within('.oyl-hud__actions > .oyl-hud__trainer');
    expect(trainer?.textContent).toBe('Trainer');
    // The route panel stayed open.
    expect(within('.oyl-hud__route .oyl-hud__profile')).not.toBeNull();
    expect(readRideChrome(localStorage).collapsed).toEqual([
      'primary',
      'trainer',
      'standings',
      'secondary',
    ]);
  });

  it('tucks nothing for a tap on a control inside a panel', async () => {
    await hud({ profile: loop, laps, lapSeconds: 75, standings });
    const swap = within('.oyl-hud__standings button.oyl-hud__swap');
    expect(swap).not.toBeNull();
    tap(swap as Element);
    // The swap did what it does, and no panel went.
    expect(within('.oyl-hud__laps')).not.toBeNull();
    expect(within('.oyl-hud__panel--collapsed')).toBeNull();
    expect(readRideChrome(localStorage).collapsed).toEqual([]);
  });

  it('answers a key on each panel’s control, and hands focus to the control that takes its place', async () => {
    await hud();
    await activateWithKeyboard(control('Readings') as HTMLElement);
    expect(within('dl.oyl-hud__fields--secondary')).toBeNull();
    expect(document.activeElement).toBe(control('Readings'));
    expect(nameOf(document.activeElement as Element)).toBe(tucked('Readings'));
    await activateWithKeyboard(control('Readings') as HTMLElement);
    expect(within('dl.oyl-hud__fields--secondary')).not.toBeNull();
    expect(document.activeElement).toBe(control('Readings'));
    expect(nameOf(document.activeElement as Element)).toBe(shown('Readings'));
  });

  it('only shows the hidden controls on the first tap on a panel, and tucks it on the next', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    writeRideChrome(localStorage, { autoHide: true, collapsed: ['route'] });
    await hud();
    // A panel's control is not one of the controls that fade.
    for (const each of controls()) expect(each.hasAttribute(HIDES_ATTRIBUTE)).toBe(false);
    hidden();

    // A rider touching the screen to find Pause loses no panel to it.
    tap(within('dl.oyl-hud__fields--secondary dd') as Element);
    expect(within('.oyl-hud')?.getAttribute('data-oyl-controls')).toBe('shown');
    expect(within('dl.oyl-hud__fields--secondary')).not.toBeNull();
    tap(within('dl.oyl-hud__fields--secondary dd') as Element);
    expect(within('dl.oyl-hud__fields--secondary')).toBeNull();

    // A tucked panel's tab is drawn all along, and brings it back at once.
    hidden();
    tap(within('.oyl-hud__route button.oyl-hud__tab') as Element);
    expect(within('.oyl-hud__route .oyl-hud__profile')).not.toBeNull();
  });

  it('tucks a panel on the first tap for a rider who turned the auto-hide off', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    writeRideChrome(localStorage, { autoHide: false, collapsed: [] });
    await hud();
    act(() => {
      vi.advanceTimersByTime(CONTROLS_HIDE_MILLISECONDS);
    });
    tap(within('dl.oyl-hud__fields--secondary dd') as Element);
    expect(within('dl.oyl-hud__fields--secondary')).toBeNull();
  });

  it('is refused by the touch lock, panel and tab alike, and answers a key under it', async () => {
    writeRideChrome(localStorage, { autoHide: true, collapsed: ['route'] });
    await hud();
    const lock = queryAll<HTMLButtonElement>(mounted?.container ?? document, 'button').find(
      (each) => (each.textContent ?? '').trim() === TOUCH_LOCK_NAME,
    );
    tap(lock as HTMLElement);
    tap(within('dl.oyl-hud__fields--primary dd') as Element);
    tap(within('.oyl-hud__route button.oyl-hud__tab') as Element);
    expect(within('dl.oyl-hud__fields--primary')).not.toBeNull();
    expect(within('.oyl-hud__route .oyl-hud__profile')).toBeNull();
    expect(readRideChrome(localStorage).collapsed).toEqual(['route']);
    await activateWithKeyboard(control('Power') as HTMLElement);
    expect(within('dl.oyl-hud__fields--primary')).toBeNull();
  });

  it('tucks nothing on a phone, and draws every panel open whatever is stored', async () => {
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
    expect(names()).toEqual([]);
    expect(within('.oyl-hud__route .oyl-hud__profile')).not.toBeNull();
    expect(within('dl.oyl-hud__fields--primary')).not.toBeNull();
    tap(within('dl.oyl-hud__fields--primary dd') as Element);
    expect(within('dl.oyl-hud__fields--primary')).not.toBeNull();
    // Nothing a phone drew changed what the tablet will open with.
    expect(readRideChrome(localStorage).collapsed).toEqual(['route', 'primary']);
  });
});
