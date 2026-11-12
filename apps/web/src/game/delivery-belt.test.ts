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

import { describe, expect, it } from 'vitest';

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
import type { DeliveryInView, DeliveryPiece } from './port';
import type { CorridorPoint } from './terrain';
import {
  DELIVERY_MARKER_TRIANGLES,
  DELIVERY_OBSTACLE_TRIANGLES,
  DELIVERY_PIECE_CAPACITY,
  DeliveryBelt,
  MARKER_MOST_SCALE,
  MARKER_TRUE_SIZE_WITHIN_METRES,
  markerScaleAt,
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
    // #2365: a doorstep's marker, kind 0; a mailbox's and a no-delivery sign are their own.
    const kinds = geometry.getAttribute('oylPieceKind');
    const diamond = { xs: [] as number[], ys: [] as number[] };
    for (let at = 0; at < position.count; at += 1) {
      // The ring lies on the step; the diamond is the glowing part above it.
      if (kinds.getX(at) !== 0 || glow.getX(at) !== 1 || position.getY(at) < 1) continue;
      diamond.xs.push(position.getX(at));
      diamond.ys.push(position.getY(at));
    }
    const span = (values: readonly number[]): number => Math.max(...values) - Math.min(...values);
    // Until #2453, 0.4 m across from 1.52 m up: hidden by a garden hedge, and 2 pixels at 100 m.
    expect(span(diamond.xs)).toBeGreaterThanOrEqual(0.9 - 1e-6);
    expect(Math.min(...diamond.ys)).toBeGreaterThanOrEqual(2.4 - 1e-6);
    belt.dispose();
  });

  it('draws a mailbox and a house that must not get a parcel as markers of their own shapes, in the markers’ one mesh — #2365', () => {
    const belt = new DeliveryBelt('stylised');
    const geometry = belt.meshOf('markers').geometry;
    const position = geometry.getAttribute('position');
    const glow = geometry.getAttribute('oylGlow');
    const kinds = geometry.getAttribute('oylPieceKind');
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
        // The parcels' program is not taught it: a parcel carries no kind. The
        // markers' is, since #2365: a doorstep's, a mailbox's and a no-delivery sign.
        const plain = belt.meshOf('parcels').material as unknown as Compilable;
        expect(compiled(plain).vertexShader).not.toContain('oylObstacleKind');
        belt.setShading(shading);
        const markers = belt.meshOf('markers').material as unknown as Compilable;
        expect(compiled(markers).vertexShader).toContain(
          'transformed *= 1.0 - step( 0.5, abs( oylPieceKind - oylObstacleKind ) );',
        );
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
    const kinds = geometry.getAttribute('oylPieceKind');
    const untoned = geometry.getAttribute('oylUntoned');
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
        untoned: untoned.getX(at) === 1,
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

  /**
   * A house marker's top once #2530 lands, metres: its 0.6 m post under a
   * 0.9 m diamond stretched 1.4 tall, **1.86**. #2530 is not on this branch,
   * where the marker still stands on #2453's 2.4 m post (its top 3.66 m), so
   * the bound is written down here from #2530's `MARKER_METRES`. When the two
   * combine, the drawn house marker's top is this number, and the case below
   * reads both: the mailbox under the drawn marker's top and under this one.
   */
  const HOUSE_MARKER_TOP_FROM_2530_METRES = 0.6 + 0.9 * 1.4;

  it('stands the whole mailbox, its diamond too, below a house marker’s top, #2530’s 1.86 m — the owner’s second ruling on PR #2518', () => {
    const belt = new DeliveryBelt('stylised');
    const top = (kind: number): number =>
      Math.max(...markerVertices(belt, kind).map((each) => each.y));
    const mailbox = top(MAILBOX);
    // Under it by a margin a reader sees: at least 0.05 m.
    expect(mailbox).toBeLessThanOrEqual(HOUSE_MARKER_TOP_FROM_2530_METRES - 0.05);
    expect(mailbox).toBeLessThan(top(0));
    // 2.65 m until this ruling: over a 1.86 m house marker.
    expect(mailbox).toBeCloseTo(1.79, 6);
    // Every glowing part of the diamond lies under it too.
    const diamond = mailboxVertices(belt).filter((each) => each.glows && each.y > 0.2);
    expect(diamond.length).toBeGreaterThan(0);
    expect(Math.max(...diamond.map((each) => each.y))).toBeLessThanOrEqual(
      HOUSE_MARKER_TOP_FROM_2530_METRES - 0.05,
    );
    belt.dispose();
  });

  it('holds the markers’ geometry to its triangle count, which every marker instance submits — #2507', () => {
    const belt = new DeliveryBelt('stylised');
    const geometry = belt.meshOf('markers').geometry;
    const position = geometry.getAttribute('position');
    const kinds = geometry.getAttribute('oylPieceKind');
    const perKind = [0, 0, 0];
    for (let at = 0; at < position.count; at += 1) {
      const kind = kinds.getX(at);
      perKind[kind] = (perKind[kind] ?? 0) + 1;
    }
    expect(position.count / 3).toBe(DELIVERY_MARKER_TRIANGLES);
    // A doorstep's 44, a mailbox's 84, a no-delivery sign's 56: its torus (72) a flat ring (32).
    expect(perKind.map((each) => each / 3)).toEqual([44, 84, 56]);
    expect(DELIVERY_MARKER_TRIANGLES).toBeLessThanOrEqual(184);
    belt.dispose();
  });

  it('draws a no-delivery sign’s ring with a face toward a rider coming either way along the road — #2507', () => {
    // The markers' materials draw front faces only. A house's yaw turns toward
    // the road, so a sign on the far side of the road shows an oncoming rider
    // what its twin on the near side shows a rider leaving.
    const belt = new DeliveryBelt('stylised');
    const geometry = belt.meshOf('markers').geometry;
    const position = geometry.getAttribute('position');
    const glow = geometry.getAttribute('oylGlow');
    const kinds = geometry.getAttribute('oylPieceKind');
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
        expect(shader.vertexShader).toContain('attribute float oylUntoned;');
        expect(shader.vertexShader).toContain('vOylUntoned = oylUntoned;');
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
      // The rider on the middle of the road, heading north, the throw window to a mailbox at the
      // right-hand kerb just opening: the mailbox THROW_WINDOW_BEFORE_METRES ahead.
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
