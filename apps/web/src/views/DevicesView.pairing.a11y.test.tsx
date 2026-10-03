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

import { deviceId } from '@onyourleft/sensors';

import { auditAccessibility, formatViolations, tabbableElements } from '../a11y/audit';
import { PAIRING_STEPS } from '../ride/SensorPairing';
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

/** The card for one kind of device, found by its heading as a rider finds it. */
function card(kind: string): HTMLElement {
  const heading = [...document.querySelectorAll('h3')].find(
    (each) => each.textContent?.trim() === kind,
  );
  const found = heading?.closest<HTMLElement>('li');
  if (found === null || found === undefined) throw new Error(`no card for “${kind}”`);
  return found;
}

/** What a card says in words, with its decoration (`aria-hidden`) left out. */
function cardWords(element: HTMLElement): string {
  const copy = element.cloneNode(true) as HTMLElement;
  for (const hidden of copy.querySelectorAll('[aria-hidden="true"]')) hidden.remove();
  return (copy.textContent ?? '').replace(/\s+/g, ' ').trim();
}

describe('#942 — the garage: one card per kind of device, its state in words', () => {
  it('gives every kind a card with a glyph that is decoration, and states each state in words', async () => {
    const riding = ridingSnapshot();
    const stub = stubRideController({
      ...riding,
      sensors: [
        ...riding.sensors,
        {
          id: deviceId('strap'),
          name: 'HRM 77',
          role: 'heart-rate',
          capabilities: ['heart-rate'],
          state: 'connecting',
        },
        {
          id: deviceId('pedals'),
          name: 'Pedals 9',
          role: 'power-meter',
          capabilities: ['power'],
          state: 'disconnected',
        },
      ],
    });
    mounted = await mount(
      <main>
        <h1>Devices</h1>
        <DevicesView capabilities={CAPABLE} controller={stub.controller} />
      </main>,
    );
    await settle();

    // One card for each kind, in the order the controller's steps give, each
    // with a picture nobody hears.
    for (const step of PAIRING_STEPS) {
      const glyphs = card(step.kind).querySelectorAll('svg');
      expect(glyphs.length, `${step.kind} has a glyph`).toBe(1);
      expect(glyphs[0]?.getAttribute('aria-hidden')).toBe('true');
    }

    // The state is WORDS (SC 1.4.1): read with every decoration removed.
    expect(cardWords(card('Smart trainer'))).toContain('KICKR 1F2A: Connected');
    expect(cardWords(card('Heart rate strap'))).toContain('HRM 77: Connecting');
    expect(cardWords(card('Power meter'))).toContain(
      'Pedals 9: Disconnected — forget it and pair it again to reconnect',
    );
    expect(cardWords(card('Speed or cadence sensor'))).toContain('Not paired');
    expectClean('Devices as a garage, four states at once');
  });

  it('makes exactly the controller calls it made before, for pairing and forgetting one device', async () => {
    // The snapshot was taken on `main` before the garage, and must not move:
    // the cards are presentation, and #942 changes no call into the
    // controller and no order of operations.
    const stub = stubRideController(ridingSnapshot());
    mounted = await mount(
      <main>
        <h1>Devices</h1>
        <DevicesView capabilities={CAPABLE} controller={stub.controller} />
      </main>,
    );
    await settle();
    const button = (name: string): HTMLElement => {
      const found = tabbableElements(document).find((each) => each.textContent?.trim() === name);
      if (found === undefined) throw new Error(`no button “${name}”`);
      return found;
    };
    await activateWithKeyboard(button('Pair a heart rate strap'));
    await activateWithKeyboard(button('Forget KICKR 1F2A'));
    expect(stub.calls).toMatchInlineSnapshot(`
      {
        "armStop": 0,
        "cancelStop": 0,
        "clearTarget": 0,
        "confirmStop": 0,
        "continueRecovered": [],
        "discardRecovered": [],
        "endWorkout": 0,
        "noteGameRideEnded": [],
        "pair": [
          "heart-rate",
        ],
        "pause": 0,
        "refreshRecoverable": 0,
        "requestControl": 0,
        "resume": 0,
        "saveRecovered": [],
        "setTargetPower": [],
        "start": 0,
        "startNewRide": 0,
        "startWorkout": [],
        "tick": 0,
        "unpair": [
          "kickr",
        ],
      }
    `);
  });
});
