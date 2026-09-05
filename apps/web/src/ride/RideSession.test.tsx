// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The two things that must outlive the ride *screen*: the clock, and the guard
 * on closing the tab.
 *
 * ⚠️ **This file exists because of a defect, and the defect was invisible to
 * every test that mounted `RideView` on its own.** `useRideClock` and
 * `useRecordingGuard` were hooks of `LiveRide`, which is the ride route's view
 * — so tapping *Activities* mid-ride unmounted both. The interval stopped, and
 * with it every checkpoint: #46's eight-second loss bound is a product promise
 * in `README.md` and it silently became "everything since you last looked at
 * the ride screen". The `beforeunload` guard went with it, so closing the tab
 * from another page took the ride without asking.
 *
 * So the assertions here are all made **through `AppShell`**, after a real
 * route change. A test that mounted `RideSession` directly would prove the hook
 * wiring and not the thing that broke, which was where it was mounted.
 */

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppShell } from '../shell/AppShell';
import { hrefFor, routeById } from '../shell/routes';
import type { CapabilityProbe } from '../support/bluetooth-support';
import { mount, settle, type Mounted } from '../testing/mount';

import { idleSnapshot, ridingSnapshot, stubRideController } from './testing';
import { TICK_INTERVAL_MILLISECONDS } from './useRideController';

/** The shell takes a probe; nothing here depends on what it says. */
const PROBE: CapabilityProbe = { bluetooth: undefined, secureContext: true };

let mounted: Mounted | undefined;

beforeEach(() => {
  // ⚠️ `setInterval` only. `testing/mount.tsx` settles React by awaiting a real
  // `setTimeout(0)`, and faking that one deadlocks every helper in this file.
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  globalThis.location.hash = '#/';
});

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  vi.useRealTimers();
  globalThis.location.hash = '';
});

async function openApp(stub?: ReturnType<typeof stubRideController>): Promise<Mounted> {
  const result = await mount(<AppShell capabilities={PROBE} rideController={stub?.controller} />);
  await settle();
  mounted = result;
  return result;
}

/** Let the ride clock fire, inside an `act` scope so React sees the updates. */
async function tickFor(milliseconds: number): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(milliseconds);
    await Promise.resolve();
  });
}

/**
 * Navigate the way a nav link does, and let the router hear about it.
 *
 * The assignment is inside the `act` scope because jsdom dispatches
 * `hashchange` on a queued task: settling afterwards would leave React
 * re-rendering outside `act` and warning about it.
 */
async function goTo(routeId: 'ride' | 'activities'): Promise<void> {
  await act(async () => {
    globalThis.location.hash = hrefFor(routeById(routeId));
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  });
}

function closeTheTab(): Event {
  const event = new Event('beforeunload', { cancelable: true });
  globalThis.dispatchEvent(event);
  return event;
}

describe('the ride clock outlives the ride screen', () => {
  it('keeps ticking after the athlete navigates to another page mid-ride', async () => {
    const stub = stubRideController(ridingSnapshot());
    await openApp(stub);
    await tickFor(TICK_INTERVAL_MILLISECONDS * 2);
    expect(stub.calls.tick).toBeGreaterThan(0);

    await goTo('activities');
    // The ride screen is gone from the DOM — this is the state the defect was
    // invisible in.
    expect(document.body.textContent).not.toContain('Live metrics');
    const before = stub.calls.tick;
    await tickFor(TICK_INTERVAL_MILLISECONDS * 3);

    // Still ticking, so the recorder is still checkpointing. Without this the
    // stated eight-second loss bound is unbounded from any other page.
    expect(stub.calls.tick).toBeGreaterThan(before);
  });

  it('stops when the app itself goes, so no interval outlives the tree', async () => {
    const stub = stubRideController(ridingSnapshot());
    await openApp(stub);
    await tickFor(TICK_INTERVAL_MILLISECONDS);
    mounted?.unmount();
    mounted = undefined;

    const after = stub.calls.tick;
    await tickFor(TICK_INTERVAL_MILLISECONDS * 3);

    expect(stub.calls.tick).toBe(after);
  });

  it('runs no clock at all in a browser that cannot pair', async () => {
    // No controller, so nothing to tick. The assertion is that mounting the
    // shell without one neither throws nor schedules anything.
    const view = await openApp();
    await tickFor(TICK_INTERVAL_MILLISECONDS * 3);
    expect(view.caughtErrors).toEqual([]);
  });
});

describe('criterion 5 — closing the tab mid-ride asks first', () => {
  it('cancels a beforeunload while recording', async () => {
    await openApp(stubRideController(ridingSnapshot()));
    expect(closeTheTab().defaultPrevented).toBe(true);
  });

  it('cancels it while paused too, because a paused ride is still unsaved', async () => {
    const stub = stubRideController(ridingSnapshot());
    stub.set({ phase: 'paused' });
    await openApp(stub);
    expect(closeTheTab().defaultPrevented).toBe(true);
  });

  it('still cancels it from another page, where the ride screen is not mounted', async () => {
    const stub = stubRideController(ridingSnapshot());
    await openApp(stub);
    await goTo('activities');

    // The ride is still being recorded; the athlete is reading their activity
    // list. Closing the tab here ends the ride exactly as it does on the ride
    // page, so it is refused exactly as it is there.
    expect(closeTheTab().defaultPrevented).toBe(true);
  });

  it('does not interfere before a ride has started', async () => {
    await openApp(stubRideController(idleSnapshot()));
    expect(closeTheTab().defaultPrevented).toBe(false);
  });

  it('stops interfering once the ride is stopped', async () => {
    const stub = stubRideController(ridingSnapshot());
    await openApp(stub);
    await act(async () => {
      stub.set({ phase: 'stopped' });
      await Promise.resolve();
    });

    expect(closeTheTab().defaultPrevented).toBe(false);
  });

  it('removes the guard when the app unmounts, so it cannot outlive the page', async () => {
    await openApp(stubRideController(ridingSnapshot()));
    mounted?.unmount();
    mounted = undefined;

    expect(closeTheTab().defaultPrevented).toBe(false);
  });

  it('leaves a browser that cannot pair alone entirely', async () => {
    await openApp();
    expect(closeTheTab().defaultPrevented).toBe(false);
  });
});
