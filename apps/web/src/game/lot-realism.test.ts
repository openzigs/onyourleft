// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #1665: #1661's weathering and #1662's rooms behind the glass, on the
 * procedural village lots — the panes' own coordinates (`buildings.ts`
 * §`glassPaneCoordinates`) held to every plan's windows and read back
 * through the geometry the belt draws; the lots' programs read for the
 * mapped facades' very functions, called and not copied; the far pane
 * unmoved; no mesh, triangle or vertex float added; and the `lot-realism`
 * lever building all of it out. What needs a GPU — a lot wall's grime and two
 * lot panes' rooms on screen — is `game.browser.spec.ts` §"#1665".
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import {
  BUILDING_VARIANTS,
  BUILT_KINDS,
  buildingPlan,
  glassPaneCoordinates,
  glassPanesOf,
  OPENING_RECESS_METRES,
  PANE_STRIDE,
  type BuiltKind,
} from './buildings';
import { footprintPlans } from './footprint-buildings';
import { mixedTownFixture } from './footprint-fixtures-testing';
import { landClassMask } from './land-class';
import { mappedBuildingsOf } from './mapped-buildings';
import type { CameraPose } from './port';
import { PHOTOGRAPHIC_STRUCTURE_SURFACES } from './realistic-assets';
import { REALISTIC_STRUCTURE_MESHES } from './realistic-budget';
import type { ScatterItem } from './scatter';
import {
  carriesLotRealism,
  lotRealismOf,
  MappedBuildingBelt,
  RealisticStructureBelts,
  realisticStructureGeometry,
} from './three-renderer';

const BUILT = BUILT_KINDS;

const POSE: CameraPose = {
  x: 0,
  y: 0,
  z: 0,
  headingX: 0,
  headingZ: 1,
  eyeRoadY: 0,
  targetRoadY: 0,
};

const belts: { dispose(): void }[] = [];

afterEach(() => {
  lotRealismOf({} as never, true);
  for (const belt of belts.splice(0)) belt.dispose();
});

/** Three's own source, read as text: the seam admits one importer of three, so it is not imported. */
function threeSource(path: string): string {
  return readFileSync(
    fileURLToPath(
      new URL(`../../node_modules/three/src/renderers/shaders/${path}`, import.meta.url),
    ),
    'utf8',
  );
}

/** One of a lit program's two stages, its includes unresolved: `meshphysical`'s, or `meshbasic`'s. */
function stage(program: 'meshphysical' | 'meshbasic', which: 'vertex' | 'fragment'): string {
  const found = new RegExp(`export const ${which} = /\\* glsl \\*/\`([\\s\\S]*?)\`;`).exec(
    threeSource(`ShaderLib/${program}.glsl.js`),
  );
  if (found?.[1] === undefined) throw new Error(`three’s ${program} has no ${which} stage`);
  return found[1];
}

interface Compiled {
  readonly vertex: string;
  readonly fragment: string;
  readonly defines: Record<string, unknown>;
}

/** The program a material hands three, from the stages of its own kind, and its defines. */
function compiledOf(material: unknown): Compiled {
  const m = material as {
    isMeshStandardMaterial?: boolean;
    defines?: Record<string, unknown>;
    onBeforeCompile: (shader: unknown, renderer: unknown) => void;
  };
  const program = m.isMeshStandardMaterial === true ? 'meshphysical' : 'meshbasic';
  const shader = {
    uniforms: {},
    vertexShader: stage(program, 'vertex'),
    fragmentShader: stage(program, 'fragment'),
  };
  m.onBeforeCompile(shader, undefined);
  return {
    vertex: shader.vertexShader,
    fragment: shader.fragmentShader,
    defines: { ...m.defines },
  };
}

/** A village house's structure belts, and the lit material of each of its surfaces. */
function lotMaterials(): {
  readonly brick: unknown;
  readonly tiles: unknown;
  readonly glass: unknown;
  readonly planks: unknown;
  readonly flat: { readonly brick: unknown; readonly glass: unknown };
} {
  const structures = new RealisticStructureBelts(new Map());
  belts.push(structures);
  const house: ScatterItem = {
    kind: 'building',
    x: 0,
    y: 0,
    z: 20,
    rotation: 0,
    scale: 1,
    variant: 0,
  };
  structures.update([house], POSE);
  const meshOf = (surface: 'brick' | 'roof-tiles' | 'glass' | 'planks') => {
    const mesh = structures.beltOf(surface)?.meshesOf('building')[0];
    if (mesh === undefined) throw new Error(`a house has no ${surface} mesh`);
    return mesh;
  };
  const shaded = (
    surface: 'brick' | 'roof-tiles' | 'glass' | 'planks',
    shading: 'lit' | 'flat',
  ): unknown => {
    structures.beltOf(surface)?.setShading(shading);
    const { material } = meshOf(surface);
    structures.beltOf(surface)?.setShading('lit');
    return material;
  };
  const lit = (surface: 'brick' | 'roof-tiles' | 'glass' | 'planks'): unknown =>
    shaded(surface, 'lit');
  const flat = (surface: 'brick' | 'glass'): unknown => shaded(surface, 'flat');
  return {
    brick: lit('brick'),
    tiles: lit('roof-tiles'),
    glass: lit('glass'),
    planks: lit('planks'),
    flat: { brick: flat('brick'), glass: flat('glass') },
  };
}

/** A mapped building's lit brick program: the facade's own weathering and interior, to compare text with. */
function facadeFragment(): string {
  const town = mixedTownFixture();
  const textures = new Map(
    PHOTOGRAPHIC_STRUCTURE_SURFACES.map((surface) => [
      surface,
      {
        colour: { image: { width: 512, height: 512 }, dispose: () => undefined } as never,
        normal: { image: { width: 512, height: 512 }, dispose: () => undefined } as never,
      },
    ]),
  );
  const belt = new MappedBuildingBelt(
    mappedBuildingsOf(
      footprintPlans(town.corridor, landClassMask(town.corridor), town.profile, town.origin).plans,
    ),
    textures,
  );
  belts.push(belt);
  return compiledOf(belt.materialOf('brick')).fragment;
}

/** A function's whole text in a program, from its signature to its closing brace. */
function functionText(source: string, signature: string): string {
  const start = source.indexOf(signature);
  if (start < 0) throw new Error(`the program has no ${signature}`);
  let depth = 0;
  let end = source.indexOf('{', start);
  for (; end < source.length; end += 1) {
    depth += source[end] === '{' ? 1 : source[end] === '}' ? -1 : 0;
    if (depth === 0) break;
  }
  return source.slice(start, end + 1);
}

describe('each lot pane knows its own rectangle — #1665', () => {
  /** Every glass vertex of a plan, its place on its window's face, and the coordinates laid for it. */
  const panes = (kind: BuiltKind, variant: number) => {
    const plan = buildingPlan(kind, variant);
    const uv = glassPaneCoordinates(plan);
    const windows = glassPanesOf(plan);
    return { plan, uv, windows };
  };

  it('lays two numbers a glass vertex, −1 to 1 across and up its pane, the across one by the pane’s index', () => {
    let checked = 0;
    for (const kind of BUILT) {
      for (let variant = 0; variant < BUILDING_VARIANTS; variant += 1) {
        const { plan, uv, windows } = panes(kind, variant);
        expect(uv.length).toBe((plan.triangles.glass.length / 3) * 2);
        const seen = new Map<number, { minU: number; maxU: number; minV: number; maxV: number }>();
        for (let at = 0; at < uv.length; at += 2) {
          const x = uv[at] as number;
          const y = uv[at + 1] as number;
          // The shader's own decoding: the index, and what is left.
          const index = Math.floor((x + PANE_STRIDE / 2) / PANE_STRIDE);
          const across = x - PANE_STRIDE * index;
          expect(index).toBeGreaterThanOrEqual(0);
          expect(index).toBeLessThan(windows.length);
          expect(Math.abs(across)).toBeLessThanOrEqual(1 + 1e-5);
          expect(Math.abs(y)).toBeLessThanOrEqual(1 + 1e-5);
          const pane = seen.get(index) ?? { minU: 9, maxU: -9, minV: 9, maxV: -9 };
          seen.set(index, {
            minU: Math.min(pane.minU, across),
            maxU: Math.max(pane.maxU, across),
            minV: Math.min(pane.minV, y),
            maxV: Math.max(pane.maxV, y),
          });
          checked += 1;
        }
        // Every window has its glass, and its glass reaches its rectangle's every side.
        expect(seen.size, `${kind} ${String(variant)}`).toBe(windows.length);
        for (const pane of seen.values()) {
          expect(pane.minU).toBeCloseTo(-1, 4);
          expect(pane.maxU).toBeCloseTo(1, 4);
          expect(pane.minV).toBeCloseTo(-1, 4);
          expect(pane.maxV).toBeCloseTo(1, 4);
        }
      }
    }
    expect(checked).toBeGreaterThan(100);
  });

  /** Every vertex of `position`, decoded through its own `uv` and window, is where the vertex is. */
  const expectPaired = (
    position: ArrayLike<number>,
    uv: ArrayLike<number>,
    windows: ReturnType<typeof glassPanesOf>,
  ) => {
    for (let vertex = 0; vertex < position.length / 3; vertex += 1) {
      const x = uv[vertex * 2] as number;
      const index = Math.floor((x + PANE_STRIDE / 2) / PANE_STRIDE);
      const window = windows[index];
      if (window === undefined) throw new Error('no window');
      const us = window.outline.map(([u]) => u);
      const vs = window.outline.map(([, v]) => v);
      const [u0, u1, v0, v1] = [Math.min(...us), Math.max(...us), Math.min(...vs), Math.max(...vs)];
      const u = u0 + ((x - PANE_STRIDE * index + 1) / 2) * (u1 - u0);
      const v = v0 + (((uv[vertex * 2 + 1] as number) + 1) / 2) * (v1 - v0);
      const { origin, right, normal } = window.face;
      const at = [0, 1, 2].map(
        (k) =>
          (origin[k] as number) +
          (right[k] as number) * u +
          (k === 1 ? v : 0) -
          (normal[k] as number) * OPENING_RECESS_METRES,
      );
      for (const k of [0, 1, 2]) {
        expect(position[vertex * 3 + k] as number).toBeCloseTo(at[k] as number, 4);
      }
    }
  };

  it('puts each vertex at its own place in its own window: decoded, it is where the vertex is', () => {
    for (const kind of BUILT) {
      const { plan, uv, windows } = panes(kind, 0);
      expectPaired(plan.triangles.glass, uv, windows);
    }
  });

  it('reaches the geometry the belt draws: the glass’s uv is the panes’, and every other surface keeps its metres', () => {
    for (const kind of BUILT) {
      for (let variant = 0; variant < BUILDING_VARIANTS; variant += 1) {
        const geometry = realisticStructureGeometry(kind, 'glass', variant);
        if (geometry === undefined) continue;
        const read = Array.from(geometry.getAttribute('uv').array as ArrayLike<number>);
        expect(read).toEqual(Array.from(glassPaneCoordinates(buildingPlan(kind, variant))));
        // And paired: the geometry's own position is where its own uv says.
        expectPaired(
          geometry.getAttribute('position').array as ArrayLike<number>,
          geometry.getAttribute('uv').array as ArrayLike<number>,
          glassPanesOf(buildingPlan(kind, variant)),
        );
        geometry.dispose();
      }
    }
    // A wall's coordinates are still metres: its uv spans the house, not −1 to 1.
    const wall = realisticStructureGeometry('building', 'brick', 0);
    const us = Array.from(wall?.getAttribute('uv').array as ArrayLike<number>);
    expect(Math.max(...us) - Math.min(...us)).toBeGreaterThan(2);
    wall?.dispose();
  });

  it('adds no mesh: the structure belts still build REALISTIC_STRUCTURE_MESHES, 35', () => {
    expect(REALISTIC_STRUCTURE_MESHES).toBe(35);
  });
});

describe('a lot’s walls and roofs weathered by the mapped facades’ own functions — #1665', () => {
  it('calls #1661’s splash grime and tile noise on a lot’s wall, from the same text a mapped wall runs', () => {
    const { brick } = lotMaterials();
    const lot = compiledOf(brick);
    expect(lot.fragment).toContain(
      'oylWeatherGrime(oylUpFacing, 1.0, vOylLot.y, oylPlane.x, vOylAge, oylWpw)',
    );
    expect(lot.fragment).toContain(
      'diffuseColor.rgb *= oylWeatherTile(oylPlane.x, oylPlane.y, oylWpw);',
    );
    // Called, not copied: each function is the mapped facade's, character for character.
    const facade = facadeFragment();
    for (const signature of [
      'float oylWeatherSplash(float up, float a, float age, float pw)',
      'float oylWeatherGrime(float upFacing, float faceOn, float up, float a, float age, float pw)',
      'float oylWeatherTile(float a, float b, float pw)',
      'float oylWeatherNoise(float a, float b)',
    ]) {
      expect(functionText(lot.fragment, signature), signature).toBe(
        functionText(facade, signature),
      );
      expect(lot.fragment.split(signature).length - 1, signature).toBe(1);
    }
    // Its place in the world through the instance's matrix, and its age from its seeded tint.
    expect(lot.vertex).toContain(
      'vOylWorld = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;',
    );
    expect(lot.vertex).toContain('vOylAge = oylWeatherAgeOf(vOylTint);');
    // And after the tint is set, before which it would read nought.
    expect(lot.vertex.indexOf('vOylTint = ')).toBeGreaterThan(0);
    expect(lot.vertex.indexOf('vOylAge = oylWeatherAgeOf(vOylTint);')).toBeGreaterThan(
      lot.vertex.indexOf('vOylTint = '),
    );
  });

  it('calls #1661’s moss on a lot’s roof, and weathers neither the joinery nor the flat rung', () => {
    const { tiles, planks, flat } = lotMaterials();
    const roof = compiledOf(tiles).fragment;
    expect(roof).toContain('oylWeatherMoss(oylPlane.x, oylPlane.y, oylUpFacing, vOylAge, oylWpw)');
    expect(roof).not.toContain('oylWeatherGrime(oylUpFacing');
    expect(compiledOf(planks).fragment).not.toContain('oylWeather');
    expect(compiledOf(flat.brick).fragment).not.toContain('oylWeather');
    expect(carriesLotRealism(planks as never)).toBe(false);
    expect(carriesLotRealism(flat.brick as never)).toBe(false);
  });
});

describe('the room behind a lot’s glass — #1665', () => {
  it('calls #1662’s oylInterior, the mapped panes’ very function, with the pane its uv names', () => {
    const { glass } = lotMaterials();
    const lot = compiledOf(glass);
    expect(lot.vertex).toContain('vOylPane = uv;');
    expect(lot.fragment).toContain('vec3 oylRoomC = oylInterior(');
    expect(lot.fragment).toContain('oylAt * oylHalf, 2.0 * oylHalf, oylEye,');
    const signature =
      'vec3 oylInterior(vec2 pane, vec2 paneSize, vec3 eyeFace, float seed, float palette, float lit)';
    const facade = facadeFragment();
    expect(functionText(lot.fragment, signature)).toBe(functionText(facade, signature));
    for (const name of ['vec2 oylRoomHit(', 'float oylFresnelOf(']) {
      expect(functionText(lot.fragment, name)).toBe(functionText(facade, name));
    }
    // The pane's index and place, decoded with the stride the plan laid them at.
    expect(lot.fragment).toContain(
      `float oylIndex = floor((vOylPane.x + ${String(PANE_STRIDE / 2)}.0) / ${String(PANE_STRIDE)}.0);`,
    );
    // One lit room in five, by #1581's rule, and the room seeded apart from it,
    // by the pane's index's parity as a mapped bay's is.
    expect(lot.fragment).toContain(
      'oylRoomSeedOf(vec2(oylIndex, 0.0), vOylTint.xy), 0.0, step(0.8, oylWindowHash(oylCell))',
    );
  });

  it('numbers a wall’s windows along it, so that two side by side are an even and an odd pane', () => {
    let pairs = 0;
    for (const kind of BUILT) {
      for (let variant = 0; variant < BUILDING_VARIANTS; variant += 1) {
        const windows = glassPanesOf(buildingPlan(kind, variant));
        const rows = new Map<string, { index: number; u: number }[]>();
        windows.forEach((window, index) => {
          const vs = window.outline.map(([, v]) => v);
          const us = window.outline.map(([u]) => u);
          const key = `${window.face.origin.join(',')}|${window.face.normal.join(',')}|${Math.min(...vs).toFixed(2)}`;
          rows.set(key, [...(rows.get(key) ?? []), { index, u: Math.min(...us) }]);
        });
        for (const row of rows.values()) {
          const along = [...row].sort((a, b) => a.u - b.u);
          for (let at = 1; at < along.length; at += 1) {
            const step = (along[at]?.index ?? 0) - (along[at - 1]?.index ?? 0);
            expect(Math.abs(step) % 2, `${kind} ${String(variant)}`).toBe(1);
            pairs += 1;
          }
        }
      }
    }
    expect(pairs).toBeGreaterThan(20);
  });

  it('weights the room by 1 − F and makes the pane a dielectric where the room is, fading both far off', () => {
    const { glass } = lotMaterials();
    const { fragment } = compiledOf(glass);
    expect(fragment).toContain(') * (1.0 - oylGlassF);');
    expect(fragment).toContain('float oylGlassF = oylFresnelOf(oylEye.z);');
    expect(fragment).toContain('metalnessFactor = mix(metalnessFactor, 0.0, oylRoomShare);');
    // Far off, its flat glass and its 0.35, as before: the room's share fades to nought.
    expect(fragment).toContain(
      'oylRoomShare = 1.0 - oylFadeOf(0.5 * max(fwidth(vOylPane.x), fwidth(vOylPane.y)));',
    );
    expect(fragment).toContain('diffuseColor.rgb = mix(diffuseColor.rgb, oylRoomC, oylRoomShare);');
    // Read before three's lighting reads the metalness.
    expect(
      fragment.indexOf('metalnessFactor = mix(metalnessFactor, 0.0, oylRoomShare);'),
    ).toBeLessThan(fragment.indexOf('#include <lights_physical_fragment>'));
  });

  it('teaches the lit glass only: the flat rung’s glass is as it was', () => {
    const { glass, flat } = lotMaterials();
    expect(carriesLotRealism(glass as never)).toBe(true);
    expect(carriesLotRealism(flat.glass as never)).toBe(false);
    expect(compiledOf(flat.glass).fragment).not.toContain('oylInterior');
  });
});

describe('the `lot-realism` lever — #1665', () => {
  it('builds the lots’ programs without the weathering and the rooms with `-lot-realism`, and with them otherwise', () => {
    const on = lotMaterials();
    const wallOn = compiledOf(on.brick);
    const glassOn = compiledOf(on.glass);
    expect(wallOn.fragment).toContain('oylWeatherGrime(');
    expect(glassOn.fragment).toContain('oylInterior(');
    expect(wallOn.defines).toMatchObject({ OYL_LOT_REALISM: 1 });
    expect(glassOn.defines).toMatchObject({ OYL_LOT_REALISM: 1 });
    lotRealismOf({} as never, false);
    const off = lotMaterials();
    const wallOff = compiledOf(off.brick);
    const glassOff = compiledOf(off.glass);
    const roofOff = compiledOf(off.tiles);
    expect(wallOff.fragment).not.toContain('oylWeather');
    expect(wallOff.vertex).not.toContain('vOylWorld');
    expect(roofOff.fragment).not.toContain('oylWeather');
    expect(glassOff.fragment).not.toContain('oylInterior');
    expect(glassOff.fragment).not.toContain('metalnessFactor = mix(metalnessFactor, 0.0');
    expect(glassOff.vertex).not.toContain('vOylPane');
    // A different program, so three compiles it: three keys a program on its material's defines.
    expect(wallOff.defines).toMatchObject({ OYL_LOT_REALISM: 0 });
    expect(glassOff.defines).toMatchObject({ OYL_LOT_REALISM: 0 });
    // A lit wall, roof and pane are the materials the lever reaches.
    for (const material of [off.brick, off.tiles, off.glass]) {
      expect(carriesLotRealism(material as never)).toBe(true);
    }
  });
});
