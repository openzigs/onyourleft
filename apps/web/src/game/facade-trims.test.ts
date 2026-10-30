// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #1663: the mapped facade's trims — a lintel over each window's head,
 * quoins at a brick wall's corners, a string course on each storey line —
 * held in the twin (`facade.ts` §`trimPartAt`), read back from the plans
 * `footprintPlans` builds and the vertex floats the belt uploads, and read
 * off the program three is handed, with its lever. What needs a GPU — that a
 * lintel reaches the screen, and that the lever takes it off — is
 * `game.browser.spec.ts` §"#1663".
 */

import { afterEach, describe, expect, it } from 'vitest';

import type { BuildingFeature } from '@onyourleft/map-features';

import {
  COMMERCIAL_WINDOW_IN_BAY,
  MULLION_METRES,
  PAIR_MIN_BAY_METRES,
  SASH,
  TRIM,
  trimPartAt,
  WINDOW_IN_BAY,
  WINDOW_SILL_METRES,
  windowStoreysOf,
  type FacadeStyle,
  type TrimFace,
  type TrimPart,
} from './facade';
import {
  FACADE_OFFSET,
  FOOTPRINT_VERTEX_FLOATS,
  footprintPlans,
  STOREY_METRES,
  STYLE_COMMERCIAL,
  STYLE_GLAZED,
  STYLE_OFFSET,
  STYLE_SASH,
  STYLE_TERRACED,
  type FootprintPlan,
} from './footprint-buildings';
import {
  buildingBeside,
  landBeside,
  rectangleBeside,
  rowTownFixture,
  terraceStreetFixture,
} from './footprint-fixtures-testing';
import { landClassMask } from './land-class';
import { mappedBuildingsOf } from './mapped-buildings';
import { PHOTOGRAPHIC_STRUCTURE_SURFACES } from './realistic-assets';
import { northRoute } from './route-fixtures-testing';
import { corridorOrigin } from './terrain';
import { facadeTrimsOf, MappedBuildingBelt, weatheringOf } from './three-renderer';
import { urbanClassMap } from './urban-class';
import type { WorldCorridor } from './world-data/corridor';

/** A brick sash wall three bays of 3 m wide, two storeys high: a typical US house's. */
const SASH_WALL: FacadeStyle = { flags: STYLE_SASH, width: 3, extra: -1 };
const BRICK: TrimFace = { surface: 'brick', bays: 3 };
const RENDER: TrimFace = { surface: 'render', bays: 3 };

/** The `v` of a point `metres` up storey `storey`. */
const vOf = (storey: number, metres: number): number => storey + metres / STOREY_METRES;
/** A sash's head, metres above its storey's floor. */
const SASH_HEAD = WINDOW_SILL_METRES + SASH.height;

describe('the lintel, in the twin — #1663', () => {
  it('is a band of TRIM.lintel directly above an upper window’s head, on brick and on render', () => {
    for (const face of [BRICK, RENDER]) {
      const at = (metres: number): TrimPart | undefined =>
        trimPartAt(1.5, vOf(1, metres), 2, -1, SASH_WALL, face);
      expect(at(SASH_HEAD + 0.01)).toBe('lintel');
      expect(at(SASH_HEAD + TRIM.lintel - 0.01)).toBe('lintel');
      // Above it, and the window's own frame under it, are not.
      expect(at(SASH_HEAD + TRIM.lintel + 0.01)).toBeUndefined();
      expect(at(SASH_HEAD - 0.01)).toBeUndefined();
    }
  });

  it('is deeper over the ground floor’s window than over the floors above', () => {
    expect(TRIM.groundLintel).toBeGreaterThan(TRIM.lintel);
    const depth = (TRIM.lintel + TRIM.groundLintel) / 2;
    expect(trimPartAt(1.5, vOf(0, SASH_HEAD + depth), 2, -1, SASH_WALL, BRICK)).toBe('lintel');
    expect(trimPartAt(1.5, vOf(1, SASH_HEAD + depth), 2, -1, SASH_WALL, BRICK)).toBeUndefined();
  });

  it('runs the window’s width and TRIM.overrun past it either side, and no farther', () => {
    // A 3 m bay holds one sash.
    const span = SASH.width / 2 + TRIM.overrun;
    const at = (x: number): TrimPart | undefined =>
      trimPartAt(1.5 + x / 3, vOf(1, SASH_HEAD + 0.05), 2, -1, SASH_WALL, RENDER);
    expect(at(span - 0.01)).toBe('lintel');
    expect(at(-(span - 0.01))).toBe('lintel');
    expect(at(span + 0.01)).toBeUndefined();
    // A bay of PAIR_MIN_BAY_METRES or more pairs two either side of a mullion, under one lintel.
    const wide: FacadeStyle = { ...SASH_WALL, width: PAIR_MIN_BAY_METRES };
    const pair = SASH.width + MULLION_METRES / 2 + TRIM.overrun;
    const paired = (x: number): TrimPart | undefined =>
      trimPartAt(1.5 + x / wide.width, vOf(1, SASH_HEAD + 0.05), 2, -1, wide, RENDER);
    expect(paired(pair - 0.01)).toBe('lintel');
    expect(paired(0)).toBe('lintel');
    expect(paired(pair + 0.01)).toBeUndefined();
  });

  it('heads a casement and a commercial window at their own heights', () => {
    const casement: FacadeStyle = { flags: 0, width: 3.6, extra: -1 };
    const casementHead = WINDOW_IN_BAY.top * STOREY_METRES;
    expect(trimPartAt(0.5, vOf(1, casementHead + 0.05), 2, -1, casement, RENDER)).toBe('lintel');
    expect(trimPartAt(0.5, vOf(1, casementHead - 0.02), 2, -1, casement, RENDER)).toBeUndefined();
    const shop: FacadeStyle = { flags: STYLE_COMMERCIAL, width: 3.6, extra: -1 };
    const shopHead = COMMERCIAL_WINDOW_IN_BAY.top * STOREY_METRES;
    expect(trimPartAt(0.5, vOf(1, shopHead + 0.05), 2, -1, shop, RENDER)).toBe('lintel');
    expect(trimPartAt(0.5, vOf(1, casementHead + 0.05), 2, -1, shop, RENDER)).toBeUndefined();
  });

  it('draws none on a curtain wall, on any other surface, over the door, or where no window fits', () => {
    const v = vOf(1, SASH_HEAD + 0.05);
    const glazed: FacadeStyle = { ...SASH_WALL, flags: STYLE_SASH + STYLE_GLAZED };
    expect(trimPartAt(1.5, v, 2, -1, glazed, BRICK)).toBeUndefined();
    // #1636: nor a quoin nor a string course on a curtain wall, where the brick wall has them.
    expect(trimPartAt(0.01, 0.05, 2, -1, SASH_WALL, BRICK)).toBe('quoin');
    expect(trimPartAt(0.01, 0.05, 2, -1, glazed, BRICK)).toBeUndefined();
    expect(trimPartAt(1, 1, 2, -1, SASH_WALL, BRICK)).toBe('string-course');
    expect(trimPartAt(1, 1, 2, -1, glazed, BRICK)).toBeUndefined();
    expect(trimPartAt(1.5, v, 2, -1, SASH_WALL, { surface: 'other', bays: 3 })).toBeUndefined();
    // The door's bay on the ground floor has no window, so no lintel.
    expect(trimPartAt(1.5, vOf(0, SASH_HEAD + 0.05), 2, 1, SASH_WALL, BRICK)).toBeUndefined();
    expect(trimPartAt(1.5, vOf(0, SASH_HEAD + 0.05), 2, -1, SASH_WALL, BRICK)).toBe('lintel');
    // Under eaves too low for a second row of windows, none over where it would be.
    expect(trimPartAt(1.5, v, 1.5, -1, SASH_WALL, BRICK)).toBeUndefined();
  });
});

describe('the quoins, in the twin — #1663', () => {
  it('stands alternating long and short blocks within TRIM.quoin of either corner of a brick wall', () => {
    expect(TRIM.quoin).toBeGreaterThan(TRIM.quoinShort);
    const at = (fromLeft: number, up: number): TrimPart | undefined =>
      trimPartAt(fromLeft / 3, up / STOREY_METRES, 2, -1, SASH_WALL, BRICK);
    const between = (TRIM.quoin + TRIM.quoinShort) / 2;
    // The first course is long, the second short, the third long again.
    const course = (k: number): number => (k + 0.5) * TRIM.quoinCourse;
    expect(at(between, course(0))).toBe('quoin');
    expect(at(between, course(1))).toBeUndefined();
    expect(at(between, course(2))).toBe('quoin');
    expect(at(TRIM.quoinShort - 0.01, course(1))).toBe('quoin');
    expect(at(TRIM.quoin + 0.01, course(0))).toBeUndefined();
    // And at the far corner, `u = bays`.
    const far = (fromRight: number, up: number): TrimPart | undefined =>
      trimPartAt(3 - fromRight / 3, up / STOREY_METRES, 2, -1, SASH_WALL, BRICK);
    expect(far(between, course(0))).toBe('quoin');
    expect(far(between, course(1))).toBeUndefined();
  });

  it('stands none on render, nor on a terraced building’s brick, whose corners are its row’s', () => {
    const up = 0.5 * TRIM.quoinCourse;
    expect(trimPartAt(0.05, up / STOREY_METRES, 2, -1, SASH_WALL, RENDER)).toBeUndefined();
    const terraced: FacadeStyle = { ...SASH_WALL, flags: STYLE_SASH + STYLE_TERRACED };
    expect(trimPartAt(0.05, up / STOREY_METRES, 2, -1, terraced, BRICK)).toBeUndefined();
    expect(trimPartAt(0.05, up / STOREY_METRES, 2, -1, SASH_WALL, BRICK)).toBe('quoin');
  });
});

describe('the string courses, in the twin — #1663', () => {
  it('lays one on each storey line with a row of windows above it, on brick, the first the deeper band', () => {
    expect(TRIM.groundBand).toBeGreaterThan(TRIM.stringCourse);
    // Away from the corners and the windows: a bay's edge.
    const at = (v: number, top = 2, face = BRICK): TrimPart | undefined =>
      trimPartAt(1, v, top, -1, SASH_WALL, face);
    expect(at(1)).toBe('string-course');
    expect(at(1 + (TRIM.stringCourse / 2 + 0.03) / STOREY_METRES)).toBe('string-course');
    expect(at(1 + (TRIM.groundBand / 2 + 0.01) / STOREY_METRES)).toBeUndefined();
    // The second line's course is the shallower one.
    expect(at(2, 3)).toBe('string-course');
    expect(at(2 + (TRIM.stringCourse / 2 + 0.03) / STOREY_METRES, 3)).toBeUndefined();
    // None on render; none at the foot nor at the eaves.
    expect(at(1, 2, RENDER)).toBeUndefined();
    expect(at(0)).toBeUndefined();
    expect(at(2)).toBeUndefined();
  });

  it('counts the plan’s storeys as the facade lays its rows of windows, never a default', () => {
    // A 5.5 m wall of two storeys has two rows of windows; a 5 m wall of one, one.
    expect(windowStoreysOf(5.5 / STOREY_METRES, SASH_WALL)).toBe(2);
    expect(windowStoreysOf(5 / STOREY_METRES, SASH_WALL)).toBe(1);
    expect(windowStoreysOf(3.5 / STOREY_METRES, SASH_WALL)).toBe(1);
    expect(windowStoreysOf(5, SASH_WALL)).toBe(5);
    expect(windowStoreysOf(0.5, SASH_WALL)).toBe(0);
  });
});

/** One wall quad of a plan: its first vertex's facade and style, and its bays. */
interface Wall {
  readonly top: number;
  readonly skip: number;
  readonly style: FacadeStyle;
  readonly bays: number;
}

function wallsOf(plan: FootprintPlan): Wall[] {
  const floats = plan.triangles.wall;
  const stride = FOOTPRINT_VERTEX_FLOATS;
  const walls: Wall[] = [];
  for (let at = 0; at + 6 * stride <= floats.length; at += 6 * stride) {
    const f = (vertex: number, k: number): number => floats[at + vertex * stride + k] as number;
    const top = f(0, FACADE_OFFSET + 2);
    if (!(top > 0)) continue;
    let bays = 0;
    for (let vertex = 0; vertex < 6; vertex += 1) bays = Math.max(bays, f(vertex, FACADE_OFFSET));
    walls.push({
      top,
      skip: f(0, FACADE_OFFSET + 3),
      style: {
        flags: f(0, STYLE_OFFSET + 1),
        width: f(0, STYLE_OFFSET + 2),
        extra: f(0, STYLE_OFFSET + 3),
      },
      bays,
    });
  }
  return walls;
}

/** The string courses up a wall's bay edge, read through the twin: each storey line's, once. */
function stringCoursesOf(wall: Wall, face: TrimFace): number {
  const lines = new Set<number>();
  for (let v = 0; v <= wall.top; v += 0.01) {
    if (trimPartAt(1, v, wall.top, wall.skip, wall.style, face) === 'string-course') {
      lines.add(Math.round(v));
    }
  }
  return lines.size;
}

/** A row of `storeys`-storey brick-or-render houses beside a road, as planned. */
function plannedRow(height: number): readonly FootprintPlan[] {
  const profile = northRoute(3_000, () => 10);
  const origin = corridorOrigin(profile);
  const buildings: BuildingFeature[] = [];
  for (let along = 1_000; along < 1_600; along += 30) {
    buildings.push(buildingBeside(profile, origin, [rectangleBeside(along, 26, 12, 9)], height));
  }
  const corridor: WorldCorridor = {
    routeId: 'trim-row',
    origin,
    covered: () => true,
    coveredBoxes: [{ minX: -1_000, maxX: 1_000, minZ: -500, maxZ: 3_500 }],
    landUse: [landBeside(profile, origin, 'landuse', 'residential', 900, 1_700, -60, 60)],
    buildings,
    paths: [],
    streets: [],
  };
  return footprintPlans(corridor, landClassMask(corridor), profile, origin).plans;
}

describe('the trims, read back from the plans — #1663', () => {
  it('lays 4 string courses up a 5-storey brick wall and 1 up a 2-storey one, from the plan', () => {
    // 17 m is five storeys of levels (#1629), 8 m two: storeys the plan reads, not a default.
    for (const [height, storeys] of [
      [17, 5],
      [8, 2],
    ] as const) {
      const brick = plannedRow(height).filter((plan) => plan.surfaces.wall === 'brick');
      expect(brick.length).toBeGreaterThan(0);
      for (const plan of brick) {
        expect(plan.storeys).toBe(storeys);
        for (const wall of wallsOf(plan)) {
          expect(stringCoursesOf(wall, { surface: 'brick', bays: wall.bays })).toBe(storeys - 1);
        }
      }
    }
  });

  it('marks a terraced building’s walls, so that none of its corners has a quoin, and no detached one', () => {
    const town = terraceStreetFixture();
    const land = landClassMask(town.corridor);
    const urban = urbanClassMap(town.corridor, land, town.profile);
    const { plans } = footprintPlans(
      town.corridor,
      land,
      town.profile,
      town.origin,
      undefined,
      urban,
    );
    const terraced = plans.filter((plan) =>
      wallsOf(plan).some((wall) => (wall.style.flags & STYLE_TERRACED) !== 0),
    );
    expect(terraced.length).toBeGreaterThan(10);
    for (const plan of terraced) {
      for (const wall of wallsOf(plan)) {
        expect(wall.style.flags & STYLE_TERRACED).toBe(STYLE_TERRACED);
        const face: TrimFace = { surface: 'brick', bays: wall.bays };
        for (const u of [0.01, wall.bays - 0.01]) {
          expect(trimPartAt(u, 0.05, wall.top, wall.skip, wall.style, face)).not.toBe('quoin');
        }
      }
    }
    // Control: the same street with no class has no terrace, and its corners have their quoins.
    const detached = footprintPlans(town.corridor, land, town.profile, town.origin).plans;
    for (const plan of detached) {
      for (const wall of wallsOf(plan)) {
        expect(wall.style.flags & STYLE_TERRACED).toBe(0);
        const face: TrimFace = { surface: 'brick', bays: wall.bays };
        if ((wall.style.flags & STYLE_GLAZED) !== 0) continue;
        expect(trimPartAt(0.01, 0.05, wall.top, wall.skip, wall.style, face)).toBe('quoin');
      }
    }
  });

  it('finds every wall quad’s far corner as u² over u, which the shader reads it by', () => {
    // Over each wall triangle, weights that sum to 1: Σλu² / Σλu is the quad's bays.
    const plans = rowTownFixturePlans();
    let read = 0;
    for (const plan of plans) {
      const floats = plan.triangles.wall;
      const stride = FOOTPRINT_VERTEX_FLOATS;
      for (let at = 0; at + 6 * stride <= floats.length; at += 6 * stride) {
        const u = (vertex: number): number =>
          floats[at + vertex * stride + FACADE_OFFSET] as number;
        const top = floats[at + FACADE_OFFSET + 2] as number;
        if (!(top > 0)) continue;
        const bays = Math.max(...[0, 1, 2, 3, 4, 5].map(u));
        for (const first of [0, 3]) {
          for (const [a, b, c] of [
            [0.2, 0.3, 0.5],
            [0.6, 0.1, 0.3],
            [0.05, 0.05, 0.9],
          ] as const) {
            const us = [u(first), u(first + 1), u(first + 2)];
            const sum = a * (us[0] ?? 0) + b * (us[1] ?? 0) + c * (us[2] ?? 0);
            const squares = a * (us[0] ?? 0) ** 2 + b * (us[1] ?? 0) ** 2 + c * (us[2] ?? 0) ** 2;
            if (sum < 1e-3) continue;
            expect(squares / sum).toBeCloseTo(bays, 4);
            read += 1;
          }
        }
      }
    }
    expect(read).toBeGreaterThan(100);
  });
});

/** #1588's row town's plans: every house the same two-storey box. */
function rowTownFixturePlans(): readonly FootprintPlan[] {
  const town = rowTownFixture();
  return footprintPlans(town.corridor, landClassMask(town.corridor), town.profile, town.origin)
    .plans;
}

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
const beltBuildings = mappedBuildingsOf(rowTownFixturePlans());

afterEach(() => {
  facadeTrimsOf({} as never, true);
  weatheringOf({} as never, true);
  for (const belt of belts.splice(0)) belt.dispose();
});

/** The programs a mapped building's material of `surface` hands three, and its defines. */
function compiled(surface: 'brick' | 'render' | 'concrete'): {
  readonly vertex: string;
  readonly fragment: string;
  readonly defines: unknown;
} {
  const belt = new MappedBuildingBelt(beltBuildings, textures);
  belts.push(belt);
  const material = belt.materialOf(surface);
  if (material === undefined) throw new Error(`the belt has no ${surface} material`);
  const shader = {
    uniforms: {},
    vertexShader:
      '#include <common>\n#include <begin_vertex>\n#include <color_vertex>\n#include <fog_pars_vertex>\n#include <fog_vertex>',
    fragmentShader:
      '#include <common>\n#include <clipping_planes_fragment>\n#include <map_fragment>\n#include <color_fragment>\n#include <roughnessmap_fragment>\n#include <metalnessmap_fragment>\n#include <normal_fragment_begin>\n#include <normal_fragment_maps>\n#include <fog_pars_fragment>\n#include <fog_fragment>',
  };
  material.onBeforeCompile(shader as never, undefined as never);
  return {
    vertex: shader.vertexShader,
    fragment: shader.fragmentShader,
    defines: { ...material.defines },
  };
}

/** A `const float` the program declares, by name. */
function constantOf(fragment: string, name: string): number {
  const found = new RegExp(`const float ${name} = (-?[\\d.e-]+);`).exec(fragment);
  if (found?.[1] === undefined) throw new Error(`the program declares no ${name}`);
  return Number(found[1]);
}

describe('the trims, in the shader — #1663', () => {
  it('generates its numbers from the twin’s, so that none is written twice', () => {
    const { fragment } = compiled('brick');
    expect(constantOf(fragment, 'oylLintelUp')).toBeCloseTo(TRIM.lintel, 5);
    expect(constantOf(fragment, 'oylLintelGround')).toBeCloseTo(TRIM.groundLintel, 5);
    expect(constantOf(fragment, 'oylLintelOver')).toBeCloseTo(TRIM.overrun, 5);
    expect(constantOf(fragment, 'oylStringDepth')).toBeCloseTo(TRIM.stringCourse, 5);
    expect(constantOf(fragment, 'oylGroundBand')).toBeCloseTo(TRIM.groundBand, 5);
    expect(constantOf(fragment, 'oylQuoinLong')).toBeCloseTo(TRIM.quoin, 5);
    expect(constantOf(fragment, 'oylQuoinShort')).toBeCloseTo(TRIM.quoinShort, 5);
    expect(constantOf(fragment, 'oylQuoinCourse')).toBeCloseTo(TRIM.quoinCourse, 5);
    expect(constantOf(fragment, 'oylQuoinJoint')).toBeCloseTo(TRIM.quoinJoint, 5);
    expect(constantOf(fragment, 'oylTerracedFlag')).toBe(STYLE_TERRACED);
  });

  it('paints stone lintels, string courses and quoins on brick, after the windows and before the shade', () => {
    const { vertex, fragment } = compiled('brick');
    expect(fragment).toContain(
      'diffuseColor.rgb = mix(diffuseColor.rgb, oylTrimStoneC, oylLintel);',
    );
    expect(fragment).toContain(
      'diffuseColor.rgb = mix(diffuseColor.rgb, oylTrimStoneC, oylString);',
    );
    expect(fragment).toContain(
      'diffuseColor.rgb = mix(diffuseColor.rgb, oylTrimStoneC * (1.0 - 0.35 * oylQuoinBed), oylQuoin);',
    );
    // None on a curtain wall.
    expect(fragment).toContain(
      'if (oylFlag(oylFlags, oylGlazedFlag) < 0.5) {\n        const float oylLintelUp',
    );
    // The plan's storeys, as the facade lays its rows of windows.
    expect(fragment).toContain(
      'float oylRows = oylTop >= oylTopShare ? floor(oylTop - oylTopShare + 0.0001) + 1.0 : 0.0;',
    );
    // The far corner is the wall's far end, not the near one's mirror; terraced buildings get no quoin.
    expect(fragment).toContain(
      'float oylFromCorner = min(oylM.x, (oylBaysAll - vOylFacade.x) * oylTrimBay);',
    );
    expect(fragment).toContain(
      'float oylQuoin = (1.0 - oylFlag(oylFlags, oylTerracedFlag)) * step(vOylFacade.y, oylTop)',
    );
    // The far corner, from u² over u.
    expect(vertex).toContain('vOylUu = oylFacade.x * oylFacade.x;');
    expect(fragment).toContain('varying float vOylUu;');
    expect(fragment).toContain('float oylBaysAll = vOylUu / max(vOylFacade.x, 0.0001);');
    const windows = fragment.indexOf('oylGlass = oylPaneShare * (1.0 - oylFade);');
    const trims = fragment.indexOf('// #1663: the trims');
    const shade = fragment.indexOf('// 3. The shade');
    expect(windows).toBeGreaterThan(0);
    expect(trims).toBeGreaterThan(windows);
    expect(shade).toBeGreaterThan(trims);
  });

  it('paints only a lintel, in the trim’s paint, on render, and nothing on any other surface', () => {
    const render = compiled('render').fragment;
    expect(render).toContain('diffuseColor.rgb = mix(diffuseColor.rgb, vOylTrim, oylLintel);');
    expect(render).not.toContain('oylQuoin');
    expect(render).not.toContain('oylString');
    const concrete = compiled('concrete').fragment;
    expect(concrete).not.toContain('oylLintel');
    expect(concrete).not.toContain('oylQuoin');
  });

  it('builds the program without the term with `-facade-trims`, and with it otherwise', () => {
    const on = compiled('brick');
    expect(on.fragment).toContain('oylLintel');
    facadeTrimsOf({} as never, false);
    const off = compiled('brick');
    expect(off.fragment).not.toContain('oylLintel');
    expect(off.fragment).not.toContain('oylQuoin');
    expect(off.fragment).not.toContain('oylString');
    expect(off.fragment).not.toContain('vOylUu');
    expect(off.vertex).not.toContain('vOylUu');
    // A different program, so three compiles it rather than reusing the product's.
    expect(on.defines).toMatchObject({ OYL_FACADE_TRIMS: 1 });
    expect(off.defines).toMatchObject({ OYL_FACADE_TRIMS: 0 });
    facadeTrimsOf({} as never, true);
    expect(compiled('brick').fragment).toContain('oylLintel');
  });

  it('leaves the trims built with #1661’s lever off', () => {
    weatheringOf({} as never, false);
    const { fragment, defines } = compiled('brick');
    expect(fragment).toContain('oylLintel');
    expect(defines).toMatchObject({ OYL_WEATHERING: 0, OYL_FACADE_TRIMS: 1 });
  });
});
