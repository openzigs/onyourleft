// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The numbers `game-harness.ts` draws the realistic surfaces' probes with and
 * `game.browser.spec.ts` reads them back by — #627, #629, #630, #679.
 *
 * A file of its own for `devices-fixture.ts`' reason: the spec runs in Node,
 * and importing a value from the harness would pull the whole client, three
 * included, into Playwright's transform.
 */

/** The Fresnel term #629's reference frame is drawn at. */
export const FRESNEL_REFERENCE = 0.2;

/** The constant Fresnel term #629's control frame is drawn at. */
export const FRESNEL_CONTROL = 0.5;

/** How many rows of lake each of #629's two bands is read over. */
export const WATER_BAND_ROWS = 10;
