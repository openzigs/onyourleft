// SPDX-License-Identifier: Apache-2.0

/**
 * The rider's own list of words that are always masked before anything is
 * sent to a hosted model — [#839](https://github.com/openzigs/onyourleft/issues/839).
 *
 * A street, a town, a family member's name: the things no pattern can find,
 * because nothing about "Acacia Avenue" or "Priya" looks like an address or a
 * name to a regular expression. `hosted-mask.ts` beside this file is where
 * they are matched. This file was `packages/store/src/masked-words.ts` until
 * #1094 moved it here, so the mask needs nothing from the store; the store
 * imports it from this package and still re-exports it.
 *
 * ## On the athlete row
 *
 * For ADR 0020 D-2's reason (`packages/store`'s `unit-system.ts`, `kit-colour.ts`): it is the
 * rider's, not the machine's, so it is on the athlete row. An erase takes it
 * with the row (`deleteAthlete`). The device copy is canonical.
 *
 * ⚠️ **Since #1101 the instance holds a synced copy** (ADR 0046 D-10, the
 * owner's ruling reversing this file's old "device only" note): masking runs
 * on the instance, over every hosted request, so the list and the privacy
 * zones are one sync item of kind `masking` there
 * (`apps/instance/src/analysis/hosted.ts`), pushed and pulled only sealed
 * (ADR 0047 D-7), scoped and erased with the athlete, and carried in the
 * INSTANCE's account export. ⚠️ The DEVICE's account export
 * (`apps/web/src/transfer/export-everything.ts`) does not carry it yet, nor a
 * privacy zone: that, and the device pushing the item, come with the client's
 * half (#1102, #1195).
 *
 * ## What a stored list may hold
 *
 * {@link parseMaskedWords} is total and is applied on the way in and on the
 * way out, so a hand-edited row cannot take a rider's library away (the
 * `units` precedent): anything that is not a string is dropped, every entry
 * is trimmed and has its runs of white space folded to one space, an empty
 * one is dropped, a repeat (compared case-insensitively) is dropped, an entry
 * longer than {@link MAXIMUM_MASKED_WORD_LENGTH} is dropped, and the list
 * stops at {@link MAXIMUM_MASKED_WORDS}. ⚠️ **Dropping is the unsafe
 * direction for a privacy list**, which is why the screen that writes it
 * refuses those entries before they are written (`apps/web/src/athlete/masked-words.ts`)
 * — so a dropped entry can only come from a row nobody typed.
 */

/** The most entries a list may hold. A list is a handful of names, not a dictionary. */
export const MAXIMUM_MASKED_WORDS = 200;

/** The longest one entry may be, in UTF-16 code units. A street name with its town fits. */
export const MAXIMUM_MASKED_WORD_LENGTH = 80;

/** One entry as it is stored: trimmed, with its inner white space folded to single spaces. */
export function tidyMaskedWord(word: string): string {
  return word.trim().replace(/\s+/gu, ' ');
}

/**
 * The list a stored or typed value names — total; see the file comment for
 * what is dropped.
 */
export function parseMaskedWords(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  const words: string[] = [];
  for (const entry of value as readonly unknown[]) {
    if (words.length >= MAXIMUM_MASKED_WORDS) {
      break;
    }
    if (typeof entry !== 'string') {
      continue;
    }
    const word = tidyMaskedWord(entry);
    const key = word.toLocaleLowerCase('en');
    if (word === '' || word.length > MAXIMUM_MASKED_WORD_LENGTH || seen.has(key)) {
      continue;
    }
    seen.add(key);
    words.push(word);
  }
  return words;
}
