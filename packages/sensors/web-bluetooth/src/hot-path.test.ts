// SPDX-License-Identifier: Apache-2.0

/**
 * #40's fifth acceptance criterion:
 *
 * > Notification handling allocates no per-notification garbage in the hot path,
 * > measured over a simulated hour at combined sensor rates.
 *
 * The rate below is the real one: a trainer, a power meter and a strap, each
 * notifying at 1 Hz for 3600 seconds, is **10 800 notifications** — and three is
 * the connection budget, not an arbitrary number (`plan.ts`). Parsing runs on
 * the main thread beside a ride screen updating at 1 Hz and eventually a 3D
 * world, so a per-notification allocation is a garbage collection pause during a
 * sprint.
 *
 * ## How this is measured, and why not in bytes
 *
 * A byte-level measurement was tried first and does not work. V8's escape
 * analysis removes allocations that do not escape a loop, so the sampling heap
 * profiler attributes *more* bytes to a loop that allocates nothing than to one
 * that allocates an object per iteration; and a `heapUsed` delta across the loop
 * reports 0.9 bytes per iteration on one run of the identical no-allocation loop
 * and 46 on the next, as JIT compilation lands in the middle of the window. A
 * gate built on either number would be a gate that reports whatever the compiler
 * happened to do.
 *
 * What *is* deterministic is where the allocations would have to come from. An
 * implementation allocates per notification by creating a closure, copying the
 * payload, building an intermediate array, or making a fresh context to hand the
 * decoder. Each of those is an object identity, and an identity is exactly
 * observable — so the assertions below are identity assertions taken **on every
 * one of the 10 800 notifications**, plus a check that nothing the adapter holds
 * has grown by the end.
 *
 * The one allocation that remains is the measurement itself, and it is *required*
 * to be fresh: a reused envelope would be mutated under a recorder that kept it.
 * The last test asserts that too, in the other direction.
 */

import { describe, expect, it } from 'vitest';

import { watts } from '@onyourleft/domain';

import type { SensorMeasurement } from '../../src/measurement';

import type { GattProfile, MeasurementSink } from './profile';
import { createWebBluetoothTransport } from './transport';
import { createFakeBluetooth } from './testing/fake-bluetooth';
import {
  multiFrame,
  STUB_MULTI_CHARACTERISTIC,
  STUB_MULTI_SERVICE,
  stubTrainerDevice,
} from './testing/profiles';

/** A trainer, a power meter and a strap at 1 Hz for an hour. */
const NOTIFICATIONS_IN_A_SIMULATED_HOUR = 3 * 60 * 60;

/** What the adapter handed the decoder, notification by notification. */
interface Witness {
  readonly views: Set<DataView>;
  readonly sinks: Set<MeasurementSink>;
  calls: number;
}

function witnessProfile(witness: Witness): GattProfile {
  return {
    service: STUB_MULTI_SERVICE,
    characteristic: STUB_MULTI_CHARACTERISTIC,
    capabilities: ['power'],
    decode(value, sink) {
      witness.calls += 1;
      witness.views.add(value);
      witness.sinks.add(sink);
      sink.power(watts(value.getUint16(0, true)));
    },
  };
}

async function simulatedHour() {
  const witness: Witness = { views: new Set(), sinks: new Set(), calls: 0 };
  const fake = createFakeBluetooth({ devices: [stubTrainerDevice()] });
  const transport = createWebBluetoothTransport({
    profiles: [witnessProfile(witness)],
    bluetooth: fake.bluetooth,
    hasUserActivation: () => true,
  });
  const device = await transport.discover({ capabilities: ['power'] });
  await transport.connect(device.identity.id);

  const delivered: SensorMeasurement[] = [];
  await transport.subscribe(device.identity.id, 'power', (measurement) =>
    delivered.push(measurement),
  );

  const trainer = fake.bench.device('stub-trainer');
  const handlersDuring = new Set<number>();
  for (let tick = 0; tick < NOTIFICATIONS_IN_A_SIMULATED_HOUR; tick += 1) {
    trainer.notify(
      STUB_MULTI_SERVICE,
      STUB_MULTI_CHARACTERISTIC,
      multiFrame(150 + (tick % 100), 85, 90),
    );
    handlersDuring.add(trainer.listeners(STUB_MULTI_SERVICE, STUB_MULTI_CHARACTERISTIC));
  }

  return { witness, delivered, handlersDuring, fake, transport, device };
}

describe('the notification hot path, over a simulated hour', () => {
  it('reads every notification, and delivers every one', async () => {
    const { witness, delivered } = await simulatedHour();
    // Asserted before anything else, because every identity assertion below is
    // vacuously true over an empty set.
    expect(witness.calls).toBe(NOTIFICATIONS_IN_A_SIMULATED_HOUR);
    expect(delivered).toHaveLength(NOTIFICATIONS_IN_A_SIMULATED_HOUR);
  });

  it('hands the decoder the characteristic’s own view, never a copy', async () => {
    const { witness } = await simulatedHour();
    // A `new DataView(...)` or a `slice()` per notification is 10 800 buffers an
    // hour, and it is the most natural thing to write when a decoder looks like
    // it wants its own copy.
    expect(witness.views.size).toBe(1);
  });

  it('hands the decoder one sink for the life of the link', async () => {
    const { witness } = await simulatedHour();
    // A sink built per notification would be four closures and an object every
    // time — which is what a `decode(value, { power: (w) => … })` call site
    // does, and it reads perfectly well.
    expect(witness.sinks.size).toBe(1);
  });

  it('keeps exactly one notification handler installed throughout', async () => {
    const { handlersDuring } = await simulatedHour();
    expect(handlersDuring).toEqual(new Set([1]));
  });

  it('holds nothing that grew with the notification count', async () => {
    const { fake, transport, device, delivered } = await simulatedHour();
    // Every structure the adapter keeps is per device, per link or per
    // subscription. If any of them were per notification, the hour would leave
    // it 10 800 entries long — and the observable end of that is the listener
    // count and the fact that one more notification still delivers exactly once.
    const trainer = fake.bench.device('stub-trainer');
    expect(trainer.listeners(STUB_MULTI_SERVICE, STUB_MULTI_CHARACTERISTIC)).toBe(1);
    expect(trainer.disconnectListeners).toBe(1);

    const before = delivered.length;
    trainer.notify(STUB_MULTI_SERVICE, STUB_MULTI_CHARACTERISTIC, multiFrame(200, 90, 90));
    expect(delivered.length - before).toBe(1);
    expect(transport.connectionState(device.identity.id)).toBe('connected');
  });

  it('gives every measurement its own object, because a recorder keeps them', async () => {
    const { delivered } = await simulatedHour();
    // The other direction. One allocation per delivered measurement is not
    // garbage — it is the product — and reusing a mutable envelope would rewrite
    // a sample a recorder had already accepted.
    expect(new Set(delivered).size).toBe(delivered.length);
    expect(delivered[0]?.at).toBeTypeOf('number');
  });

  it('does not stamp an instant per field, so one frame is one instant', async () => {
    const { delivered } = await simulatedHour();
    const instants = delivered.map((measurement) => measurement.at);
    for (let index = 1; index < instants.length; index += 1) {
      expect(instants[index]).toBeGreaterThanOrEqual(instants[index - 1] ?? Number.NaN);
    }
  });
});
