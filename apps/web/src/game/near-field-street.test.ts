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
 * through the real `sceneFrame`, on eight rides — the villages' road, three
 * bends, #1637's city centre, #1581's mixed town, #1585's street of house
 * models, and a town whose mapped walls stand at the press's least clearance
 * round the planner route's bends ({@link kerbsideFixture}) — at every aspect
 * a device draws, and held to the pyramid by a measure of its own: the
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
 * ⚠️ **Not 6 : 1.** `near-field.test.ts` holds the scatter clean at 6 : 1, the
 * widest frame the stylesheet allows, because the cull drops what the plane
 * would cut there. These classes are not culled, and from 32 : 9 upward the
 * plane DOES meet two of them: people on the S-bend's and the planner route's
 * bends, and the kerbside town's walls — at 6 : 1, 9 and 184 subject-frames
 * over the rides. Those are desktop browser frames no device draws; #545's
 * pull request records them as deferred, and this file asserts the device
 * frames only.
 *
 * ⚠️ **The control is 8 : 1**, the frame `near-field.test.ts`' control
 * rides: there the near rectangle is 5.6 m across, and the same measure on
 * the same frames DOES meet a gantry's leg, a person and a mapped wall — so a
 * measure that could find nothing (a box placed in the wrong frame, a plan
 * never asked of its triangles) cannot pass these rides over nothing.
 */

import { describe, expect, it } from 'vitest';

import { metres, metresPerSecond, seconds, type RouteProfile } from '@onyourleft/domain';

import { cameraRig, type CameraRig, type RigPoint } from './camera';
import { HOLIDAY_DECORATIONS, decorationsFor } from './decorations';
import {
  buildingBeside,
  cityCentreFixture,
  landBeside,
  mixedTownFixture,
  rectangleBeside,
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
import { nearPyramid, triangleMeets, type NearPyramid } from './near-field';
import { PEOPLE_NEAR_MAX, type Person } from './people';
import type { SceneFrame } from './port';
import { distanceToDrawnRoad } from './road-grid';
import { hairpinRoute, northRoute, plannerRoute, sBendRoute } from './route-fixtures-testing';
import { sceneFrame, type SceneInput } from './scene';
import type { MappedTown } from './settlements';
import { atStartLine } from './simulation';
import type { FurnitureItem, FurnitureKind } from './streets';
import { corridorOrigin, type CorridorOrigin } from './terrain';
import { urbanClassMap, type UrbanClassMap } from './urban-class';
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

const ASPECTS: Readonly<Record<string, number>> = {
  ...DEVICE_ASPECTS,
  'the control frame': CONTROL_ASPECT,
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

/** Where the kerbside town's every fifth front wall is mapped, metres from the road: inside the press's clearance. */
const INSIDE_CLEARANCE_METRES = 2;

/**
 * The closest pass a map can make: houses and shops whose front walls stand
 * `ROAD_CLEARANCE_METRES` and a few centimetres from the road — the least the
 * press keeps (`footprint-buildings.ts` rule 3) — every 9 m along both sides
 * of the planner's route, round its bends, on residential land and then
 * commercial, one storey to four. Every fifth is mapped nearer still, its
 * front {@link INSIDE_CLEARANCE_METRES} from the road, which the press must
 * drop. What the press drops, it drops; what is left is what a ride draws.
 */
function kerbsideFixture(): {
  readonly profile: RouteProfile;
  readonly origin: CorridorOrigin;
  readonly corridor: WorldCorridor;
} {
  const profile = plannerRoute();
  const origin = corridorOrigin(profile);
  const heights = [3.5, 6, 9, 12] as const;
  const kept = ROAD_CLEARANCE_METRES + 0.05;
  const buildings = [];
  const half = profile.totalDistance / 2;
  for (let along = 20, index = 0; along < profile.totalDistance - 20; along += 9, index += 1) {
    const front = index % 5 === 4 ? INSIDE_CLEARANCE_METRES : kept;
    for (const side of [1, -1]) {
      const depth = 8;
      buildings.push(
        buildingBeside(
          profile,
          origin,
          [rectangleBeside(along, side * (front + depth / 2), 7, depth)],
          heights[index % heights.length],
        ),
      );
    }
  }
  return {
    profile,
    origin,
    corridor: {
      routeId: 'kerbside',
      origin,
      covered: () => true,
      coveredBoxes: [{ minX: -5_000, maxX: 5_000, minZ: -5_000, maxZ: 5_000 }],
      landUse: [
        landBeside(profile, origin, 'landuse', 'residential', 0, half, -40, 40),
        landBeside(profile, origin, 'landuse', 'commercial', half, profile.totalDistance, -40, 40),
      ],
      buildings,
      paths: [],
      streets: [],
    },
  };
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
  'a 20 m hairpin': () => plainRide(hairpinRoute(20)),
  'an S-bend of 30 m': () => plainRide(sBendRoute(30)),
  "a planner's route": () => plainRide(plannerRoute()),
  // #1637's city centre: 3.5 m pavements, a lamp post every 16 m, people.
  'a city centre': () => townRide(pressed(cityCentreFixture()), 950, 2_050),
  // #1581's mixed town: mapped houses and a high street, models among them.
  'a mixed town': () => townRide(pressed(mixedTownFixture()), 950, 2_050),
  // #1585's Richmond street: house models and extrusions side by side.
  'a street of house models': () => townRide(pressed(richmondStreetFixture()), 950, 1_450),
  // The closest the press lets a mapped wall stand, round the planner's bends.
  'a kerbside town on bends': () => {
    const town = pressed(kerbsideFixture());
    return townRide(town, 0, town.profile.totalDistance);
  },
};

/** What a frame draws beside the street, as the boxes and meshes this file holds to the pyramid. */
type Subject =
  | { readonly kind: 'box'; readonly what: string; readonly box: Box }
  | { readonly kind: 'plan'; readonly what: string; readonly plan: FootprintPlan }
  | {
      readonly kind: 'mesh';
      readonly what: string;
      readonly positions: Float32Array;
      readonly indices: Uint16Array | Uint32Array;
    };

/** Everything a frame draws that is not scatter, near enough the eye to ask about. */
function subjectsOf(frame: SceneFrame, eye: RigPoint): Subject[] {
  const subjects: Subject[] = [];
  for (const street of frame.streets) {
    subjects.push({
      kind: 'mesh',
      what: 'pavement',
      positions: street.pavement.positions,
      indices: street.pavement.indices,
    });
    for (const item of street.furniture) {
      for (const box of furnitureBoxes(item)) subjects.push({ kind: 'box', what: item.kind, box });
    }
  }
  for (const holiday of ['halloween', 'winter-lights'] as const) {
    for (const placed of decorationsFor(frame.streets, holiday, HOLIDAY_DECORATIONS)) {
      const kind = HOLIDAY_DECORATIONS[holiday]?.find((each) => each.item === placed.item);
      for (const part of kind?.parts ?? []) {
        const [w, h, d] = part.size;
        const [px, py, pz] = part.at;
        const { anchor } = placed;
        const sin = Math.sin(anchor.yaw);
        const cos = Math.cos(anchor.yaw);
        // The part's middle, turned by the anchor's yaw as three turns it.
        const x = anchor.x + px * cos + pz * sin;
        const z = anchor.z - px * sin + pz * cos;
        subjects.push({
          kind: 'box',
          what: `${holiday} ${placed.item}`,
          box: turnedBox(x, placed.base + py, z, anchor.yaw, w / 2, -d / 2, d / 2, -h / 2, h / 2),
        });
      }
    }
  }
  for (const person of [...(frame.people?.near ?? []), ...(frame.people?.far ?? [])]) {
    subjects.push({ kind: 'box', what: 'person', box: personBox(person) });
  }
  for (const stand of frame.lines) {
    for (const box of standBoxes(stand)) {
      subjects.push({ kind: 'box', what: stand.stand.kind, box });
    }
  }
  const mapped = frame.mappedBuildings;
  if (mapped !== undefined) {
    const { plans, radii } = mapped.buildings;
    plans.forEach((plan, index) => {
      const reach = (radii[index] ?? 0) + 30;
      if (Math.hypot(plan.centroid.x - eye.x, plan.centroid.z - eye.z) > reach) return;
      subjects.push({ kind: 'plan', what: 'mapped building', plan });
      const model = modelBox(plan);
      if (model !== undefined) subjects.push({ kind: 'box', what: 'house model', box: model });
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

describe('a ride — nothing beside the street is cut by the near plane (#545)', () => {
  /** Subject-frames the plane meets, by aspect, and what they were. */
  const met = new Map<string, Map<string, number>>();
  /** Subject-frames asked about, by what they were: so a class that never came near cannot pass. */
  const asked = new Map<string, number>();
  /** Frames measured, by ride, so a finding below cannot pass over rides that never ran. */
  const measured = new Map<string, number>();

  // A ride takes about a second; the ceiling is `near-field.test.ts`' (#682).
  for (const name of Object.keys(RIDES)) {
    it(`${name}: every aspect`, () => {
      const ride = (RIDES[name] as () => Ride)();
      const start = atStartLine(ride.profile);
      for (let distance = ride.from; distance < ride.to; distance += 1) {
        const frame = sceneFrame({
          profile: ride.profile,
          origin: ride.origin,
          // The ride's clock moves with it, so the people walk.
          state: {
            ...start,
            ridden: seconds(start.ridden + distance / 8),
            ride: { speed: metresPerSecond(8), distance: metres(distance) },
          },
          people: PEOPLE_NEAR_MAX,
          ...ride.input,
        });
        const rig: CameraRig = cameraRig(frame.camera);
        const subjects = subjectsOf(frame, rig.eye);
        for (const subject of subjects) asked.set(subject.what, (asked.get(subject.what) ?? 0) + 1);
        for (const [label, aspect] of Object.entries(ASPECTS)) {
          const pyramid = nearPyramid(rig, aspect);
          for (const subject of subjects) {
            if (!meets(subject, pyramid)) continue;
            const byWhat = met.get(label) ?? new Map<string, number>();
            byWhat.set(subject.what, (byWhat.get(subject.what) ?? 0) + 1);
            met.set(label, byWhat);
          }
        }
        measured.set(name, (measured.get(name) ?? 0) + 1);
      }
    }, 230_000);
  }

  it('meets nothing at any aspect a device draws — the owner’s tablet among them', () => {
    for (const name of Object.keys(RIDES)) {
      expect(measured.get(name) ?? 0, `${name}: frames measured`).toBeGreaterThan(0);
    }
    // Every class was asked about, so none passes over its own absence.
    for (const what of [
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
    ]) {
      expect(asked.get(what) ?? 0, what).toBeGreaterThan(0);
    }
    for (const label of Object.keys(DEVICE_ASPECTS)) {
      expect(Object.fromEntries(met.get(label) ?? []), label).toEqual({});
    }
  });

  it('the control: at 8 : 1 the same measure meets a gantry’s leg, a person and a mapped wall', () => {
    // What makes the green rides mean something: on the same frames, a near
    // rectangle 5.6 m across reaches what stands at the road's edge. A measure
    // that could not find one would pass every ride above over nothing.
    const control = met.get('the control frame') ?? new Map<string, number>();
    expect(control.get('gantry') ?? 0).toBeGreaterThan(0);
    expect(control.get('person') ?? 0).toBeGreaterThan(0);
    expect(control.get('mapped building') ?? 0).toBeGreaterThan(0);
  });
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
