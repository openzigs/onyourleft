// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The sensors this phone remembers, so the Android shell can reconnect to
 * them with no chooser** — #2669.
 *
 * ## What is kept, and nothing else
 *
 * For each sensor the rider paired in the shell: its device id, the name it
 * advertised, and which role it was paired as ({@link RememberedRole}: a
 * {@link PairingRole}, or `controller` for the steering controller, #2672).
 * On Android
 * the device id is the sensor's Bluetooth address. Nothing it measured, no time
 * and no count is kept, so this says which sensors a rider owns and nothing
 * about a ride.
 *
 * ## Who writes it, and who reads it
 *
 * The ride controller writes it: a sensor that paired is remembered, and one
 * the rider forgets on the Devices screen is let go here too
 * (`controller.ts` §`RideControllerOptions.remembered`). It reads it when the
 * app opens, to reconnect them. {@link transportSeed} is the Capacitor
 * transport's view of the same list, because that transport has to know the
 * ids to ask the plugin for — `apps/mobile` `transport.ts` §`knownDevices`.
 *
 * The steering controller is kept here too, as role `controller` — #2672. It
 * pairs through its own client and not the transport, so it is the steering
 * controller that writes and reads that entry (`steering-controller.ts`
 * §`SteeringReconnect`), and {@link transportSeed} and the ride controller's
 * restore both pass over it.
 *
 * ⚠️ **The Android shell only.** `main.tsx` builds this beside the Capacitor
 * transport and nowhere else: Web Bluetooth has no silent reconnect
 * (docs/agents/web-bluetooth.md §8), so a browser that remembered would be
 * remembering for nothing.
 *
 * ## On the device, and only there
 *
 * `localStorage`, through the same `PreferenceStorage` double as the other
 * device-local settings (`ride/trainer-target-memory.ts` does the same). It is
 * in no export and is sent to no instance: no module that sends anything reads
 * it (`privacy/no-network.test.ts`). *Erase everything* takes the key
 * ({@link RememberedSensors.forget}, through `transfer/erase-device.ts`), and
 * the page's copy with it.
 *
 * ## What a wrong or hostile entry can do
 *
 * An entry this build does not read is dropped, one by one. A wrong id is a
 * reconnect that does not find its sensor. ⚠️ **No entry can move a trainer:**
 * a reconnect asks the trainer for nothing (`controller.ts` §`reconnect`), and
 * control is a thing the rider does.
 */

import type { SensorCapability } from '@onyourleft/sensors';
import { deviceId, type DeviceId } from '@onyourleft/sensors';

import type { PreferenceStorage } from '../game/hud/announce-preference';

import { PAIRING_ROLE_CAPABILITIES, type PairingRole } from './controller';

/** What this module asks of a `Storage`: a preference's two, and the erase's one. */
export type RememberedSensorStorage = PreferenceStorage & Pick<Storage, 'removeItem'>;

/** Namespaced, because the origin is shared. The `v1` is the shape's. */
export const REMEMBERED_SENSORS_STORAGE_KEY = 'oyl.rememberedSensors.v1';

/**
 * How many sensors are remembered. The connection budget is three; this is a
 * bound on a hostile or stale key, not a need.
 */
const MOST_REMEMBERED = 8;

/**
 * What a remembered device was paired as: a sensor's {@link PairingRole}, or
 * `controller`, the steering controller (#2672).
 */
export type RememberedRole = PairingRole | 'controller';

/** One remembered sensor: the three things kept, and nothing else. */
export interface RememberedSensor {
  readonly id: DeviceId;
  /** As it advertised itself when it was paired. May be empty. */
  readonly name: string;
  readonly role: RememberedRole;
}

/**
 * The sensor role of a remembered device, or `undefined` for the steering
 * controller, which neither the transport nor the ride controller pairs.
 */
function sensorRole(role: RememberedRole): PairingRole | undefined {
  return role === 'controller' ? undefined : role;
}

/** The sensors this phone remembers across a restart of the app. */
export interface RememberedSensors {
  /** In the order they were paired, first first. Never throws. */
  list(): readonly RememberedSensor[];
  /** A sensor paired. Replaces what was kept for the same id. Never throws. */
  remember(sensor: RememberedSensor): void;
  /** The rider forgot this one on the Devices screen. Never throws. */
  drop(id: DeviceId): void;
  /** *Erase everything*: forget every sensor, here and on the device. Never throws. */
  forget(): void;
}

/**
 * The device's own storage, or `undefined` where reaching for it throws, as
 * `ride/trainer-target-memory.ts` §`trainerTargetStorage` does it.
 */
export function rememberedSensorStorage(): RememberedSensorStorage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

function isRole(value: unknown): value is RememberedRole {
  return (
    typeof value === 'string' &&
    (value === 'controller' || Object.hasOwn(PAIRING_ROLE_CAPABILITIES, value))
  );
}

function asRemembered(value: unknown): RememberedSensor | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { id, name, role } = value as Record<string, unknown>;
  if (typeof id !== 'string' || id === '' || typeof name !== 'string' || !isRole(role)) {
    return undefined;
  }
  return { id: deviceId(id), name, role };
}

/** What this device has stored, entry by entry. Never throws. */
function read(storage: PreferenceStorage | undefined): Map<DeviceId, RememberedSensor> {
  const entries = new Map<DeviceId, RememberedSensor>();
  let raw: unknown;
  try {
    const text = storage?.getItem(REMEMBERED_SENSORS_STORAGE_KEY) ?? null;
    raw = text === null ? undefined : (JSON.parse(text) as unknown);
  } catch {
    return entries;
  }
  if (!Array.isArray(raw)) return entries;
  for (const value of raw.slice(-MOST_REMEMBERED)) {
    const sensor = asRemembered(value);
    if (sensor !== undefined) entries.set(sensor.id, sensor);
  }
  return entries;
}

/**
 * The memory over this device's storage. `undefined` storage (a blocked or
 * private store) remembers for the life of the page only, which is how
 * pairing worked before.
 */
export function createRememberedSensors(
  storage: RememberedSensorStorage | undefined,
): RememberedSensors {
  const entries = read(storage);
  const write = (): void => {
    try {
      // The three fields by name, so nothing else a caller's object carries
      // can reach the device.
      storage?.setItem(
        REMEMBERED_SENSORS_STORAGE_KEY,
        JSON.stringify([...entries.values()].map(({ id, name, role }) => ({ id, name, role }))),
      );
    } catch {
      // A full or refusing store keeps this in the page only.
    }
  };
  return {
    list: () => [...entries.values()],
    remember(sensor): void {
      entries.delete(sensor.id);
      entries.set(sensor.id, sensor);
      // By order of writing: the sensor just paired is last, so never dropped.
      while (entries.size > MOST_REMEMBERED) {
        const oldest = entries.keys().next();
        if (oldest.done === true) break;
        entries.delete(oldest.value);
      }
      write();
    },
    drop(id): void {
      if (entries.delete(id)) write();
    },
    forget(): void {
      entries.clear();
      try {
        storage?.removeItem(REMEMBERED_SENSORS_STORAGE_KEY);
      } catch {
        // Storage refused: nothing more this device can do about it.
      }
    },
  };
}

/** One remembered sensor as the Capacitor transport takes it (`CapacitorRememberedDevice`). */
export interface RememberedForTransport {
  readonly id: string;
  readonly name: string;
  readonly capabilities: readonly SensorCapability[];
}

/**
 * The list the Capacitor transport asks the plugin about — #2669. The
 * capabilities are the ones a pairing of that role asks the chooser for
 * ({@link PAIRING_ROLE_CAPABILITIES}), so a reconnected sensor carries what
 * the same sensor paired by hand would have.
 *
 * The steering controller is left out (#2672): the transport never pairs one,
 * and its own client reaches it by id.
 */
export function transportSeed(memory: RememberedSensors): () => readonly RememberedForTransport[] {
  return () =>
    memory.list().flatMap((sensor) => {
      const role = sensorRole(sensor.role);
      return role === undefined
        ? []
        : [{ id: sensor.id, name: sensor.name, capabilities: PAIRING_ROLE_CAPABILITIES[role] }];
    });
}
