// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Each sensor's battery, on Home's sensors module — #2047.
 *
 * ## A number, a percent sign and words for a low one
 *
 * A level is said as `Battery 37%`. At or under {@link LOW_BATTERY_PERCENT}
 * it also says it is low and what to do, in words — the warning colour beside
 * them is a second signal, never the only one (WCAG 2.2 SC 1.4.1). A sensor
 * that reports no level says nothing about its battery at all: no `0%`, no
 * "unknown". `HomeView.battery.a11y.test.tsx` holds both.
 *
 * ## ⚠️ Read only while nothing is driving a trainer
 *
 * The read waits in the transport's one GATT queue, shared by every device,
 * so a strap's read also holds up a trainer's control-point write — a Stop
 * included. So, as the Devices screen's
 * signal strength (`signal-strength.ts` §"Read only while nothing is driving
 * a trainer"), the level is asked for only while no ride is under way and
 * this app holds no trainer control ({@link mayBatteryBeRead}), and at most
 * once a minute: a battery does not move faster than that.
 */

import { useEffect, useState } from 'react';

import type { Percent } from '@onyourleft/domain';
import type { DeviceId } from '@onyourleft/sensors';

import type { BatteryLevelPort } from './battery-port';
import { rideInProgress, type PairedSensor, type RideSnapshot } from './controller';

/** How often the module asks again, while it is open. */
export const BATTERY_READ_EVERY_MILLISECONDS = 60_000;

/**
 * At or under this the module says the battery is low — 20 %, the level at
 * which phones and bike computers commonly start to warn, and on a coin-cell
 * strap still a few rides' notice rather than this ride's.
 */
export const LOW_BATTERY_PERCENT = 20;

/** Whether a level is the low one. */
export function isLowBattery(level: Percent): boolean {
  return level <= LOW_BATTERY_PERCENT;
}

/** What a level says. */
export function batteryWords(level: Percent): string {
  const { before, shown, after } = batteryBadgeWords(level);
  return `${before}${shown}${after}`;
}

/**
 * {@link batteryWords} split for Home's compact badge (the owner's review of
 * #2045): what is `shown` on screen beside the glyph — the number and, when
 * it is low, `low` — and what is said only to a screen reader `before` and
 * `after` it. The three together are always {@link batteryWords}.
 */
export function batteryBadgeWords(level: Percent): {
  readonly before: string;
  readonly shown: string;
  readonly after: string;
} {
  const figure = `${String(Math.round(level))}%`;
  return isLowBattery(level)
    ? { before: 'Battery ', shown: `${figure}, low`, after: ' — charge it or change it soon' }
    : { before: 'Battery ', shown: figure, after: '' };
}

/** Whether the module may ask the devices now. @see this file's header */
export function mayBatteryBeRead(snapshot: RideSnapshot): boolean {
  return !rideInProgress(snapshot.phase) && !snapshot.trainer.hasControl;
}

/** No levels: one value, so an effect that clears them changes no state. */
const NONE: ReadonlyMap<DeviceId, Percent> = new Map();

/**
 * The latest level for each connected sensor that reports one, asked for on
 * opening and every {@link BATTERY_READ_EVERY_MILLISECONDS} while `enabled`.
 * Empty with no port, while not enabled, and for a sensor that is not
 * connected or reports no level.
 */
export function useBatteryLevels(
  port: BatteryLevelPort | undefined,
  sensors: readonly PairedSensor[],
  enabled: boolean,
): ReadonlyMap<DeviceId, Percent> {
  const [levels, setLevels] = useState<ReadonlyMap<DeviceId, Percent>>(NONE);
  // The ids to read, as one string, so a snapshot that changes nothing about
  // which sensors are connected does not restart the timer.
  const connected = sensors
    .filter((sensor) => sensor.state === 'connected')
    .map((sensor) => sensor.id)
    .join('\n');

  useEffect(() => {
    if (port === undefined || !enabled || connected === '') {
      setLevels(NONE);
      return undefined;
    }
    const ids = connected.split('\n') as DeviceId[];
    let live = true;
    let busy = false;
    const readAll = async (): Promise<void> => {
      // One round at a time: a slow device is not asked again on top of itself.
      if (busy) {
        return;
      }
      busy = true;
      const next = new Map<DeviceId, Percent>();
      for (const id of ids) {
        // Closed while a read was out: ask for nothing more.
        if (!live) {
          break;
        }
        const level = await port.readBatteryLevel(id);
        if (level !== undefined) {
          next.set(id, level);
        }
      }
      busy = false;
      if (live) {
        setLevels(next);
      }
    };
    void readAll();
    const timer = setInterval(() => {
      void readAll();
    }, BATTERY_READ_EVERY_MILLISECONDS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [port, connected, enabled]);

  return levels;
}
