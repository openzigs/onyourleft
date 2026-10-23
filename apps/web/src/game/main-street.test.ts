// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #1590: main-street shops — a commercial mapped building's shop front, its
 * sign band, its awning, its cornice and its taller windows — held where they
 * are decided, in the plans (`footprint-buildings.ts`) and in the layout the
 * shader draws from (`facade.ts`), and read back through the belt a ride
 * draws them with. Each rule with its control where one can be made.
 *
 * The towns are arithmetic in local metres beside routes from
 * `route-fixtures-testing.ts`: nothing here is a real place.
 */

import { afterEach, describe, expect, it } from 'vitest';

import type { RouteProfile } from '@onyourleft/domain';
import type { BuildingFeature } from '@onyourleft/map-features';

import { AWNING_PAINTS, SIGN_PAINTS } from './building-paint';
import {
  AWNING_STRIPE_METRES,
  COMMERCIAL_WINDOW,
  COMMERCIAL_WINDOW_IN_BAY,
  FACADE_AO,
  facadePartAt,
  SHOP_DOOR,
  SHOP_FRONT,
  shopFrontPartAt,
  SIGN_MOULDING_METRES,
  WINDOW_IN_BAY,
  type FacadePart,
} from './facade';
import {
  AWNING,
  CORNICE,
  DOOR_FACE,
  DOOR_SURROUND_METRES,
  FACADE_AWNING,
  FACADE_DOOR,
  FACADE_OFFSET,
  FACADE_SHOPFRONT,
  FACADE_SIGN,
  FOOTPRINT_MAX_FAR_TRIANGLES,
  FOOTPRINT_MAX_TRIANGLES,
  FOOTPRINT_MAX_VERTICES,
  FOOTPRINT_VERTEX_FLOATS,
  footprintPlans,
  ROOF_ROLES,
  PARAPET_METRES,
  SHOP_FRONT_MIN_WALL_METRES,
  SHOP_FRONT_PLACE,
  shopOf,
  SIGN_BAND,
  STOREY_METRES,
  STYLE_COMMERCIAL,
  STYLE_OFFSET,
  type FootprintPlan,
  type FootprintRole,
} from './footprint-buildings';
import {
  buildingBeside,
  landBeside,
  mixedTownFixture,
  polygonBeside,
  rectangleBeside,
  starBeside,
} from './footprint-fixtures-testing';
import { landClassMask } from './land-class';
import { ROAD_CLEARANCE_METRES } from './landform';
import { mappedBuildingsOf, NEAR_ROLES, surfaceOfRole } from './mapped-buildings';
import { MAPPED_BUILDING_DRAW_CALLS, MAPPED_BUILDING_TRIANGLES } from './realistic-budget';
import { PHOTOGRAPHIC_STRUCTURE_SURFACES } from './realistic-assets';
import { nearestOnRoadSegments, roadSegmentsNear, type BesideTheRoad } from './road-grid';
import { northRoute } from './route-fixtures-testing';
import { corridorOrigin, drawnRoadFrame, type CorridorOrigin } from './terrain';
import { MappedBuildingBelt } from './three-renderer';
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
      clad: f(STYLE_OFFSET),
      flags: f(STYLE_OFFSET + 1),
      width: f(STYLE_OFFSET + 2),
      extra: f(STYLE_OFFSET + 3),
    });
  }
  return out;
}

const trianglesOf = (plan: FootprintPlan, role: FootprintRole): number =>
  plan.triangles[role].length / (3 * FOOTPRINT_VERTEX_FLOATS);

/** How far `(x, z)` is from the drawn road's centreline. */
function fromRoad(profile: RouteProfile, origin: CorridorOrigin, x: number, z: number): number {
  const segments: number[] = [];
  const road = roadSegmentsNear(profile, origin, x, z, 300, segments);
  const beside: BesideTheRoad = { along: 0, lateral: 0, distance: 0 };
  nearestOnRoadSegments(road, segments, x, z, beside);
  return beside.distance;
}

const isCommercial = (plan: FootprintPlan): boolean =>
  verticesOf(plan, 'wall').some((vertex) => (vertex.flags & STYLE_COMMERCIAL) !== 0);

const mixed = mixedTownFixture();
const { plans: town } = footprintPlans(
  mixed.corridor,
  landClassMask(mixed.corridor),
  mixed.profile,
  mixed.origin,
);
const commercial = town.filter(isCommercial);
const shops = town.filter((plan) => plan.shop.front);

/** A plan's front door's face: its six vertices. */
const doorOf = (plan: FootprintPlan): Vertex[] =>
  verticesOf(plan, 'door').filter((vertex) => vertex.top === FACADE_DOOR);

describe('the shop front, laid out — #1590, facade.ts', () => {
  const width = 8;
  const height = SHOP_FRONT_PLACE.height;
  const at = (u: number, v: number): string => shopFrontPartAt(u, v, width, height);

  it('glazes most of the wall over a stall riser, in a frame, with a transom', () => {
    expect(at(SHOP_FRONT.frame / 2, 1)).toBe('frame');
    expect(at(width - SHOP_FRONT.frame / 2, 1)).toBe('frame');
    expect(at(1, height - SHOP_FRONT.frame / 2)).toBe('frame');
    expect(at(1, SHOP_FRONT.riser / 2)).toBe('riser');
    expect(at(1, SHOP_FRONT.riser + SHOP_FRONT.sill / 2)).toBe('frame');
    expect(at(1, 1.2)).toBe('glass');
    expect(at(1, (SHOP_FRONT.transom[0] + SHOP_FRONT.transom[1]) / 2)).toBe('frame');
    expect(at(1, SHOP_FRONT.transom[1] + 0.2)).toBe('glass');
    // Glass is most of it: over a grid, more than half the face.
    let glass = 0;
    let all = 0;
    for (let u = 0.05; u < width; u += 0.1) {
      for (let v = 0.05; v < height; v += 0.1) {
        all += 1;
        if (at(u, v) === 'glass') glass += 1;
      }
    }
    expect(glass / all).toBeGreaterThan(0.5);
  });

  it('leaves the door’s place in its middle, and splits each side into equal panes no wider than a light', () => {
    expect(at(width / 2, 1)).toBe('door');
    expect(at(width / 2 + DOOR_FACE.width / 2 - 0.02, 1)).toBe('door');
    // Each side: the panes between the frame and the door, mullions between.
    const span = width / 2 - DOOR_FACE.width / 2 - SHOP_FRONT.frame;
    const panes = Math.max(1, Math.round(span / SHOP_FRONT.light));
    expect(span / panes).toBeLessThanOrEqual(SHOP_FRONT.light * 1.5);
    for (let k = 1; k < panes; k += 1) {
      const left = SHOP_FRONT.frame + (span * k) / panes;
      const right = width - left;
      expect(at(left, 1)).toBe('frame');
      expect(at(right, 1)).toBe('frame');
      expect(at(left + SHOP_FRONT.mullion, 1)).toBe('glass');
    }
  });

  it('draws a shop’s door as a glazed leaf in a frame, set back in a recess', () => {
    const shopDoor = { flags: STYLE_COMMERCIAL, width: 0, extra: -1 };
    const part = (x: number, y: number): FacadePart =>
      facadePartAt(x / DOOR_FACE.width, y / DOOR_FACE.height, FACADE_DOOR, -1, shopDoor);
    expect(part(DOOR_SURROUND_METRES / 2, 1)).toBe('reveal');
    expect(part(DOOR_FACE.width / 2, DOOR_FACE.height - DOOR_SURROUND_METRES / 2)).toBe('reveal');
    expect(part(DOOR_SURROUND_METRES + SHOP_DOOR.frame / 2, 1)).toBe('frame');
    expect(part(DOOR_FACE.width / 2, SHOP_DOOR.rail / 2)).toBe('frame');
    expect(part(DOOR_FACE.width / 2, 1)).toBe('glass');
    // Control: a house's door at the same place is its painted leaf.
    expect(facadePartAt(0.5, 1 / DOOR_FACE.height, FACADE_DOOR, -1)).toBe('leaf');
  });

  it('paints a sign band as a plain panel in its moulding, and nothing else', () => {
    const style = { flags: 3, width: 6, extra: SIGN_BAND.height };
    const parts = new Set<string>();
    for (let u = 0.01; u < 6; u += 0.02) {
      for (let v = 0.01; v < SIGN_BAND.height; v += 0.02) {
        parts.add(facadePartAt(u, v, FACADE_SIGN, -1, style));
      }
    }
    // No text, brand or logo: a panel and its moulding, and no third thing.
    expect(parts).toStrictEqual(new Set(['frame', 'panel']));
    expect(facadePartAt(SIGN_MOULDING_METRES / 2, 0.3, FACADE_SIGN, -1, style)).toBe('frame');
    expect(facadePartAt(3, 0.3, FACADE_SIGN, -1, style)).toBe('panel');
  });

  it('stripes an awning along it where its flags say, and leaves it plain where they do not', () => {
    const striped = { flags: 1, width: 6, extra: 0 };
    const plain = { flags: 0, width: 6, extra: 0 };
    expect(facadePartAt(AWNING_STRIPE_METRES / 2, 0.3, FACADE_AWNING, -1, striped)).toBe('canvas');
    expect(facadePartAt(AWNING_STRIPE_METRES * 1.5, 0.3, FACADE_AWNING, -1, striped)).toBe(
      'stripe',
    );
    expect(facadePartAt(AWNING_STRIPE_METRES * 2.5, 0.3, FACADE_AWNING, -1, striped)).toBe(
      'canvas',
    );
    expect(facadePartAt(AWNING_STRIPE_METRES * 1.5, 0.3, FACADE_AWNING, -1, plain)).toBe('canvas');
  });

  it('lays a commercial wall’s windows taller, and cuts none the eaves would cut', () => {
    const commercialWall = { flags: STYLE_COMMERCIAL, width: 3.6, extra: -1 };
    const house = { flags: 0, width: 3.6, extra: -1 };
    expect(COMMERCIAL_WINDOW.height).toBeGreaterThan(1.6);
    expect(COMMERCIAL_WINDOW_IN_BAY.top).toBeGreaterThan(WINDOW_IN_BAY.top);
    // Above a casement's head, in the taller window's glass.
    const v = 1 + (WINDOW_IN_BAY.top + COMMERCIAL_WINDOW_IN_BAY.top) / 2 - 0.02;
    expect(facadePartAt(1.4, v, 3, -1, commercialWall)).toBe('glass');
    expect(facadePartAt(1.4, v, 3, -1, house)).toBe('wall');
    // Eaves between the two heads: the casement fits, the taller window does not.
    const eaves = 1 + (WINDOW_IN_BAY.top + COMMERCIAL_WINDOW_IN_BAY.top) / 2;
    expect(facadePartAt(1.5, 1.5, eaves, -1, commercialWall)).toBe('wall');
    expect(facadePartAt(1.5, 1.5, eaves, -1, house)).not.toBe('wall');
  });
});

describe('a main street — #1590, over the mixed town', () => {
  it('lays every commercial building’s walls out as a shop’s, and no house’s', () => {
    expect(commercial.length).toBeGreaterThan(20);
    for (const plan of town) {
      for (const vertex of verticesOf(plan, 'wall')) {
        expect((vertex.flags & STYLE_COMMERCIAL) !== 0).toBe(commercial.includes(plan));
      }
    }
  });

  it('puts a shop front over the ground storey of every commercial front long enough, across most of it', () => {
    const fronted = commercial.filter((plan) => doorOf(plan).length > 0);
    expect(fronted.length).toBeGreaterThan(15);
    for (const plan of fronted) {
      const face = verticesOf(plan, 'shopfront').filter(
        (vertex) => vertex.top === FACADE_SHOPFRONT,
      );
      expect(face.length).toBe(plan.shop.front ? 6 : 0);
      if (!plan.shop.front) continue;
      const floor = Math.min(...doorOf(plan).map((vertex) => vertex.y));
      const width = (face[0] as Vertex).width;
      const height = (face[0] as Vertex).extra;
      expect(Math.min(...face.map((vertex) => vertex.y))).toBeCloseTo(floor, 4);
      expect(Math.max(...face.map((vertex) => vertex.y))).toBeCloseTo(floor + height, 4);
      expect(height).toBeGreaterThanOrEqual(SHOP_FRONT_PLACE.least);
      // Across its wall, less a pilaster either end.
      expect(width + 2 * SHOP_FRONT_PLACE.inset).toBeGreaterThanOrEqual(SHOP_FRONT_MIN_WALL_METRES);
      // The door is a shop's.
      for (const vertex of doorOf(plan))
        expect(vertex.flags & STYLE_COMMERCIAL).toBe(STYLE_COMMERCIAL);
    }
    expect(shops.length).toBeGreaterThan(15);
    // Control: no house has one, and a house's door is a house's.
    for (const plan of town.filter((each) => !commercial.includes(each))) {
      expect(plan.shop.front).toBe(false);
      expect(trianglesOf(plan, 'shopfront')).toBe(0);
      for (const vertex of doorOf(plan)) expect(vertex.flags & STYLE_COMMERCIAL).toBe(0);
    }
  });

  it('hangs a plain sign band over each shop front, in a sign paint', () => {
    let signs = 0;
    for (const plan of shops) {
      const front = verticesOf(plan, 'shopfront').filter(
        (vertex) => vertex.top === FACADE_SHOPFRONT,
      );
      const sign = verticesOf(plan, 'shopfront').filter((vertex) => vertex.top === FACADE_SIGN);
      if (sign.length === 0) continue;
      signs += 1;
      // Two triangles: a panel, which the shader paints, and no letter of geometry.
      expect(sign).toHaveLength(6);
      const head = Math.max(...front.map((vertex) => vertex.y));
      expect(Math.min(...sign.map((vertex) => vertex.y))).toBeCloseTo(head + SIGN_BAND.gap, 4);
      expect((sign[0] as Vertex).extra).toBeCloseTo(SIGN_BAND.height, 6);
      const paint = (sign[0] as Vertex).flags;
      expect(Number.isInteger(paint)).toBe(true);
      expect(paint).toBeGreaterThanOrEqual(0);
      expect(paint).toBeLessThan(SIGN_PAINTS.length);
    }
    expect(signs).toBeGreaterThan(shops.length / 2);
  });

  it('puts an awning on about half of the shop fronts, keeping the road’s clearance', () => {
    const awned = shops.filter((plan) => plan.shop.awning);
    const share = awned.length / shops.length;
    expect(share).toBeGreaterThanOrEqual(0.25);
    expect(share).toBeLessThanOrEqual(0.75);
    const striped = new Set<number>();
    for (const plan of awned) {
      const canvas = verticesOf(plan, 'shopfront').filter((vertex) => vertex.top === FACADE_AWNING);
      // The canvas, its underside, the valance either side, and two cheeks.
      expect(canvas).toHaveLength(6 * 4 + 3 * 2);
      for (const vertex of canvas) {
        expect(fromRoad(mixed.profile, mixed.origin, vertex.x, vertex.z)).toBeGreaterThanOrEqual(
          ROAD_CLEARANCE_METRES - 1e-3,
        );
        expect(vertex.extra).toBeLessThan(AWNING_PAINTS.length);
      }
      striped.add((canvas[0] as Vertex).flags);
      // Under the sign: its top where the shop front's head is.
      const front = verticesOf(plan, 'shopfront').filter(
        (vertex) => vertex.top === FACADE_SHOPFRONT,
      );
      expect(Math.max(...canvas.map((vertex) => vertex.y))).toBeCloseTo(
        Math.max(...front.map((vertex) => vertex.y)),
        4,
      );
    }
    // Some striped, some plain.
    expect(striped).toStrictEqual(new Set([0, 1]));
    for (const plan of shops.filter((each) => !each.shop.awning)) {
      expect(
        verticesOf(plan, 'shopfront').filter((vertex) => vertex.top === FACADE_AWNING),
      ).toStrictEqual([]);
    }
  });

  it('caps every commercial roof’s parapet with a cornice of about 20 to 40 triangles, and no house’s', () => {
    const corniced = commercial.filter((plan) => plan.shop.cornice);
    expect(corniced.length).toBe(commercial.length);
    for (const plan of corniced) {
      const walls = plan.footprint.length / 2;
      const cap = verticesOf(plan, 'trim').filter((vertex) => vertex.ny === 1);
      const top = Math.max(...verticesOf(plan, 'parapet').map((vertex) => vertex.y));
      expect(top).toBeCloseTo(
        Math.max(...verticesOf(plan, 'wall').map((vertex) => vertex.y)) + PARAPET_METRES,
        4,
      );
      for (const vertex of cap) expect(vertex.y).toBeCloseTo(top + CORNICE.cap, 4);
      // A front, a soffit and a cap along each wall: six triangles a wall.
      const cornice = trianglesOf(plan, 'trim');
      expect(cornice).toBe(6 * walls);
      if (walls <= 6) {
        expect(cornice).toBeGreaterThanOrEqual(20);
        expect(cornice).toBeLessThanOrEqual(40);
      }
    }
    for (const plan of town.filter((each) => !commercial.includes(each) && each.roof === 'flat')) {
      expect(plan.shop.cornice).toBe(false);
    }
  });

  it('projects the cornice past every wall, its soffit facing down', () => {
    const plan = commercial.find((each) => each.footprint.length === 8) as FootprintPlan;
    const soffit = verticesOf(plan, 'trim').filter((vertex) => vertex.ny === -1);
    expect(soffit.length).toBe(6 * 4);
    // Its outer corners stand the projection out past the footprint's own.
    const xs = Array.from(plan.footprint).filter((_, at) => at % 2 === 0);
    const reach = Math.max(...soffit.map((vertex) => vertex.x)) - Math.max(...xs);
    expect(reach).toBeGreaterThan(CORNICE.projection * 0.9);
    expect(reach).toBeLessThan(CORNICE.projection * 1.5);
  });

  it('does without the cornice where a footprint of many walls would put the plan past 640', () => {
    const profile = northRoute(3_000, () => 10);
    const origin = corridorOrigin(profile);
    const buildings: BuildingFeature[] = [
      buildingBeside(profile, origin, [starBeside(1_000, 40, 12, 9, FOOTPRINT_MAX_VERTICES)], 6),
      buildingBeside(profile, origin, [polygonBeside(1_100, 40, 12, 4)], 6),
    ];
    const corridor: WorldCorridor = {
      routeId: 'cornice-budget',
      origin,
      covered: () => true,
      coveredBoxes: [{ minX: -1_000, maxX: 1_000, minZ: -500, maxZ: 3_500 }],
      landUse: [landBeside(profile, origin, 'landuse', 'retail', 900, 1_200, -80, 80)],
      buildings,
      paths: [],
      streets: [],
    };
    const { plans, verdicts } = footprintPlans(corridor, landClassMask(corridor), profile, origin);
    expect(verdicts.kept, JSON.stringify(verdicts)).toBe(2);
    const many = plans.find(
      (plan) => plan.footprint.length / 2 === FOOTPRINT_MAX_VERTICES,
    ) as FootprintPlan;
    const few = plans.find((plan) => plan.footprint.length / 2 === 4) as FootprintPlan;
    expect(many.shop.cornice).toBe(false);
    expect(many.triangleCount).toBeLessThanOrEqual(FOOTPRINT_MAX_TRIANGLES);
    // Control: four walls take one.
    expect(few.shop.cornice).toBe(true);
  });

  it('adds nothing to the far level, and keeps every plan inside its budgets', () => {
    for (const plan of town) {
      expect(plan.triangleCount).toBeLessThanOrEqual(FOOTPRINT_MAX_TRIANGLES);
      expect(plan.farTriangleCount).toBeLessThanOrEqual(FOOTPRINT_MAX_FAR_TRIANGLES);
      expect(plan.farTriangleCount).toBe(trianglesOf(plan, 'wall') + trianglesOf(plan, 'roof'));
    }
  });
});

/** A row of 12 × 10 m two-storey shops on retail land, their fronts `gap` metres past the road's clearance. */
function shopsAt(gap: number): {
  readonly profile: RouteProfile;
  readonly origin: CorridorOrigin;
  readonly plans: readonly FootprintPlan[];
} {
  const profile = northRoute(3_000, () => 10);
  const origin = corridorOrigin(profile);
  const lateral = ROAD_CLEARANCE_METRES + gap + 5;
  const buildings: BuildingFeature[] = [];
  for (let along = 200; along < 2_600; along += 40) {
    buildings.push(buildingBeside(profile, origin, [rectangleBeside(along, lateral, 12, 10)], 6));
  }
  const corridor: WorldCorridor = {
    routeId: 'shop-row',
    origin,
    covered: () => true,
    coveredBoxes: [{ minX: -1_000, maxX: 1_000, minZ: -500, maxZ: 3_500 }],
    landUse: [landBeside(profile, origin, 'landuse', 'retail', 100, 2_700, -60, 60)],
    buildings,
    paths: [],
    streets: [],
  };
  return {
    profile,
    origin,
    plans: footprintPlans(corridor, landClassMask(corridor), profile, origin).plans,
  };
}

describe('an awning keeps the road’s clearance — #1590', () => {
  it('has none where even its least depth would reach the clearance, and some a little further back', () => {
    const close = shopsAt(AWNING.leastDepth - 0.1);
    expect(close.plans.filter((plan) => plan.shop.front).length).toBe(60);
    expect(close.plans.filter((plan) => plan.shop.awning)).toStrictEqual([]);
    const room = shopsAt(AWNING.depth.most + 0.5);
    const awned = room.plans.filter((plan) => plan.shop.awning);
    expect(awned.length).toBeGreaterThan(10);
    for (const plan of awned) {
      for (const vertex of verticesOf(plan, 'shopfront')) {
        expect(fromRoad(room.profile, room.origin, vertex.x, vertex.z)).toBeGreaterThanOrEqual(
          ROAD_CLEARANCE_METRES - 1e-3,
        );
      }
    }
  });
});

describe('an awning’s depth — #1590, shopOf', () => {
  const draws = { sign: 0, awning: 0, paint: 0, stripes: 0, depth: 1 };
  const reachingTo = (reach: number) => (corners: readonly (readonly [number, number])[]) =>
    Math.max(...corners.map(([, n]) => n)) <= reach;

  it('is seeded, shortened a step at a time where it would reach the clearance, and dropped past its least', () => {
    expect(shopOf(10, 4, reachingTo(10), draws)?.awning).toBeCloseTo(AWNING.depth.most, 9);
    expect(shopOf(10, 4, reachingTo(1.15), draws)?.awning).toBeCloseTo(1.1, 9);
    expect(shopOf(10, 4, reachingTo(AWNING.leastDepth - 0.01), draws)?.awning).toBe(0);
    // Control: none drawn for it is none.
    expect(shopOf(10, 4, reachingTo(10), { ...draws, awning: 0.99 })?.awning).toBe(0);
  });

  it('has no shop front where the storey is too low for one, and no sign where the eaves leave no room', () => {
    expect(shopOf(10, SHOP_FRONT_PLACE.least + 0.29, reachingTo(10), draws)).toBeUndefined();
    const low = shopOf(10, 3, reachingTo(10), draws);
    expect(low?.height).toBeCloseTo(2.7, 9);
    expect(low?.sign).toBe(0);
    expect(shopOf(10, STOREY_METRES + 1, reachingTo(10), draws)?.sign).toBe(SIGN_BAND.height);
  });
});

describe('drawn — #1590, through the belt', () => {
  const textures = new Map(
    PHOTOGRAPHIC_STRUCTURE_SURFACES.map((surface) => [
      surface,
      {
        colour: { image: { width: 512, height: 512 }, dispose: () => undefined } as never,
        normal: { image: { width: 512, height: 512 }, dispose: () => undefined } as never,
      },
    ]),
  );
  const belts: MappedBuildingBelt[] = [];
  afterEach(() => {
    for (const belt of belts.splice(0)) belt.dispose();
  });

  it('wears the walls, so no surface and no draw call is added, along the whole commercial street', () => {
    for (const plan of shops) expect(surfaceOfRole(plan, 'shopfront')).toBe(plan.surfaces.wall);
    const belt = new MappedBuildingBelt(mappedBuildingsOf(town), textures);
    belts.push(belt);
    let drew = 0;
    let checked = 0;
    for (let along = 1_600; along <= 2_050; along += 50) {
      const frame = drawnRoadFrame(mixed.profile, mixed.origin, along);
      if (frame === undefined) throw new Error('no road');
      const stats = belt.refill(frame.x, frame.z, MAPPED_BUILDING_TRIANGLES);
      expect(stats.drawCalls).toBeLessThanOrEqual(MAPPED_BUILDING_DRAW_CALLS);
      drew = Math.max(drew, stats.buildings);
      // A shop's front, sign and awning carry their light alone, unpainted —
      // the shader paints them — and an awning's underside the soffit's shade.
      const colour = belt.mesh.geometry.getAttribute('color');
      for (let place = 0; place < stats.buildings; place += 1) {
        const drawn = belt.drawnAt(place);
        if (drawn === undefined || drawn.far) continue;
        const plan = town[drawn.plan] as FootprintPlan;
        if (!plan.shop.front || plan.surfaces.wall === plan.surfaces.roof) continue;
        let at = drawn.wallAt;
        for (const role of NEAR_ROLES) {
          if (role === 'shopfront') break;
          if (!ROOF_ROLES.has(role)) at += plan.triangles[role].length / FOOTPRINT_VERTEX_FLOATS;
        }
        const shop = verticesOf(plan, 'shopfront');
        shop.forEach((vertex, index) => {
          const [r, g, b] = [0, 1, 2].map((k) => colour.array[(at + index) * 3 + k] as number);
          expect(r).toBeCloseTo(g as number, 6);
          expect(g).toBeCloseTo(b as number, 6);
          if (vertex.ny < -0.5) expect(r).toBeLessThanOrEqual(FACADE_AO.soffit + 1e-6);
          checked += 1;
        });
      }
    }
    expect(drew).toBeGreaterThan(10);
    expect(checked).toBeGreaterThan(100);
  });

  it('splices the shop front, the sign, the awning and the taller windows into the facade', () => {
    const belt = new MappedBuildingBelt(mappedBuildingsOf(town), textures);
    belts.push(belt);
    const material = belt.materialOf('render');
    const shader = {
      uniforms: {},
      vertexShader:
        '#include <common>\n#include <begin_vertex>\n#include <color_vertex>\n#include <fog_pars_vertex>\n#include <fog_vertex>',
      fragmentShader:
        '#include <common>\n#include <clipping_planes_fragment>\n#include <map_fragment>\n#include <color_fragment>\n#include <roughnessmap_fragment>\n#include <metalnessmap_fragment>\n#include <normal_fragment_begin>\n#include <normal_fragment_maps>\n#include <fog_pars_fragment>\n#include <fog_fragment>',
    };
    material?.onBeforeCompile(shader as never, undefined as never);
    const fragment = shader.fragmentShader;
    expect(fragment).toContain(`const float oylShopTop = ${String(FACADE_SHOPFRONT)}.0;`);
    expect(fragment).toContain(`const float oylSignTop = ${String(FACADE_SIGN)}.0;`);
    expect(fragment).toContain(`const float oylAwningTop = ${String(FACADE_AWNING)}.0;`);
    expect(fragment).toContain('} else if (abs(oylTop - oylShopTop) < 0.5) {');
    expect(fragment).toContain('} else if (abs(oylTop - oylSignTop) < 0.5) {');
    expect(fragment).toContain('} else if (abs(oylTop - oylAwningTop) < 0.5) {');
    expect(fragment).toContain(`const vec3 oylSignPaints[${String(SIGN_PAINTS.length)}]`);
    expect(fragment).toContain('oylSignPaints[int(clamp(vOylStyle.y + 0.5');
    expect(fragment).toContain('oylAwningPaints[int(clamp(vOylStyle.w + 0.5');
    expect(fragment).toContain(`const vec3 oylAwningPaints[${String(AWNING_PAINTS.length)}]`);
    expect(fragment).toContain(`const float oylCwT = ${String(COMMERCIAL_WINDOW_IN_BAY.top)};`);
    expect(fragment).toContain('float oylWT = mix(oylWinT, oylCwT, oylComOn);');
    expect(fragment).toContain('if (oylFlag(vOylStyle.y, oylCommercialFlag) > 0.5) {');
  });
});
