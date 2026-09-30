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
  LINE_DRAW_BEHIND_METRES,
  lineStands,
  standBoxes,
  standPoint,
  boxPoint,
  type PlacedBox,
  type PlacedStand,
} from './gantry';
import { FINISH_WORD, LAP_WORD, START_WORD, toGoText } from './gantry-wording';
import {
  circuitRoute,
  hairpinRoute,
  hillRoute,
  lakeValleyRoute,
  northRoute,
  valleyRoute,
} from './route-fixtures-testing';
import { sceneFrame } from './scene';
import { STRUCTURE_FOOTPRINTS } from './settlements';
import { SCATTER_VERGE_METRES, STRUCTURE_KINDS, type StructureKind } from './scatter';
import { atStartLine } from './simulation';
import {
  corridorOrigin,
  ROAD_WIDTH_METRES,
  VIEW_AHEAD_METRES,
  VIEW_BEHIND_METRES,
  type CorridorPoint,
} from './terrain';
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

  it('stands its legs outside both edges, and its lowest point above the road on a climb', () => {
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
    // The gantry's underside over the carriageway is its LOWEST part there —
    // the banner's bottom edge, which hangs below the beam (#879's review:
    // this used to measure the beam alone, at 5 m, over a banner down to 4).
    const beam = standBoxes('gantry').find((box) => box.width > ROAD_WIDTH_METRES);
    expect(beam).toBeDefined();
    const beamUnderside = (beam?.up ?? 0) - (beam?.height ?? 0) / 2;
    const banner = bannerPlace('gantry');
    const bannerBottom = banner.up - banner.height / 2;
    const lowest = Math.min(beamUnderside, bannerBottom);
    expect(lowest).toBeCloseTo(GANTRY_HEADROOM_METRES, 9);
    expect(bannerBottom).toBeLessThan(beamUnderside);
    // On #458's 10 % climb, at a line: the road rises toward the banner's side
    // by 10 % of how far it hangs from the line, and the banner still clears
    // the stated headroom less that.
    const rise = 0.1 * Math.abs(banner.along);
    expect(bannerBottom - rise).toBeGreaterThan(GANTRY_HEADROOM_METRES - 0.05);
    // And the whole banner is below the beam's top and above the road: it hangs from it.
    expect(banner.up + banner.height / 2).toBeCloseTo((beam?.up ?? 0) + (beam?.height ?? 0) / 2, 9);
    // The barriers on the verge: past the edge, inside the scatter's clear band.
    for (const box of standBoxes('gantry').filter((each) => each.role === 'barrier')) {
      const inner = Math.abs(box.across) - box.width / 2;
      expect(inner).toBeGreaterThan(ROAD_WIDTH_METRES / 2);
      expect(inner + box.width).toBeLessThan(ROAD_WIDTH_METRES / 2 + SCATTER_VERGE_METRES);
    }
  });

  it('keeps every line’s barriers on road the frame draws', () => {
    const reach = Math.max(
      ...standBoxes('gantry').map((box) => Math.abs(box.along) + box.depth / 2),
    );
    expect(LINE_DRAW_AHEAD_METRES + reach).toBeLessThan(VIEW_AHEAD_METRES);
    expect(LINE_DRAW_BEHIND_METRES + reach).toBeLessThan(VIEW_BEHIND_METRES);
  });

  it('stands no barrier past either end of a point-to-point route — #902', () => {
    for (const route of [hillRoute(), valleyRoute(), unlooped(circuitRoute(200))]) {
      const total = route.totalDistance as number;
      let dropped = 0;
      for (const rider of [5, total - 5]) {
        for (const line of frameAt(route, rider).lines) {
          const kept = standBoxes(line.stand.kind).filter(
            (box) =>
              line.stand.distance + box.along >= 0 && line.stand.distance + box.along <= total,
          );
          expect(line.boxes).toHaveLength(kept.length);
          dropped += standBoxes(line.stand.kind).length - kept.length;
        }
      }
      // The start's barriers behind the line and the finish's beyond it: gone.
      expect(dropped).toBeGreaterThan(0);
    }
    // The control: a loop keeps every piece, on the road either side of its line.
    const loop = circuitRoute(200);
    for (const line of frameAt(loop, 5).lines) {
      expect(line.boxes).toHaveLength(standBoxes(line.stand.kind).length);
    }
  });

  describe('on a bend, every box stands clear of the DRAWN carriageway — #879', () => {
    type Point = { readonly x: number; readonly z: number };
    /** The least distance from a point to the frame's drawn centreline, as a polyline. */
    const fromCentre = (frame: ReturnType<typeof sceneFrame>, point: Point): number => {
      let least = Number.POSITIVE_INFINITY;
      const centre = frame.corridor.centre;
      for (let index = 0; index + 1 < centre.length; index += 1) {
        const a = centre[index] as CorridorPoint;
        const b = centre[index + 1] as CorridorPoint;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const squared = dx * dx + dz * dz;
        const t =
          squared === 0
            ? 0
            : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.z - a.z) * dz) / squared));
        least = Math.min(least, Math.hypot(point.x - (a.x + dx * t), point.z - (a.z + dz * t)));
      }
      return least;
    };
    /** A box's four footprint corners, in the frame it was placed in. */
    const corners = (placed: PlacedBox): Point[] =>
      [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ].map(([a = 0, b = 0]) => {
        const at = boxPoint(placed, placed.box.across + (a * placed.box.width) / 2, 0);
        return {
          x: at.x + placed.headingX * ((b * placed.box.depth) / 2),
          z: at.z + placed.headingZ * ((b * placed.box.depth) / 2),
        };
      });
    /** The same boxes as they were placed before #879's review: along the line's tangent. */
    const onTheTangent = (line: PlacedStand): PlacedBox[] =>
      standBoxes(line.stand.kind).map((box) => {
        const at = standPoint(line, 0, 0, box.along);
        return { box, x: at.x, y: at.y, z: at.z, headingX: line.headingX, headingZ: line.headingZ };
      });
    /** A hairpin's own points, from half-way round its bend: a start line in the bend. */
    const hairpinStart = (): RouteProfile => {
      const hairpin = hairpinRoute(20);
      const points: RoutePoint[] = hairpin.positions.map((position, index) => ({
        position,
        elevation: hairpin.elevations[index],
      }));
      // 40 straight points, then the arc: start a third of the way round it.
      return routeProfile(points.slice(44), { loop: false });
    };
    /** The worst inner face of any box, near any line of the route, both ways round. */
    const worst = (
      route: RouteProfile,
      boxesOf: (line: PlacedStand) => readonly PlacedBox[],
    ): number => {
      const total = route.totalDistance as number;
      let least = Number.POSITIVE_INFINITY;
      let looked = 0;
      // Just past a start, near a finish or a lap line, and a line at the far
      // end of its reach.
      for (const rider of [5, total - 30, total - LINE_DRAW_AHEAD_METRES + 1]) {
        const frame = frameAt(route, rider);
        for (const line of frame.lines.filter((each) => each.stand.kind === 'gantry')) {
          for (const placed of boxesOf(line)) {
            // Only what stands at the road's side: the beam spans it overhead.
            if (placed.box.width > ROAD_WIDTH_METRES) continue;
            looked += 1;
            for (const corner of corners(placed))
              least = Math.min(least, fromCentre(frame, corner));
          }
        }
      }
      expect(looked).toBeGreaterThan(0);
      return least;
    };
    const HALF = ROAD_WIDTH_METRES / 2;

    it.each([
      ['circuitRoute(200)', () => circuitRoute(200)],
      ['circuitRoute(100)', () => circuitRoute(100)],
      ['circuitRoute(60)', () => circuitRoute(60)],
      ['a start inside hairpinRoute(20)', hairpinStart],
    ])('on %s', (name, build) => {
      const route = build();
      const shipped = worst(route, (line) => line.boxes);
      console.info(
        `#679 ${name}: nearest box corner ${shipped.toFixed(2)} m from the drawn centreline`,
      );
      // Outside the carriageway. What this prints, measured 2026-09-30 (#902):
      // 3.75 m on circuitRoute(200), 3.67 m on (100), 3.57 m on (60) and
      // 3.65 m at the hairpin's start — against a 3.5 m half-width, so the
      // 60 m circuit clears by 7 cm. ⚠️ #879's pull request quoted 3.78,
      // 3.75, 3.59 and 3.72 m; those were not what this test printed.
      // ⚠️ Not the barrier's full 0.31 m inner
      // margin on the smallest loops: a loop shorter than the corridor is
      // drawn twice over, its near stretch from the smoothed 2 m pieces and
      // its far one from the route's own points, which on a 60 m circuit lie
      // about 0.2 m outside the smoothed line — and a barrier is measured
      // against both.
      expect(shipped).toBeGreaterThan(HALF);
    });

    it.each([200, 100])(
      'stands no finish barrier on the start road of a %s m circuit not ticked as a loop — #902',
      (length) => {
        // Past the finish there is no route, and a piece placed there ran
        // straight on — which on a closed route is where the start road is.
        // That road is drawn in the frame at the start, and the finish's
        // pieces in the frame near it; both in one world, from one origin.
        const route = unlooped(circuitRoute(length));
        const total = route.totalDistance as number;
        const startRoad = frameAt(route, 5);
        const finish = frameAt(route, total - 30).lines.filter(
          (line) => line.stand.kind === 'gantry' && line.stand.distance === total,
        );
        expect(finish).toHaveLength(1);
        let least = Number.POSITIVE_INFINITY;
        for (const placed of finish[0]!.boxes) {
          if (placed.box.width > ROAD_WIDTH_METRES) continue;
          for (const corner of corners(placed)) {
            least = Math.min(least, fromCentre(startRoad, corner));
          }
        }
        console.info(
          `#902 ${String(length)} m circuit, not a loop: nearest finish-barrier corner ${least.toFixed(2)} m from the start road's centreline`,
        );
        expect(least).toBeGreaterThan(HALF);
      },
    );

    it('and the tangent placement it replaced does not (the control)', () => {
      // The review's measurement, reproduced: a 60 m circuit put a barrier on
      // the centre line, and a 200 m one inside the lane.
      expect(worst(circuitRoute(60), onTheTangent)).toBeLessThan(HALF);
      expect(worst(circuitRoute(200), onTheTangent)).toBeLessThan(HALF);
      expect(worst(hairpinStart(), onTheTangent)).toBeLessThan(HALF);
    });
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
      line.boxes.map((placed) =>
        rectangle(
          boxPoint(placed, placed.box.across, 0),
          { x: -placed.headingZ, z: placed.headingX },
          { x: placed.headingX, z: placed.headingZ },
          placed.box.width / 2,
          placed.box.depth / 2,
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
    // The finish's pieces beyond the line are off the route, and are not drawn (#902).
    expect(belt.meshes.boxes.count).toBe(
      standBoxes('gantry').filter((box) => box.along <= 0).length,
    );
    // No atlas was handed over, so no banner: never a banner with no lettering.
    expect(belt.meshes.banners.visible).toBe(false);
    belt.update([]);
    expect(belt.meshes.boxes.visible).toBe(false);
    belt.dispose();
  });
});
