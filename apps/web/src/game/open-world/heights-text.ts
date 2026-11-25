// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What the ride screen says of an open-world road's real heights — #2899.
 *
 * Words only, with no import: `GameView` reads them on every ride, and the
 * reader they are about (`heights.ts`) is loaded only when an open-world ride
 * opens.
 */

/**
 * The credit the game view's corner adds while an open-world road's heights
 * come from the terrain archive (ADR 0087 D-8, the owner's answer to Q3). The
 * sources are on the credits screen (#2013).
 */
export const TERRAIN_CORNER_CREDIT = 'Terrain © Mapterhorn';

/**
 * What the ride screen says where the heights are not known: no tile held
 * yet, outside the archive, map tiles turned off, or a tile that was refused
 * (ADR 0087 D-7). It names no place (ADR 0004 D).
 */
export const HEIGHTS_UNAVAILABLE_NOTICE = {
  label: 'Heights unavailable',
  text: 'The heights of the ground here could not be read, so the road is drawn level and your trainer is eased to flat until they can be.',
} as const;

/**
 * The game view's corner credit for a ride: OpenStreetMap's where the world
 * was drawn from the map, the terrain's where the road's heights are read
 * from the archive, both where both, and nothing where neither.
 */
export function cornerCredit(
  mapCredit: string | undefined,
  realHeights: boolean,
): string | undefined {
  if (!realHeights) return mapCredit;
  return mapCredit === undefined
    ? TERRAIN_CORNER_CREDIT
    : `${mapCredit} · ${TERRAIN_CORNER_CREDIT}`;
}
