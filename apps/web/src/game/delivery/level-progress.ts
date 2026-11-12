// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Which built-in Delivery levels this device has finished, and so which
 * are open** — #2363, ADR 0065 D-9.
 *
 * ## In order
 *
 * The first level is open. Each later level opens once the level before it
 * is finished (D-9.1), in the unlock order `levels.ts` §`levelLibrary` lists
 * them. A level is **finished** when its round reaches its own end: every
 * house on it settled, delivered or missed (`ride-round.ts`
 * §`keepLevelFinished`). A ride ended before that finishes nothing. A round
 * ridden with the assisted setting on counts (the owner's answer to Q2,
 * DL10's "no fail"), because the assist changes nothing about reaching the
 * round's end.
 *
 * ## Level ids only, on the device (D-9.2)
 *
 * `localStorage`, wrapped, on `delivery-progress.ts`' pattern: a namespaced
 * key, a version inside the value, and a writer that builds the stored value
 * from {@link LEVEL_PROGRESS_FIELDS} rather than serialising what it is
 * handed, so an object carrying anything more (a seed, a house) still stores
 * only the finished levels' ids. **No house, no index into a level's
 * buildings, no position and no seed.** It is never in the ride record,
 * never synced and never exported (ADR 0059 D-4): nothing that builds an
 * export or an instance's traffic imports Delivery
 * (`privacy/delivery-targets-never-sent.test.ts`).
 *
 * A stored value this build cannot read — unparseable, another version, a
 * field out of shape, or a store that refuses to be read — reads as nothing
 * finished, so level 1 alone is open, and never throws (D-9.2).
 *
 * ## Apart from the week (D-9.3)
 *
 * A level round neither reads nor writes `delivery-progress.ts`; the week's
 * round never writes here.
 */

import type { PreferenceStorage } from '../hud/announce-preference';

/** Namespaced, because the origin is shared. */
export const LEVEL_PROGRESS_STORAGE_KEY = 'oyl.game.delivery.levels.v1';

/** The stored value's shape. A value carrying another is read as nothing finished. */
export const LEVEL_PROGRESS_VERSION = 1;

/** Every field the stored value holds. A test holds the stored keys to exactly these. */
export const LEVEL_PROGRESS_FIELDS = ['version', 'finished'] as const;

/**
 * A level's id as a level file states it: `level-file.ts` §`LEVEL_ID_PATTERN`,
 * restated so the Games chunk need not load the level reader to list the
 * levels. `level-progress.test.ts` holds the two equal.
 */
export const KEPT_LEVEL_ID_PATTERN = /^[a-z][a-z0-9-]{1,31}$/;

/** More finished levels than the app could ship: a stored list longer than this is not ours. */
export const MOST_LEVELS_KEPT = 64;

/** What this device has kept: the ids of the levels it has finished, in the order they were. */
export interface LevelProgress {
  readonly finished: readonly string[];
}

/** Nothing finished: level 1 alone is open. */
export const NO_LEVEL_FINISHED: LevelProgress = Object.freeze({ finished: Object.freeze([]) });

/** The finished levels this device has kept, or none. Never throws. */
export function readLevelProgress(storage: PreferenceStorage | undefined): LevelProgress {
  let raw: unknown;
  try {
    const text = storage?.getItem(LEVEL_PROGRESS_STORAGE_KEY) ?? null;
    if (text === null) return NO_LEVEL_FINISHED;
    raw = JSON.parse(text) as unknown;
  } catch {
    return NO_LEVEL_FINISHED;
  }
  if (typeof raw !== 'object' || raw === null) return NO_LEVEL_FINISHED;
  const row = raw as Record<string, unknown>;
  if (row['version'] !== LEVEL_PROGRESS_VERSION) return NO_LEVEL_FINISHED;
  const finished = row['finished'];
  if (
    !Array.isArray(finished) ||
    finished.length > MOST_LEVELS_KEPT ||
    !finished.every((id) => typeof id === 'string' && KEPT_LEVEL_ID_PATTERN.test(id))
  ) {
    return NO_LEVEL_FINISHED;
  }
  return { finished: [...new Set(finished as string[])] };
}

/**
 * Keep it. `false` when the device refused — a full or blocked store — or
 * when there is none, so a caller can tell the unlock will not survive a
 * reload.
 */
export function writeLevelProgress(
  storage: PreferenceStorage | undefined,
  progress: LevelProgress,
): boolean {
  if (storage === undefined) return false;
  const kept: Record<(typeof LEVEL_PROGRESS_FIELDS)[number], unknown> = {
    version: LEVEL_PROGRESS_VERSION,
    finished: [...new Set(progress.finished)]
      .filter((id) => KEPT_LEVEL_ID_PATTERN.test(id))
      .slice(0, MOST_LEVELS_KEPT),
  };
  try {
    storage.setItem(LEVEL_PROGRESS_STORAGE_KEY, JSON.stringify(kept));
    return true;
  } catch {
    return false;
  }
}

/** `progress` with `id` finished as well. */
export function withLevelFinished(progress: LevelProgress, id: string): LevelProgress {
  return progress.finished.includes(id) ? progress : { finished: [...progress.finished, id] };
}

/**
 * Where a level stands for this rider: `open` to ride, `finished` (and still
 * open, to ride again), or `locked` until `after`, the level before it, is
 * finished.
 */
export type LevelStanding =
  | { readonly state: 'open' }
  | { readonly state: 'finished' }
  | { readonly state: 'locked'; readonly after: string };

/**
 * Where the level `id` stands, among `order` (every level's id, in unlock
 * order). A level not in `order` is no step of the progression, and is open.
 */
export function levelStanding(
  order: readonly string[],
  progress: LevelProgress,
  id: string,
): LevelStanding {
  if (progress.finished.includes(id)) return { state: 'finished' };
  const at = order.indexOf(id);
  const before = at > 0 ? order[at - 1] : undefined;
  if (before === undefined || progress.finished.includes(before)) return { state: 'open' };
  return { state: 'locked', after: before };
}
