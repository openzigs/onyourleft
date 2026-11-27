// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The plans a ride makes of a street the downtown kit wraps — #3334.
 *
 * One synthetic street, planned once for every urban class: a terrace of
 * houses on residential land, and a retail strip, a shop and an office on
 * commercial land, on a road that climbs. The plans are read as the belt
 * reads them — each wrap written by `three-renderer.ts` §`writeKitWrap` from
 * the committed GLB's pieces (`facade-kit-testing.ts`) — so what is held is
 * where the drawn triangles stand, and not only what the plan says of itself.
 */

import type { BuildingFeature } from '@onyourleft/map-features';
import { describe, expect, it } from 'vitest';

import { FOUNDATION_METRES } from './buildings';
import { KIT_HUNG, KIT_PIECES, KIT_RUN_FLOATS, kitPaletteOf, type KitKind } from './facade-kit';
import { committedKit } from './facade-kit-testing';
import {
  FOOTPRINT_ROLES,
  FOOTPRINT_VERTEX_FLOATS,
  footprintPlans,
  PARAPET_METRES,
  type FootprintPlan,
  type FootprintPlanOptions,
} from './footprint-buildings';
import {
  buildingBeside,
  landBeside,
  planFingerprint,
  rectangleBeside,
  richmondStreetFixture,
} from './footprint-fixtures-testing';
import { landClassMask, type LandClassMask } from './land-class';
import { terrainHeightAt } from './landform';
import { REALISTIC_KIT_WRAP_TRIANGLES, REALISTIC_TRIANGLES } from './realistic-budget';
import { nearestOnRoadSegments, roadSegmentsNear, type BesideTheRoad } from './road-grid';
import { northRoute } from './route-fixtures-testing';
import { scatterSeed } from './scatter';
import { corridorOrigin } from './terrain';
import { writeKitWrap, type RealisticKit } from './three-renderer';
import type { UrbanClass, UrbanClassMap } from './urban-class';
import type { WorldCorridor } from './world-data/corridor';

/** Every kind a footprint is wrapped as. */
const KIT_KINDS: readonly KitKind[] = ['retail', 'shop', 'office', 'townhouse'];

/** A wrap drawn in no colour of its own: the atlas as it is. */
const UNPAINTED = { wall: [1, 1, 1], trim: [1, 1, 1], accent: [1, 1, 1] } as const;

/** Level to 1 000 m, then climbing at 6 %: the street stands on the climb. */
const road = northRoute(3_000, (along) => (along <= 1_000 ? 10 : 10 + (along - 1_000) * 0.06));
const origin = corridorOrigin(road);

/** Every stretch of the route `urban`. */
const everywhere = (urban: UrbanClass): UrbanClassMap => ({ classAt: () => urban });

/** Every urban class a stretch of route may have (`urban-class.ts`). */
const URBAN_CLASSES: readonly UrbanClass[] = ['unknown', 'rural', 'village', 'town', 'city-centre'];

/** A rectangle from `along` for `length` metres, from `near` to `far` out from the road. */
const box = (
  along: number,
  length: number,
  near: number,
  far: number,
): readonly (readonly [number, number])[] =>
  rectangleBeside(along + length / 2, (near + far) / 2, length, far - near);

/** The terrace: six houses sharing their side walls, two to four storeys. */
const TERRACE: readonly (readonly [width: number, height: number])[] = [
  [6, 9],
  [7, 9],
  [6, 12],
  [8, 9],
  [6, 6],
  [7, 9],
];

/** What each footprint of {@link street} is wrapped as beside a town's or a city centre's stretch. */
const WRAPPED: readonly KitKind[] = [
  ...TERRACE.map((): KitKind => 'townhouse'),
  'retail',
  'shop',
  'office',
];

/** The street's footprints: the terrace on one side, and the strip, the shop and the office on the other. */
function street(): readonly BuildingFeature[] {
  const buildings: BuildingFeature[] = [];
  let along = 1_100;
  for (const [width, height] of TERRACE) {
    buildings.push(buildingBeside(road, origin, [box(along, width, 14, 26)], height));
    along += width;
  }
  // One storey, three, and six.
  buildings.push(buildingBeside(road, origin, [box(1_200, 24, -26, -14)], 3.5));
  buildings.push(buildingBeside(road, origin, [box(1_230, 10, -26, -14)], 9));
  buildings.push(buildingBeside(road, origin, [box(1_246, 18, -32, -14)], 18));
  return buildings;
}

function corridorOf(
  buildings: readonly BuildingFeature[],
  commercial = 'commercial',
): WorldCorridor {
  return {
    routeId: 'facade-kit',
    origin,
    covered: () => true,
    coveredBoxes: [{ minX: -1_000, maxX: 1_000, minZ: -500, maxZ: 3_500 }],
    landUse: [
      landBeside(road, origin, 'landuse', 'residential', 1_050, 1_180, -70, 70),
      landBeside(road, origin, 'landuse', commercial, 1_180, 1_300, -70, 70),
    ],
    buildings: [...buildings],
    paths: [],
    streets: [],
  };
}

function plansOf(
  urban: UrbanClass,
  options: FootprintPlanOptions = {},
  corridor: WorldCorridor = corridorOf(street()),
): { readonly plans: readonly FootprintPlan[]; readonly land: LandClassMask } {
  const land = landClassMask(corridor);
  const { plans, verdicts } = footprintPlans(
    corridor,
    land,
    road,
    origin,
    undefined,
    everywhere(urban),
    options,
  );
  expect(verdicts.kept).toBe(corridor.buildings.length);
  return { plans, land };
}

/** The committed kit, as the belt is handed it; no test here reads its atlas. */
const kit: RealisticKit = { ...committedKit(), atlas: undefined as never };

/** A wrap's vertices as the belt writes them: `x, y, z` a vertex. */
function drawn(plan: FootprintPlan): Float32Array {
  const wrap = plan.kit;
  if (wrap === undefined) throw new Error('the plan is not wrapped');
  const vertices = wrap.triangles * 3;
  const into = {
    position: new Float32Array(vertices * 3),
    normal: new Float32Array(vertices * 3),
    uv: new Float32Array(vertices * 2),
    colour: new Float32Array(vertices * 3),
    tint: new Float32Array(vertices),
  };
  // The belt's writer fills exactly the triangles the plan was priced at.
  expect(writeKitWrap(kit, wrap, UNPAINTED, 0, into, 0)).toBe(vertices);
  return into.position;
}

/** How far outside `ring` the point `(x, z)` is, metres; 0 inside it. */
function outside(ring: Float32Array, x: number, z: number): number {
  let within = false;
  let nearest = Number.POSITIVE_INFINITY;
  const n = ring.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i, i += 1) {
    const xi = ring[i * 2] as number;
    const zi = ring[i * 2 + 1] as number;
    const xj = ring[j * 2] as number;
    const zj = ring[j * 2 + 1] as number;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) within = !within;
    const dx = xi - xj;
    const dz = zi - zj;
    const t = Math.min(1, Math.max(0, ((x - xj) * dx + (z - zj) * dz) / (dx * dx + dz * dz)));
    nearest = Math.min(nearest, Math.hypot(xj + dx * t - x, zj + dz * t - z));
  }
  return within ? 0 : nearest;
}

/** The drawn ground under `(x, z)`, by the stretch of road it is nearest. */
function groundUnder(land: LandClassMask, x: number, z: number): number {
  const segments: number[] = [];
  const near = roadSegmentsNear(road, origin, x, z, 600, segments);
  const beside: BesideTheRoad = { along: 0, lateral: 0, distance: 0 };
  if (!nearestOnRoadSegments(near, segments, x, z, beside)) throw new Error('no road near');
  return terrainHeightAt(road, origin, scatterSeed(road), beside.along, beside.lateral, land);
}

describe('a street planned for each urban class — #3334', () => {
  it.each(URBAN_CLASSES)(
    'wraps the terrace, the strip, the shop and the office beside a town’s or a city centre’s stretch only: %s',
    (urban) => {
      const { plans } = plansOf(urban);
      const modern = urban === 'town' || urban === 'city-centre';
      // The mapped footprints are planned first, in the map's order.
      expect(plans.slice(0, WRAPPED.length).map((plan) => plan.kit?.kind)).toEqual(
        modern ? WRAPPED : WRAPPED.map(() => undefined),
      );
      // Beside any other stretch no plan at all is wrapped.
      if (!modern) expect(plans.every((plan) => plan.kit === undefined)).toBe(true);
      // ⚠️ A city centre's own lots (#1637), which no footprint was mapped for, are planned
      // after the mapped ones and are not wrapped: the wrap is a mapped footprint's.
      expect(plans.length > WRAPPED.length).toBe(urban === 'city-centre');
      for (const lot of plans.slice(WRAPPED.length)) expect(lot.kit).toBeUndefined();
      // Its storeys are the map's, whatever it is drawn as.
      expect(plans.slice(TERRACE.length, WRAPPED.length).map((plan) => plan.storeys)).toEqual([
        1, 3, 6,
      ]);
    },
  );

  it('draws every kind the kit has on the town’s street', () => {
    const kinds = new Set(plansOf('town').plans.map((plan) => plan.kit?.kind));
    for (const kind of KIT_KINDS) expect(kinds.has(kind), kind).toBe(true);
  });

  it('wraps nothing on farmland, though its street is a town’s', () => {
    const { plans } = plansOf('town', {}, corridorOf(street(), 'farmland'));
    // The terrace's land is still residential, and still wrapped: the control.
    expect(plans.slice(0, TERRACE.length).map((plan) => plan.kit?.kind)).toEqual(
      TERRACE.map(() => 'townhouse'),
    );
    for (const plan of plans.slice(TERRACE.length)) expect(plan.kit).toBeUndefined();
  });

  it('wraps nothing with the lever off, and plans every extrusion as it does with it on', () => {
    const on = plansOf('town').plans;
    const off = plansOf('town', { facadeKit: false }).plans;
    expect(on.some((plan) => plan.kit !== undefined)).toBe(true);
    expect(off.every((plan) => plan.kit === undefined)).toBe(true);
    // The wrap adds to a plan and changes nothing else of it: its far level is the same bytes.
    expect(planFingerprint(off)).toBe(planFingerprint(on));
  });
});

describe('a wrapped building on sloping ground — #3334', () => {
  it.each(KIT_KINDS)(
    'fits the mapped footprint, stands in the ground and reaches its eaves: %s',
    (kind) => {
      const { plans, land } = plansOf('town');
      const wrappedAs = plans.filter((plan) => plan.kit?.kind === kind);
      expect(wrappedAs.length).toBeGreaterThan(0);
      let rise = 0;
      for (const plan of wrappedAs) {
        const position = drawn(plan);
        let lowest = Infinity;
        let highest = -Infinity;
        let farthest = 0;
        for (let at = 0; at < position.length; at += 3) {
          lowest = Math.min(lowest, position[at + 1] as number);
          highest = Math.max(highest, position[at + 1] as number);
          farthest = Math.max(
            farthest,
            outside(plan.footprint, position[at] as number, position[at + 2] as number),
          );
        }
        // It fits: no vertex stands further outside the mapped outline than what hangs
        // furthest off any wall, a fire escape's landing of a metre; and with nothing hung
        // on it, than the deepest relief of any bay, the moulded cornice's 53 cm.
        const hung = Array.from(
          { length: (plan.kit?.runs.length ?? 0) / KIT_RUN_FLOATS },
          (_, run) => KIT_PIECES[plan.kit?.runs[run * KIT_RUN_FLOATS] as number]?.id,
        ).some((id) => id !== undefined && KIT_HUNG.has(id));
        expect(farthest).toBeLessThanOrEqual(hung ? 1.01 : 0.54);
        // And it fills it: every corner of the outline has a vertex of the wrap on it.
        for (let corner = 0; corner < plan.footprint.length; corner += 2) {
          let nearest = Infinity;
          for (let at = 0; at < position.length; at += 3) {
            nearest = Math.min(
              nearest,
              Math.hypot(
                (position[at] as number) - (plan.footprint[corner] as number),
                (position[at + 2] as number) - (plan.footprint[corner + 1] as number),
              ),
            );
          }
          expect(nearest).toBeLessThanOrEqual(0.11);
        }
        // It stands in the ground: its foot is the plan's, at or under the ground at every
        // corner, never floating and never deep.
        expect(lowest).toBeCloseTo(plan.base, 3);
        const grounds: number[] = [];
        for (let corner = 0; corner < plan.footprint.length; corner += 2) {
          const ground = groundUnder(
            land,
            plan.footprint[corner] as number,
            plan.footprint[corner + 1] as number,
          );
          grounds.push(ground);
          expect(lowest).toBeLessThanOrEqual(ground + 1e-3);
          expect(ground - lowest).toBeLessThanOrEqual(FOUNDATION_METRES + 2.5 + 1e-3);
        }
        rise = Math.max(rise, Math.max(...grounds) - Math.min(...grounds));
        // It is as tall as the extrusion it replaces, which is its far level: its top is the
        // parapet's, and the extrusion's own highest vertex.
        expect(highest).toBeCloseTo(plan.eaves + PARAPET_METRES, 3);
        let extruded = -Infinity;
        for (const role of FOOTPRINT_ROLES) {
          const floats = plan.triangles[role];
          for (let at = 0; at < floats.length; at += FOOTPRINT_VERTEX_FLOATS) {
            extruded = Math.max(extruded, floats[at + 1] as number);
          }
        }
        expect(Math.abs(highest - extruded)).toBeLessThanOrEqual(0.05);
      }
      // Control: the ground really falls away under them.
      expect(rise).toBeGreaterThan(0.3);
    },
  );

  it('gives every wrap a building’s 3 000 triangles, and spends them: none is held to a structure’s 640', () => {
    expect(REALISTIC_KIT_WRAP_TRIANGLES).toBe(3_000);
    for (const urban of ['town', 'city-centre'] as const) {
      const mapped = plansOf(urban).plans.slice(0, WRAPPED.length);
      expect(mapped.length).toBe(WRAPPED.length);
      for (const plan of mapped) {
        expect(plan.kit?.triangles).toBeLessThanOrEqual(REALISTIC_KIT_WRAP_TRIANGLES);
        // More of the kit's own geometry than the structure class's ceiling ever held.
        expect(plan.kit?.triangles).toBeGreaterThan(REALISTIC_TRIANGLES.structure);
        expect(plan.kit?.relief).toBeGreaterThan(0);
      }
      // The terrace's houses, 6 to 8 m wide: every bay of every street front is real geometry.
      for (const plan of mapped.slice(0, TERRACE.length)) {
        expect(plan.kit?.front.relief).toBe(plan.kit?.front.bays);
      }
    }
  });
});

describe('each building its own — #3334, the look check on PR #3343', () => {
  const { plans } = plansOf('town');
  const mapped = plans.slice(0, WRAPPED.length);

  it('walls a wrap in what its extrusion is walled in, in the extrusion’s own paint', () => {
    for (const plan of mapped) {
      const wrap = plan.kit;
      const wall = plan.surfaces.wall;
      if (wrap?.kind !== 'office') {
        expect(wrap?.style.skin, wall).toBe(
          wall === 'brick' ? 'brick' : wall === 'stone' || wall === 'concrete' ? 'stone' : 'render',
        );
      }
      // An awning on the wrap where the extrusion has one, and never on a house.
      expect(wrap?.style.sign === 'awning').toBe(plan.shop.awning && wrap?.kind !== 'office');
    }
    // `paintTown` keeps two neighbours' paints apart, and so their wraps' colours.
    const terrace = mapped.slice(0, TERRACE.length);
    for (let at = 1; at < terrace.length; at += 1) {
      const [before, here] = [terrace[at - 1], terrace[at]] as [FootprintPlan, FootprintPlan];
      if (before.kit?.style.skin !== here.kit?.style.skin) continue;
      expect(kitPaletteOf(here.kit?.style.skin ?? 'brick', here.paint).wall).not.toEqual(
        kitPaletteOf(before.kit?.style.skin ?? 'brick', before.paint).wall,
      );
    }
  });

  it('builds a terrace of six houses as more than one house six times', () => {
    const terrace = mapped.slice(0, TERRACE.length).map((plan) => plan.kit);
    const looks = new Set(
      terrace.map((wrap) =>
        [wrap?.style.skin, wrap?.window, wrap?.door, wrap?.cornice, wrap?.style.pilasters].join(),
      ),
    );
    expect(looks.size).toBeGreaterThanOrEqual(4);
    // And the same six on every load.
    const again = plansOf('town').plans.slice(0, TERRACE.length);
    expect(again.map((plan) => plan.kit?.window)).toEqual(terrace.map((wrap) => wrap?.window));
    expect(again.map((plan) => plan.kit?.style)).toEqual(terrace.map((wrap) => wrap?.style));
  });
});

describe('what a wrap is never drawn on — #3334', () => {
  it('leaves a footprint its house model: the brick shop stays where it fits', () => {
    const fixture = richmondStreetFixture();
    const land = landClassMask(fixture.corridor);
    const { plans } = footprintPlans(
      fixture.corridor,
      land,
      fixture.profile,
      fixture.origin,
      undefined,
      everywhere('town'),
    );
    const modelled = plans.filter((plan) => plan.model !== undefined);
    expect(modelled.length).toBeGreaterThan(0);
    for (const plan of modelled) expect(plan.kit).toBeUndefined();
    // Control: on the same street, a commercial footprint no model fits is wrapped.
    expect(plans.some((plan) => plan.model === undefined && plan.kit !== undefined)).toBe(true);
  });

  it('leaves a part, which stands on another building, and a footprint under a pitched roof', () => {
    const shop = box(1_230, 10, -26, -14);
    const one = (building: BuildingFeature): FootprintPlan | undefined =>
      plansOf('town', {}, corridorOf([building])).plans[0];
    expect(one(buildingBeside(road, origin, [shop], 9))?.kit?.kind).toBe('shop');
    expect(
      one(buildingBeside(road, origin, [shop], 9, { minHeightMetres: 3 }))?.kit,
    ).toBeUndefined();
    const gabled = one({ ...buildingBeside(road, origin, [shop], 9), roofShape: 'gabled' });
    expect(gabled?.roof).toBe('gable');
    expect(gabled?.kit).toBeUndefined();
  });
});
