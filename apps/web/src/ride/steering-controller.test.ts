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

import { RECONNECT_BACKOFF_SECONDS } from './controller';
import {
  createRememberedSensors,
  transportSeed,
  type RememberedSensorStorage,
} from './remembered-sensors';
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
      buttons: [0x18, 0x19, 0x1b, 0x50, 0x51],
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

/** The device's own storage, which a second memory over it reads as the next app opening does. */
function deviceStorage(): RememberedSensorStorage {
  const rows = new Map<string, string>();
  return {
    getItem: (key) => rows.get(key) ?? null,
    setItem: (key, value) => void rows.set(key, value),
    removeItem: (key) => void rows.delete(key),
  };
}

const CONTROLLER_ID = 'D1:0B:1C:00:4E:21';

/**
 * #2672: a steering controller given a `SteeringReconnect` over a real
 * memory, with a scheduler a test fires by hand and a connect with no chooser
 * it scripts.
 */
function remembering(
  options: {
    readonly storage?: RememberedSensorStorage;
    readonly pairs?: SteeringControllerLink[];
    readonly room?: () => boolean;
  } = {},
) {
  const storage = options.storage ?? deviceStorage();
  const memory = createRememberedSensors(storage);
  const known: Array<SteeringControllerLink | Error | Promise<SteeringControllerLink>> = [];
  const asked: Array<readonly [string, string]> = [];
  const waiting: Array<{ readonly run: () => void; readonly after: number }> = [];
  const steering = createSteeringController(opens(...(options.pairs ?? [])), {
    remembered: memory,
    connectKnown: async (id, name) => {
      asked.push([id, name]);
      const next = known.shift();
      if (next === undefined) throw new SensorError('not-connected', 'nothing there');
      if (next instanceof Error) throw next;
      return next;
    },
    hasRoom: options.room ?? (() => true),
    schedule: (run, after) => {
      const entry = { run, after };
      waiting.push(entry);
      return () => {
        const at = waiting.indexOf(entry);
        if (at !== -1) waiting.splice(at, 1);
      };
    },
  });
  return {
    steering,
    memory,
    storage,
    known,
    asked,
    /** The waits the controller asked for, in seconds, still pending. */
    get waits() {
      return waiting.map((entry) => entry.after);
    },
    /** Fire every pending wait, and let the try it starts run out. */
    async fire(): Promise<void> {
      for (const entry of waiting.splice(0)) entry.run();
      for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();
    },
    /** What the NEXT opening of the app would read. */
    reopened: () => createRememberedSensors(storage).list(),
  };
}

const withId = (hand: ReturnType<typeof handLink>, id = CONTROLLER_ID): SteeringControllerLink => ({
  ...hand.link,
  id,
});

/** A memory that already holds a controller, as the app finds it on opening. */
function holdingController(name = 'Ctrl 1'): RememberedSensorStorage {
  const storage = deviceStorage();
  createRememberedSensors(storage).remember({
    id: deviceId(CONTROLLER_ID),
    name,
    role: 'controller',
  });
  return storage;
}

describe('#2672 — the shell remembers a paired steering controller', () => {
  it('remembers it once it has paired: its id, its name and its role, and nothing else', async () => {
    const hand = handLink('Ctrl 1');
    const rig = remembering({ pairs: [withId(hand)] });
    expect(rig.reopened()).toEqual([]);
    await rig.steering.pair();
    expect(rig.reopened()).toStrictEqual([
      { id: CONTROLLER_ID, name: 'Ctrl 1', role: 'controller' },
    ]);
    // Never handed to the transport, which does not pair controllers.
    expect(transportSeed(rig.memory)()).toEqual([]);
  });

  it('keeps one controller: pairing another takes the first one’s place', async () => {
    const first = handLink('One');
    const second = handLink('Two');
    const rig = remembering({ pairs: [withId(first, 'AA:00'), withId(second, 'BB:00')] });
    rig.memory.remember({ id: deviceId('C4:01'), name: 'Strap', role: 'heart-rate' });
    await rig.steering.pair();
    await rig.steering.pair();
    expect(rig.reopened()).toStrictEqual([
      { id: 'C4:01', name: 'Strap', role: 'heart-rate' },
      { id: 'BB:00', name: 'Two', role: 'controller' },
    ]);
  });

  it('stops remembering it when the rider presses Forget, and leaves the sensors', async () => {
    const hand = handLink();
    const rig = remembering({ pairs: [withId(hand)] });
    rig.memory.remember({ id: deviceId('C4:01'), name: 'Strap', role: 'heart-rate' });
    await rig.steering.pair();
    rig.steering.forget();
    expect(rig.reopened()).toStrictEqual([{ id: 'C4:01', name: 'Strap', role: 'heart-rate' }]);
  });

  it('remembers nothing of a link with no id, which is what a browser’s is', async () => {
    const hand = handLink();
    const rig = remembering({ pairs: [hand.link] });
    await rig.steering.pair();
    expect(rig.steering.state).toEqual({ kind: 'connected', name: 'Ctrl 1' });
    expect(rig.reopened()).toEqual([]);
    hand.drop();
    expect(rig.steering.state).toEqual({ kind: 'none', dropped: true });
    expect(rig.waits).toEqual([]);
  });
});

describe('#2672 — reconnecting it when the app opens', () => {
  it('lists it as reconnecting, connects with no chooser, and passes its presses on', async () => {
    // No scripted chooser: a restore that went through one throws.
    const rig = remembering({ storage: holdingController() });
    const hand = handLink('Ctrl 1');
    rig.known.push(withId(hand));
    const seen: SteeringControllerState[] = [];
    rig.steering.subscribe(() => seen.push(rig.steering.state));
    const heard: OpenBikeControlEvent[] = [];
    rig.steering.onControllerEvents((events) => heard.push(...events));

    await rig.steering.restoreRemembered();

    expect(rig.asked).toEqual([[CONTROLLER_ID, 'Ctrl 1']]);
    expect(seen).toEqual([
      { kind: 'reconnecting', name: 'Ctrl 1' },
      { kind: 'connected', name: 'Ctrl 1' },
    ]);
    expect(rig.steering.paired).toBe(true);
    hand.send(PRESS);
    expect(heard).toEqual(PRESS);
  });

  it('tries again on the backoff while it is not there, saying reconnecting meanwhile', async () => {
    const rig = remembering({ storage: holdingController('') });
    await rig.steering.restoreRemembered();
    expect(rig.steering.state).toEqual({ kind: 'reconnecting', name: undefined });
    expect(rig.waits).toEqual([RECONNECT_BACKOFF_SECONDS[1]]);
    await rig.fire();
    expect(rig.waits).toEqual([RECONNECT_BACKOFF_SECONDS[2]]);
    rig.known.push({ ...withId(handLink()), name: undefined });
    await rig.fire();
    expect(rig.asked).toHaveLength(3);
    expect(rig.steering.state).toEqual({ kind: 'connected', name: undefined });
    expect(rig.waits).toEqual([]);
  });

  it('tries nothing, and lists nothing, where the sensors have taken the budget', async () => {
    const rig = remembering({ storage: holdingController(), room: () => false });
    await rig.steering.restoreRemembered();
    expect(rig.asked).toEqual([]);
    expect(rig.steering.state).toEqual({ kind: 'none', dropped: false });
    // Still remembered, for an opening with a link free.
    expect(rig.reopened()).toHaveLength(1);
  });

  it('does nothing with no controller remembered', async () => {
    const rig = remembering();
    rig.memory.remember({ id: deviceId('C4:01'), name: 'Strap', role: 'heart-rate' });
    await rig.steering.restoreRemembered();
    expect(rig.asked).toEqual([]);
    expect(rig.steering.state).toEqual({ kind: 'none', dropped: false });
  });

  it('lets go of a link that a Forget overtook while the try was running', async () => {
    const rig = remembering({ storage: holdingController() });
    const hand = handLink();
    let finish: (link: SteeringControllerLink) => void = () => undefined;
    rig.known.push(
      new Promise<SteeringControllerLink>((resolve) => {
        finish = resolve;
      }),
    );
    const restoring = rig.steering.restoreRemembered();
    await Promise.resolve();
    rig.steering.forget();
    finish(withId(hand));
    await restoring;
    expect(rig.steering.state).toEqual({ kind: 'none', dropped: false });
    expect(hand.disconnects).toBe(1);
    expect(hand.listening).toBe(0);
    expect(rig.reopened()).toEqual([]);
  });
});

describe('#2672 — a controller link that drops comes back by itself', () => {
  async function dropped() {
    const hand = handLink('Ctrl 1');
    const rig = remembering({ pairs: [withId(hand)] });
    await rig.steering.pair();
    hand.drop();
    return Object.assign(rig, { hand });
  }

  it('says reconnecting, tries on the first backoff with no chooser, and is connected again', async () => {
    const rig = await dropped();
    expect(rig.steering.state).toEqual({ kind: 'reconnecting', name: 'Ctrl 1' });
    expect(rig.steering.paired).toBe(false);
    expect(rig.waits).toEqual([RECONNECT_BACKOFF_SECONDS[0]]);
    const back = handLink('Ctrl 1');
    rig.known.push(withId(back));
    await rig.fire();
    expect(rig.asked).toEqual([[CONTROLLER_ID, 'Ctrl 1']]);
    expect(rig.steering.state).toEqual({ kind: 'connected', name: 'Ctrl 1' });
    // And a second drop is got back the same way.
    back.drop();
    expect(rig.steering.state).toEqual({ kind: 'reconnecting', name: 'Ctrl 1' });
  });

  it('stops trying, and forgets it, when the rider presses Forget while it is reconnecting', async () => {
    const rig = await dropped();
    rig.steering.forget();
    expect(rig.waits).toEqual([]);
    expect(rig.steering.state).toEqual({ kind: 'none', dropped: false });
    expect(rig.reopened()).toEqual([]);
  });

  it('is not tried again once Erase everything has taken it from the memory', async () => {
    const rig = await dropped();
    rig.memory.forget();
    await rig.fire();
    expect(rig.asked).toEqual([]);
    expect(rig.steering.state).toEqual({ kind: 'none', dropped: false });
    expect(rig.waits).toEqual([]);
  });

  it('waits for a link free in the budget, backing off, before it tries', async () => {
    let room = false;
    const hand = handLink('Ctrl 1');
    const rig = remembering({ pairs: [withId(hand)], room: () => room });
    await rig.steering.pair();
    hand.drop();
    await rig.fire();
    expect(rig.asked).toEqual([]);
    expect(rig.steering.state).toEqual({ kind: 'reconnecting', name: 'Ctrl 1' });
    expect(rig.waits).toEqual([RECONNECT_BACKOFF_SECONDS[1]]);
    room = true;
    rig.known.push(withId(handLink('Ctrl 1')));
    await rig.fire();
    expect(rig.asked).toHaveLength(1);
    expect(rig.steering.state).toEqual({ kind: 'connected', name: 'Ctrl 1' });
  });
});
