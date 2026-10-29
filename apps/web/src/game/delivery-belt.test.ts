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
import { DELIVERY_PIECE_CAPACITY, DeliveryBelt, type DeliveryPieceKind } from './three-renderer';
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

  it('lights no lit part past white, and glows only the marker’s diamond and ring', () => {
    const belt = new DeliveryBelt('stylised');
    let lit = 0;
    let glowing = 0;
    for (const what of KINDS) {
      const geometry = belt.meshOf(what).geometry;
      const colour = geometry.getAttribute('color');
      const glow = geometry.getAttribute('oylGlow');
      for (let at = 0; at < colour.count; at += 1) {
        if (glow.getX(at) === 1) {
          glowing += 1;
          expect(what).toBe('markers');
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
