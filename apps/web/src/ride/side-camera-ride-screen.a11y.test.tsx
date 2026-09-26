// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The side camera on the Ride screen — #551, through the real shell.
 *
 * ⚠️ **Through `AppShell` at the Ride route**, for `game/side-camera-hud.a11y
 * .test.tsx`'s reason: `sidePairing` is an optional prop threaded through
 * JSX, and `check:wiring` cannot see a shell that stops passing it.
 *
 * The lost link is counted at the announcer's entrance for that file's reason
 * too: a region re-set to the same words changes nothing in the DOM.
 */

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auditAccessibility, formatViolations } from '../a11y/audit';
import { scriptedSidePairing } from '../camera/testing';
import * as core from '../game/hud/announce';
import { AppShell } from '../shell/AppShell';
import { hrefFor, routeById } from '../shell/routes';
import type { CapabilityProbe } from '../support/bluetooth-support';
import { mount, settle, type Mounted } from '../testing/mount';

import { SIDE_CAMERA_LOST_SENTENCE } from './side-camera';
import { ridingSnapshot, stubRideController } from './testing';

vi.mock('../game/hud/announce', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../game/hud/announce')>();
  return { ...actual, announce: vi.fn(actual.announce) };
});

const NO_BLUETOOTH: CapabilityProbe = { bluetooth: undefined, secureContext: true };

let mounted: Mounted | undefined;

beforeEach(() => {
  vi.mocked(core.announce).mockClear();
  globalThis.location.hash = hrefFor(routeById('ride'));
});

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  globalThis.location.hash = '';
});

async function open(pairing: ReturnType<typeof scriptedSidePairing>): Promise<void> {
  const stub = stubRideController(ridingSnapshot());
  mounted = await mount(
    <AppShell capabilities={NO_BLUETOOTH} rideController={stub.controller} sidePairing={pairing} />,
  );
  await settle();
}

async function set(
  pairing: ReturnType<typeof scriptedSidePairing>,
  next: Parameters<ReturnType<typeof scriptedSidePairing>['set']>[0],
): Promise<void> {
  await act(async () => {
    pairing.set(next);
    await Promise.resolve();
  });
  await settle();
}

const line = (): Element | null => document.querySelector('.oyl-ride__side-camera');
const region = (): string =>
  document.querySelector('[data-oyl-announcer="ride"]')?.textContent ?? '<no region>';
const lostHandedOver = (): number =>
  vi
    .mocked(core.announce)
    .mock.calls.filter(([, input]) =>
      (input.events ?? []).some((event) => event.kind === 'side-camera-lost'),
    ).length;

describe('the side camera on the Ride screen — #551', () => {
  it('shows the phone filming, and stops it from here', async () => {
    const pairing = scriptedSidePairing({ phone: 'filming' });
    await open(pairing);

    expect(line()?.textContent).toContain('Side camera: filming.');
    const stop = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
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
    await open(scriptedSidePairing({ phone: 'pairing', answered: false }));

    expect(document.querySelector('.oyl-ride')).not.toBeNull();
    expect(line()).toBeNull();
  });

  it('follows the phone to stopped, and stops offering a stop', async () => {
    const pairing = scriptedSidePairing({ phone: 'filming' });
    await open(pairing);
    await set(pairing, { phone: 'stopped', stopReason: 'tablet' });

    expect(line()?.textContent).toContain('Side camera: stopped.');
    expect(document.body.textContent).not.toContain('Stop side camera');
  });

  it('says a lost link through the screen’s one region, once, when it goes', async () => {
    const pairing = scriptedSidePairing({ phone: 'filming' });
    await open(pairing);
    expect(lostHandedOver()).toBe(0);

    await set(pairing, { phone: 'lost' });
    expect(line()?.textContent).toContain('link lost');
    expect(region()).toBe(SIDE_CAMERA_LOST_SENTENCE);
    expect(lostHandedOver()).toBe(1);

    // Other changes on the screen do not say it again.
    await set(pairing, { command: { kind: 'stop', status: 'waiting' } });
    expect(lostHandedOver()).toBe(1);
  });

  it('does not announce a link that was already lost when the screen opened', async () => {
    await open(scriptedSidePairing({ phone: 'lost' }));

    expect(line()?.textContent).toContain('link lost');
    expect(lostHandedOver()).toBe(0);
  });

  it('adds no picture and no second live region, and passes the audit', async () => {
    await open(scriptedSidePairing({ phone: 'lost' }));

    expect(line()?.querySelectorAll('img, video, canvas, picture').length).toBe(0);
    expect(line()?.querySelectorAll('[role="status"], [role="alert"], [aria-live]').length).toBe(0);
    expect(formatViolations(auditAccessibility(document))).toBe('');
  });
});
