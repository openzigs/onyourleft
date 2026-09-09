// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The page a person opens with a trainer in front of them.**
 *
 * Unlike its two neighbours in this directory, this harness is not primarily
 * driven by Playwright — it is driven by a rider, once, in the session
 * `docs/validation/0001-trainer-and-sensors.md` describes. It lives here anyway
 * for the reason `vite.browser.config.ts` exists at all: this is the second
 * build, the one that can never reach a shipped bundle. A capture tool wired
 * into `apps/web/index.html` would be a route in the product that writes to a
 * trainer's control point, and nobody wants that on a public URL.
 *
 * ## What it is made of, and why none of it is a stand-in
 *
 * The transport is the **real** `createWebBluetoothTransport` over the **real**
 * `navigator.bluetooth`, carrying the **real** four ride profiles from
 * `main.tsx`; trainer control is the **real** `openWebBluetoothTrainer`, so the
 * bounding, the quantisation and the feature gating are the shipping ones. The
 * only thing added is `recordingBluetooth`, which sits at the platform boundary
 * and writes down what crosses it. So a capture taken here is a capture of the
 * product, which is the whole claim #134 and #137 rest on — a recording of a
 * special code path would be evidence about the special code path.
 *
 * ## What the browser gate can and cannot check here
 *
 * A headless runner has no Bluetooth adapter, so nothing about a real device is
 * checkable in CI and `capture.browser.spec.ts` does not pretend otherwise. What
 * it does check is the failure that would actually waste a validation session:
 * that this page loads, that `recordingBluetooth` wraps the **real**
 * `navigator.bluetooth` without deforming it, and that the wrapped port gives
 * the same availability answer as the raw one. jsdom cannot make that claim —
 * it has no `navigator.bluetooth` at all, so the Vitest suite only ever sees
 * the fake stack.
 */

import { metres, watts } from '@onyourleft/domain';
import type { DeviceId, MeasurementCapability } from '@onyourleft/sensors';
import {
  createCyclingPowerProfile,
  createCyclingSpeedCadenceProfile,
  createIndoorBikeDataProfile,
  heartRateProfile,
} from '@onyourleft/sensors/protocol';
import {
  createWebBluetoothTransport,
  readAvailability,
  type BluetoothPort,
} from '@onyourleft/sensors/web-bluetooth';

import { probeBrowser } from '../src/support/bluetooth-support';
import { createCapture, recordingBluetooth } from '../src/validation/capture';
import { openWebBluetoothTrainer, type TrainerConnection } from '../src/ride/trainer';
import { saveWithAnchor } from '../src/transfer/browser';

declare global {
  interface Window {
    __oylCaptureHarness?: {
      readonly ready: boolean;
      /** What the wrapped port says. The one the transport is actually given. */
      readonly availability: string;
      /** What the raw `navigator.bluetooth` says. The two must agree. */
      readonly availabilityUnwrapped: string;
      readonly wrapped: boolean;
      readonly events: number;
      readonly errors: readonly string[];
    };
  }
}

const DEFAULT_WHEEL_CIRCUMFERENCE = metres(2.105);

const capture = createCapture();
const errors: string[] = [];
let availability = 'unknown';
let availabilityUnwrapped = 'unknown';
let wrapped = false;
let ready = false;

function publish(): void {
  window.__oylCaptureHarness = {
    ready,
    availability,
    availabilityUnwrapped,
    wrapped,
    events: capture.events.length,
    errors: [...errors],
  };
}

function element<Type extends HTMLElement>(id: string): Type {
  const found = document.querySelector<Type>(`#${id}`);
  if (found === null) {
    throw new Error(`the page is missing #${id}`);
  }
  return found;
}

function log(line: string): void {
  const at = element('log');
  at.textContent = `${at.textContent ?? ''}${line}\n`;
  at.scrollTop = at.scrollHeight;
  element('counts').textContent = `${String(capture.events.length)} events captured.`;
  publish();
}

function report(what: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  errors.push(`${what}: ${message}`);
  log(`✗ ${what}: ${message}`);
}

/**
 * The four profiles the ride screen uses, unchanged.
 *
 * ⚠️ Deliberately the same list as `main.tsx`'s `rideProfiles`, and it has to
 * stay so: a capture taken with a narrower set would be a capture of a decoder
 * nobody ships. There is no shared constant because `main.tsx` is a composition
 * root and exporting from it would give this page a path into the app's own
 * bundle graph.
 */
function rideProfiles() {
  return [
    createIndoorBikeDataProfile(),
    createCyclingPowerProfile(),
    createCyclingSpeedCadenceProfile({ wheelCircumference: DEFAULT_WHEEL_CIRCUMFERENCE }),
    heartRateProfile,
  ];
}

const paired = new Map<DeviceId, MeasurementCapability>();
let trainer: TrainerConnection | undefined;

async function start(): Promise<void> {
  // The shipping probe, not a read of `navigator` here: `probeBrowser` is
  // documented as the only place in the client that touches these globals, and
  // it also reads `isSecureContext` — which withholds Web Bluetooth entirely
  // and is the first thing to suspect when a page served over plain HTTP from a
  // laptop to a phone cannot see a radio that is plainly switched on.
  const probe = probeBrowser();
  const port: BluetoothPort | undefined = probe.bluetooth;
  if (port === undefined) {
    availability = 'unsupported';
    availabilityUnwrapped = 'unsupported';
    element('availability').textContent = probe.secureContext
      ? 'This browser has no Web Bluetooth. Chrome or Edge on Windows, macOS, Linux or Android; ' +
        'Safari and Firefox implement none of it.'
      : 'This page is not in a secure context, and Web Bluetooth is withheld entirely outside ' +
        'one. Serve it over HTTPS, or from localhost.';
    ready = true;
    publish();
    return;
  }

  const recording = recordingBluetooth(port, capture);
  wrapped = true;
  // Both, and the spec compares them. A wrapper that deformed the port would
  // show up here as a disagreement rather than as a mystery three months later
  // with a trainer on the desk.
  availabilityUnwrapped = (await readAvailability(port)).kind;
  availability = (await readAvailability(recording)).kind;

  const transport = createWebBluetoothTransport({ profiles: rideProfiles(), bluetooth: recording });
  const openTrainer = openWebBluetoothTrainer(transport);

  element('availability').textContent =
    availability === 'available'
      ? 'Bluetooth is available. Pair a device below.'
      : `Bluetooth reports "${availability}" — pairing will not work until that changes.`;

  const pair = (capability: MeasurementCapability) => async (): Promise<void> => {
    try {
      // ⚠️ Called straight from the click handler's own task. Web Bluetooth
      // requires a user gesture per device and an `await` before `requestDevice`
      // spends it, which is why nothing is awaited above this line.
      const device = await transport.discover({ capabilities: [capability] });
      await transport.connect(device.identity.id);
      paired.set(device.identity.id, capability);
      await transport.subscribe(device.identity.id, capability, () => {
        // The frames are captured at the platform boundary, so this listener
        // deliberately does nothing with the decoded measurement. It exists
        // because a subscription is what makes the device notify at all.
      });
      element('devices').textContent = `${String(paired.size)} device(s) paired and streaming.`;
      log(`✓ paired a ${capability} device and subscribed`);
    } catch (error: unknown) {
      report(`pairing a ${capability} device`, error);
    }
  };

  element('pair-power').addEventListener('click', () => void pair('power')());
  element('pair-cadence').addEventListener('click', () => void pair('cadence')());
  element('pair-heart-rate').addEventListener('click', () => void pair('heart-rate')());

  element('open-trainer').addEventListener('click', () => {
    void (async (): Promise<void> => {
      const first = [...paired.keys()][0];
      if (first === undefined) {
        report('opening the trainer', new Error('pair a power source first'));
        return;
      }
      try {
        const connection = await openTrainer(first);
        if (connection === undefined) {
          report(
            'opening the trainer',
            new Error('this device serves no fitness machine, or reported no power range'),
          );
          return;
        }
        trainer = connection;
        await connection.control.requestControl();
        const range = connection.powerRange;
        element('trainer').textContent =
          `Control granted. ${String(range.minimum)}–${String(range.maximum)} W in steps of ` +
          `${String(range.increment)}. ERG ${connection.canSetPower ? 'available' : 'not offered'}; ` +
          `gradient ${connection.canSimulate ? 'available' : 'not offered'}.`;
        log('✓ opened the fitness machine and was granted control');
      } catch (error: unknown) {
        report('opening the trainer', error);
      }
    })();
  });

  element('set-target').addEventListener('click', () => {
    void (async (): Promise<void> => {
      const control = trainer;
      if (control === undefined) {
        report('setting a target', new Error('take control first'));
        return;
      }
      const target = Number(element<HTMLInputElement>('target').value);
      if (!Number.isFinite(target)) {
        report('setting a target', new Error('the target is not a number'));
        return;
      }
      try {
        // Through the shipping client, so what is captured is what a rider's
        // workout would send — quantised to the machine's own increment and
        // bounded by its own reported range.
        const confirmed = await control.control.setTargetPower(watts(target));
        log(`✓ asked for ${String(target)} W, machine confirmed ${String(confirmed)} W`);
      } catch (error: unknown) {
        report(`setting a target of ${String(target)} W`, error);
      }
    })();
  });

  element('stop-trainer').addEventListener('click', () => {
    void (async (): Promise<void> => {
      const control = trainer;
      if (control === undefined) {
        return;
      }
      try {
        // `stop()`, never a target of zero. `workout/session.ts` records why:
        // zero watts is a setpoint the machine holds, and a rider pedalling
        // against nothing is not the same as a released trainer.
        await control.control.stop();
        log('✓ released control with Stop');
      } catch (error: unknown) {
        report('releasing control', error);
      }
    })();
  });

  ready = true;
  publish();
}

element('download').addEventListener('click', () => {
  const hardware = element<HTMLInputElement>('hardware').value.trim();
  if (hardware === '') {
    report('saving the capture', new Error('say what the hardware is first'));
    return;
  }
  const json = JSON.stringify(capture.log(hardware), undefined, 2);
  saveWithAnchor({
    fileName: capture.fileName(),
    mediaType: 'application/json',
    bytes: new TextEncoder().encode(json),
  });
  log(`✓ saved ${capture.fileName()}`);
});

publish();
void start().catch((error: unknown) => {
  report('starting', error);
  ready = true;
  publish();
});
