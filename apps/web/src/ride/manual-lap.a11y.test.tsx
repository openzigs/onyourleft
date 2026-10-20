// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * *Lap* on the Ride screen — #1318, through the real shell: a control a
 * keyboard and a screen reader reach, offered only where a lap can be taken,
 * and the lap it ends said ONCE — by the screen's one region with
 * announcements on, by the notice itself as a status message with them off.
 *
 * ⚠️ **Through `AppShell` at the Ride route**, for
 * `side-camera-ride-screen.a11y.test.tsx`'s reason: `lap` is an optional prop
 * threaded through JSX to the region, and `check:wiring` cannot see a screen
 * that stops passing it. The controller is the stub: what a press DOES is
 * `controller.test.ts` §"#1318"'s, through the real recorder and store.
 *
 * ⚠️ What this cannot establish: that TalkBack speaks it (`docs/validation/
 * 0003`, #393), or the 48 px target, which is layout — measured in the
 * browser gate (`ride-targets.browser.spec.ts`), never in jsdom.
 */

import { metres, seconds, unixSeconds, watts, beatsPerMinute } from '@onyourleft/domain';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auditAccessibility, formatViolations } from '../a11y/audit';
import * as core from '../game/hud/announce';
import { ANNOUNCEMENTS_STORAGE_KEY, DEFAULT_ANNOUNCEMENTS } from '../game/hud/announce-preference';
import type { LapFigures } from '../recording/laps';
import { AppShell } from '../shell/AppShell';
import { hrefFor, routeById } from '../shell/routes';
import type { CapabilityProbe } from '../support/bluetooth-support';
import { mount, settle, type Mounted } from '../testing/mount';

import type { RideSnapshot } from './controller';
import { ridingSnapshot, stubRideController, type StubRideController } from './testing';

vi.mock('../game/hud/announce', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../game/hud/announce')>();
  return { ...actual, announce: vi.fn(actual.announce) };
});

const NO_BLUETOOTH: CapabilityProbe = { bluetooth: undefined, secureContext: true };

/** Five minutes twelve seconds, 2.4 km, 210 W, 150 bpm. */
const LAP: LapFigures = {
  startedAt: unixSeconds(1_800_000_000),
  elapsedTime: seconds(330),
  movingTime: seconds(312),
  distance: metres(2_400),
  averagePower: watts(210),
  maxPower: watts(400),
  averageHeartRate: beatsPerMinute(150),
  maxHeartRate: beatsPerMinute(171),
};
const SAID =
  'Lap 2: 5 minutes 12 seconds, 2.4 km, average power 210 watts, average heart rate 150.';
const SHOWN = '5:12 · 2.4 km · 210 W · 150 bpm.';

let mounted: Mounted | undefined;
let stub: StubRideController | undefined;

beforeEach(() => {
  vi.mocked(core.announce).mockClear();
  globalThis.location.hash = hrefFor(routeById('ride'));
});

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  stub = undefined;
  globalThis.location.hash = '';
  localStorage.clear();
});

async function open(
  snapshot: Partial<RideSnapshot>,
  announcements: boolean,
): Promise<StubRideController> {
  localStorage.setItem(
    ANNOUNCEMENTS_STORAGE_KEY,
    JSON.stringify({ ...DEFAULT_ANNOUNCEMENTS, enabled: announcements }),
  );
  const opened = stubRideController({ ...ridingSnapshot(), ...snapshot });
  stub = opened;
  mounted = await mount(
    <AppShell capabilities={NO_BLUETOOTH} rideController={opened.controller} />,
  );
  await settle();
  return opened;
}

async function set(next: Partial<RideSnapshot>): Promise<void> {
  await act(async () => {
    stub?.set(next);
    await Promise.resolve();
  });
  await settle();
}

const lapButton = (): HTMLButtonElement | undefined =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (each) => each.textContent === 'Lap',
  );
/** The lap's notice: its outer box, found by its label. */
const noticeLabel = (): Element | undefined =>
  [...document.querySelectorAll('.oyl-ride__group--live .oyl-status__label')].find(
    (each) => each.textContent === 'Lap 2: ',
  );
const notice = (): Element | null | undefined => noticeLabel()?.parentElement?.parentElement;
/** What the notice reads, its glyph aside (that is `aria-hidden`). */
const noticeText = (): string | null | undefined => noticeLabel()?.parentElement?.textContent;
const region = (): string =>
  document.querySelector('[data-oyl-announcer="ride"]')?.textContent ?? '<no region>';
const lapsHandedOver = (): number =>
  vi
    .mocked(core.announce)
    .mock.calls.filter(([, input]) =>
      (input.events ?? []).some((event) => event.kind === 'lap-ended'),
    ).length;

const AVAILABLE = { manualLap: { available: true, last: undefined } };
const ENDED = { manualLap: { available: true, last: { number: 2, lap: LAP } } };

describe('Lap on the Ride screen — #1318', () => {
  it('is a button a keyboard and a screen reader reach, first in the row with Pause between it and Stop (#1430), and a press takes a lap', async () => {
    const opened = await open(AVAILABLE, true);

    const button = lapButton();
    expect(button).toBeDefined();
    expect(button?.disabled).toBe(false);
    expect(button?.tabIndex).toBe(0);
    expect(button?.getAttribute('aria-hidden')).toBeNull();
    const row = [...(button?.parentElement?.querySelectorAll('button') ?? [])].map(
      (each) => each.textContent,
    );
    // #1432: the touch lock is last in the row, after Stop.
    expect(row).toEqual(['Lap', 'Pause', 'Stop', 'Touch lock']);
    button?.focus();
    expect(document.activeElement).toBe(button);

    await act(async () => {
      button?.click();
      await Promise.resolve();
    });
    expect(opened.calls.markLap).toBe(1);
    expect(formatViolations(auditAccessibility(document))).toBe('');
  });

  it('is not offered where no lap can be taken: a course under the ride, a stop armed, nothing recording', async () => {
    await open({ manualLap: { available: false, last: undefined } }, true);
    expect(lapButton()).toBeUndefined();
    // The control for the case above: the same screen, a lap available.
    await set(AVAILABLE);
    expect(lapButton()).toBeDefined();
    await set({ stopArmed: true });
    expect(lapButton()).toBeUndefined();
  });

  it('shows the lap just ended, and the region says it once, with announcements on', async () => {
    await open(AVAILABLE, true);
    expect(notice()).toBeUndefined();

    await set(ENDED);
    expect(noticeText()).toBe(`Lap 2: ${SHOWN}`);
    // One voice: the region's, so the notice is no status message.
    expect(notice()?.getAttribute('role')).toBeNull();
    expect(region()).toBe(SAID);
    expect(lapsHandedOver()).toBe(1);

    // Another render of the same lap says nothing more.
    await set({ elapsedSeconds: 4_000 });
    expect(lapsHandedOver()).toBe(1);
    expect(formatViolations(auditAccessibility(document))).toBe('');
  });

  it('with announcements off, the notice is itself the status message and the region says nothing', async () => {
    await open(AVAILABLE, false);

    await set(ENDED);
    expect(notice()?.getAttribute('role')).toBe('status');
    expect(region()).not.toContain('Lap 2');
  });

  it('does not say a lap that ended before the screen opened', async () => {
    await open(ENDED, true);

    expect(noticeText()).toBe(`Lap 2: ${SHOWN}`);
    expect(region()).not.toContain('Lap 2');
    expect(lapsHandedOver()).toBe(0);
  });
});
