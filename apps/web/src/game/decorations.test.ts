// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #1624's placement half: `decorations.ts` decides where a holiday's items
 * stand, from each village's anchors (`streets.ts` builds them with the
 * street). Every assertion reads the anchors off the real `streetsAt`, the
 * path the renderer is handed, and every plot is enumerated from the real
 * `settlements.ts` §`everyVillagePlot` — never a hand-written list.
 */

import { distanceOnRoute, type RouteProfile } from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import {
  ANCHOR_KINDS,
  decorationsFor,
  GREEN_CLEAR_METRES,
  HOLIDAY_DECORATIONS,
  villageAnchors,
  type AnchorKind,
  type DecorationItem,
  type DecorationKind,
  type ItemTable,
} from './decorations';
import { distanceToDrawnRoad } from './road-grid';
import { NO_LAND_CLASS } from './land-class';
import { circuitRoute, hairpinRoute, northRoute } from './route-fixtures-testing';
import { scatterSeed } from './scatter';
import { fmix32, mixInto } from './seeded';
import {
  everyVillagePlot,
  onSettlementGround,
  PLOT_METRES,
  settlementFootprintsAt,
  siteAt,
  siteSpacing,
  type Site,
} from './settlements';
import {
  KERB_LATERAL_METRES,
  PAVEMENT_WIDTH_METRES,
  streetsAt,
  type VillageStreet,
} from './streets';
import { corridorOrigin, drawnRoadFrame, ROAD_WIDTH_METRES } from './terrain';

const FARMLAND = northRoute(6_000, () => 40);

/** A probe as the owner's page's is: on every anchor, a footprint of its own. */
function probe(radius = 0.15): DecorationKind {
  return {
    item: 'probe',
    anchors: ANCHOR_KINDS,
    chance: 1,
    radius,
    parts: [{ size: [0.3, 0.3, 0.3], at: [0, 0.15, 0], colour: 0xe07a1f, glows: false }],
  };
}
const PROBE: ItemTable = { halloween: [probe()], 'winter-lights': [probe()] };

function streetsOf(profile: RouteProfile, seed = scatterSeed(profile)): readonly VillageStreet[] {
  return streetsAt(profile, corridorOrigin(profile), seed, 0, profile.totalDistance);
}

/** Every village the route has, from the same decision the streets are laid from. */
function villagesOf(profile: RouteProfile, seed = scatterSeed(profile)): readonly Site[] {
  const { sites } = siteSpacing(profile);
  const found: Site[] = [];
  for (let index = 0; index < sites; index += 1) {
    const site = siteAt(profile, seed, index);
    if (site?.kind === 'village') found.push(site);
  }
  return found;
}

/** Placements as bytes: every field of every item, at a fixed precision. */
function serialise(items: readonly DecorationItem[]): string {
  return JSON.stringify(
    items.map(({ anchor, item, seed }) => [
      anchor.kind,
      anchor.x.toFixed(4),
      anchor.y.toFixed(4),
      anchor.z.toFixed(4),
      anchor.yaw.toFixed(5),
      anchor.clear.toFixed(4),
      anchor.hash,
      item,
      seed,
    ]),
  );
}

function digest(text: string): number {
  let running = 0x1624;
  for (let at = 0; at < text.length; at += 1) running = mixInto(running, text.charCodeAt(at));
  return fmix32(running);
}

describe('where a holiday’s decorations go — #1624', () => {
  const streets = streetsOf(FARMLAND);
  const items = decorationsFor(streets, 'halloween', PROBE);

  it('places by anchor kind, every kind a village has, and never a porch step', () => {
    // Non-vacuity: a multi-village fixture, every village with anchors.
    expect(streets.length).toBeGreaterThanOrEqual(2);
    for (const street of streets) expect(street.anchors.length).toBeGreaterThan(10);
    const kinds = new Set<AnchorKind>(items.map((item) => item.anchor.kind));
    expect([...kinds].sort()).toEqual(['doorstep', 'eave', 'green', 'lamp-post']);
    // A probe takes every anchor: one item each.
    expect(items).toHaveLength(streets.reduce((sum, street) => sum + street.anchors.length, 0));
    // An eave stands above its doorstep.
    for (const street of streets) {
      const doorsteps = street.anchors.filter((anchor) => anchor.kind === 'doorstep');
      for (const eave of street.anchors.filter((anchor) => anchor.kind === 'eave')) {
        const below = doorsteps.find((door) => door.x === eave.x && door.z === eave.z);
        expect(below).toBeDefined();
        expect(eave.y - (below?.y ?? 0)).toBeGreaterThan(1.5);
      }
    }
  });

  it('is deterministic: the same villages and seed give the same bytes, here and in any process', () => {
    const again = decorationsFor(streetsOf(FARMLAND), 'halloween', PROBE);
    expect(serialise(again)).toBe(serialise(items));
    // Pinned, so a second process — every later run of this file — must
    // produce these bytes too, not merely agree with itself.
    expect(items.length).toBe(PINNED_COUNT);
    expect(digest(serialise(items))).toBe(PINNED_DIGEST);
    // Another seed is another arrangement.
    const other = decorationsFor(
      streetsOf(FARMLAND, scatterSeed(FARMLAND) ^ 0x5a5a),
      'halloween',
      PROBE,
    );
    expect(other.length).toBeGreaterThan(0);
    expect(serialise(other)).not.toBe(serialise(items));
  });

  it('draws each anchor’s roll and seed from the anchor’s own hash', () => {
    const half: ItemTable = { halloween: [{ ...probe(), chance: 0.5 }] };
    const some = decorationsFor(streets, 'halloween', half);
    expect(some.length).toBeGreaterThan(items.length * 0.3);
    expect(some.length).toBeLessThan(items.length * 0.7);
    expect(new Set(items.map((item) => item.seed)).size).toBeGreaterThan(items.length * 0.95);
  });

  it('places nothing with no holiday, nor for a holiday the table names nothing for', () => {
    expect(decorationsFor(streets, undefined, PROBE)).toEqual([]);
    expect(decorationsFor(streets, 'winter-lights', { halloween: [probe()] })).toEqual([]);
    expect(decorationsFor(streets, 'halloween', { halloween: [] })).toEqual([]);
    // The product's own table places nothing yet: #1625 to #1627 fill it.
    for (const holiday of ['halloween', 'winter-lights'] as const) {
      expect(decorationsFor(streets, holiday, HOLIDAY_DECORATIONS)).toEqual([]);
    }
  });

  it('offers each anchor to the kinds in order, and gives it one item at most', () => {
    const first = { ...probe(), item: 'first', anchors: ['lamp-post'] as const };
    const second = { ...probe(), item: 'second' };
    const placed = decorationsFor(streets, 'halloween', { halloween: [first, second] });
    expect(placed).toHaveLength(items.length);
    for (const item of placed) {
      expect(item.item).toBe(item.anchor.kind === 'lamp-post' ? 'first' : 'second');
    }
  });
});

describe('never on the church plot, never in the carriageway, never outside a settlement — #1624', () => {
  for (const [name, profile] of [
    ['a straight farmland road', FARMLAND],
    ['a circuit', circuitRoute(1_000)],
  ] as const) {
    it(`holds every item off them, on ${name}`, () => {
      const origin = corridorOrigin(profile);
      const seed = scatterSeed(profile);
      const kind = probe(0.4);
      const placed = decorationsFor(streetsOf(profile), 'halloween', { halloween: [kind] });
      const ground = settlementFootprintsAt(profile, origin, seed, 0, profile.totalDistance);
      // Every plot, built or not, of every village: the church's among them.
      const churches = villagesOf(profile).flatMap((site) =>
        everyVillagePlot(seed, site).filter((plot) => plot.kind === 'church'),
      );
      expect(placed.length).toBeGreaterThan(20);
      expect(churches.length).toBeGreaterThanOrEqual(1);
      const onAChurchPlot = (x: number, z: number): boolean =>
        churches.some((plot) => {
          const frame = drawnRoadFrame(profile, origin, distanceOnRoute(profile, plot.along));
          if (frame === undefined) return false;
          const dx = x - frame.x;
          const dz = z - frame.z;
          const along = dx * frame.normalZ - dz * frame.normalX;
          const across = (dx * frame.normalX + dz * frame.normalZ) * plot.side;
          // The plot's own ground: its length, from behind the pavement out.
          return (
            Math.abs(along) <= PLOT_METRES / 2 &&
            across >= KERB_LATERAL_METRES + PAVEMENT_WIDTH_METRES &&
            across <= plot.lateral + PLOT_METRES
          );
        });
      // Non-vacuity: some church has an anchor-shaped place — its front path
      // — that the rule has to refuse.
      const churchDoors = streetsOf(profile)
        .flatMap((street) => street.doorPaths)
        .filter((path) => {
          const sections = path.walk.length / 3;
          return onAChurchPlot(
            path.walk[(sections - 1) * 3] as number,
            path.walk[(sections - 1) * 3 + 2] as number,
          );
        });
      expect(churchDoors.length).toBeGreaterThanOrEqual(1);
      for (const { anchor } of placed) {
        expect(onAChurchPlot(anchor.x, anchor.z), anchor.kind).toBe(false);
        const fromCentreline = distanceToDrawnRoad(profile, origin, anchor.x, anchor.z, 50);
        expect(fromCentreline - kind.radius, anchor.kind).toBeGreaterThanOrEqual(
          ROAD_WIDTH_METRES / 2,
        );
        expect(
          ground.some((piece) => onSettlementGround(anchor, piece)),
          anchor.kind,
        ).toBe(true);
      }
    });
  }

  it('makes no green anchor on the other leg of a hairpin', () => {
    // A village laid by hand along a hairpin's first leg, its crossroads
    // green 15 m out on each side: on the right that is 3 m from the second
    // leg's centreline, inside its carriageway.
    const greensOn = (profile: RouteProfile): readonly { clear: number }[] => {
      const site: Site = {
        kind: 'village',
        site: 0,
        wrappedSite: 0,
        centre: 200,
        half: 90,
        side: 1,
      };
      return villageAnchors(
        profile,
        corridorOrigin(profile),
        scatterSeed(profile),
        site,
        [],
        [],
        NO_LAND_CLASS,
      ).filter((anchor) => anchor.kind === 'green');
    };
    // The control: on a straight road, both sides' greens, two a side.
    expect(greensOn(northRoute(1_000, () => 40))).toHaveLength(4);
    const hairpin = greensOn(hairpinRoute(9));
    expect(hairpin).toHaveLength(2);
    for (const green of hairpin) expect(green.clear).toBeGreaterThanOrEqual(GREEN_CLEAR_METRES);
  });

  it('places no item wider than its anchor’s clearance from the carriageway', () => {
    const streets = streetsOf(FARMLAND);
    const wide = decorationsFor(streets, 'halloween', { halloween: [probe(3)] });
    const all = decorationsFor(streets, 'halloween', PROBE);
    expect(wide.length).toBeGreaterThan(0);
    // The lamp posts stand 1.65 m from the kerb: none of them is wide enough.
    expect(wide.length).toBeLessThan(all.length);
    expect(wide.some((item) => item.anchor.kind === 'lamp-post')).toBe(false);
    for (const { anchor } of wide) expect(anchor.clear).toBeGreaterThanOrEqual(3);
  });
});

/** What {@link serialise} gives FARMLAND's probe, taken when this file was written. */
const PINNED_COUNT = 136;
const PINNED_DIGEST = 341_446_077;
