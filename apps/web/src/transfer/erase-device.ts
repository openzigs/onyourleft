// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Erasing everything this device holds, and saying honestly what that does
 * and does not reach.**
 *
 * The other half of [#35](https://github.com/openzigs/onyourleft/issues/35) —
 * *"Implement account data export **and deletion**"* — in its local form.
 * `packages/store`'s `deleteAthlete` has existed since #26 and, until now,
 * **nothing in this client called it**: a rider could import their whole
 * history and had no way to remove themselves from the device again.
 *
 * ## The wording is the feature
 *
 * #35's revision block is unusually direct about this, and it is the
 * requirement this file exists to meet:
 *
 * > this issue must state **what deletion means on this instance** (complete
 * > and testable) and **what it can only request of others** (honest and
 * > visible to the user). A deletion dialogue that implies more than the
 * > architecture can deliver is the worst outcome.
 *
 * Here the answer is unusually good and should be said rather than assumed:
 * **there is nowhere else to ask.** Owner decision D6 means nothing has been
 * uploaded, so "delete my data" is complete rather than a request — which is a
 * stronger guarantee than a networked product can make, and the reason #57
 * rejected replication to peers we do not control. That changes the day
 * [#7](https://github.com/openzigs/onyourleft/issues/7) lands, and
 * {@link ERASE_CANNOT_REACH} is where the sentence will have to change with it.
 *
 * ## The consequence a rider will not expect
 *
 * ⚠️ **Erasing destroys the signing identity, permanently.**
 * [ADR 0014](../../../../docs/adr/0014-portable-identity.md) D-7: the private
 * key is non-extractable, so it cannot be backed up, and `putDeviceKey` refuses
 * to replace a key. After an erase this device signs as a **new** identity, and
 * the ADR is explicit that this is not a bug:
 *
 * > The recovery is to create a new identity. The athlete's history then has
 * > two eras, both valid and provably by different keys — which is honest.
 *
 * Records already exported still verify forever; they carry their own public
 * key. But nothing can ever again be signed as the identity being erased. A
 * dialogue that said "this removes your data" and not that would be exactly the
 * kind that implies less than it does.
 *
 * ## Why a typed phrase rather than a second button
 *
 * This is the one irreversible action in the product. A confirm button is one
 * mis-aimed tap from a two-year history; typing {@link ERASE_CONFIRMATION}
 * cannot be done by accident, and it is a plain word rather than a checkbox so
 * that a screen reader announces the requirement rather than a state.
 *
 * {@link eraseDecision} is a pure function so the rule is testable without a
 * DOM, the same shape `analysis/thresholds.ts` uses for its refusal.
 */

import type { AthleteId, AthleteRecord } from '@onyourleft/store';

/** What a rider types to confirm. Lower-cased and trimmed before comparison. */
export const ERASE_CONFIRMATION = 'erase everything';

/**
 * What erasing removes, in the rider's terms rather than the schema's.
 *
 * Derived from `deleteAthlete`'s own cascade and proved exhaustive by
 * `packages/store/src/activity-store.erasure.test.ts`, which enumerates the
 * tables from `SCHEMA_VERSIONS` rather than from a list like this one. This is
 * the readable summary; that test is the guarantee.
 */
export const ERASE_REMOVES: readonly string[] = [
  'every ride, with all of its per-second samples',
  'every recording this device is still holding, finished or not',
  'your privacy zones',
  'your saved routes and workouts',
  'your segments and every effort on them',
  'your thresholds',
  "this device's signing key",
  // ⚠️ Not a store row. `routing/draft-storage.ts` keeps a half-drawn route in
  // `localStorage`, and its waypoints are raw coordinates — usually starting
  // at the rider's front door. `deleteAthlete` cannot see it, so an erase that
  // only called the store would leave it behind while saying this device holds
  // nothing. It is listed here because it goes, and {@link eraseDevice} is
  // what makes that true.
  'a route you were part-way through drawing',
];

/**
 * What erasing cannot reach, stated before the rider presses anything.
 *
 * ⚠️ **Each line is a fact about the architecture, not a disclaimer.** If one
 * stops being true — the day there is an instance, or a second device — the
 * line changes in the same pull request that makes it false. A list that
 * quietly ages into a lie is worse than no list, because a rider read it and
 * decided.
 */
export const ERASE_CANNOT_REACH: readonly string[] = [
  'files you have already exported — they are yours, and they are wherever you put them',
  'a ride you have already shared with somebody, which is a copy they hold',
];

/** The reason an erase is refused, or `undefined` when it is not. */
export type EraseRefusal = 'not-confirmed' | 'nothing-to-erase' | 'failed';

/** Whether an erase may go ahead, and why not when it may not. */
export interface EraseDecision {
  readonly ready: boolean;
  readonly refusal: EraseRefusal | undefined;
}

/**
 * Whether the typed phrase confirms an erase.
 *
 * Trimmed and lower-cased, because a rider who typed `Erase Everything ` meant
 * it and a comparison that rejected them would be pedantry rather than safety.
 * Nothing else is accepted: a prefix, a suffix or an empty box is not
 * confirmation.
 */
export function eraseDecision(typed: string, holds: boolean): EraseDecision {
  if (!holds) {
    return { ready: false, refusal: 'nothing-to-erase' };
  }
  if (typed.trim().toLowerCase() !== ERASE_CONFIRMATION) {
    return { ready: false, refusal: 'not-confirmed' };
  }
  return { ready: true, refusal: undefined };
}

/** What to tell a rider whose erase was refused. One sentence each. */
export const ERASE_REFUSAL_TEXT: Readonly<Record<EraseRefusal, string>> = {
  'not-confirmed': `Type ${ERASE_CONFIRMATION} exactly, to confirm.`,
  'nothing-to-erase': 'There is nothing on this device to erase.',
  failed:
    'Nothing was erased — the device refused. Your data is still here, which is the safe way for ' +
    'this to fail.',
};

/** The store calls an erase makes. Narrowed so a test needs no ActivityStore. */
export interface EraseStore {
  deleteAthlete(id: AthleteId): Promise<{
    readonly activities: number;
    readonly routes: number;
    readonly workouts: number;
    readonly segments: number;
  }>;
  /**
   * Puts the athlete row back.
   *
   * ⚠️ **Not optional, and not tidiness.** `deleteAthlete` removes the row
   * every write path checks — `putActivity`, `putRecordingSession`,
   * `putPrivacyZone` and `putDeviceKey` all call `#requireAthlete` — and
   * `ensureLocalAthlete` runs **once, at start-up**. Without this the tab
   * survives the erase and every subsequent write throws
   * `StoreReferentialError`, which is #184 exactly: the recorder catches its
   * own write failure and carries on in memory, so a ride runs normally right
   * up to the moment the tab closes and takes the whole thing with it.
   *
   * The new row carries no history, so this is not a leak. It is the
   * difference between "erased" and "broken".
   */
  ensureAthlete(record: AthleteRecord): Promise<AthleteRecord>;
}

/** What an erase has to forget outside the store. @see routing/draft-storage */
export interface EraseSideStores {
  forget(): void;
}

/** What an erase removed, for the sentence afterwards. */
export interface EraseOutcome {
  readonly activities: number;
  readonly routes: number;
  readonly workouts: number;
  readonly segments: number;
}

/**
 * Erase this athlete, forget what lives outside the store, and put the row back.
 *
 * Thin on purpose where the store is concerned: the cascade, its transaction
 * and its exhaustiveness are `packages/store`'s, and duplicating any of that
 * here would be a second place for the table list to be wrong. What this adds
 * is the decision, the words, the two things `deleteAthlete` cannot reach, and
 * the row that has to exist afterwards.
 *
 * The order matters. The drafts are forgotten **after** the cascade, so a
 * failed delete does not lose a half-drawn route for nothing; the row is
 * recreated **last**, so it cannot be deleted by the cascade it precedes.
 */
export async function eraseDevice(
  store: EraseStore,
  athleteId: AthleteId,
  options: {
    readonly drafts?: EraseSideStores | undefined;
    readonly athlete?: AthleteRecord | undefined;
  } = {},
): Promise<EraseOutcome> {
  const counts = await store.deleteAthlete(athleteId);
  options.drafts?.forget();
  if (options.athlete !== undefined) {
    await store.ensureAthlete(options.athlete);
  }
  return {
    activities: counts.activities,
    routes: counts.routes,
    workouts: counts.workouts,
    segments: counts.segments,
  };
}

/** What was removed, in one sentence. Counts, never names. */
export function eraseSentence(outcome: EraseOutcome): string {
  const parts = [`${String(outcome.activities)} ride${outcome.activities === 1 ? '' : 's'}`];
  if (outcome.routes > 0) {
    parts.push(`${String(outcome.routes)} route${outcome.routes === 1 ? '' : 's'}`);
  }
  if (outcome.workouts > 0) {
    parts.push(`${String(outcome.workouts)} workout${outcome.workouts === 1 ? '' : 's'}`);
  }
  if (outcome.segments > 0) {
    parts.push(`${String(outcome.segments)} segment${outcome.segments === 1 ? '' : 's'}`);
  }
  // ⚠️ No ride name, no route name, no date. ADR 0004 decision D binds every
  // layer that formats location data into a string, and a route's name is
  // routinely a place. "Removed 4 rides" says what happened; "Removed Home to
  // work" would put it back on the screen after the athlete asked for it to be
  // gone, and possibly into a screenshot.
  return `Removed ${parts.join(', ')}. This device now holds nothing about you.`;
}
