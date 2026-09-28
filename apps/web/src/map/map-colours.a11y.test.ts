// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The map's colours, per palette, against each other and against the page
 * (#672 part b). `basemap.ts` §`MAP_COLOURS` says why the map has a table of
 * its own and is CHECKED against the palette rather than derived from it.
 */

import { describe, expect, it } from 'vitest';

import {
  AA_LARGE_TEXT_OR_NON_TEXT,
  AA_TEXT,
  contrastRatio,
  relativeLuminance,
} from '../design/contrast';
import {
  ELEVATION_DIRECTION,
  MAXIMUM_ELEVATION_STEP,
  paletteColours,
  THEMES,
} from '../design/tokens';

import {
  basemapStyle,
  MAP_COLOURS,
  MAP_CONTRAST_REQUIREMENTS,
  OSM_ATTRIBUTION,
  type MapColours,
} from './basemap';

const CONFIG = {
  archiveUrl: 'https://tiles.example.org/basemap.pmtiles',
  attribution: OSM_ATTRIBUTION,
};

describe.each(THEMES)('the %s map’s declared pairs', (theme) => {
  const colours = MAP_COLOURS[theme];

  for (const requirement of MAP_CONTRAST_REQUIREMENTS) {
    it(`${requirement.foreground} on ${requirement.background} still measures ${String(
      requirement.measured[theme],
    )} — ${requirement.where}`, () => {
      const recorded = requirement.measured[theme];
      const ratio = Number(
        contrastRatio(colours[requirement.foreground], colours[requirement.background]).toFixed(2),
      );
      // Both directions, `contrast.a11y.test.ts`' erosion gate: below is margin
      // spent silently, above is an improvement nobody wrote down.
      expect(ratio, `${theme}: measures ${String(ratio)}, recorded ${String(recorded)}`).toBe(
        recorded,
      );
      expect(recorded).toBeGreaterThanOrEqual(requirement.minimum);
    });
  }

  it('pairs the label ink with its halo, and the line with the land', () => {
    // The two pairs #672 names and SC 1.4.11 needs. Without this a list with
    // them deleted would pass everything above by checking less.
    const pairs = MAP_CONTRAST_REQUIREMENTS.map(
      (requirement) => `${requirement.foreground}/${requirement.background}`,
    );
    expect(pairs).toContain('labelInk/labelHalo');
    expect(pairs).toContain('track/earth');
    expect(pairs).toContain('track/background');
  });

  it('names a real threshold for each pair', () => {
    for (const requirement of MAP_CONTRAST_REQUIREMENTS) {
      expect([AA_TEXT, AA_LARGE_TEXT_OR_NON_TEXT]).toContain(requirement.minimum);
    }
  });

  it('holds every label pair to the text threshold', () => {
    for (const requirement of MAP_CONTRAST_REQUIREMENTS) {
      if (requirement.foreground === 'labelInk') {
        expect(requirement.minimum, requirement.where).toBe(AA_TEXT);
      }
    }
  });
});

describe.each(THEMES)('the %s map sits on its page', (theme) => {
  const canvas = paletteColours(theme).canvas;
  const surfaces: readonly (keyof MapColours)[] = ['background', 'earth'];

  it.each(surfaces)(
    'its %s is within one elevation step of the page’s canvas, on the palette’s side',
    (surface) => {
      const colour = MAP_COLOURS[theme][surface];
      const step = contrastRatio(colour, canvas);
      expect(step, `${colour} is ${step.toFixed(2)} : 1 from ${canvas}`).toBeLessThanOrEqual(
        MAXIMUM_ELEVATION_STEP,
      );
      // Darker than the page in light, lighter in dark: a surface ON the page,
      // the way `ELEVATION_DIRECTION` has every raised surface.
      const lighter = relativeLuminance(colour) > relativeLuminance(canvas);
      expect(lighter ? 'lighter' : 'darker').toBe(ELEVATION_DIRECTION[theme]);
    },
  );

  it('is the style the map is built in', () => {
    // The table is read by the style, not only by this test: the background
    // layer paints this palette's colour, with tiles on and with them off.
    for (const tiles of [true, false]) {
      const style = basemapStyle(CONFIG, { tiles, theme });
      const background = style.layers.find((layer) => layer.type === 'background');
      expect(background?.paint?.['background-color']).toBe(MAP_COLOURS[theme].background);
    }
  });
});

describe('the dark map', () => {
  it('uses no pure black or white — DARK_COLOUR_TOKENS’ rule', () => {
    const dark = MAP_COLOURS.dark;
    for (const colour of (Object.keys(dark) as (keyof MapColours)[]).map((key) => dark[key])) {
      expect(['#000000', '#ffffff']).not.toContain(colour.toLowerCase());
    }
  });

  it('declares exactly the light table’s colours', () => {
    expect(Object.keys(MAP_COLOURS.dark).sort()).toEqual(Object.keys(MAP_COLOURS.light).sort());
  });
});
