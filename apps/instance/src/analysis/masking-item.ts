// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The key of the one `masking` item an athlete holds (`hosted.ts` §"Where the
 * guard comes from"). Its own module so that `hosted-settings.ts`, which
 * deletes the item when a consent or a key goes (#1251), names it without
 * importing `hosted.ts` and, through it, the model SDK (`agent-safety.test.ts`).
 */
export const MASKING_ITEM_KEY = 'guard';

/**
 * The refusal hook of `source.ts` §`SourceOptions.refusedForNoConsentOrKey`
 * (#1251): tombstone `athleteId`'s masking item, as a sync delete does.
 * One definition, so `instance.ts` and the test harness cannot differ.
 */
export function forgetMaskingOnRefusal(
  store: {
    deleteSyncItem(athleteId: string, kind: 'masking', key: string, now: number): Promise<boolean>;
  },
  now: () => number,
): (athleteId: string) => Promise<void> {
  return async (athleteId) => {
    await store.deleteSyncItem(athleteId, 'masking', MASKING_ITEM_KEY, Math.floor(now() / 1000));
  };
}
