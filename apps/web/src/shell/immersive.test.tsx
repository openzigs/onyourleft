// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * A ride takes the screen over, and hands it back — #423, through the real shell.
 *
 * ## Why this file exists when `game/stage.test.tsx` already tests the callback
 *
 * `GameViewProps.onImmersive` is an **optional prop threaded through JSX**, and
 * CLAUDE.md §4j is explicit that `check:wiring` cannot see one: a shell that
 * never passed it would be a correct, unit-tested `GameView` wired to nothing,
 * with the gate green. `stage.test.tsx` proves the component *says* it has the
 * screen. This proves the shell *listens* — by starting a ride through the real
 * `AppShell`, at the real route, and reading the document.
 *
 * ## What "absent" means here, and why it is not "hidden"
 *
 * Every assertion below is that an element is **not in the document**, never
 * that it carries a class. §4e: the accessibility suite loads no stylesheet, so
 * a header hidden by CSS is still eleven focusable links to `tabbableElements`
 * — and to a keyboard user behind an opaque full-bleed stage it is eleven tab
 * stops with no visible focus.
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

import { tabbableElements } from '../a11y/audit';
import type { GamePort, RidableRoute } from '../game/GameView';
import { UPDATE_REGION_LABEL } from '../offline/UpdateOffer';
import type { UpdateWatcher } from '../offline/update';
import { ridingSnapshot, stubRideController } from '../ride/testing';
import type { CapabilityProbe } from '../support/bluetooth-support';
import { mount, settle, type Mounted } from '../testing/mount';

import { AppShell } from './AppShell';
import { hrefFor, routeById } from './routes';

const NO_BLUETOOTH: CapabilityProbe = { bluetooth: undefined, secureContext: true };

function ridableRoute(): RidableRoute {
  const points: RoutePoint[] = [];
  for (let index = 0; index <= 200; index += 1) {
    points.push({
      position: geographicPosition(
        degreesLatitude(51.5 + (index * 10) / 111_320),
        degreesLongitude(-0.12),
      ),
      elevation: altitudeMetres(index * 0.3),
    });
  }
  return { id: 'route-1', name: 'Test climb', profile: routeProfile(points), attempts: 0 };
}

const GAME: GamePort = {
  listRoutes: () => Promise.resolve([ridableRoute()]),
  loadGhost: () => Promise.resolve(undefined),
  readSensors: () => ({
    rider: { power: watts(240), live: true, paired: true },
    cadence: { value: 85, live: true, paired: true },
    heartRate: { value: 140, live: true, paired: true },
  }),
};

let mounted: Mounted | undefined;
let frames: FrameRequestCallback[] = [];

beforeEach(() => {
  frames = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  globalThis.location.hash = hrefFor(routeById('game'));
});

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  vi.unstubAllGlobals();
  globalThis.location.hash = '';
});

function button(text: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll<HTMLButtonElement>('button')].find((each) =>
    (each.textContent ?? '').startsWith(text),
  );
}

async function press(text: string): Promise<void> {
  const target = button(text);
  if (target === undefined) {
    throw new Error(`the screen offers no "${text}" control`);
  }
  await act(async () => {
    target.click();
    await Promise.resolve();
  });
  await settle();
}

async function openTheGame(
  rideController?: ReturnType<typeof stubRideController>['controller'],
  update?: UpdateWatcher,
): Promise<void> {
  mounted = await mount(
    <AppShell
      capabilities={NO_BLUETOOTH}
      game={GAME}
      rideController={rideController}
      update={update}
    />,
  );
  await settle();
}

/**
 * A watcher with an update already waiting, which is the state the real one is
 * in for as long as a rider has not answered it. It never changes its mind:
 * what is under test is whether the *shell* renders the offer, and a watcher
 * that went quiet on its own would make "absent mid-ride" true of any shell.
 */
function updateWaiting(): { readonly watcher: UpdateWatcher; readonly activations: () => number } {
  let activations = 0;
  return {
    watcher: {
      status: () => 'available',
      subscribe: () => () => undefined,
      activate: () => {
        activations += 1;
      },
      dismiss: () => undefined,
      // #483. This fixture never reaches `superseded`, so the reload is never
      // offered; it is here because `UpdateWatcher` requires it, and a stub
      // that could reload would be a stub that could take a ride away.
      reloadNow: () => undefined,
    },
    activations: () => activations,
  };
}

function updateOffer(): Element | null {
  return document.querySelector(`[aria-label="${UPDATE_REGION_LABEL}"]`);
}

/** The chrome, by the elements that are it. */
function chrome(): Record<string, Element | null> {
  return {
    skipLink: document.querySelector('.oyl-skip-link'),
    header: document.querySelector('header.oyl-header'),
    navigation: document.querySelector('nav[aria-label="Primary"]'),
    summary: document.querySelector('main > p.oyl-muted'),
    footer: document.querySelector('footer.oyl-footer'),
  };
}

describe('a ride takes the screen over — #423', () => {
  it('has all of its chrome while a rider is choosing a route', async () => {
    // The control for everything below. If the picker already had no header,
    // "the header is absent during a ride" would be true of a shell that had
    // simply stopped rendering one.
    await openTheGame();

    for (const [name, element] of Object.entries(chrome())) {
      expect(element, name).not.toBeNull();
    }
    expect(document.querySelector('.oyl-game--riding')).toBeNull();
  });

  it('renders none of it once the ride has started', async () => {
    await openTheGame();
    await press('Ride ');

    expect(document.querySelector('.oyl-game--riding')).not.toBeNull();
    for (const [name, element] of Object.entries(chrome())) {
      expect(element, name).toBeNull();
    }
  });

  it('leaves nothing to tab to but the ride’s own controls', async () => {
    // ⚠️ The reason "absent" rather than "hidden" is a requirement. A header
    // behind an opaque stage is a run of tab stops with no visible focus, and
    // this is the assertion that would find one.
    await openTheGame();
    await press('Ride ');

    const stops = tabbableElements(document.body).map((each) => each.textContent);
    expect(stops).toEqual(['Pause', 'End ride']);
  });

  it('keeps the landmark and the heading that names it', async () => {
    // `main` is labelled by the `h1`. Remove the heading with the rest of the
    // chrome and a screen reader announces a landmark called nothing, on the
    // one screen where a rider cannot stop to work out where they are.
    await openTheGame();
    await press('Ride ');

    const main = document.querySelector('main');
    const heading = document.querySelector('h1');
    expect(heading?.textContent).toBe(routeById('game').title);
    expect(main?.getAttribute('aria-labelledby')).toBe(heading?.id);
    expect(heading?.className).toBe('oyl-visually-hidden');
    expect(document.querySelectorAll('h1')).toHaveLength(1);
  });

  it('does not change the route, so a reload lands on the picker', async () => {
    await openTheGame();
    await press('Ride ');

    expect(globalThis.location.hash).toBe(hrefFor(routeById('game')));
  });

  it('gives all of it back when the ride ends', async () => {
    await openTheGame();
    await press('Ride ');
    await press('End ride');

    for (const [name, element] of Object.entries(chrome())) {
      expect(element, name).not.toBeNull();
    }
    expect(document.querySelector('h1')?.className).toBe('');
  });

  it('gives it back when the rider leaves by the platform’s own Back', async () => {
    // Nothing on the stage navigates — `GameViewProps.onImmersive` says why —
    // so this is the only other way out, and it must not strand a rider on a
    // page with no header.
    await openTheGame();
    await press('Ride ');

    await act(async () => {
      globalThis.location.hash = hrefFor(routeById('about'));
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });
    });
    await settle();

    expect(document.querySelector('h1')?.textContent).toBe(routeById('about').title);
    for (const [name, element] of Object.entries(chrome())) {
      expect(element, name).not.toBeNull();
    }
  });
});

describe('an update is not offered mid-ride, and is not lost — #423', () => {
  // ⚠️ None of the cases above hands the shell an `update` watcher, and the
  // offer renders `null` without one — so "leaves nothing to tab to but the
  // ride's own controls" was asserted over a shell that could never have
  // rendered the offer. #436's review found it by deleting `|| immersive` from
  // `AppShell` and watching this directory stay green. This is the one piece
  // of chrome whose control RELOADS THE PAGE: left rendered it is a tab stop
  // behind an opaque stage, and Enter on it ends the ride by reload rather
  // than by `teardown`.

  it('offers it while a rider is choosing a route', async () => {
    // The control. Without it, "absent during a ride" is true of a watcher
    // this shell never rendered an offer for at all.
    await openTheGame(undefined, updateWaiting().watcher);

    expect(updateOffer()).not.toBeNull();
    const stops = tabbableElements(document.body).map((each) => each.textContent);
    expect(stops).toContain('Update now');
  });

  it('renders no offer once the ride has started, and nothing of it to tab to', async () => {
    const waiting = updateWaiting();
    await openTheGame(undefined, waiting.watcher);
    await press('Ride ');

    expect(document.querySelector('.oyl-game--riding')).not.toBeNull();
    expect(updateOffer()).toBeNull();
    const stops = tabbableElements(document.body).map((each) => each.textContent);
    expect(stops).toEqual(['Pause', 'End ride']);
    expect(waiting.activations()).toBe(0);
  });

  it('offers it again when the ride ends, because the watcher held it', async () => {
    await openTheGame(undefined, updateWaiting().watcher);
    await press('Ride ');
    expect(updateOffer()).toBeNull();
    await press('End ride');

    expect(updateOffer()).not.toBeNull();
    expect(button('Update now')).toBeDefined();
  });
});

describe('a recording outlives the chrome — #423', () => {
  it('still refuses to close the tab on a recording while a ride has the screen', async () => {
    // ⚠️ `RideSession` is mounted in `AppShell` ABOVE the router so that a
    // recording and a workout survive navigation. It renders nothing, so the
    // only way to see that it is still mounted is to watch it work: its unload
    // guard cancels a `beforeunload` for as long as a recording is unsaved.
    // A shell that dropped it along with the header would let the tab close on
    // a ride in progress, silently, on the one screen with no header to notice
    // anything was missing from.
    await openTheGame(stubRideController(ridingSnapshot()).controller);
    await press('Ride ');
    expect(document.querySelector('header.oyl-header')).toBeNull();

    const closing = new Event('beforeunload', { cancelable: true });
    globalThis.dispatchEvent(closing);

    expect(closing.defaultPrevented).toBe(true);
  });
});

describe('which routes keep the reading measure — #422', () => {
  it('marks the Ride screen as instruments on the element the stylesheet bounds', async () => {
    globalThis.location.hash = hrefFor(routeById('ride'));
    await openTheGame();

    expect(document.querySelector('main')?.className).toBe('oyl-main oyl-main--instruments');
  });

  it('leaves a page that is read at the measure', async () => {
    globalThis.location.hash = hrefFor(routeById('about'));
    await openTheGame();

    expect(document.querySelector('main')?.className).toBe('oyl-main oyl-main--prose');
  });
});
