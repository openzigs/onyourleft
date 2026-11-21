// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The map's water lines beside the road, drawn as channels — #2974.
 *
 * Every fixture here is arithmetic beside a straight test road: no
 * OpenStreetMap data, no tile, and nothing here is a real place. A channel is
 * read back through what a ride draws — `sceneFrame` handed the mask
 * `GameView` builds from the corridor — as well as off `waterways`' answer.
 */

import { describe, expect, it } from 'vitest';

import { gradeAt, metres, type RouteProfile } from '@onyourleft/domain';
import type { LandUseFeature, WaterLineFeature } from '@onyourleft/map-features';

import { besideRoad, landBeside } from './footprint-fixtures-testing';
import { landClassMask, NO_LAND_CLASS, type LandClassMask } from './land-class';
import { terrainHeightAt } from './landform';
import { nearestOnDrawnRoad } from './road-grid';
import { northRoute } from './route-fixtures-testing';
import { scatterSeed } from './scatter';
import { sceneFrame } from './scene';
import { atStartLine } from './simulation';
import { corridorOrigin } from './terrain';
import {
  CHANNEL_DRAPE_METRES,
  CHANNEL_SHAPES,
  MAXIMUM_CHANNELS,
  inWater,
  onOpenWater,
  waterways,
  type Lake,
} from './waterways';
import type { WorldCorridor } from './world-data/corridor';

/** A road 3 km north, climbing 1 % from 10 m: no valley, so no invented water at all. */
const CLIMB = northRoute(3_000, (along) => 10 + along * 0.01);

/** A line of `kind` through `(along, lateral)` pairs beside `profile`'s road. */
function lineOf(
  profile: RouteProfile,
  kind: WaterLineFeature['kind'],
  pairs: readonly (readonly [number, number])[],
): WaterLineFeature {
  const origin = corridorOrigin(profile);
  return {
    kind,
    line: Float32Array.from(
      pairs.flatMap(([along, lateral]) => [...besideRoad(profile, origin, along, lateral)]),
    ),
  };
}

/** A straight line of `kind` beside the road from `from` to `to`, `lateral` out. */
function beside(
  kind: WaterLineFeature['kind'],
  lateral: number,
  from = 800,
  to = 1_600,
  profile = CLIMB,
): WaterLineFeature {
  return lineOf(profile, kind, [
    [from, lateral],
    [to, lateral],
  ]);
}

/** A corridor covering the whole of `profile`'s ground, holding `waterLines` and `landUse`. */
function corridorOf(
  profile: RouteProfile,
  waterLines: readonly WaterLineFeature[],
  landUse: readonly LandUseFeature[] = [],
): WorldCorridor {
  return {
    routeId: 'mapped-channels',
    origin: corridorOrigin(profile),
    covered: () => true,
    coveredBoxes: [{ minX: -3_000, maxX: 3_000, minZ: -1_000, maxZ: 4_000 }],
    landUse,
    buildings: [],
    paths: [],
    streets: [],
    waterLines,
  };
}

function maskOf(
  waterLines: readonly WaterLineFeature[],
  landUse: readonly LandUseFeature[] = [],
  profile = CLIMB,
): LandClassMask {
  return landClassMask(corridorOf(profile, waterLines, landUse));
}

function channelsOf(land: LandClassMask, profile = CLIMB): readonly Lake[] {
  return waterways(profile, scatterSeed(profile), land).lakes.filter(
    (lake) => lake.channel !== undefined,
  );
}

function frameAt(odometer: number, land: LandClassMask, profile = CLIMB) {
  const start = atStartLine(profile);
  return sceneFrame({
    profile,
    origin: corridorOrigin(profile),
    state: { ...start, ride: { ...start.ride, distance: metres(odometer) } },
    landClass: land,
  });
}

/** A stream 20 m out on the road's right, from 800 to 1 600 m. */
const STREAM = maskOf([beside('stream', 20)]);

/** A ditch 6 m out on the road's left, beside the verge. */
const DITCH = maskOf([beside('ditch', -6)]);

describe('a mapped water line beside the road is drawn as a channel — #2974', () => {
  it('finds it where the map has it: its side, its stretch, its kind and its shores', () => {
    const channels = channelsOf(STREAM);
    expect(channels).toHaveLength(1);
    const channel = channels[0] as Lake;
    expect(channel.channel).toBe('stream');
    expect(channel.side).toBe(1);
    expect(Math.abs(channel.from - 800)).toBeLessThanOrEqual(10);
    expect(Math.abs(channel.to - 1_600)).toBeLessThanOrEqual(10);
    const half = CHANNEL_SHAPES.stream.halfWidth;
    expect(channel.near).toBeCloseTo(20 - half, 3);
    expect(channel.far).toBeCloseTo(20 + half, 3);
    // The control: the same road with no map has no water at all.
    expect(waterways(CLIMB, scatterSeed(CLIMB), NO_LAND_CLASS).lakes).toEqual([]);
  });

  it('follows the road up the climb: its water the kind’s depth under the road, sample by sample', () => {
    const channel = channelsOf(STREAM)[0] as Lake;
    const level = channel.shores?.level;
    expect(level).toBeDefined();
    const below = CHANNEL_SHAPES.stream.belowRoad;
    const first = level?.[0] as number;
    const last = level?.[(level.length ?? 1) - 1] as number;
    expect(first).toBeCloseTo(10 + channel.from * 0.01 - below, 1);
    expect(last).toBeCloseTo(10 + channel.to * 0.01 - below, 1);
    expect(last - first).toBeGreaterThan(7);
  });

  it('draws it at its width by kind: a river wide, a stream narrow, a ditch narrower', () => {
    const widthOf = (kind: WaterLineFeature['kind']): number => {
      const channel = channelsOf(maskOf([beside(kind, 30)]))[0] as Lake;
      expect(channel.channel).toBe(kind);
      return (channel.far ?? 0) - (channel.near ?? 0);
    };
    expect(widthOf('river')).toBeCloseTo(CHANNEL_SHAPES.river.halfWidth * 2, 3);
    expect(widthOf('canal')).toBeCloseTo(CHANNEL_SHAPES.canal.halfWidth * 2, 3);
    expect(widthOf('stream')).toBeCloseTo(CHANNEL_SHAPES.stream.halfWidth * 2, 3);
    expect(widthOf('ditch')).toBeCloseTo(CHANNEL_SHAPES.ditch.halfWidth * 2, 3);
    expect(widthOf('drain')).toBeCloseTo(CHANNEL_SHAPES.drain.halfWidth * 2, 3);
    expect(CHANNEL_SHAPES.river.halfWidth).toBeGreaterThan(CHANNEL_SHAPES.stream.halfWidth);
    expect(CHANNEL_SHAPES.stream.halfWidth).toBeGreaterThan(CHANNEL_SHAPES.ditch.halfWidth);
  });

  it('draws its water where none was drawn, between its shores, on its side', () => {
    const surface = frameAt(1_200, STREAM).water.surface;
    expect(surface.indices.length).toBeGreaterThan(0);
    const half = CHANNEL_SHAPES.stream.halfWidth;
    // The road runs north along x = 0, and its right is −x.
    for (let at = 0; at * 3 < surface.vertices.length; at += 1) {
      const x = surface.vertices[at * 3] as number;
      expect(-x).toBeGreaterThan(20 - half - 0.5);
      expect(-x).toBeLessThan(20 + half + 0.5);
    }
    expect(frameAt(1_200, NO_LAND_CLASS).water.surface.indices.length).toBe(0);
  });

  it('lays a narrow channel’s water on the drawn ground, never under it', () => {
    const origin = corridorOrigin(CLIMB);
    const seed = scatterSeed(CLIMB);
    let checked = 0;
    let lifted = 0;
    for (const land of [STREAM, DITCH]) {
      const surface = frameAt(1_200, land).water.surface;
      for (let at = 0; at * 3 < surface.vertices.length; at += 1) {
        const x = surface.vertices[at * 3] as number;
        const y = surface.vertices[at * 3 + 1] as number;
        const z = surface.vertices[at * 3 + 2] as number;
        const near = nearestOnDrawnRoad(CLIMB, origin, x, z, 100);
        if (near === undefined || near.along < 900 || near.along > 1_500) continue;
        const ground = terrainHeightAt(CLIMB, origin, seed, near.along, near.lateral, land);
        checked += 1;
        expect(y).toBeGreaterThanOrEqual(ground - 0.02);
        const level = (channelsOf(land)[0] as Lake).waterElevation - origin.elevation;
        if (y > level + 0.5) lifted += 1;
      }
    }
    expect(checked).toBeGreaterThan(20);
    // Non-vacuity: the climb lifts the water well over the run's lowest level.
    expect(lifted).toBeGreaterThan(0);
    expect(CHANNEL_DRAPE_METRES).toBeGreaterThan(0);
  });

  it('draws a wide channel’s water at the road’s own fall beside it, not the run’s lowest', () => {
    const origin = corridorOrigin(CLIMB);
    const river = maskOf([beside('river', 30)]);
    const surface = frameAt(1_480, river).water.surface;
    let checked = 0;
    for (let at = 0; at * 3 < surface.vertices.length; at += 1) {
      const x = surface.vertices[at * 3] as number;
      const z = surface.vertices[at * 3 + 2] as number;
      if (z < 1_490 || z > 1_510 || -x < 28 || -x > 32) continue;
      checked += 1;
      const water = 10 + z * 0.01 - CHANNEL_SHAPES.river.belowRoad - origin.elevation;
      expect(Math.abs((surface.vertices[at * 3 + 1] as number) - water)).toBeLessThan(0.3);
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('wears the wet tint on its banks', () => {
    const tinted = (land: LandClassMask): number => {
      const { colours, fields } = frameAt(1_200, land).terrain.mesh;
      let count = 0;
      for (let at = 0; at * 2 < fields.length; at += 1) {
        const along = fields[at * 2] as number;
        const lateral = fields[at * 2 + 1] as number;
        if (along < 1_000 || along > 1_400 || lateral < 15 || lateral > 45) continue;
        const [r, g, b] = [colours[at * 3], colours[at * 3 + 1], colours[at * 3 + 2]];
        if (!(r === g && g === b)) count += 1;
      }
      return count;
    };
    expect(tinted(maskOf([beside('river', 30)]))).toBeGreaterThan(0);
    // The control: with no map the ground there wears none.
    expect(tinted(NO_LAND_CLASS)).toBe(0);
  });

  it('cuts a wide channel into the ground, its banks rising to the road', () => {
    const origin = corridorOrigin(CLIMB);
    const seed = scatterSeed(CLIMB);
    const river = maskOf([beside('river', 30)]);
    const shape = CHANNEL_SHAPES.river;
    const road = 10 + 1_200 * 0.01 - origin.elevation;
    const surface = road - shape.belowRoad;
    const bed = surface - shape.depth;
    // Under its water, at the ground's column 27 m out, the ground is its bed: a channel.
    expect(terrainHeightAt(CLIMB, origin, seed, 1_200, 27, river)).toBeLessThanOrEqual(bed + 0.05);
    // The control: with no map the same ground is not on it.
    expect(terrainHeightAt(CLIMB, origin, seed, 1_200, 27, NO_LAND_CLASS)).toBeGreaterThan(
      bed + shape.depth / 2,
    );
  });

  it('stands nothing on its water or its bank, and its bank is the kind’s', () => {
    const ways = waterways(CLIMB, scatterSeed(CLIMB), STREAM);
    const shape = CHANNEL_SHAPES.stream;
    expect(onOpenWater(ways, CLIMB, 1_200, 20)).toBe(true);
    expect(onOpenWater(ways, CLIMB, 1_200, 20 + shape.halfWidth + 0.5)).toBe(false);
    expect(inWater(ways, CLIMB, 1_200, 20 + shape.halfWidth + shape.bank - 0.5)).toBe(true);
    expect(inWater(ways, CLIMB, 1_200, 20 + shape.halfWidth + shape.bank + 1)).toBe(false);
    // On the other side of the road there is no water at all.
    expect(inWater(ways, CLIMB, 1_200, -20)).toBe(false);
    // A ditch's bank is a step, so a tree may stand two metres off it.
    const ditch = waterways(CLIMB, scatterSeed(CLIMB), DITCH);
    expect(inWater(ditch, CLIMB, 1_200, -6)).toBe(true);
    expect(inWater(ditch, CLIMB, 1_200, -(6 + CHANNEL_SHAPES.ditch.halfWidth + 2))).toBe(false);
    expect(inWater(ways, CLIMB, 1_200, 20 + shape.halfWidth + 2)).toBe(true);
  });

  it('keeps the road and the trainer’s gradient the route’s own', () => {
    const before = JSON.stringify(CLIMB);
    expect(frameAt(1_200, STREAM).corridor.centre).toEqual(
      frameAt(1_200, NO_LAND_CLASS).corridor.centre,
    );
    expect(JSON.stringify(CLIMB)).toBe(before);
    expect(gradeAt(CLIMB, 1_200)).toBeCloseTo(1, 1);
  });
});

describe('a ditch or a drain beside the road is drawn small, and never bridged — #2974', () => {
  it('draws a ditch beside the verge as a narrow channel', () => {
    const channels = channelsOf(DITCH);
    expect(channels).toHaveLength(1);
    const ditch = channels[0] as Lake;
    expect(ditch.channel).toBe('ditch');
    expect(ditch.side).toBe(-1);
    expect((ditch.far ?? 0) - (ditch.near ?? 0)).toBeLessThan(1.5);
    expect(frameAt(1_200, DITCH).water.surface.indices.length).toBeGreaterThan(0);
  });

  it('bridges a stream across the road, and no ditch or drain', () => {
    const across = (kind: WaterLineFeature['kind'], along: number): WaterLineFeature =>
      lineOf(CLIMB, kind, [
        [along, -150],
        [along, 150],
      ]);
    const crossings = (lines: readonly WaterLineFeature[]) =>
      waterways(CLIMB, scatterSeed(CLIMB), maskOf(lines)).crossings;
    expect(crossings([across('stream', 1_200)])).toHaveLength(1);
    expect(crossings([across('ditch', 1_200), across('drain', 2_000)])).toEqual([]);
    // And one crossing the road makes no channel beside it.
    expect(channelsOf(maskOf([across('ditch', 1_200)]))).toEqual([]);
  });
});

describe('what is not a channel — #2974', () => {
  it('draws none for a line too short, too far out or under the road', () => {
    expect(channelsOf(maskOf([beside('stream', 20, 800, 820)]))).toEqual([]);
    expect(channelsOf(maskOf([beside('stream', 90)]))).toEqual([]);
    expect(channelsOf(maskOf([beside('stream', 1)]))).toEqual([]);
  });

  it('draws none over a river the map already draws as water', () => {
    const origin = corridorOrigin(CLIMB);
    const bank = landBeside(CLIMB, origin, 'water', 'river', 900, 1_400, 15, 60);
    const both = maskOf([beside('river', 35, 900, 1_400)], [bank]);
    const lakes = waterways(CLIMB, scatterSeed(CLIMB), both).lakes;
    expect(lakes.filter((lake) => lake.channel === undefined)).toHaveLength(1);
    expect(lakes.filter((lake) => lake.channel !== undefined)).toEqual([]);
  });

  it('draws none on road the map was not read beside', () => {
    const firstKm = landClassMask({
      ...corridorOf(CLIMB, [beside('stream', 20, 200, 2_400)]),
      coveredBoxes: [{ minX: -3_000, maxX: 3_000, minZ: -1_000, maxZ: 1_000 }],
    });
    const channels = channelsOf(firstKm);
    expect(channels).toHaveLength(1);
    expect((channels[0] as Lake).to).toBeLessThan(1_010);
  });

  it('ends a channel where its line turns away from the road', () => {
    const turning = lineOf(CLIMB, 'stream', [
      [800, 20],
      [1_200, 20],
      [1_220, 60],
    ]);
    const channel = channelsOf(maskOf([turning]))[0] as Lake;
    expect(Math.abs(channel.to - 1_200)).toBeLessThanOrEqual(10);
  });

  it('stays bounded on hostile lines: a kilometre-long segment and a thousand lines', () => {
    const hostile: WaterLineFeature = {
      kind: 'canal',
      line: Float32Array.of(-1e6, -1e6, 1e6, 1e6, Number.NaN, 0, 5, 5),
    };
    const many = Array.from({ length: 1_000 }, (_, index) =>
      beside('ditch', index % 2 === 0 ? 8 : -8, 10 + index * 2, 10 + index * 2 + 60),
    );
    expect(channelsOf(maskOf([hostile])).length).toBeLessThanOrEqual(MAXIMUM_CHANNELS);
    expect(channelsOf(maskOf(many)).length).toBeLessThanOrEqual(MAXIMUM_CHANNELS);
    // Seventy-four ditches apart from each other, every one long enough: the cap holds.
    const apart = Array.from({ length: 74 }, (_, index) =>
      beside(
        'ditch',
        index % 2 === 0 ? 8 : -8,
        20 + Math.floor(index / 2) * 80,
        82 + Math.floor(index / 2) * 80,
      ),
    );
    expect(channelsOf(maskOf(apart))).toHaveLength(MAXIMUM_CHANNELS);
  });

  it('makes no channel of a line that crosses the road at a slant', () => {
    // 35° off the road: its place abeam the road moves 7 m a sample, near
    // enough to run on, but it crosses the road rather than running beside it.
    const slant = Math.tan((35 * Math.PI) / 180);
    const crossing = lineOf(CLIMB, 'ditch', [
      [1_200 - 60 / slant, -60],
      [1_200 + 60 / slant, 60],
    ]);
    expect(channelsOf(maskOf([crossing]))).toEqual([]);
  });

  it('breaks a channel where the nearest line jumps to another further out', () => {
    const channels = channelsOf(
      maskOf([beside('stream', 10, 800, 1_205), beside('stream', 40, 1_195, 1_600)]),
    );
    expect(channels).toHaveLength(2);
    expect(
      channels.map((channel) => Math.round(((channel.near ?? 0) + (channel.far ?? 0)) / 2)),
    ).toEqual([10, 40]);
  });
});
