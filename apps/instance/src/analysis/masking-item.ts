// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The key of the one `masking` item an athlete holds (`hosted.ts` §"Where the
 * guard comes from"). Its own module so that `hosted-settings.ts`, which
 * deletes the item when a consent or a key goes (#1251), names it without
 * importing `hosted.ts` and, through it, the model SDK (`agent-safety.test.ts`).
 */
export const MASKING_ITEM_KEY = 'guard';
