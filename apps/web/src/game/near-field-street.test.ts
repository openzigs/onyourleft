// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Does the camera's near plane cut what stands beside a street? — #545, for
 * everything a frame draws that is not scatter.
 *
 * `near-field.test.ts` rides the fixture routes and holds the SCATTER — the
 * trees, shrubs, rocks, posts and the villages' structures — to the near
 * pyramid, and `near-field.ts` §`clearOfTheCamera` drops what the plane would
 * cut. Since #603 the world has grown things that are not scatter, and none of
 * them is handed to that cull:
 *
 * - the **mapped buildings** (#1549), every role's triangles as the press
 *   built them, porches (#1589), shop fronts and awnings (#1590) among them,
 *   and the **house models** laid on them (#1585), as the box each is
 *   stretched to;
 * - the **street furniture** (#1536, #1637): lamp posts, bollards, benches and
 *   bins;
 * - the **people** on the pavements and footways (#1541);
 * - the **start and finish gantries** and the to-go boards (#679), box by box;
 * - the **holiday decorations** (#1624, #1625, #1626), part by part;
 * - the **pavements** themselves and their front paths (#1535, #1564).
 *
 * Each is ridden here a metre at a time with the camera on the racing line,
 * through the real `sceneFrame`, on twelve rides — the villages' road, three
 * bends each ridden both ways, #1637's city centre, #1581's mixed town,
 * #1585's street of house models, and a town whose mapped walls stand at the
 * press's least clearance round the planner route's bends, both ways
 * ({@link kerbsideFixture}) — at every aspect a device draws, and held to
 * the pyramid by a measure of its own: the
 * separating-axis test on each box ({@link boxMeets}, written here and sharing
 * no code with `near-field.ts`), and `near-field.ts` §`triangleMeets` on each
 * triangle, which `near-field.test.ts` holds to cases worked by hand and to a
 * clipping reference.
 *
 * ## What the rides found
 *
 * **At every aspect a device draws — an upright phone to a 21 : 9 phone in
 * landscape, the owner's 16 : 10 tablet among them — nothing of any of them
 * reaches the near pyramid**, so there is nothing for a cull to drop. Each is
 * held clear by a rule of its own: a mapped footprint's edges by `landform.ts`
 * §`ROAD_CLEARANCE_METRES` from every stretch of the road (an awning and a
 * porch shortened to keep it), a person by the walk 0.9 m out on the pavement
 * (`streets.ts` §`WALK_FROM_KERB_METRES`) and `people.ts`
 * §`PERSON_CLEARANCE_METRES`, a gantry's legs by its clearance, and the
 * furniture by the pavement it stands on. Measured while building this, a
 * 3 : 1 frame is clean too.
 *
 * ⚠️ **At 6 : 1 two classes are culled — #1835.** From 32 : 9 upward the
 * plane DOES meet two of them as `sceneFrame` builds the frame: people on the
 * bends and the kerbside town's walls, desktop browser frames no device draws.
 * Since #1835 the renderer drops them as it drops scatter (`near-field.ts`
 * §`peopleClearOfTheCamera` and §`mappedBuildingCut`, which
 * `three-renderer.ts` §`MappedBuildingBelt.clearOf` hides a building by), so
 * this file asks each ride twice: what the plane meets in the frame as built —
 * pinned exactly at 6 : 1, the cull's work, so a change that brings more to the
 * plane shows — and what it meets of what the renderer still DRAWS, which is
 * nothing at every aspect the stylesheet allows. And the culls drop exactly
 * what this file's measure meets, so a cull that drops too much is red too.
 *
 * ⚠️ **The controls.** At 8 : 1, the frame `near-field.test.ts`' control
 * rides, the near rectangle is 5.6 m across, and the same measure on the same
 * frames DOES meet a gantry's leg, a person, a lamp post, a decoration and a
 * mapped wall. The classes 8 : 1 does not reach are held by a probe for every
 * class: near pyramids stood where the product's own numbers put one thing of
 * that class — since #1835 at every corner the product gives it, so a box
 * built too SMALL misses one, not only a box built in the wrong place — must
 * meet the subject this file built for it, and the same pyramids 50 m up must
 * not — so a box placed in the wrong frame or made too small, a mesh never
 * asked, or a plan never asked of its triangles cannot pass these rides over
 * nothing.
 */

import { describe, expect, it } from 'vitest';

import { metres, metresPerSecond, seconds, type RouteProfile } from '@onyourleft/domain';

import { WORST_CASE_ASPECT, cameraRig, type CameraRig, type RigPoint } from './camera';
import {
  HOLIDAY_DECORATIONS,
  decorationsFor,
  type DecorationItem,
  type DecorationKind,
  type DecorationPart,
} from './decorations';
import {
  cityCentreFixture,
  kerbsideFixture,
  mixedTownFixture,
  richmondStreetFixture,
} from './footprint-fixtures-testing';
import {
  FOOTPRINT_MAX_VERTICES,
  FOOTPRINT_ROLES,
  FOOTPRINT_VERTEX_FLOATS,
  footprintPlans,
  mappedTown,
  type FootprintPlan,
} from './footprint-buildings';
import { boxPoint, type PlacedStand } from './gantry';
import { HOUSE_MODELS } from './house-models';
import { landClassMask, type LandClassMask } from './land-class';
import { ROAD_CLEARANCE_METRES } from './landform';
import { mappedBuildingsOf } from './mapped-buildings';
import {
  mappedBuildingCut,
  nearPyramid,
  peopleClearOfTheCamera,
  triangleMeets,
  type NearPyramid,
} from './near-field';
import { PEOPLE_NEAR_MAX, PERSON_HALF_WIDTH_METRES, type Person } from './people';
import type { SceneFrame } from './port';
import { distanceToDrawnRoad } from './road-grid';
import { hairpinRoute, northRoute, plannerRoute, sBendRoute } from './route-fixtures-testing';
import { sceneFrame, type SceneInput } from './scene';
import type { MappedTown } from './settlements';
import { atStartLine } from './simulation';
import type { FurnitureItem, FurnitureKind } from './streets';
import { corridorOrigin, type CorridorOrigin } from './terrain';
import { urbanClassMap, type UrbanClassMap } from './urban-class';
import {
  decorationGeometry,
  decorationShapeTriangles,
  furniturePartBounds,
} from './three-renderer';
import type { WorldCorridor } from './world-data/corridor';

/**
 * The frames a device draws — `near-field.test.ts`' six, and a 21 : 9 phone
 * in landscape, the widest Android phones ship (`camera.ts`
 * §`NARROWEST_ASPECT` is the same phone upright) — and the control's.
 */
const DEVICE_ASPECTS: Readonly<Record<string, number>> = {
  'a 21 : 9 phone in landscape': 21 / 9,
  'a phone in landscape': 19.5 / 9,
  '16 : 9': 16 / 9,
  "the owner's tablet": 16 / 10,
  '4 : 3': 4 / 3,
  'a tablet upright': 10 / 16,
  'a phone upright': 9 / 19.5,
};

/** The control's frame: `near-field.test.ts`' own, 5.6 m of near rectangle. */
const CONTROL_ASPECT = 8;

/** The widest frame the stylesheet allows: a desktop window, and #1835's. */
const WIDEST_LABEL = 'the widest frame the stylesheet allows';

const ASPECTS: Readonly<Record<string, number>> = {
  ...DEVICE_ASPECTS,
  'the control frame': CONTROL_ASPECT,
  [WIDEST_LABEL]: WORST_CASE_ASPECT,
};

/** A box, by its eight corners and its three axes. */
interface Box {
  readonly corners: readonly RigPoint[];
  readonly axes: readonly RigPoint[];
}

const vector = (x: number, y: number, z: number): RigPoint => ({ x, y, z });
const dot = (a: RigPoint, b: RigPoint): number => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: RigPoint, b: RigPoint): RigPoint =>
  vector(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);

/**
 * A box about `(x, y, z)`, turned by three's yaw `rotation` (its own `+z` to
 * `(sin, cos)`), reaching `across` either way on its own `x`, from `back` to
 * `front` on its own `z`, and from `bottom` to `top` above `y`.
 */
function turnedBox(
  x: number,
  y: number,
  z: number,
  rotation: number,
  across: number,
  back: number,
  front: number,
  bottom: number,
  top: number,
): Box {
  const sin = Math.sin(rotation);
  const cos = Math.cos(rotation);
  const ownX = vector(cos, 0, -sin);
  const ownZ = vector(sin, 0, cos);
  const corners: RigPoint[] = [];
  for (const a of [-across, across]) {
    for (const b of [back, front]) {
      for (const h of [bottom, top]) {
        corners.push(vector(x + ownX.x * a + ownZ.x * b, y + h, z + ownX.z * a + ownZ.z * b));
      }
    }
  }
  return { corners, axes: [ownX, vector(0, 1, 0), ownZ] };
}

/** Where a set of points lies along an axis. */
function span(points: readonly RigPoint[], axis: RigPoint): readonly [number, number] {
  let low = Infinity;
  let high = -Infinity;
  for (const point of points) {
    const at = dot(point, axis);
    low = Math.min(low, at);
    high = Math.max(high, at);
  }
  return [low, high];
}

/**
 * Whether a box meets the pyramid — the separating-axis test, written here
 * rather than borrowed from `near-field.ts`, so that a ride holds the world to
 * a measure the cull did not compute: the box's three faces, the pyramid's
 * five, and each of the box's three edge directions crossed with each of the
 * pyramid's six.
 */
function boxMeets(box: Box, pyramid: NearPyramid): boolean {
  const apart = (axis: RigPoint): boolean => {
    if (Math.hypot(axis.x, axis.y, axis.z) < 1e-9) return false;
    const [lowA, highA] = span(box.corners, axis);
    const [lowB, highB] = span(pyramid.points, axis);
    return highA < lowB || highB < lowA;
  };
  for (const axis of [...box.axes, ...pyramid.normals]) if (apart(axis)) return false;
  for (const edge of box.axes) {
    for (const other of pyramid.edges) if (apart(cross(edge, other))) return false;
  }
  return true;
}

/** Whether every corner of a box is farther from the eye than `reach`, in plan or in height. */
function beyond(box: Box, eye: RigPoint, reach: number): boolean {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const corner of box.corners) {
    minX = Math.min(minX, corner.x);
    maxX = Math.max(maxX, corner.x);
    minY = Math.min(minY, corner.y);
    maxY = Math.max(maxY, corner.y);
    minZ = Math.min(minZ, corner.z);
    maxZ = Math.max(maxZ, corner.z);
  }
  return (
    minX - eye.x > reach ||
    eye.x - maxX > reach ||
    minY - eye.y > reach ||
    eye.y - maxY > reach ||
    minZ - eye.z > reach ||
    eye.z - maxZ > reach
  );
}

/**
 * The boxes each furniture kind fits inside, in its own frame (`+z` to the
 * road), from `three-renderer.ts` §`FURNITURE_STYLE`'s parts, each rounded
 * out: a lamp post's foot (0.14 m across, 0.4 m) and its 4.9 m column, and
 * its arm and lantern, 1.2 m toward the road at 5.08 m, 0.5 m deep and
 * 0.14 m tall — two boxes, because one round both would stand 1.5 m of
 * empty air at the eye's height; a bollard's 0.95 m column, 0.11 m across;
 * a bench's 1.8 m seat and its back; a bin.
 */
const FURNITURE_BOXES: Readonly<
  Record<
    FurnitureKind,
    readonly {
      readonly across: number;
      readonly back: number;
      readonly front: number;
      readonly bottom: number;
      readonly top: number;
    }[]
  >
> = {
  'lamp-post': [
    { across: 0.2, back: -0.2, front: 0.2, bottom: -0.1, top: 5.4 },
    { across: 0.2, back: -0.1, front: 1.5, bottom: 4.9, top: 5.4 },
  ],
  bollard: [{ across: 0.15, back: -0.15, front: 0.15, bottom: -0.1, top: 1.0 }],
  bench: [{ across: 1.0, back: -0.4, front: 0.4, bottom: -0.1, top: 1.0 }],
  bin: [{ across: 0.35, back: -0.35, front: 0.35, bottom: -0.1, top: 1.1 }],
};

function furnitureBoxes(item: FurnitureItem): Box[] {
  return FURNITURE_BOXES[item.kind].map((reach) =>
    turnedBox(
      item.x,
      item.y,
      item.z,
      item.rotation,
      reach.across,
      reach.back,
      reach.front,
      reach.bottom,
      reach.top,
    ),
  );
}

/**
 * A person's box: `people.ts` §`PERSON_HALF_WIDTH_METRES` is 0.3, and a
 * stride and a swinging arm reach further, so 0.5 every way about their feet
 * and 0.1 above their height.
 */
function personBox(person: Person): Box {
  return turnedBox(
    person.x,
    person.y,
    person.z,
    person.yaw,
    0.5,
    -0.5,
    0.5,
    -0.1,
    person.height + 0.1,
  );
}

/** Each box of a stand, placed as the renderer places it. @see boxPoint */
function standBoxes(placed: PlacedStand): Box[] {
  return placed.boxes.map((each) => {
    const { box } = each;
    const along = vector(each.headingX, 0, each.headingZ);
    const across = vector(-each.headingZ, 0, each.headingX);
    const corners: RigPoint[] = [];
    for (const a of [box.across - box.width / 2, box.across + box.width / 2]) {
      for (const h of [box.up - box.height / 2, box.up + box.height / 2]) {
        const point = boxPoint(each, a, h);
        for (const d of [-box.depth / 2, box.depth / 2]) {
          corners.push(vector(point.x + along.x * d, point.y, point.z + along.z * d));
        }
      }
    }
    return { corners, axes: [across, vector(0, 1, 0), along] };
  });
}

/**
 * A house model's box: the rectangle `house-models.ts` §`placeHouseModel`
 * stretches it to, as tall as the model, with 0.3 m every way for whatever of
 * a model's eaves or steps stands past its own footprint's numbers.
 */
function modelBox(plan: FootprintPlan): Box | undefined {
  const placed = plan.model;
  if (placed === undefined) return undefined;
  const model = HOUSE_MODELS[placed.model];
  if (model === undefined) return undefined;
  const rotation = Math.atan2(-placed.az, placed.ax);
  // `turnedBox`'s own x is (cos, −sin): the model's long axis (ax, az).
  const halfLong = (model.length * placed.stretchX) / 2 + 0.3;
  const halfDeep = (model.depth * placed.stretchZ) / 2 + 0.3;
  return turnedBox(
    placed.cx,
    placed.y0,
    placed.cz,
    rotation,
    halfLong,
    -halfDeep,
    halfDeep,
    -0.3,
    model.height + 0.3,
  );
}

/** Whether any of a plan's triangles meets the pyramid. */
function planMeets(plan: FootprintPlan, pyramid: NearPyramid): boolean {
  for (const role of FOOTPRINT_ROLES) {
    const floats = plan.triangles[role];
    const stride = FOOTPRINT_VERTEX_FLOATS;
    for (let at = 0; at + 3 * stride <= floats.length; at += 3 * stride) {
      const a = vector(floats[at] as number, floats[at + 1] as number, floats[at + 2] as number);
      const b = vector(
        floats[at + stride] as number,
        floats[at + stride + 1] as number,
        floats[at + stride + 2] as number,
      );
      const c = vector(
        floats[at + 2 * stride] as number,
        floats[at + 2 * stride + 1] as number,
        floats[at + 2 * stride + 2] as number,
      );
      if (triangleMeets(a, b, c, pyramid)) return true;
    }
  }
  return false;
}

/** Whether any of a flat mesh's triangles (three floats a vertex, indexed) meets the pyramid. */
function meshMeets(
  positions: Float32Array,
  indices: Uint16Array | Uint32Array,
  pyramid: NearPyramid,
): boolean {
  const corner = (index: number): RigPoint =>
    vector(
      positions[index * 3] as number,
      positions[index * 3 + 1] as number,
      positions[index * 3 + 2] as number,
    );
  for (let at = 0; at + 2 < indices.length; at += 3) {
    if (
      triangleMeets(
        corner(indices[at] as number),
        corner(indices[at + 1] as number),
        corner(indices[at + 2] as number),
        pyramid,
      )
    ) {
      return true;
    }
  }
  return false;
}

/** A pressed corridor: its mask, its class, its plans and its town, as the press builds them. */
interface Pressed {
  readonly profile: RouteProfile;
  readonly origin: CorridorOrigin;
  readonly corridor: WorldCorridor;
  readonly land: LandClassMask;
  readonly urban: UrbanClassMap;
  readonly plans: readonly FootprintPlan[];
  readonly town: MappedTown;
}

function pressed(fixture: {
  readonly profile: RouteProfile;
  readonly origin: CorridorOrigin;
  readonly corridor: WorldCorridor;
}): Pressed {
  const land = landClassMask(fixture.corridor);
  const urban = urbanClassMap(fixture.corridor, land, fixture.profile);
  const { plans } = footprintPlans(
    fixture.corridor,
    land,
    fixture.profile,
    fixture.origin,
    FOOTPRINT_MAX_VERTICES,
    urban,
  );
  return { ...fixture, land, urban, plans, town: mappedTown(fixture.corridor, plans, urban) };
}

/** A ride: its route, the stretch ridden, and what `sceneFrame` is handed beyond the state. */
interface Ride {
  readonly profile: RouteProfile;
  readonly origin: CorridorOrigin;
  readonly from: number;
  readonly to: number;
  readonly input: Partial<SceneInput>;
}

function plainRide(profile: RouteProfile): Ride {
  return {
    profile,
    origin: corridorOrigin(profile),
    from: 0,
    to: profile.totalDistance,
    input: {},
  };
}

function townRide(town: Pressed, from: number, to: number): Ride {
  return {
    profile: town.profile,
    origin: town.origin,
    from,
    to,
    input: {
      worldCorridor: town.corridor,
      landClass: town.land,
      mappedBuildings: mappedBuildingsOf(town.plans),
      mappedTown: town.town,
    },
  };
}

const RIDES: Readonly<Record<string, () => Ride>> = {
  // Villages with streets, their furniture, people and decorations, and the
  // start and finish gantries, on the straight #546 puts the rider right of.
  'a level road through villages': () => plainRide(northRoute(4_000, () => 50)),
  // Each bend both ways, as `near-field.test.ts` rides them: since #583 the
  // hand decides which side the scenery and the racing line's offset fall on.
  'a 20 m hairpin': () => plainRide(hairpinRoute(20)),
  'a 20 m left-hand hairpin': () => plainRide(hairpinRoute(20, 'left')),
  'an S-bend of 30 m': () => plainRide(sBendRoute(30)),
  'an S-bend of 30 m, left first': () => plainRide(sBendRoute(30, 'left')),
  "a planner's route": () => plainRide(plannerRoute()),
  "a planner's route, mirrored": () => plainRide(plannerRoute({ mirrored: true })),
  // #1637's city centre: 3.5 m pavements, a lamp post every 16 m, people.
  'a city centre': () => townRide(pressed(cityCentreFixture()), 950, 2_050),
  // #1581's mixed town: mapped houses and a high street, models among them.
  'a mixed town': () => townRide(pressed(mixedTownFixture()), 950, 2_050),
  // #1585's street of house models: models and extrusions side by side.
  'a street of house models': () => townRide(pressed(richmondStreetFixture()), 950, 1_450),
  // The closest the press lets a mapped wall stand, round the planner's bends.
  'a kerbside town on bends': () => {
    const town = pressed(kerbsideFixture());
    return townRide(town, 0, town.profile.totalDistance);
  },
  'a kerbside town on mirrored bends': () => {
    const town = pressed(kerbsideFixture({ mirrored: true }));
    return townRide(town, 0, town.profile.totalDistance);
  },
};

/**
 * Where the product itself says a thing is, as a rig whose near pyramid must
 * meet it: read from the product's own numbers (an item's foot, a person's,
 * `gantry.ts` §`boxPoint`, a plan's triangles, a model's centre, the vertices
 * `three-renderer.ts` §`decorationGeometry` draws, a pavement's triangles),
 * never from the boxes this file builds, so a box built in the wrong place
 * fails the probe test below rather than passing as clear.
 */
type Probe = () => readonly CameraRig[];

/** A rig standing inside `point`, looking along the road's plane and a little down. */
function rigInside(point: RigPoint): CameraRig {
  return { eye: point, target: vector(point.x + 1, point.y - 0.3, point.z + 0.2) };
}

/**
 * How far inside a thing's own extremes a size probe stands, in metres: a
 * centimetre, so that a box which reaches exactly as far as the thing passes,
 * and one a centimetre short of it does not.
 */
const PROBE_INSET_METRES = 0.01;

/** `point` moved {@link PROBE_INSET_METRES} toward `middle`. */
function insetToward(point: RigPoint, middle: RigPoint): RigPoint {
  const dx = middle.x - point.x;
  const dy = middle.y - point.y;
  const dz = middle.z - point.z;
  const length = Math.hypot(dx, dy, dz);
  if (length <= PROBE_INSET_METRES) return middle;
  const share = PROBE_INSET_METRES / length;
  return vector(point.x + dx * share, point.y + dy * share, point.z + dz * share);
}

/**
 * Rigs at the eight corners of a box the PRODUCT gives — its middle, its own
 * three axes and how far it reaches along each — each a centimetre inside:
 * so the box this file built for it must reach every corner, and a box built
 * too small (a person's made 1 cm) is missed by one of them (#1835).
 */
function rigsAtCorners(
  middle: RigPoint,
  axes: readonly [RigPoint, RigPoint, RigPoint],
  half: readonly [number, number, number],
): CameraRig[] {
  const rigs: CameraRig[] = [];
  for (const a of [-1, 1]) {
    for (const b of [-1, 1]) {
      for (const c of [-1, 1]) {
        const corner = vector(
          middle.x + axes[0].x * half[0] * a + axes[1].x * half[1] * b + axes[2].x * half[2] * c,
          middle.y + axes[0].y * half[0] * a + axes[1].y * half[1] * b + axes[2].y * half[2] * c,
          middle.z + axes[0].z * half[0] * a + axes[1].z * half[1] * b + axes[2].z * half[2] * c,
        );
        rigs.push(rigInside(insetToward(corner, middle)));
      }
    }
  }
  return rigs;
}

/**
 * Which of `three-renderer.ts` §`FURNITURE_STYLE`'s parts each box of
 * {@link FURNITURE_BOXES} is built round: a lamp post's foot and column in its
 * first, its arm and lantern in its second.
 */
const FURNITURE_BOX_PARTS: Readonly<Record<FurnitureKind, readonly (readonly number[])[]>> = {
  'lamp-post': [
    [0, 1],
    [2, 3],
  ],
  bollard: [[0, 1]],
  bench: [[0, 1, 2, 3, 4, 5, 6, 7, 8]],
  bin: [[0, 1]],
};

/** A furniture item's parts' corners, as the renderer builds them, placed and turned as the item is. */
function furnitureProbe(item: FurnitureItem, box: number): Probe {
  return () => {
    const bounds = furniturePartBounds(item.kind);
    const parts = FURNITURE_BOX_PARTS[item.kind][box] ?? [];
    const sin = Math.sin(item.rotation);
    const cos = Math.cos(item.rotation);
    const ownX = vector(cos, 0, -sin);
    const ownZ = vector(sin, 0, cos);
    return parts.flatMap((part) => {
      const { min, max } = bounds[part] as (typeof bounds)[number];
      const mx = (min[0] + max[0]) / 2;
      const my = (min[1] + max[1]) / 2;
      const mz = (min[2] + max[2]) / 2;
      const middle = vector(
        item.x + ownX.x * mx + ownZ.x * mz,
        item.y + my,
        item.z + ownX.z * mx + ownZ.z * mz,
      );
      return rigsAtCorners(
        middle,
        [ownX, vector(0, 1, 0), ownZ],
        [(max[0] - min[0]) / 2, (max[1] - min[1]) / 2, (max[2] - min[2]) / 2],
      );
    });
  };
}

/**
 * A rig 5 cm off the middle of a triangle, looking into it: the near plane,
 * 0.5 m on, stands beyond the triangle's plane, so the pyramid crosses it.
 */
function rigFacing(a: RigPoint, b: RigPoint, c: RigPoint): CameraRig {
  const middle = vector((a.x + b.x + c.x) / 3, (a.y + b.y + c.y) / 3, (a.z + b.z + c.z) / 3);
  const ab = vector(b.x - a.x, b.y - a.y, b.z - a.z);
  const ac = vector(c.x - a.x, c.y - a.y, c.z - a.z);
  const n = cross(ab, ac);
  const length = Math.hypot(n.x, n.y, n.z);
  const unit = vector(n.x / length, n.y / length, n.z / length);
  return {
    eye: vector(middle.x + unit.x * 0.05, middle.y + unit.y * 0.05, middle.z + unit.z * 0.05),
    // Into the triangle, and turned a little so the look is never straight down.
    target: vector(middle.x - unit.x + 0.5, middle.y - unit.y, middle.z - unit.z + 0.5),
  };
}

/** The largest of a list of triangles, as a {@link rigFacing} rig: the one a 5 cm probe most surely lands inside. */
function rigFacingLargest(triangles: Iterable<readonly [RigPoint, RigPoint, RigPoint]>): CameraRig {
  let best: readonly [RigPoint, RigPoint, RigPoint] | undefined;
  let bestArea = -1;
  for (const triangle of triangles) {
    const [a, b, c] = triangle;
    const n = cross(
      vector(b.x - a.x, b.y - a.y, b.z - a.z),
      vector(c.x - a.x, c.y - a.y, c.z - a.z),
    );
    const area = Math.hypot(n.x, n.y, n.z);
    if (area > bestArea) {
      bestArea = area;
      best = triangle;
    }
  }
  if (best === undefined) throw new Error('a probe needs a triangle');
  return rigFacing(...best);
}

function* planTriangles(plan: FootprintPlan): Generator<readonly [RigPoint, RigPoint, RigPoint]> {
  const stride = FOOTPRINT_VERTEX_FLOATS;
  for (const role of FOOTPRINT_ROLES) {
    const floats = plan.triangles[role];
    for (let at = 0; at + 3 * stride <= floats.length; at += 3 * stride) {
      const corner = (offset: number): RigPoint =>
        vector(
          floats[at + offset] as number,
          floats[at + offset + 1] as number,
          floats[at + offset + 2] as number,
        );
      yield [corner(0), corner(stride), corner(2 * stride)];
    }
  }
}

function* meshTriangles(
  positions: Float32Array,
  indices: Uint16Array | Uint32Array,
): Generator<readonly [RigPoint, RigPoint, RigPoint]> {
  const corner = (index: number): RigPoint =>
    vector(
      positions[index * 3] as number,
      positions[index * 3 + 1] as number,
      positions[index * 3 + 2] as number,
    );
  for (let at = 0; at + 2 < indices.length; at += 3) {
    yield [
      corner(indices[at] as number),
      corner(indices[at + 1] as number),
      corner(indices[at + 2] as number),
    ];
  }
}

/** What a frame draws beside the street, as the boxes and meshes this file holds to the pyramid. */
type Subject = (
  | { readonly kind: 'box'; readonly what: string; readonly box: Box }
  | { readonly kind: 'plan'; readonly what: string; readonly plan: FootprintPlan }
  | {
      readonly kind: 'mesh';
      readonly what: string;
      readonly positions: Float32Array;
      readonly indices: Uint16Array | Uint32Array;
    }
) & {
  readonly probe?: Probe;
  /** The sample it is probed as, when not its class: a lamp post's arm (#1835). */
  readonly sample?: string;
  /** The person it is, for the renderer's cull of the people (#1835). */
  readonly person?: Person;
  /** The mapped building it is, or stands for, and its reach, for the belt's cull (#1835). */
  readonly building?: { readonly plan: FootprintPlan; readonly radius: number };
};

/** A decoration part's box, turned by its anchor's yaw as three turns it. */
function decorationPartBox(placed: DecorationItem, part: DecorationPart): Box {
  const [w, h, d] = part.size;
  const [px, py, pz] = part.at;
  const { anchor } = placed;
  const sin = Math.sin(anchor.yaw);
  const cos = Math.cos(anchor.yaw);
  // The part's middle, turned by the anchor's yaw as three turns it.
  const x = anchor.x + px * cos + pz * sin;
  const z = anchor.z - px * sin + pz * cos;
  return turnedBox(x, placed.base + py, z, anchor.yaw, w / 2, -d / 2, d / 2, -h / 2, h / 2);
}

/**
 * The middle of each part of one decoration as `three-renderer.ts`
 * §`decorationGeometry` draws it: the mean of that part's own vertices.
 */
function drawnPartMiddles(placed: DecorationItem, kind: DecorationKind): RigPoint[] {
  const position = decorationGeometry([placed], [kind]).getAttribute('position');
  const middles: RigPoint[] = [];
  let vertex = 0;
  for (const part of kind.parts) {
    const count = decorationShapeTriangles(part.shape) * 3;
    let x = 0;
    let y = 0;
    let z = 0;
    for (let at = vertex; at < vertex + count; at += 1) {
      x += position.getX(at);
      y += position.getY(at);
      z += position.getZ(at);
    }
    middles.push(vector(x / count, y / count, z / count));
    vertex += count;
  }
  return middles;
}

/** Every vertex of one part of one decoration as `three-renderer.ts` §`decorationGeometry` draws it. */
function drawnPartVertices(placed: DecorationItem, kind: DecorationKind, part: number): RigPoint[] {
  const position = decorationGeometry([placed], [kind]).getAttribute('position');
  let vertex = 0;
  for (let at = 0; at < part; at += 1) {
    vertex += decorationShapeTriangles((kind.parts[at] as DecorationPart).shape) * 3;
  }
  const count = decorationShapeTriangles((kind.parts[part] as DecorationPart).shape) * 3;
  const vertices: RigPoint[] = [];
  for (let at = vertex; at < vertex + count; at += 1) {
    vertices.push(vector(position.getX(at), position.getY(at), position.getZ(at)));
  }
  return vertices;
}

/** Everything a frame draws that is not scatter, near enough the eye to ask about. */
function subjectsOf(frame: SceneFrame, eye: RigPoint): Subject[] {
  const subjects: Subject[] = [];
  for (const street of frame.streets) {
    const { positions, indices } = street.pavement;
    subjects.push({
      kind: 'mesh',
      what: 'pavement',
      positions,
      indices,
      probe: () => [rigFacingLargest(meshTriangles(positions, indices))],
    });
    for (const item of street.furniture) {
      furnitureBoxes(item).forEach((box, index) => {
        subjects.push({
          kind: 'box',
          what: item.kind,
          box,
          // Every box is probed at the corners of the parts it is built
          // round: a lamp post's arm as a sample of its own (#1835).
          probe: furnitureProbe(item, index),
          ...(index === 0 ? {} : { sample: `${item.kind} arm` }),
        });
      });
    }
  }
  for (const holiday of ['halloween', 'winter-lights'] as const) {
    for (const placed of decorationsFor(frame.streets, holiday, HOLIDAY_DECORATIONS)) {
      const kind = HOLIDAY_DECORATIONS[holiday]?.find((each) => each.item === placed.item);
      if (kind === undefined) continue;
      kind.parts.forEach((part, index) => {
        subjects.push({
          kind: 'box',
          what: `${holiday} ${placed.item}`,
          box: decorationPartBox(placed, part),
          // Its middle as drawn, and every vertex it is drawn with (#1835).
          probe: () => {
            const middle = drawnPartMiddles(placed, kind)[index] as RigPoint;
            return [
              rigInside(middle),
              ...drawnPartVertices(placed, kind, index).map((vertex) =>
                rigInside(insetToward(vertex, middle)),
              ),
            ];
          },
        });
      });
    }
  }
  for (const person of [...(frame.people?.near ?? []), ...(frame.people?.far ?? [])]) {
    subjects.push({
      kind: 'box',
      what: 'person',
      box: personBox(person),
      // Their feet, their crown and their shoulders, as `people.ts` gives
      // them: a box built smaller than the person misses one (#1835).
      probe: () =>
        rigsAtCorners(
          vector(person.x, person.y + person.height / 2, person.z),
          [
            vector(Math.cos(person.yaw), 0, -Math.sin(person.yaw)),
            vector(0, 1, 0),
            vector(Math.sin(person.yaw), 0, Math.cos(person.yaw)),
          ],
          [PERSON_HALF_WIDTH_METRES, person.height / 2, PERSON_HALF_WIDTH_METRES],
        ),
      person,
    });
  }
  for (const stand of frame.lines) {
    const boxes = standBoxes(stand);
    boxes.forEach((box, index) => {
      const each = stand.boxes[index];
      subjects.push({
        kind: 'box',
        what: stand.stand.kind,
        box,
        ...(each === undefined
          ? {}
          : {
              // Its corners, where `gantry.ts` §`boxPoint` stands them (#1835).
              probe: () =>
                rigsAtCorners(
                  boxPoint(each, each.box.across, each.box.up),
                  [
                    vector(-each.headingZ, 0, each.headingX),
                    vector(0, 1, 0),
                    vector(each.headingX, 0, each.headingZ),
                  ],
                  [each.box.width / 2, each.box.height / 2, each.box.depth / 2],
                ),
            }),
      });
    });
  }
  const mapped = frame.mappedBuildings;
  if (mapped !== undefined) {
    const { plans, radii } = mapped.buildings;
    plans.forEach((plan, index) => {
      const reach = (radii[index] ?? 0) + 30;
      if (Math.hypot(plan.centroid.x - eye.x, plan.centroid.z - eye.z) > reach) return;
      const building = { plan, radius: radii[index] ?? 0 };
      subjects.push({
        kind: 'plan',
        what: 'mapped building',
        plan,
        probe: () => [rigFacingLargest(planTriangles(plan))],
        building,
      });
      const model = modelBox(plan);
      const placed = plan.model;
      const height = placed === undefined ? undefined : HOUSE_MODELS[placed.model]?.height;
      if (model !== undefined && placed !== undefined && height !== undefined) {
        subjects.push({
          kind: 'box',
          what: 'house model',
          box: model,
          // The corners of the rectangle `house-models.ts` §`placeHouseModel`
          // stretches it to, as tall as the model (#1835).
          probe: () => {
            const houseModel = HOUSE_MODELS[placed.model];
            const length = Math.hypot(placed.ax, placed.az);
            const long = vector(placed.ax / length, 0, placed.az / length);
            return rigsAtCorners(
              vector(placed.cx, placed.y0 + height / 2, placed.cz),
              [long, vector(0, 1, 0), vector(-long.z, 0, long.x)],
              [
                ((houseModel?.length ?? 0) * placed.stretchX) / 2,
                height / 2,
                ((houseModel?.depth ?? 0) * placed.stretchZ) / 2,
              ],
            );
          },
          building,
        });
      }
    });
  }
  return subjects;
}

/** Whether the near plane meets a subject, for this pyramid. */
function meets(subject: Subject, pyramid: NearPyramid): boolean {
  const eye = pyramid.points[0] as RigPoint;
  if (subject.kind === 'box') {
    return !beyond(subject.box, eye, pyramid.radius) && boxMeets(subject.box, pyramid);
  }
  if (subject.kind === 'plan') return planMeets(subject.plan, pyramid);
  return meshMeets(subject.positions, subject.indices, pyramid);
}

/** What the rides found: by aspect, by class, and a sample of each class to probe. */
interface Found {
  /** Frames measured, by ride, so a finding cannot pass over rides that never ran. */
  readonly measured: Map<string, number>;
  /** Subject-frames the plane meets in the frame as `sceneFrame` built it, by aspect, and what they were. */
  readonly met: Map<string, Map<string, number>>;
  /**
   * Of {@link met}, those the renderer still draws: what is left once
   * `near-field.ts` §`peopleClearOfTheCamera` and §`mappedBuildingCut` have
   * dropped what they drop at that aspect (#1835).
   */
  readonly drawnMet: Map<string, Map<string, number>>;
  /** Subject-frames those two culls drop, met or not, by aspect: so a cull that drops too much is red too. */
  readonly dropped: Map<string, Map<string, number>>;
  /** Subject-frames asked about, by what they were: so a class that never came near cannot pass. */
  readonly asked: Map<string, number>;
  /** The first subject of each class — or sample, a lamp post's arm — that carries a probe. */
  readonly samples: Map<string, Subject>;
}

const found: Found = {
  measured: new Map(),
  met: new Map(),
  drawnMet: new Map(),
  dropped: new Map(),
  asked: new Map(),
  samples: new Map(),
};

/** One more subject-frame of `what` at `label`. */
function tally(into: Map<string, Map<string, number>>, label: string, what: string): void {
  const byWhat = into.get(label) ?? new Map<string, number>();
  byWhat.set(what, (byWhat.get(what) ?? 0) + 1);
  into.set(label, byWhat);
}

/**
 * Ride `name` once and add what it found to {@link found}. Each test below
 * asks for the rides it reads, so none depends on the order the tests run in:
 * a ride already taken is not taken again.
 */
function ride(name: string): void {
  if (found.measured.has(name)) return;
  const taken = (RIDES[name] as () => Ride)();
  const start = atStartLine(taken.profile);
  let frames = 0;
  for (let distance = taken.from; distance < taken.to; distance += 1) {
    const frame = sceneFrame({
      profile: taken.profile,
      origin: taken.origin,
      // The ride's clock moves with it, so the people walk.
      state: {
        ...start,
        ridden: seconds(start.ridden + distance / 8),
        ride: { speed: metresPerSecond(8), distance: metres(distance) },
      },
      people: PEOPLE_NEAR_MAX,
      ...taken.input,
    });
    const rig: CameraRig = cameraRig(frame.camera);
    const subjects = subjectsOf(frame, rig.eye);
    for (const subject of subjects) {
      found.asked.set(subject.what, (found.asked.get(subject.what) ?? 0) + 1);
      const sample = subject.sample ?? subject.what;
      if (subject.probe !== undefined && !found.samples.has(sample)) {
        found.samples.set(sample, subject);
      }
    }
    for (const [label, aspect] of Object.entries(ASPECTS)) {
      const pyramid = nearPyramid(rig, aspect);
      // What the renderer draws of them at this aspect (#1835): the people
      // `three-renderer.ts` hands its people belt, and the mapped buildings
      // its belt does not hide — a house model with its plan.
      const people = peopleClearOfTheCamera(frame.people, pyramid);
      const drawnPeople = new Set([...(people?.near ?? []), ...(people?.far ?? [])]);
      const cut = new Map<FootprintPlan, boolean>();
      const cutOf = ({ plan, radius }: { plan: FootprintPlan; radius: number }): boolean => {
        const known = cut.get(plan);
        if (known !== undefined) return known;
        const answer = mappedBuildingCut(plan, radius, pyramid);
        cut.set(plan, answer);
        return answer;
      };
      for (const subject of subjects) {
        const dropped =
          subject.person !== undefined
            ? !drawnPeople.has(subject.person)
            : subject.building !== undefined && cutOf(subject.building);
        if (dropped) tally(found.dropped, label, subject.what);
        if (!meets(subject, pyramid)) continue;
        tally(found.met, label, subject.what);
        if (!dropped) tally(found.drawnMet, label, subject.what);
      }
    }
    frames += 1;
  }
  found.measured.set(name, frames);
}

/** Every ride, each taken at most once. */
function rideAll(): Found {
  for (const name of Object.keys(RIDES)) ride(name);
  return found;
}

/** The classes the renderer culls at the near plane itself — #1835. */
const CULLED = ['person', 'mapped building'] as const;

/** Every class this file speaks for: each must be asked about, met by the control, and probed. */
const CLASSES = [
  'pavement',
  'lamp-post',
  'bollard',
  'bench',
  'bin',
  'person',
  'gantry',
  'board',
  'mapped building',
  'house model',
  'halloween pumpkin',
  'winter-lights post-lights',
  'winter-lights eave-lights',
  'winter-lights wreath',
] as const;

/** Every ride at once, when a test runs alone: the rides' own ceilings, together. */
const ALL_RIDES_TIMEOUT = 600_000;

describe('a ride — nothing beside the street is cut by the near plane (#545)', () => {
  // A ride takes about a second; the ceiling is `near-field.test.ts`' (#682).
  for (const name of Object.keys(RIDES)) {
    it(`${name}: every aspect`, () => {
      ride(name);
      expect(found.measured.get(name) ?? 0, `${name}: frames measured`).toBeGreaterThan(0);
    }, 230_000);
  }

  it(
    'meets nothing at any aspect a device draws — the owner’s tablet among them',
    () => {
      const { asked, met } = rideAll();
      // Every class was asked about, so none passes over its own absence.
      for (const what of CLASSES) expect(asked.get(what) ?? 0, what).toBeGreaterThan(0);
      for (const label of Object.keys(DEVICE_ASPECTS)) {
        expect(Object.fromEntries(met.get(label) ?? []), label).toEqual({});
        // So the renderer's own cull of the people and the mapped buildings
        // has nothing to drop on a device either: nobody vanishes (#1835).
        expect(Object.fromEntries(rideAll().dropped.get(label) ?? []), label).toEqual({});
      }
    },
    ALL_RIDES_TIMEOUT,
  );

  it(
    'the control: at 8 : 1 the same measure meets a gantry’s leg, a person, a lamp post, a decoration and a mapped wall',
    () => {
      // What makes the green rides mean something: on the same frames, a near
      // rectangle 5.6 m across reaches what stands at the road's edge. A measure
      // that could not find one would pass every ride above over nothing. The
      // classes 8 : 1 does not reach are held by the probe test below.
      const control = rideAll().met.get('the control frame') ?? new Map<string, number>();
      for (const what of [
        'gantry',
        'person',
        'lamp-post',
        'winter-lights post-lights',
        'mapped building',
      ]) {
        expect(control.get(what) ?? 0, what).toBeGreaterThan(0);
      }
    },
    ALL_RIDES_TIMEOUT,
  );

  it(
    'the probe: the measure meets every class where the product puts it, and not 50 m above it',
    () => {
      // A control for every class, the ones no frame brings near among them:
      // one subject of each, as the rides built it, asked of a near pyramid
      // standing where the PRODUCT says that thing is (its {@link Probe}). A
      // box this file built in the wrong place, or a mesh it never asks, is
      // missed by that pyramid and goes red here; the same pyramid 50 m up
      // must meet nothing, so a measure that meets everything goes red too.
      //
      // ⚠️ Since #1835 a probe is every corner the product gives the thing,
      // not only where it stands: a person's feet, crown and shoulders, each
      // part of a piece of furniture, a gantry's box, a decoration's every
      // drawn vertex, a model's rectangle. So a box this file built too small —
      // a person's made 1 cm — misses one and goes red here, where before only
      // the pinned count could see it.
      const { samples } = rideAll();
      for (const what of [...CLASSES, 'lamp-post arm']) {
        const subject = samples.get(what);
        expect(subject?.probe, `${what}: a sample to probe`).toBeDefined();
        if (subject?.probe === undefined) continue;
        const rigs = subject.probe();
        expect(rigs.length, `${what}: rigs to probe`).toBeGreaterThan(0);
        const up = (point: RigPoint): RigPoint => vector(point.x, point.y + 50, point.z);
        const aspect = DEVICE_ASPECTS["the owner's tablet"] as number;
        const missed = rigs.filter((at) => !meets(subject, nearPyramid(at, aspect))).length;
        expect.soft(missed, `${what}: probes that miss it where it stands`).toBe(0);
        const above = rigs.filter((at) =>
          meets(subject, nearPyramid({ eye: up(at.eye), target: up(at.target) }, aspect)),
        ).length;
        expect.soft(above, `${what}: probes that meet it 50 m above it`).toBe(0);
      }
    },
    ALL_RIDES_TIMEOUT,
  );

  it(
    'at 6 : 1 the renderer draws nothing the plane meets, where the frame as built has people on the bends and the kerbside town’s walls — #1835',
    () => {
      const { met, drawnMet } = rideAll();
      // What is drawn: nothing the plane meets, at the widest frame the
      // stylesheet allows (`camera.ts` §`WORST_CASE_ASPECT`). This was pinned
      // as a known failure until #1835.
      expect(Object.fromEntries(drawnMet.get(WIDEST_LABEL) ?? [])).toEqual({});
      // The control — the defect, as built: the same frames before the cull,
      // pinned exactly as #1834 measured them, so a cull that has nothing to
      // drop cannot pass over nothing, and a change to the camera, the line
      // or the placement that brings more to the plane shows here.
      expect(Object.fromEntries(met.get(WIDEST_LABEL) ?? [])).toEqual({
        person: 23,
        'mapped building': 282,
      });
    },
    ALL_RIDES_TIMEOUT,
  );

  it(
    'the cull drops exactly the people and the mapped buildings the plane meets, at 6 : 1 and at 8 : 1 — #1835',
    () => {
      // A cull that dropped every person near the eye, or every building in
      // the street, would pass the test above; it is a frame missing what a
      // rider should see. So what is dropped is what this file's own measure
      // meets, class by class, and nothing more — a house model goes with its
      // plan, which is the belt's rule, and is counted apart.
      const { met, dropped, drawnMet } = rideAll();
      for (const label of [WIDEST_LABEL, 'the control frame']) {
        const byWhat = dropped.get(label) ?? new Map<string, number>();
        for (const what of CULLED) {
          expect(byWhat.get(what) ?? 0, `${label}: ${what} dropped`).toBe(
            met.get(label)?.get(what) ?? 0,
          );
          expect(drawnMet.get(label)?.get(what) ?? 0, `${label}: ${what} drawn and met`).toBe(0);
        }
        for (const what of byWhat.keys()) {
          expect([...CULLED, 'house model'], `${label}: ${what} dropped`).toContain(what);
        }
      }
      // And at 8 : 1 what is not culled here is still met: the measure is the
      // same, and only the two classes are taken away.
      expect(drawnMet.get('the control frame')?.get('lamp-post') ?? 0).toBeGreaterThan(0);
    },
    ALL_RIDES_TIMEOUT,
  );
});

describe('the kerbside town — the closest pass the press allows (#545)', () => {
  it('stands mapped walls at the press’s least clearance, on the straights and round the bends', () => {
    // Non-vacuity for 'a kerbside town on bends': the walls the ride passes
    // are as near the road as `footprint-buildings.ts` rule 3 lets any stand.
    const fixture = kerbsideFixture();
    const town = pressed(fixture);
    expect(town.plans.length).toBeGreaterThan(100);
    // And it dropped the fifth it was handed nearer than that, as the map drew them.
    const { verdicts } = footprintPlans(
      fixture.corridor,
      town.land,
      fixture.profile,
      fixture.origin,
      FOOTPRINT_MAX_VERTICES,
      town.urban,
    );
    expect(verdicts['on-road']).toBeGreaterThanOrEqual(fixture.corridor.buildings.length / 5 - 2);
    let nearest = Infinity;
    for (const plan of town.plans) {
      for (let at = 0; at + 1 < plan.footprint.length; at += 2) {
        nearest = Math.min(
          nearest,
          distanceToDrawnRoad(
            town.profile,
            town.origin,
            plan.footprint[at] as number,
            plan.footprint[at + 1] as number,
            20,
          ),
        );
      }
    }
    expect(nearest).toBeGreaterThanOrEqual(ROAD_CLEARANCE_METRES - 1e-6);
    expect(nearest).toBeLessThan(ROAD_CLEARANCE_METRES + 0.1);
  });
});
