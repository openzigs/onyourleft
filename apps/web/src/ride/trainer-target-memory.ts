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
 * At most {@link MOST_REMEMBERED} trainers: the one written longest ago goes
 * first, by order of writing rather than by stamp, so a write is never the one
 * dropped even when the clock has moved back.
 *
 * ## Erase
 *
 * A device id is the trainer's address on Android, so *Erase everything*
 * takes the key ({@link TrainerTargetMemory.forget}, through
 * `transfer/erase-device.ts` §`eraseDevice`'s `trainerTargets`). It clears the
 * page's copy too: every `remember` rewrites the whole key, and a copy left in
 * the page would put the erased trainers back at the next acknowledgement.
 */

import type { UnixSeconds, Watts } from '@onyourleft/domain';
import type { DeviceId } from '@onyourleft/sensors';

import type { PreferenceStorage } from '../game/hud/announce-preference';

/** What this module asks of a `Storage`: a preference's two, and the erase's one. */
export type TrainerTargetStorage = PreferenceStorage & Pick<Storage, 'removeItem'>;

/**
 * How long a remembered target is trusted after it was acknowledged, in
 * seconds. A pick, not a measurement: see the module note.
 */
export const REMEMBERED_TARGET_MAX_AGE_SECONDS = 30 * 60;

/** Namespaced, because the origin is shared. The `v1` is the shape's. */
export const TRAINER_TARGETS_STORAGE_KEY = 'oyl.trainerTargets.v1';

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
  /** *Erase everything*: forget every trainer, here and on the device. Never throws. */
  forget(): void;
}

/**
 * The device's own storage, or `undefined` where reaching for it throws, as
 * `game/hud/announce-preference.ts` §`deviceStorage` does it.
 */
export function trainerTargetStorage(): TrainerTargetStorage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
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
    const text = storage?.getItem(TRAINER_TARGETS_STORAGE_KEY) ?? null;
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
  storage: TrainerTargetStorage | undefined,
): TrainerTargetMemory {
  const entries = read(storage);
  return {
    remember(id, target, at): void {
      entries.delete(id);
      entries.set(id, { watts: target, at });
      // By order of writing, not by `at`: the entry just written is last, so
      // it is never the one dropped, whatever the clock said (#1424's review).
      while (entries.size > MOST_REMEMBERED) {
        const oldest = entries.keys().next();
        if (oldest.done === true) break;
        entries.delete(oldest.value);
      }
      try {
        storage?.setItem(TRAINER_TARGETS_STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
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
    forget(): void {
      entries.clear();
      try {
        storage?.removeItem(TRAINER_TARGETS_STORAGE_KEY);
      } catch {
        // Storage refused: nothing more this device can do about it.
      }
    },
  };
}
