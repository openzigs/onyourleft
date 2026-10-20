// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Which readings the Ride screen shows, in which order, and how many — #1433.
 *
 * ## What a rider chooses
 *
 * The four channels `controller.ts` §`RIDE_METRIC_IDS` reads — power,
 * cadence, heart rate and speed — ranked, and each shown or not. At least one
 * is always shown: a Ride screen with no readings is a choice nobody makes on
 * purpose, and it would leave the zoom with nothing to enlarge.
 *
 * The zoom is the other half: {@link ZOOMED_READING_COUNT} readings at the
 * zoomed size, or every chosen one at the ordinary size. Zoomed, the
 * **top-ranked** readings are the ones kept, so the rider's ranking is what
 * decides what survives the zoom and nothing else does.
 *
 * ## On the DEVICE, like the announcements
 *
 * `game/hud/announce-preference.ts`'s reasoning, and its shape: a bar-mounted
 * phone and a laptop on a desk are read at different distances, so this is a
 * property of the screen rather than of the athlete. `localStorage`, wrapped,
 * no schema change. ⚠️ The cost, stated: it does not travel with the account
 * export (#35).
 *
 * ⚠️ **Anything this module cannot read is the default, field by field.** An
 * unknown id is dropped, a missing one is added back at the end of the order,
 * a duplicate is kept once, and a stored choice that hides everything shows
 * everything — so a value written by another build never takes the ride
 * screen down or leaves it empty.
 */

import { RIDE_METRIC_IDS, type RideMetric } from './controller';
import type { RideMetricId } from './metrics';
import type { PreferenceStorage } from '../game/hud/announce-preference';

/** How many readings the zoom keeps — "about two large readings" (#1433). */
export const ZOOMED_READING_COUNT = 2;

export interface RideReadingsChoice {
  /** All four channels, highest rank first. */
  readonly order: readonly RideMetricId[];
  /** The channels the rider turned off. Never all four. */
  readonly hidden: readonly RideMetricId[];
  /** Whether the zoom is on: the top {@link ZOOMED_READING_COUNT}, larger. */
  readonly zoomed: boolean;
}

/** The order the screen had before #1433, everything shown, and no zoom. */
const DEFAULT_RIDE_READINGS: RideReadingsChoice = {
  order: RIDE_METRIC_IDS,
  hidden: [],
  zoomed: false,
};

/** Namespaced, because the origin is shared. The `v1` is the shape's. */
export const RIDE_READINGS_STORAGE_KEY = 'oyl.rideReadings.v1';

function isMetricId(value: unknown): value is RideMetricId {
  return typeof value === 'string' && (RIDE_METRIC_IDS as readonly string[]).includes(value);
}

/** Every known id once, in the stored order, then any left out in the default order. */
function completeOrder(value: unknown): readonly RideMetricId[] {
  const stored = Array.isArray(value) ? value.filter(isMetricId) : [];
  const seen = [...new Set(stored)];
  return [...seen, ...RIDE_METRIC_IDS.filter((id) => !seen.includes(id))];
}

function knownHidden(value: unknown): readonly RideMetricId[] {
  const stored = Array.isArray(value) ? value.filter(isMetricId) : [];
  const hidden = [...new Set(stored)];
  return hidden.length >= RIDE_METRIC_IDS.length ? [] : hidden;
}

/** What this device has stored, or the defaults — field by field. Never throws. */
export function readRideReadings(storage: PreferenceStorage | undefined): RideReadingsChoice {
  let raw: unknown;
  try {
    const text = storage?.getItem(RIDE_READINGS_STORAGE_KEY) ?? null;
    raw = text === null ? undefined : (JSON.parse(text) as unknown);
  } catch {
    return DEFAULT_RIDE_READINGS;
  }
  if (typeof raw !== 'object' || raw === null) return DEFAULT_RIDE_READINGS;
  const stored = raw as Record<string, unknown>;
  return {
    order: completeOrder(stored['order']),
    hidden: knownHidden(stored['hidden']),
    zoomed: stored['zoomed'] === true,
  };
}

/**
 * Keep it. `false` when the device refused — a full or blocked store — so the
 * screen can say the choice will not survive a reload rather than pretend.
 */
export function writeRideReadings(
  storage: PreferenceStorage | undefined,
  choice: RideReadingsChoice,
): boolean {
  if (storage === undefined) return false;
  try {
    storage.setItem(RIDE_READINGS_STORAGE_KEY, JSON.stringify(choice));
    return true;
  } catch {
    return false;
  }
}

/** The chosen channels, highest rank first. */
export function chosenReadings(choice: RideReadingsChoice): readonly RideMetricId[] {
  return choice.order.filter((id) => !choice.hidden.includes(id));
}

/**
 * The readings the Ride screen draws, in the rider's order: every chosen one,
 * or — zoomed — the top {@link ZOOMED_READING_COUNT} of them.
 */
export function shownReadings(
  metrics: readonly RideMetric[],
  choice: RideReadingsChoice,
): readonly RideMetric[] {
  const ids = chosenReadings(choice);
  const kept = choice.zoomed ? ids.slice(0, ZOOMED_READING_COUNT) : ids;
  return kept.flatMap((id) => metrics.filter((metric) => metric.id === id));
}

/** One place up (`-1`) or down (`1`) the ranking; unchanged at either end. */
export function moveReading(
  choice: RideReadingsChoice,
  id: RideMetricId,
  by: -1 | 1,
): RideReadingsChoice {
  const from = choice.order.indexOf(id);
  const to = from + by;
  if (from < 0 || to < 0 || to >= choice.order.length) return choice;
  const order = [...choice.order];
  order[from] = order[to] as RideMetricId;
  order[to] = id;
  return { ...choice, order };
}

/** Shown or not. Turning off the last one shown changes nothing. */
export function showReading(
  choice: RideReadingsChoice,
  id: RideMetricId,
  shown: boolean,
): RideReadingsChoice {
  const hidden = shown
    ? choice.hidden.filter((each) => each !== id)
    : [...new Set([...choice.hidden, id])];
  if (hidden.length >= choice.order.length) return choice;
  return { ...choice, hidden };
}
