// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The stage, audited — #423, inside the accessibility gate.
 *
 * `a11y/routes.a11y.test.tsx` renders every route in `shell/routes.ts` and
 * audits it, and for the trainer game that is the **route picker**: a route is
 * a URL, and the state a ride has the screen in is not one. So the screen #423
 * builds — no header, no navigation, a visually hidden `h1`, a HUD in four
 * panels — was reachable by no audit at all, which is the shape this
 * repository keeps finding: a gate green over the wrong screen.
 *
 * This renders that state through the real `AppShell` and runs the same
 * fourteen rules over it. The filename carries `.a11y.test.`, which is what
 * `test:a11y` selects on (#142), so a violation here fails the build.
 *
 * ⚠️ **What it cannot see is everything that is layout.** jsdom performs none,
 * so nothing here says a panel is on screen or that a control can be reached —
 * `browser/ride.browser.spec.ts` measures that in the pinned Chromium. What
 * this can say is that removing the chrome did not remove a landmark's name,
 * break the heading order, or leave a reference pointing at something that is
 * no longer in the document.
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
import type { GamePort } from '../game/GameView';
import type { GameTrainerPort } from '../game/trainer-port';
import type { CapabilityProbe } from '../support/bluetooth-support';
import { mount, settle, type Mounted } from '../testing/mount';

import { AppShell } from './AppShell';
import { hrefFor, routeById } from './routes';

const NO_BLUETOOTH: CapabilityProbe = { bluetooth: undefined, secureContext: true };

function points(): RoutePoint[] {
  const found: RoutePoint[] = [];
  for (let index = 0; index <= 200; index += 1) {
    found.push({
      position: geographicPosition(
        degreesLatitude(51.5 + (index * 10) / 111_320),
        degreesLongitude(-0.12),
      ),
      elevation: altitudeMetres(index * 0.3),
    });
  }
  return found;
}

const GAME: GamePort = {
  listRoutes: () =>
    Promise.resolve([
      { id: 'route-1', name: 'Test climb', profile: routeProfile(points()), attempts: 0 },
    ]),
  loadGhost: () => Promise.resolve(undefined),
  readSensors: () => ({
    rider: { power: watts(240), live: true, paired: true },
    cadence: { value: 85, live: true, paired: true },
    // A dropped strap, so the audit meets the HUD's `Sensor lost` markup too.
    heartRate: { value: undefined, live: false, paired: true },
  }),
};

/** A paired trainer with no control, so the notice slot is in the document. */
const NO_CONTROL: GameTrainerPort = {
  readTrainer: () => ({ kind: 'no-control', control: undefined }),
};

let mounted: Mounted | undefined;

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  globalThis.location.hash = hrefFor(routeById('game'));
});

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  vi.unstubAllGlobals();
  globalThis.location.hash = '';
});

async function startARide(): Promise<void> {
  mounted = await mount(
    <AppShell capabilities={NO_BLUETOOTH} game={GAME} gameTrainer={NO_CONTROL} />,
  );
  await settle();
  const ride = [...document.querySelectorAll<HTMLButtonElement>('button')].find((each) =>
    (each.textContent ?? '').startsWith('Ride '),
  );
  if (ride === undefined) {
    throw new Error('the route picker offered no ride');
  }
  await act(async () => {
    ride.click();
    await Promise.resolve();
  });
  await settle();
}

describe('the stage passes the automated audit — #423', () => {
  it('is the screen being audited, and not the picker the route table reaches', async () => {
    // The apparatus check. Every rule passing over the route picker is what
    // `routes.a11y.test.tsx` already proves, and would prove nothing here.
    await startARide();

    expect(document.querySelector('.oyl-game--riding')).not.toBeNull();
    expect(document.querySelector('header.oyl-header')).toBeNull();
    expect(document.querySelector('.oyl-hud__notices')).not.toBeNull();
    expect(document.querySelector('.oyl-hud__field--stale')).not.toBeNull();
  });

  it('has no violation with the chrome absent', async () => {
    await startARide();

    const violations = auditAccessibility(document);
    expect(violations.length === 0 ? '' : formatViolations(violations)).toBe('');
  });
});
