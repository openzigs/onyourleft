// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The Delivery week's progress, kept on the device between rides — #1806,
 * resting on the owner's ruling DL11 of 2026-10-27 (epic #1803).
 *
 * @unwired Nothing runs a Delivery round yet. #1816 gives this module its
 * production caller when it runs a round inside a game ride and keeps the
 * week between rides; until then only its tests reach it.
 *
 * ## Counts only
 *
 * DL11: what survives a ride is the day of the week, how many houses are on
 * the round, and the week's score — {@link DELIVERY_PROGRESS_FIELDS}, and
 * nothing else. Never which house, an index into the town, or the seed that
 * picked them (#1808), because any of those could point a stored record at a
 * real address (CLAUDE.md §6, location data). The writer builds the stored
 * value field by field rather than serialising what it is handed, so an
 * object carrying anything more still stores only the counts.
 *
 * ## On the device, like the other game preferences
 *
 * `localStorage`, wrapped, on `world-preference.ts`'s pattern and with
 * `hud/announce-preference.ts`'s storage port. Nothing here goes into the
 * ride record. A stored value this build cannot read — unparseable, the wrong
 * shape, or a count out of range — reads as a fresh week as a whole, rather
 * than a week stitched together from the fields that happened to parse.
 */

import type { PreferenceStorage } from '../hud/announce-preference';

import { DAYS_IN_WEEK, FRESH_WEEK, MOST_HOUSES, MOST_WEEK_SCORE, type WeekProgress } from './round';

/** Namespaced, because the origin is shared. The `v1` is the shape's. */
export const DELIVERY_PROGRESS_STORAGE_KEY = 'oyl.game.delivery.week.v1';

/** Every field the stored value holds. A test holds the stored keys to exactly these. */
export const DELIVERY_PROGRESS_FIELDS = [
  'day',
  'houses',
  'score',
] as const satisfies readonly (keyof WeekProgress)[];

/** A whole number from `least` to `most`, or `undefined`. */
function countIn(value: unknown, least: number, most: number): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= least && value <= most
    ? value
    : undefined;
}

/** The week this device has kept, or a fresh week. Never throws. */
export function readDeliveryProgress(storage: PreferenceStorage | undefined): WeekProgress {
  let raw: unknown;
  try {
    const text = storage?.getItem(DELIVERY_PROGRESS_STORAGE_KEY) ?? null;
    if (text === null) return FRESH_WEEK;
    raw = JSON.parse(text) as unknown;
  } catch {
    return FRESH_WEEK;
  }
  if (typeof raw !== 'object' || raw === null) return FRESH_WEEK;
  const row = raw as Record<string, unknown>;
  const day = countIn(row['day'], 1, DAYS_IN_WEEK);
  const houses = countIn(row['houses'], 1, MOST_HOUSES);
  const score = countIn(row['score'], 0, MOST_WEEK_SCORE);
  if (day === undefined || houses === undefined || score === undefined) return FRESH_WEEK;
  return { day, houses, score };
}

/**
 * Keep it. `false` when the device refused — a full or blocked store — so a
 * caller can say the week will not survive a reload rather than pretend.
 */
export function writeDeliveryProgress(
  storage: PreferenceStorage | undefined,
  progress: WeekProgress,
): boolean {
  if (storage === undefined) return false;
  const kept: Record<(typeof DELIVERY_PROGRESS_FIELDS)[number], number> = {
    day: progress.day,
    houses: progress.houses,
    score: progress.score,
  };
  try {
    storage.setItem(DELIVERY_PROGRESS_STORAGE_KEY, JSON.stringify(kept));
    return true;
  } catch {
    return false;
  }
}
