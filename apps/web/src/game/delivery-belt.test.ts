// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #1814's renderer half: `three-renderer.ts` §`DeliveryBelt` draws a Delivery
 * frame's parcels, markers and obstacles as three instanced meshes — one each,
 * whatever the count — and a marker's instance is gone the frame after its
 * house is delivered or missed, read back off the belt's own instance
 * matrices.
 *
 * What jsdom cannot do — draw, count three's calls, read a pixel — the
 * browser gate does: `delivery.browser.spec.ts`.
 */

import { describe, expect, it, vi } from 'vitest';

import { RIDER_HEIGHT_METRES } from './bicycle';
import {
  CAMERA_ABOVE_METRES,
  CAMERA_TARGET_AHEAD_METRES,
  cameraRig,
  MAXIMUM_FIELD_OF_VIEW_DEGREES,
  NEAR_PLANE_METRES,
  projectToFrame,
} from './camera';
import { deliveryInView } from './delivery/in-view';
import {
  OBSTACLE_KINDS,
  startObstacles,
  type Obstacle,
  type ObstacleKind,
} from './delivery/obstacles';
import { recordMiss, startRound, type Round } from './delivery/round';
import { MAILBOX_FROM_KERB_METRES, type DeliveryTarget } from './delivery/targets';
import {
  CARRIAGEWAY_HALF_WIDTH_METRES,
  MAILBOX_CATCH_RADIUS_METRES,
  NO_PARCELS,
  PARCEL_FLIGHT_TICKS,
  stepThrows,
  THROW_WINDOW_BEFORE_METRES,
  TARGET_CATCH_RADIUS_METRES,
  type ThrowState,
  type ThrowTarget,
} from './delivery/throw';
import type { DeliveryInView, DeliveryObstacleKind, DeliveryPiece } from './port';
import type { CorridorPoint } from './terrain';
import {
  DELIVERY_MARKER_TRIANGLES,
  DELIVERY_OBSTACLE_TRIANGLES,
  DELIVERY_PIECE_CAPACITY,
  DeliveryBelt,
  deliveryObstacleVertexDrawn,
  MARKER_MOST_SCALE,
  MARKER_DIAMOND_HEIGHTS,
  MARKER_TRUE_SIZE_WITHIN_METRES,
  markerScaleAt,
  RAIN_CLEAR_METRES,
  RAIN_COLOUR,
  RAIN_STREAK_METRES,
  RAIN_STREAK_WIDTH_METRES,
  RAIN_STREAKS,
  RAIN_TRIANGLES,
  type DeliveryPieceKind,
} from './three-renderer';
import { PEAK_IRRADIANCE } from './world';

const KINDS: readonly DeliveryPieceKind[] = ['parcels', 'markers', 'obstacles'];
/**
 * The kinds the view draws, in the renderer's order: every one of
 * `OBSTACLE_KINDS`, a car pulling out its own since #2506 (it was drawn as a
 * parked car, #2364).
 */
const ROSTER: readonly DeliveryObstacleKind[] = Object.keys(
  OBSTACLE_KINDS,
) as readonly ObstacleKind[];

/** `count` of each piece, a metre apart, every obstacle kind in turn. */
function pieces(count: number): DeliveryInView {
  const at = (index: number): DeliveryPiece => ({ x: index, y: 0, z: 2 * index, yaw: 0 });
  return {
    parcels: Array.from({ length: count }, (_, index) => at(index)),
    markers: Array.from({ length: count }, (_, index) => at(index)),
    obstacles: Array.from({ length: count }, (_, index) => ({
      ...at(index),
      kind: ROSTER[index % ROSTER.length] as DeliveryObstacleKind,
    })),
  };
}

/** A straight corridor due north from 0 m to 400 m, a point every 2 m. */
const CORRIDOR: { readonly centre: readonly CorridorPoint[] } = {
  centre: Array.from({ length: 201 }, (_, index): CorridorPoint => {
    const along = 2 * index;
    return { x: 0, y: 0, z: along, distance: along, along };
  }),
};

/** Two houses on the rider's right, east of the road: `−x` riding north. */
const TARGETS: readonly DeliveryTarget[] = [100, 160].map((distance, position) => ({
  position,
  distance,
  side: 1,
  fromRoad: CARRIAGEWAY_HALF_WIDTH_METRES + 1.5,
  kind: 'doorstep',
  x: -(CARRIAGEWAY_HALF_WIDTH_METRES + 1.5),
  y: 0.15,
  z: distance,
  yaw: -Math.PI / 2,
}));

/** The same houses as `throw.ts` reads them. */
const THROW_TARGETS: readonly ThrowTarget[] = TARGETS.map((target) => ({
  position: target.position,
  along: target.distance,
  side: 'right',
  clear: target.fromRoad - CARRIAGEWAY_HALF_WIDTH_METRES,
}));

function frame(round: Round, throws: ThrowState = NO_PARCELS): DeliveryInView {
  return deliveryInView({
    corridor: CORRIDOR,
    targets: TARGETS,
    round,
    throws,
    obstacles: [],
    obstacleState: startObstacles([]),
  });
}

/** Read back: is a marker drawn at `target`'s step? */
function markerOn(belt: DeliveryBelt, target: DeliveryTarget): boolean {
  return belt
    .drawn('markers')
    .some(
      (drawn) =>
        Math.abs(drawn.x - target.x) < 1e-6 &&
        Math.abs(drawn.y - target.y) < 1e-6 &&
        Math.abs(drawn.z - target.z) < 1e-6,
    );
}

/** A vertex of the obstacle geometry: where it is, whether it glows, and its paint's channels. */
interface ObstacleVertex {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly glows: boolean;
  readonly rgb: readonly [number, number, number];
}

/**
 * The vertices an instance of `kind` draws, by the rule its vertex shader
 * applies (`three-renderer.ts` §`deliveryObstacleVertexDrawn`, whose text the
 * shader test below holds): the rest collapse to the instance's origin.
 */
function drawnBy(belt: DeliveryBelt, kind: DeliveryObstacleKind): ObstacleVertex[] {
  const geometry = belt.meshOf('obstacles').geometry;
  const position = geometry.getAttribute('position');
  const kinds = geometry.getAttribute('oylPiece');
  const also = geometry.getAttribute('oylPieceAlso');
  const glow = geometry.getAttribute('oylGlow');
  const colour = geometry.getAttribute('color');
  const found: ObstacleVertex[] = [];
  for (let at = 0; at < position.count; at += 1) {
    if (!deliveryObstacleVertexDrawn(kinds.getX(at), also.getX(at), ROSTER.indexOf(kind))) continue;
    found.push({
      x: position.getX(at),
      y: position.getY(at),
      z: position.getZ(at),
      glows: glow.getX(at) === 1,
      rgb: [colour.getX(at), colour.getY(at), colour.getZ(at)],
    });
  }
  return found;
}

/** The bounding box of the vertices an instance of `kind` draws in the obstacle mesh's geometry. */
function kindBox(belt: DeliveryBelt, kind: DeliveryObstacleKind): { min: number[]; max: number[] } {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const vertex of drawnBy(belt, kind)) {
    const corner = [vertex.x, vertex.y, vertex.z];
    corner.forEach((value, axis) => {
      min[axis] = Math.min(min[axis] as number, value);
      max[axis] = Math.max(max[axis] as number, value);
    });
  }
  return { min, max };
}

describe('Delivery’s belt — #1814', () => {
  it('draws each kind of piece with ONE instanced mesh, the same mesh for one piece as for twenty', () => {
    const belt = new DeliveryBelt('stylised');
    const meshes = KINDS.map((what) => belt.meshOf(what));
    for (const mesh of meshes) {
      expect(mesh.isInstancedMesh).toBe(true);
      expect(mesh.instanceMatrix.count).toBe(DELIVERY_PIECE_CAPACITY);
      expect(mesh.castShadow).toBe(false);
      expect(mesh.receiveShadow).toBe(false);
      expect(mesh.material).not.toHaveProperty('transparent', true);
    }
    for (const count of [1, 20]) {
      belt.update(pieces(count));
      KINDS.forEach((what, index) => {
        expect(belt.meshOf(what)).toBe(meshes[index]);
        expect(belt.meshOf(what).count, what).toBe(count);
        expect(belt.meshOf(what).visible, what).toBe(true);
        expect(belt.drawn(what), what).toHaveLength(count);
      });
    }
    expect(belt.drawn('obstacles').map((drawn) => drawn.kind)).toEqual(
      pieces(20).obstacles.map((obstacle) => obstacle.kind),
    );
    belt.dispose();
  });

  it('draws nothing on a frame with no Delivery round, and nothing of a kind the frame holds none of', () => {
    const belt = new DeliveryBelt('realistic');
    belt.update(pieces(3));
    belt.update(undefined);
    for (const what of KINDS) {
      expect(belt.meshOf(what).visible, what).toBe(false);
      expect(belt.drawn(what), what).toEqual([]);
    }
    belt.update({ ...pieces(2), parcels: [] });
    expect(belt.meshOf('parcels').visible).toBe(false);
    expect(belt.meshOf('markers').visible).toBe(true);
    belt.setShown(false);
    belt.update(pieces(2));
    for (const what of KINDS) expect(belt.meshOf(what).visible, what).toBe(false);
    belt.dispose();
  });

  it('draws the first DELIVERY_PIECE_CAPACITY of each, and never a second mesh, when handed more', () => {
    const belt = new DeliveryBelt('stylised');
    belt.update(pieces(DELIVERY_PIECE_CAPACITY + 5));
    for (const what of KINDS) expect(belt.drawn(what), what).toHaveLength(DELIVERY_PIECE_CAPACITY);
    belt.dispose();
  });

  it('takes a marker off its house the frame after the house is delivered, read from the instances drawn', () => {
    const belt = new DeliveryBelt('stylised');
    const [first, second] = TARGETS as [DeliveryTarget, DeliveryTarget];
    let round = startRound(2);
    // The rider at 95 m, 10 m/s, throws right: the parcel reaches the doorstep 1.5 m off the
    // carriageway 0.5 s later, 5 m on, at the house.
    let throws = stepThrows(NO_PARCELS, {
      rider: { along: 95, speed: 10 },
      targets: THROW_TARGETS,
      round,
      throwTo: 'right',
      ticks: 0,
    }).state;
    belt.update(frame(round, throws));
    expect(markerOn(belt, first)).toBe(true);
    expect(markerOn(belt, second)).toBe(true);
    expect(belt.drawn('parcels')).toHaveLength(1);

    let delivered = false;
    for (let tick = 0; tick < PARCEL_FLIGHT_TICKS && !delivered; tick += 1) {
      const step = stepThrows(throws, {
        rider: { along: 95 + tick, speed: 10 },
        targets: THROW_TARGETS,
        round,
      });
      throws = step.state;
      round = step.round;
      delivered = step.landings.some((landing) => landing.kind === 'delivery');
      belt.update(frame(round, throws));
    }
    expect(delivered).toBe(true);
    expect(round.houses).toEqual(['delivered', 'expecting']);
    // The next frame: the delivered house's marker gone, the other's still standing, no parcel.
    expect(markerOn(belt, first)).toBe(false);
    expect(markerOn(belt, second)).toBe(true);
    expect(belt.drawn('markers')).toHaveLength(1);
    expect(belt.drawn('parcels')).toEqual([]);

    // And a miss takes the last one off.
    round = recordMiss(round, 1);
    belt.update(frame(round, throws));
    expect(markerOn(belt, second)).toBe(false);
    expect(belt.meshOf('markers').visible).toBe(false);
    belt.dispose();
  });

  it('draws each obstacle over its own collision box, standing on the road', () => {
    const belt = new DeliveryBelt('stylised');
    for (const kind of ROSTER) {
      const { min, max } = kindBox(belt, kind);
      const shape = OBSTACLE_KINDS[kind];
      // x across the road, y up, z along it (the piece's yaw is the road's heading).
      expect(min[0], kind).toBeCloseTo(-shape.halfWidth, 6);
      expect(max[0], kind).toBeCloseTo(shape.halfWidth, 6);
      expect(min[2], kind).toBeCloseTo(-shape.halfLength, 6);
      expect(max[2], kind).toBeCloseTo(shape.halfLength, 6);
      expect(min[1], kind).toBeCloseTo(0, 6);
      expect(max[1] as number, kind).toBeGreaterThan(0.5);
    }
    belt.dispose();
  });

  it('carries a glowing hazard marker over each bin, trolley, cone and moving hazard, above the rider’s helmet and out of the camera’s near reach, and none over a parked car — #2396, #2506', () => {
    const belt = new DeliveryBelt('stylised');
    // The frustum nearer than the near plane reaches this far above the eye
    // at the widest lens a frame opens, so a lower marker would be cut
    // through by a camera passing over the obstacle.
    const nearReach =
      CAMERA_ABOVE_METRES +
      NEAR_PLANE_METRES * Math.tan(((MAXIMUM_FIELD_OF_VIEW_DEGREES / 2) * Math.PI) / 180);
    for (const kind of ROSTER) {
      // The marker: what an instance of the kind draws glowing in the hazard's red.
      const marker = drawnBy(belt, kind).filter((vertex) => vertex.glows && isHazardRed(vertex));
      if (kind === 'parked-car') {
        // 1.8 m wide, never behind the rider: no sign over an ordinary parked car.
        expect(
          drawnBy(belt, kind).filter((vertex) => vertex.glows),
          kind,
        ).toEqual([]);
        continue;
      }
      expect(marker.length, kind).toBeGreaterThan(0);
      const lowest = Math.min(...marker.map((vertex) => vertex.y));
      expect(lowest, kind).toBeGreaterThan(RIDER_HEIGHT_METRES);
      expect(lowest, kind).toBeGreaterThan(nearReach);
    }
    belt.dispose();
  });

  it('marks a car pulling out with a hazard marker and lit amber indicators, and a parked car with neither, in frames drawn from the round — #2506', () => {
    // A parked car in the left kerb lane and, 40 m on, a car pulling out of
    // the right kerb, through the real view, the frame before it is set going
    // and four seconds after.
    const obstacles: Obstacle[] = [
      { kind: 'parked-car', along: 120, stands: -2.4 },
      { kind: 'car-pulling-out', along: 160, from: 'right', startAfter: 0, to: 2.4, rides: 0 },
    ];
    const waiting = startObstacles(obstacles);
    const going = { ...waiting, tick: 80, startedAt: [undefined, 0] };
    const belt = new DeliveryBelt('stylised');
    for (const obstacleState of [waiting, going]) {
      belt.update(
        deliveryInView({
          corridor: CORRIDOR,
          targets: [],
          round: startRound(1),
          throws: NO_PARCELS,
          obstacles,
          obstacleState,
        }),
      );
      const drawn = belt.drawn('obstacles');
      expect(drawn.map((each) => [each.kind, each.z])).toEqual([
        ['parked-car', 120],
        ['car-pulling-out', 160],
      ]);
      const [parked, pullingOut] = drawn.map((each) =>
        drawnBy(belt, each.kind as DeliveryObstacleKind),
      ) as [ObstacleVertex[], ObstacleVertex[]];
      // The parked car: no marker, no lit lamp.
      expect(parked.filter((vertex) => vertex.glows)).toEqual([]);
      // The car pulling out: the parked car's whole body, and its own marker overhead…
      expect(pullingOut.filter((vertex) => !vertex.glows)).toEqual(parked);
      const marker = pullingOut.filter((vertex) => vertex.glows && isHazardRed(vertex));
      expect(marker.length).toBeGreaterThan(0);
      expect(Math.min(...marker.map((vertex) => vertex.y))).toBeGreaterThan(RIDER_HEIGHT_METRES);
      // …and an amber indicator lit each side of its tail, which the rider behind it sees.
      const lamps = pullingOut.filter((vertex) => vertex.glows && !isHazardRed(vertex));
      expect(lamps.length).toBeGreaterThan(0);
      for (const lamp of lamps) {
        const [red, green, blue] = lamp.rgb;
        expect(red).toBeGreaterThan(green);
        expect(green).toBeGreaterThan(blue * 2);
        expect(lamp.y).toBeLessThan(1);
        expect(lamp.z).toBeLessThan(-2);
      }
      expect(lamps.some((lamp) => lamp.x < -0.4)).toBe(true);
      expect(lamps.some((lamp) => lamp.x > 0.4)).toBe(true);
    }
    belt.dispose();
  });

  it('draws a car pulling out’s hazard marker at least 24 px tall on a 1280×800 frame from the chase camera, the car 20 m ahead of the rider, and the small kinds’ marker is not — #2506', () => {
    // The owner's ruling of 2026-11-12: the marker was 8 to 10 px from 20 m.
    // The product's camera (camera.ts §cameraRig, §projectToFrame) on a level
    // straight, the rider at the origin heading +z, the car in their lane.
    const width = 1280;
    const height = 800;
    const rig = cameraRig({
      x: 0,
      y: 0,
      z: 0,
      headingX: 0,
      headingZ: 1,
      targetAheadMetres: CAMERA_TARGET_AHEAD_METRES,
      eyeRoadY: 0,
      targetRoadY: 0,
    });
    const belt = new DeliveryBelt('stylised');
    /** The marker's projected height in pixels, `kind`'s instance `metres` ahead of the rider. */
    const pixelsTall = (kind: DeliveryObstacleKind, metres: number): number => {
      const marker = drawnBy(belt, kind).filter((vertex) => vertex.glows && isHazardRed(vertex));
      expect(marker.length, kind).toBeGreaterThan(0);
      const tops = marker.map((vertex) => {
        const seen = projectToFrame(rig, width / height, {
          x: vertex.x,
          y: vertex.y,
          z: vertex.z + metres,
        });
        if (seen === undefined) throw new Error(`${kind}'s marker is not in front of the eye`);
        // In the frame, not off its edge.
        expect(seen.top).toBeGreaterThan(0);
        expect(seen.left).toBeGreaterThan(0);
        expect(seen.left).toBeLessThan(1);
        return seen.top * height;
      });
      return Math.max(...tops) - Math.min(...tops);
    };
    expect(pixelsTall('car-pulling-out', 20)).toBeGreaterThanOrEqual(24);
    expect(pixelsTall('car-pulling-out', 12)).toBeGreaterThanOrEqual(36);
    // The control: the small kinds' marker, the size the owner could not read,
    // is under the floor, so the floor tells the two apart.
    expect(pixelsTall('bin', 20)).toBeLessThan(12);
    belt.dispose();
  });

  it('turns a car pulling out’s indicators to face back, toward a rider behind it, not into its tail — #2506', () => {
    // The car's nose is along +z, so a rider behind it looks along +z at its
    // tail: a lamp is seen only if its triangles' front faces −z. The obstacle
    // material draws front faces alone, which three decides by winding, so
    // both the winding and the shading normal are read.
    const belt = new DeliveryBelt('stylised');
    const geometry = belt.meshOf('obstacles').geometry;
    const position = geometry.getAttribute('position');
    const normal = geometry.getAttribute('normal');
    const kinds = geometry.getAttribute('oylPiece');
    const glow = geometry.getAttribute('oylGlow');
    const colour = geometry.getAttribute('color');
    const pullingOut = ROSTER.indexOf('car-pulling-out');
    const corner = (at: number): [number, number, number] => [
      position.getX(at),
      position.getY(at),
      position.getZ(at),
    ];
    let lamps = 0;
    for (let at = 0; at < position.count; at += 3) {
      // A car pulling out's own lit part that is not its hazard marker: an indicator.
      const ownKind = Math.abs(kinds.getX(at) - pullingOut) < 0.5;
      const rgb: [number, number, number] = [colour.getX(at), colour.getY(at), colour.getZ(at)];
      const marker = isHazardRed({ x: 0, y: 0, z: 0, glows: true, rgb });
      if (!ownKind || glow.getX(at) !== 1 || marker) continue;
      lamps += 1;
      const [a, b, c] = [corner(at), corner(at + 1), corner(at + 2)];
      const [ux, uy] = [b[0] - a[0], b[1] - a[1]];
      const [vx, vy] = [c[0] - a[0], c[1] - a[1]];
      // The winding's normal, z component: (b − a) × (c − a).
      expect(ux * vy - uy * vx).toBeLessThan(0);
      for (const vertex of [at, at + 1, at + 2]) expect(normal.getZ(vertex)).toBeLessThan(0);
    }
    // Two indicators, one quad each.
    expect(lamps).toBe(4);
    belt.dispose();
  });

  it('stands a house marker’s glowing diamond 0.9 m across low on the step, its middle under a rider’s helmet — #2453, #2513', () => {
    const belt = new DeliveryBelt('stylised');
    const geometry = belt.meshOf('markers').geometry;
    const position = geometry.getAttribute('position');
    const glow = geometry.getAttribute('oylGlow');
    // #2365: a doorstep's marker, kind 0; a mailbox's and a no-delivery sign are their own.
    const kinds = geometry.getAttribute('oylPiece');
    const diamond = { xs: [] as number[], ys: [] as number[] };
    for (let at = 0; at < position.count; at += 1) {
      // The ring lies on the step, under 0.1 m; the diamond is the glowing part
      // above it. A house's alone (#2365): a mailbox's and a sign's glow too.
      if (kinds.getX(at) !== 0 || glow.getX(at) !== 1 || position.getY(at) < 0.3) continue;
      diamond.xs.push(position.getX(at));
      diamond.ys.push(position.getY(at));
    }
    const span = (values: readonly number[]): number => Math.max(...values) - Math.min(...values);
    // Until #2453, 0.4 m across: 2 pixels at 100 m.
    expect(span(diamond.xs)).toBeGreaterThanOrEqual(0.9 - 1e-6);
    // The heights the browser gate projects are the drawn diamond's own.
    expect(Math.min(...diamond.ys)).toBeCloseTo(MARKER_DIAMOND_HEIGHTS.bottom, 6);
    expect(Math.max(...diamond.ys)).toBeCloseTo(MARKER_DIAMOND_HEIGHTS.top, 6);
    expect((Math.min(...diamond.ys) + Math.max(...diamond.ys)) / 2).toBeCloseTo(
      MARKER_DIAMOND_HEIGHTS.middle,
      6,
    );
    // #2513: low. Its middle under the rider's helmet, and the whole of it under
    // the chase camera's eye, so enlarged about its foot it stays near the
    // horizon. Until #2513 its middle was 3.03 m up a 2.4 m post, and at 100 m
    // stood behind the tablet's top-right HUD panel.
    expect(MARKER_DIAMOND_HEIGHTS.middle).toBeLessThan(RIDER_HEIGHT_METRES);
    expect(MARKER_DIAMOND_HEIGHTS.top).toBeLessThan(CAMERA_ABOVE_METRES);
    belt.dispose();
  });

  it('draws a level’s rain round the eye only on a frame in rain, and none under prefers-reduced-motion — #2366', () => {
    const belt = new DeliveryBelt('stylised');
    const eye = { x: 3, y: 12, z: 40 };
    const pieces = { parcels: [], markers: [], obstacles: [] };
    belt.update({ ...pieces, weather: { rain: false, dusk: true } }, eye, 1);
    expect(belt.rainShown()).toBe(false);
    belt.update({ ...pieces, weather: { rain: true, dusk: false } }, eye, 1);
    expect(belt.rainShown()).toBe(true);
    belt.update(undefined, eye, 1);
    expect(belt.rainShown()).toBe(false);
    // The rider asked for reduced motion: no falling rain at all.
    const media = vi.fn((query: string) => ({ matches: query.includes('reduce') }));
    vi.stubGlobal('matchMedia', media);
    try {
      belt.update({ ...pieces, weather: { rain: true, dusk: false } }, eye, 1);
      expect(media).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');
      expect(belt.rainShown()).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
    belt.update({ ...pieces, weather: { rain: true, dusk: false } }, eye, 1);
    expect(belt.rainShown()).toBe(true);
    // Hidden with the belt.
    belt.setShown(false);
    expect(belt.rainShown()).toBe(false);
    belt.dispose();
  });

  it('draws heavier rain: 1 500 streaks 0.6 m long and 12 mm wide, each two crossed quads, in its one mesh — #2508', () => {
    // Written here, not read, so a change there is a red test and a line in the PR.
    expect(RAIN_STREAKS).toBe(1_500);
    expect(RAIN_STREAK_METRES).toBe(0.6);
    expect(RAIN_STREAK_WIDTH_METRES).toBe(0.012);
    const belt = new DeliveryBelt('stylised');
    const geometry = belt.rainGeometry();
    const position = geometry.getAttribute('position');
    // Unindexed: three corners a triangle, two triangles a quad, two quads a streak, laid out twice.
    expect(geometry.index).toBeNull();
    expect(position.count / 3).toBe(RAIN_TRIANGLES);
    expect(RAIN_TRIANGLES).toBe(RAIN_STREAKS * 2 * 2 * 2);
    // Read back, quad by quad: 0.6 m tall and 12 mm across, one across x and one across z.
    const quads = position.count / 6;
    let acrossX = 0;
    let acrossZ = 0;
    for (let quad = 0; quad < quads; quad += 1) {
      const xs: number[] = [];
      const ys: number[] = [];
      const zs: number[] = [];
      for (let corner = 0; corner < 6; corner += 1) {
        xs.push(position.getX(quad * 6 + corner));
        ys.push(position.getY(quad * 6 + corner));
        zs.push(position.getZ(quad * 6 + corner));
      }
      const span = (values: number[]): number => Math.max(...values) - Math.min(...values);
      expect(span(ys)).toBeCloseTo(RAIN_STREAK_METRES, 5);
      expect(Math.max(span(xs), span(zs))).toBeCloseTo(RAIN_STREAK_WIDTH_METRES, 5);
      expect(Math.min(span(xs), span(zs))).toBe(0);
      if (span(xs) > 0) acrossX += 1;
      else acrossZ += 1;
    }
    expect(acrossX).toBe(RAIN_STREAKS * 2);
    expect(acrossZ).toBe(RAIN_STREAKS * 2);
    belt.dispose();
  });

  it('lays no streak nearer the camera than RAIN_CLEAR_METRES across the ground, on any frame — PR #2522', () => {
    // Written here, not read, so a change there is a red test and a line in the PR.
    expect(RAIN_CLEAR_METRES).toBe(2.5);
    const belt = new DeliveryBelt('stylised');
    const view = { parcels: [], markers: [], obstacles: [], weather: { rain: true, dusk: false } };
    let nearest = Number.POSITIVE_INFINITY;
    const frames: readonly (readonly [{ x: number; y: number; z: number }, number])[] = [
      [{ x: 3, y: 12, z: 40 }, 0],
      [{ x: -250, y: 4, z: 1_200 }, 0.37],
      [{ x: 0, y: 0, z: 0 }, 9.9],
    ];
    for (const [eye, seconds] of frames) {
      belt.update(view, eye, seconds);
      expect(belt.rainShown()).toBe(true);
      const clearance = belt.rainClearanceFrom(eye);
      expect(clearance).toBeGreaterThanOrEqual(RAIN_CLEAR_METRES);
      nearest = Math.min(nearest, clearance);
    }
    // And the rain is still there round the clear circle, not pushed out of view.
    expect(nearest).toBeLessThan(RAIN_CLEAR_METRES + 0.5);
    belt.dispose();
  });

  it('lights the rain with the scene: its paint times the frame’s share of the route’s light — PR #2522', () => {
    const belt = new DeliveryBelt('stylised');
    const paint = [(RAIN_COLOUR >> 16) & 0xff, (RAIN_COLOUR >> 8) & 0xff, RAIN_COLOUR & 0xff].map(
      (channel) => {
        const c = channel / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      },
    );
    belt.setRainShare([1, 1, 1]);
    belt.rainColour().forEach((channel, at) => expect(channel).toBeCloseTo(paint[at] ?? 0, 6));
    const dusk = [0.3, 0.16, 0.12] as const;
    belt.setRainShare(dusk);
    belt
      .rainColour()
      .forEach((channel, at) => expect(channel).toBeCloseTo((paint[at] ?? 0) * (dusk[at] ?? 0), 6));
    // Each frame from the paint, never from the last frame's colour.
    belt.setRainShare(dusk);
    belt
      .rainColour()
      .forEach((channel, at) => expect(channel).toBeCloseTo((paint[at] ?? 0) * (dusk[at] ?? 0), 6));
    belt.dispose();
  });

  it('stands the rain on the road below the eye, falling from there, so it covers the view above the eye — #2366', () => {
    const belt = new DeliveryBelt('stylised');
    const eye = { x: 3, y: 12, z: 40 };
    const view = { parcels: [], markers: [], obstacles: [], weather: { rain: true, dusk: false } };
    // The camera rides 2 m above the road, so the foot of the box is at 10 m.
    belt.update(view, eye, 0);
    expect(belt.rainFootY()).toBeCloseTo(10, 6);
    // One second later it has fallen 8 m; the 20 m box still reaches above the eye.
    belt.update(view, eye, 1);
    expect(belt.rainFootY()).toBeCloseTo(2, 6);
    expect(belt.rainFootY() + 20).toBeGreaterThan(eye.y + 8);
    belt.dispose();
  });

  it('draws a mailbox and a house that must not get a parcel as markers of their own shapes, in the markers’ one mesh — #2365', () => {
    const belt = new DeliveryBelt('stylised');
    const geometry = belt.meshOf('markers').geometry;
    const position = geometry.getAttribute('position');
    const glow = geometry.getAttribute('oylGlow');
    const kinds = geometry.getAttribute('oylPiece');
    /** The highest vertex of marker kind `kind`, and whether any of its glowing parts lies on the step. */
    const shapeOf = (kind: number): { top: number; ringOnStep: boolean; vertices: number } => {
      let top = -Infinity;
      let ringOnStep = false;
      let vertices = 0;
      for (let at = 0; at < position.count; at += 1) {
        if (kinds.getX(at) !== kind) continue;
        vertices += 1;
        top = Math.max(top, position.getY(at));
        if (glow.getX(at) === 1 && position.getY(at) < 0.2) ringOnStep = true;
      }
      return { top, ringOnStep, vertices };
    };
    const [house, mailbox, skip] = [0, 1, 2].map(shapeOf);
    // Each its own shape: a mailbox lower than a doorstep's marker, a no-delivery sign with no ring on the step.
    // (#2365 held it a metre lower; the owner's ruling on PR #2518 holds it under the marker's top, below.)
    expect(house?.ringOnStep).toBe(true);
    expect(mailbox?.vertices).toBeGreaterThan(0);
    expect(mailbox?.top).toBeLessThan(house?.top ?? 0);
    expect(mailbox?.ringOnStep).toBe(true);
    expect(skip?.vertices).toBeGreaterThan(0);
    expect(skip?.ringOnStep).toBe(false);
    expect(skip?.top).toBeGreaterThan(2.4);
    // Drawn as the frame asks, in the one mesh, each instance its kind.
    belt.update({
      parcels: [],
      markers: [
        { x: 0, y: 0, z: 5, yaw: 0 },
        { x: 0, y: 0, z: 10, yaw: 0, kind: 'mailbox' },
        { x: 0, y: 0, z: 15, yaw: 0, kind: 'no-delivery' },
      ],
      obstacles: [],
    });
    expect(belt.drawn('markers').map((each) => each.kind)).toEqual([
      'house',
      'mailbox',
      'no-delivery',
    ]);
    expect(belt.meshOf('markers').count).toBe(3);
    belt.dispose();
  });

  it('draws a far house marker larger by its distance from the eye, its foot still on the step, and a near one at its true size — #2453', () => {
    // The numbers are written here, not read from three-renderer.ts, so changing them there fails this.
    expect(MARKER_TRUE_SIZE_WITHIN_METRES).toBe(20);
    expect(MARKER_MOST_SCALE).toBe(6);
    expect([0, 10, 20, 40, 100, 120, 400, Number.NaN].map(markerScaleAt)).toEqual([
      1, 1, 1, 2, 5, 6, 6, 1,
    ]);
    const belt = new DeliveryBelt('stylised');
    // Markers 10 m, 60 m, 100 m and 300 m north of an eye at the origin, 3 m to its side.
    const markers = [10, 60, 100, 300].map((z) => ({ x: 3, y: 0.25, z, yaw: 0 }));
    const view: DeliveryInView = {
      parcels: markers,
      markers,
      obstacles: markers.map((marker) => ({ ...marker, kind: 'bin' as const })),
    };
    belt.update(view, { x: 0, z: 0 });
    const drawn = belt.drawn('markers');
    expect(drawn.map((each) => Number(each.scale.toFixed(3)))).toEqual([
      1,
      Number(markerScaleAt(Math.hypot(3, 60)).toFixed(3)),
      Number(markerScaleAt(Math.hypot(3, 100)).toFixed(3)),
      MARKER_MOST_SCALE,
    ]);
    // Its foot is where it was handed: scaled about the step, not moved.
    drawn.forEach((each, index) => {
      const marker = markers[index] as DeliveryPiece;
      expect([each.x, each.y, each.z]).toEqual([marker.x, marker.y, marker.z]);
    });
    // Only the markers: a parcel in flight and an obstacle are the size they are.
    for (const what of ['parcels', 'obstacles'] as const) {
      expect(belt.drawn(what).map((each) => Number(each.scale.toFixed(6)))).toEqual([1, 1, 1, 1]);
    }
    // With no eye, every marker is its true size.
    belt.update(view);
    expect(belt.drawn('markers').map((each) => Number(each.scale.toFixed(6)))).toEqual([
      1, 1, 1, 1,
    ]);
    belt.dispose();
  });

  it('places an obstacle the frame hands it, by its kind, on the instance it is drawn with', () => {
    const belt = new DeliveryBelt('stylised');
    const obstacles: Obstacle[] = ROSTER.map((kind, index) => ({
      kind,
      along: 100 + 50 * index,
      from: 'left',
      startAfter: 0,
    }));
    belt.update(
      deliveryInView({
        corridor: CORRIDOR,
        targets: [],
        round: startRound(1),
        throws: NO_PARCELS,
        obstacles,
        obstacleState: startObstacles(obstacles),
      }),
    );
    const drawn = belt.drawn('obstacles');
    expect(drawn.map((each) => each.kind)).toEqual([...ROSTER]);
    expect(drawn.map((each) => each.z)).toEqual(obstacles.map((each) => each.along));
    const kinds = belt.meshOf('obstacles').geometry.getAttribute('oylObstacle');
    expect([0, 1, 2].map((at) => kinds.getW(at))).toEqual([0, 1, 2]);
    belt.dispose();
  });

  it('marks every instance buffer it rewrites for upload, on every frame that carries pieces', () => {
    // `drawn()` reads the CPU copy, which three never uploads on its own: only a
    // rise in `version` sends the rewritten instances to the GPU.
    const belt = new DeliveryBelt('stylised');
    const view = pieces(3);
    const versions = (): number[] => [
      belt.meshOf('parcels').instanceMatrix.version,
      belt.meshOf('markers').instanceMatrix.version,
      belt.meshOf('obstacles').instanceMatrix.version,
      (belt.meshOf('obstacles').geometry.getAttribute('oylObstacle') as { version: number })
        .version,
    ];
    const start = versions();
    belt.update(view);
    const first = versions();
    belt.update({ ...view, markers: view.markers.slice(1) });
    const second = versions();
    first.forEach((each, at) => expect(each).toBeGreaterThan(start[at] as number));
    second.forEach((each, at) => expect(each).toBeGreaterThan(first[at] as number));
    belt.dispose();
  });

  it('shades by the rung in the stylised world, and wears one physically based material in the realistic', () => {
    const stylised = new DeliveryBelt('stylised');
    stylised.setShading('flat');
    for (const what of KINDS) {
      expect((stylised.meshOf(what).material as { type: string }).type).toBe('MeshBasicMaterial');
    }
    stylised.setShading('lit');
    for (const what of KINDS) {
      expect((stylised.meshOf(what).material as { type: string }).type).toBe('MeshLambertMaterial');
    }
    const realistic = new DeliveryBelt('realistic');
    for (const shading of ['flat', 'lit'] as const) {
      realistic.setShading(shading);
      for (const what of KINDS) {
        expect((realistic.meshOf(what).material as { type: string }).type).toBe(
          'MeshStandardMaterial',
        );
      }
    }
    stylised.dispose();
    realistic.dispose();
  });

  for (const world of ['stylised', 'realistic'] as const) {
    it(`collapses every obstacle vertex not of the instance’s kind, in the ${world} world’s programs`, () => {
      const belt = new DeliveryBelt(world);
      for (const shading of ['lit', 'flat'] as const) {
        belt.setShading(shading);
        const material = belt.meshOf('obstacles').material as unknown as Compilable;
        const shader = compiled(material);
        expect(shader.vertexShader).toContain('attribute vec4 oylPiece;');
        expect(shader.vertexShader).toContain('attribute vec4 oylObstacle;');
        expect(shader.vertexShader).toContain('attribute vec2 oylPieceAlso;');
        // #2506: a vertex of the instance's kind, or of the kind it also belongs to.
        const collapse = shader.vertexShader.indexOf(
          'transformed *= max( 1.0 - step( 0.5, abs( oylPiece.x - oylObstacle.w ) ), 1.0 - step( 0.5, abs( oylPieceAlso.x - oylObstacle.w ) ) );',
        );
        expect(collapse).toBeGreaterThan(shader.vertexShader.indexOf('#include <begin_vertex>'));
        // The paint mix reads the painted flag (y), not the car part (z): PR #2548 review.
        expect(shader.vertexShader).toContain(
          'vColor.xyz = mix( vColor.xyz, oylObstacle.xyz, oylPiece.y );',
        );
        expect(material.customProgramCacheKey()).toContain('oyl-delivery-kinds');
        // The parcels' program is not taught it: a parcel carries no kind. The
        // markers' is, since #2365: a doorstep's, a mailbox's and a no-delivery sign.
        const plain = belt.meshOf('parcels').material as unknown as Compilable;
        expect(compiled(plain).vertexShader).not.toContain('oylObstacle');
        belt.setShading(shading);
        const markers = belt.meshOf('markers').material as unknown as Compilable;
        // The obstacles' program (#2506's second kind): a marker's is −1, so
        // only its own kind's instance draws it.
        expect(compiled(markers).vertexShader).toContain(
          'transformed *= max( 1.0 - step( 0.5, abs( oylPiece.x - oylObstacle.w ) ), 1.0 - step( 0.5, abs( oylPieceAlso.x - oylObstacle.w ) ) );',
        );
      }
      belt.dispose();
    });
  }

  it('says which instances draw a vertex as the shader does: its own kind, and the kind it also belongs to — #2506', () => {
    // `step( 0.5, abs( a - b ) )` is 0 within half a kind of `b`, so the vertex stays.
    expect(deliveryObstacleVertexDrawn(3, -1, 3)).toBe(true);
    expect(deliveryObstacleVertexDrawn(3, 5, 5)).toBe(true);
    expect(deliveryObstacleVertexDrawn(3, 5, 4)).toBe(false);
    expect(deliveryObstacleVertexDrawn(5, -1, 3)).toBe(false);
    expect(deliveryObstacleVertexDrawn(0, -1, 0)).toBe(true);
    expect(deliveryObstacleVertexDrawn(0, -1, 1)).toBe(false);
  });

  it('lights no lit part past white, and glows only the marker’s diamond and ring, and each obstacle’s hazard marker overhead (#2396)', () => {
    const belt = new DeliveryBelt('stylised');
    let lit = 0;
    let glowing = 0;
    for (const what of KINDS) {
      const geometry = belt.meshOf(what).geometry;
      const colour = geometry.getAttribute('color');
      const glow = geometry.getAttribute('oylGlow');
      const position = geometry.getAttribute('position');
      const kinds = what === 'obstacles' ? geometry.getAttribute('oylPiece') : undefined;
      for (let at = 0; at < colour.count; at += 1) {
        if (glow.getX(at) === 1) {
          glowing += 1;
          expect(what).not.toBe('parcels');
          // An obstacle's body does not glow: only the marker over the rider's
          // helmet does, and a car pulling out's indicators (#2506), which are its alone.
          if (what === 'obstacles' && position.getY(at) <= RIDER_HEIGHT_METRES) {
            expect(kinds?.getX(at)).toBe(ROSTER.indexOf('car-pulling-out'));
          }
          continue;
        }
        lit += 1;
        for (const channel of [colour.getX(at), colour.getY(at), colour.getZ(at)]) {
          expect(channel * PEAK_IRRADIANCE, what).toBeLessThanOrEqual(1);
        }
      }
    }
    expect(lit).toBeGreaterThan(0);
    expect(glowing).toBeGreaterThan(0);
    belt.dispose();
  });
});

/** Whether a vertex wears the hazard marker's red (`three-renderer.ts` §`DELIVERY_PAINT.hazard`, 0xe8432f), linear. */
function isHazardRed(vertex: ObstacleVertex): boolean {
  const [red, green, blue] = vertex.rgb;
  return red > 0.7 && green < 0.08 && blue < 0.04;
}

/** A material as the belt holds it: what the suite calls on it. @see compiled */
interface Compilable {
  onBeforeCompile(shader: unknown, renderer: unknown): void;
  customProgramCacheKey(): string;
}

/**
 * Runs a material's `onBeforeCompile` over a shader holding every chunk the
 * belt's splices and the realistic air's look for, as the renderer would —
 * `decoration-belt.test.ts`' shape, since nothing here may import three.
 */
function compiled(material: Compilable): {
  readonly vertexShader: string;
  readonly fragmentShader: string;
} {
  const shader = {
    vertexShader: [
      '#include <common>',
      '#include <fog_pars_vertex>',
      'void main() {',
      '#include <begin_vertex>',
      '#include <color_vertex>',
      '#include <fog_vertex>',
      '}',
    ].join('\n'),
    fragmentShader: [
      '#include <common>',
      '#include <fog_pars_fragment>',
      'void main() {',
      // three's own order (ShaderLib's mesh programs, r18x).
      '#include <opaque_fragment>',
      '#include <tonemapping_fragment>',
      '#include <colorspace_fragment>',
      '#include <fog_fragment>',
      '}',
    ].join('\n'),
    uniforms: {} as Record<string, { value: unknown }>,
    defines: {},
  };
  material.onBeforeCompile(shader, undefined);
  return shader;
}

describe('a parked car looks like one — #2362, the owner’s ruling on PR #2378', () => {
  /** Every vertex of the car of kind number `kind`: where it is, and its paint as its vertex colour's three channels. */
  function carVertices(
    belt: DeliveryBelt,
    kind: number,
  ): { readonly x: number; readonly y: number; readonly z: number; readonly paint: string }[] {
    const geometry = belt.meshOf('obstacles').geometry;
    const position = geometry.getAttribute('position');
    const colour = geometry.getAttribute('color');
    const kinds = geometry.getAttribute('oylPiece');
    const found = [];
    for (let at = 0; at < position.count; at += 1) {
      if (kinds.getX(at) !== kind) continue;
      found.push({
        x: position.getX(at),
        y: position.getY(at),
        z: position.getZ(at),
        paint: [colour.getX(at), colour.getY(at), colour.getZ(at)].join(','),
      });
    }
    return found;
  }

  const CAR_KIND = ROSTER.indexOf('parked-car');

  it('draws a car’s outline: its cabin narrower at the roof than at its base, its wheels showing in arches', () => {
    const belt = new DeliveryBelt('stylised');
    const car = carVertices(belt, CAR_KIND);
    expect(car.length).toBeGreaterThan(0);
    const tall = Math.max(...car.map((each) => each.y));
    expect(tall).toBeGreaterThan(1.3);
    // A cabin, not a box: its roof is shorter along the road than the body under it…
    const roof = car.filter((each) => each.y > tall - 0.1);
    const roofLength =
      Math.max(...roof.map((each) => each.z)) - Math.min(...roof.map((each) => each.z));
    const cabinBase = car.filter((each) => each.y > 0.85 && each.y < 0.95);
    const baseLength =
      Math.max(...cabinBase.map((each) => each.z)) - Math.min(...cabinBase.map((each) => each.z));
    expect(roofLength).toBeLessThan(0.6 * baseLength);
    // …and the bonnet and the boot are low: nothing at either end stands near the roof.
    const ends = car.filter((each) => Math.abs(each.z) > 1.8);
    expect(Math.max(...ends.map((each) => each.y))).toBeLessThan(0.75 * tall);
    // Its wheels show from the side: over each wheel, nothing but the wheel below its top.
    // The wheels are the paint of the car's lowest point, on the road.
    const lowest = car.reduce((low, each) => (each.y < low.y ? each : low));
    const BLACK = lowest.paint;
    const wheels = car.filter((each) => each.paint === BLACK);
    expect(Math.min(...wheels.map((each) => each.y))).toBeCloseTo(0, 6);
    const wheelTop = Math.max(...wheels.map((each) => each.y));
    // The body is the car's most-used paint; over each wheel it is cut away to the arch.
    const counts = new Map<string, number>();
    for (const each of car) counts.set(each.paint, (counts.get(each.paint) ?? 0) + 1);
    const body = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    for (const along of [-1.35, 1.38]) {
      const over = car.filter((each) => each.paint === body && Math.abs(each.z - along) < 0.15);
      expect(over.length, `over the wheel at ${String(along)}`).toBeGreaterThan(0);
      expect(
        Math.min(...over.map((each) => each.y)),
        `over the wheel at ${String(along)}`,
      ).toBeGreaterThan(wheelTop);
    }
    belt.dispose();
  });

  it('rounds the car: its body curves and its edges are rounded, not a few flat faces (round 5)', () => {
    const belt = new DeliveryBelt('stylised');
    const geometry = belt.meshOf('obstacles').geometry;
    const normal = geometry.getAttribute('normal');
    const kinds = geometry.getAttribute('oylPiece');
    const facing = new Set<string>();
    for (let at = 0; at < normal.count; at += 1) {
      if (kinds.getX(at) !== CAR_KIND) continue;
      facing.add(
        [normal.getX(at), normal.getY(at), normal.getZ(at)]
          .map((each) => each.toFixed(2))
          .join(','),
      );
    }
    // A box faces six ways; stacked boxes a few dozen at most.
    expect(facing.size).toBeGreaterThan(200);
    belt.dispose();
  });

  it('paints its cars in three body colours from ONE car in the geometry, each instance its own paint by its place on the round (round 6)', () => {
    const belt = new DeliveryBelt('stylised');
    const geometry = belt.meshOf('obstacles').geometry;
    // One car: every vertex's kind is one of the drawn roster's, none a second
    // or third car — #2506's car pulling out draws this one, and of its own
    // holds only its marker and its two indicators, 8 + 2 × 2 triangles.
    const kinds = geometry.getAttribute('oylPiece');
    const seen = new Set<number>();
    let pullingOutOwn = 0;
    for (let at = 0; at < kinds.count; at += 1) {
      seen.add(kinds.getX(at));
      if (kinds.getX(at) === ROSTER.indexOf('car-pulling-out')) pullingOutOwn += 1;
    }
    expect([...seen].sort()).toEqual(ROSTER.map((_, index) => index));
    expect(pullingOutOwn / 3).toBe(8 + 2 * 2);
    // Its body, and only its body, takes the instance's paint.
    const painted = geometry.getAttribute('oylPiece');
    const car = carVertices(belt, CAR_KIND);
    const counts = new Map<string, number>();
    for (const each of car) counts.set(each.paint, (counts.get(each.paint) ?? 0) + 1);
    const body = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    let paintedBody = 0;
    for (let at = 0; at < painted.count; at += 1) {
      if (painted.getY(at) !== 1) continue;
      expect(kinds.getX(at)).toBe(CAR_KIND);
      paintedBody += 1;
    }
    expect(paintedBody).toBe(car.filter((each) => each.paint === body).length);

    const cars = [0, 1, 2, 3, 4].map((index) => ({
      x: 0,
      y: 0,
      z: 10 * index,
      yaw: 0,
      kind: 'parked-car' as const,
      index,
    }));
    belt.update({ parcels: [], markers: [], obstacles: cars });
    expect(belt.drawn('obstacles').map((each) => each.paint)).toEqual([0, 1, 2, 0, 1]);
    expect(belt.drawn('obstacles').every((each) => each.kind === 'parked-car')).toBe(true);
    // The instances' paints, as uploaded: three different colours, the fourth the first's.
    const paints = geometry.getAttribute('oylObstacle');
    const rgb = (at: number): string =>
      [paints.getX(at), paints.getY(at), paints.getZ(at)].map((each) => each.toFixed(4)).join(',');
    expect(new Set([0, 1, 2].map(rgb)).size).toBe(3);
    expect(rgb(3)).toBe(rgb(0));
    // The same car, a frame later and the first off the road: still its own paint.
    belt.update({ parcels: [], markers: [], obstacles: cars.slice(1) });
    expect(belt.drawn('obstacles').map((each) => each.paint)).toEqual([1, 2, 0, 1]);
    // #2506: a car pulling out draws this car's body, so it wears a paint too, by its place.
    belt.update({
      parcels: [],
      markers: [],
      obstacles: [
        { x: 0, y: 0, z: 0, yaw: 0, kind: 'car-pulling-out', index: 2 },
        { x: 0, y: 0, z: 10, yaw: 0, kind: 'parked-car', index: 1 },
      ],
    });
    expect(belt.drawn('obstacles').map((each) => [each.kind, each.paint])).toEqual([
      ['car-pulling-out', 2],
      ['parked-car', 1],
    ]);
    expect(rgb(0)).not.toBe(rgb(1));
    belt.dispose();
  });

  it('stands the car on its tyres with its body clear of the road, so it reads as a car from in front (round 6)', () => {
    // The lowest point is a tyre's, at the road; away from the wheels nothing of
    // the car is below 0.22 m, which is what lets the browser gate's kind probe see
    // under it. (A ten-sided tyre has no corner straight down, and fitted to the
    // road it sank the whole car by 16 mm, round 6's finding.)
    const belt = new DeliveryBelt('stylised');
    const car = carVertices(belt, CAR_KIND);
    const lowest = car.reduce((low, each) => (each.y < low.y ? each : low));
    expect(lowest.y).toBeCloseTo(0, 6);
    // Away from the wheels (their tyres and rims), along the car's whole width.
    const between = car.filter((each) =>
      [-1.31, 1.34].every((wheel) => Math.abs(each.z - wheel) > 0.4),
    );
    expect(Math.min(...between.map((each) => each.y))).toBeGreaterThan(0.22);
    belt.dispose();
  });

  it('holds the obstacle geometry to its triangle budget, which every obstacle instance submits (round 6)', () => {
    // The kind collapse is per vertex, so EVERY obstacle instance, a bin's or a
    // cone's too, runs every kind's triangles through the vertex shader. Round 5
    // held three whole cars (4 526); one painted car is 1 522: bin 88, trolley
    // 124, cone 42 and the car 1 268, and #2396 adds 8 for each of three hazard
    // markers, 1 546. #2364 adds a dog (72) and another rider (124), each with
    // a marker, 1 758, and raises this bound from 1 600 to 1 800 for the
    // owner's approval in its pull request. #2506 adds a car pulling out's
    // marker (8) and two one-quad indicators (4), 1 770, inside that bound,
    // and then, on the owner's ruling of 2026-11-12 that the village frame
    // stay under 205 000 triangles, trims the car's rims to one outward disc
    // each (32 to 8), 1 674; its tyres stay round in 12 (above). PR #2518's
    // trim, when its markers met these: no face looking straight down from
    // under the eye, 76 fewer, 1 598. A change
    // past this is for the owner and the tablet (#733), not a quiet drift.
    const belt = new DeliveryBelt('stylised');
    const position = belt.meshOf('obstacles').geometry.getAttribute('position');
    expect(position.count / 3).toBe(DELIVERY_OBSTACLE_TRIANGLES);
    expect(DELIVERY_OBSTACLE_TRIANGLES).toBeLessThanOrEqual(1_800);
    belt.dispose();
  });
});

describe('a mailbox reads from where its throw window opens — #2507, the owner’s ruling on PR #2500', () => {
  /** The owner's tablet, 1280×800. */
  const TABLET = { width: 1280, height: 800 } as const;
  /** The markers' kind number of a mailbox (`three-renderer.ts` §`DELIVERY_MARKER_ORDER`). */
  const MAILBOX = 1;

  /** Every vertex of the mailbox marker, as the belt's geometry holds it: where, glowing or not, and how dark its paint. */
  function mailboxVertices(belt: DeliveryBelt): {
    readonly x: number;
    readonly y: number;
    readonly z: number;
    readonly glows: boolean;
    readonly dark: boolean;
    readonly pale: boolean;
    readonly rgb: readonly [number, number, number];
    readonly untoned: boolean;
  }[] {
    return markerVertices(belt, MAILBOX);
  }

  /** Every vertex of marker kind `kind`, as {@link mailboxVertices} reads a mailbox's. */
  function markerVertices(
    belt: DeliveryBelt,
    kind: number,
  ): {
    readonly x: number;
    readonly y: number;
    readonly z: number;
    readonly glows: boolean;
    readonly dark: boolean;
    readonly pale: boolean;
    readonly rgb: readonly [number, number, number];
    readonly untoned: boolean;
  }[] {
    const geometry = belt.meshOf('markers').geometry;
    const position = geometry.getAttribute('position');
    const colour = geometry.getAttribute('color');
    const glow = geometry.getAttribute('oylGlow');
    const kinds = geometry.getAttribute('oylPiece');
    // #2507's untoned flag, packed in the second piece attribute's `y` (#2540's slots).
    const untoned = geometry.getAttribute('oylPieceAlso');
    const found = [];
    for (let at = 0; at < position.count; at += 1) {
      if (kinds.getX(at) !== kind) continue;
      const rgb = [colour.getX(at), colour.getY(at), colour.getZ(at)] as const;
      found.push({
        x: position.getX(at),
        y: position.getY(at),
        z: position.getZ(at),
        glows: glow.getX(at) === 1,
        // The box's slate paint; the post is pale, the flag red, and the diamond and ring glow.
        dark: Math.max(...rgb) < 0.3,
        pale: Math.min(...rgb) > 0.5,
        rgb,
        untoned: untoned.getY(at) === 1,
      });
    }
    return found;
  }

  const span = (values: readonly number[]): number => Math.max(...values) - Math.min(...values);

  it('draws a bigger box on its post, under a bigger glowing diamond and inside a bigger ring, read back from the geometry', () => {
    const belt = new DeliveryBelt('stylised');
    const mailbox = mailboxVertices(belt);
    const box = mailbox.filter((each) => each.dark);
    const post = mailbox.filter((each) => each.pale && !each.glows);
    const diamond = mailbox.filter((each) => each.glows && each.y > 0.2);
    const ring = mailbox.filter((each) => each.glows && each.y <= 0.2);
    // Until #2507: a 0.27 m × 0.27 m × 0.45 m box on a 1 m post 0.08 m thick, a 0.45 m diamond and a 0.28 m ring.
    expect(span(box.map((each) => each.x))).toBeCloseTo(0.54, 6);
    expect(span(box.map((each) => each.y))).toBeCloseTo(0.54, 6);
    expect(span(box.map((each) => each.z))).toBeCloseTo(0.9, 6);
    // The box sits on the post's head, and the post is sturdier than a doorstep's 0.08 m.
    // Since the owner's second ruling on PR #2518, a 0.5 m post (1 m before) and a 0.5 m diamond (0.72 m).
    expect(Math.max(...post.map((each) => each.y))).toBeCloseTo(0.5, 6);
    expect(span(post.map((each) => each.x))).toBeCloseTo(0.14, 6);
    expect(Math.min(...box.map((each) => each.y))).toBeCloseTo(0.5, 6);
    expect(span(diamond.map((each) => each.x))).toBeCloseTo(0.5, 6);
    // The ring's outer span: twice its 0.42 m radius plus the 0.03 m band.
    expect(span(ring.map((each) => each.x))).toBeCloseTo(0.9, 6);
    belt.dispose();
  });

  it('stands the whole mailbox, its diamond too, below a house marker’s top, #2530’s 1.86 m — the owner’s second ruling on PR #2518', () => {
    const belt = new DeliveryBelt('stylised');
    const top = (kind: number): number =>
      Math.max(...markerVertices(belt, kind).map((each) => each.y));
    const mailbox = top(MAILBOX);
    // Under it by a margin a reader sees: at least 0.05 m, under #2530's
    // stated top and under the drawn marker's, so a later change to either
    // is checked here.
    expect(MARKER_DIAMOND_HEIGHTS.top).toBeCloseTo(1.86, 6);
    expect(mailbox).toBeLessThanOrEqual(MARKER_DIAMOND_HEIGHTS.top - 0.05);
    expect(mailbox).toBeLessThanOrEqual(top(0) - 0.05);
    // 2.65 m until this ruling: over a 1.86 m house marker.
    expect(mailbox).toBeCloseTo(1.79, 6);
    // Every glowing part of the diamond lies under it too.
    const diamond = mailboxVertices(belt).filter((each) => each.glows && each.y > 0.2);
    expect(diamond.length).toBeGreaterThan(0);
    expect(Math.max(...diamond.map((each) => each.y))).toBeLessThanOrEqual(
      MARKER_DIAMOND_HEIGHTS.top - 0.05,
    );
    belt.dispose();
  });

  it('holds the markers’ geometry to its triangle count, which every marker instance submits — #2507', () => {
    const belt = new DeliveryBelt('stylised');
    const geometry = belt.meshOf('markers').geometry;
    const position = geometry.getAttribute('position');
    const kinds = geometry.getAttribute('oylPiece');
    const perKind = [0, 0, 0];
    for (let at = 0; at < position.count; at += 1) {
      const kind = kinds.getX(at);
      perKind[kind] = (perKind[kind] ?? 0) + 1;
    }
    expect(position.count / 3).toBe(DELIVERY_MARKER_TRIANGLES);
    // A doorstep's 42, a mailbox's 78, a no-delivery sign's 54: its torus (72) a flat
    // ring (32), and PR #2518's trim, no face looking down from under the eye (2, 6, 2).
    expect(perKind.map((each) => each / 3)).toEqual([42, 78, 54]);
    expect(DELIVERY_MARKER_TRIANGLES).toBeLessThanOrEqual(174);
    belt.dispose();
  });

  it('draws no face of an obstacle or a marker that looks straight down from under the eye, and keeps a parcel’s — PR #2518’s trim', () => {
    // Seen from the chase camera's eye, CAMERA_ABOVE_METRES over the road, such
    // a face is always seen from behind and culled: it cost a triangle a frame
    // for no pixel. A parcel flies and turns, so it keeps its own (the control).
    const undersides = (belt: DeliveryBelt, what: 'obstacles' | 'markers' | 'parcels'): number => {
      const position = belt.meshOf(what).geometry.getAttribute('position');
      let count = 0;
      for (let at = 0; at < position.count; at += 3) {
        const [ax, ay, az] = [position.getX(at), position.getY(at), position.getZ(at)];
        const [ux, uy, uz] = [
          position.getX(at + 1) - ax,
          position.getY(at + 1) - ay,
          position.getZ(at + 1) - az,
        ];
        const [vx, vy, vz] = [
          position.getX(at + 2) - ax,
          position.getY(at + 2) - ay,
          position.getZ(at + 2) - az,
        ];
        const ny = uz * vx - ux * vz;
        const length = Math.hypot(uy * vz - uz * vy, ny, ux * vy - uy * vx);
        const highest = Math.max(ay, position.getY(at + 1), position.getY(at + 2));
        if (ny / length < -0.99 && highest < CAMERA_ABOVE_METRES) count += 1;
      }
      return count;
    };
    for (const world of ['stylised', 'realistic'] as const) {
      const belt = new DeliveryBelt(world);
      expect(undersides(belt, 'obstacles'), world).toBe(0);
      expect(undersides(belt, 'markers'), world).toBe(0);
      expect(undersides(belt, 'parcels'), world).toBeGreaterThan(0);
      belt.dispose();
    }
  });

  it('draws a no-delivery sign’s ring with a face toward a rider coming either way along the road — #2507', () => {
    // The markers' materials draw front faces only. A house's yaw turns toward
    // the road, so a sign on the far side of the road shows an oncoming rider
    // what its twin on the near side shows a rider leaving.
    const belt = new DeliveryBelt('stylised');
    const geometry = belt.meshOf('markers').geometry;
    const position = geometry.getAttribute('position');
    const glow = geometry.getAttribute('oylGlow');
    const kinds = geometry.getAttribute('oylPiece');
    /** The sign's glowing triangles' facings along its local x, +1 or −1; one edge-on is left out. */
    const facings: number[] = [];
    for (let at = 0; at < position.count; at += 3) {
      if (kinds.getX(at) !== 2 || glow.getX(at) !== 1) continue;
      // The winding's normal's x, from the corners' (y, z): which way the triangle's front faces.
      const uy = position.getY(at + 1) - position.getY(at);
      const uz = position.getZ(at + 1) - position.getZ(at);
      const vy = position.getY(at + 2) - position.getY(at);
      const vz = position.getZ(at + 2) - position.getZ(at);
      const normalX = uy * vz - uz * vy;
      if (Math.abs(normalX) > 1e-9) facings.push(Math.sign(normalX));
    }
    const forward = facings.filter((each) => each > 0).length;
    const back = facings.filter((each) => each < 0).length;
    expect(forward).toBeGreaterThan(0);
    expect(forward).toBe(back);
    belt.dispose();
  });

  it('shapes it as a mailbox, not a cube: a box with a rounded roof along its length and a red flag raised at its side — #2507, the owner’s ruling on PR #2518', () => {
    const belt = new DeliveryBelt('stylised');
    const mailbox = mailboxVertices(belt);
    const body = mailbox.filter((each) => each.dark);
    const top = Math.max(...body.map((each) => each.y));
    const bottom = Math.min(...body.map((each) => each.y));
    const halfAcross = Math.max(...body.map((each) => Math.abs(each.x)));
    // A cube's top is a face as wide as the box. The roof meets its top along a
    // ridge down the middle, and is narrower the higher it goes.
    const atTop = body.filter((each) => each.y > top - 1e-6);
    expect(atTop.length).toBeGreaterThan(0);
    for (const each of atTop) expect(Math.abs(each.x)).toBeLessThan(1e-6);
    const roof = body.filter((each) => each.y > bottom + halfAcross + 1e-6);
    expect(roof.length).toBeGreaterThan(0);
    for (const each of roof) {
      // On or inside the round of radius halfAcross about the roof's axis.
      expect(Math.hypot(each.x, each.y - (bottom + halfAcross))).toBeLessThanOrEqual(
        halfAcross + 1e-6,
      );
    }
    // Its flag: a red part, neither glowing nor pale, beside the box and raised over its roof.
    const flag = mailbox.filter((each) => !each.dark && !each.pale && !each.glows);
    expect(flag.length).toBeGreaterThan(0);
    for (const each of flag) {
      const [red, green, blue] = each.rgb;
      expect(red).toBeGreaterThan(2 * Math.max(green, blue));
    }
    expect(Math.min(...flag.map((each) => each.x))).toBeGreaterThanOrEqual(halfAcross);
    expect(Math.max(...flag.map((each) => each.y))).toBeGreaterThan(top + 0.1);
    belt.dispose();
  });

  it('marks it with a diamond of its own amber, not a doorstep’s gold, drawn past the tone mapping so the realistic world keeps it amber — #2507, the owner’s ruling on PR #2518', () => {
    const belt = new DeliveryBelt('realistic');
    /** The glowing diamond over a marker of `kind`: its glowing part above the step. */
    const diamondOf = (kind: number): ReturnType<typeof markerVertices> =>
      markerVertices(belt, kind).filter((each) => each.glows && each.y > 0.2);
    const doorstep = diamondOf(0);
    const mailbox = diamondOf(MAILBOX);
    expect(doorstep.length).toBeGreaterThan(0);
    expect(mailbox.length).toBeGreaterThan(0);
    /**
     * The paint's hue in degrees and its HSL saturation, from the geometry's
     * linear channels encoded as sRGB (this suite imports no three: the seam).
     */
    const hueOf = (linear: readonly [number, number, number]): [number, number] => {
      const [r, g, b] = linear.map((c) =>
        c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055,
      ) as [number, number, number];
      const most = Math.max(r, g, b);
      const least = Math.min(r, g, b);
      const spread = most - least;
      const lightness = (most + least) / 2;
      if (spread === 0) return [0, 0];
      const saturation = spread / (1 - Math.abs(2 * lightness - 1));
      const sixth =
        most === r
          ? ((g - b) / spread + 6) % 6
          : most === g
            ? (b - r) / spread + 2
            : (r - g) / spread + 4;
      return [sixth * 60, saturation];
    };
    const [mailboxHue, mailboxSaturation] = hueOf(mailbox[0]?.rgb ?? [0, 0, 0]);
    const [doorstepHue] = hueOf(doorstep[0]?.rgb ?? [0, 0, 0]);
    // An amber: orange-yellow, fully saturated, and at least 8 degrees of hue
    // from the doorstep's gold (42 degrees), toward orange.
    expect(mailboxHue).toBeGreaterThanOrEqual(28);
    expect(mailboxHue).toBeLessThanOrEqual(40);
    expect(mailboxSaturation).toBeGreaterThan(0.95);
    expect(doorstepHue - mailboxHue).toBeGreaterThanOrEqual(8);
    // Every vertex of each diamond one paint: they differ by paint, not by shading.
    for (const each of mailbox) expect(each.rgb).toEqual(mailbox[0]?.rgb);
    // The mailbox's diamond, and nothing else of any marker, is drawn untoned.
    expect(mailbox.every((each) => each.untoned)).toBe(true);
    for (const kind of [0, MAILBOX, 2]) {
      const others = markerVertices(belt, kind).filter(
        (each) => !(kind === MAILBOX && each.glows && each.y > 0.2),
      );
      expect(others.some((each) => each.untoned)).toBe(false);
    }
    belt.dispose();
  });

  for (const world of ['stylised', 'realistic'] as const) {
    it(`lets an untoned part leave the tone mapping with its own paint, before the colour space and the fog, in the ${world} world’s marker programs — #2507`, () => {
      const belt = new DeliveryBelt(world);
      for (const shading of ['lit', 'flat'] as const) {
        belt.setShading(shading);
        const shader = compiled(belt.meshOf('markers').material as unknown as Compilable);
        expect(shader.vertexShader).toContain('attribute vec2 oylPieceAlso;');
        expect(shader.vertexShader).toContain('vOylUntoned = oylPieceAlso.y;');
        const fragment = shader.fragmentShader;
        const mix = fragment.indexOf(
          'gl_FragColor.rgb = mix( gl_FragColor.rgb, diffuseColor.rgb, vOylUntoned );',
        );
        expect(mix).toBeGreaterThan(fragment.indexOf('#include <tonemapping_fragment>'));
        expect(mix).toBeLessThan(fragment.indexOf('#include <colorspace_fragment>'));
        expect(fragment).toContain('varying float vOylUntoned;');
      }
      belt.dispose();
    });
  }

  for (const [ahead, floors] of [
    // Measured, the owner's second ruling on PR #2518 (the mailbox lowered under a
    // house marker): 62, 19 and 24 pixels at 12 m; 52, 16 and 20 at 20 m. Until it,
    // at 20 m: 77 for the whole mark (a 1 m post, its diamond 0.72 m), the box 16.
    // Before #2507: 58 and 8. The box, what reads as a mailbox, kept its size.
    [12, { whole: 60, box: 18, diamond: 22 }],
    [THROW_WINDOW_BEFORE_METRES, { whole: 50, box: 15, diamond: 18 }],
  ] as const) {
    it(`stands at least ${floors.whole} pixels tall, its box ${floors.box} and its diamond ${floors.diamond}, on the tablet from ${ahead} m`, () => {
      // The rider on the middle of the road, heading north, a mailbox at the right-hand kerb
      // `ahead` metres ahead: where its throw window opens (20 m) and nearer (12 m).
      const pose = {
        x: 0,
        y: 0,
        z: 0,
        headingX: 0,
        headingZ: 1,
        eyeRoadY: 0,
        targetRoadY: 0,
        targetAheadMetres: CAMERA_TARGET_AHEAD_METRES,
      };
      const rig = cameraRig(pose);
      const at = {
        x: -(CARRIAGEWAY_HALF_WIDTH_METRES + MAILBOX_FROM_KERB_METRES),
        y: 0,
        z: ahead,
        yaw: -Math.PI / 2,
      };
      const belt = new DeliveryBelt('stylised');
      belt.update({ parcels: [], markers: [{ ...at, kind: 'mailbox' }], obstacles: [] }, rig.eye);
      const [drawn] = belt.drawn('markers');
      expect(drawn?.kind).toBe('mailbox');
      const scale = drawn?.scale ?? 1;
      /** A vertex of the marker's geometry, as its instance places it, in pixel rows of the tablet's frame. */
      const row = (vertex: {
        readonly x: number;
        readonly y: number;
        readonly z: number;
      }): number => {
        const cos = Math.cos(at.yaw);
        const sin = Math.sin(at.yaw);
        const point = {
          x: at.x + scale * (vertex.x * cos + vertex.z * sin),
          y: at.y + scale * vertex.y,
          z: at.z + scale * (-vertex.x * sin + vertex.z * cos),
        };
        const framed = projectToFrame(rig, TABLET.width / TABLET.height, point);
        expect(framed).toBeDefined();
        return (framed?.top ?? 0) * TABLET.height;
      };
      const mailbox = mailboxVertices(belt);
      const whole = span(mailbox.map(row));
      const box = span(mailbox.filter((each) => each.dark).map(row));
      const diamond = span(mailbox.filter((each) => each.glows && each.y > 0.2).map(row));
      expect(whole).toBeGreaterThanOrEqual(floors.whole);
      expect(box).toBeGreaterThanOrEqual(floors.box);
      expect(diamond).toBeGreaterThanOrEqual(floors.diamond);
      belt.dispose();
    });
  }

  it('keeps a mailbox a tighter target than a doorstep: only what is drawn got bigger', () => {
    expect(MAILBOX_CATCH_RADIUS_METRES).toBe(0.6);
    expect(MAILBOX_CATCH_RADIUS_METRES).toBeLessThan(TARGET_CATCH_RADIUS_METRES);
  });
});
