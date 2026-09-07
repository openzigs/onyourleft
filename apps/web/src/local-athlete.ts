// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The one athlete this device has, and the row that has to exist before
 * anything can be written for them (#184).
 *
 * ## Why there is a row at all
 *
 * Every write path in `@onyourleft/store` that carries an owner calls
 * `#requireAthlete` and throws `StoreReferentialError` when there is none —
 * `putActivity`, `putRecordingSession`, `putPrivacyZone` and `putDeviceKey`.
 * That check is right: it is what stops an orphaned ride, and #26's review
 * asked for it.
 *
 * `main.tsx` named {@link LOCAL_ATHLETE} and handed it to every port, and
 * nothing ever created the row. So on a browser that had never been seeded by
 * hand, **every import failed and every recording checkpoint failed** — the
 * recorder catches its own write failure and carries on in memory, so a ride
 * ran normally right up to the moment the tab closed and took the whole thing
 * with it. The README's "at most eight seconds can be lost" was void, and
 * nothing said so.
 *
 * It survived because of where the seam is: the store's tests seed athletes
 * through the #28 fixtures, the views' tests use stub ports with no referential
 * integrity, and `main.tsx` — the one place a store, an athlete id and a write
 * path meet — had no test. {@link ensureLocalAthlete} is that seam made
 * testable.
 *
 * ## Why `ensureAthlete` and not `putAthlete`
 *
 * ⚠️ `putAthlete` is a `put`. Calling it at start-up to make sure the row
 * exists would rewrite it on **every page load**, discarding the display name,
 * the creation instant and — since #78 — the thresholds every zone boundary is
 * derived from. `ActivityStore.ensureAthlete` inserts only when the row is
 * absent, in one transaction, and returns whatever is on disk afterwards.
 */

import type { UnixSeconds } from '@onyourleft/domain';
import { athleteId, type AthleteId, type AthleteRecord } from '@onyourleft/store';

/**
 * The one athlete this device has, until accounts exist.
 *
 * There is no server and no sign-in in Phase 1 (owner decision D6), so every
 * ride belongs to a fixed local identity. It is a **constant rather than a
 * generated id** deliberately: a per-install random id would be written into
 * every activity row, and a cleared browser profile would then orphan every
 * ride already on disk from the athlete who recorded them.
 * [#33](https://github.com/openzigs/onyourleft/issues/33) introduces real
 * athletes; the store's queries are already scoped by this key, which is what
 * makes that a migration rather than a rewrite.
 */
export const LOCAL_ATHLETE: AthleteId = athleteId('local');

/**
 * What the row is called before anyone has been asked.
 *
 * Written **once**, when the row is created, and never rewritten — see the
 * `putAthlete` warning above. A rider who renames themselves in a later
 * milestone keeps that name across every reload, because nothing here writes
 * over it.
 */
export const LOCAL_ATHLETE_DISPLAY_NAME = 'You';

/** The single method {@link ensureLocalAthlete} needs. @see AnalysisStore */
export interface LocalAthleteStore {
  ensureAthlete(record: AthleteRecord): Promise<AthleteRecord>;
}

/**
 * Make sure this device's athlete row exists, and answer with it.
 *
 * Idempotent: safe on every reload, and safe when two tabs race, because the
 * store does the read and the write in one transaction.
 *
 * `now` is a parameter rather than a `Date.now()` inside, for the reason
 * `packages/domain` gives for its recording engine: a clock read inside a
 * function is a fact a test cannot fix. It is only used for a row that does not
 * exist yet, so an existing athlete's `createdAt` is unaffected by whatever is
 * passed.
 */
export async function ensureLocalAthlete(
  store: LocalAthleteStore,
  now: UnixSeconds,
): Promise<AthleteRecord> {
  return store.ensureAthlete({
    id: LOCAL_ATHLETE,
    displayName: LOCAL_ATHLETE_DISPLAY_NAME,
    createdAt: now,
  });
}

/**
 * Run `ensure`, then `render` — and render even if `ensure` fails.
 *
 * The ordering is the whole point and is why this is a function rather than
 * three lines in `main.tsx`: **no control a rider can reach may exist before
 * the row every write path requires does.** A ride started in the window
 * between would fail its first checkpoint referentially, and `recorder.ts`
 * catches that and carries on in memory — the quiet failure this file exists to
 * stop. `main.tsx` has no test of its own, which is exactly how #184 survived,
 * so the ordering lives here where one can be written.
 *
 * ⚠️ **A failure still renders.** The store is unreachable in a private window,
 * with site data blocked, and on a page opened straight off the disk, and in
 * every one of those the rest of this client is worth having: the views that
 * need a store say so in words, which is what #48's first criterion asks for.
 * Swallowing the failure here rather than in each view is what stops a blocked
 * database producing a blank page instead of an explanation.
 */
export async function renderAfterAthlete(
  ensure: () => Promise<unknown>,
  render: () => void,
): Promise<void> {
  try {
    await ensure();
  } catch {
    // Deliberately silent, and deliberately not fatal. See above.
  }
  render();
}
