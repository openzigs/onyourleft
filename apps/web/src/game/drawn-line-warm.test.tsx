// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The drawn path is built while the rider chooses, not in the ride's first
 * frame — #2422's review. `drawn-line.ts` §`drawnLine` costs about 0.2 s on a
 * 100 km route on a laptop, and it was paid inside the first `sceneFrame`: a
 * stall at the start of a long imported ride. The real `GameView`'s chooser
 * builds the chosen route's path a moment after the choice settles
 * (`GameView.tsx` §`DRAWN_LINE_WARM_DELAY_MS`), and only that route's.
 */

import { afterEach, describe, expect, it } from 'vitest';

import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  routeProfile,
  watts,
  type RoutePoint,
} from '@onyourleft/domain';

import { mount, settle, type Mounted } from '../testing/mount';

import { drawnLineBuilt } from './drawn-line';
import { DRAWN_LINE_WARM_DELAY_MS, GameView, type GamePort, type RidableRoute } from './GameView';

function ridableRoute(id: string, name: string): RidableRoute {
  const points: RoutePoint[] = [];
  for (let index = 0; index <= 40; index += 1) {
    points.push({
      position: geographicPosition(
        degreesLatitude(51.5 + (index * 10) / 111_320),
        degreesLongitude(-0.12 + (index > 20 ? ((index - 20) * 10) / 69_000 : 0)),
      ),
      elevation: altitudeMetres(index * 0.3),
    });
  }
  return { id, name, profile: routeProfile(points), attempts: 0 };
}

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

describe('the drawn path is built while the rider chooses — #2422’s review', () => {
  it('builds the chosen route’s path a moment after the chooser shows it, and no other route’s', async () => {
    const chosen = ridableRoute('a', 'Quarry climb');
    const other = ridableRoute('b', 'Reservoir road');
    const port: GamePort = {
      listRoutes: () => Promise.resolve([chosen, other]),
      loadGhost: () => Promise.resolve(undefined),
      readSensors: () => ({
        rider: { power: watts(0), live: false, paired: false },
        cadence: { value: undefined, live: false, paired: false },
        heartRate: { value: undefined, live: false, paired: false },
      }),
    };
    mounted = await mount(<GameView port={port} />);
    await settle();
    // Not at once: a rider stepping through the picker builds nothing.
    expect(drawnLineBuilt(chosen.profile)).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, DRAWN_LINE_WARM_DELAY_MS + 100));
    expect(drawnLineBuilt(chosen.profile)).toBe(true);
    expect(drawnLineBuilt(other.profile)).toBe(false);
  });
});
