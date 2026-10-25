// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #1626's placement: the winter lights from the product's own table
 * (`decorations.ts` §`HOLIDAY_DECORATIONS`) — bulbs wound on the lamp posts
 * and strung under the eaves, and a wreath on a village door — on the anchors
 * the real `streetsAt` builds. Every plot is enumerated from `settlements.ts`
 * §`everyVillagePlot`; every bulb's position is turned into the corridor's
 * frame as the belt turns it (`three-renderer.ts` §`decorationGeometry`).
 */

import { distanceOnRoute, type RouteProfile } from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import {
  BULB_METRES,
  decorationsFor,
  HOLIDAY_DECORATIONS,
  type DecorationItem,
  type DecorationKind,
  type DecorationPart,
} from './decorations';
import { distanceToDrawnRoad } from './road-grid';
import { circuitRoute, northRoute, plannerCornerRoute } from './route-fixtures-testing';
import { scatterSeed } from './scatter';
import { everyVillagePlot, PLOT_METRES, siteAt, siteSpacing, type Plot } from './settlements';
import { KERB_LATERAL_METRES, PAVEMENT_WIDTH_METRES, streetsAt } from './streets';
import { corridorOrigin, drawnRoadFrame, ROAD_WIDTH_METRES } from './terrain';

const WINTER = HOLIDAY_DECORATIONS['winter-lights'] ?? [];

const FIXTURES: readonly (readonly [string, RouteProfile, number])[] = [
  [
    'a straight farmland road',
    northRoute(6_000, () => 40),
    scatterSeed(northRoute(6_000, () => 40)),
  ],
  ['a circuit', circuitRoute(1_000), scatterSeed(circuitRoute(1_000))],
  ['the corner two villages share', plannerCornerRoute(150), 2],
];

const kindOf = (item: DecorationItem): DecorationKind => {
  const kind = WINTER.find((each) => each.item === item.item);
  if (kind === undefined) throw new Error(`no winter kind ${item.item}`);
  return kind;
};

/** Where a part's middle stands, corridor frame, as the belt turns and stands it. */
function placed(item: DecorationItem, part: DecorationPart): { x: number; y: number; z: number } {
  const { x, z, yaw } = item.anchor;
  const [px, py, pz] = part.at;
  return {
    x: x + px * Math.cos(yaw) + pz * Math.sin(yaw),
    y: item.base + py,
    z: z - px * Math.sin(yaw) + pz * Math.cos(yaw),
  };
}

/** Every village plot of a fixture, the church's among them. */
function plotsOf(profile: RouteProfile, seed: number): readonly (Plot & { built: boolean })[] {
  const { sites } = siteSpacing(profile);
  const found: (Plot & { built: boolean })[] = [];
  for (let index = 0; index < sites; index += 1) {
    const site = siteAt(profile, seed, index);
    if (site?.kind === 'village') found.push(...everyVillagePlot(seed, site));
  }
  return found;
}

/** Whether a point is on a plot's own ground: its length, from behind the pavement out past its building. */
function onPlot(
  profile: RouteProfile,
  plot: Plot,
  at: { readonly x: number; readonly z: number },
): boolean {
  const frame = drawnRoadFrame(
    profile,
    corridorOrigin(profile),
    distanceOnRoute(profile, plot.along),
  );
  if (frame === undefined) return false;
  const dx = at.x - frame.x;
  const dz = at.z - frame.z;
  const along = dx * frame.normalZ - dz * frame.normalX;
  const across = (dx * frame.normalX + dz * frame.normalZ) * plot.side;
  return (
    Math.abs(along) <= PLOT_METRES / 2 &&
    across >= KERB_LATERAL_METRES + PAVEMENT_WIDTH_METRES &&
    across <= plot.lateral + PLOT_METRES
  );
}

describe('the winter lights — #1626', () => {
  const placedOn = FIXTURES.map(([name, profile, seed]) => {
    const streets = streetsAt(profile, corridorOrigin(profile), seed, 0, profile.totalDistance);
    return {
      name,
      profile,
      plots: plotsOf(profile, seed),
      streets,
      items: decorationsFor(streets, 'winter-lights', HOLIDAY_DECORATIONS),
    };
  });

  it('are lights on lamp posts and eaves and a wreath on doors: no symbol, and no red and white along a string', () => {
    // The whole table, for the reviewer: three kinds, none of them a symbol.
    expect(WINTER.map((kind) => kind.item)).toEqual(['post-lights', 'eave-lights', 'wreath']);
    for (const kind of WINTER) {
      const bulbs = kind.parts.filter((part) => part.shape === 'bulb');
      for (const bulb of bulbs) {
        // Every bulb glows, steady, and none is red: warm white or soft colours.
        expect(bulb.glows, kind.item).toBe(true);
        const [r, g] = [(bulb.colour >> 16) & 0xff, (bulb.colour >> 8) & 0xff];
        expect(g / r, `${kind.item} bulb ${bulb.colour.toString(16)}`).toBeGreaterThan(0.6);
      }
      // A wreath is lit, not lit up.
      if (kind.item === 'wreath') expect(kind.parts.every((part) => !part.glows)).toBe(true);
      else expect(bulbs.length, kind.item).toBe(kind.parts.length);
    }
  });

  it('never stand on the church plot: no bulb and no wreath on it, over every plot', () => {
    let churches = 0;
    for (const { name, profile, plots, items } of placedOn) {
      const church = plots.filter((plot) => plot.kind === 'church');
      churches += church.length;
      expect(items.length, name).toBeGreaterThan(10);
      for (const item of items) {
        for (const part of kindOf(item).parts) {
          const at = placed(item, part);
          for (const plot of church) {
            expect(onPlot(profile, plot, at), `${name}: ${item.item} on a church plot`).toBe(false);
          }
        }
      }
    }
    expect(churches).toBeGreaterThanOrEqual(3);
  });

  it('never hang over the carriageway: every bulb in every fixture village stands back from it', () => {
    let bulbs = 0;
    for (const { name, profile, items } of placedOn) {
      const origin = corridorOrigin(profile);
      for (const item of items) {
        for (const part of kindOf(item).parts) {
          if (part.shape !== 'bulb') continue;
          const at = placed(item, part);
          const fromCentreline = distanceToDrawnRoad(profile, origin, at.x, at.z, 60);
          expect(fromCentreline - BULB_METRES / 2, `${name}: ${item.item}`).toBeGreaterThan(
            ROAD_WIDTH_METRES / 2,
          );
          bulbs += 1;
        }
      }
    }
    expect(bulbs).toBeGreaterThan(500);
  });

  it('wind a lamp post from 1.4 m to 4.6 m, under its arm, and touch it', () => {
    const post = WINTER.find((kind) => kind.item === 'post-lights');
    expect(post?.anchors).toEqual(['lamp-post']);
    for (const part of post?.parts ?? []) {
      expect(part.at[1]).toBeGreaterThanOrEqual(1.4);
      expect(part.at[1]).toBeLessThanOrEqual(4.6);
      // The post is at most 0.07 m across its radius; the bulb touches it.
      expect(Math.hypot(part.at[0], part.at[2]) - BULB_METRES / 2).toBeLessThanOrEqual(0.0701);
    }
  });

  it('put a wreath only on a house’s or a shop’s door, and every kind somewhere', () => {
    const kinds = new Set<string>();
    for (const { name, items } of placedOn) {
      for (const item of items) {
        kinds.add(item.item);
        if (item.item !== 'wreath') continue;
        expect(item.anchor.kind, name).toBe('doorstep');
        expect(['building', 'shop-row'], name).toContain(item.anchor.step?.building);
        // On the door, above its threshold, not on the path's end below it.
        expect(item.base, name).toBe(item.anchor.step?.top);
      }
    }
    expect([...kinds].sort()).toEqual(['eave-lights', 'post-lights', 'wreath']);
  });
});
