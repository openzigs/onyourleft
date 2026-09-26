// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The side camera on the ride HUD — #551, through the real shell.
 *
 * ⚠️ **Through `AppShell`**, not a `GameView` handed a prop: `sidePairing` is
 * an optional prop threaded through JSX, which `check:wiring` cannot follow
 * (§4j §Limits), so a shell that stopped passing it would leave every other
 * test here green. This starts a ride the way a rider does and reads the HUD.
 *
 * What it holds:
 *
 * - the line is on the HUD while paired — filming, stopped — and a lost link
 *   is in the notice slot instead;
 * - the lost link is handed to the HUD's ONE announcer once, when it goes,
 *   and not on every frame after — counted at the announcer's own entrance,
 *   because a region re-set to the same words changes nothing in the DOM and
 *   could not tell once from sixty times;
 * - *Stop side camera* sends the phone a stop;
 * - no picture element joins the stage, and no second live region does.
 *
 * What it cannot say: that TalkBack speaks the sentence. That is
 * `docs/validation/0003` (#393).
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
import { scriptedSidePairing } from '../camera/testing';
import { SIDE_CAMERA_LOST_SENTENCE } from '../ride/side-camera';
import { AppShell } from '../shell/AppShell';
import { hrefFor, routeById } from '../shell/routes';
import type { CapabilityProbe } from '../support/bluetooth-support';
import { mount, settle, type Mounted } from '../testing/mount';

import type { GamePort, RidableRoute } from './GameView';
import * as core from './hud/announce';
import type { GameRenderer } from './port';

vi.mock('./hud/announce', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./hud/announce')>();
  return { ...actual, announce: vi.fn(actual.announce) };
});

const NO_BLUETOOTH: CapabilityProbe = { bluetooth: undefined, secureContext: true };

function ridableRoute(): RidableRoute {
  const points: RoutePoint[] = [];
  for (let index = 0; index <= 200; index += 1) {
    points.push({
      position: geographicPosition(
        degreesLatitude(51.5 + (index * 10) / 111_320),
        degreesLongitude(-0.12),
      ),
      elevation: altitudeMetres(10),
    });
  }
  return { id: 'route-1', name: 'Flat', profile: routeProfile(points), attempts: 0 };
}

const GAME: GamePort = {
  listRoutes: () => Promise.resolve([ridableRoute()]),
  loadGhost: () => Promise.resolve(undefined),
  readSensors: () => ({
    rider: { power: watts(200), live: true, paired: true },
    cadence: { value: 88, live: true, paired: true },
    heartRate: { value: 140, live: true, paired: true },
  }),
};

const RENDERER: GameRenderer = {
  loadRealisticWorld: () => Promise.reject(new Error('no realistic world was chosen')),
  create: () => ({
    hasContext: true,
    render: () => undefined,
    setQuality: () => undefined,
    resize: () => undefined,
    destroy: () => undefined,
  }),
};

let frames: FrameRequestCallback[] = [];
let clock = 0;
let mounted: Mounted | undefined;

beforeEach(() => {
  frames = [];
  clock = 0;
  vi.mocked(core.announce).mockClear();
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

async function ride(pairing: ReturnType<typeof scriptedSidePairing>): Promise<void> {
  mounted = await mount(
    <AppShell
      capabilities={NO_BLUETOOTH}
      game={GAME}
      gameRenderer={() => Promise.resolve(RENDERER)}
      sidePairing={pairing}
    />,
  );
  await settle();
  const start = [...document.querySelectorAll<HTMLButtonElement>('button')].find((each) =>
    (each.textContent ?? '').startsWith('Ride '),
  );
  if (start === undefined) throw new Error('the picker offers no ride');
  await act(async () => {
    start.click();
    await Promise.resolve();
  });
  await settle();
}

/** Run `count` animation frames, a second apart on the page's clock. */
async function frame(count = 1): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    clock += 1000;
    vi.spyOn(performance, 'now').mockReturnValue(clock);
    await act(async () => {
      const due = frames;
      frames = [];
      for (const callback of due) callback(clock);
      await Promise.resolve();
    });
  }
}

const actions = (): Element | null => document.querySelector('.oyl-hud__actions');
const notices = (): Element | null => document.querySelector('.oyl-hud__notices');
const hudRegion = (): string =>
  document.querySelector('[data-oyl-announcer="hud"]')?.textContent ?? '<no region>';

/** How many times the ride handed the announcer a lost side-camera link. */
const lostHandedOver = (): number =>
  vi
    .mocked(core.announce)
    .mock.calls.filter(([, input]) =>
      (input.events ?? []).some((event) => event.kind === 'side-camera-lost'),
    ).length;

describe('the side camera on the ride HUD — #551', () => {
  it('shows the phone filming in the actions panel, with a way to stop it', async () => {
    const pairing = scriptedSidePairing({ phone: 'filming' });
    await ride(pairing);
    await frame();

    expect(actions()?.textContent).toContain('Side camera: filming.');
    // A steady state is not an exception: nothing in the notice slot.
    expect(notices()?.textContent ?? '').not.toContain('Side camera');

    const stop = [...document.querySelectorAll<HTMLButtonElement>('.oyl-hud button')].find(
      (each) => each.textContent === 'Stop side camera',
    );
    expect(stop).toBeDefined();
    await act(async () => {
      stop?.click();
      await Promise.resolve();
    });
    expect(pairing.commands).toEqual(['stop']);
  });

  it('shows nothing with no pairing — the control for the case above', async () => {
    const pairing = scriptedSidePairing({ phone: 'pairing', answered: false });
    await ride(pairing);
    await frame();

    expect(document.querySelector('.oyl-hud')).not.toBeNull();
    expect(document.body.textContent).not.toContain('Side camera');
  });

  it('says stopped, and offers no stop once it has', async () => {
    const pairing = scriptedSidePairing({ phone: 'filming' });
    await ride(pairing);
    await frame();
    await act(async () => {
      pairing.set({ phone: 'stopped', stopReason: 'rider' });
      await Promise.resolve();
    });

    expect(actions()?.textContent).toContain('Side camera: stopped.');
    expect(document.body.textContent).not.toContain('Stop side camera');
  });

  it('puts a lost link in the notice slot and says it ONCE, when it goes', async () => {
    const pairing = scriptedSidePairing({ phone: 'filming' });
    await ride(pairing);
    await frame(2);
    expect(lostHandedOver()).toBe(0);

    await act(async () => {
      pairing.set({ phone: 'lost' });
      await Promise.resolve();
    });
    await frame(10);

    expect(notices()?.textContent).toContain('link lost');
    expect(actions()?.textContent).not.toContain('Side camera:');
    // Still stoppable: a stop sent now is heard if the link comes back.
    expect(document.body.textContent).toContain('Stop side camera');
    expect(hudRegion()).toBe(SIDE_CAMERA_LOST_SENTENCE);
    expect(lostHandedOver()).toBe(1);

    // Back, and gone again: that is a second time it happened.
    await act(async () => {
      pairing.set({ phone: 'filming' });
      await Promise.resolve();
    });
    await frame(2);
    await act(async () => {
      pairing.set({ phone: 'lost' });
      await Promise.resolve();
    });
    await frame(2);
    expect(lostHandedOver()).toBe(2);
  });

  it('does not announce a link that was already lost when the ride began', async () => {
    const pairing = scriptedSidePairing({ phone: 'lost' });
    await ride(pairing);
    await frame(5);

    expect(notices()?.textContent).toContain('link lost');
    expect(lostHandedOver()).toBe(0);
  });

  it('adds no picture and no second live region to the stage, and passes the audit', async () => {
    const pairing = scriptedSidePairing({ phone: 'lost' });
    await ride(pairing);
    await frame();

    const stage = document.querySelector('.oyl-game');
    expect(stage?.querySelectorAll('img, video, picture').length).toBe(0);
    // The world's own canvas is the only one.
    expect(stage?.querySelectorAll('canvas').length).toBe(1);
    expect(
      [...(stage?.querySelectorAll('[role="status"], [role="alert"], [aria-live]') ?? [])].map(
        (each) => each.getAttribute('data-oyl-announcer'),
      ),
    ).toEqual(['hud']);
    expect(formatViolations(auditAccessibility(document))).toBe('');
  });
});
