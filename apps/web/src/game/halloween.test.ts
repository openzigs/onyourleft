// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #1625's placement: Halloween's pumpkins and jack-o'-lanterns, from the
 * product's own table (`decorations.ts` §`HOLIDAY_DECORATIONS`), on the
 * anchors the real `streetsAt` builds. Every plot is enumerated from
 * `settlements.ts` §`everyVillagePlot`, and every step is read off the
 * building's own plan (`buildings.ts` §`buildingPlan`'s joinery triangles) —
 * never off the numbers the placement was made from.
 */

import { distanceOnRoute, type RouteProfile } from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import { buildingPlan, frontDoorOf } from './buildings';
import {
  ANCHOR_KINDS,
  decorationsFor,
  HOLIDAY_DECORATIONS,
  type DecorationItem,
  type DecorationKind,
  type ItemTable,
} from './decorations';
import { NO_LAND_CLASS } from './land-class';
import { terrainHeightAt } from './landform';
import { circuitRoute, northRoute, plannerCornerRoute } from './route-fixtures-testing';
import { scatterSeed } from './scatter';
import { everyVillagePlot, siteAt, siteSpacing, type Plot, type Site } from './settlements';
import { streetsAt, type VillageStreet } from './streets';
import { corridorOrigin, drawnRoadFrame } from './terrain';

const HALLOWEEN = HOLIDAY_DECORATIONS.halloween ?? [];

interface Fixture {
  readonly name: string;
  readonly profile: RouteProfile;
  readonly seed: number;
}

const FIXTURES: readonly Fixture[] = [
  ['a straight farmland road', northRoute(6_000, () => 40)],
  ['a farmland road further north', northRoute(6_000, () => 40, { latitude: 53.2 })],
  ['a circuit', circuitRoute(1_000)],
].map(([name, profile]) => ({
  name: name as string,
  profile: profile as RouteProfile,
  seed: scatterSeed(profile as RouteProfile),
}));

/** The 150° corner `decoration-belt.test.ts` brings two villages into reach on, its seed 2. */
const CORNER = plannerCornerRoute(150);

function streetsOf({ profile, seed }: Fixture): readonly VillageStreet[] {
  return streetsAt(profile, corridorOrigin(profile), seed, 0, profile.totalDistance);
}

function villagesOf({ profile, seed }: Fixture): readonly Site[] {
  const { sites } = siteSpacing(profile);
  const found: Site[] = [];
  for (let index = 0; index < sites; index += 1) {
    const site = siteAt(profile, seed, index);
    if (site?.kind === 'village') found.push(site);
  }
  return found;
}

/** One plot, where its building stands, and its front door, in the corridor's frame. */
interface PlacedPlot {
  readonly plot: Plot & { readonly built: boolean };
  readonly house: { readonly x: number; readonly z: number };
  readonly face: { readonly x: number; readonly z: number };
  readonly right: { readonly x: number; readonly z: number };
  readonly ground: number;
  readonly door: { readonly x: number; readonly z: number } | undefined;
}

/** Every plot of every village, built or not, with where its door would be. */
function plotsOf(fixture: Fixture): readonly PlacedPlot[] {
  const { profile, seed } = fixture;
  const origin = corridorOrigin(profile);
  const placed: PlacedPlot[] = [];
  for (const site of villagesOf(fixture)) {
    for (const plot of everyVillagePlot(seed, site)) {
      const wrapped = distanceOnRoute(profile, plot.along);
      const frame = drawnRoadFrame(profile, origin, wrapped);
      if (frame === undefined) continue;
      const house = {
        x: frame.x + frame.normalX * plot.side * plot.lateral,
        z: frame.z + frame.normalZ * plot.side * plot.lateral,
      };
      const face = { x: -frame.normalX * plot.side, z: -frame.normalZ * plot.side };
      const right = { x: face.z, z: -face.x };
      const ground = terrainHeightAt(
        profile,
        origin,
        seed,
        wrapped,
        plot.lateral * plot.side,
        NO_LAND_CLASS,
      );
      const isBuilt =
        plot.kind === 'building' ||
        plot.kind === 'church' ||
        plot.kind === 'shop-row' ||
        plot.kind === 'barn' ||
        plot.kind === 'shed';
      const local = isBuilt ? frontDoorOf(plot.kind, plot.variant) : null;
      placed.push({
        plot,
        house,
        face,
        right,
        ground,
        door:
          local === null
            ? undefined
            : {
                x: house.x + right.x * local.x + face.x * local.z,
                z: house.z + right.z * local.x + face.z * local.z,
              },
      });
    }
  }
  return placed;
}

/** The plot whose front door an item's anchor is at, if any. */
function plotOf(plots: readonly PlacedPlot[], item: DecorationItem): PlacedPlot | undefined {
  return plots.find(
    (each) =>
      each.door !== undefined &&
      Math.hypot(each.door.x - item.anchor.x, each.door.z - item.anchor.z) < 1e-3,
  );
}

/**
 * The step before a building's front door, building-local, read off its
 * plan's joinery: every joinery corner below 0.6 m, within a metre across of
 * the door and from its wall out to 0.6 m. Its top and its tread's extent.
 */
function stepOf(
  plot: Plot,
): { top: number; x0: number; x1: number; z0: number; z1: number } | undefined {
  if (plot.kind !== 'building') return undefined;
  const door = frontDoorOf(plot.kind, plot.variant);
  if (door === null) return undefined;
  const joinery = buildingPlan(plot.kind, plot.variant).triangles.joinery;
  let top = Number.NEGATIVE_INFINITY;
  let x0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let z0 = Number.POSITIVE_INFINITY;
  let z1 = Number.NEGATIVE_INFINITY;
  for (let at = 0; at < joinery.length; at += 3) {
    const x = joinery[at] as number;
    const y = joinery[at + 1] as number;
    const z = joinery[at + 2] as number;
    if (y > 0.6 || Math.abs(x - door.x) > 1 || z < door.z - 1e-4 || z > door.z + 0.6) continue;
    top = Math.max(top, y);
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    z0 = Math.min(z0, z);
    z1 = Math.max(z1, z);
  }
  return Number.isFinite(top) ? { top, x0, x1, z0, z1 } : undefined;
}

const kindOf = (item: DecorationItem): DecorationKind => {
  const kind = HALLOWEEN.find((each) => each.item === item.item);
  if (kind === undefined) throw new Error(`no Halloween kind ${item.item}`);
  return kind;
};

describe('Halloween’s pumpkins — #1625', () => {
  const placedOn = FIXTURES.map((fixture) => ({
    fixture,
    plots: plotsOf(fixture),
    streets: streetsOf(fixture),
  }));

  it('stand only on the door step of a built house: never a church, a shop, the green or an unbuilt plot', () => {
    // A probe that stands on every anchor, to show the rule has something
    // to refuse: shops' doorsteps, the crossroads green.
    const probe: ItemTable = {
      halloween: [
        {
          item: 'probe',
          anchors: ANCHOR_KINDS,
          chance: 1,
          radius: 0,
          parts: [{ size: [0.1, 0.1, 0.1], at: [0, 0.05, 0], colour: 0x808080, glows: false }],
        },
      ],
    };
    let pumpkins = 0;
    let refusedShops = 0;
    let refusedGreens = 0;
    for (const { fixture, plots, streets } of placedOn) {
      const items = decorationsFor(streets, 'halloween', HOLIDAY_DECORATIONS);
      pumpkins += items.length;
      for (const item of items) {
        expect(['doorstep', 'porch-step'], fixture.name).toContain(item.anchor.kind);
        const plot = plotOf(plots, item);
        expect(plot, `${fixture.name}: an item at no plot's door`).toBeDefined();
        expect(plot?.plot.built, fixture.name).toBe(true);
        expect(plot?.plot.kind, fixture.name).toBe('building');
        expect(item.anchor.step?.building, fixture.name).toBe('building');
      }
      for (const item of decorationsFor(streets, 'halloween', probe)) {
        if (item.anchor.kind === 'green') refusedGreens += 1;
        if (plotOf(plots, item)?.plot.kind === 'shop-row') refusedShops += 1;
      }
      // Every plot, the church's among them, the unbuilt ones and the green.
      expect(plots.some((each) => each.plot.kind === 'church')).toBe(true);
      expect(plots.some((each) => !each.plot.built)).toBe(true);
    }
    expect(pumpkins).toBeGreaterThan(20);
    // Non-vacuity: there were shop doorsteps and greens to refuse.
    expect(refusedShops).toBeGreaterThan(0);
    expect(refusedGreens).toBeGreaterThan(0);
  });

  it('sit on the step, not in it or floating: every pumpkin’s foot on its top within 1 cm, inside its tread', () => {
    let checked = 0;
    for (const { fixture, plots, streets } of placedOn) {
      for (const item of decorationsFor(streets, 'halloween', HOLIDAY_DECORATIONS)) {
        const plot = plotOf(plots, item);
        if (plot === undefined) throw new Error('an item at no plot’s door');
        const step = stepOf(plot.plot);
        if (step === undefined) throw new Error('a pumpkin before a door with no step');
        const { x, z, yaw } = item.anchor;
        for (const part of kindOf(item).parts) {
          const [width, height, depth] = part.size;
          const [px, py, pz] = part.at;
          if (part.shape === 'pumpkin') {
            // Its foot, as `three-renderer.ts` §`decorationGeometry` stands it.
            const foot = item.base + py - height / 2;
            expect(Math.abs(foot - (plot.ground + step.top)), fixture.name).toBeLessThanOrEqual(
              0.01,
            );
            checked += 1;
          }
          // Every part's footprint, turned as the belt turns it, back into
          // the building's own frame: inside the tread.
          for (const [cx, cz] of [
            [px - width / 2, pz - depth / 2],
            [px + width / 2, pz - depth / 2],
            [px - width / 2, pz + depth / 2],
            [px + width / 2, pz + depth / 2],
          ] as const) {
            const worldX = x + cx * Math.cos(yaw) + cz * Math.sin(yaw) - plot.house.x;
            const worldZ = z - cx * Math.sin(yaw) + cz * Math.cos(yaw) - plot.house.z;
            const across = worldX * plot.right.x + worldZ * plot.right.z;
            const out = worldX * plot.face.x + worldZ * plot.face.z;
            expect(across, fixture.name).toBeGreaterThanOrEqual(step.x0 - 1e-3);
            expect(across, fixture.name).toBeLessThanOrEqual(step.x1 + 1e-3);
            expect(out, fixture.name).toBeGreaterThanOrEqual(step.z0 - 1e-3);
            expect(out, fixture.name).toBeLessThanOrEqual(step.z1 + 1e-3);
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(30);
  });

  it('go on about half of the houses with a front path, and every arrangement is placed', () => {
    let houses = 0;
    let decorated = 0;
    const kinds = new Set<string>();
    for (const { streets } of placedOn) {
      houses += streets
        .flatMap((street) => street.anchors)
        .filter((anchor) => anchor.step?.building === 'building').length;
      const items = decorationsFor(streets, 'halloween', HOLIDAY_DECORATIONS);
      decorated += items.length;
      for (const item of items) kinds.add(item.item);
    }
    expect(houses).toBeGreaterThan(40);
    // The owner's research: about 40 to 60 %. The table's 46 %, give or take a draw.
    expect(decorated / houses).toBeGreaterThan(0.35);
    expect(decorated / houses).toBeLessThan(0.6);
    expect([...kinds].sort()).toEqual(HALLOWEEN.map((kind) => kind.item).sort());
  });

  it('are one to three pumpkins, a jack-o’-lantern’s face glowing toward the road and nothing else glowing', () => {
    expect(HALLOWEEN.length).toBeGreaterThan(0);
    for (const kind of HALLOWEEN) {
      const bodies = kind.parts.filter((part) => part.shape === 'pumpkin');
      expect(bodies.length, kind.item).toBeGreaterThanOrEqual(1);
      expect(bodies.length, kind.item).toBeLessThanOrEqual(3);
      expect(kind.onStepOf, kind.item).toEqual(['building']);
      for (const part of kind.parts) {
        expect(part.glows, kind.item).toBe(part.shape === 'face');
        if (part.shape !== 'face') continue;
        // In front of the pumpkin it belongs to: the one whose middle is nearest across.
        const body = bodies.reduce((best, each) =>
          Math.abs(each.at[0] - part.at[0]) < Math.abs(best.at[0] - part.at[0]) ? each : best,
        );
        expect(part.at[2], kind.item).toBeGreaterThan(body.at[2] + body.size[2] * 0.35);
        expect(part.at[2], kind.item).toBeLessThan(body.at[2] + body.size[2] * 0.55);
      }
    }
    // A jack-o'-lantern's face is three quads: two eyes and a mouth.
    const jack = HALLOWEEN.find((kind) => kind.item === 'jack-o-lantern');
    expect(jack?.parts.filter((part) => part.shape === 'face')).toHaveLength(3);
  });

  it('place nothing on a corner fixture’s shops or church either, where two villages are in reach', () => {
    const fixture = { name: 'the corner', profile: CORNER, seed: 2 };
    const plots = plotsOf(fixture);
    const items = decorationsFor(streetsOf(fixture), 'halloween', HOLIDAY_DECORATIONS);
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) expect(plotOf(plots, item)?.plot.kind).toBe('building');
  });
});
