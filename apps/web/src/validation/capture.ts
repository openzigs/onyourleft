// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **A recording wrapper around `navigator.bluetooth`, so an afternoon with real
 * hardware produces evidence rather than recollection.**
 *
 * Three issues need bytes that came off a device, and none of them can be
 * discharged by an agent:
 *
 * - [#134](https://github.com/openzigs/onyourleft/issues/134) — *"Frames
 *   captured from at least one real power meter and one real speed/cadence
 *   sensor, committed as fixtures with the device and firmware recorded"*, and
 *   *"any deviation from the specification documented next to the fixture
 *   rather than worked around silently in the decoder"*.
 * - [#137](https://github.com/openzigs/onyourleft/issues/137) — the FTMS
 *   control point, which **applies physical resistance to a person who is
 *   pedalling**. Its hardest item is what a real trainer does when the link
 *   drops mid-ERG, and the issue is explicit that the observed behaviour has to
 *   exist before the product decision can be made.
 * - [#138](https://github.com/openzigs/onyourleft/issues/138) — encoded files
 *   against two real platforms, which needs no capture but the same session.
 *
 * ## Why it wraps the port rather than hooking the decoder
 *
 * `createWebBluetoothTransport` takes its `bluetooth` port by injection, so a
 * wrapper sits at the **platform boundary** — the last place the bytes are the
 * device's own. Everything above it is unmodified: the same transport, the same
 * profiles, the same decoders that ship. Two consequences, and both are the
 * point:
 *
 * 1. **What is captured is what production sees.** A capture taken through a
 *    special code path would prove things about the special code path.
 * 2. **A decoder bug cannot hide a frame.** #134 wants the wire bytes precisely
 *    so that a disagreement between the specification and a real device is
 *    visible. Recording `PowerMeasurement` objects would record our reading of
 *    the frame, which is the thing under suspicion.
 *
 * ## What it records, and the two things it deliberately does not
 *
 * Every notification payload, every read, every write and its outcome, each
 * with a monotonic offset from the start of the session. Writes carry their
 * **rejection** too: #137's second item is that a refused command is reported
 * as refused, and an ATT error is only observable as a rejected promise.
 *
 * ⚠️ **It records no device name and no device id.** A Web Bluetooth device id
 * is origin-scoped and opaque rather than a hardware address, so it is not
 * itself identifying — but a capture is committed to a public repository as a
 * fixture, and a trainer's advertised name is routinely the owner's. The
 * hardware is identified in the write-up by model and firmware, typed by a
 * person who knows what they are disclosing, rather than scraped from the
 * advertisement. `docs/validation/0001-trainer-and-sensors.md` §"What to
 * record" is where that goes.
 *
 * ⚠️ **It records no timestamps of the wall clock**, only offsets. A committed
 * fixture that says when somebody was riding is a small fact about their life,
 * and the analysis needs the intervals rather than the instants.
 */

import type { BluetoothPort } from '@onyourleft/sensors/web-bluetooth';

/** What happened, in the order it happened. */
export type CaptureEventKind = 'notify' | 'read' | 'write' | 'write-rejected';

/** One thing that crossed the platform boundary. */
export interface CaptureEvent {
  /** Milliseconds since the capture began. Never a wall-clock instant. */
  readonly atMs: number;
  readonly kind: CaptureEventKind;
  /** The characteristic's canonical UUID. */
  readonly characteristic: string;
  /**
   * The payload, lowercase hex, no separators.
   *
   * Empty for a rejected write with no value, which cannot happen today and is
   * not worth a second shape.
   */
  readonly hex: string;
  /**
   * Why a write was refused, when it was.
   *
   * ⚠️ The message, not the object: a `DOMException` does not survive
   * `JSON.stringify` and would land in the capture as `{}`. That is the same
   * failure mode as serialising a non-extractable `CryptoKey`, and it looks
   * like success.
   */
  readonly error?: string;
}

/** A session's worth of traffic, ready to be written to a file. */
export interface CaptureLog {
  /** The format version and the identity in one key — ADR 0017 D-3's shape. */
  readonly onYourLeftCapture: 1;
  /**
   * What the person running this typed about the hardware.
   *
   * Free text on purpose. #134 and #137 both ask for "the device and firmware
   * recorded", and a firmware string is not readable over GATT on every
   * trainer — the Device Information Service is optional. Asking the rider is
   * the reliable path, and it is also the consent step: nothing about the
   * hardware reaches the file unless somebody wrote it there.
   */
  readonly hardware: string;
  readonly events: readonly CaptureEvent[];
}

/** Lowercase hex, no separators — the shape a fixture is diffed in. */
export function toHex(view: DataView): string {
  let hex = '';
  for (let index = 0; index < view.byteLength; index += 1) {
    hex += view.getUint8(index).toString(16).padStart(2, '0');
  }
  return hex;
}

/** Collects events and answers with the log. */
export interface Capture {
  readonly events: readonly CaptureEvent[];
  record(event: Omit<CaptureEvent, 'atMs'>): void;
  log(hardware: string): CaptureLog;
  /**
   * A name for the downloaded file.
   *
   * ⚠️ **Numbered, not stamped.** The obvious `capture-${Date.now()}.json`
   * sorts nicely and puts a wall-clock instant in a committed file's *name*,
   * which is the same small fact about somebody's day that {@link CaptureEvent}
   * refuses to carry inside the document. A counter distinguishes two captures
   * taken in one sitting, which is all the name has to do; the fixture is
   * renamed to say what it is before anybody commits it.
   */
  fileName(): string;
}

/**
 * A capture whose clock is injected.
 *
 * `now` is a parameter for the reason `packages/domain`'s recording engine
 * takes one: a clock read inside a function is a fact a test cannot fix.
 */
export function createCapture(now: () => number = () => Date.now()): Capture {
  const began = now();
  const events: CaptureEvent[] = [];
  let saved = 0;
  return {
    events,
    record: (event) => {
      events.push({ ...event, atMs: Math.max(0, Math.round(now() - began)) });
    },
    log: (hardware) => ({ onYourLeftCapture: 1, hardware, events: [...events] }),
    fileName: () => {
      saved += 1;
      return `capture-${String(saved)}.json`;
    },
  };
}

/**
 * The same `BluetoothPort`, with everything that crosses it written down.
 *
 * Every wrapper here is **transparent**: it returns what the underlying object
 * returned, and rethrows what it threw. A recorder that swallowed a rejection
 * would change the behaviour under observation, which for the one path that
 * applies resistance to a rider is not an acceptable trade for a tidier log.
 */
export function recordingBluetooth(port: BluetoothPort, capture: Capture): BluetoothPort {
  return {
    getAvailability: () => port.getAvailability(),
    requestDevice: async (options) => {
      const device = await port.requestDevice(options);
      const gatt = device.gatt;
      if (gatt === undefined) {
        return device;
      }
      return {
        id: device.id,
        // The name is passed through so the chooser and the transport behave
        // normally; it is the *log* that never carries it. See the file header.
        ...(device.name === undefined ? {} : { name: device.name }),
        gatt: wrapServer(gatt, capture),
        addEventListener: (type, listener) => {
          device.addEventListener(type, listener);
        },
        removeEventListener: (type, listener) => {
          device.removeEventListener(type, listener);
        },
      };
    },
    ...(port.addEventListener === undefined
      ? {}
      : {
          addEventListener: (type: 'availabilitychanged', listener: () => void): void => {
            port.addEventListener?.(type, listener);
          },
        }),
    ...(port.removeEventListener === undefined
      ? {}
      : {
          removeEventListener: (type: 'availabilitychanged', listener: () => void): void => {
            port.removeEventListener?.(type, listener);
          },
        }),
  };
}

type Server = NonNullable<Awaited<ReturnType<BluetoothPort['requestDevice']>>['gatt']>;
type Service = Awaited<ReturnType<Server['getPrimaryService']>>;
type Characteristic = Awaited<ReturnType<Service['getCharacteristic']>>;

function wrapServer(server: Server, capture: Capture): Server {
  return {
    get connected() {
      return server.connected;
    },
    connect: () => server.connect(),
    disconnect: () => {
      server.disconnect();
    },
    getPrimaryService: async (uuid) => wrapService(await server.getPrimaryService(uuid), capture),
  };
}

function wrapService(service: Service, capture: Capture): Service {
  return {
    uuid: service.uuid,
    getCharacteristic: async (uuid) =>
      wrapCharacteristic(await service.getCharacteristic(uuid), capture),
  };
}

function wrapCharacteristic(characteristic: Characteristic, capture: Capture): Characteristic {
  const uuid = characteristic.uuid;
  return {
    uuid,
    get value() {
      return characteristic.value;
    },
    startNotifications: () => characteristic.startNotifications(),
    stopNotifications: () => characteristic.stopNotifications(),
    readValue: async () => {
      const view = await characteristic.readValue();
      capture.record({ kind: 'read', characteristic: uuid, hex: toHex(view) });
      return view;
    },
    writeValueWithResponse: async (value) => {
      const hex = toHex(viewOf(value));
      try {
        const result = await characteristic.writeValueWithResponse(value);
        capture.record({ kind: 'write', characteristic: uuid, hex });
        return result;
      } catch (error: unknown) {
        // #137's second item: a refused command must be visible as refused. An
        // ATT error is only ever a rejected promise, so this is the one place
        // it can be written down.
        capture.record({
          kind: 'write-rejected',
          characteristic: uuid,
          hex,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },
    // ⚠️ Wrapped and never called, exactly as `gatt.ts` declares it and nothing
    // in `packages/sensors` calls it. If a capture ever shows a write through
    // this path, the client has been changed to the unacknowledged sibling and
    // the rider's setpoint is fire-and-forget.
    writeValueWithoutResponse: (value) => characteristic.writeValueWithoutResponse(value),
    addEventListener: (type, listener) => {
      characteristic.addEventListener(type, () => {
        const view = characteristic.value;
        if (view !== undefined) {
          capture.record({ kind: 'notify', characteristic: uuid, hex: toHex(view) });
        }
        listener();
      });
    },
    removeEventListener: (type, listener) => {
      // ⚠️ Cannot remove the wrapped listener, because the wrapper is a
      // different function object. Said out loud rather than left as a silent
      // no-op: this is a capture tool a person runs for one session and closes,
      // so a handler that outlives its subscription costs a few extra rows in
      // the log. It would be wrong in the shipping adapter, and this is not it.
      characteristic.removeEventListener(type, listener);
    },
  };
}

/** `BufferSource` is a union; the log wants bytes either way. */
function viewOf(value: BufferSource): DataView {
  return ArrayBuffer.isView(value)
    ? new DataView(value.buffer, value.byteOffset, value.byteLength)
    : new DataView(value);
}
