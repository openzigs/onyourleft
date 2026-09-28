// SPDX-License-Identifier: Apache-2.0

/**
 * The main colour of the rider's kit in the trainer game — #623's second half.
 *
 * ## A key, not a colour
 *
 * What is stored is the **name** of an entry in a fixed palette, never a hex
 * value. The palette's colours live in `apps/web/src/game/bicycle.ts`
 * §`KIT_PALETTE`, keyed by {@link KitColour} through a `Record`, so the
 * typechecker refuses a key here that has no colour there and a colour there
 * that has no key here. This package holds only the key set because it is the
 * one place both halves can reach: the store validates a row against it, and
 * the client — which may import this package, where this package may never
 * import the client (CLAUDE.md §3's boundary) — maps it to a colour.
 *
 * A colour could not be stored instead without losing the thing the palette
 * is for. #623 requires a FIXED, NAMED palette rather than a free picker: a
 * free colour would escape the renderer's brightness bound (`LIT_COLOURS`)
 * and #368's rule that the rider, the pacer and the ghost are told apart by
 * colour. A stored hex would have to be checked against the palette on every
 * read anyway, and a key makes an off-palette value unrepresentable once
 * decoded.
 *
 * ## Like the unit preference, stored here and read nowhere in `packages/`
 *
 * It is the athlete's own appearance, so it is on the athlete row (ADR 0020
 * D-2's precedent, recorded on #623 on 2026-09-27): it travels with the
 * account export and survives an erase-and-reimport, and a tablet and a phone
 * show the same kit. Nothing stored, computed, signed or exported changes when
 * it changes.
 *
 * ## An unrecognised value falls back rather than throwing
 *
 * For `unit-system.ts`' reason: a hand-edited row saying `"chartreuse"`
 * decides only what colour a jersey is, and refusing the whole athlete row
 * over it would take a rider's library away. {@link parseKitColour} answers
 * with the house colour and the row decodes. ⚠️ **The house colour and never
 * any other**, which is #623's criterion: an unrecognised value must not land
 * on whichever entry happens to be nearest or first-but-one.
 */

/**
 * | Key | Colour (`bicycle.ts` §`KIT_PALETTE`) |
 * |---|---|
 * | `house` | The On Your Left house kit, the app's accent. **The default.** |
 * | `green` | Green |
 * | `lime` | Lime |
 * | `purple` | Purple |
 * | `magenta` | Magenta |
 *
 * ⚠️ **No red, orange or blue**, and that is not taste: the pacer is orange
 * and the ghost a slate blue, and a rider in either hue is the rider #368
 * says must be told apart at a glance. `apps/web`'s palette test runs every
 * entry against both and fails one that is too close.
 */
export type KitColour = 'house' | 'green' | 'lime' | 'purple' | 'magenta';

/**
 * Every permitted value, the house colour FIRST — #623's criterion, and the
 * order the settings screen offers them in.
 */
export const KIT_COLOURS: readonly KitColour[] = ['house', 'green', 'lime', 'purple', 'magenta'];

/** What an athlete who has not chosen wears: the house kit. */
export const DEFAULT_KIT_COLOUR: KitColour = 'house';

/**
 * Whether `value` is one of the palette's keys.
 *
 * ⚠️ `includes` over the list, never `in` over an object: `'toString' in {}`
 * is true through the prototype, and a hand-edited row saying `"constructor"`
 * must not pass.
 */
export function isKitColour(value: unknown): value is KitColour {
  return typeof value === 'string' && (KIT_COLOURS as readonly string[]).includes(value);
}

/**
 * The kit colour a stored value names, or {@link DEFAULT_KIT_COLOUR}.
 *
 * Total, deliberately — see "An unrecognised value falls back" above.
 */
export function parseKitColour(value: unknown): KitColour {
  return isKitColour(value) ? value : DEFAULT_KIT_COLOUR;
}
