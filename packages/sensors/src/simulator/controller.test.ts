// SPDX-License-Identifier: Apache-2.0

/**
 * The controller model (#1823) through the simulator's own bench: what it
 * sends, when, and what a link loss does. The octets and the parser are
 * `protocol/src/open-bike-control-simulator.test.ts`.
 */

import { seconds } from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import { deviceId } from '../index';
import { createSimulator, steeringController, type ControllerNotification } from './index';

const id = deviceId('steering-controller');

describe('the simulated controller', () => {
  it('sends nothing while no link is up: a step that falls due then is lost', async () => {
    const { transport, bench } = createSimulator({
      devices: [
        steeringController({
          script: [
            { at: seconds(1), kind: 'changes', changes: [{ kind: 'press', button: 0x18 }] },
            { at: seconds(2), kind: 'changes', changes: [{ kind: 'release', button: 0x18 }] },
          ],
        }),
      ],
    });
    const controller = bench.device(id).controller;
    const heard: ControllerNotification[] = [];
    controller?.onNotification((notification) => heard.push(notification));
    bench.advance(seconds(1));
    await transport.connect(id);
    bench.advance(seconds(1));
    expect(heard).toEqual([{ kind: 'changes', changes: [{ kind: 'release', button: 0x18 }] }]);
  });

  it('carries out a scripted disconnect through the session', async () => {
    const { transport, bench } = createSimulator({
      devices: [steeringController({ script: [{ at: seconds(1), kind: 'disconnect' }] })],
    });
    const states: string[] = [];
    transport.observeConnectionState(id, (state) => states.push(state));
    await transport.connect(id);
    bench.advance(seconds(1));
    expect(states.at(-1)).toBe('disconnected');
  });

  it('loses a step during a notification dropout', async () => {
    const { transport, bench } = createSimulator({
      devices: [
        steeringController({
          script: [{ at: seconds(1), kind: 'changes', changes: [{ kind: 'press', button: 1 }] }],
        }),
      ],
    });
    await transport.connect(id);
    bench.device(id).script({ kind: 'notification-dropout', duration: seconds(1) });
    bench.advance(seconds(1));
    expect(bench.device(id).controller?.sent()).toEqual([]);
  });

  it('refuses a step that is not on a whole second after the start', () => {
    for (const second of [0, 1.5]) {
      expect(() =>
        createSimulator({
          devices: [steeringController({ script: [{ at: seconds(second), kind: 'disconnect' }] })],
        }),
      ).toThrow(RangeError);
    }
  });

  it('is on no device that does not serve it', () => {
    const { bench } = createSimulator({ devices: [steeringController({ id: 'a' })] });
    expect(bench.device(deviceId('a')).controlPoint).toBeUndefined();
    expect(bench.device(deviceId('a')).controller).toBeDefined();
  });
});
