// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The Devices screen with pairing on it, audited — #659, #48 criterion 4.
 *
 * Named `*.a11y.test.tsx` so `test:a11y` selects it. `routes.a11y.test.tsx`
 * renders every route through `AppShell` with no ports, so there Devices is
 * handed no ride controller and renders no pairing control at all: the
 * screen a rider actually pairs on would sit outside the one gate built to
 * check it — #142's shape, a selector that looks complete over a population it
 * never reached. So it is rendered here, in both platforms' can-pair states,
 * with a device paired and a pairing failure showing, and the keyboard walk is
 * asserted against the audit's own tab-order model.
 */

import { mayShowDeviceList, permissionNotice } from '@onyourleft/mobile';
import { afterEach, describe, expect, it } from 'vitest';

import { auditAccessibility, formatViolations, tabbableElements } from '../a11y/audit';
import { ridingSnapshot, stubRideController } from '../ride/testing';
import type { CapabilityProbe } from '../support/bluetooth-support';
import { capacitorShellSupport } from '../support/shell-support';
import { activateWithKeyboard, mount, settle, type Mounted } from '../testing/mount';

import { DevicesView } from './DevicesView';

const CAPABLE: CapabilityProbe = {
  bluetooth: {
    getAvailability: async () => Promise.resolve(true),
    requestDevice: async () => Promise.reject(new Error('no chooser in a test')),
  },
  secureContext: true,
};

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

function expectClean(where: string): void {
  const violations = auditAccessibility(document);
  expect(
    violations.length === 0 ? '' : `${where}\n${formatViolations(violations)}`,
    `accessibility violations on ${where}`,
  ).toBe('');
}

/** The stub mid-ride, with a pairing failure on screen as well. */
function busyController(): ReturnType<typeof stubRideController> {
  const stub = stubRideController(ridingSnapshot());
  stub.set({ pairingError: 'That sensor is already paired.' });
  return stub;
}

describe('the Devices screen, pairing', () => {
  it('passes the audit in a browser', async () => {
    const stub = busyController();
    mounted = await mount(
      <main>
        <h1>Devices</h1>
        <DevicesView capabilities={CAPABLE} controller={stub.controller} />
      </main>,
    );
    await settle();
    expectClean('Devices in a browser, a trainer paired and a pairing failure showing');
  });

  it('passes the audit inside the Android shell, where the plugin answers (#284)', async () => {
    const stub = busyController();
    const shell = capacitorShellSupport({
      availability: async () => Promise.resolve({ kind: 'available' }),
      notice: permissionNotice,
      mayShowDeviceList,
    });
    mounted = await mount(
      <main>
        <h1>Devices</h1>
        <DevicesView capabilities={CAPABLE} shell={shell} controller={stub.controller} />
      </main>,
    );
    await settle();
    expectClean('Devices in the Android shell, pairing');
    // The plugin's answer is what put the controls here — the WebView's probe
    // above is ignored inside the shell, and the summary says "phone".
    expect(document.querySelector('summary')?.textContent).toBe(
      'What this phone can and cannot do',
    );
  });

  it('is walked by keyboard: pairing first, then each forget, then the disclosure', async () => {
    const stub = busyController();
    mounted = await mount(
      <main>
        <h1>Devices</h1>
        <DevicesView capabilities={CAPABLE} controller={stub.controller} />
      </main>,
    );
    await settle();

    const stops = tabbableElements(document).map((each) => each.textContent?.trim());
    expect(stops).toEqual([
      'Forget KICKR 1F2A',
      'Pair a smart trainer',
      'Pair a heart rate strap',
      'Pair a power meter',
      'Pair a speed or cadence sensor',
      'What this browser can and cannot do',
    ]);

    const pair = tabbableElements(document).find(
      (each) => each.textContent?.trim() === 'Pair a power meter',
    );
    if (pair === undefined) throw new Error('no tab stop for the power meter');
    await activateWithKeyboard(pair);
    expect(stub.calls.pair).toEqual(['power-meter']);
  });
});
