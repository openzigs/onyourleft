// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The Devices screen's steering controller block (#1826), audited in each of
 * its states, in a browser and inside the Android shell, and walked by
 * keyboard. Named `*.a11y.test.tsx` so `test:a11y` selects it:
 * `routes.a11y.test.tsx` renders Devices with no ports, so without this the
 * block would sit outside the gate built to check it.
 */

import { mayShowDeviceList, permissionNotice } from '@onyourleft/mobile';
import { SensorError } from '@onyourleft/sensors';
import { afterEach, describe, expect, it } from 'vitest';

import { auditAccessibility, formatViolations, tabbableElements } from '../a11y/audit';
import { PAIR_CONTROLLER } from '../ride/ControllerPairing';
import { createSteeringController, type SteeringController } from '../ride/steering-controller';
import type { SteeringControllerLink } from '../ride/steering-controller-port';
import { idleSnapshot, stubRideController } from '../ride/testing';
import type { CapabilityProbe } from '../support/bluetooth-support';
import { capacitorShellSupport } from '../support/shell-support';
import { mount, settle, type Mounted } from '../testing/mount';

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

function link(drop: { fire?: () => void } = {}): SteeringControllerLink {
  return {
    name: 'Ctrl 1',
    onEvents: () => () => undefined,
    onDisconnect(listener) {
      drop.fire = listener;
      return () => undefined;
    },
    disconnect: () => undefined,
  };
}

/** A steering controller brought to `state` by its own methods. */
async function inState(
  state: 'none' | 'connected' | 'failed' | 'dropped' | 'pairing',
): Promise<SteeringController> {
  const drop: { fire?: () => void } = {};
  const steering = createSteeringController({
    requestAndConnect: () =>
      state === 'failed'
        ? Promise.reject(new SensorError('not-connected', 'no answer'))
        : state === 'pairing'
          ? new Promise<SteeringControllerLink>(() => undefined)
          : Promise.resolve(link(drop)),
  });
  if (state === 'none') return steering;
  const pairing = steering.pair();
  if (state !== 'pairing') await pairing;
  if (state === 'dropped') drop.fire?.();
  return steering;
}

const STATES = ['none', 'pairing', 'connected', 'failed', 'dropped'] as const;

describe('the steering controller block', () => {
  for (const state of STATES) {
    it(`passes the audit in a browser, ${state}`, async () => {
      const steering = await inState(state);
      mounted = await mount(
        <main>
          <h1>Devices</h1>
          <DevicesView
            capabilities={CAPABLE}
            controller={stubRideController(idleSnapshot()).controller}
            steering={steering}
          />
        </main>,
      );
      await settle();
      expectClean(`Devices in a browser, the controller ${state}`);
    });
  }

  it('passes the audit inside the Android shell, connected', async () => {
    const shell = capacitorShellSupport({
      availability: async () => Promise.resolve({ kind: 'available' }),
      notice: permissionNotice,
      mayShowDeviceList,
    });
    mounted = await mount(
      <main>
        <h1>Devices</h1>
        <DevicesView
          capabilities={CAPABLE}
          shell={shell}
          controller={stubRideController(idleSnapshot()).controller}
          steering={await inState('connected')}
        />
      </main>,
    );
    await settle();
    expectClean('Devices in the Android shell, the controller connected');
    expect(document.body.textContent).toContain('Ctrl 1: Connected');
  });

  it('is walked by keyboard after the sensors and their disclosure', async () => {
    mounted = await mount(
      <main>
        <h1>Devices</h1>
        <DevicesView
          capabilities={CAPABLE}
          controller={stubRideController(idleSnapshot()).controller}
          steering={await inState('none')}
        />
      </main>,
    );
    await settle();
    const stops = tabbableElements(document).map((each) => each.textContent?.trim());
    expect(stops.slice(-2)).toEqual(['What this browser can and cannot do', PAIR_CONTROLLER]);
  });

  it('keeps the Pair button, and its focus, while pairing', async () => {
    mounted = await mount(
      <main>
        <h1>Devices</h1>
        <DevicesView
          capabilities={CAPABLE}
          controller={stubRideController(idleSnapshot()).controller}
          steering={await inState('pairing')}
        />
      </main>,
    );
    await settle();
    expect(tabbableElements(document).map((each) => each.textContent?.trim())).toContain(
      PAIR_CONTROLLER,
    );
  });
});
