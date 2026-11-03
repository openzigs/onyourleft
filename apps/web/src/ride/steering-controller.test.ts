// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The paired steering controller (#1826): its states, what a failure leaves,
 * and — on one simulated radio with a trainer and a strap already connected —
 * that pairing a controller drops neither, and that a scripted press reaches
 * the game's controller port through the real Web Bluetooth client (#1824)
 * over the simulated controller (#1823).
 */

import { deviceId, SensorError, type MeasurementFor } from '@onyourleft/sensors';
import type { OpenBikeControlEvent } from '@onyourleft/sensors/protocol';
import { openSimulatedController } from '@onyourleft/sensors/protocol/testing';
import { hrsStrap, modernTrainer, steeringController } from '@onyourleft/sensors/simulator';
import { createOpenBikeControlClient } from '@onyourleft/sensors/web-bluetooth';
import { bluetoothOverSimulatedController } from '@onyourleft/sensors/web-bluetooth/testing';
import { seconds } from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import type { ControllerPort } from '../game/delivery/controller-port';

import {
  createSteeringController,
  STEERING_CONTROLLER_BUTTONS,
  type SteeringControllerState,
} from './steering-controller';
import type { SteeringControllerLink, SteeringControllerPort } from './steering-controller-port';

/** A link a test drives by hand. */
function handLink(name: string | undefined = 'Ctrl 1') {
  const events = new Set<(events: readonly OpenBikeControlEvent[]) => void>();
  const drops = new Set<() => void>();
  let disconnects = 0;
  const link: SteeringControllerLink = {
    name,
    onEvents(listener) {
      events.add(listener);
      return () => events.delete(listener);
    },
    onDisconnect(listener) {
      drops.add(listener);
      return () => drops.delete(listener);
    },
    disconnect() {
      disconnects += 1;
    },
  };
  return {
    link,
    send(batch: readonly OpenBikeControlEvent[]) {
      for (const listener of [...events]) listener(batch);
    },
    drop() {
      for (const listener of [...drops]) listener();
    },
    get disconnects() {
      return disconnects;
    },
    get listening() {
      return events.size + drops.size;
    },
  };
}

const opens = (...outcomes: Array<SteeringControllerLink | Error>): SteeringControllerPort => ({
  requestAndConnect: () => {
    const next = outcomes.shift();
    if (next === undefined) throw new Error('no more scripted pairings');
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  },
});

const PRESS: readonly OpenBikeControlEvent[] = [
  { kind: 'steer', direction: 'left', pressed: true, superseded: false },
];

describe('the steering controller, by state', () => {
  it('is pairing while the client works, then connected with the name it advertised', async () => {
    const hand = handLink('Ctrl 1');
    const steering = createSteeringController(opens(hand.link));
    const seen: SteeringControllerState['kind'][] = [];
    steering.subscribe(() => seen.push(steering.state.kind));
    await steering.pair();
    expect(seen).toEqual(['pairing', 'connected']);
    expect(steering.state).toEqual({ kind: 'connected', name: 'Ctrl 1' });
  });

  it('gives no name for a controller that advertised none, so the screen repeats nothing', async () => {
    const steering = createSteeringController(opens({ ...handLink().link, name: undefined }));
    await steering.pair();
    expect(steering.state).toStrictEqual({ kind: 'connected', name: undefined });
  });

  it('says why a pairing failed, by the client error, and lists nothing', async () => {
    const cases: ReadonlyArray<readonly [Error, string]> = [
      [new SensorError('no-device-selected', 'x'), 'not-chosen'],
      [new SensorError('capability-unsupported', 'x'), 'not-a-controller'],
      [new SensorError('not-connected', 'x'), 'no-answer'],
      [new SensorError('not-permitted', 'x'), 'refused'],
      [new Error('anything else'), 'refused'],
    ];
    for (const [error, reason] of cases) {
      const steering = createSteeringController(opens(error));
      await steering.pair();
      expect(steering.state).toEqual({ kind: 'failed', reason });
    }
  });

  it('forgets: lets the link go, stops listening and lists nothing', async () => {
    const hand = handLink();
    const steering = createSteeringController(opens(hand.link));
    await steering.pair();
    steering.forget();
    expect(hand.disconnects).toBe(1);
    expect(hand.listening).toBe(0);
    expect(steering.state).toEqual({ kind: 'none', dropped: false });
  });

  it('says once that a dropped controller is gone, and passes on nothing after', async () => {
    const hand = handLink();
    const steering = createSteeringController(opens(hand.link));
    const heard: (readonly OpenBikeControlEvent[])[] = [];
    steering.onControllerEvents((events) => heard.push(events));
    await steering.pair();
    hand.drop();
    expect(steering.state).toEqual({ kind: 'none', dropped: true });
    hand.send(PRESS);
    expect(heard).toEqual([]);
  });

  it('lets the first controller go when a second is paired', async () => {
    const first = handLink('One');
    const second = handLink('Two');
    const steering = createSteeringController(opens(first.link, second.link));
    await steering.pair();
    await steering.pair();
    expect(first.disconnects).toBe(1);
    expect(first.listening).toBe(0);
    expect(steering.state).toEqual({ kind: 'connected', name: 'Two' });
  });

  it('ignores a second press while pairing', async () => {
    let calls = 0;
    const hand = handLink();
    const steering = createSteeringController({
      requestAndConnect: () => {
        calls += 1;
        return Promise.resolve(hand.link);
      },
    });
    const first = steering.pair();
    const second = steering.pair();
    await Promise.all([first, second]);
    expect(calls).toBe(1);
  });
});

describe('forgetting while a pairing is still running', () => {
  it('ends with nothing listed and lets the late link go', async () => {
    const hand = handLink();
    let finish: (link: SteeringControllerLink) => void = () => undefined;
    const steering = createSteeringController({
      requestAndConnect: () =>
        new Promise<SteeringControllerLink>((resolve) => {
          finish = resolve;
        }),
    });
    const pairing = steering.pair();
    steering.forget();
    finish(hand.link);
    await pairing;
    expect(steering.state).toEqual({ kind: 'none', dropped: false });
    expect(hand.disconnects).toBe(1);
    expect(hand.listening).toBe(0);
  });

  it('does not show the failure of a pairing that was forgotten', async () => {
    let fail: (error: Error) => void = () => undefined;
    const steering = createSteeringController({
      requestAndConnect: () =>
        new Promise<SteeringControllerLink>((_, reject) => {
          fail = reject;
        }),
    });
    const pairing = steering.pair();
    steering.forget();
    fail(new SensorError('not-connected', 'x'));
    await pairing;
    expect(steering.state).toEqual({ kind: 'none', dropped: false });
  });
});

describe('on one radio with a trainer and a strap', () => {
  async function rig() {
    const rigged = openSimulatedController({
      spec: steeringController({
        script: [
          { at: seconds(3), kind: 'changes', changes: [{ kind: 'press', button: 0x18 }] },
          { at: seconds(4), kind: 'changes', changes: [{ kind: 'angle', degrees: 12 }] },
        ],
      }),
      others: [modernTrainer({ id: 'trainer' }), hrsStrap({ id: 'strap' })],
    });
    const { transport } = rigged;
    const trainer = deviceId('trainer');
    const strap = deviceId('strap');
    await transport.connect(trainer);
    await transport.connect(strap);
    const powers: MeasurementFor<'power'>[] = [];
    const hearts: MeasurementFor<'heart-rate'>[] = [];
    await transport.subscribe(trainer, 'power', (each) => powers.push(each));
    await transport.subscribe(strap, 'heart-rate', (each) => hearts.push(each));
    rigged.bench.advance(seconds(1));
    const steering = createSteeringController(
      createOpenBikeControlClient({
        bluetooth: bluetoothOverSimulatedController(rigged.gatt),
        buttons: STEERING_CONTROLLER_BUTTONS,
      }),
    );
    return { ...rigged, trainer, strap, powers, hearts, steering };
  }

  it('pairs a controller without dropping either, and both keep delivering', async () => {
    const { transport, bench, trainer, strap, powers, hearts, steering } = await rig();
    const before = { powers: powers.length, hearts: hearts.length };
    await steering.pair();
    expect(steering.state).toEqual({ kind: 'connected', name: 'Steering Controller 4E21' });
    bench.advance(seconds(3));
    expect(transport.connectionState(trainer)).toBe('connected');
    expect(transport.connectionState(strap)).toBe('connected');
    expect(powers.length).toBe(before.powers + 3);
    expect(hearts.length).toBe(before.hearts + 3);
  });

  it('delivers a scripted press and angle to the game’s controller port', async () => {
    const { bench, steering } = await rig();
    const port: ControllerPort = steering;
    const heard: OpenBikeControlEvent[] = [];
    port.onControllerEvents((events) => heard.push(...events));
    await steering.pair();
    bench.advance(seconds(3));
    expect(heard).toEqual([
      { kind: 'steer', direction: 'left', pressed: true, superseded: false },
      { kind: 'steering-angle', degrees: 12 },
    ]);
  });

  it('tells the controller which buttons the app uses', async () => {
    const { controller, steering } = await rig();
    await steering.pair();
    expect(controller.appInformation()).toEqual({
      appId: 'onyourleft',
      appVersion: '',
      buttons: [0x18, 0x19, 0x1b],
    });
  });

  it('forgets the controller and leaves the trainer and the strap connected', async () => {
    const { transport, gatt, trainer, strap, steering } = await rig();
    await steering.pair();
    steering.forget();
    expect(gatt.isConnected()).toBe(false);
    expect(transport.connectionState(trainer)).toBe('connected');
    expect(transport.connectionState(strap)).toBe('connected');
  });
});
