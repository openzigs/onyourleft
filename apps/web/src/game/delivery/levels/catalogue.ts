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
 * down when the file is drawn, and since #2970 how many of those houses get
 * no parcel, `targets.ts` §`noDeliveryCount` of them at the file's
 * `round.noDeliveryShare`. `levels.test.ts` reads every shipped file and
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
  /**
   * How many of {@link houses} must not get a parcel (#2365), so are not
   * among the houses the HUD counts as left — #2970: `targets.ts`
   * §`noDeliveryCount` of `round.houses` at `round.noDeliveryShare`. A level
   * places every house it asks for (ADR 0065 D-5.4), so this is the count
   * every ride of it has.
   */
  readonly noDelivery: number;
}

/**
 * A level's houses, in words, as the picker and the setup say them — #2970,
 * for the owner's approval: *"10 houses on the round: 7 to deliver to, 3 to
 * skip"*, so the 7 the HUD then counts as left is the round's own number. A
 * level with none to skip says *"4 houses on the round"*, as before.
 */
export function levelHousesText(level: Pick<LevelListing, 'houses' | 'noDelivery'>): string {
  const houses = `${String(level.houses)} ${level.houses === 1 ? 'house' : 'houses'} on the round`;
  if (level.noDelivery === 0) return houses;
  return `${houses}: ${String(level.houses - level.noDelivery)} to deliver to, ${String(level.noDelivery)} to skip`;
}

/**
 * The shipped levels, in unlock order — the names are proposed in #2362's
 * pull request (levels 1 and 2) and #2367's (levels 3 to 6) for the owner's
 * approval.
 */
export const LEVEL_CATALOGUE: readonly LevelListing[] = Object.freeze([
  Object.freeze({
    id: 'morning-round',
    name: 'Morning Round',
    lengthMetres: 2138,
    houses: 4,
    noDelivery: 0,
  }),
  Object.freeze({
    id: 'busy-round',
    name: 'Busy Round',
    lengthMetres: 2998,
    houses: 6,
    noDelivery: 0,
  }),
  Object.freeze({
    id: 'corner-round',
    name: 'Corner Round',
    lengthMetres: 2708,
    houses: 7,
    noDelivery: 0,
  }),
  Object.freeze({
    id: 'mailbox-round',
    name: 'Mailbox Round',
    lengthMetres: 3840,
    houses: 8,
    noDelivery: 2,
  }),
  Object.freeze({
    id: 'rainy-round',
    name: 'Rainy Round',
    lengthMetres: 3696,
    houses: 9,
    noDelivery: 2,
  }),
  Object.freeze({
    id: 'evening-round',
    name: 'Evening Round',
    lengthMetres: 2731,
    houses: 10,
    noDelivery: 3,
  }),
]);
