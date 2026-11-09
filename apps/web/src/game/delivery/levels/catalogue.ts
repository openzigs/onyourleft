// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **What the Delivery picker lists of each built-in level, without reading
 * the level** — #2362, ADR 0065 D-2.5.
 *
 * A level file carries its corridor's building footprints, tens to hundreds
 * of kilobytes of them, so listing the levels by parsing every file would
 * load every level to show one line each. The picker reads this instead: a
 * level's id, its name, its length and the houses on its round, which are
 * the file's own `id`, `name`, `lengthMetres` and `round.houses`, written
 * down when the file is drawn. `levels.test.ts` reads every shipped file and
 * holds each entry here to it, field for field, and holds that every file
 * has an entry and every entry a file, so a redraw that changes a length is
 * a red test until this is changed too.
 *
 * ⚠️ **No coordinate and no place**: a name of our own (D-12), a length in
 * metres and a count. The levels' regions are recorded nowhere public
 * (D-13.2).
 */

/** One built-in level, as the picker lists it. */
export interface LevelListing {
  /** The file's name without `.json`, and the `level:` route id's second half. */
  readonly id: string;
  /** Our own name, never a place's (D-12). */
  readonly name: string;
  /** Along the ground, as the file states it. */
  readonly lengthMetres: number;
  /** The houses on the level's round (`round.houses`). */
  readonly houses: number;
}

/**
 * The shipped levels — the names are proposed in #2362's pull request for
 * the owner's approval.
 */
export const LEVEL_CATALOGUE: readonly LevelListing[] = Object.freeze([
  Object.freeze({ id: 'morning-round', name: 'Morning Round', lengthMetres: 2138, houses: 4 }),
  Object.freeze({ id: 'busy-round', name: 'Busy Round', lengthMetres: 2998, houses: 6 }),
]);
