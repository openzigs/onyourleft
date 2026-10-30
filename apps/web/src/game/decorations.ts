// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Where a village's holiday decorations go — #1624, the decoration belt's
 * placement half (epic #1621).
 *
 * Two steps, both pure and seeded:
 *
 * 1. **Anchors**, once a village — {@link villageAnchors}, called by
 *    `streets.ts` §`streetOf` when it builds the village's street, so each
 *    village's anchors are built once a route and carried on its
 *    `VillageStreet` by reference, as its pavements are. An anchor is a place
 *    an item may stand: a point in the corridor's frame, a yaw that turns an
 *    item's own `+z` to the road, and how far the point is from the
 *    carriageway's edge.
 * 2. **Items**, from the anchors in reach — {@link decorationsFor}: for the
 *    holiday on, each anchor takes at most one of that holiday's
 *    {@link DecorationKind}s, by a roll drawn from the anchor's own hash.
 *    No holiday is no item.
 *
 * ## The anchors, and where each comes from
 *
 * | kind | from | where |
 * |---|---|---|
 * | `lamp-post` | `streets.ts` §`furnish`'s lamp posts, every `LAMP_SPACING_METRES` | the post's foot, on the pavement |
 * | `doorstep` | `streets.ts` §`doorPathOf`, the path to a built plot's front door | the path's end at the door |
 * | `eave` | the same door, and the building's plan (`buildings.ts` §`buildingPlan`) | above the door, at the eaves: the lowest point of the plan's roof |
 * | `green` | `settlements.ts` §`everyVillagePlot`'s middle plot, the crossroads, which is never built | either side of the side road's mouth, on each side of the road |
 * | `porch-step` | — | **none yet**: no village building draws a porch, in either world. Porches are drawn on mapped houses (`footprint-buildings.ts` §`frontPorchOf`) and lots (`buildings.ts` §`LOT_PORCH`), which are not villages. The kind is in the type so #1625's table can name it; it places nothing until a village draws a porch |
 *
 * A `doorstep` of a built plot also carries the door's own **step**
 * ({@link AnchorStep}, #1625): the block `buildings.ts` lays before every
 * door, its top and its tread. A kind that stands on a step
 * ({@link DecorationKind.onStepOf}) is placed only on an anchor whose step is
 * the door of one of its buildings, stands on that step's top, and only where
 * every one of its parts lies inside the tread.
 *
 * ## Halloween — #1625
 *
 * {@link HOLIDAY_DECORATIONS}' Halloween set is four arrangements of one to
 * three pumpkins, a jack-o'-lantern in three of them, on the door step of a
 * HOUSE (`building`) only: never a shop row's, a barn's or a shed's, and the
 * church's anchors are never made. Each anchor is offered them in turn at
 * {@link HALLOWEEN_CHANCE} each, so about **46 %** of the houses with a front
 * path get one — the owner's research suggested 40 to 60 %. A pumpkin is a
 * ribbed lathe ({@link PUMPKIN}) with a stalk; a jack-o'-lantern's face is
 * three small quads that glow, steady, and is simple rather than frightening.
 *
 * ⚠️ **Never the church plot**: a church's door and eaves are not decorated —
 * {@link villageAnchors} drops every anchor of a plot whose kind is
 * `church`. Its pavement and the lamp posts on it are the street's, not the
 * plot's, and keep theirs.
 *
 * ⚠️ **Never in the carriageway**: every anchor records its distance from the
 * carriageway's edge (`road-grid.ts` §`distanceToDrawnRoad`, the WHOLE road,
 * so a hairpin's other leg counts) or from the edge of the village's own
 * crossroads (`cross-streets.ts` §`villageSideRoad`, the side road as it is
 * drawn — #1690), whichever is nearer, and {@link decorationsFor} places no
 * item whose footprint {@link DecorationKind.radius} is wider than that. A
 * green anchor in water, nearer the road than {@link GREEN_CLEAR_METRES} or
 * nearer the side road than {@link GREEN_SIDE_ROAD_CLEAR_METRES}, is not made
 * at all: on a bend the green's inner side swings toward the side road's
 * line, and a tight enough one puts it on the side road.
 *
 * ## The village-square tree — #1627
 *
 * The winter lights' fourth kind is ONE tree a village
 * ({@link DecorationKind.perVillage}), on one of its crossroads green's
 * anchors, chosen by their rolls: a trunk, four stacked cones and twenty
 * steady baubles, {@link TREE_HEIGHT_METRES} tall, 272 triangles, in the
 * belt's one call. A green anchor's clearance is also to the nearest of the
 * village's buildings (the shop rows beside the crossroads, as
 * `settlements.ts` stands them, or their house model's larger ground), so
 * its footprint stands on the green and on nothing built.
 *
 * A village with no street (`streets.ts` returns none where no pavement can
 * be laid) has no anchors either: a lamp post, a front path and a crossroads
 * all belong to the street.
 *
 * Nothing here is fetched or sent anywhere, and no coordinate is formatted
 * into a string. Pure, and names no rendering library.
 */

import { distanceOnRoute, type RouteProfile } from '@onyourleft/domain';

import { buildingPlan, frontDoorOf, isBuiltKind, type BuiltKind } from './buildings';
import { plotModelFootprint } from './house-models';
import {
  distanceToSideRoads,
  SIDE_ROAD_SCENERY_MARGIN_METRES,
  VILLAGE_MOUTH_HALF_METRES,
  villageSideRoad,
} from './cross-streets';
import type { LandClassMask } from './land-class';
import { terrainHeightAt } from './landform';
import { distanceToDrawnRoad } from './road-grid';
import type { Holiday } from './season';
import { slotHash, uniformFrom } from './seeded';
import {
  everyVillagePlot,
  PLOT_METRES,
  SETBACK_METRES,
  STRUCTURE_FOOTPRINTS,
  type Footprint,
  type Plot,
  type Site,
} from './settlements';
import type { DoorPath, FurnitureItem } from './streets';
import { drawnRoadFrame, ROAD_WIDTH_METRES, type CorridorOrigin } from './terrain';
import { inWater, waterways } from './waterways';

/** The places an item may stand. @see the header */
export type AnchorKind = 'porch-step' | 'doorstep' | 'lamp-post' | 'eave' | 'green';

/**
 * Every {@link AnchorKind}, in a fixed order.
 *
 * @test-facing the owner's page's probe stands on every kind
 * (`browser/realistic/config.ts` §`PROBE_DECORATIONS`), as `decorations.test.ts`
 * and `decoration-belt.test.ts` do; a ride's kinds name their own anchors
 */
export const ANCHOR_KINDS: readonly AnchorKind[] = [
  'porch-step',
  'doorstep',
  'lamp-post',
  'eave',
  'green',
];

/**
 * A door's step under a `doorstep` anchor — #1625. The tread is item-local
 * to the anchor: `x` across the door from `-halfWidth` to `halfWidth`, `z`
 * out from the wall from 0 to `depth`.
 */
export interface AnchorStep {
  /** The step's top, corridor-frame height in metres. */
  readonly top: number;
  readonly halfWidth: number;
  readonly depth: number;
  /** What the step is the door of. */
  readonly building: BuiltKind;
}

/** One place an item may stand, in the corridor's local metres. */
export interface DecorationAnchor {
  readonly kind: AnchorKind;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Yaw, radians: three's, so an item's own `+z` ends up facing the road. */
  readonly yaw: number;
  /**
   * How far the point is from the nearest carriageway's edge, metres: the
   * main road's or, since #1690, its village's crossroads side road's.
   */
  readonly clear: number;
  /** The anchor's own hash, from the route's seed, its village and its place in it. */
  readonly hash: number;
  /** A `doorstep`'s door step, where its building lays one — #1625. */
  readonly step?: AnchorStep;
}

/**
 * What one part is made of — #1625. Each fills the box its
 * {@link DecorationPart.size} spans about its {@link DecorationPart.at}:
 *
 * - `box` — the box itself, **12** triangles (the default).
 * - `pumpkin` — a ribbed lathe ({@link PUMPKIN}), its widest ribs on the
 *   box's sides, its foot on the box's floor, **96** triangles.
 * - `stalk` — an open cylinder, **10** triangles.
 * - `face` — one flat quad in the box's middle, facing `+z`, **2** triangles.
 * - `bulb` — an octahedron, **8** triangles (#1626).
 * - `wreath` — a ring in the box's `xy` plane, facing `+z`, **80** triangles
 *   (#1626).
 * - `cone` — a closed cone, its base on the box's floor and its point at
 *   the middle of its top, ten sides, **20** triangles (#1627).
 * - `trunk` — a closed cylinder, eight sides, **32** triangles (#1627).
 */
export type DecorationShape =
  'box' | 'pumpkin' | 'stalk' | 'face' | 'bulb' | 'wreath' | 'cone' | 'trunk';

/** One box of an item, item-local: `+z` faces the road, `y` up from the anchor. */
export interface DecorationPart {
  /** Width, height and depth, metres. */
  readonly size: readonly [number, number, number];
  /** Where the box's middle is, metres. */
  readonly at: readonly [number, number, number];
  /** Its colour, sRGB, as `0xrrggbb`. */
  readonly colour: number;
  /** What it is made of; a box where this is absent. */
  readonly shape?: DecorationShape;
  /**
   * Whether it glows: drawn its own colour whatever the light, in the belt's
   * one call (`three-renderer.ts` §`DecorationBelt`). Steady — nothing about
   * it changes from frame to frame (WCAG 2.3.1).
   */
  readonly glows: boolean;
}

/** One kind of item a holiday may place. */
export interface DecorationKind {
  /** Its name, which {@link DecorationItem.item} carries. */
  readonly item: string;
  /** Where it may stand. */
  readonly anchors: readonly AnchorKind[];
  /** The share of those anchors it takes, 0 to 1, before any kind after it. */
  readonly chance: number;
  /** How far its footprint reaches from the anchor, metres: held off the carriageway by it. */
  readonly radius: number;
  /** Its boxes, built from these numbers in both worlds. */
  readonly parts: readonly DecorationPart[];
  /**
   * Where present, it stands only on the door step of one of these buildings
   * — on the step's top, every part inside its tread — #1625. @see AnchorStep
   */
  readonly onStepOf?: readonly BuiltKind[];
  /**
   * `'one'` — #1627: at most one of a village's anchors is offered it, the
   * one of those it may stand on whose roll is lowest, and it still rolls
   * under {@link chance} there. Absent, every anchor is offered it.
   */
  readonly perVillage?: 'one';
}

/** The kinds each holiday places, in the order an anchor is offered them. */
export type ItemTable = Readonly<Partial<Record<Holiday, readonly DecorationKind[]>>>;

/**
 * A pumpkin's shape, unit-sized — #1625: a lathe of {@link PUMPKIN.profile}
 * (`[radius, height]` pairs from its foot up to the middle of its top)
 * turned in {@link PUMPKIN.segments} steps, every radius scaled by
 * `1 + ribDepth · cos(ribs · θ)` so it has {@link PUMPKIN.ribs} ribs, θ
 * turning from `+z`. Its widest rib reaches exactly 0.5, so a pumpkin fills
 * its part's box. Open at the foot, which stands on a step; 96 triangles.
 * `three-renderer.ts` builds it from these numbers.
 */
export const PUMPKIN: {
  readonly segments: number;
  readonly ribs: number;
  readonly ribDepth: number;
  readonly profile: readonly (readonly [number, number])[];
} = {
  segments: 16,
  ribs: 8,
  ribDepth: 0.05,
  profile: [
    [0.27, 0],
    [0.5 / 1.05, 0.45],
    [0.38, 0.94],
    [0, 1],
  ],
};

/**
 * How far forward of its middle a unit pumpkin's surface is, at `x` across
 * and `y` up (both unit, `y` from its foot): the faceted surface
 * `three-renderer.ts` draws, so a face set on it is neither sunk in it nor
 * floating off it.
 */
export function pumpkinFrontAt(x: number, y: number): number {
  const { profile, segments, ribs, ribDepth } = PUMPKIN;
  let radius = 0;
  for (let at = 1; at < profile.length; at += 1) {
    const [r0, y0] = profile[at - 1] as readonly [number, number];
    const [r1, y1] = profile[at] as readonly [number, number];
    if (y <= y1 || at === profile.length - 1) {
      radius = r0 + ((r1 - r0) * (Math.min(Math.max(y, y0), y1) - y0)) / (y1 - y0);
      break;
    }
  }
  const corner = (step: number): readonly [number, number] => {
    const theta = (step * 2 * Math.PI) / segments;
    const r = radius * (1 + ribDepth * Math.cos(ribs * theta));
    return [Math.sin(theta) * r, Math.cos(theta) * r];
  };
  const side = Math.abs(x);
  for (let step = 0; step < segments / 4; step += 1) {
    const [ax, az] = corner(step);
    const [bx, bz] = corner(step + 1);
    if (side <= bx) return az + ((bz - az) * (side - ax)) / (bx - ax);
  }
  return 0;
}

/** Halloween's lit colours, sRGB — #1625: held under "lights no colour past white". */
const PUMPKIN_ORANGE = 0xd0691c;
const PUMPKIN_PALE = 0xd88a3a;
const STALK_GREEN = 0x5b5a26;
/** A jack-o'-lantern's face: it glows, drawn its own colour whatever the light. */
const FACE_GLOW = 0xffc24a;

/** A pumpkin's height for its width. */
const PUMPKIN_SQUAT = 0.8;

/** Where a pumpkin's middle stands out from the wall: the middle of a door step's tread. */
const ON_THE_STEP = 0.175;

/**
 * One pumpkin's parts, `diameter` wide, its middle `x` across the door and
 * `z` out from the wall, its foot on the step: a body, a stalk and — for a
 * jack-o'-lantern — a face of two eyes and a mouth, each set just proud of
 * the body's surface where it is.
 */
function pumpkin(
  x: number,
  z: number,
  diameter: number,
  colour: number,
  lantern: boolean,
): DecorationPart[] {
  const height = diameter * PUMPKIN_SQUAT;
  const parts: DecorationPart[] = [
    {
      shape: 'pumpkin',
      size: [diameter, height, diameter],
      at: [x, height / 2, z],
      colour,
      glows: false,
    },
    {
      shape: 'stalk',
      size: [diameter * 0.12, height * 0.2, diameter * 0.12],
      at: [x, height * 1.02, z],
      colour: STALK_GREEN,
      glows: false,
    },
  ];
  if (!lantern) return parts;
  // Two square eyes and a wide mouth: friendly, not frightening.
  // [across, up, width, height], each a share of the pumpkin's own.
  const features: readonly (readonly [number, number, number, number])[] = [
    [-0.17, 0.62, 0.1, 0.12],
    [0.17, 0.62, 0.1, 0.12],
    [0, 0.34, 0.26, 0.1],
  ];
  for (const [across, up, width, tall] of features) {
    // Proud of the surface at its edges and its middle, by 4 mm.
    const front = Math.max(
      pumpkinFrontAt(across - width / 2, up),
      pumpkinFrontAt(across, up),
      pumpkinFrontAt(across + width / 2, up),
    );
    parts.push({
      shape: 'face',
      size: [width * diameter, tall * height, 0],
      at: [x + across * diameter, up * height, z + front * diameter + 0.004],
      colour: FACE_GLOW,
      glows: true,
    });
  }
  return parts;
}

/**
 * The share of the anchors each Halloween kind takes before the next is
 * offered — #1625: four kinds at 0.145 each place on `1 − 0.855⁴`, about
 * 46 %, of the houses with a front path. @see the header
 */
export const HALLOWEEN_CHANCE = 0.145;

/**
 * How far a Halloween item reaches from its anchor, metres: the tread's
 * corner from the door's middle. The step is what holds it; this keeps it
 * off a carriageway no front path could reach.
 */
const HALLOWEEN_RADIUS = 0.75;

/** One Halloween kind: on a house's door step only. */
function halloween(item: string, parts: readonly DecorationPart[]): DecorationKind {
  return {
    item,
    anchors: ['porch-step', 'doorstep'],
    chance: HALLOWEEN_CHANCE,
    radius: HALLOWEEN_RADIUS,
    parts,
    onStepOf: ['building'],
  };
}

/**
 * The Halloween kinds — #1625: one to three pumpkins either side of a house's
 * door, on its step. Every number keeps every part inside a house door's step
 * (`buildings.ts` §`DOOR`, 1 m wide, and §`DOOR_STEP_*`: a tread 1.3 m by
 * 0.35 m), which {@link decorationsFor} checks again for every anchor.
 */
const HALLOWEEN: readonly DecorationKind[] = [
  halloween('jack-o-lantern', pumpkin(0.49, ON_THE_STEP, 0.3, PUMPKIN_ORANGE, true)),
  halloween('pumpkin', pumpkin(-0.5, ON_THE_STEP, 0.28, PUMPKIN_PALE, false)),
  halloween('pumpkin-pair', [
    ...pumpkin(-0.49, ON_THE_STEP, 0.3, PUMPKIN_ORANGE, true),
    ...pumpkin(0.51, ON_THE_STEP, 0.26, PUMPKIN_PALE, false),
  ]),
  halloween('pumpkin-trio', [
    ...pumpkin(0.49, ON_THE_STEP, 0.3, PUMPKIN_ORANGE, true),
    ...pumpkin(0.245, ON_THE_STEP, 0.18, PUMPKIN_PALE, false),
    ...pumpkin(-0.52, ON_THE_STEP, 0.24, PUMPKIN_ORANGE, false),
  ]),
];

/**
 * A bulb's size, metres: **12 cm** across — #1626: twice a real festoon
 * bulb's, so that from the saddle it reads as a coloured dot in daylight, as
 * the owner accepted for v1 (no bloom, #703); at 6 cm it was a pixel at most.
 */
export const BULB_METRES = 0.12;

/**
 * The winter lights' colours, sRGB — #1626: warm white and soft colours, and
 * no red, so no string alternates red and white. Every bulb glows, steady.
 */
export const BULB_WARM_WHITE = 0xffe6b8;
const BULB_SOFT: readonly number[] = [BULB_WARM_WHITE, 0xffc574, 0xb4e2a4, 0xb0ccff];

/**
 * A wreath's evergreen and its berries and bow, sRGB — #1626: lit, so held
 * under "lights no colour past white"; the door's facade draws the mapped
 * buildings' wreaths in the same two (`three-renderer.ts` §`WREATH_GLSL`).
 */
export const WREATH_GREEN = 0x2f5a2c;
export const WREATH_BERRY = 0xa3242a;

/**
 * How many bulbs wind a lamp post, and from where to where up it, metres:
 * **12**, from 1.4 m to 4.6 m — under the lamp's arm, which leaves the post
 * at 5.2 m (`three-renderer.ts` §`FURNITURE_STYLE`).
 */
const POST_BULBS = 12;
const POST_FROM = 1.4;
const POST_TO = 4.6;

/**
 * How far out from the post's middle a bulb's middle is, metres: the post is
 * 0.06 to 0.07 m across its radius, so a bulb touches it. Never further, so
 * no bulb on a post is ever over the carriageway the post stands back from.
 */
const POST_WIND = 0.12;

/** A lamp post wound with warm-white bulbs, a spiral up the post. */
function postLights(): DecorationPart[] {
  return Array.from({ length: POST_BULBS }, (_, at) => {
    const turn = at * 0.75 * Math.PI;
    return {
      shape: 'bulb',
      size: [BULB_METRES, BULB_METRES, BULB_METRES],
      at: [
        Math.sin(turn) * POST_WIND,
        POST_FROM + ((POST_TO - POST_FROM) * at) / (POST_BULBS - 1),
        Math.cos(turn) * POST_WIND,
      ],
      colour: BULB_WARM_WHITE,
      glows: true,
    } satisfies DecorationPart;
  });
}

/**
 * How many bulbs string along the eaves above a door, and how wide, metres:
 * **9** over **2.4 m**, the door's middle in the string's — narrower than any
 * village house's front, so the string never reaches past a corner.
 */
const EAVE_BULBS = 9;
const EAVE_HALF = 1.2;

/** A string of soft-coloured bulbs under the eaves, sagging a little between its ends. */
function eaveLights(): DecorationPart[] {
  return Array.from({ length: EAVE_BULBS }, (_, at) => {
    const across = -EAVE_HALF + (2 * EAVE_HALF * at) / (EAVE_BULBS - 1);
    const sag = 0.06 * (1 - (across / EAVE_HALF) ** 2);
    return {
      shape: 'bulb',
      size: [BULB_METRES, BULB_METRES, BULB_METRES],
      at: [across, -0.12 - sag, 0.22],
      colour: BULB_SOFT[at % BULB_SOFT.length] as number,
      glows: true,
    } satisfies DecorationPart;
  });
}

/**
 * A wreath on a village door, on its step's frame: an evergreen ring and a
 * bow, its middle 1.45 m above the threshold, just proud of the wall. A
 * village door is cut in triangles (`buildings.ts`), so its wreath is too;
 * a mapped building's door is drawn in the shader, and so is its wreath.
 */
function doorWreath(): DecorationPart[] {
  return [
    {
      shape: 'wreath',
      size: [0.46, 0.46, 0.08],
      at: [0, 1.45, 0.05],
      colour: WREATH_GREEN,
      glows: false,
    },
    {
      size: [0.1, 0.07, 0.03],
      at: [0, 1.45 - 0.2, 0.095],
      colour: WREATH_BERRY,
      glows: false,
    },
  ];
}

/**
 * The share of their anchors the winter kinds take — #1626: most lamp posts,
 * and about half the eaves and the doors. Seeded, as every kind is.
 */
export const WINTER_CHANCE = { post: 0.75, eaves: 0.5, wreath: 0.5 } as const;

/** The village-square tree's {@link DecorationKind.item} — #1627. */
export const VILLAGE_TREE = 'village-tree';

/**
 * The village-square tree's evergreen and its trunk, sRGB — #1627: lit, so
 * held under "lights no colour past white", and a green of its own, darker
 * than {@link WREATH_GREEN}, so a test can find the tree's vertices in the
 * belt's mesh by it.
 */
export const TREE_GREEN = 0x1f4a29;
export const TREE_TRUNK = 0x5a3b24;

/**
 * How tall the village-square tree is, metres: **6** — #1627 asked for 5 to
 * 7, so that it reads among the two-storey houses at 120 m, the edge of
 * `streets.ts` §`FURNITURE_DRAW_METRES`.
 */
export const TREE_HEIGHT_METRES = 6;

/**
 * The tree's four tiers, from the bottom: where each cone's base stands, how
 * tall it is and how wide its base, metres. Each tier's base is inside the
 * one below, which covers it, and the top tier's point is
 * {@link TREE_HEIGHT_METRES}.
 */
const TREE_TIERS: readonly (readonly [number, number, number])[] = [
  [0.7, 2.1, 2.8],
  [1.9, 1.9, 2.3],
  [3.0, 1.7, 1.8],
  [4.1, TREE_HEIGHT_METRES - 4.1, 1.2],
];

/** The tree's trunk: how wide and how tall, metres, from the ground into the bottom tier. */
const TREE_TRUNK_WIDTH = 0.36;
const TREE_TRUNK_HEIGHT = 0.9;

/**
 * How many baubles hang on each tier, from the bottom — **20** in all, inside
 * #1627's 12 to 24 — and how big each is, metres: **0.2**, an octahedron that
 * reads as a coloured dot at 120 m, as {@link BULB_METRES} does at 60 m.
 */
const TREE_BAUBLES: readonly number[] = [7, 6, 4, 3];
export const BAUBLE_METRES = 0.2;

/** How far up its tier a bauble hangs, as a share of the tier's height: below the next tier's skirt. */
const BAUBLE_UP = 0.2;

/**
 * How far out from the tier's surface a bauble's middle is, metres: a ten-sided
 * cone's faces are 5 % inside its corners, so a bauble set on the corners'
 * circle and this far out is proud of every face and touches the tree.
 */
const BAUBLE_PROUD = 0.03;

/**
 * The village-square tree — #1627: a short trunk, four stacked cones and
 * {@link TREE_BAUBLES} baubles in {@link BULB_SOFT}'s colours, every bauble
 * glowing and steady. Owner ruling (b) of 2026-10-24: built from numbers, no
 * asset, and no religious symbol — so no star or angel on top, only baubles.
 * Not the generated firs, which draw a depth pre-pass: this is one more item
 * in the belt's one call. 272 triangles.
 */
function villageTree(): DecorationPart[] {
  const parts: DecorationPart[] = [
    {
      shape: 'trunk',
      size: [TREE_TRUNK_WIDTH, TREE_TRUNK_HEIGHT, TREE_TRUNK_WIDTH],
      at: [0, TREE_TRUNK_HEIGHT / 2, 0],
      colour: TREE_TRUNK,
      glows: false,
    },
  ];
  let bauble = 0;
  for (const [tier, [base, height, width]] of TREE_TIERS.entries()) {
    parts.push({
      shape: 'cone',
      size: [width, height, width],
      at: [0, base + height / 2, 0],
      colour: TREE_GREEN,
      glows: false,
    });
    const count = TREE_BAUBLES[tier] as number;
    const out = (width / 2) * (1 - BAUBLE_UP) + BAUBLE_PROUD;
    for (let at = 0; at < count; at += 1) {
      // Each tier's ring turned half a gap from the one below.
      const turn = ((at + (tier % 2) / 2) / count) * 2 * Math.PI;
      parts.push({
        shape: 'bulb',
        size: [BAUBLE_METRES, BAUBLE_METRES, BAUBLE_METRES],
        at: [Math.sin(turn) * out, base + height * BAUBLE_UP, Math.cos(turn) * out],
        colour: BULB_SOFT[bauble % BULB_SOFT.length] as number,
        glows: true,
      });
      bauble += 1;
    }
  }
  return parts;
}

/**
 * The winter lights' kinds — #1626, about 1 Dec to 6 Jan. Steady (WCAG
 * 2.3.1): every bulb glows its own colour and nothing changes from frame to
 * frame. No religious symbol: lights, an evergreen wreath and a bow. Never the
 * church (its anchors are never made), and never over the road: a post's
 * bulbs wind the post, and an eave's string hangs from the house. Since
 * #1627, ONE village-square tree a village, on a green anchor
 * ({@link DecorationKind.perVillage}): the crossroads' middle plot, which
 * is never built, so its footprint — its bottom tier's base — is held off
 * the carriageway and the side road by the anchor's clearance.
 */
const WINTER_LIGHTS: readonly DecorationKind[] = [
  {
    item: 'post-lights',
    anchors: ['lamp-post'],
    chance: WINTER_CHANCE.post,
    radius: POST_WIND + BULB_METRES / 2,
    parts: postLights(),
  },
  {
    item: 'eave-lights',
    anchors: ['eave'],
    chance: WINTER_CHANCE.eaves,
    radius: EAVE_HALF + BULB_METRES,
    parts: eaveLights(),
  },
  {
    item: 'wreath',
    anchors: ['doorstep'],
    chance: WINTER_CHANCE.wreath,
    radius: 0.3,
    parts: doorWreath(),
    onStepOf: ['building', 'shop-row'],
  },
  {
    item: VILLAGE_TREE,
    anchors: ['green'],
    chance: 1,
    radius: (TREE_TIERS[0] as readonly [number, number, number])[2] / 2,
    parts: villageTree(),
    perVillage: 'one',
  },
];

/**
 * What a ride decorates with — Halloween's pumpkins since #1625, and since
 * #1626 the winter lights, with the green's tree since #1627. A holiday the table
 * names nothing for places no item, and the belt is not drawn. The owner's
 * page may register a probe instead (`browser/realistic/config.ts`
 * §`PROBE_DECORATIONS`), which no rider reaches.
 */
export const HOLIDAY_DECORATIONS: ItemTable = {
  halloween: HALLOWEEN,
  'winter-lights': WINTER_LIGHTS,
};

/** One item placed: where, which kind, and a seed of its own for its variation. */
export interface DecorationItem {
  readonly anchor: DecorationAnchor;
  readonly item: string;
  /**
   * The height its item-local `y = 0` stands at: its anchor's, or for a kind
   * that stands on a step that step's top — #1625.
   */
  readonly base: number;
  /** A `uint32` drawn from the anchor's hash, for whatever the item varies by. */
  readonly seed: number;
}

/**
 * How far from the carriageway's edge a green anchor must be, metres:
 * **4** — past the pavement's 2 m and the verge beyond it, so whatever stands
 * on the green stands on grass.
 */
export const GREEN_CLEAR_METRES = 4;

/**
 * How far from its crossroads side road's edge a green anchor must be,
 * metres — #1690: **1.5**, `cross-streets.ts`
 * §`SIDE_ROAD_SCENERY_MARGIN_METRES`, what a scattered tree keeps. The side
 * road has no pavement, so this is a verge, not {@link GREEN_CLEAR_METRES}.
 * On a straight road a green anchor is about 3.4 m from it.
 */
export const GREEN_SIDE_ROAD_CLEAR_METRES = SIDE_ROAD_SCENERY_MARGIN_METRES;

/** The hash key every anchor's hash is drawn under — its own, so no other placement correlates. */
const DECORATION_KEY = 0x16_2400;

/** The streams an item's draws come from. */
const STREAM_TAKES = 0;
const STREAM_SEED = 1;

/** How many anchors one village may number apart — far more than any has. */
const ANCHORS_PER_VILLAGE = 1_024;

/** A building's eaves, building-local, by kind and variant: the lowest point of its roof. */
const eaves = new Map<string, number | null>();

function eavesOf(kind: BuiltKind, variant: number): number | null {
  const key = `${kind}:${String(variant)}`;
  const known = eaves.get(key);
  if (known !== undefined) return known;
  const roof = buildingPlan(kind, variant, { openings: false }).triangles.roof;
  let lowest = Number.POSITIVE_INFINITY;
  for (let at = 1; at < roof.length; at += 3) lowest = Math.min(lowest, roof[at] as number);
  const found = Number.isFinite(lowest) ? lowest : null;
  eaves.set(key, found);
  return found;
}

/** One built plot's front door, as `streets.ts` laid its path. */
export interface DoorOfPlot {
  readonly plot: Plot;
  readonly path: DoorPath;
}

/**
 * Every anchor of one village — called once a route by `streets.ts`
 * §`streetOf`, which hands over what it built the street from: the village's
 * site (on the route's first lap), its built plots' front paths and its
 * street furniture. @see the header
 */
export function villageAnchors(
  profile: RouteProfile,
  origin: CorridorOrigin,
  seed: number,
  site: Site,
  doors: readonly DoorOfPlot[],
  furniture: readonly FurnitureItem[],
  land: LandClassMask,
): readonly DecorationAnchor[] {
  const found: DecorationAnchor[] = [];
  const add = (
    kind: AnchorKind,
    x: number,
    y: number,
    z: number,
    yaw: number,
    clear: number,
    step?: AnchorStep,
  ): void => {
    const hash = slotHash(
      seed,
      site.wrappedSite * ANCHORS_PER_VILLAGE + found.length,
      DECORATION_KEY,
    );
    found.push(
      step === undefined
        ? { kind, x, y, z, yaw, clear, hash }
        : { kind, x, y, z, yaw, clear, hash, step },
    );
  };
  const fromRoad = (x: number, z: number): number =>
    distanceToDrawnRoad(profile, origin, x, z, SETBACK_METRES + PLOT_METRES) -
    ROAD_WIDTH_METRES / 2;
  // #1690: the village's crossroads, as it is drawn. @see the header
  const crossroads = [villageSideRoad(profile, origin, seed, site, land)];
  const fromSideRoad = (x: number, z: number): number => distanceToSideRoads(crossroads, x, z);
  const clearOf = (x: number, z: number): number => Math.min(fromRoad(x, z), fromSideRoad(x, z));

  for (const item of furniture) {
    if (item.kind !== 'lamp-post') continue;
    add('lamp-post', item.x, item.y, item.z, item.rotation, clearOf(item.x, item.z));
  }

  for (const { plot, path } of doors) {
    // ⚠️ Never the church plot. @see the header
    if (plot.kind === 'church') continue;
    const sections = path.walk.length / 3;
    if (sections < 2) continue;
    const doorX = path.walk[(sections - 1) * 3] as number;
    const doorY = path.walk[(sections - 1) * 3 + 1] as number;
    const doorZ = path.walk[(sections - 1) * 3 + 2] as number;
    // From the door back towards the pavement is towards the road.
    const towardX = (path.walk[0] as number) - doorX;
    const towardZ = (path.walk[2] as number) - doorZ;
    const yaw = Math.atan2(towardX, towardZ);
    if (!isBuiltKind(plot.kind)) {
      add('doorstep', doorX, doorY, doorZ, yaw, clearOf(doorX, doorZ));
      continue;
    }
    // The building stands where `settlements.ts` §`standing` stands it.
    const ground = terrainHeightAt(
      profile,
      origin,
      seed,
      distanceOnRoute(profile, plot.along),
      plot.lateral * plot.side,
      land,
    );
    // #1625: the step its plan lays before the very door the path ends at.
    const door = frontDoorOf(plot.kind, plot.variant);
    add(
      'doorstep',
      doorX,
      doorY,
      doorZ,
      yaw,
      clearOf(doorX, doorZ),
      door === null
        ? undefined
        : {
            top: ground + door.step.top,
            halfWidth: door.step.halfWidth,
            depth: door.step.depth,
            building: plot.kind,
          },
    );
    const top = eavesOf(plot.kind, plot.variant);
    const frame = drawnRoadFrame(profile, origin, distanceOnRoute(profile, plot.along));
    if (top === null || frame === undefined) continue;
    add('eave', doorX, ground + top, doorZ, yaw, clearOf(doorX, doorZ));
  }

  // The crossroads green: the middle plot either side, which is never built,
  // on both sides of the side road's mouth.
  const ways = waterways(profile, seed);
  const offset = (VILLAGE_MOUTH_HALF_METRES + PLOT_METRES / 2) / 2;
  const plots = everyVillagePlot(seed, site);
  // #1627: the village's buildings, so what stands on the green stands clear of them.
  const buildings = plots.flatMap((plot) => {
    if (!plot.built) return [];
    const frame = drawnRoadFrame(profile, origin, distanceOnRoute(profile, plot.along));
    return frame === undefined ? [] : [buildingOf(plot, frame)];
  });
  for (const plot of plots) {
    if (plot.built || Math.abs(plot.along - site.centre) > 1e-6) continue;
    for (const along of [plot.along - offset, plot.along + offset]) {
      const wrapped = distanceOnRoute(profile, along);
      const frame = drawnRoadFrame(profile, origin, wrapped);
      if (frame === undefined) continue;
      const lateral = plot.lateral * plot.side;
      if (inWater(ways, profile, wrapped, lateral)) continue;
      const x = frame.x + frame.normalX * lateral;
      const z = frame.z + frame.normalZ * lateral;
      if (!(fromRoad(x, z) >= GREEN_CLEAR_METRES)) continue;
      if (!(fromSideRoad(x, z) >= GREEN_SIDE_ROAD_CLEAR_METRES)) continue;
      const clear = Math.min(
        clearOf(x, z),
        ...buildings.map((building) => distanceToFootprint(building, x, z)),
      );
      const y = terrainHeightAt(profile, origin, seed, wrapped, lateral, land);
      add(
        'green',
        x,
        y,
        z,
        Math.atan2(-frame.normalX * plot.side, -frame.normalZ * plot.side),
        clear,
      );
    }
  }
  return found;
}

/** A built plot's building in plan: where it stands, which way it faces, and the ground it takes. */
interface BuildingInPlan {
  readonly x: number;
  readonly z: number;
  /** Its own `+x`, the way along the road, and `+z`, toward it. */
  readonly cos: number;
  readonly sin: number;
  readonly footprint: Footprint;
}

/**
 * A built plot's building as `settlements.ts` §`standing` stands it, facing
 * the road — #1627: the ground its kind takes or, where its plot may hold a
 * house model (#1566), the larger of the two, as `settlements.ts`
 * §`pushFootprint` clears it.
 */
function buildingOf(
  plot: Plot,
  frame: {
    readonly x: number;
    readonly z: number;
    readonly normalX: number;
    readonly normalZ: number;
  },
): BuildingInPlan {
  const lateral = plot.lateral * plot.side;
  const rotation = Math.atan2(-frame.normalX * plot.side, -frame.normalZ * plot.side);
  const shape = STRUCTURE_FOOTPRINTS[plot.kind];
  const model = plot.house === undefined ? undefined : plotModelFootprint(plot.house, shape.front);
  return {
    x: frame.x + frame.normalX * lateral,
    z: frame.z + frame.normalZ * lateral,
    cos: Math.cos(rotation),
    sin: Math.sin(rotation),
    footprint: {
      x: Math.max(shape.x, model?.x ?? 0),
      back: Math.min(shape.back, model?.back ?? 0),
      front: Math.max(shape.front, model?.front ?? 0),
    },
  };
}

/** How far `(x, z)` is from a building's footprint, metres: nought on it. */
function distanceToFootprint(building: BuildingInPlan, x: number, z: number): number {
  const dx = x - building.x;
  const dz = z - building.z;
  // Into the building's own frame, as three's `rotation.y` turns it back.
  const across = dx * building.cos - dz * building.sin;
  const ahead = dx * building.sin + dz * building.cos;
  const { footprint } = building;
  return Math.hypot(
    Math.max(0, Math.abs(across) - footprint.x),
    Math.max(0, footprint.back - ahead, ahead - footprint.front),
  );
}

/**
 * The items for `holiday` on every village's anchors, in village and anchor
 * order: none with no holiday, and none where `kinds` names none for it. Each
 * anchor offers itself to the holiday's kinds in order, and takes the first
 * that may stand there, rolls under its {@link DecorationKind.chance} and is
 * no wider than the anchor's clearance from the carriageway — and, for a kind
 * one a village ({@link DecorationKind.perVillage}), is the village's anchor
 * it was offered to. @see the header
 */
export function decorationsFor(
  villages: readonly { readonly anchors: readonly DecorationAnchor[] }[],
  holiday: Holiday | undefined,
  kinds: ItemTable,
): DecorationItem[] {
  if (holiday === undefined) return [];
  const offered = kinds[holiday];
  if (offered === undefined || offered.length === 0) return [];
  const items: DecorationItem[] = [];
  for (const village of villages) {
    // #1627: the one anchor each one-a-village kind is offered to.
    const chosen = offered.map((kind, which) =>
      kind.perVillage === 'one' ? lowestRoll(village.anchors, kind, which) : undefined,
    );
    for (const anchor of village.anchors) {
      for (const [which, kind] of offered.entries()) {
        if (!mayStand(kind, anchor)) continue;
        if (kind.perVillage === 'one' && chosen[which] !== anchor) continue;
        const step = kind.onStepOf === undefined ? undefined : anchor.step;
        if (!(rollOf(anchor, which) < kind.chance)) continue;
        items.push({
          anchor,
          item: kind.item,
          base: step === undefined ? anchor.y : step.top,
          seed: slotHash(anchor.hash, which, STREAM_SEED),
        });
        break;
      }
    }
  }
  return items;
}

/** The roll an anchor makes for the holiday's `which`th kind, 0 to 1. */
function rollOf(anchor: DecorationAnchor, which: number): number {
  return uniformFrom(anchor.hash, which * 2 + STREAM_TAKES);
}

/**
 * Whether `kind` may stand on `anchor`: an anchor of its kinds, no narrower
 * than its footprint, and on a step it fits where it stands on one.
 */
function mayStand(kind: DecorationKind, anchor: DecorationAnchor): boolean {
  if (!kind.anchors.includes(anchor.kind)) return false;
  if (kind.radius > anchor.clear) return false;
  if (kind.onStepOf === undefined) return true;
  return anchor.step !== undefined && fitsStep(kind, anchor.step);
}

/** Of the anchors `kind` may stand on, the one whose roll for it is lowest — #1627. */
function lowestRoll(
  anchors: readonly DecorationAnchor[],
  kind: DecorationKind,
  which: number,
): DecorationAnchor | undefined {
  let best: DecorationAnchor | undefined;
  let lowest = Number.POSITIVE_INFINITY;
  for (const anchor of anchors) {
    if (!mayStand(kind, anchor)) continue;
    const roll = rollOf(anchor, which);
    if (roll < lowest) {
      lowest = roll;
      best = anchor;
    }
  }
  return best;
}

/**
 * Whether a kind that stands on a step may stand on this one — #1625: the
 * step is the door of one of its buildings, and every part's box lies inside
 * the tread, item-local. @see AnchorStep
 */
function fitsStep(kind: DecorationKind, step: AnchorStep): boolean {
  if (kind.onStepOf?.includes(step.building) !== true) return false;
  return kind.parts.every(({ size, at }) => {
    const [width, , depth] = size;
    const [x, , z] = at;
    return (
      Math.abs(x) + width / 2 <= step.halfWidth && z - depth / 2 >= 0 && z + depth / 2 <= step.depth
    );
  });
}
