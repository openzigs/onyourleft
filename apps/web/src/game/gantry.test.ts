// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { metres, routeProfile, type RouteProfile, type RoutePoint } from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import { cameraRig } from './camera';
import {
  BANNER_WIDTH_METRES,
  bannerPlace,
  GANTRY_HEADROOM_METRES,
  GANTRY_LEG_CLEARANCE_METRES,
  GANTRY_LEG_METRES,
  LINE_DRAW_AHEAD_METRES,
  lineStands,
  standBoxes,
  standPoint,
  type PlacedStand,
} from './gantry';
import { FINISH_WORD, LAP_WORD, START_WORD, toGoText } from './gantry-wording';
import {
  circuitRoute,
  hillRoute,
  lakeValleyRoute,
  northRoute,
  valleyRoute,
} from './route-fixtures-testing';
import { sceneFrame } from './scene';
import { STRUCTURE_FOOTPRINTS } from './settlements';
import { SCATTER_VERGE_METRES, STRUCTURE_KINDS, type StructureKind } from './scatter';
import { atStartLine } from './simulation';
import { corridorOrigin, ROAD_WIDTH_METRES } from './terrain';
import { GantryBelt } from './three-renderer';
import { bannerAtlas, readGlyphRange } from './banner-atlas';
import { bannerCells } from './gantry-wording';

const RANGE = fileURLToPath(
  new URL('../../public/glyphs/Roboto-Regular/0-255.pbf', import.meta.url),
);

function frameAt(profile: RouteProfile, distance: number): ReturnType<typeof sceneFrame> {
  const start = atStartLine(profile);
  return sceneFrame({
    profile,
    origin: corridorOrigin(profile),
    state: { ...start, ride: { ...start.ride, distance: metres(distance) } },
  });
}

/** A loop's own points as a point-to-point route: the control for "one gantry on a loop". */
function unlooped(profile: RouteProfile): RouteProfile {
  const points: RoutePoint[] = profile.positions.map((position, index) => ({
    position,
    elevation: profile.elevations[index],
  }));
  return routeProfile(points, { loop: false });
}

const gantries = (profile: RouteProfile): number =>
  lineStands(profile, 'metric').filter((stand) => stand.kind === 'gantry').length;

describe('the start and finish gantries — #679', () => {
  it('stands one gantry on a loop and two on a point-to-point route', () => {
    const circuit = circuitRoute(200);
    expect(circuit.loop).toBe(true);
    expect(gantries(circuit)).toBe(1);
    expect(lineStands(circuit, 'metric')[0]?.text).toBe(LAP_WORD);
    expect(gantries(valleyRoute())).toBe(2);
    expect(
      lineStands(valleyRoute(), 'metric')
        .filter((stand) => stand.kind === 'gantry')
        .map((stand) => stand.text),
    ).toEqual([START_WORD, FINISH_WORD]);
    // The control: the same circuit with its loop flag cleared has two.
    expect(gantries(unlooped(circuit))).toBe(2);
  });

  it('puts a board one unit before the line, in the rider’s own units', () => {
    const route = northRoute(3_000, () => 0);
    const metric = lineStands(route, 'metric').find((stand) => stand.kind === 'board');
    const imperial = lineStands(route, 'imperial').find((stand) => stand.kind === 'board');
    expect(metric?.text).toBe(toGoText('metric'));
    expect(imperial?.text).toBe(toGoText('imperial'));
    expect((route.totalDistance as number) - (metric?.distance ?? 0)).toBeCloseTo(1_000, 6);
    expect(imperial?.distance ?? 0).toBeLessThan(metric?.distance ?? 0);
  });

  it('places a line on the drawn road where the route says, and nowhere else', () => {
    const route = northRoute(3_000, () => 0);
    const near = frameAt(route, (route.totalDistance as number) - 40).lines;
    const finish = near.find((line) => line.stand.text === FINISH_WORD);
    expect(finish).toBeDefined();
    // Due north, so its z is the route's end (to the projection's tenth of a percent).
    expect(finish?.z ?? 0).toBeGreaterThan((route.totalDistance as number) * 0.998);
    expect(finish?.headingZ ?? 0).toBeCloseTo(1, 6);
    // Mid-route, out of reach of every line: nothing, so nothing is drawn.
    const middle = frameAt(route, 1_000);
    expect(middle.lines).toEqual([]);
    // And the reach is what bounds it.
    const reach = frameAt(route, (route.totalDistance as number) - LINE_DRAW_AHEAD_METRES - 5);
    expect(reach.lines.some((line) => line.stand.text === FINISH_WORD)).toBe(false);
  });

  it('draws a loop’s line on every lap', () => {
    const circuit = circuitRoute(200);
    const lap = circuit.totalDistance as number;
    const first = frameAt(circuit, lap - 30).lines.filter((line) => line.stand.kind === 'gantry');
    const third = frameAt(circuit, 3 * lap - 30).lines.filter(
      (line) => line.stand.kind === 'gantry',
    );
    expect(first).toHaveLength(1);
    expect(third).toHaveLength(1);
    expect(third[0]?.x).toBeCloseTo(first[0]?.x ?? Number.NaN, 3);
    expect(third[0]?.z).toBeCloseTo(first[0]?.z ?? Number.NaN, 3);
  });

  it('stands its legs outside both edges, and its beam above the road on a climb', () => {
    const legs = standBoxes('gantry').filter(
      (box) => box.role === 'metal' && box.width === GANTRY_LEG_METRES,
    );
    expect(legs).toHaveLength(2);
    for (const leg of legs) {
      expect(Math.abs(leg.across) - leg.width / 2).toBeCloseTo(
        ROAD_WIDTH_METRES / 2 + GANTRY_LEG_CLEARANCE_METRES,
        9,
      );
    }
    // On #458's 10 % climb, at a line: the road rises by half the beam's depth
    // at its far side, and the underside still clears the headroom less that.
    const beam = standBoxes('gantry').find((box) => box.width > ROAD_WIDTH_METRES);
    expect(beam).toBeDefined();
    const underside = (beam?.up ?? 0) - (beam?.height ?? 0) / 2;
    expect(underside).toBe(GANTRY_HEADROOM_METRES);
    const rise = 0.1 * ((beam?.depth ?? 0) / 2);
    expect(underside - rise).toBeGreaterThan(4.9);
    // The barriers on the verge: past the edge, inside the scatter's clear band.
    for (const box of standBoxes('gantry').filter((each) => each.role === 'barrier')) {
      const inner = Math.abs(box.across) - box.width / 2;
      expect(inner).toBeGreaterThan(ROAD_WIDTH_METRES / 2);
      expect(inner + box.width).toBeLessThan(ROAD_WIDTH_METRES / 2 + SCATTER_VERGE_METRES);
    }
  });

  it('keeps every scatter item, structure and water surface off a gantry and its barriers', () => {
    type Corner = { readonly x: number; readonly z: number };
    /** A rectangle's corners from its middle, its two half extents and its axes. */
    const rectangle = (
      middle: Corner,
      across: Corner,
      along: Corner,
      halfAcross: number,
      halfAlong: number,
    ): Corner[] =>
      [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ].map(([a = 0, b = 0]) => ({
        x: middle.x + across.x * halfAcross * a + along.x * halfAlong * b,
        z: middle.z + across.z * halfAcross * a + along.z * halfAlong * b,
      }));
    /** Whether two convex outlines overlap: no axis separates them. */
    const overlap = (a: Corner[], b: Corner[]): boolean => {
      for (const shape of [a, b]) {
        for (let index = 0; index < shape.length; index += 1) {
          const p = shape[index] as Corner;
          const q = shape[(index + 1) % shape.length] as Corner;
          const axis = { x: q.z - p.z, z: p.x - q.x };
          const span = (corners: Corner[]): [number, number] => {
            const values = corners.map((c) => c.x * axis.x + c.z * axis.z);
            return [Math.min(...values), Math.max(...values)];
          };
          const [aLow, aHigh] = span(a);
          const [bLow, bHigh] = span(b);
          if (aHigh < bLow || bHigh < aLow) return false;
        }
      }
      return true;
    };
    const boxesOf = (line: PlacedStand): Corner[][] =>
      standBoxes(line.stand.kind).map((box) =>
        rectangle(
          standPoint(line, box.across, 0, box.along),
          { x: -line.headingZ, z: line.headingX },
          { x: line.headingX, z: line.headingZ },
          box.width / 2,
          box.depth / 2,
        ),
      );
    const outlineOf = (item: {
      kind: string;
      x: number;
      z: number;
      rotation: number;
      scale: number;
    }): Corner[] => {
      const across = { x: Math.cos(item.rotation), z: -Math.sin(item.rotation) };
      const along = { x: Math.sin(item.rotation), z: Math.cos(item.rotation) };
      if ((STRUCTURE_KINDS as readonly string[]).includes(item.kind)) {
        const { x, back, front } = STRUCTURE_FOOTPRINTS[item.kind as StructureKind];
        const middle = {
          x: item.x + along.x * ((front + back) / 2),
          z: item.z + along.z * ((front + back) / 2),
        };
        return rectangle(middle, across, along, x, (front - back) / 2);
      }
      // A tree's trunk, a shrub or a rock: a metre's berth, the scatter's own spacing.
      return rectangle(item, across, along, 1, 1);
    };
    let lines = 0;
    for (const route of [circuitRoute(200), valleyRoute(), hillRoute(), lakeValleyRoute()]) {
      const total = route.totalDistance as number;
      for (const distance of [5, total - 30]) {
        const frame = frameAt(route, distance);
        for (const line of frame.lines.filter((each) => each.stand.kind === 'gantry')) {
          lines += 1;
          for (const box of boxesOf(line)) {
            for (const item of frame.scatter) {
              expect(overlap(box, outlineOf(item)), `${item.kind} on a gantry`).toBe(false);
            }
            const water = frame.water.surface.vertices;
            for (let at = 0; at < water.length; at += 3) {
              const point = { x: water[at] ?? 0, z: water[at + 2] ?? 0 };
              expect(
                overlap(box, rectangle(point, { x: 1, z: 0 }, { x: 0, z: 1 }, 0.01, 0.01)),
              ).toBe(false);
            }
          }
        }
      }
    }
    // Non-vacuity: every route's lines were in reach and looked at.
    expect(lines).toBeGreaterThanOrEqual(7);
  });

  it('faces the rider riding at it, and reads left to right from the chase camera', () => {
    const route = northRoute(3_000, () => 0);
    const frame = frameAt(route, (route.totalDistance as number) - 60);
    const finish = frame.lines.find((line) => line.stand.text === FINISH_WORD);
    if (finish === undefined) throw new Error('no finish in reach');
    const place = bannerPlace('gantry');
    // The banner's left and right ends, as `GantryBelt` lays its quad: `u`
    // runs along the road's normal, the rider's right.
    const left = standPoint(finish, place.across - BANNER_WIDTH_METRES / 2, place.up, place.along);
    const right = standPoint(finish, place.across + BANNER_WIDTH_METRES / 2, place.up, place.along);
    const { eye, target } = cameraRig(frame.camera);
    const forward = { x: target.x - eye.x, z: target.z - eye.z };
    const cameraRight = { x: -forward.z, z: forward.x };
    const across = (point: { x: number; z: number }): number =>
      (point.x - eye.x) * cameraRight.x + (point.z - eye.z) * cameraRight.z;
    // `u = 0` is on the camera's left and `u = 1` on its right: not mirrored.
    expect(across(left)).toBeLessThan(across(right));
    // And the banner is between the camera and the beam: its face toward the rider.
    const beam = standPoint(finish, 0, place.up, 0);
    const banner = standPoint(finish, 0, place.up, place.along);
    const depth = (point: { x: number; z: number }): number =>
      (point.x - eye.x) * forward.x + (point.z - eye.z) * forward.z;
    expect(depth(banner)).toBeLessThan(depth(beam));
  });

  it('lays the banner’s quad as a proper rotation facing the rider, u to their right', () => {
    const glyphs = readGlyphRange(new Uint8Array(readFileSync(RANGE)));
    const atlas = bannerAtlas(glyphs, bannerCells());
    // No GPU here: the texture is only handed to a material.
    const belt = new GantryBelt({ atlas, texture: {} as never });
    const route = northRoute(3_000, () => 0);
    const lines = frameAt(route, (route.totalDistance as number) - 40).lines;
    belt.update(lines);
    const finish = lines.find((line) => line.stand.text === FINISH_WORD);
    expect(belt.meshes.banners.count).toBe(1);
    const elements = belt.meshes.banners.instanceMatrix.array;
    const column = (at: number): number[] => [0, 1, 2].map((row) => elements[at * 4 + row] ?? 0);
    const [u, v, w] = [column(0), column(1), column(2)];
    // u along the rider's right, w toward the rider (against the heading).
    expect((u[0] ?? 0) / BANNER_WIDTH_METRES).toBeCloseTo(-(finish?.headingZ ?? 0), 6);
    expect((u[2] ?? 0) / BANNER_WIDTH_METRES).toBeCloseTo(finish?.headingX ?? 0, 6);
    expect(w[0]).toBeCloseTo(-(finish?.headingX ?? 0), 6);
    expect(w[2]).toBeCloseTo(-(finish?.headingZ ?? 0), 6);
    // Not a mirror: u × v points along w.
    const cross = [
      (u[1] ?? 0) * (v[2] ?? 0) - (u[2] ?? 0) * (v[1] ?? 0),
      (u[2] ?? 0) * (v[0] ?? 0) - (u[0] ?? 0) * (v[2] ?? 0),
      (u[0] ?? 0) * (v[1] ?? 0) - (u[1] ?? 0) * (v[0] ?? 0),
    ];
    expect(
      (cross[0] ?? 0) * (w[0] ?? 0) + (cross[1] ?? 0) * (w[1] ?? 0) + (cross[2] ?? 0) * (w[2] ?? 0),
    ).toBeGreaterThan(0);
    // And it wears the finish's cell of the atlas.
    expect(belt.meshes.banners.geometry.getAttribute('oylCell').getX(0)).toBe(
      atlas.cells.get(FINISH_WORD),
    );
    belt.dispose();
  });

  it('draws nothing where a frame carries no line, and something where it does', () => {
    const belt = new GantryBelt();
    belt.update([]);
    expect(belt.meshes.boxes.visible).toBe(false);
    expect(belt.meshes.banners.visible).toBe(false);
    const route = northRoute(3_000, () => 0);
    belt.update(frameAt(route, (route.totalDistance as number) - 40).lines);
    expect(belt.meshes.boxes.visible).toBe(true);
    expect(belt.meshes.boxes.count).toBe(standBoxes('gantry').length);
    // No atlas was handed over, so no banner: never a banner with no lettering.
    expect(belt.meshes.banners.visible).toBe(false);
    belt.update([]);
    expect(belt.meshes.boxes.visible).toBe(false);
    belt.dispose();
  });
});
