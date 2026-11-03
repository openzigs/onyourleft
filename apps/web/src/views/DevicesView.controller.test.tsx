// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The Devices screen's steering controller block (#1826), read from the
 * rendered screen: pairing the simulated controller (#1823) through the real
 * Web Bluetooth client (#1824), forgetting it, and a pairing whose connect
 * never answers.
 */

import { seconds } from '@onyourleft/domain';
import { OPEN_BIKE_CONTROL_SERVICE } from '@onyourleft/sensors/protocol';
import { openSimulatedController } from '@onyourleft/sensors/protocol/testing';
import { steeringController } from '@onyourleft/sensors/simulator';
import { createOpenBikeControlClient } from '@onyourleft/sensors/web-bluetooth';
import {
  bluetoothOverSimulatedController,
  createFakeBluetooth,
} from '@onyourleft/sensors/web-bluetooth/testing';
import { afterEach, describe, expect, it } from 'vitest';

import {
  CONTROLLER_DROPPED,
  CONTROLLER_FAILURE_WORDS,
  CONTROLLER_HEADING,
  PAIR_CONTROLLER,
} from '../ride/ControllerPairing';
import { createSteeringController, STEERING_CONTROLLER_BUTTONS } from '../ride/steering-controller';
import { idleSnapshot, stubRideController } from '../ride/testing';
import type { CapabilityProbe } from '../support/bluetooth-support';
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

/** The controller block's own text: from its heading to the end of the screen. */
function controllerText(): string {
  const heading = [...document.querySelectorAll('h2')].find(
    (each) => each.textContent === CONTROLLER_HEADING,
  );
  if (heading === undefined) throw new Error('no steering controller heading');
  let text = '';
  for (let node: Element | null = heading; node !== null; node = node.nextElementSibling) {
    text += ` ${node.textContent ?? ''}`;
  }
  return text;
}

function button(name: string): HTMLButtonElement {
  const found = [...document.querySelectorAll('button')].find(
    (each) => each.textContent?.trim() === name,
  );
  if (found === undefined) throw new Error(`no button "${name}"`);
  return found;
}

const hasButton = (name: string): boolean =>
  [...document.querySelectorAll('button')].some((each) => each.textContent?.trim() === name);

async function screenWith(steering: ReturnType<typeof createSteeringController>): Promise<void> {
  const stub = stubRideController(idleSnapshot());
  mounted = await mount(
    <main>
      <h1>Devices</h1>
      <DevicesView capabilities={CAPABLE} controller={stub.controller} steering={steering} />
    </main>,
  );
  await settle();
}

describe('the steering controller on the Devices screen', () => {
  it('pairs the simulated controller, shows it connected, and forgets it', async () => {
    const rig = openSimulatedController({
      spec: steeringController({
        script: [{ at: seconds(1), kind: 'changes', changes: [{ kind: 'press', button: 0x19 }] }],
      }),
    });
    const steering = createSteeringController(
      createOpenBikeControlClient({
        bluetooth: bluetoothOverSimulatedController(rig.gatt),
        buttons: STEERING_CONTROLLER_BUTTONS,
      }),
    );
    await screenWith(steering);
    expect(controllerText()).toContain('Not paired');
    expect(hasButton('Forget Steering Controller 4E21')).toBe(false);

    await activateWithKeyboard(button(PAIR_CONTROLLER));
    await settle();
    expect(controllerText()).toContain('Steering Controller 4E21: Connected');
    expect(rig.gatt.isConnected()).toBe(true);

    await activateWithKeyboard(button('Forget Steering Controller 4E21'));
    await settle();
    expect(controllerText()).toContain('Not paired');
    expect(controllerText()).not.toContain('Connected');
    expect(rig.gatt.isConnected()).toBe(false);
  });

  it('says a controller that dropped is gone, and lists it no longer', async () => {
    const rig = openSimulatedController({
      spec: steeringController({ script: [{ at: seconds(1), kind: 'disconnect' }] }),
    });
    const steering = createSteeringController(
      createOpenBikeControlClient({
        bluetooth: bluetoothOverSimulatedController(rig.gatt),
        buttons: STEERING_CONTROLLER_BUTTONS,
      }),
    );
    await screenWith(steering);
    await activateWithKeyboard(button(PAIR_CONTROLLER));
    await settle();
    rig.bench.advance(seconds(1));
    await settle();
    expect(controllerText()).toContain(CONTROLLER_DROPPED);
    expect(controllerText()).not.toContain('Connected');
    expect(hasButton(PAIR_CONTROLLER)).toBe(true);
  });

  it('says a pairing whose connect timed out failed, and leaves nothing half-listed', async () => {
    const fake = createFakeBluetooth({
      devices: [
        {
          id: 'controller',
          name: 'Ctrl 9',
          services: [{ uuid: OPEN_BIKE_CONTROL_SERVICE, characteristics: [] }],
        },
      ],
    });
    fake.bench.hold('connect');
    const deadlines: Array<() => void> = [];
    const steering = createSteeringController(
      createOpenBikeControlClient({
        bluetooth: fake.bluetooth,
        buttons: STEERING_CONTROLLER_BUTTONS,
        schedule: (callback) => {
          deadlines.push(callback);
          return () => undefined;
        },
      }),
    );
    await screenWith(steering);
    await activateWithKeyboard(button(PAIR_CONTROLLER));
    await settle();
    expect(controllerText()).toContain('Looking for a controller');
    expect(deadlines).toHaveLength(1);
    deadlines[0]?.();
    await settle();
    expect(controllerText()).toContain(CONTROLLER_FAILURE_WORDS['no-answer']);
    expect(controllerText()).toContain('Not paired');
    expect(controllerText()).not.toContain('Ctrl 9');
    expect(controllerText()).not.toContain('Connected');
    expect(fake.bench.device('controller').connected).toBe(false);
  });

  it('offers no controller block where the screen is given no steering controller', async () => {
    const stub = stubRideController(idleSnapshot());
    mounted = await mount(<DevicesView capabilities={CAPABLE} controller={stub.controller} />);
    await settle();
    expect(hasButton(PAIR_CONTROLLER)).toBe(false);
  });
});
