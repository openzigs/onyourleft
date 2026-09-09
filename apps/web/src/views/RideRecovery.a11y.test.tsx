// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The recovery offer, audited — #212.
 *
 * ⚠️ **This file exists because `routes.a11y.test.tsx` cannot reach this
 * markup.** That suite renders every route and audits it, which is what makes a
 * new *route* audited without anyone editing a test — but it renders the ride
 * screen with a stub whose `recoverable` list is empty, and the offer renders
 * **nothing** when there is nothing to offer. So every control added here would
 * have sat outside the one gate in this repository with a real pass/fail line
 * in it, while the suite stayed green and looked like it covered them.
 *
 * Named `*.a11y.test.tsx` so `test:a11y` selects it (§4e), and
 * `scripts/check-a11y-suite.mjs` would catch the reverse mistake.
 */

import { unixSeconds } from '@onyourleft/domain';
import { recordingSessionId } from '@onyourleft/store';
import { afterEach, describe, expect, it } from 'vitest';

import type { BluetoothPort } from '@onyourleft/sensors/web-bluetooth';

import { auditAccessibility, formatViolations, tabbableElements } from '../a11y/audit';
import { formatDuration } from '../format';
import type { RecoverableRide } from '../recording/recovery';
import { idleSnapshot, stubRideController } from '../ride/testing';
import { AppShell } from '../shell/AppShell';
import { routeById } from '../shell/routes';
import type { CapabilityProbe } from '../support/bluetooth-support';
import { mount, settle, type Mounted } from '../testing/mount';

const SPANNED_SECONDS = 4_320;

/** A browser that can pair, so the ride screen renders its full set of controls. */
const WORKING_BLUETOOTH: BluetoothPort = {
  getAvailability: async () => Promise.resolve(true),
  requestDevice: async () => Promise.reject(new Error('no chooser in a test')),
};

const CAPABLE: CapabilityProbe = { bluetooth: WORKING_BLUETOOTH, secureContext: true };

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  globalThis.location.hash = '';
});

function offered(kind: RecoverableRide['kind'], id = 'left-behind'): RecoverableRide {
  return {
    id: recordingSessionId(id),
    kind,
    startedAt: unixSeconds(1_700_000_000),
    lastWrittenAt: unixSeconds(1_700_000_000 + SPANNED_SECONDS),
    spannedSeconds: SPANNED_SECONDS,
    // The screen's own formatter, so this fixture cannot pin a second spelling
    // of a duration the rest of the ride screen writes differently.
    spanned: formatDuration(SPANNED_SECONDS),
    canContinue: kind === 'interrupted',
  };
}

/**
 * The offer inside the shell it actually ships in.
 *
 * ⚠️ Through `AppShell` at the ride route, not through `RideView` alone and
 * certainly not through the offer alone. `auditAccessibility` walks the whole
 * document, and the landmark and heading-order rules cannot be checked against
 * a fragment: `RideView` renders no `main` and no `h1` of its own — the shell
 * does — so mounting it bare reports three violations the shipping screen does
 * not have. That is a false failure, and the way it gets "fixed" is by
 * loosening the audit. `HudPanel.a11y.test.tsx` makes the same argument for the
 * same reason.
 */
async function show(rides: readonly RecoverableRide[]): Promise<Mounted> {
  const stub = stubRideController({ ...idleSnapshot(), recoverable: rides });
  globalThis.location.hash = `#${routeById('ride').path}`;
  mounted = await mount(<AppShell capabilities={CAPABLE} rideController={stub.controller} />);
  await settle();
  return mounted;
}

describe('the offer is inside the accessibility gate', () => {
  it('audits clean with an interrupted ride on offer', async () => {
    await show([offered('interrupted')]);
    expect(formatViolations(auditAccessibility(document))).toBe('');
  });

  it('audits clean with a finished ride that could not be saved', async () => {
    await show([offered('unsaved')]);
    expect(formatViolations(auditAccessibility(document))).toBe('');
  });

  it('audits clean with several at once', async () => {
    await show([offered('interrupted', 'one'), offered('unsaved', 'two')]);
    expect(formatViolations(auditAccessibility(document))).toBe('');
  });

  it('puts every control in the tab order', async () => {
    // A control a keyboard cannot reach is a ride a keyboard user cannot
    // recover, which on this screen means a ride they cannot get back at all.
    await show([offered('interrupted')]);
    const names = tabbableElements(document).map((element) => element.textContent ?? '');
    expect(names).toContain('Continue this ride');
    expect(names).toContain('Save this ride');
    expect(names).toContain('Discard this ride');
  });
});

describe('what the offer says, and what it does not', () => {
  it('offers no Continue for a ride the rider already stopped', async () => {
    // ⚠️ The distinction `recovery.ts` draws, at the screen. A rider who
    // pressed Stop is not shown a control that would restart the ride.
    const view = await show([offered('unsaved')]);
    const text = view.container.textContent ?? '';
    expect(text).toContain('could not be saved');
    expect(text).not.toContain('Continue this ride');
  });

  it('renders nothing at all when the device is holding nothing', async () => {
    // The normal case. A heading that says "no interrupted rides" on every
    // visit trains a rider to stop reading the one place that will ever matter.
    const view = await show([]);
    expect(view.container.textContent ?? '').not.toContain('Rides still on this device');
  });

  it('says the length is an upper bound rather than a measurement', async () => {
    // `recovery.ts` spans start to last checkpoint without decoding the chunks,
    // so a recording with a hole in it recovers less than it says. "up to" is
    // the wording that keeps that honest.
    const view = await show([offered('interrupted')]);
    expect(view.container.textContent ?? '').toContain(`up to ${formatDuration(SPANNED_SECONDS)}`);
  });
});
