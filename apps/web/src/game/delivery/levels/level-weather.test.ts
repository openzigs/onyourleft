// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The rider's choice of a level's weather and light — #2578. The mapping from
 * a choice to the pair a round rides in; that the setup offers it and the ride
 * draws it is `levels-wiring.test.tsx`'s.
 */

import { describe, expect, it } from 'vitest';

import { LEVEL_LIGHTS, LEVEL_WEATHERS } from './level-file';
import { chosenSky, LEVEL_WEATHER_CHOICES, type LevelSky } from './level-weather';

/** Every pair a level file may state. */
const OWN_SKIES: readonly LevelSky[] = LEVEL_WEATHERS.flatMap((weather) =>
  LEVEL_LIGHTS.map((light) => ({ weather, light })),
);

describe('the weather a level’s round rides in — #2578', () => {
  it('offers the level’s own first, then clear, rain and dusk', () => {
    expect(LEVEL_WEATHER_CHOICES).toStrictEqual(['level', 'clear', 'rain', 'dusk']);
  });

  it('rides the level’s own pair unless another is chosen, whatever the level states', () => {
    expect(OWN_SKIES).toHaveLength(4);
    for (const own of OWN_SKIES) {
      expect(chosenSky('level', own)).toStrictEqual(own);
      expect(chosenSky('clear', own)).toStrictEqual({ weather: 'clear', light: 'day' });
      expect(chosenSky('rain', own)).toStrictEqual({ weather: 'rain', light: 'day' });
      expect(chosenSky('dusk', own)).toStrictEqual({ weather: 'clear', light: 'dusk' });
    }
  });

  it('gives only pairs a level file may state', () => {
    for (const choice of LEVEL_WEATHER_CHOICES) {
      for (const own of OWN_SKIES) {
        const sky = chosenSky(choice, own);
        expect(LEVEL_WEATHERS).toContain(sky.weather);
        expect(LEVEL_LIGHTS).toContain(sky.light);
      }
    }
  });
});
