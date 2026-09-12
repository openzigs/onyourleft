// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The Android control point, and the assertion that keeps it acknowledged.
 *
 * ⚠️ This file's most important test is the one that asserts a method is
 * **never called**. `packages/sensors/protocol`'s `FitnessMachineChannel`
 * warns that an unacknowledged write *"compiles, satisfies every test in this
 * file, and reintroduces exactly the fire-and-forget failure the client exists
 * to prevent"* — so the only thing that can catch the swap is a test that names
 * the wrong method and requires its absence. `plugin-port.ts` declares
 * `writeWithoutResponse` for exactly this reason.
 *
 * The browser adapter's `fitness-machine-channel.test.ts` makes the same
 * assertion about `writeValueWithResponse`. Two platforms, one rule, and neither
 * inherits the other's test.
 */

import { describe, expect, it } from 'vitest';

import { createCapacitorFitnessMachineChannel } from './fitness-machine-channel';
import { readCapacitorFitnessMachine } from './fitness-machine';
import { SCRIPTED_DEVICE, scriptedPort, type ScriptedPort, type ScriptedStack } from './testing';
import { createCapacitorTransport } from './transport';
import { unixSeconds } from '@onyourleft/domain';
import {
  FITNESS_MACHINE_CONTROL_POINT,
  FITNESS_MACHINE_SERVICE,
  FITNESS_MACHINE_STATUS,
  SUPPORTED_POWER_RANGE,
} from '@onyourleft/sensors/protocol';

/** Supported Power Range: min 0 W, max 2000 W, increment 1 W — three sint16/uint16. */
function powerRangeBytes(): DataView {
  const view = new DataView(new ArrayBuffer(6));
  view.setInt16(0, 0, true);
  view.setInt16(2, 2_000, true);
  view.setUint16(4, 1, true);
  return view;
}

/**
 * A scripted port with the stack already up.
 *
 * ⚠️ Since #230 the double refuses every call before `initialize()`, exactly as
 * the plugin does — that constraint is what makes "pairing initialises first" a
 * testable claim rather than a comment. Nothing about this file changes: on a
 * phone the control point is only reachable through a device the transport
 * discovered and connected, so the stack is always up by the time a byte is
 * written to it. These tests now say that out loud instead of resting on a
 * fixture that was more permissive than the plugin.
 */
async function startedPort(stack?: ScriptedStack): Promise<ScriptedPort> {
  const port = scriptedPort(stack);
  await port.initialize();
  return port;
}

describe('the control point write is acknowledged', () => {
  it('writes through the acknowledged call', async () => {
    const port = await startedPort();
    const channel = createCapacitorFitnessMachineChannel(port, SCRIPTED_DEVICE.deviceId);

    await channel.writeControlPoint(new Uint8Array([0x00]));

    expect(port.calls).toContain(
      `write:${FITNESS_MACHINE_SERVICE}|${FITNESS_MACHINE_CONTROL_POINT}`,
    );
  });

  it('never uses the unacknowledged one', async () => {
    // ⚠️ The assertion that makes the swap a red test. Deleting it, or replacing
    // `port.write` with `port.writeWithoutResponse` in the channel, leaves every
    // other test in this file green — which is precisely the failure the
    // interface's own warning describes.
    const port = await startedPort();
    const channel = createCapacitorFitnessMachineChannel(port, SCRIPTED_DEVICE.deviceId);

    await channel.writeControlPoint(new Uint8Array([0x00]));
    await channel.writeControlPoint(new Uint8Array([0x05, 0xc8, 0x00]));

    expect(port.calls.some((call) => call.startsWith('writeWithoutResponse'))).toBe(false);
  });

  it('writes exactly the bytes it was given, and no more', async () => {
    // A `Uint8Array` view into a larger buffer is the ordinary case when an
    // encoder writes into a scratch buffer. Handing the whole buffer to the
    // plugin would put whatever else is in it on the wire — to a device that
    // applies physical resistance to somebody.
    const scratch = new Uint8Array([0xff, 0xff, 0x05, 0xc8, 0x00, 0xff]);
    const setpoint = scratch.subarray(2, 5);
    const port = await startedPort();
    const channel = createCapacitorFitnessMachineChannel(port, SCRIPTED_DEVICE.deviceId);

    await channel.writeControlPoint(setpoint);

    const written = port.writes.at(-1);
    expect(written?.value.byteLength).toBe(3);
    expect(written?.value.getUint8(0)).toBe(0x05);
    expect(written?.value.getUint8(1)).toBe(0xc8);
    expect(written?.value.getUint8(2)).toBe(0x00);
  });
});

describe('control point indications', () => {
  it('subscribes once however many times it is enabled', async () => {
    // The interface requires idempotence — it is called before the first write
    // and again after a reconnect — and the plugin rejects a second
    // `startNotifications` on a characteristic already subscribed.
    const port = await startedPort();
    const channel = createCapacitorFitnessMachineChannel(port, SCRIPTED_DEVICE.deviceId);

    await channel.enableControlPointIndications();
    await channel.enableControlPointIndications();
    await channel.enableControlPointIndications();

    const starts = port.calls.filter(
      (call) =>
        call === `startNotifications:${FITNESS_MACHINE_SERVICE}|${FITNESS_MACHINE_CONTROL_POINT}`,
    );
    expect(starts).toHaveLength(1);
  });

  it('delivers an indication to every listener', async () => {
    const port = await startedPort();
    const channel = createCapacitorFitnessMachineChannel(port, SCRIPTED_DEVICE.deviceId);
    await channel.enableControlPointIndications();

    const seen: number[] = [];
    channel.onControlPointIndication((value) => seen.push(value.getUint8(0)));
    channel.onControlPointIndication((value) => seen.push(value.getUint8(0) + 100));

    port.notify(
      FITNESS_MACHINE_SERVICE,
      FITNESS_MACHINE_CONTROL_POINT,
      new DataView(new Uint8Array([0x80]).buffer),
    );

    expect(seen).toEqual([0x80, 0x80 + 100]);
  });

  it('does not skip a listener when one unsubscribes mid-dispatch', async () => {
    // ⚠️ Kept, but it does NOT discriminate on its own and says so: deleting
    // the current element of a `Set` during `for...of` is well defined and skips
    // nothing, so this passes whether the dispatcher copies or not. The test
    // below is the one that earns the copy — and the mutation that removed it
    // came back green until that test existed.
    const port = await startedPort();
    const channel = createCapacitorFitnessMachineChannel(port, SCRIPTED_DEVICE.deviceId);
    await channel.enableControlPointIndications();

    const seen: string[] = [];
    const off = channel.onControlPointIndication(() => {
      seen.push('first');
      off();
    });
    channel.onControlPointIndication(() => seen.push('second'));

    port.notify(
      FITNESS_MACHINE_SERVICE,
      FITNESS_MACHINE_CONTROL_POINT,
      new DataView(new Uint8Array([0x80]).buffer),
    );

    expect(seen).toEqual(['first', 'second']);
  });

  it('does not deliver an indication to a listener added while dispatching it', async () => {
    // The case that actually earns the copy, and the one the mutation exposed.
    // `Set` iteration DOES visit entries inserted while it runs, so live
    // iteration would hand the in-flight indication to a subscriber that did not
    // exist when it arrived. `createTrainerControl` subscribes from inside an
    // indication handler when it chains a procedure, so this would complete a
    // procedure that never happened — on the path that sets resistance.
    const port = await startedPort();
    const channel = createCapacitorFitnessMachineChannel(port, SCRIPTED_DEVICE.deviceId);
    await channel.enableControlPointIndications();

    const seen: string[] = [];
    channel.onControlPointIndication(() => {
      seen.push('first');
      channel.onControlPointIndication(() => seen.push('added-during-dispatch'));
    });

    const value = new DataView(new Uint8Array([0x80]).buffer);
    port.notify(FITNESS_MACHINE_SERVICE, FITNESS_MACHINE_CONTROL_POINT, value);

    expect(seen).toEqual(['first']);

    // And it does receive the NEXT one, so the copy delays rather than drops.
    port.notify(FITNESS_MACHINE_SERVICE, FITNESS_MACHINE_CONTROL_POINT, value);

    expect(seen).toEqual(['first', 'first', 'added-during-dispatch']);
  });

  it('stops delivering to a listener that unsubscribed', async () => {
    const port = await startedPort();
    const channel = createCapacitorFitnessMachineChannel(port, SCRIPTED_DEVICE.deviceId);
    await channel.enableControlPointIndications();

    let count = 0;
    const off = channel.onControlPointIndication(() => (count += 1));
    const value = new DataView(new Uint8Array([0x80]).buffer);
    port.notify(FITNESS_MACHINE_SERVICE, FITNESS_MACHINE_CONTROL_POINT, value);
    off();
    port.notify(FITNESS_MACHINE_SERVICE, FITNESS_MACHINE_CONTROL_POINT, value);

    expect(count).toBe(1);
  });
});

describe('fitness machine status', () => {
  it('subscribes lazily, on the first listener', async () => {
    const port = await startedPort();
    const channel = createCapacitorFitnessMachineChannel(port, SCRIPTED_DEVICE.deviceId);

    expect(port.calls.some((call) => call.includes(FITNESS_MACHINE_STATUS))).toBe(false);

    channel.onStatus(() => undefined);

    expect(
      port.calls.some(
        (call) =>
          call === `startNotifications:${FITNESS_MACHINE_SERVICE}|${FITNESS_MACHINE_STATUS}`,
      ),
    ).toBe(true);
  });

  it('survives a machine that serves no status characteristic', async () => {
    // FTMS makes it optional and real trainers omit it. Losing status costs the
    // client its early warning that control was taken away, and nothing else —
    // so it must not take the ride screen down with it.
    const port = await startedPort();
    const failing = {
      ...port,
      startNotifications: (
        _deviceId: string,
        _service: string,
        characteristic: string,
      ): Promise<void> =>
        characteristic === FITNESS_MACHINE_STATUS
          ? Promise.reject(new Error('no status characteristic'))
          : Promise.resolve(),
    };
    const channel = createCapacitorFitnessMachineChannel(failing, SCRIPTED_DEVICE.deviceId);

    expect(() => channel.onStatus(() => undefined)).not.toThrow();
    // Let the rejected subscription settle; nothing must escape as unhandled.
    await Promise.resolve();
    await Promise.resolve();
  });
});

describe('what the trainer says it will accept', () => {
  it('reads the supported power range off the device', async () => {
    const port = await startedPort({
      reads: { [`${FITNESS_MACHINE_SERVICE}|${SUPPORTED_POWER_RANGE}`]: powerRangeBytes() },
    });

    const machine = await readCapacitorFitnessMachine(port, SCRIPTED_DEVICE.deviceId);

    expect(machine.powerRange?.maximum).toBe(2_000);
    expect(machine.powerRange?.increment).toBe(1);
  });

  it('reports an absent power range rather than inventing one', async () => {
    // The one that matters: an unbounded setpoint on a machine whose limits are
    // unknown is the failure this whole path exists to prevent, so the caller
    // has to be able to tell that it does not know.
    const port = await startedPort();

    const machine = await readCapacitorFitnessMachine(port, SCRIPTED_DEVICE.deviceId);

    expect(machine.powerRange).toBeUndefined();
  });

  it('keeps a power range when the optional characteristics are missing', async () => {
    // A trainer serving a control point and a power range but no feature bits is
    // a controllable trainer. Refusing it because an optional read failed would
    // turn a working trainer into an uncontrollable one.
    const port = await startedPort({
      reads: { [`${FITNESS_MACHINE_SERVICE}|${SUPPORTED_POWER_RANGE}`]: powerRangeBytes() },
    });

    const machine = await readCapacitorFitnessMachine(port, SCRIPTED_DEVICE.deviceId);

    expect(machine.powerRange).toBeDefined();
    expect(machine.features).toBeUndefined();
    expect(machine.resistanceRange).toBeUndefined();
  });

  it('treats a malformed characteristic as unknown rather than trusting it', async () => {
    // A device lying about its own capabilities is untrusted input (CLAUDE.md
    // §6), and the safe direction is "we do not know".
    const port = await startedPort({
      reads: {
        [`${FITNESS_MACHINE_SERVICE}|${SUPPORTED_POWER_RANGE}`]: new DataView(new ArrayBuffer(1)),
      },
    });

    const machine = await readCapacitorFitnessMachine(port, SCRIPTED_DEVICE.deviceId);

    expect(machine.powerRange).toBeUndefined();
  });
});

describe('the id the trainer path is handed', () => {
  /**
   * ⚠️ **This test pins an assumption rather than a behaviour, and it is here
   * because the assumption is load-bearing and invisible.**
   *
   * `openCapacitorTrainer` in `apps/web` receives this program's branded
   * `DeviceId` and passes it straight to `readCapacitorFitnessMachine` and
   * `createCapacitorFitnessMachineChannel`, both of which want the **plugin's**
   * device id. That works only because `transport.ts` mints the former directly
   * from the latter — and `transport.ts`'s own `Link.pluginId` comment warns
   * that the plugin's id *"is not necessarily our `DeviceId`"*.
   *
   * Today they are the same string. If that ever stops being true, the symptom
   * would be a control point write addressed to a device the plugin has never
   * heard of — on the one path in this program that applies physical resistance
   * to somebody. This makes the change go red here instead.
   */
  it('is the plugin’s own id, unchanged', async () => {
    const port = await startedPort();
    const transport = createCapacitorTransport({
      plugin: port,
      profiles: [],
      now: () => unixSeconds(1_700_000_000),
    });

    const device = await transport.discover({ capabilities: [] });

    expect(device?.identity.id).toBe(SCRIPTED_DEVICE.deviceId);
  });
});
