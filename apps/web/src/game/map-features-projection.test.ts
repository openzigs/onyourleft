// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * `packages/map-features` restates the game's projection (#1544), because a
 * package may not import from `apps/`. This holds the two equal: a footprint
 * decoded there has to stand where `terrain.ts` puts the ground it belongs to.
 * A mirrored `x` (east instead of west) is #583's defect and fails here.
 */

import { degreesLatitude, degreesLongitude, geographicPosition } from '@onyourleft/domain';
import { decodeTile, localMetres } from '@onyourleft/map-features';
import {
  FIXTURE_EXTENT,
  FIXTURE_FRAME,
  FIXTURE_TILE,
  SIDEWALK_LINE,
  sidewalkTile,
} from '@onyourleft/map-features/testing';
import { describe, expect, it } from 'vitest';

import { localGroundPosition } from './terrain';

const CENTIMETRE = 0.01;

describe('the map-features projection is the game’s', () => {
  it('agrees with localGroundPosition over 100 points from 70° S to 70° N, to 1 cm', () => {
    let checked = 0;
    for (let i = 0; i < 10; i++) {
      const latitude = -70 + (140 * i) / 9;
      for (let j = 0; j < 10; j++) {
        const longitude = -179 + (358 * j) / 9;
        // The origin a few kilometres off the point, as a route's first point
        // is from the tiles along it.
        const origin = {
          latitude: latitude + 0.021 * (j - 4.5),
          longitude: longitude - 0.017 * (i - 4.5),
          elevation: 0,
        };
        const position = geographicPosition(degreesLatitude(latitude), degreesLongitude(longitude));
        const game = localGroundPosition(origin, position);
        const ours = localMetres(origin, longitude, latitude);
        expect(Math.abs(ours.x - game.x)).toBeLessThan(CENTIMETRE);
        expect(Math.abs(ours.z - game.z)).toBeLessThan(CENTIMETRE);
        // Not vacuous: the points are kilometres from their origins.
        expect(Math.hypot(game.x, game.z)).toBeGreaterThan(100);
        checked++;
      }
    }
    expect(checked).toBe(100);
  });

  it('a decoded vertex stands where localGroundPosition puts its longitude and latitude, to 1 cm', () => {
    const result = decodeTile(sidewalkTile(), FIXTURE_TILE, FIXTURE_FRAME);
    if ('reason' in result) throw new Error(result.reason);
    const line = result.paths[0]?.line;
    if (line === undefined) throw new Error('no sidewalk');
    const origin = { ...FIXTURE_FRAME, elevation: 0 };
    SIDEWALK_LINE.forEach(([px, py], k) => {
      const n = 2 ** 15;
      const longitude = ((FIXTURE_TILE.x + px / FIXTURE_EXTENT) / n) * 360 - 180;
      const latitude =
        (Math.atan(Math.sinh(Math.PI * (1 - (2 * (FIXTURE_TILE.y + py / FIXTURE_EXTENT)) / n))) *
          180) /
        Math.PI;
      const game = localGroundPosition(
        origin,
        geographicPosition(degreesLatitude(latitude), degreesLongitude(longitude)),
      );
      expect(Math.abs((line[k * 2] as number) - game.x)).toBeLessThan(CENTIMETRE);
      expect(Math.abs((line[k * 2 + 1] as number) - game.z)).toBeLessThan(CENTIMETRE);
    });
  });
});
