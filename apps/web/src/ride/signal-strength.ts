// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Signal strength on the Devices screen, in words — #1435.
 *
 * ## Words, three of them
 *
 * A dBm figure means nothing to somebody on a bike, and a bar graph is a state
 * painted rather than said (SC 1.4.1, `SensorPairing.tsx`'s header). So the
 * reading becomes one of three words, and the weak one says what to do. The
 * bands are the usual reading of a BLE RSSI: from -70 dBm a link is solid, to
 * -85 dBm it holds, and below that it drops packets and then the link.
 *
 * ## ⚠️ Read only while nothing is driving a trainer
 *
 * The Android plugin runs every call through ONE queue, and an RSSI read that
 * the radio does not answer waits there for the plugin's five-second bound.
 * Behind it would wait any control point write — a Stop included. So the
 * screen reads signal only while no ride is under way and this app holds no
 * trainer control ({@link maySignalBeRead}); at those times nothing is being
 * written to a trainer for a read to delay. The read itself sends nothing to
 * the device (`apps/mobile/src/ble/plugin-port.ts` §`readRssi`).
 */

import { useEffect, useState } from 'react';

import type { DeviceId } from '@onyourleft/sensors';

import { rideInProgress, type PairedSensor, type RideSnapshot } from './controller';
import type { SignalStrengthPort } from './signal-port';

/** How often the screen asks, while it is open. */
export const SIGNAL_READ_EVERY_MILLISECONDS = 5000;

/** From here up a link is solid. */
const STRONG_FROM_DBM = -70;
/** From here up it holds; below it, it drops. */
const FAIR_FROM_DBM = -85;

/** What a reading says on the screen. */
export function signalWords(dbm: number): string {
  if (dbm >= STRONG_FROM_DBM) {
    return 'Signal strong';
  }
  if (dbm >= FAIR_FROM_DBM) {
    return 'Signal fair';
  }
  return 'Signal weak — bring the phone closer to it';
}

/** Whether the screen may ask the radio now. @see this file's header */
export function maySignalBeRead(snapshot: RideSnapshot): boolean {
  return !rideInProgress(snapshot.phase) && !snapshot.trainer.hasControl;
}

/** No readings: one value, so an effect that clears them changes no state. */
const NONE: ReadonlyMap<DeviceId, number> = new Map();

/**
 * The latest reading for each connected sensor, asked for every
 * {@link SIGNAL_READ_EVERY_MILLISECONDS} while `enabled`. Empty with no port,
 * while not enabled, and for a sensor that is not connected.
 */
export function useSignalStrengths(
  port: SignalStrengthPort | undefined,
  sensors: readonly PairedSensor[],
  enabled: boolean,
): ReadonlyMap<DeviceId, number> {
  const [readings, setReadings] = useState<ReadonlyMap<DeviceId, number>>(NONE);
  // The ids to read, as one string, so a snapshot that changes nothing about
  // which sensors are connected does not restart the timer.
  const connected = sensors
    .filter((sensor) => sensor.state === 'connected')
    .map((sensor) => sensor.id)
    .join('\n');

  useEffect(() => {
    if (port === undefined || !enabled || connected === '') {
      setReadings(NONE);
      return undefined;
    }
    const ids = connected.split('\n') as DeviceId[];
    let live = true;
    let busy = false;
    const readAll = async (): Promise<void> => {
      // One round at a time: a slow radio is not asked again on top of itself.
      if (busy) {
        return;
      }
      busy = true;
      const next = new Map<DeviceId, number>();
      for (const id of ids) {
        const dbm = await port.readSignal(id);
        if (dbm !== undefined) {
          next.set(id, dbm);
        }
      }
      busy = false;
      if (live) {
        setReadings(next);
      }
    };
    void readAll();
    const timer = setInterval(() => {
      void readAll();
    }, SIGNAL_READ_EVERY_MILLISECONDS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [port, connected, enabled]);

  return readings;
}
