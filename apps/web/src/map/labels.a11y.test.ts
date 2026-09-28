// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The map's labels are readable against whatever the map puts behind them —
 * #578's contrast criterion, WCAG 2.2 AA for text (SC 1.4.3, 4.5 : 1).
 *
 * ## Why this reads the style rather than a list
 *
 * A label can land on the background, on any fill and on any line the style
 * draws. A hand-written list of "the colours a label sits on" is the thing
 * that goes stale the day somebody adds a `landuse` fill in a green the ink
 * disappears into, and every gate stays green about it. So the backgrounds are
 * **derived** from `basemapStyle`'s own layers, every non-symbol colour in it,
 * and a new layer is checked with no edit here.
 *
 * ## In both palettes (#672)
 *
 * Every check below runs over the light style AND the dark one, each derived
 * from `basemapStyle` in that palette. The declared pairs, with their recorded
 * margins, are `map-colours.a11y.test.ts`; this file is what stops a layer
 * that nobody declared a pair for slipping past.
 *
 * ## What it does not claim
 *
 * The ride's own line is drawn **over** the labels — it is the last layer —
 * so it is not a background and is not checked. The halo is not what this
 * rests on: it is a lift, and the ink clears AA against every colour on its
 * own. And the zoom: this is colour, and whether 12 px reads at a street's
 * zoom on a phone is the browser gate's picture and a person's eye, not this.
 */

import { describe, expect, it } from 'vitest';

import { AA_TEXT, contrastRatio } from '../design/contrast';
import { THEMES } from '../design/tokens';

import { basemapStyle, MAP_COLOURS, OSM_ATTRIBUTION, type BasemapStyle } from './basemap';

const CONFIG = {
  archiveUrl: 'https://tiles.example.org/basemap.pmtiles',
  attribution: OSM_ATTRIBUTION,
};

/** Every colour a non-label layer paints: what a label can be drawn over. */
function backgroundsOf(style: BasemapStyle): readonly string[] {
  const colours = new Set<string>();
  for (const layer of style.layers) {
    if (layer.type === 'symbol') {
      continue;
    }
    for (const key of ['background-color', 'fill-color', 'line-color']) {
      const value = layer.paint?.[key];
      if (typeof value === 'string') {
        colours.add(value);
      }
    }
  }
  return [...colours];
}

/** Every text colour a label layer paints with. */
function inksOf(style: BasemapStyle): readonly string[] {
  return style.layers
    .filter((layer) => layer.type === 'symbol')
    .map((layer) => layer.paint?.['text-color'])
    .filter((value): value is string => typeof value === 'string');
}

describe.each(THEMES)('the map’s labels against the map — #578, the %s style', (theme) => {
  const STYLE = basemapStyle(CONFIG, { theme });
  const { labelInk, labelHalo } = MAP_COLOURS[theme];

  it('has label layers and a background to check them against', () => {
    // Without this, a style whose labels had gone would pass everything below
    // by checking nothing.
    expect(inksOf(STYLE).length).toBeGreaterThan(0);
    expect(backgroundsOf(STYLE).length).toBeGreaterThanOrEqual(4);
  });

  it('paints every label in the one ink this test and the browser gate know', () => {
    expect(new Set(inksOf(STYLE))).toEqual(new Set([labelInk]));
    // And haloes every one in the halo the declared pair is about (#672).
    const haloes = STYLE.layers
      .filter((layer) => layer.type === 'symbol')
      .map((layer) => layer.paint?.['text-halo-color']);
    expect(haloes.length).toBeGreaterThan(0);
    expect(new Set(haloes)).toEqual(new Set([labelHalo]));
  });

  it.each(backgroundsOf(STYLE))('clears AA for text against %s', (background) => {
    for (const ink of inksOf(STYLE)) {
      const ratio = contrastRatio(ink, background);
      expect(ratio, `${ink} on ${background} is ${ratio.toFixed(2)} : 1`).toBeGreaterThanOrEqual(
        AA_TEXT,
      );
    }
  });

  it('haloes in a colour the ink also clears AA against', () => {
    // A halo the ink could not be read against would be a halo that makes the
    // label worse where it overlaps something dark.
    expect(contrastRatio(labelInk, labelHalo)).toBeGreaterThanOrEqual(AA_TEXT);
  });
});
