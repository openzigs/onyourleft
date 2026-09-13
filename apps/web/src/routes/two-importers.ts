// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What each of this app's two GPX importers makes — #232's third criterion.
 *
 * ## The confusion these sentences exist to end
 *
 * A `.gpx` means two different things in this product, and there are two
 * importers on two different screens with no relationship between them:
 *
 * | Screen | What it makes | Read by |
 * | --- | --- | --- |
 * | **Files** (`/transfer`) | an **activity** — a ride you already did | Activities, Analysis, Segments |
 * | **Routes** (`/routes`) | a **route** — a course to ride | Trainer game, route export |
 *
 * Observed on a device: a rider who wanted to ride a downloaded course in the
 * Trainer game went to **Files**, because "Files" is where you go to import a
 * file. It succeeded — as an activity. The Trainer game's picker stayed empty,
 * correctly, and nothing anywhere said why.
 *
 * ## Why the wording is here rather than in each view
 *
 * #232's third criterion is that the two purposes are stated *"where a rider
 * chooses, not only in the code"* — and there are three such places: the Files
 * screen, the Routes screen and the Trainer game's empty picker. Three
 * paraphrases of the same distinction, drifting apart one PR at a time, is how
 * a rider ends up reading two different explanations of one thing. One module,
 * asserted word for word by each screen's own test, is the cheaper shape.
 *
 * ⚠️ The strings are deliberately plain and name **no** other product. ADR 0009
 * R3 governs how another platform's mark may appear in this app, and the answer
 * for a sentence explaining our own two screens is that it does not need one.
 */

/**
 * Said on the **Files** screen, beside the file picker.
 *
 * It names the other screen rather than only warning, because a rider who has
 * just been told they are in the wrong place needs the right place in the same
 * sentence.
 */
export const FILES_IMPORT_MEANS =
  'A file you import here becomes a ride you already did. A course you plan to ride is a ' +
  'route, and the Trainer game rides routes — every GPX you choose here can be made into one ' +
  'below, without finding the file again.';

/** Said on the **Routes** screen, beside its own file picker. */
export const ROUTES_IMPORT_MEANS =
  'A file you import here becomes a course to ride — a route, which the Trainer game rides and ' +
  'which you can send to a head unit. A ride you have already done belongs on the Files screen ' +
  'instead, where it joins your activities.';

/**
 * Said by the **Trainer game** when the picker is empty.
 *
 * #232's second criterion asks that the empty picker say *how a route gets
 * there*, rather than only that there are none. The two ways are links in the
 * view; this is the sentence they hang from, including the one thing a rider
 * who has already tried is most likely to have done.
 */
export const NO_ROUTES_YET =
  'You have no saved routes yet. This screen rides routes, which are courses you plan to do — ' +
  'not the rides in your activities. A GPX imported on the Files screen becomes a ride and will ' +
  'not appear here; that screen offers to make a route from it too. There are two ways to get ' +
  'one:';
