// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The one `masking` item an athlete holds (`hosted.ts` §"Where the guard
 * comes from"): its key, its body and how it is read. Its own module so that
 * `hosted-settings.ts`, which deletes the item when a consent or a key goes
 * (#1251), and the sync write path, which refuses an item this cannot read
 * (#1796), name it without importing `hosted.ts` and, through it, the model
 * SDK (`agent-safety.test.ts`).
 *
 * ## The device's limits and this one's are one set (#1796)
 *
 * The device builds the item from its own store (`@onyourleft/analysis`
 * §`readMaskingGuard`, `apps/web` §`hosted-settings.ts` §`sendMaskingGuard`),
 * and this reads it back, so each bound is the device's own:
 *
 * - **Words**: both sides apply `@onyourleft/analysis` §`parseMaskedWords` —
 *   at most `MAXIMUM_MASKED_WORDS`, each at most `MAXIMUM_MASKED_WORD_LENGTH`.
 *   The device sends what it parsed, so nothing it sends is dropped here.
 * - **Zones**: a centre `@onyourleft/domain` accepts, and a radius it accepts
 *   as a distance (`metres`: finite and not negative). Until #1796 a radius of
 *   0, which the device's store holds, was refused here, and with it the whole
 *   list: every hosted job then failed `hosted_unavailable`. A label is any
 *   text, as the store's is. There is no count: the request's body limit is
 *   the only one, on both sides.
 *
 * `masking-item.test.ts` holds both sides to it, and the sync write path
 * refuses an item {@link parseMaskingItem} cannot read, so a device is told at
 * once rather than every hosted job failing later.
 */

import {
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  type GeographicPosition,
} from '@onyourleft/domain';
import { parseMaskedWords, tidyMaskedWord, type MaskingGuard } from '@onyourleft/analysis';

export const MASKING_ITEM_KEY = 'guard';

/** The `masking` item's body, as the device writes it. */
export interface MaskingItemBody {
  /** The rider's words-to-mask list (`@onyourleft/analysis` §`parseMaskedWords`). */
  readonly words: readonly string[];
  /** Their privacy zones: a label, a centre in degrees and a radius in metres. */
  readonly zones: readonly {
    readonly label: string;
    readonly latitude: number;
    readonly longitude: number;
    readonly radius: number;
  }[];
}

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function position(latitude: unknown, longitude: unknown): GeographicPosition | undefined {
  if (typeof latitude !== 'number' || typeof longitude !== 'number') return undefined;
  try {
    return geographicPosition(degreesLatitude(latitude), degreesLongitude(longitude));
  } catch {
    return undefined;
  }
}

/**
 * A `masking` item's body as a guard, or `undefined` when ANY part of it is
 * not what {@link MaskingItemBody} says — a guard read in part would look
 * masked and not be, so a malformed item masks nothing and sends nothing.
 */
export function parseMaskingItem(text: string): MaskingGuard | undefined {
  let body: unknown;
  try {
    body = JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
  if (!isObject(body) || !Array.isArray(body.words) || !Array.isArray(body.zones)) {
    return undefined;
  }
  const keys = Object.keys(body);
  if (keys.some((key) => key !== 'words' && key !== 'zones')) return undefined;
  if (!body.words.every((word) => typeof word === 'string')) return undefined;
  const zones: MaskingGuard['zones'][number][] = [];
  for (const zone of body.zones as readonly unknown[]) {
    if (!isObject(zone) || typeof zone.label !== 'string') return undefined;
    const centre = position(zone.latitude, zone.longitude);
    const radius = zone.radius;
    // The store's own rule for a distance (`@onyourleft/domain` §`metres`), so
    // a zone the device holds is never what refuses the list (#1796).
    if (
      centre === undefined ||
      typeof radius !== 'number' ||
      !Number.isFinite(radius) ||
      radius < 0
    ) {
      return undefined;
    }
    zones.push({ centre, radius, label: zone.label });
  }
  const words = parseMaskedWords(body.words);
  // parseMaskedWords drops an over-long word and everything past the cap; for a
  // privacy list a dropped word is sent in the clear, so refuse the whole item
  // unless only blanks and case-insensitive repeats were dropped.
  const distinct = new Set(
    (body.words as readonly string[])
      .map((word) => tidyMaskedWord(word).toLocaleLowerCase('en'))
      .filter((word) => word !== ''),
  );
  if (words.length !== distinct.size) return undefined;
  return { words, zones };
}

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
