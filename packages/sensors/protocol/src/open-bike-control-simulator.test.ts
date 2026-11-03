// SPDX-License-Identifier: Apache-2.0

/**
 * The simulated OpenBikeControl controller (#1823), read the way a client
 * reads a real one: connected, subscribed to the button-state characteristic,
 * and every notification run through #1822's parser. The bridge writes the
 * octets with literal values, so the parser is checked against the
 * specification rather than against itself.
 */

import { seconds } from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import { hrsStrap, steeringController, type ControllerStep } from '../../src/simulator/index';
import {
  encodeAppInformation,
  OPEN_BIKE_CONTROL_APP_INFORMATION,
  OPEN_BIKE_CONTROL_BUTTON_STATE,
  OPEN_BIKE_CONTROL_HAPTIC,
  OPEN_BIKE_CONTROL_SERVICE,
  parseButtonState,
  type ButtonStateResult,
} from './index';
import { openSimulatedController } from './simulator-bridge';

const at = (second: number) => seconds(second);

/** Connect, subscribe as a client would, and keep every parsed notification. */
async function subscribed(script: readonly ControllerStep[]) {
  const rig = openSimulatedController({ spec: steeringController({ script }) });
  await rig.gatt.connect();
  const received: ButtonStateResult[] = [];
  rig.gatt.startNotifications(OPEN_BIKE_CONTROL_BUTTON_STATE, (value) => {
    received.push(parseButtonState(value));
  });
  return { ...rig, received };
}

describe('the simulated controller, as a central sees it', () => {
  it('advertises the OpenBikeControl service, notifies button state, takes app information', () => {
    const { gatt } = openSimulatedController();
    expect(gatt.advertisedServices).toEqual([OPEN_BIKE_CONTROL_SERVICE]);
    expect(gatt.characteristics.get(OPEN_BIKE_CONTROL_BUTTON_STATE)).toContain('notify');
    expect(gatt.characteristics.get(OPEN_BIKE_CONTROL_APP_INFORMATION)).toContain('write');
    expect(gatt.characteristics.get(OPEN_BIKE_CONTROL_HAPTIC)).toContain('write');
    expect(gatt.characteristics.get(OPEN_BIKE_CONTROL_APP_INFORMATION)).not.toContain('notify');
  });

  it('refuses a subscription or a write with no link', () => {
    const { gatt } = openSimulatedController();
    expect(() => gatt.startNotifications(OPEN_BIKE_CONTROL_BUTTON_STATE, () => undefined)).toThrow(
      /connection/u,
    );
    expect(() => gatt.write(OPEN_BIKE_CONTROL_APP_INFORMATION, new Uint8Array([4]))).toThrow(
      /connection/u,
    );
  });
});

describe('read back through the codec', () => {
  it('yields exactly three scripted presses and an angle, in order, on the clock', async () => {
    const rig = await subscribed([
      { at: at(1), kind: 'changes', changes: [{ kind: 'press', button: 0x18 }] },
      { at: at(2), kind: 'changes', changes: [{ kind: 'press', button: 0x19 }] },
      { at: at(2), kind: 'changes', changes: [{ kind: 'press', button: 0xa1 }] },
      { at: at(4), kind: 'changes', changes: [{ kind: 'angle', degrees: -12.5 }] },
    ]);
    rig.bench.advance(seconds(1));
    expect(rig.received).toHaveLength(1);
    rig.bench.advance(seconds(3));
    expect(rig.received).toEqual([
      {
        ok: true,
        events: [{ kind: 'steer', direction: 'left', pressed: true, superseded: false }],
      },
      {
        ok: true,
        events: [{ kind: 'steer', direction: 'right', pressed: true, superseded: false }],
      },
      { ok: true, events: [{ kind: 'button', button: 0xa1, pressed: true, state: 1 }] },
      { ok: true, events: [{ kind: 'steering-angle', degrees: -12.5 }] },
    ]);
  });

  it('sends a release, an angle beside a steer, a clamped angle and no angle as a device does', async () => {
    const rig = await subscribed([
      {
        at: at(1),
        kind: 'changes',
        changes: [
          { kind: 'press', button: 0x19 },
          { kind: 'angle', degrees: 10 },
        ],
      },
      { at: at(2), kind: 'changes', changes: [{ kind: 'release', button: 0x19 }] },
      { at: at(3), kind: 'changes', changes: [{ kind: 'angle', degrees: 90 }] },
      { at: at(4), kind: 'changes', changes: [{ kind: 'angle-unavailable' }] },
    ]);
    rig.bench.advance(seconds(4));
    expect(rig.received).toEqual([
      {
        ok: true,
        events: [
          { kind: 'steer', direction: 'right', pressed: true, superseded: true },
          { kind: 'steering-angle', degrees: 10 },
        ],
      },
      {
        ok: true,
        events: [{ kind: 'steer', direction: 'right', pressed: false, superseded: false }],
      },
      { ok: true, events: [{ kind: 'steering-angle', degrees: 63 }] },
      { ok: true, events: [{ kind: 'steering-angle-unavailable' }] },
    ]);
  });
});

describe('it misbehaves on purpose', () => {
  it('sends each malformed shape as scripted, which the parser refuses by kind', async () => {
    const rig = await subscribed([
      { at: at(1), kind: 'malformed', shape: 'empty' },
      { at: at(1), kind: 'malformed', shape: 'no-buttons' },
      { at: at(1), kind: 'malformed', shape: 'unknown-message-type' },
      { at: at(1), kind: 'malformed', shape: 'odd-length' },
      { at: at(1), kind: 'malformed', shape: 'oversized' },
      { at: at(2), kind: 'changes', changes: [{ kind: 'press', button: 0x18 }] },
    ]);
    rig.bench.advance(seconds(2));
    expect(rig.received.map((result) => (result.ok ? 'ok' : result.error.kind))).toEqual([
      'empty',
      'no-buttons',
      'unknown-message-type',
      'odd-length',
      'oversized',
      'ok',
    ]);
  });

  it('drops the link mid-script: the press after it is never sent and the client is told', async () => {
    const rig = await subscribed([
      { at: at(1), kind: 'changes', changes: [{ kind: 'press', button: 0x18 }] },
      { at: at(2), kind: 'disconnect' },
      { at: at(2), kind: 'changes', changes: [{ kind: 'press', button: 0x19 }] },
      { at: at(3), kind: 'changes', changes: [{ kind: 'press', button: 0x19 }] },
    ]);
    let drops = 0;
    rig.gatt.onDisconnect(() => {
      drops += 1;
    });
    rig.bench.advance(seconds(3));
    expect(drops).toBe(1);
    expect(rig.gatt.isConnected()).toBe(false);
    expect(rig.received).toHaveLength(1);
    expect(rig.controller.sent()).toHaveLength(1);
  });

  it('ends a subscription with its link: a reconnect needs a new one', async () => {
    const rig = await subscribed([
      { at: at(1), kind: 'disconnect' },
      { at: at(3), kind: 'changes', changes: [{ kind: 'press', button: 0x18 }] },
    ]);
    rig.bench.advance(seconds(1));
    await rig.gatt.connect();
    rig.bench.advance(seconds(2));
    expect(rig.received).toEqual([]);
    expect(rig.controller.sent()).toHaveLength(1);
  });
});

describe('what the client wrote is readable from the device', () => {
  it('reads the app information back as the id, the empty version and the buttons', async () => {
    const rig = openSimulatedController();
    await rig.gatt.connect();
    const bytes = encodeAppInformation([0x18, 0x19, 0x1b]);
    rig.gatt.write(OPEN_BIKE_CONTROL_APP_INFORMATION, bytes);
    expect(rig.controller.appInformation()).toEqual({
      appId: 'onyourleft',
      appVersion: '',
      buttons: [0x18, 0x19, 0x1b],
    });
    expect(rig.gatt.writes()).toEqual([
      { characteristic: OPEN_BIKE_CONTROL_APP_INFORMATION, bytes: [...bytes] },
    ]);
  });

  it('empties the app information on a disconnect, and keeps every write in order', async () => {
    const rig = openSimulatedController();
    await rig.gatt.connect();
    rig.gatt.write(OPEN_BIKE_CONTROL_APP_INFORMATION, encodeAppInformation([0x18]));
    await rig.gatt.disconnect();
    expect(rig.controller.appInformation()).toBeUndefined();
    await rig.gatt.connect();
    rig.gatt.write(OPEN_BIKE_CONTROL_APP_INFORMATION, encodeAppInformation([0x19]));
    expect(rig.controller.appInformationWrites().map((write) => write.buttons)).toEqual([
      [0x18],
      [0x19],
    ]);
  });

  it('logs a write it cannot read, and takes nothing from it', async () => {
    const rig = openSimulatedController();
    await rig.gatt.connect();
    rig.gatt.write(OPEN_BIKE_CONTROL_APP_INFORMATION, new Uint8Array([0x04, 0x01, 0x09, 0x61]));
    expect(rig.gatt.writes()).toHaveLength(1);
    expect(rig.controller.appInformation()).toBeUndefined();
  });

  it('refuses a write to the button-state characteristic', async () => {
    const rig = openSimulatedController();
    await rig.gatt.connect();
    expect(() => rig.gatt.write(OPEN_BIKE_CONTROL_BUTTON_STATE, new Uint8Array([1]))).toThrow(
      /writable/u,
    );
    expect(rig.gatt.writes()).toEqual([]);
  });
});

describe('beside the other sensors', () => {
  it('takes a connection slot, and declares no capability', async () => {
    const rig = openSimulatedController({ others: [hrsStrap()] });
    expect(rig.bench.device(rig.deviceId).device.capabilities.size).toBe(0);
    await rig.gatt.connect();
    expect(rig.gatt.isConnected()).toBe(true);
  });
});
