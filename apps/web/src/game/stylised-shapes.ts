// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The stylised world's shapes by setting, and the ones built from numbers —
 * #3287.
 *
 * The stylised world is the default on every device (ADR 0026 D-3), and it
 * drew every house as one of three Kenney buildings and every tree as one of
 * four. This file adds, without a file and without a draw call:
 *
 * - **buildings by setting**: {@link buildingSettingOf} reads the urban class
 *   the realistic world reads (`urban-class.ts`), `settlements.ts` §`lotsAt`
 *   writes it on a lot (`scatter.ts` §`ScatterItem.setting`), and a suburban
 *   lot is drawn as a modern house, a commercial one as a shop front or an
 *   office, a rural one as the Kenney building it always was;
 * - **more trees and rocks**: two broadleaves, two conifers and two rocks;
 * - **a seeded tint** ({@link writeStylisedTint}) beside the scale
 *   `scatter.ts` already seeds, so a row is not one tree copied.
 *
 * ## Why the new shapes are built here and not downloaded
 *
 * #3287 prefers Kenney's kits, taken unconverted from their archives. On
 * 2026-11-26 `kenney.nl` gave its archives only through a signed link its own
 * page requests, and refused the request a script made; that was not worked
 * round. The lane note on the issue prefers *"code-generated geometry or
 * already-committed files"*, and the stylised world already builds a barn, a
 * church, a row of shops and a shed from numbers (#460, #500). So every shape
 * below is arithmetic, in the kit's own manner — flat faces, a few dozen
 * triangles — and in the kit's own colours where it has one
 * ({@link KIT}). A Kenney file can replace any of them later: a shape is a
 * geometry to the renderer, whichever made it.
 *
 * ## How several shapes cost one draw call
 *
 * A shape was a mesh and a mesh a draw call (`scenery-models.ts`
 * §`MAXIMUM_SCENERY_VARIANTS`), and no ceiling is raised here. Each mesh a
 * kind already has is instead drawn with SEVERAL shapes in its one geometry
 * ({@link STYLISED_FOLDS}): every vertex says which shape it belongs to, every
 * instance says which shape it is ({@link stylisedFoldOf}), and the vertex
 * shader folds the others to a point (`three-renderer.ts`
 * §`STYLISED_INSTANCE_GLSL`) — the realistic fence's fold, #1274. The mesh count,
 * and so every draw-call figure, is what it was. What it costs is vertices:
 * an instance submits every shape its mesh holds, so the shapes here are kept
 * small, and {@link GENERATED_TRIANGLE_CEILINGS} holds each to the range of
 * the models it joins.
 *
 * Pure: no rendering library, and nothing here is derived from another
 * product (ADR 0009 L2).
 */

import type { BuildingSetting, ScatterItem, SceneryKind } from './scatter';
import { srgbByteToLinear, tonedForTheSun, type LinearRgb } from './scenery-palette';
import { mixInto, uniformFrom } from './seeded';
import type { UrbanClass } from './urban-class';

/**
 * The setting a stretch of the given urban class is — #3287.
 *
 * | urban class | setting |
 * |---|---|
 * | `unknown`, `rural` | `rural` |
 * | `village`, which is also what a suburb reads as | `suburban` |
 * | `town`, `city-centre` | `commercial` |
 *
 * The same table the realistic world's house models take
 * (`house-models.ts`, #3251), with its `modern` split in two.
 */
export function buildingSettingOf(urban: UrbanClass): BuildingSetting {
  if (urban === 'village') return 'suburban';
  if (urban === 'town' || urban === 'city-centre') return 'commercial';
  return 'rural';
}

/** Which fold of a building's mesh each setting is. The model is the first. */
const SETTING_FOLD: Readonly<Record<BuildingSetting, number>> = {
  rural: 0,
  suburban: 1,
  commercial: 2,
};

/**
 * One shape built from numbers: triangles, three corners each, counter-
 * clockwise seen from outside, in metres with `y` up and its front toward
 * `+z` — and one linear colour a corner.
 */
export interface GeneratedShape {
  readonly name: string;
  /** Nine numbers a triangle. */
  readonly positions: Float32Array;
  /** Nine numbers a triangle: each corner's linear colour. */
  readonly colours: Float32Array;
}

type Point = readonly [number, number, number];
type Triangle = readonly [Point, Point, Point];

/** A typed sRGB colour, linear, and under the sun's ceiling as a model's is. */
function hex(colour: number): LinearRgb {
  return tonedForTheSun([
    srgbByteToLinear((colour >> 16) & 0xff),
    srgbByteToLinear((colour >> 8) & 0xff),
    srgbByteToLinear(colour & 0xff),
  ]);
}

/**
 * The kit's own colours — the `baseColorFactor` of each material the
 * committed Nature Kit models declare, read from their bytes
 * (`scenery-palette.ts` §`SCENERY_PALETTE`), so a generated tree stands beside
 * a Kenney one in the same green.
 */
const KIT = {
  leaf: tonedForTheSun([0.1608, 0.7882, 0.6706]),
  leafDark: tonedForTheSun([0.1686, 0.651, 0.6667]),
  bark: tonedForTheSun([0.8863, 0.5137, 0.3412]),
  barkDark: tonedForTheSun([0.8, 0.4627, 0.3686]),
  stone: tonedForTheSun([0.7216, 0.8863, 0.9098]),
} as const;

/** What the buildings are painted: this repository's own choices. */
const PAINT = {
  render: hex(0xe8e4da),
  sand: hex(0xd9cdb8),
  concrete: hex(0xcfcabf),
  charcoal: hex(0x444952),
  slate: hex(0x41454d),
  flatRoof: hex(0x8d9096),
  timber: hex(0x9a6b45),
  brick: hex(0xa5553f),
  glass: hex(0x2c3e50),
  door: hex(0x30343c),
  shutter: hex(0x9a9da3),
  navy: hex(0x2f4a7a),
  amber: hex(0xd9a441),
  red: hex(0xc2463a),
} as const;

/** How far a window, a door or a sign stands off its wall, in metres. */
const PROUD_METRES = 0.03;

/** Triangles and colours as they are gathered. */
class ShapeBuilder {
  readonly #positions: number[] = [];
  readonly #colours: number[] = [];

  /** One triangle, turned if it has to be so that it faces along `outward`. */
  #push(triangle: Triangle, outward: Point, colour: LinearRgb): void {
    const [a, b, c] = triangle;
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    const facing =
      (uy * vz - uz * vy) * outward[0] +
      (uz * vx - ux * vz) * outward[1] +
      (ux * vy - uy * vx) * outward[2];
    for (const corner of facing < 0 ? [a, c, b] : [a, b, c]) {
      this.#positions.push(corner[0], corner[1], corner[2]);
      this.#colours.push(colour[0], colour[1], colour[2]);
    }
  }

  /**
   * The faces of one convex solid: each triangle turned to face away from
   * `inside`, a point inside it. So no face here can be wound the wrong way.
   */
  convex(faces: readonly (readonly [Triangle, LinearRgb])[], inside: Point): void {
    for (const [triangle, colour] of faces) {
      const [a, b, c] = triangle;
      this.#push(
        triangle,
        [
          (a[0] + b[0] + c[0]) / 3 - inside[0],
          (a[1] + b[1] + c[1]) / 3 - inside[1],
          (a[2] + b[2] + c[2]) / 3 - inside[2],
        ],
        colour,
      );
    }
  }

  /** A flat four-cornered panel, its corners in order round it, facing `outward`. */
  panel(corners: readonly [Point, Point, Point, Point], outward: Point, colour: LinearRgb): void {
    const [a, b, c, d] = corners;
    this.#push([a, b, c], outward, colour);
    this.#push([a, c, d], outward, colour);
  }

  done(name: string): GeneratedShape {
    return {
      name,
      positions: Float32Array.from(this.#positions),
      colours: Float32Array.from(this.#colours),
    };
  }
}

/** A quadrilateral as two triangles of one colour. */
function quad(a: Point, b: Point, c: Point, d: Point, colour: LinearRgb) {
  return [
    [[a, b, c], colour],
    [[a, c, d], colour],
  ] as const;
}

/**
 * A box: four walls and a top, ten triangles — and its underside too, twelve,
 * where `under` says a rider can see it. One standing on the ground has none.
 */
function box(
  builder: ShapeBuilder,
  [x0, x1]: readonly [number, number],
  [y0, y1]: readonly [number, number],
  [z0, z1]: readonly [number, number],
  wall: LinearRgb,
  top: LinearRgb = wall,
  under?: LinearRgb,
): void {
  builder.convex(
    [
      ...quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], wall),
      ...quad([x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], wall),
      ...quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], wall),
      ...quad([x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0], wall),
      ...quad([x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1], top),
      ...(under === undefined
        ? []
        : quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], under)),
    ],
    [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2],
  );
}

/** A gabled roof whose ridge runs front to back, so a gable faces the road. Six triangles. */
function gableRoof(
  builder: ShapeBuilder,
  [x0, x1]: readonly [number, number],
  [eave, ridge]: readonly [number, number],
  [z0, z1]: readonly [number, number],
  roof: LinearRgb,
  gable: LinearRgb,
): void {
  const middle = (x0 + x1) / 2;
  builder.convex(
    [
      ...quad([x0, eave, z0], [x0, eave, z1], [middle, ridge, z1], [middle, ridge, z0], roof),
      ...quad([x1, eave, z0], [x1, eave, z1], [middle, ridge, z1], [middle, ridge, z0], roof),
      [
        [
          [x0, eave, z1],
          [x1, eave, z1],
          [middle, ridge, z1],
        ],
        gable,
      ],
      [
        [
          [x0, eave, z0],
          [x1, eave, z0],
          [middle, ridge, z0],
        ],
        gable,
      ],
    ],
    [middle, eave + (ridge - eave) / 4, (z0 + z1) / 2],
  );
}

/**
 * A wedge: a slope from `(low, zLow)` up to `(high, zHigh)`, the wall under
 * its high edge and its two ends, six triangles — and its underside too,
 * eight, where `under` says a rider can see it. A single-pitch roof, which
 * has none, and an awning, which has.
 */
function wedge(
  builder: ShapeBuilder,
  [x0, x1]: readonly [number, number],
  [low, zLow]: readonly [number, number],
  [high, zHigh]: readonly [number, number],
  slope: LinearRgb,
  wall: LinearRgb,
  under?: LinearRgb,
): void {
  builder.convex(
    [
      ...quad([x0, low, zLow], [x1, low, zLow], [x1, high, zHigh], [x0, high, zHigh], slope),
      ...quad([x0, low, zHigh], [x1, low, zHigh], [x1, high, zHigh], [x0, high, zHigh], wall),
      ...(under === undefined
        ? []
        : quad([x0, low, zLow], [x1, low, zLow], [x1, low, zHigh], [x0, low, zHigh], under)),
      [
        [
          [x0, low, zLow],
          [x0, low, zHigh],
          [x0, high, zHigh],
        ],
        wall,
      ],
      [
        [
          [x1, low, zLow],
          [x1, low, zHigh],
          [x1, high, zHigh],
        ],
        wall,
      ],
    ],
    [(x0 + x1) / 2, low + (high - low) / 4, zHigh + (zLow - zHigh) / 4],
  );
}

/** A panel on the front wall at `z`: a window, a door, a sign. Two triangles. */
function onFront(
  builder: ShapeBuilder,
  z: number,
  [x0, x1]: readonly [number, number],
  [y0, y1]: readonly [number, number],
  colour: LinearRgb,
): void {
  const at = z + PROUD_METRES;
  builder.panel(
    [
      [x0, y0, at],
      [x1, y0, at],
      [x1, y1, at],
      [x0, y1, at],
    ],
    [0, 0, 1],
    colour,
  );
}

/** A panel on a side wall at `x`, facing `side` (−1 or 1). Two triangles. */
function onSide(
  builder: ShapeBuilder,
  x: number,
  side: -1 | 1,
  [z0, z1]: readonly [number, number],
  [y0, y1]: readonly [number, number],
  colour: LinearRgb,
): void {
  const at = x + side * PROUD_METRES;
  builder.panel(
    [
      [at, y0, z0],
      [at, y0, z1],
      [at, y1, z1],
      [at, y1, z0],
    ],
    [side, 0, 0],
    colour,
  );
}

/** A ring of `sides` points round the `y` axis, turned by `turn` of a step. */
function ring(
  [cx, cz]: readonly [number, number],
  y: number,
  radius: number,
  sides: number,
  turn = 0,
): Point[] {
  const points: Point[] = [];
  for (let side = 0; side < sides; side += 1) {
    const angle = ((side + turn) / sides) * 2 * Math.PI;
    points.push([cx + Math.cos(angle) * radius, y, cz + Math.sin(angle) * radius]);
  }
  return points;
}

/** A trunk: a tapering column with no ends, which the ground and the crown hide. */
function trunk(
  builder: ShapeBuilder,
  [y0, y1]: readonly [number, number],
  [r0, r1]: readonly [number, number],
  sides: number,
  colour: LinearRgb,
): void {
  const foot = ring([0, 0], y0, r0, sides);
  const head = ring([0, 0], y1, r1, sides);
  const faces: (readonly [Triangle, LinearRgb])[] = [];
  for (let side = 0; side < sides; side += 1) {
    const next = (side + 1) % sides;
    faces.push(
      ...quad(
        foot[side] as Point,
        foot[next] as Point,
        head[next] as Point,
        head[side] as Point,
        colour,
      ),
    );
  }
  builder.convex(faces, [0, (y0 + y1) / 2, 0]);
}

/** One tier of a conifer: a cone and the underside a rider looks up at. */
function tier(
  builder: ShapeBuilder,
  y: number,
  height: number,
  radius: number,
  sides: number,
  turn: number,
  colour: LinearRgb,
): void {
  const skirt = ring([0, 0], y, radius, sides, turn);
  const apex: Point = [0, y + height, 0];
  const faces: (readonly [Triangle, LinearRgb])[] = [];
  for (let side = 0; side < sides; side += 1) {
    faces.push([[skirt[side] as Point, skirt[(side + 1) % sides] as Point, apex], colour]);
  }
  for (let side = 1; side + 1 < sides; side += 1) {
    faces.push([[skirt[0] as Point, skirt[side] as Point, skirt[side + 1] as Point], colour]);
  }
  builder.convex(faces, [0, y + height / 4, 0]);
}

/** A regular icosahedron's twelve corners, each one unit from its centre. */
const ICOSAHEDRON_CORNERS: readonly Point[] = (() => {
  const golden = (1 + Math.sqrt(5)) / 2;
  const length = Math.hypot(1, golden);
  const corners: Point[] = [
    [-1, golden, 0],
    [1, golden, 0],
    [-1, -golden, 0],
    [1, -golden, 0],
    [0, -1, golden],
    [0, 1, golden],
    [0, -1, -golden],
    [0, 1, -golden],
    [golden, 0, -1],
    [golden, 0, 1],
    [-golden, 0, -1],
    [-golden, 0, 1],
  ];
  return corners.map(([x, y, z]): Point => [x / length, y / length, z / length]);
})();

/** Its twenty faces, as corners of {@link ICOSAHEDRON_CORNERS}. */
const ICOSAHEDRON_FACES: readonly (readonly [number, number, number])[] = [
  [0, 11, 5],
  [0, 5, 1],
  [0, 1, 7],
  [0, 7, 10],
  [0, 10, 11],
  [1, 5, 9],
  [5, 11, 4],
  [11, 10, 2],
  [10, 7, 6],
  [7, 1, 8],
  [3, 9, 4],
  [3, 4, 2],
  [3, 2, 6],
  [3, 6, 8],
  [3, 8, 9],
  [4, 9, 5],
  [2, 4, 11],
  [6, 2, 10],
  [8, 6, 7],
  [9, 8, 1],
];

/** The seed every shape's unevenness is drawn from: a constant, so a shape is the same on every device. */
const SHAPE_SEED = 0x3287_5eed;

/**
 * A lump: an icosahedron stretched to `radii` about `centre`, each corner
 * moved in or out by up to half of `rough`, and nothing below `floor`. Twenty
 * triangles. A crown, and a rock.
 */
function lump(
  builder: ShapeBuilder,
  centre: Point,
  radii: Point,
  rough: number,
  key: number,
  colour: LinearRgb,
  floor = Number.NEGATIVE_INFINITY,
): void {
  const base = mixInto(SHAPE_SEED, key);
  const corners = ICOSAHEDRON_CORNERS.map(([x, y, z], corner): Point => {
    const reach = 1 + rough * (uniformFrom(mixInto(base, corner), 0) - 0.5);
    return [
      centre[0] + x * radii[0] * reach,
      Math.max(floor, centre[1] + y * radii[1] * reach),
      centre[2] + z * radii[2] * reach,
    ];
  });
  builder.convex(
    ICOSAHEDRON_FACES.map(([a, b, c]) => [
      [corners[a] as Point, corners[b] as Point, corners[c] as Point],
      colour,
    ]),
    [centre[0], Math.max(floor, centre[1]), centre[2]],
  );
}

/** A round-crowned broadleaf: a trunk and three lumps. 72 triangles. */
function roundTree(): GeneratedShape {
  const builder = new ShapeBuilder();
  trunk(builder, [0, 1.6], [0.17, 0.11], 6, KIT.bark);
  lump(builder, [0, 2.8, 0], [1.4, 1.3, 1.35], 0.3, 1, KIT.leaf);
  lump(builder, [0.85, 2.2, 0.35], [0.95, 0.85, 0.9], 0.3, 2, KIT.leaf);
  lump(builder, [-0.75, 2.35, -0.45], [0.9, 0.9, 0.95], 0.3, 3, KIT.leaf);
  return builder.done('tree_round');
}

/** A tall narrow broadleaf, as a poplar is: a trunk and two lumps. 52 triangles. */
function columnTree(): GeneratedShape {
  const builder = new ShapeBuilder();
  trunk(builder, [0, 1.1], [0.14, 0.1], 6, KIT.bark);
  lump(builder, [0, 2.1, 0], [0.85, 1.3, 0.85], 0.25, 4, KIT.leaf);
  lump(builder, [0, 3.5, 0], [0.65, 1.15, 0.65], 0.25, 5, KIT.leaf);
  return builder.done('tree_column');
}

/** A spruce in three tiers. 46 triangles. */
function spruceTree(): GeneratedShape {
  const builder = new ShapeBuilder();
  trunk(builder, [0, 1.2], [0.2, 0.15], 5, KIT.barkDark);
  tier(builder, 1, 2.6, 1.55, 7, 0, KIT.leafDark);
  tier(builder, 2.6, 2.4, 1.2, 7, 0.5, KIT.leafDark);
  tier(builder, 4.2, 2.6, 0.8, 7, 0, KIT.leafDark);
  return builder.done('tree_spruce');
}

/** A slim fir in two tiers. 30 triangles. */
function firTree(): GeneratedShape {
  const builder = new ShapeBuilder();
  trunk(builder, [0, 1.5], [0.17, 0.13], 5, KIT.barkDark);
  tier(builder, 1.4, 3.2, 1, 6, 0, KIT.leafDark);
  tier(builder, 3.4, 3.6, 0.7, 6, 0.5, KIT.leafDark);
  return builder.done('tree_fir');
}

/** A boulder, flat where it sits. 20 triangles. */
function boulder(): GeneratedShape {
  const builder = new ShapeBuilder();
  lump(builder, [0, 0.35, 0], [0.8, 0.6, 0.7], 0.4, 6, KIT.stone, 0);
  return builder.done('stone_boulder');
}

/** A low slab of rock, flat where it sits. 20 triangles. */
function slab(): GeneratedShape {
  const builder = new ShapeBuilder();
  lump(builder, [0, 0.16, 0], [0.9, 0.34, 0.6], 0.35, 7, KIT.stone, 0);
  return builder.done('stone_slab');
}

/** Two flat-roofed storeys, one set back on the other, and a garage. */
function flatRoofedHouse(): GeneratedShape {
  const builder = new ShapeBuilder();
  box(builder, [-4.5, 2], [0, 3], [-3, 3], PAINT.render, PAINT.flatRoof);
  box(builder, [-4.5, 0.5], [3, 5.8], [-3, 2.2], PAINT.charcoal, PAINT.slate);
  box(builder, [2, 4.5], [0, 2.7], [-2.6, 2.4], PAINT.concrete, PAINT.flatRoof);
  onFront(builder, 3, [-3.9, 0.2], [0.7, 2.4], PAINT.glass);
  onFront(builder, 3, [0.9, 1.8], [0, 2.1], PAINT.timber);
  onFront(builder, 2.2, [-3.9, -0.3], [3.6, 5.2], PAINT.glass);
  onFront(builder, 2.4, [2.3, 4.2], [0, 2.2], PAINT.shutter);
  onSide(builder, -4.5, -1, [-1.5, 1.5], [3.7, 5.1], PAINT.glass);
  return builder.done('house_flat_roof');
}

/** One storey under a single pitch that rises to the road, a high window under it, and a garage. */
function singlePitchHouse(): GeneratedShape {
  const builder = new ShapeBuilder();
  box(builder, [-4.5, 1.5], [0, 2.7], [-3, 3], PAINT.sand);
  wedge(builder, [-4.5, 1.5], [2.7, -3], [4.3, 3], PAINT.charcoal, PAINT.sand);
  box(builder, [1.5, 4.5], [0, 2.5], [-2.5, 2], PAINT.timber, PAINT.flatRoof);
  onFront(builder, 3, [-4, 1], [3, 3.9], PAINT.glass);
  onFront(builder, 3, [-3.9, -0.9], [0.5, 2.3], PAINT.glass);
  onFront(builder, 3, [-0.3, 0.6], [0, 2.1], PAINT.door);
  onFront(builder, 2, [1.9, 4.1], [0, 2.1], PAINT.shutter);
  onSide(builder, -4.5, -1, [-1.8, 1.2], [0.9, 2.2], PAINT.glass);
  return builder.done('house_single_pitch');
}

/** Two storeys with a gable to the road, glazed from the ground to the eaves, and a garage. */
function gableFrontHouse(): GeneratedShape {
  const builder = new ShapeBuilder();
  box(builder, [-4, 1.6], [0, 5.2], [-3.6, 3.6], PAINT.render);
  gableRoof(builder, [-4, 1.6], [5.2, 8], [-3.6, 3.6], PAINT.slate, PAINT.render);
  box(builder, [1.6, 4.5], [0, 2.6], [-2.8, 2.2], PAINT.charcoal, PAINT.flatRoof);
  onFront(builder, 3.6, [-3.4, -1], [0.5, 4.9], PAINT.glass);
  onFront(builder, 3.6, [0, 0.9], [0, 2.1], PAINT.timber);
  onFront(builder, 3.6, [-0.1, 1], [3.2, 4.6], PAINT.glass);
  onFront(builder, 2.2, [1.95, 4.15], [0, 2.1], PAINT.shutter);
  onSide(builder, -4, -1, [-2, 0.5], [3.2, 4.6], PAINT.glass);
  return builder.done('house_gable_front');
}

/** A single-storey shop: glass either side of its door, a sign across it and an awning. */
function shopFront(): GeneratedShape {
  const builder = new ShapeBuilder();
  box(builder, [-4.5, 4.5], [0, 4], [-3, 2.6], PAINT.concrete, PAINT.flatRoof);
  onFront(builder, 2.6, [-4.5, 4.5], [3.05, 3.8], PAINT.navy);
  onFront(builder, 2.6, [-4.1, -0.6], [0.3, 2.5], PAINT.glass);
  onFront(builder, 2.6, [0.6, 4.1], [0.3, 2.5], PAINT.glass);
  onFront(builder, 2.6, [-0.45, 0.45], [0, 2.4], PAINT.door);
  wedge(builder, [-4.3, 4.3], [2.6, 3.6], [3, 2.6], PAINT.amber, PAINT.amber, PAINT.amber);
  onSide(builder, -4.5, -1, [-1.6, 1.2], [0.9, 2.4], PAINT.glass);
  onSide(builder, 4.5, 1, [-1.6, 1.2], [0.9, 2.4], PAINT.glass);
  return builder.done('shop_front');
}

/** A shop with a storey of flats over it, in brick, under a parapet. */
function shopWithFlats(): GeneratedShape {
  const builder = new ShapeBuilder();
  box(builder, [-4, 4], [0, 7], [-3, 2.8], PAINT.brick);
  box(builder, [-4, 4], [7, 7.25], [-3, 2.8], PAINT.concrete, PAINT.flatRoof);
  onFront(builder, 2.8, [-4, 4], [2.95, 3.5], PAINT.door);
  onFront(builder, 2.8, [-3.6, -0.7], [0.3, 2.5], PAINT.glass);
  onFront(builder, 2.8, [0.7, 3.6], [0.3, 2.5], PAINT.glass);
  onFront(builder, 2.8, [-0.5, 0.5], [0, 2.4], PAINT.door);
  for (const left of [-3.2, -0.7, 1.8]) {
    onFront(builder, 2.8, [left, left + 1.4], [4.3, 6], PAINT.glass);
  }
  wedge(builder, [-3.8, 3.8], [2.5, 3.7], [2.9, 2.8], PAINT.red, PAINT.red, PAINT.red);
  onSide(builder, -4, -1, [-1.2, 0.6], [4.3, 6], PAINT.glass);
  onSide(builder, 4, 1, [-1.2, 0.6], [4.3, 6], PAINT.glass);
  return builder.done('shop_with_flats');
}

/** Three storeys of offices: a band of glass a storey, a canopy over the door, and plant on the roof. */
function lowOffice(): GeneratedShape {
  const builder = new ShapeBuilder();
  box(builder, [-3.8, 3.8], [0, 8.6], [-3, 2.8], PAINT.concrete, PAINT.flatRoof);
  box(builder, [-1.5, 1.5], [8.6, 9], [-1.6, 0.6], PAINT.flatRoof);
  box(
    builder,
    [-1.2, 1.2],
    [2.5, 2.65],
    [2.8, 3.7],
    PAINT.charcoal,
    PAINT.charcoal,
    PAINT.charcoal,
  );
  onFront(builder, 2.8, [-3.4, -0.9], [0.9, 2.3], PAINT.glass);
  onFront(builder, 2.8, [0.9, 3.4], [0.9, 2.3], PAINT.glass);
  onFront(builder, 2.8, [-0.7, 0.7], [0, 2.4], PAINT.door);
  for (const sill of [3.75, 6.6]) {
    onFront(builder, 2.8, [-3.4, 3.4], [sill, sill + 1.4], PAINT.glass);
    onSide(builder, -3.8, -1, [-2.4, 2.2], [sill, sill + 1.4], PAINT.glass);
    onSide(builder, 3.8, 1, [-2.4, 2.2], [sill, sill + 1.4], PAINT.glass);
  }
  return builder.done('office_low');
}

/**
 * The shapes each kind's meshes are drawn with BESIDE the model each already
 * has — by kind, then by mesh (`scenery-models.ts` §`SCENERY_MODELS`' order),
 * then by fold, the model being fold 0.
 *
 * ⚠️ **A building's are its settings, in {@link SETTING_FOLD}'s order**: fold
 * 1 the suburban house, fold 2 the commercial front. A natural kind's are
 * picked by where the item stands ({@link stylisedFoldOf}).
 *
 * ⚠️ **Order is load-bearing**, as `SCENERY_MODELS`' is: reordering a list
 * changes what stands where on every route.
 */
export const STYLISED_FOLDS: Partial<Record<SceneryKind, readonly (readonly GeneratedShape[])[]>> =
  {
    'tree-broadleaf': [[roundTree()], [columnTree()]],
    'tree-conifer': [[spruceTree()], [firTree()]],
    rock: [[boulder()], [slab()]],
    building: [
      [flatRoofedHouse(), shopFront()],
      [singlePitchHouse(), shopWithFlats()],
      [gableFrontHouse(), lowOffice()],
    ],
  };

/**
 * The most triangles a generated shape of each kind may be: the heaviest
 * committed model of the kind it joins — a building 1 024
 * (`building-type-k`), a broadleaf 196 (`tree_oak`), a conifer 170
 * (`tree_pineRoundD`), a rock 80 (`stone_largeA`). #3287's fourth criterion;
 * no ceiling is new.
 *
 * @test-facing held by `stylised-shapes.test.ts`, which also reads the four
 * figures back off the committed files; the renderer draws whatever the table
 * holds
 */
export const GENERATED_TRIANGLE_CEILINGS: Partial<Record<SceneryKind, number>> = {
  'tree-broadleaf': 196,
  'tree-conifer': 170,
  rock: 80,
  building: 1_024,
};

/**
 * The most triangles the shapes folded into ONE mesh may come to together:
 * **100**. Every instance of a mesh submits every shape the mesh holds, so
 * this is the most #3287 adds to any one item — a building's two are 70 to
 * 86, a tree's one 30 to 72 — whatever a later shape weighs on its own.
 *
 * @test-facing held by `stylised-shapes.test.ts`; `game.browser.spec.ts`
 * §`FOLDED_FRAME_TRIANGLES` is the same sums on a frame a driver drew
 */
export const FOLDED_TRIANGLES_A_MESH = 100;

/** The seed a place's shape and tint are hashed from: their own, so neither follows anything `scatter.ts` drew there. */
const PLACE_SEED = 0x57f1_3287;

/** Where an item stands, to a sixteenth of a metre: `instance-tint.ts`' key, for its reason. */
const KEY_STEPS_PER_METRE = 16;

/** One hash stream each: the shape, the darkening, the lean. */
const FOLD_STREAM = 0;
const DARKEN_STREAM = 1;
const LEAN_STREAM = 2;

function placeKey(x: number, z: number): number {
  return mixInto(
    mixInto(PLACE_SEED, Math.round(x * KEY_STEPS_PER_METRE)),
    Math.round(z * KEY_STEPS_PER_METRE),
  );
}

/**
 * Which of its mesh's `folds` shapes an item is drawn as — #3287. Allocates
 * nothing: a frame asks for every item it draws.
 *
 * - A **building** is its setting's: the model on a rural stretch or where
 *   there is no class, fold 1 on a suburban one, fold 2 on a commercial one.
 *   A mesh with fewer folds draws its last.
 * - A **tree or a rock** is picked by where it stands, evenly, so it is the
 *   same on every frame, on lap two and on the next ride.
 * - A mesh with one shape draws it.
 */
export function stylisedFoldOf(
  item: Pick<ScatterItem, 'kind' | 'x' | 'z' | 'setting'>,
  folds: number,
): number {
  if (!(folds > 1)) return 0;
  if (item.kind === 'building') {
    return Math.min(folds - 1, SETTING_FOLD[item.setting ?? 'rural']);
  }
  return Math.min(
    folds - 1,
    Math.floor(uniformFrom(placeKey(item.x, item.z), FOLD_STREAM) * folds),
  );
}

/**
 * The name of the shape an item is drawn as, with `meshes` shapes a kind at
 * this rung (`quality.ts` §`sceneryVariants`): the model's file name, or the
 * generated shape's. `undefined` for a kind drawn from no table — a post, a
 * barn, a wall.
 *
 * @test-facing the scenery plan read as shapes, for
 * `stylised-settings.test.ts`; the renderer draws by mesh and fold and needs
 * no name
 */
export function stylisedShapeNameOf(
  item: Pick<ScatterItem, 'kind' | 'x' | 'z' | 'setting' | 'variant'>,
  models: readonly { readonly name: string }[],
  meshes: number = models.length,
): string | undefined {
  const shapes = Math.min(models.length, meshes);
  if (!(shapes > 0)) return undefined;
  const wanted = Number.isInteger(item.variant) ? item.variant : 0;
  const mesh = ((wanted % shapes) + shapes) % shapes;
  const generated = STYLISED_FOLDS[item.kind]?.[mesh] ?? [];
  const fold = stylisedFoldOf(item, 1 + generated.length);
  return fold === 0 ? models[mesh]?.name : generated[fold - 1]?.name;
}

/** How far a kind's instances may be darkened, and leaned warm or cool, as shares of a channel. */
interface StylisedTintBound {
  readonly darken: number;
  readonly lean: number;
}

/**
 * The bounds, by kind — #3287: foliage up to a fifth darker and an eighth
 * warmer or cooler; stone less of both, because a rock reads wrong sooner
 * than a leaf does (`instance-tint.ts` says the same of the realistic world).
 * A kind with no entry is drawn as it is.
 */
const STYLISED_TINTS: Partial<Record<SceneryKind, StylisedTintBound>> = {
  'tree-broadleaf': { darken: 0.2, lean: 0.12 },
  'tree-conifer': { darken: 0.2, lean: 0.12 },
  shrub: { darken: 0.2, lean: 0.12 },
  rock: { darken: 0.14, lean: 0.04 },
};

/** Whether a kind's instances are tinted at all — #3287: the trees, the shrub and the rock. */
export function stylisedTinted(kind: SceneryKind): boolean {
  return STYLISED_TINTS[kind] !== undefined;
}

/**
 * The least any channel of a tint can be: the darkest foliage, leaned all the
 * way. Every channel of every tint is between this and 1.
 *
 * @test-facing the bound `stylised-shapes.test.ts` holds every tint inside;
 * the renderer writes what {@link writeStylisedTint} gives it
 */
export const STYLISED_TINT_FLOOR = Math.min(
  ...Object.values(STYLISED_TINTS).map((bound) => (1 - bound.darken) * (1 - bound.lean)),
);

/**
 * Writes the tint of the item of `kind` standing at `(x, z)` into `out` at
 * `at`: three numbers its colour is multiplied by — #3287. Allocates nothing.
 *
 * ⚠️ **Never above 1 in any channel**, so a tint only ever darkens: a colour
 * `scenery-palette.ts` holds under the sun's ceiling stays under it, and that
 * file's gate needs no second case. Warm takes the blue down and cool the
 * red; the green of a leaf is left alone.
 */
export function writeStylisedTint(
  kind: SceneryKind,
  x: number,
  z: number,
  out: Float32Array,
  at: number,
): void {
  const bound = STYLISED_TINTS[kind];
  if (bound === undefined) {
    out[at] = 1;
    out[at + 1] = 1;
    out[at + 2] = 1;
    return;
  }
  const key = placeKey(x, z);
  const light = 1 - bound.darken * uniformFrom(key, DARKEN_STREAM);
  const lean = bound.lean * (2 * uniformFrom(key, LEAN_STREAM) - 1);
  out[at] = light * (lean < 0 ? 1 + lean : 1);
  out[at + 1] = light;
  out[at + 2] = light * (lean > 0 ? 1 - lean : 1);
}
