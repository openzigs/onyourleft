// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #1588: the US house — clapboard, asphalt shingles, sash windows with a
 * fake inset reveal, shutters, a foundation band, garages with driveways,
 * gutters, a downpipe and dormers — held where it is decided, in the plans
 * (`footprint-buildings.ts`) and in the layout the shader draws from
 * (`facade.ts`). Each rule with its control where one can be made: the same
 * call with the rule's input taken away.
 */

import { describe, expect, it } from 'vitest';

import type { BuildingFeature } from '@onyourleft/map-features';

import { SHINGLE_PAINTS } from './building-paint';
import {
  claddingPartAt,
  CLAPBOARD,
  facadePartAt,
  FOUNDATION,
  MULLION_METRES,
  PAIR_MIN_BAY_METRES,
  PAVING,
  PICTURE,
  REVEAL,
  SASH,
  SASH_TOP_SHARE,
  SHINGLE,
  SHUTTER,
  type FacadePart,
  type FacadeStyle,
} from './facade';
import {
  CLAD_BLOCK,
  CLAD_BRICK,
  CLAD_CLAPBOARD,
  CLAD_PAVING,
  CLAD_PHOTOGRAPH,
  CLAD_SHINGLE,
  CLAPBOARD_COURSE_METRES,
  DORMER,
  DORMER_MIN_PITCH_DEGREES,
  DOWNPIPE,
  DRIVEWAY,
  EAVES_OVERHANG_METRES,
  FACADE_DOOR,
  FACADE_DORMER,
  FACADE_GARAGE,
  FACADE_OFFSET,
  FOOTPRINT_MAX_FAR_TRIANGLES,
  FOOTPRINT_MAX_TRIANGLES,
  FOOTPRINT_VERTEX_FLOATS,
  footprintPlans,
  garageOf,
  GARAGE,
  GARAGE_MIN_BAYS,
  GUTTER,
  mappedTown,
  minimumAreaRectangle,
  RingGrid,
  SHINGLE_COURSE_METRES,
  SHINGLE_SHARE,
  SIDING_SHARE,
  STOREY_METRES,
  STYLE_EAVES,
  STYLE_OFFSET,
  STYLE_SASH,
  STYLE_SHUTTERS,
  type FootprintPlan,
  type FootprintRole,
} from './footprint-buildings';
import {
  besideRoad,
  buildingBeside,
  landBeside,
  mixedTownFixture,
  rectangleBeside,
  ringBeside,
} from './footprint-fixtures-testing';
import { FOUNDATION_METRES } from './buildings';
import { landClassMask } from './land-class';
import { nearestOnRoadSegments, roadSegmentsNear, type BesideTheRoad } from './road-grid';
import { northRoute } from './route-fixtures-testing';
import { corridorOrigin, ROAD_WIDTH_METRES, type CorridorOrigin } from './terrain';
import type { RouteProfile } from '@onyourleft/domain';
import type { WorldCorridor } from './world-data/corridor';

/** One vertex of a plan: position, normal, facade and style. */
interface Vertex {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly ny: number;
  readonly u: number;
  readonly v: number;
  readonly top: number;
  readonly skip: number;
  readonly clad: number;
  readonly flags: number;
  readonly width: number;
  readonly extra: number;
}

function verticesOf(plan: FootprintPlan, role: FootprintRole): Vertex[] {
  const floats = plan.triangles[role];
  const out: Vertex[] = [];
  for (let at = 0; at < floats.length; at += FOOTPRINT_VERTEX_FLOATS) {
    const f = (k: number): number => floats[at + k] as number;
    out.push({
      x: f(0),
      y: f(1),
      z: f(2),
      ny: f(4),
      u: f(FACADE_OFFSET),
      v: f(FACADE_OFFSET + 1),
      top: f(FACADE_OFFSET + 2),
      skip: f(FACADE_OFFSET + 3),
      clad: f(STYLE_OFFSET),
      flags: f(STYLE_OFFSET + 1),
      width: f(STYLE_OFFSET + 2),
      extra: f(STYLE_OFFSET + 3),
    });
  }
  return out;
}

const code = (clad: number): number => Math.floor(clad + 1e-4);

/** How far `(x, z)` is from the drawn road's centreline. */
function fromRoad(profile: RouteProfile, origin: CorridorOrigin, x: number, z: number): number {
  const segments: number[] = [];
  const road = roadSegmentsNear(profile, origin, x, z, 300, segments);
  const beside: BesideTheRoad = { along: 0, lateral: 0, distance: 0 };
  nearestOnRoadSegments(road, segments, x, z, beside);
  return beside.distance;
}

const mixed = mixedTownFixture();
const mixedLand = landClassMask(mixed.corridor);
const { plans: town } = footprintPlans(mixed.corridor, mixedLand, mixed.profile, mixed.origin);
/** The mixed town's residential plans: those whose walls carry sash windows. */
const residential = town.filter((plan) =>
  verticesOf(plan, 'wall').some((vertex) => (vertex.flags & STYLE_SASH) !== 0),
);
const pitched = town.filter((plan) => plan.roof !== 'flat');

describe('the US sash window — #1588, facade.ts', () => {
  /** A residential wall's style: sash, a bay of `width` metres, no picture window. */
  const sash = (width: number, flags = STYLE_SASH, extra = -1, sun = 0): FacadeStyle => ({
    flags,
    width,
    extra,
    sun,
  });
  /** The part at metres `(x, y)` from bay 1's middle and storey 1's floor, eaves well above. */
  const at = (style: FacadeStyle, x: number, y: number): FacadePart =>
    facadePartAt(1.5 + x / style.width, 1 + y / STOREY_METRES, 3, -1, style);

  it('is about 1 : 1.7, sill 0.9 m up, with a meeting rail across its middle', () => {
    expect(SASH.height / SASH.width).toBeGreaterThan(1.6);
    expect(SASH.height / SASH.width).toBeLessThan(1.8);
    const style = sash(3);
    const middle = 0.9 + SASH.height / 2;
    expect(at(style, 0, middle)).toBe('frame');
    expect(at(style, 0, middle - SASH.rail)).toBe('glass');
    expect(at(style, 0, middle + SASH.rail)).toBe('glass');
    // Its frame, and the wall beside and above it.
    expect(at(style, SASH.width / 2 - SASH.frame / 2, middle - 0.3)).toBe('frame');
    expect(at(style, SASH.width / 2 + 0.05, middle - 0.3)).toBe('wall');
    expect(at(style, 0, 0.9 + SASH.height + 0.05)).toBe('wall');
    // The sill, under it.
    expect(at(style, 0, 0.9 - 0.03)).toBe('sill');
  });

  it('pairs two sashes either side of a mullion in a wide bay, and one in a narrow one', () => {
    const y = 0.9 + SASH.height * 0.3;
    const centre = SASH.width / 2 + MULLION_METRES / 2;
    const wide = sash(PAIR_MIN_BAY_METRES);
    expect(at(wide, -centre, y)).toBe('glass');
    expect(at(wide, centre, y)).toBe('glass');
    expect(at(wide, 0, y)).toBe('frame');
    // Control: a bay a little narrower holds one, centred, and its middle is glass.
    const narrow = sash(PAIR_MIN_BAY_METRES - 0.1);
    expect(at(narrow, 0, y)).toBe('glass');
    expect(at(narrow, centre, y)).toBe('wall');
  });

  it('draws a picture window — wide, no rail — in the bay the style names, on the ground storey only', () => {
    const bay = 3.4;
    const style = sash(bay, STYLE_SASH, 2);
    const width = Math.min(bay - PICTURE.margin, PICTURE.most);
    const middle = 0.9 + SASH.height / 2;
    // Ground storey, bay 2: glass across the rail's height, and wide.
    const ground = (x: number, y: number): FacadePart =>
      facadePartAt(2.5 + x / bay, y / STOREY_METRES, 3, -1, style);
    expect(ground(0, middle)).toBe('glass');
    expect(ground(width / 2 - SASH.frame - 0.02, middle - 0.3)).toBe('glass');
    // The same bay a storey up is a sash, and bay 1 on the ground is too.
    expect(facadePartAt(2.5, 1 + middle / STOREY_METRES, 3, -1, style)).toBe('frame');
    expect(facadePartAt(1.5, middle / STOREY_METRES, 3, -1, style)).toBe('frame');
  });

  it('shades the glass under the head and, on the sun’s side only, in from the jamb', () => {
    const y = 0.9 + SASH.height * 0.25;
    const head = 0.9 + SASH.height - SASH.frame - REVEAL.head / 2;
    const jamb = SASH.width / 2 - SASH.frame - REVEAL.jamb / 2;
    expect(at(sash(3), 0, head)).toBe('reveal');
    // The sun toward +u: the +u jamb's strip is shaded, the −u one is not.
    expect(at(sash(3, STYLE_SASH, -1, 1), jamb, y)).toBe('reveal');
    expect(at(sash(3, STYLE_SASH, -1, 1), -jamb, y)).toBe('glass');
    expect(at(sash(3, STYLE_SASH, -1, -1), -jamb, y)).toBe('reveal');
    // Control: with the face in shade there is no jamb's shadow.
    expect(at(sash(3), jamb, y)).toBe('glass');
    // A pair's left window is mirrored: its sun-side jamb is the inner one.
    const centre = SASH.width / 2 + MULLION_METRES / 2;
    const pair = sash(PAIR_MIN_BAY_METRES, STYLE_SASH, -1, 1);
    expect(at(pair, -centre + jamb, y)).toBe('reveal');
    expect(at(pair, centre + jamb, y)).toBe('reveal');
    expect(at(pair, -centre - jamb, y)).toBe('glass');
  });

  it('hangs shutters either side where the style asks and the bay is wide enough', () => {
    const y = 0.9 + SASH.height / 2;
    const out = SASH.width / 2 + SHUTTER.gap + (SASH.width * SHUTTER.share) / 2;
    const style = sash(3, STYLE_SASH + STYLE_SHUTTERS);
    expect(at(style, out, y)).toBe('shutter');
    expect(at(style, -out, y)).toBe('shutter');
    // Control: without the flag, the wall.
    expect(at(sash(3), out, y)).toBe('wall');
    // And none in a bay too narrow for the pair of them.
    const fits = 2 * (SASH.width / 2 + SHUTTER.gap + SASH.width * SHUTTER.share + SHUTTER.margin);
    expect(at(sash(fits - 0.05, STYLE_SASH + STYLE_SHUTTERS), out, y)).toBe('wall');
  });

  it('cuts no sash the eaves would cut, by the sash’s own height', () => {
    // A storey whose sash top passes `top` has none; #1581's casement would fit.
    const top = 2 + SASH_TOP_SHARE - 0.01;
    const style = sash(3);
    expect(facadePartAt(2.5, 2.5, top, -1, style)).toBe('wall');
    expect(facadePartAt(2.5, 2.5, top + 0.02, -1, style)).not.toBe('wall');
  });

  it('draws a dormer’s front with one sash in its middle, and a garage’s face as a leaf in a surround', () => {
    const dormer: FacadeStyle = { flags: 0, width: DORMER.width, extra: DORMER.front };
    expect(facadePartAt(DORMER.width / 2 + 0.1, 0.5, FACADE_DORMER, -1, dormer)).toBe('glass');
    expect(facadePartAt(0.05, 0.5, FACADE_DORMER, -1, dormer)).toBe('wall');
    const garage: FacadeStyle = { flags: 0, width: 3, extra: GARAGE.leaf };
    expect(facadePartAt(1.5, 1, FACADE_GARAGE, -1, garage)).toBe('leaf');
    expect(facadePartAt(1.5, GARAGE.leaf + 0.1, FACADE_GARAGE, -1, garage)).toBe('surround');
    expect(facadePartAt(GARAGE.surround / 2, 1, FACADE_GARAGE, -1, garage)).toBe('surround');
  });
});

describe('the cladding — #1588, facade.ts', () => {
  it('lays clapboard in courses, a shadow under each lap and a lit butt at each course’s foot', () => {
    const course = 0.12;
    const clad = CLAD_CLAPBOARD + course;
    for (let k = 3; k < 8; k += 1) {
      expect(claddingPartAt(clad, 0, k * course - 0.005)).toBe('lap-shadow');
      expect(claddingPartAt(clad, 0, k * course + 0.002)).toBe('butt');
      expect(claddingPartAt(clad, 0, (k + 0.5) * course)).toBe('board');
    }
    expect(CLAPBOARD.lapShadow).toBeGreaterThan(0);
  });

  it('staggers shingle tabs by half a tab from one course to the next, under each butt’s shadow', () => {
    const clad = CLAD_SHINGLE + SHINGLE_COURSE_METRES;
    const e = SHINGLE_COURSE_METRES;
    // Course 0's keyways at whole tabs; course 1's at half tabs.
    expect(claddingPartAt(clad, SHINGLE.tab * 2, 0.5 * e)).toBe('keyway');
    expect(claddingPartAt(clad, SHINGLE.tab * 2, 1.5 * e)).toBe('tab');
    expect(claddingPartAt(clad, SHINGLE.tab * 2.5, 1.5 * e)).toBe('keyway');
    expect(claddingPartAt(clad, SHINGLE.tab * 2.3, e - 0.005)).toBe('course-shadow');
  });

  it('bonds a foundation, block and brick, and joints a driveway every slab', () => {
    const [blockAlong, blockUp] = FOUNDATION.block;
    expect(claddingPartAt(CLAD_BLOCK, 0.1, blockUp * 0.5)).toBe('unit');
    expect(claddingPartAt(CLAD_BLOCK, blockAlong, blockUp * 0.5)).toBe('mortar');
    // Running bond: the next course's joint is half a block along.
    expect(claddingPartAt(CLAD_BLOCK, blockAlong, blockUp * 1.5)).toBe('unit');
    expect(claddingPartAt(CLAD_BLOCK, blockAlong * 1.5, blockUp * 1.5)).toBe('mortar');
    const [, brickUp] = FOUNDATION.brick;
    expect(claddingPartAt(CLAD_BRICK, 0.05, brickUp)).toBe('mortar');
    expect(claddingPartAt(CLAD_PAVING, 0.5, PAVING.slab * 2)).toBe('joint');
    expect(claddingPartAt(CLAD_PAVING, 0.5, PAVING.slab * 2.5)).toBe('slab');
    expect(claddingPartAt(CLAD_PHOTOGRAPH, 0.5, 0.5)).toBe('photograph');
  });
});

describe('the plans are clad — #1588, over the mixed town', () => {
  it('clads most residential walls in clapboard, and no other use’s', () => {
    expect(residential.length).toBeGreaterThan(60);
    const clapboard = residential.filter((plan) => plan.cladding.wall === 'clapboard');
    expect(clapboard.length / residential.length).toBeGreaterThan(SIDING_SHARE - 0.15);
    expect(clapboard.length / residential.length).toBeLessThan(SIDING_SHARE + 0.15);
    // Brick and render stay for the rest.
    expect(residential.some((plan) => plan.surfaces.wall === 'brick')).toBe(true);
    expect(
      residential.some(
        (plan) => plan.surfaces.wall === 'render' && plan.cladding.wall !== 'clapboard',
      ),
    ).toBe(true);
    for (const plan of town) {
      const sashed = residential.includes(plan);
      if (!sashed) expect(plan.cladding.wall).toBe('photograph');
      for (const vertex of verticesOf(plan, 'wall')) {
        if (plan.cladding.wall === 'clapboard') {
          expect(code(vertex.clad)).toBe(CLAD_CLAPBOARD);
          const course = vertex.clad - CLAD_CLAPBOARD;
          expect(course).toBeGreaterThanOrEqual(CLAPBOARD_COURSE_METRES.least - 1e-6);
          expect(course).toBeLessThanOrEqual(CLAPBOARD_COURSE_METRES.most + 1e-6);
        } else {
          expect(vertex.clad).toBe(CLAD_PHOTOGRAPH);
        }
      }
    }
  });

  it('seeds the course per house, 10 to 15 cm', () => {
    const courses = new Set(
      residential
        .filter((plan) => plan.cladding.wall === 'clapboard')
        .map((plan) => plan.cladding.course.toFixed(3)),
    );
    expect(courses.size).toBeGreaterThan(20);
  });

  it('shingles most pitched roofs, in a shingle paint, and keeps clay and slate for the rest', () => {
    const shingled = pitched.filter((plan) => plan.cladding.roof === 'shingle');
    expect(shingled.length / pitched.length).toBeGreaterThan(SHINGLE_SHARE - 0.15);
    expect(shingled.length / pitched.length).toBeLessThan(SHINGLE_SHARE + 0.15);
    expect(pitched.some((plan) => plan.cladding.roof === 'photograph')).toBe(true);
    for (const plan of town) {
      const roof = verticesOf(plan, 'roof');
      if (plan.cladding.roof === 'shingle') {
        expect(plan.paint.roof).toBeLessThan(SHINGLE_PAINTS.length);
        for (const vertex of roof)
          expect(vertex.clad).toBeCloseTo(CLAD_SHINGLE + SHINGLE_COURSE_METRES, 5);
      } else {
        for (const vertex of roof) expect(vertex.clad).toBe(CLAD_PHOTOGRAPH);
      }
    }
    for (const plan of town.filter((each) => each.roof === 'flat')) {
      expect(plan.cladding.roof).toBe('photograph');
    }
  });

  it('lays a shingled slope’s facade in metres along its eaves and up it', () => {
    for (const plan of pitched.filter((each) => each.cladding.roof === 'shingle')) {
      const roof = verticesOf(plan, 'roof');
      const lowest = Math.min(...roof.map((vertex) => vertex.y));
      const eaves = roof.filter((vertex) => vertex.y < lowest + 1e-4);
      for (const vertex of eaves) expect(vertex.v).toBeCloseTo(0, 5);
      const highest = roof.reduce((best, vertex) => (vertex.y > best.y ? vertex : best));
      const cos = Math.cos((plan.pitchDegrees * Math.PI) / 180);
      // Up the slope from the eaves to the ridge: the rise over the sine.
      const sin = Math.sqrt(1 - cos * cos);
      expect(highest.v).toBeCloseTo((highest.y - lowest) / sin, 3);
    }
  });

  it('stands a clapboard house on a block or brick foundation, and every other on its photograph', () => {
    let brick = 0;
    let block = 0;
    for (const plan of town) {
      const plinth = verticesOf(plan, 'plinth');
      if (plinth.length === 0) continue;
      const codes = new Set(plinth.map((vertex) => vertex.clad));
      expect(codes.size).toBe(1);
      const clad = [...codes][0] as number;
      if (plan.cladding.wall !== 'clapboard') {
        expect(clad).toBe(CLAD_PHOTOGRAPH);
        continue;
      }
      expect([CLAD_BLOCK, CLAD_BRICK]).toContain(clad);
      if (clad === CLAD_BRICK) brick += 1;
      else block += 1;
      // In metres down from the floor, to the foundation's foot.
      expect(Math.min(...plinth.map((vertex) => vertex.v))).toBeLessThan(-FOUNDATION_METRES + 1e-3);
    }
    expect(brick).toBeGreaterThan(0);
    expect(block).toBeGreaterThan(brick);
  });

  it('marks the walls under an overhanging roof, and no flat roof’s', () => {
    for (const plan of town) {
      for (const vertex of verticesOf(plan, 'wall')) {
        if (vertex.top <= 0) continue;
        expect((vertex.flags & STYLE_EAVES) !== 0).toBe(plan.roof !== 'flat');
      }
    }
  });

  it('gives a residential wall its bay in metres, and shutters to some houses', () => {
    let shuttered = 0;
    for (const plan of residential) {
      const walls = verticesOf(plan, 'wall');
      for (let at = 0; at + 6 <= walls.length; at += 6) {
        const quad = walls.slice(at, at + 6);
        const first = quad[0] as Vertex;
        if (first.top <= 0) continue;
        const bays = Math.max(...quad.map((vertex) => vertex.u));
        const ends = quad.filter((vertex) => vertex.v === Math.min(...quad.map((each) => each.v)));
        const a = ends.find((vertex) => vertex.u === 0) as Vertex;
        const b = ends.find((vertex) => vertex.u === bays) as Vertex;
        expect(first.width).toBeCloseTo(Math.hypot(b.x - a.x, b.z - a.z) / bays, 4);
      }
      if (walls.some((vertex) => (vertex.flags & STYLE_SHUTTERS) !== 0)) shuttered += 1;
    }
    expect(shuttered).toBeGreaterThan(residential.length * 0.2);
    expect(shuttered).toBeLessThan(residential.length * 0.6);
  });

  it('puts a picture window beside the door of some single-storey houses only, never in the garage’s bay', () => {
    let pictures = 0;
    for (const plan of town) {
      const named = verticesOf(plan, 'wall').filter(
        (vertex) => vertex.top > 0 && vertex.extra >= 0,
      );
      if (named.length === 0) continue;
      pictures += 1;
      expect(plan.storeys).toBe(1);
      const first = named[0] as Vertex;
      // Beside the door: the door's bay is the skipped one.
      expect(Math.abs(first.extra - first.skip)).toBe(1);
    }
    expect(pictures).toBeGreaterThan(0);
  });

  it('never puts the picture window in the garage’s bay, over a row of wide bungalows with garages', () => {
    const profile = northRoute(3_000, () => 10);
    const origin = corridorOrigin(profile);
    const buildings: BuildingFeature[] = [];
    // Eleven metres along the road: three bays, the door in the middle.
    for (let along = 200; along < 1_400; along += 25) {
      buildings.push(buildingBeside(profile, origin, [rectangleBeside(along, 26, 11, 8)], 3.5));
    }
    const corridor: WorldCorridor = {
      routeId: 'bungalows',
      origin,
      covered: () => true,
      coveredBoxes: [{ minX: -1_000, maxX: 1_000, minZ: -500, maxZ: 3_500 }],
      landUse: [landBeside(profile, origin, 'landuse', 'residential', 100, 1_500, -60, 60)],
      buildings,
      paths: [],
      streets: [],
    };
    const { plans } = footprintPlans(corridor, landClassMask(corridor), profile, origin);
    let both = 0;
    for (const plan of plans.filter((each) => each.garage)) {
      const wall = verticesOf(plan, 'wall').filter((vertex) => vertex.top > 0 && vertex.extra >= 0);
      if (wall.length === 0) continue;
      // The garage's bay, from where its door stands along the wall.
      const quad = wall.slice(0, 6);
      const bays = Math.max(...quad.map((vertex) => vertex.u));
      const low = Math.min(...quad.map((vertex) => vertex.v));
      const a = quad.find((vertex) => vertex.u === 0 && vertex.v === low) as Vertex;
      const b = quad.find((vertex) => vertex.u === bays && vertex.v === low) as Vertex;
      const face = verticesOf(plan, 'door').filter((vertex) => vertex.top === FACADE_GARAGE);
      const cx = face.reduce((sum, vertex) => sum + vertex.x, 0) / face.length;
      const cz = face.reduce((sum, vertex) => sum + vertex.z, 0) / face.length;
      const t =
        ((cx - a.x) * (b.x - a.x) + (cz - a.z) * (b.z - a.z)) /
        ((b.x - a.x) ** 2 + (b.z - a.z) ** 2);
      const garageBay = Math.floor(t * bays);
      expect([0, bays - 1]).toContain(garageBay);
      expect((quad[0] as Vertex).extra).not.toBe(garageBay);
      both += 1;
    }
    expect(both).toBeGreaterThan(3);
  });
});

describe('gutters, a downpipe and dormers — #1588', () => {
  it('hangs a gutter under each long eave of every residential pitched roof, and a downpipe to the ground', () => {
    const houses = pitched.filter((plan) => residential.includes(plan));
    expect(houses.length).toBeGreaterThan(30);
    for (const plan of houses) {
      const rectangle = minimumAreaRectangle(plan.footprint);
      const tan = Math.tan((plan.pitchDegrees * Math.PI) / 180);
      const roof = verticesOf(plan, 'roof');
      const eaveY = Math.min(...roof.map((vertex) => vertex.y));
      const across = rectangle.halfShort + EAVES_OVERHANG_METRES;
      const outside = (vertex: Vertex): number =>
        Math.abs(
          -(vertex.x - rectangle.cx) * rectangle.uz + (vertex.z - rectangle.cz) * rectangle.ux,
        );
      // The gutters' fronts: trim facing out at the gutter's reach, from its top to its foot.
      const fronts = verticesOf(plan, 'trim').filter(
        (vertex) => Math.abs(outside(vertex) - (across + GUTTER.width)) < 1e-3,
      );
      const top = eaveY - GUTTER.below;
      // Each gutter: its front's six corners, and three each of its bottom's and its ends'.
      expect(fronts.length).toBe(2 * (6 + 3 + 3 + 3));
      for (const vertex of fronts) {
        expect([top, top - GUTTER.depth].some((y) => Math.abs(vertex.y - y) < 1e-3)).toBe(true);
      }
      // The downpipe reaches the ground at the plinth's foot level.
      const lowest = Math.min(...verticesOf(plan, 'trim').map((vertex) => vertex.y));
      expect(lowest).toBeCloseTo(plan.base + FOUNDATION_METRES, 3);
      // Down the wall: its foot against the rectangle's long wall, where no porch post stands.
      const pipe = verticesOf(plan, 'trim').filter((vertex) => vertex.y < lowest + 1e-3);
      // Three faces, each with three of its six corners at its foot.
      expect(pipe.length).toBe(9);
      for (const vertex of pipe) {
        expect(outside(vertex)).toBeGreaterThanOrEqual(rectangle.halfShort - 1e-3);
        expect(outside(vertex)).toBeLessThanOrEqual(rectangle.halfShort + DOWNPIPE.size + 1e-3);
      }
      expect(tan).toBeGreaterThan(0);
    }
  });

  it('control: no gutter on a flat roof, nor on a pitched roof that is not a house’s', () => {
    for (const plan of town.filter((each) => each.roof === 'flat' || !residential.includes(each))) {
      const rectangle = minimumAreaRectangle(plan.footprint);
      const reach = rectangle.halfShort + EAVES_OVERHANG_METRES + GUTTER.width;
      const fronts = verticesOf(plan, 'trim').filter(
        (vertex) =>
          Math.abs(
            Math.abs(
              -(vertex.x - rectangle.cx) * rectangle.uz + (vertex.z - rectangle.cz) * rectangle.ux,
            ) - reach,
          ) < 1e-3,
      );
      expect(fronts).toStrictEqual([]);
    }
  });

  it('control: no gutter on a farm’s pitched barn, which is not a house', () => {
    const profile = northRoute(3_000, () => 10);
    const origin = corridorOrigin(profile);
    const buildings: BuildingFeature[] = [];
    for (let along = 200; along < 1_400; along += 40) {
      buildings.push(buildingBeside(profile, origin, [rectangleBeside(along, 30, 12, 8)], 5));
    }
    const corridor: WorldCorridor = {
      routeId: 'barns',
      origin,
      covered: () => true,
      coveredBoxes: [{ minX: -1_000, maxX: 1_000, minZ: -500, maxZ: 3_500 }],
      landUse: [landBeside(profile, origin, 'landuse', 'farmland', 100, 1_500, -60, 60)],
      buildings,
      paths: [],
      streets: [],
    };
    const { plans } = footprintPlans(corridor, landClassMask(corridor), profile, origin);
    const barns = plans.filter((plan) => plan.roof !== 'flat');
    expect(barns.length).toBeGreaterThan(10);
    for (const plan of barns) {
      // A barn's trim is its soffits and fascias, all above the eaves' fall: nothing reaches the ground.
      const lowest = Math.min(...verticesOf(plan, 'trim').map((vertex) => vertex.y));
      expect(lowest).toBeGreaterThan(plan.base + FOUNDATION_METRES + 1);
    }
  });

  it('stands dormers on steep residential roofs only, inside the roof and under its ridge', () => {
    let built = 0;
    for (const plan of town) {
      const dormer = verticesOf(plan, 'dormer');
      const roof = verticesOf(plan, 'dormer-roof');
      if (plan.dormers === 0) {
        expect(dormer).toStrictEqual([]);
        expect(roof).toStrictEqual([]);
        continue;
      }
      built += plan.dormers;
      expect(plan.pitchDegrees).toBeGreaterThanOrEqual(DORMER_MIN_PITCH_DEGREES);
      expect(residential.includes(plan)).toBe(true);
      // Nine triangles each: a front, its gable, two cheeks and a roof of two.
      expect(dormer.length / 3).toBe(5 * plan.dormers);
      expect(roof.length / 3).toBe(4 * plan.dormers);
      const ridge = Math.max(...verticesOf(plan, 'roof').map((vertex) => vertex.y));
      for (const vertex of roof)
        expect(vertex.y).toBeLessThanOrEqual(ridge - DORMER.belowRidge + 1e-3);
      // A front with a window in it, in metres.
      const fronts = dormer.filter((vertex) => vertex.top === FACADE_DORMER);
      expect(fronts.length).toBe(6 * plan.dormers);
      for (const vertex of fronts) {
        expect(vertex.width).toBe(DORMER.width);
        expect(vertex.extra).toBe(DORMER.front);
      }
      // The dormer's roof wears the roof's cladding, its walls the walls'.
      const wallClad = verticesOf(plan, 'wall')[0]?.clad;
      for (const vertex of dormer) expect(vertex.clad).toBe(wallClad);
      const roofClad = verticesOf(plan, 'roof')[0]?.clad;
      for (const vertex of roof) expect(vertex.clad).toBe(roofClad);
    }
    expect(built).toBeGreaterThan(10);
    // A long enough roof carries two, either side of the middle where the chimney stands.
    expect(town.some((plan) => plan.dormers === 2)).toBe(true);
    expect(town.some((plan) => plan.dormers === 1)).toBe(true);
    expect(Math.max(...town.map((plan) => plan.dormers))).toBe(2);
    // Control: steep enough roofs do get them, and none below the pitch.
    expect(
      town.some((plan) => plan.pitchDegrees < DORMER_MIN_PITCH_DEGREES && plan.dormers > 0),
    ).toBe(false);
  });

  it('holds every plan to 640 near and 200 far with all of it on', () => {
    for (const plan of town) {
      expect(plan.triangleCount).toBeLessThanOrEqual(FOOTPRINT_MAX_TRIANGLES);
      expect(plan.farTriangleCount).toBeLessThanOrEqual(FOOTPRINT_MAX_FAR_TRIANGLES);
    }
  });
});

describe('a garage and its driveway — #1588', () => {
  it('puts a garage door over an end bay of a wide residential front, from the ground to past its window', () => {
    const garaged = town.filter((plan) => plan.garage);
    expect(garaged.length).toBeGreaterThan(5);
    for (const plan of garaged) {
      expect(residential.includes(plan)).toBe(true);
      const door = verticesOf(plan, 'door');
      const face = door.filter((vertex) => vertex.top === FACADE_GARAGE);
      expect(face).toHaveLength(6);
      const front = door.filter((vertex) => vertex.top === FACADE_DOOR);
      expect(front).toHaveLength(6);
      // The front's wall: at least GARAGE_MIN_BAYS bays, the garage one of them at an end.
      const width = (face[0] as Vertex).width;
      const wall = verticesOf(plan, 'wall').filter(
        (vertex) => vertex.top > 0 && Math.abs(vertex.width - width) < 1e-3,
      );
      expect(wall.length).toBeGreaterThan(0);
      expect(Math.max(...wall.map((vertex) => vertex.u))).toBeGreaterThanOrEqual(GARAGE_MIN_BAYS);
      // From the ground in front of it to the reach above the floor.
      const floor = Math.min(...front.map((vertex) => vertex.y));
      expect(Math.max(...face.map((vertex) => vertex.y))).toBeCloseTo(floor + GARAGE.reach, 4);
      expect(Math.min(...face.map((vertex) => vertex.y))).toBeLessThan(floor);
      expect((face[0] as Vertex).extra).toBeCloseTo(GARAGE.leaf, 5);
      // Clear of the front door.
      const doorX = front.reduce((sum, vertex) => sum + vertex.x, 0) / 6;
      const doorZ = front.reduce((sum, vertex) => sum + vertex.z, 0) / 6;
      const faceX = face.reduce((sum, vertex) => sum + vertex.x, 0) / 6;
      const faceZ = face.reduce((sum, vertex) => sum + vertex.z, 0) / 6;
      expect(Math.hypot(faceX - doorX, faceZ - doorZ)).toBeGreaterThan(width / 2 + 0.6);
    }
    // Only residential, and only where the front has room.
    for (const plan of town.filter((each) => !each.garage)) {
      expect(
        verticesOf(plan, 'door').filter((vertex) => vertex.top === FACADE_GARAGE),
      ).toStrictEqual([]);
      expect(verticesOf(plan, 'driveway')).toStrictEqual([]);
      expect(plan.driveway.length).toBe(0);
    }
  });

  it('paves a driveway from the garage to just short of the carriageway, on the ground', () => {
    for (const plan of town.filter((each) => each.garage)) {
      const paving = verticesOf(plan, 'driveway');
      expect(paving.length).toBeGreaterThan(0);
      for (const vertex of paving) {
        expect(vertex.clad).toBe(CLAD_PAVING);
        expect(vertex.ny).toBe(1);
      }
      // Its far corners: the road's edge and the driveway's short of it, the nearer of the two.
      const ring = plan.driveway;
      const far = [
        fromRoad(mixed.profile, mixed.origin, ring[4] as number, ring[5] as number),
        fromRoad(mixed.profile, mixed.origin, ring[6] as number, ring[7] as number),
      ];
      expect(Math.min(...far)).toBeCloseTo(ROAD_WIDTH_METRES / 2 + DRIVEWAY.short, 1);
      // No other footprint is crossed.
      for (const other of town) {
        if (other === plan) continue;
        for (let i = 0; i + 1 < other.footprint.length; i += 2) {
          expect(
            insideQuad(ring, other.footprint[i] as number, other.footprint[i + 1] as number),
          ).toBe(false);
        }
      }
    }
  });

  /** Whether a plan is one of the row's houses: 13 m along the road, not a 16 m shed. */
  const isHouse = (plan: FootprintPlan): boolean => {
    const rectangle = minimumAreaRectangle(plan.footprint);
    return Math.abs(rectangle.halfLong * 2 - 13) < 0.5;
  };

  /** A row of wide houses 30 m out, every 30 m, and with `blocked` a shed in front of each. */
  const garagesIn = (blocked: boolean): number => {
    const profile = northRoute(3_000, () => 10);
    const origin = corridorOrigin(profile);
    const buildings: BuildingFeature[] = [];
    for (let along = 200; along < 1_400; along += 30) {
      buildings.push(buildingBeside(profile, origin, [rectangleBeside(along, 30, 13, 8)], 6));
      if (blocked) {
        // Across the whole front, between it and the road.
        buildings.push(buildingBeside(profile, origin, [rectangleBeside(along, 18, 16, 4)], 3));
      }
    }
    const corridor: WorldCorridor = {
      routeId: 'garages',
      origin,
      covered: () => true,
      coveredBoxes: [{ minX: -1_000, maxX: 1_000, minZ: -500, maxZ: 3_500 }],
      landUse: [landBeside(profile, origin, 'landuse', 'residential', 100, 1_500, -60, 60)],
      buildings,
      paths: [],
      streets: [],
    };
    const { plans } = footprintPlans(corridor, landClassMask(corridor), profile, origin);
    // The houses only: the sheds stand at 18 m out.
    return plans.filter((plan) => plan.garage && plan.footprint.length > 0 && isHouse(plan)).length;
  };

  it('builds none where the driveway would cross another building', () => {
    // The sheds themselves are three bays wide and may have their own; the
    // houses behind them, whose driveways the sheds would cross, may not.
    expect(garagesIn(true)).toBeLessThan(garagesIn(false));
  });

  it('control: the same row with nothing in front has garages', () => {
    expect(garagesIn(false)).toBeGreaterThan(5);
  });

  it('keeps a lot off a driveway, as it keeps off the house', () => {
    const plan = town.find((each) => each.garage) as FootprintPlan;
    const lots = mappedTown(mixed.corridor, town);
    const ring = plan.driveway;
    // A lot's box: centre, its rotation's cosine and sine, half its width, its back and its front.
    // Most of the way down it, toward the road and away from the house.
    const startX = ((ring[0] as number) + (ring[2] as number)) / 2;
    const startZ = ((ring[1] as number) + (ring[3] as number)) / 2;
    const midX = startX + 0.85 * (((ring[4] as number) + (ring[6] as number)) / 2 - startX);
    const midZ = startZ + 0.85 * (((ring[5] as number) + (ring[7] as number)) / 2 - startZ);
    const lot = Float64Array.of(midX, midZ, 1, 0, 0.5, -0.5, 0.5);
    expect(lots.overlaps(lot)).toBe(true);
    // Control: with no plan's driveway, the same small lot on the driveway's middle is clear, if not on a house.
    const without = mappedTown(
      mixed.corridor,
      town.map((each) => ({ ...each, driveway: new Float32Array(0) })),
    );
    expect(without.overlaps(lot)).toBe(false);
  });
});

describe('a garage’s driveway keeps off its own house — #1588', () => {
  const profile = northRoute(3_000, () => 10);
  const origin = corridorOrigin(profile);
  /** The front wall's frame: 10.5 m of it, 797.5 to 808 m along and 26 m out, facing the road. */
  const frame = (out: number): Parameters<typeof garageOf>[1] => {
    const [mx, mz] = besideRoad(profile, origin, 802.75, out);
    const [ax, az] = besideRoad(profile, origin, 797.5, out);
    const [bx, bz] = besideRoad(profile, origin, 808, out);
    const [rx, rz] = besideRoad(profile, origin, 802.75, out - 1);
    const length = Math.hypot(bx - ax, bz - az);
    return {
      mx,
      mz,
      ex: (bx - ax) / length,
      ez: (bz - az) / length,
      nx: rx - mx,
      nz: rz - mz,
    };
  };
  /** The garage on `bay` of three, beside a house whose ring is `pairs` of (along, lateral). */
  const garageBeside = (
    pairs: readonly (readonly [number, number])[],
    bay: number,
    out = 26,
  ): ReturnType<typeof garageOf> => {
    const segments: number[] = [];
    const wall = frame(out);
    const road = roadSegmentsNear(profile, origin, wall.mx, wall.mz, 100, segments);
    const ring = ringBeside(profile, origin, pairs);
    return garageOf(
      { length: 10.5, bays: 3, bay },
      wall,
      road,
      segments,
      { ring, others: { grid: new RingGrid([ring]), own: 0 } },
      () => 10,
    );
  };

  it('builds one off a convex house at either end of its front, 20 to 40 m long', () => {
    const house = rectangleBeside(802.75, 30, 10.5, 8);
    for (const bay of [0, 2]) {
      const garage = garageBeside(house, bay);
      expect(garage).toBeDefined();
      expect(garage?.plan.length).toBeGreaterThan(20);
      expect(garage?.plan.length).toBeLessThan(DRIVEWAY.longest);
    }
  });

  it('builds none where the road is further than the longest driveway', () => {
    const far = rectangleBeside(802.75, 56, 10.5, 8);
    expect(garageBeside(far, 0, 52)).toBeUndefined();
    expect(garageBeside(rectangleBeside(802.75, 30, 10.5, 8), 0, 26)).toBeDefined();
  });

  it('builds none at the end where a wing of an L-shaped house leans over it, and one at the other', () => {
    // The wall runs 797.5 to 808 m along. The wing's toe is 6 m out from it,
    // and reaches 2.5 m past where its root meets the wall.
    const house: (readonly [number, number])[] = [
      [790, 20],
      [797.5, 20],
      [797.5, 26],
      [808, 26],
      [808, 34],
      [790, 34],
    ];
    const lean: (readonly [number, number])[] = [
      [790, 20],
      [800, 20],
      [797.5, 26],
      [808, 26],
      [808, 34],
      [790, 34],
    ];
    expect(house).toHaveLength(6);
    const ends = [0, 2].map((bay) => garageBeside(lean, bay) === undefined);
    expect(ends.filter(Boolean)).toHaveLength(1);
    // Control: the same house with the wing cut back to the wall leaves both ends.
    expect([0, 2].map((bay) => garageBeside(house, bay) !== undefined)).toStrictEqual([true, true]);
  });
});

/** Whether `(x, z)` is inside a four-cornered ring. */
function insideQuad(ring: Float32Array, x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = 3; i < 4; j = i, i += 1) {
    const xi = ring[i * 2] as number;
    const zi = ring[i * 2 + 1] as number;
    const xj = ring[j * 2] as number;
    const zj = ring[j * 2 + 1] as number;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
