// SPDX-License-Identifier: Apache-2.0

/**
 * The transport conformance suite: what every `SensorTransport` must do, written
 * once and pointed at whichever implementation is under test.
 *
 * ## Why it is a function and not a test file
 *
 * #44's fifth acceptance criterion asks that the conformance suite *"can be
 * pointed at a real device as well as the simulator, so a contributor with
 * hardware can run it and report a diff"*. A suite that is a test file is bound
 * to one implementation; a suite that is a function taking a factory is bound
 * to the **interface**, and the same assertions run against the simulator here,
 * against #40's Web Bluetooth adapter with a trainer on the desk, and against
 * #15's native adapter later. A red line in one and not the others is the diff
 * the criterion asks for.
 *
 * ## What it can and cannot assert
 *
 * Only what is true of *every* transport and *every* real device: the lifecycle
 * runs `disconnected → connecting → connected`, each declared capability
 * delivers within a few seconds, nothing is delivered before connection or after
 * disconnection, the identity on every measurement is the device's own. It
 * cannot assert an exact value — a real strap does not report 145 bpm on cue —
 * and it cannot script a fault. The simulator's own tests do both; this suite
 * is deliberately the part that survives contact with hardware.
 *
 * Time is abstracted through `settle`: the simulator advances its virtual
 * clock, a real transport waits. Nothing here names a timer, because this
 * package is forbidden one.
 */

import type { Seconds } from '@onyourleft/domain';
import { seconds } from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import {
  isMeasurementCapability,
  MEASUREMENT_CAPABILITIES,
  type MeasurementCapability,
  type SensorCapability,
} from '../capability';
import type { ConnectionState } from '../connection';
import { sameDevice } from '../device';
import { isSensorError } from '../errors';
import type { SensorMeasurement } from '../measurement';
import type { DiscoveryRequest, SensorTransport } from '../transport';

/** One transport, ready to be exercised. */
export interface ConformanceFixture {
  readonly transport: SensorTransport;
  /**
   * What to ask `discover` for. The device it returns is the device under test,
   * and the suite asserts against **its** declared capability set, so the
   * request only needs to single it out.
   */
  readonly request: DiscoveryRequest;
  /**
   * Let time pass. The simulator advances its clock; a real transport waits
   * that many wall-clock seconds. A function-typed property rather than a
   * method, so the suite can destructure it without binding.
   */
  readonly settle: (duration: Seconds) => Promise<void>;
}

/** How to obtain a fresh fixture for each test. */
export interface ConformanceSubject {
  /**
   * A new, independent transport every time. Tests must not share state, and
   * a factory is what makes that a property of the suite rather than of each
   * test's discipline.
   */
  create(): Promise<ConformanceFixture>;
}

/**
 * How long to wait for each capability to deliver its first measurement.
 *
 * Generous by BLE standards: every profile this program reads notifies at about
 * 1 Hz, and a CSC- or CPS-derived cadence needs two notifications before the
 * first interval exists.
 */
export const CONFORMANCE_DELIVERY_WINDOW: Seconds = seconds(5);

/**
 * Register the conformance suite against a subject.
 *
 * Call it at the top level of a test file, once per implementation.
 */
export function describeTransportConformance(name: string, subject: ConformanceSubject): void {
  describe(`${name} conforms to SensorTransport`, () => {
    it('reports itself available', async () => {
      const { transport } = await subject.create();
      expect(await transport.availability()).toEqual({ kind: 'available' });
    });

    it('discovers one device whose capabilities cover the request, starting disconnected', async () => {
      const { transport, request } = await subject.create();
      const device = await transport.discover(request);

      expect(device.identity.transport).toBe(transport.traits.id);
      for (const capability of request.capabilities) {
        expect(device.capabilities.has(capability)).toBe(true);
      }
      expect(transport.connectionState(device.identity.id)).toBe('disconnected');
    });

    it('returns known devices that are its own, distinct, and addressable', async () => {
      const { transport } = await subject.create();
      const known = await transport.knownDevices();

      // Deliberately not "how many". Web Bluetooth returns none, a native stack
      // returns its restorable peripherals, and the simulator returns its
      // catalogue — all three are correct, so a count assertion would only be
      // asserting which transport is under test. What must hold everywhere is
      // that each entry is usable: issued by *this* transport, not a duplicate,
      // and accepted by the id-keyed methods.
      const ids = known.map((device) => device.identity.id);
      expect(new Set(ids).size, 'a duplicate id aliases two devices to one handle').toBe(
        ids.length,
      );
      for (const device of known) {
        expect(device.identity.transport).toBe(transport.traits.id);
        // `connectionState` throws `device-not-found` for an id this transport
        // did not issue, so calling it is the check: a transport that hands back
        // a device it cannot then address has reported a device that is not there.
        expect(() => transport.connectionState(device.identity.id)).not.toThrow();
      }
    });

    it('connects through connecting, and connecting again is a no-op', async () => {
      const { transport, request } = await subject.create();
      const device = await transport.discover(request);
      const states: ConnectionState[] = [];
      transport.observeConnectionState(device.identity.id, (state) => states.push(state));

      await transport.connect(device.identity.id);
      expect(transport.connectionState(device.identity.id)).toBe('connected');
      expect(states).toEqual(['connecting', 'connected']);

      await transport.connect(device.identity.id);
      expect(states).toEqual(['connecting', 'connected']);
    });

    it('refuses to enable notifications before the connection exists', async () => {
      const { transport, request } = await subject.create();
      const device = await transport.discover(request);
      const capability = firstMeasurementCapability(device.capabilities);

      await transport
        .subscribe(device.identity.id, capability, () => undefined)
        .then(
          () => expect.unreachable('a disconnected device must not accept a subscription'),
          (error: unknown) => expect(isSensorError(error, 'not-connected')).toBe(true),
        );
    });

    it('delivers every declared measurement capability, attributed to the device', async () => {
      const { transport, request, settle } = await subject.create();
      const device = await transport.discover(request);
      await transport.connect(device.identity.id);

      const received = new Map<MeasurementCapability, SensorMeasurement[]>();
      for (const capability of MEASUREMENT_CAPABILITIES) {
        if (!device.capabilities.has(capability)) {
          continue;
        }
        const list: SensorMeasurement[] = [];
        received.set(capability, list);
        await transport.subscribe(device.identity.id, capability, (measurement) => {
          list.push(measurement);
        });
      }

      await settle(CONFORMANCE_DELIVERY_WINDOW);

      for (const [capability, list] of received) {
        expect(list.length, `${capability} delivered nothing`).toBeGreaterThan(0);
        for (const measurement of list) {
          expect(measurement.capability).toBe(capability);
          expect(sameDevice(measurement.device, device.identity)).toBe(true);
        }
        // Receive instants never run backwards within one stream.
        for (let index = 1; index < list.length; index += 1) {
          expect(list[index]?.at).toBeGreaterThanOrEqual(list[index - 1]?.at ?? Number.NaN);
        }
      }
    });

    it('refuses a measurement capability the device does not declare', async () => {
      const { transport, request } = await subject.create();
      const device = await transport.discover(request);
      await transport.connect(device.identity.id);

      const missing = MEASUREMENT_CAPABILITIES.find(
        (capability) => !device.capabilities.has(capability),
      );
      if (missing === undefined) {
        // A device that declares everything has nothing to refuse. Recorded as
        // a pass rather than skipped silently, so the count is honest.
        expect(device.capabilities.size).toBeGreaterThanOrEqual(MEASUREMENT_CAPABILITIES.length);
        return;
      }

      await transport
        .subscribe(device.identity.id, missing, () => undefined)
        .then(
          () => expect.unreachable(`${missing} is not declared and must be refused`),
          (error: unknown) => expect(isSensorError(error, 'capability-unsupported')).toBe(true),
        );
    });

    it('delivers nothing after unsubscribe, and nothing after disconnect', async () => {
      const { transport, request, settle } = await subject.create();
      const device = await transport.discover(request);
      await transport.connect(device.identity.id);
      const capability = firstMeasurementCapability(device.capabilities);

      const stopped: SensorMeasurement[] = [];
      const stop = await transport.subscribe(device.identity.id, capability, (m) =>
        stopped.push(m),
      );
      const live: SensorMeasurement[] = [];
      await transport.subscribe(device.identity.id, capability, (m) => live.push(m));

      await settle(CONFORMANCE_DELIVERY_WINDOW);
      stop();
      const stoppedCount = stopped.length;
      const liveCount = live.length;
      expect(liveCount).toBeGreaterThan(0);

      await settle(CONFORMANCE_DELIVERY_WINDOW);
      expect(stopped.length).toBe(stoppedCount);
      expect(live.length).toBeGreaterThan(liveCount);

      await transport.disconnect(device.identity.id);
      expect(transport.connectionState(device.identity.id)).toBe('disconnected');
      const afterDisconnect = live.length;

      await settle(CONFORMANCE_DELIVERY_WINDOW);
      expect(live.length).toBe(afterDisconnect);
    });
  });
}

function firstMeasurementCapability(
  capabilities: ReadonlySet<SensorCapability>,
): MeasurementCapability {
  const found = [...capabilities].find(isMeasurementCapability);
  if (found === undefined) {
    throw new Error('the device under test declares no measurement capability');
  }
  return found;
}
