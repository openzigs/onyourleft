// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What the demo page says while the realistic world's files arrive — #1654,
 * the owner's ruling of 2026-10-24 on #1643: the whole set loads from the
 * start, with a loading indicator. `DemoPage.tsx` shows it while the stage's
 * snapshot says `realisticLoading`.
 *
 * A module of its own, with no imports, so the demo's browser gate
 * (`demo-world.browser.spec.ts`) can read the sentence it asserts is gone
 * without loading the page's component and its assets in Node.
 */
export const REALISTIC_LOADING = 'Loading the realistic world…';
