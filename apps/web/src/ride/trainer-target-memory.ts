// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The last ERG target each trainer acknowledged to this app, kept on the
 * device with when it was acknowledged** — #1305.
 *
 * ## Why
 *
 * The ride controller already remembers this while the page lives
 * (`controller.ts` §`lastAcknowledgedTarget`): it is what turns a workout's
 * refusal of a large raise into a write of the trainer's minimum, when the
 * trainer may still hold a harder target this app wrote. A page reload, or the
 * app closed and opened, emptied that memory, so a first block far under the
 * minimum was refused and the trainer kept the hard target (#1308's row 28).
 * This keeps the same number across a reload, with its time.
 *
 * ## How old it may be
 *
 * {@link REMEMBERED_TARGET_MAX_AGE_SECONDS}: 30 minutes. ⚠️ **A pick, not a
 * measurement.** A reload or a restart of the app is seconds to minutes; a
 * trainer left long enough is likely to have gone to sleep or been switched
 * off, and then holds nothing. Too long, and the cost is the one the owner
 * already accepted for a lost link: the minimum is written onto a trainer
 * holding none. Too short, and a reload past it is refused as before.
 * A stored time that is in the future (a clock moved back) is not trusted.
 *
 * ## What a wrong or hostile entry can do
 *
 * The controller reads this only to turn a refusal into a write of the
 * machine's own reported minimum, which is what `main` wrote before #1305. So
 * no entry, junk or not, can put a target above that minimum on a trainer. A
 * stored value this build does not read is ignored, entry by entry.
 *
 * ## On the device
 *
 * `localStorage`, through the same `PreferenceStorage` double as the other
 * device-local settings (`game/hud/announce-preference.ts`). Keyed by the
 * transport's device id, which is the simulator's fixed id, a Web Bluetooth
 * id that the browser keeps per origin, and on Android the trainer's address.
 * At most {@link MOST_REMEMBERED} trainers, the newest kept.
 */

import type { UnixSeconds, Watts } from '@onyourleft/domain';
import type { DeviceId } from '@onyourleft/sensors';

import type { PreferenceStorage } from '../game/hud/announce-preference';

/**
 * How long a remembered target is trusted after it was acknowledged, in
 * seconds. A pick, not a measurement: see the module note.
 */
export const REMEMBERED_TARGET_MAX_AGE_SECONDS = 30 * 60;

/** Namespaced, because the origin is shared. The `v1` is the shape's. */
const STORAGE_KEY = 'oyl.trainerTargets.v1';

/** How many trainers are remembered. A rider has one or two; this is a bound, not a need. */
const MOST_REMEMBERED = 8;

interface Remembered {
  readonly watts: number;
  readonly at: number;
}

/** The last target each trainer acknowledged, across a page reload. */
export interface TrainerTargetMemory {
  /** A trainer acknowledged `target` at `at`. Never throws. */
  remember(id: DeviceId, target: Watts, at: UnixSeconds): void;
  /**
   * What this trainer last acknowledged, if that was at most
   * {@link REMEMBERED_TARGET_MAX_AGE_SECONDS} before `now`. Never throws.
   */
  recall(id: DeviceId, now: UnixSeconds): Watts | undefined;
}

function isRemembered(value: unknown): value is Remembered {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Record<string, unknown>;
  const { watts, at } = row;
  return (
    typeof watts === 'number' &&
    Number.isFinite(watts) &&
    watts >= 0 &&
    typeof at === 'number' &&
    Number.isFinite(at)
  );
}

/** What this device has stored, entry by entry. Never throws. */
function read(storage: PreferenceStorage | undefined): Map<string, Remembered> {
  const entries = new Map<string, Remembered>();
  let raw: unknown;
  try {
    const text = storage?.getItem(STORAGE_KEY) ?? null;
    raw = text === null ? undefined : (JSON.parse(text) as unknown);
  } catch {
    return entries;
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return entries;
  for (const [id, value] of Object.entries(raw)) {
    if (isRemembered(value)) entries.set(id, { watts: value.watts, at: value.at });
  }
  return entries;
}

/**
 * The memory over this device's storage. `undefined` storage (a blocked or
 * private store) remembers nothing across a reload, which is what the app did
 * before.
 */
export function createTrainerTargetMemory(
  storage: PreferenceStorage | undefined,
): TrainerTargetMemory {
  const entries = read(storage);
  return {
    remember(id, target, at): void {
      entries.delete(id);
      entries.set(id, { watts: target, at });
      while (entries.size > MOST_REMEMBERED) {
        const oldest = [...entries.entries()].reduce((left, right) =>
          right[1].at < left[1].at ? right : left,
        );
        entries.delete(oldest[0]);
      }
      try {
        storage?.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
      } catch {
        // A full or refusing store keeps this in the page only, as before #1305.
      }
    },
    recall(id, now): Watts | undefined {
      const entry = entries.get(id);
      if (entry === undefined) return undefined;
      const age = now - entry.at;
      return age >= 0 && age <= REMEMBERED_TARGET_MAX_AGE_SECONDS
        ? (entry.watts as Watts)
        : undefined;
    },
  };
}
