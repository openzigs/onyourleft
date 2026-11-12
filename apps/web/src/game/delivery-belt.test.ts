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
import { CAMERA_ABOVE_METRES, MAXIMUM_FIELD_OF_VIEW_DEGREES, NEAR_PLANE_METRES } from './camera';
import { deliveryInView } from './delivery/in-view';
import {
  OBSTACLE_KINDS,
  startObstacles,
  type Obstacle,
  type ObstacleKind,
} from './delivery/obstacles';
import { recordMiss, startRound, type Round } from './delivery/round';
import type { DeliveryTarget } from './delivery/targets';
import {
  CARRIAGEWAY_HALF_WIDTH_METRES,
  NO_PARCELS,
  PARCEL_FLIGHT_TICKS,
  stepThrows,
  type ThrowState,
  type ThrowTarget,
} from './delivery/throw';
import type { DeliveryInView, DeliveryPiece } from './port';
import type { CorridorPoint } from './terrain';
import {
  DELIVERY_OBSTACLE_TRIANGLES,
  DELIVERY_PIECE_CAPACITY,
  DeliveryBelt,
  MARKER_MOST_SCALE,
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
const ROSTER = Object.keys(OBSTACLE_KINDS) as readonly ObstacleKind[];

/** `count` of each piece, a metre apart, every obstacle kind in turn. */
function pieces(count: number): DeliveryInView {
  const at = (index: number): DeliveryPiece => ({ x: index, y: 0, z: 2 * index, yaw: 0 });
  return {
    parcels: Array.from({ length: count }, (_, index) => at(index)),
    markers: Array.from({ length: count }, (_, index) => at(index)),
    obstacles: Array.from({ length: count }, (_, index) => ({
      ...at(index),
      kind: ROSTER[index % ROSTER.length] as ObstacleKind,
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

/** The bounding box of the vertices of `kind` in the obstacle mesh's geometry. */
function kindBox(belt: DeliveryBelt, kind: ObstacleKind): { min: number[]; max: number[] } {
  const geometry = belt.meshOf('obstacles').geometry;
  const position = geometry.getAttribute('position');
  const kinds = geometry.getAttribute('oylPieceKind');
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let at = 0; at < position.count; at += 1) {
    if (kinds.getX(at) !== ROSTER.indexOf(kind)) continue;
    const corner = [position.getX(at), position.getY(at), position.getZ(at)];
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

  it('carries a glowing hazard marker over each bin, trolley and cone, above the rider’s helmet and out of the camera’s near reach, and none over a parked car — #2396', () => {
    const belt = new DeliveryBelt('stylised');
    const geometry = belt.meshOf('obstacles').geometry;
    const position = geometry.getAttribute('position');
    const kinds = geometry.getAttribute('oylPieceKind');
    const glow = geometry.getAttribute('oylGlow');
    // The frustum nearer than the near plane reaches this far above the eye
    // at the widest lens a frame opens, so a lower marker would be cut
    // through by a camera passing over the obstacle.
    const nearReach =
      CAMERA_ABOVE_METRES +
      NEAR_PLANE_METRES * Math.tan(((MAXIMUM_FIELD_OF_VIEW_DEGREES / 2) * Math.PI) / 180);
    for (const kind of ROSTER) {
      let glowing = 0;
      let lowest = Infinity;
      for (let at = 0; at < position.count; at += 1) {
        if (kinds.getX(at) !== ROSTER.indexOf(kind) || glow.getX(at) !== 1) continue;
        glowing += 1;
        lowest = Math.min(lowest, position.getY(at));
      }
      if (kind === 'parked-car') {
        // 1.8 m wide, never behind the rider: no sign over an ordinary parked car.
        expect(glowing, kind).toBe(0);
        continue;
      }
      expect(glowing, kind).toBeGreaterThan(0);
      expect(lowest, kind).toBeGreaterThan(RIDER_HEIGHT_METRES);
      expect(lowest, kind).toBeGreaterThan(nearReach);
    }
    belt.dispose();
  });

  it('stands a house marker’s glowing diamond 0.9 m across on a 2.4 m post, above a hedge, a fence and a parked car — #2453', () => {
    const belt = new DeliveryBelt('stylised');
    const geometry = belt.meshOf('markers').geometry;
    const position = geometry.getAttribute('position');
    const glow = geometry.getAttribute('oylGlow');
    const diamond = { xs: [] as number[], ys: [] as number[] };
    for (let at = 0; at < position.count; at += 1) {
      // The ring lies on the step; the diamond is the glowing part above it.
      if (glow.getX(at) !== 1 || position.getY(at) < 1) continue;
      diamond.xs.push(position.getX(at));
      diamond.ys.push(position.getY(at));
    }
    const span = (values: readonly number[]): number => Math.max(...values) - Math.min(...values);
    // Until #2453, 0.4 m across from 1.52 m up: hidden by a garden hedge, and 2 pixels at 100 m.
    expect(span(diamond.xs)).toBeGreaterThanOrEqual(0.9 - 1e-6);
    expect(Math.min(...diamond.ys)).toBeGreaterThanOrEqual(2.4 - 1e-6);
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
    const kinds = belt.meshOf('obstacles').geometry.getAttribute('oylObstacleKind');
    expect([0, 1, 2].map((at) => kinds.getX(at))).toEqual([0, 1, 2]);
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
      (belt.meshOf('obstacles').geometry.getAttribute('oylObstacleKind') as { version: number })
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
        expect(shader.vertexShader).toContain('attribute float oylPieceKind;');
        expect(shader.vertexShader).toContain('attribute float oylObstacleKind;');
        const collapse = shader.vertexShader.indexOf(
          'transformed *= 1.0 - step( 0.5, abs( oylPieceKind - oylObstacleKind ) );',
        );
        expect(collapse).toBeGreaterThan(shader.vertexShader.indexOf('#include <begin_vertex>'));
        expect(material.customProgramCacheKey()).toContain('oyl-delivery-kinds');
        // The parcels' and markers' programs are not taught it: they carry no kind.
        const plain = belt.meshOf('markers').material as unknown as Compilable;
        expect(compiled(plain).vertexShader).not.toContain('oylObstacleKind');
      }
      belt.dispose();
    });
  }

  it('lights no lit part past white, and glows only the marker’s diamond and ring, and each obstacle’s hazard marker overhead (#2396)', () => {
    const belt = new DeliveryBelt('stylised');
    let lit = 0;
    let glowing = 0;
    for (const what of KINDS) {
      const geometry = belt.meshOf(what).geometry;
      const colour = geometry.getAttribute('color');
      const glow = geometry.getAttribute('oylGlow');
      const position = geometry.getAttribute('position');
      for (let at = 0; at < colour.count; at += 1) {
        if (glow.getX(at) === 1) {
          glowing += 1;
          expect(what).not.toBe('parcels');
          // An obstacle's body does not glow: only the marker over the rider's helmet does.
          if (what === 'obstacles') expect(position.getY(at)).toBeGreaterThan(RIDER_HEIGHT_METRES);
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
function compiled(material: Compilable): { readonly vertexShader: string } {
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
      '#include <opaque_fragment>',
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
    const kinds = geometry.getAttribute('oylPieceKind');
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
    const kinds = geometry.getAttribute('oylPieceKind');
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
    // One car: every vertex's kind is one of the roster's four, none a second or third car.
    const kinds = geometry.getAttribute('oylPieceKind');
    const seen = new Set<number>();
    for (let at = 0; at < kinds.count; at += 1) seen.add(kinds.getX(at));
    expect([...seen].sort()).toEqual([0, 1, 2, 3]);
    // Its body, and only its body, takes the instance's paint.
    const painted = geometry.getAttribute('oylPainted');
    const car = carVertices(belt, CAR_KIND);
    const counts = new Map<string, number>();
    for (const each of car) counts.set(each.paint, (counts.get(each.paint) ?? 0) + 1);
    const body = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    let paintedBody = 0;
    for (let at = 0; at < painted.count; at += 1) {
      if (painted.getX(at) !== 1) continue;
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
    const paints = geometry.getAttribute('oylObstaclePaint');
    const rgb = (at: number): string =>
      [paints.getX(at), paints.getY(at), paints.getZ(at)].map((each) => each.toFixed(4)).join(',');
    expect(new Set([0, 1, 2].map(rgb)).size).toBe(3);
    expect(rgb(3)).toBe(rgb(0));
    // The same car, a frame later and the first off the road: still its own paint.
    belt.update({ parcels: [], markers: [], obstacles: cars.slice(1) });
    expect(belt.drawn('obstacles').map((each) => each.paint)).toEqual([1, 2, 0, 1]);
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
    // markers, 1 546. A change past this is for the owner and
    // the tablet (#733), not a quiet drift.
    const belt = new DeliveryBelt('stylised');
    const position = belt.meshOf('obstacles').geometry.getAttribute('position');
    expect(position.count / 3).toBe(DELIVERY_OBSTACLE_TRIANGLES);
    expect(DELIVERY_OBSTACLE_TRIANGLES).toBeLessThanOrEqual(1_600);
    belt.dispose();
  });
});
