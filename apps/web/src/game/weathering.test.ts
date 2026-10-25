// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #1661: the mapped facades weathered in the shader — the twin
 * (`facade.ts` §`weatheringAt`, `weatheringAgeOf`, `photographShiftOf`) held
 * effect by effect to the issue's rule, and far off to the mean it fades to;
 * the shader's own functions run against the twin; the photograph laid
 * differently on two neighbours, read from the vertex buffer the GPU
 * receives; the one texture fetch the wall's photograph still costs; and the
 * owner's lever, which takes the whole term out of both programs. What needs
 * a GPU — that the grime reaches the screen, and that the lever takes it off
 * — is `game.browser.spec.ts` §"#1661".
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import {
  photographShiftOf,
  streakShareOf,
  WEATHERING,
  weatheringAgeOf,
  weatheringAt,
  weatheringHash,
  type WeatheringAt,
  type WeatheringTerm,
} from './facade';
import {
  footprintPlans,
  FOOTPRINT_VERTEX_FLOATS,
  STYLE_EAVES,
  STYLE_FLAT_ROOF,
  STYLE_OFFSET,
  type FootprintPlan,
} from './footprint-buildings';
import { mixedTownFixture } from './footprint-fixtures-testing';
import { glslFunction } from './glsl-testing';
import { landClassMask } from './land-class';
import { mappedBuildingsOf } from './mapped-buildings';
import { PHOTOGRAPHIC_STRUCTURE_SURFACES } from './realistic-assets';
import { drawnRoadFrame } from './terrain';
import {
  MappedBuildingBelt,
  overhangShadowsOf,
  weatheringOf,
  windowRevealsOf,
} from './three-renderer';

const town = mixedTownFixture();
const plans = footprintPlans(
  town.corridor,
  landClassMask(town.corridor),
  town.profile,
  town.origin,
).plans;
const buildings = mappedBuildingsOf(plans);
/** A point on a wall, near, of a building of `age`. */
const at = (plane: readonly [number, number], age = 1, pw = 0): WeatheringAt => ({
  plane,
  age,
  pw,
});

const light = (term: WeatheringTerm, where: WeatheringAt): number =>
  weatheringAt(term, where).light;

describe('the age seed — #1661', () => {
  it('seeds each building’s age from its tint, in [0, 1], the same on every lap', () => {
    const ages = new Set<number>();
    for (let hue = -6; hue <= 6; hue += 1) {
      for (let brightness = -4; brightness <= 4; brightness += 1) {
        const tint: [number, number, number] = [hue * 0.01, 0.02, brightness * 0.02];
        const age = weatheringAgeOf(tint);
        expect(age).toBeGreaterThanOrEqual(0);
        expect(age).toBeLessThan(1);
        expect(weatheringAgeOf([...tint])).toBe(age);
        ages.add(Math.round(age * 10));
      }
    }
    // Spread across the range, not one age for every building.
    expect(ages.size).toBeGreaterThanOrEqual(8);
  });
});

describe('the weathering, effect by effect, in the twin — #1661', () => {
  it('grimes a wall’s foot: darker at 0.3 m than at 1.2 m, and darker at age 1 than at age 0', () => {
    for (const along of [0, 0.7, 3.1, 12.5, 40]) {
      const low = weatheringAt({ effect: 'splash', up: 0.3 }, at([along, 0.3]));
      const high = weatheringAt({ effect: 'splash', up: 1.2 }, at([along, 1.2]));
      expect(low.light).toBeLessThan(high.light);
      expect(high.light).toBe(1);
      // Greyed as well as darkened, where it is grimed.
      expect(low.grey).toBeGreaterThan(0);
      expect(high.grey).toBe(0);
      const young = light({ effect: 'splash', up: 0.3 }, at([along, 0.3], 0));
      expect(low.light).toBeLessThan(young);
      expect(young).toBeLessThan(1);
    }
  });

  it('breaks the splash band’s top between 0.6 m and 1.0 m along the wall', () => {
    const [lowest, highest] = WEATHERING.splash.top;
    const tops = new Set<number>();
    for (let along = 0; along < 20; along += 0.1) {
      // Where along the wall the band runs out: the first height that is clean.
      let top = 0;
      while (light({ effect: 'splash', up: top }, at([along, top])) < 1) top += 0.01;
      expect(top).toBeGreaterThanOrEqual(lowest - 0.011);
      expect(top).toBeLessThanOrEqual(highest + 0.011);
      tops.add(Math.round(top * 20));
    }
    expect(tops.size).toBeGreaterThan(4);
  });

  it('streaks the wall under a sill: 0.5 m under it is darker than 0.5 m beside it on render, and less dark on brick', () => {
    const half = 0.6;
    const render = streakShareOf('render');
    const brick = streakShareOf('brick');
    expect(render).toBe(1);
    expect(brick).toBe(WEATHERING.streak.brick);
    expect(streakShareOf('concrete')).toBe(1);
    expect(streakShareOf('brick', true)).toBe(1);
    for (let along = 0; along < 2; along += 0.013) {
      const under = (share: number): number =>
        light({ effect: 'streak', below: 0.5, across: 0, half, share }, at([along, 0]));
      const beside = light(
        { effect: 'streak', below: 0.5, across: half + 0.5, half, share: render },
        at([along, 0]),
      );
      expect(under(render)).toBeLessThan(beside);
      expect(beside).toBe(1);
      expect(under(brick)).toBeGreaterThan(under(render));
      expect(under(brick)).toBeLessThan(1);
    }
    // It falls off over a metre, and is none above the sill.
    const s = (below: number): number =>
      light({ effect: 'streak', below, across: 0, half, share: render }, at([0.5, 0]));
    expect(s(0.1)).toBeLessThan(s(0.5));
    expect(s(0.5)).toBeLessThan(s(0.9));
    expect(s(1.05)).toBe(1);
    expect(s(-0.1)).toBe(1);
  });

  it('breaks a streak into columns about 4 cm wide', () => {
    const column = (along: number): number =>
      light({ effect: 'streak', below: 0.3, across: 0, half: 0.6, share: 1 }, at([along, 0]));
    const seen = new Set<number>();
    for (let k = 0; k < 50; k += 1) {
      const middle = (k + 0.5) * WEATHERING.streak.column;
      // One value across a column ...
      expect(column(middle - 0.015)).toBe(column(middle + 0.015));
      seen.add(Math.round(column(middle) * 1000));
    }
    // ... and many values across fifty of them.
    expect(seen.size).toBeGreaterThan(20);
  });

  it('drips down a flat-roofed face only, from its parapet', () => {
    for (const along of [0.03, 1.2, 7.7]) {
      const flat = light({ effect: 'drip', below: 0.2, flat: true }, at([along, 0]));
      const pitched = light({ effect: 'drip', below: 0.2, flat: false }, at([along, 0]));
      expect(flat).toBeLessThan(1);
      expect(pitched).toBe(1);
      expect(light({ effect: 'drip', below: 0.6, flat: true }, at([along, 0]))).toBe(1);
    }
  });

  it('carries the flat roof on its walls’ style, and the eaves on a pitched roof’s', () => {
    let flat = 0;
    let pitched = 0;
    for (const plan of plans) {
      // A flat roof is the one with a parapet round it.
      const parapet = plan.triangles.parapet.length > 0;
      const walls = plan.triangles.wall;
      for (let vertex = 0; vertex < walls.length; vertex += FOOTPRINT_VERTEX_FLOATS) {
        const flags = walls[vertex + STYLE_OFFSET + 1] as number;
        expect((flags & STYLE_FLAT_ROOF) !== 0).toBe(parapet);
        if (parapet) expect(flags & STYLE_EAVES).toBe(0);
      }
      if (walls.length === 0) continue;
      if (parapet) flat += 1;
      else pitched += 1;
    }
    expect(flat).toBeGreaterThan(10);
    expect(pitched).toBeGreaterThan(10);
  });

  it('darkens a pitched roof’s lowest courses, and no flat roof’s', () => {
    const c = (upSlope: number, pitched = true): number =>
      light({ effect: 'courses', upSlope, pitched }, at([0, 0]));
    expect(c(0.05)).toBeLessThan(c(0.4));
    expect(c(0.4)).toBeLessThan(c(0.7));
    expect(c(0.7)).toBe(1);
    expect(c(0.05, false)).toBe(1);
    expect(c(0.05)).toBeLessThan(
      light({ effect: 'courses', upSlope: 0.05, pitched: true }, at([0, 0], 0)) + 1e-12,
    );
  });

  it('tints what faces up toward moss in patches, by age, and never a wall', () => {
    let mossy = 0;
    let bare = 0;
    for (let x = 0; x < 64; x += 0.5) {
      for (let z = 0; z < 64; z += 0.5) {
        const moss = weatheringAt({ effect: 'moss', facing: 0.8 }, at([x, z])).moss;
        if (moss > 0.05) mossy += 1;
        else bare += 1;
        expect(weatheringAt({ effect: 'moss', facing: 0 }, at([x, z])).moss).toBe(0);
        expect(moss).toBeLessThanOrEqual(WEATHERING.moss.strength * 1.6);
        if (moss > 0) {
          expect(weatheringAt({ effect: 'moss', facing: 0.8 }, at([x, z], 0)).moss).toBeLessThan(
            moss,
          );
        }
      }
    }
    // Patches: some of a roof, not all of it.
    expect(mossy).toBeGreaterThan(0);
    expect(bare).toBeGreaterThan(mossy);
  });

  it('parges a render or concrete plinth lighter, and nothing else', () => {
    expect(light({ effect: 'parging', parged: true }, at([0, -0.2]))).toBeCloseTo(
      1 + WEATHERING.parging.lighten,
      12,
    );
    expect(light({ effect: 'parging', parged: false }, at([0, -0.2]))).toBe(1);
  });

  it('breaks the photograph’s repeat with two scales of noise, either way of its light', () => {
    let lighter = 0;
    let darker = 0;
    for (let along = 0; along < 20; along += 0.25) {
      for (let up = 0; up < 6; up += 0.25) {
        const l = light({ effect: 'tile' }, at([along, up]));
        expect(Math.abs(l - 1)).toBeLessThanOrEqual(WEATHERING.tile.strength + 1e-12);
        if (l > 1.01) lighter += 1;
        if (l < 0.99) darker += 1;
      }
    }
    expect(lighter).toBeGreaterThan(20);
    expect(darker).toBeGreaterThan(20);
  });
});

describe('far off, every effect fades to its mean — #1661', () => {
  /** Every effect over a wall patch `4 × 4 m` at `(x, y)`, 2 cm a sample. */
  const patches: readonly (readonly [string, (x: number, y: number) => WeatheringTerm])[] = [
    ['tile', () => ({ effect: 'tile' })],
    ['splash', (_x, y) => ({ effect: 'splash', up: y })],
    // A sill 3 m up, 1.2 m wide, over the patch's middle.
    ['streak', (x, y) => ({ effect: 'streak', below: 3 - y, across: x - 2, half: 0.6, share: 1 })],
    ['drip', (_x, y) => ({ effect: 'drip', below: 4 - y, flat: true })],
    ['courses', (_x, y) => ({ effect: 'courses', upSlope: y, pitched: true })],
    ['moss', () => ({ effect: 'moss', facing: 0.8 })],
    ['parging', () => ({ effect: 'parging', parged: true })],
  ];

  /** A term's mean over a 4 × 4 m patch at `(ox, oy)`, as light: moss darkens a roof by its luminance. */
  function meanOver(
    term: (x: number, y: number) => WeatheringTerm,
    ox: number,
    oy: number,
    pw: number,
  ): number {
    // A mid roof's luminance against the moss's: how much of its light a share of moss takes.
    const [r, g, b] = WEATHERING.moss.colour;
    const mossTakes = 1 - (0.2126 * r + 0.7152 * g + 0.0722 * b) / 0.12;
    let sum = 0;
    let count = 0;
    for (let i = 0; i < 200; i += 1) {
      for (let j = 0; j < 200; j += 1) {
        const x = (i + 0.5) * 0.02;
        const y = (j + 0.5) * 0.02;
        const done = weatheringAt(term(x, y), at([ox + x, oy + y], 1, pw));
        sum += done.light * (1 - done.moss * mossTakes);
        count += 1;
      }
    }
    return sum / count;
  }

  for (const [name, term] of patches) {
    it(`holds the ${name}’s mean over a 4 × 4 m patch at full fade within 2 % of its mean near`, () => {
      for (let patch = 0; patch < 12; patch += 1) {
        const ox = patch * 13.37 + 5;
        const oy = patch * 7.1;
        const near = meanOver(term, ox, oy, 0);
        const far = meanOver(term, ox, oy, 100);
        expect(Math.abs(far - near) / near, `patch ${String(patch)}`).toBeLessThan(0.02);
      }
    });
  }

  it('fades the detail and not the mean: a far streak is one shade, a near one columns', () => {
    const term: WeatheringTerm = { effect: 'streak', below: 0.3, across: 0, half: 0.6, share: 1 };
    const far = new Set<number>();
    const near = new Set<number>();
    for (let along = 0; along < 2; along += 0.01) {
      far.add(Math.round(light(term, at([along, 0], 1, 100)) * 1e6));
      near.add(Math.round(light(term, at([along, 0], 1, 0)) * 1e6));
    }
    expect(far.size).toBe(1);
    expect(near.size).toBeGreaterThan(10);
  });
});

/* ---------------------------------------------------------------- the shader */

/** Three's own lit program, read as text: the seam admits one importer of three, so it is not imported. */
function threeSource(path: string): string {
  return readFileSync(
    fileURLToPath(
      new URL(`../../node_modules/three/src/renderers/shaders/${path}`, import.meta.url),
    ),
    'utf8',
  );
}

/** One of the lit program's two stages, as `meshphysical.glsl.js` writes it. */
function physical(stage: 'vertex' | 'fragment'): string {
  const found = new RegExp(`export const ${stage} = /\\* glsl \\*/\`([\\s\\S]*?)\`;`).exec(
    threeSource('ShaderLib/meshphysical.glsl.js'),
  );
  if (found?.[1] === undefined) throw new Error(`three's lit program has no ${stage} stage`);
  return found[1];
}

/** `source` with every `#include <chunk>` replaced by three's chunk, as three resolves it. */
function resolved(source: string, depth = 0): string {
  if (depth > 8) throw new Error('three’s chunks include too deep');
  return source.replace(/^[ \t]*#include <(\w+)>/gm, (_whole, chunk: string) => {
    const text = /export default \/\* glsl \*\/`([\s\S]*?)`;/.exec(
      threeSource(`ShaderChunk/${chunk}.glsl.js`),
    );
    if (text?.[1] === undefined) throw new Error(`three has no chunk ${chunk}`);
    return resolved(text[1], depth + 1);
  });
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

afterEach(() => {
  weatheringOf({} as never, true);
  overhangShadowsOf({} as never, true);
  windowRevealsOf({} as never, true);
  for (const belt of belts.splice(0)) belt.dispose();
});

function aBelt(): MappedBuildingBelt {
  const belt = new MappedBuildingBelt(buildings, textures);
  belts.push(belt);
  return belt;
}

/**
 * The program a mapped building's material of `surface` hands three, its
 * includes not yet resolved, three's own lit program with the material's
 * defines; and the defines three keys it on.
 */
function compiled(surface: 'brick' | 'render' = 'brick'): {
  readonly vertex: string;
  readonly fragment: string;
  readonly defines: unknown;
  readonly key: string;
} {
  const material = aBelt().materialOf(surface);
  if (material === undefined) throw new Error(`the belt has no ${surface} material`);
  const shader = {
    uniforms: {},
    vertexShader: physical('vertex'),
    fragmentShader: physical('fragment'),
  };
  material.onBeforeCompile(shader as never, undefined as never);
  return {
    vertex: shader.vertexShader,
    fragment: shader.fragmentShader,
    defines: { ...material.defines },
    key: material.customProgramCacheKey(),
  };
}

/** A `const float` the program declares, by name. */
function constantOf(source: string, name: string): number {
  const found = new RegExp(`const float ${name} = (-?[\\d.e-]+);`).exec(source);
  if (found?.[1] === undefined) throw new Error(`the program declares no ${name}`);
  return Number(found[1]);
}

/** GLSL's smoothstep, and with its edges equal a step, as the twin reads it. */
function smoothstepOf(lo: number, hi: number, x: number): number {
  if (!(hi > lo)) return x < lo ? 0 : 1;
  const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
}

type Run = (...args: readonly (number | { x: number; y: number; z: number })[]) => number;

/**
 * The program's own scalar functions `names`, run: every `const float` it
 * declares and every function the names call, their text as the shader holds
 * it with GLSL's built-ins, so that the test holds what the GPU runs to the
 * twin and not a copy of it. Reads float and `vec3` parameters, `float`
 * locals, `.x .y .z` and the conditional operator; a `vec3` is passed as
 * `{ x, y, z }`.
 */
function shaderFunctions(source: string, names: readonly string[]): Record<string, Run> {
  const constants = [...source.matchAll(/const float (oyl\w+) = (-?[\d.e-]+);/g)].map(
    (match) => `const ${match[1] ?? ''} = ${match[2] ?? ''};`,
  );
  const functions: string[] = [];
  // The weathering's own, and the fade they share with #1581's layout.
  for (const match of source.matchAll(
    /float (oylWeather\w+|oylPhoto\w+|oylFadeOf)\(([^)]*)\) \{/g,
  )) {
    let depth = 1;
    let end = (match.index ?? 0) + match[0].length;
    for (; end < source.length && depth > 0; end += 1) {
      depth += source[end] === '{' ? 1 : source[end] === '}' ? -1 : 0;
    }
    const body = source
      .slice((match.index ?? 0) + match[0].length, end - 1)
      .replace(/\bfloat\s+(\w+)\s*=/g, 'let $1 =');
    const parameters = (match[2] ?? '')
      .split(',')
      .map((each) => each.trim().split(/\s+/)[1] ?? '')
      .filter((each) => each !== '');
    functions.push(`function ${match[1] ?? ''}(${parameters.join(', ')}) {${body}}`);
  }
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- runs the shader's own function text
  const make = new Function(
    'fract',
    'sin',
    'mod',
    'floor',
    'mix',
    'smoothstep',
    'clamp',
    'abs',
    'min',
    'max',
    'step',
    `${constants.join('\n')}\n${functions.join('\n')}\nreturn { ${names.join(', ')} };`,
  ) as (...builtIns: unknown[]) => Record<string, Run>;
  return make(
    (x: number) => x - Math.floor(x),
    Math.sin,
    (x: number, y: number) => x - y * Math.floor(x / y),
    Math.floor,
    (a: number, b: number, t: number) => a * (1 - t) + b * t,
    smoothstepOf,
    (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x)),
    Math.abs,
    Math.min,
    Math.max,
    (edge: number, x: number) => (x < edge ? 0 : 1),
  );
}

describe('the weathering, in the shader — #1661', () => {
  it('runs the twin’s rule: the program’s own functions give the twin’s every effect', () => {
    const { fragment } = compiled('brick');
    const run = shaderFunctions(fragment, [
      'oylWeatherHash',
      'oylWeatherAgeOf',
      'oylWeatherTile',
      'oylWeatherSplash',
      'oylWeatherStreak',
      'oylWeatherDrip',
      'oylWeatherCourses',
      'oylWeatherMoss',
    ]);
    const f = (name: string): Run => {
      const found = run[name];
      if (found === undefined) throw new Error(`no ${name}`);
      return found;
    };
    const { splash, streak, drip, courses, moss } = WEATHERING;
    for (const age of [0, 0.37, 1]) {
      for (const pw of [0.002, 0.05, 3]) {
        for (let k = 0; k < 40; k += 1) {
          const a = k * 0.731 - 3;
          const b = k * 0.419 + 0.05;
          const where = at([a, b], age, pw);
          expect(f('oylWeatherHash')(a, b)).toBe(weatheringHash(a, b));
          expect(f('oylWeatherTile')(a, b, pw)).toBeCloseTo(light({ effect: 'tile' }, where), 9);
          const grime = f('oylWeatherSplash')(b, a, age, pw);
          const twin = weatheringAt({ effect: 'splash', up: b }, where);
          expect(1 - splash.strength * grime).toBeCloseTo(twin.light, 9);
          expect(splash.grey * grime).toBeCloseTo(twin.grey, 9);
          const across = (k % 7) * 0.2 - 0.6;
          expect(1 - f('oylWeatherStreak')(b - 0.5, across, 0.55, a, 0.5, age, pw)).toBeCloseTo(
            light({ effect: 'streak', below: b - 0.5, across, half: 0.55, share: 0.5 }, where),
            9,
          );
          expect(1 - f('oylWeatherDrip')(b - 0.2, a, age, pw)).toBeCloseTo(
            light({ effect: 'drip', below: b - 0.2, flat: true }, where),
            9,
          );
          expect(1 - f('oylWeatherCourses')(b, age)).toBeCloseTo(
            light({ effect: 'courses', upSlope: b, pitched: true }, where),
            9,
          );
          const facing = (k % 5) * 0.2;
          expect(f('oylWeatherMoss')(a * 9, b * 9, facing, age, pw)).toBeCloseTo(
            weatheringAt({ effect: 'moss', facing }, at([a * 9, b * 9], age, pw)).moss,
            9,
          );
        }
      }
    }
    const tint = { x: 0.031, y: -0.02, z: 0.05 };
    expect(f('oylWeatherAgeOf')(tint)).toBe(weatheringAgeOf([tint.x, tint.y, tint.z]));
    // The strengths are the twin's, read by the splices that multiply by them.
    expect(constantOf(fragment, 'oylSplashStrength')).toBe(splash.strength);
    expect(constantOf(fragment, 'oylSplashGrey')).toBe(splash.grey);
    expect(constantOf(fragment, 'oylStreakStrength')).toBe(streak.strength);
    expect(constantOf(fragment, 'oylDripStrength')).toBe(drip.strength);
    expect(constantOf(fragment, 'oylCoursesStrength')).toBe(courses.strength);
    expect(constantOf(fragment, 'oylMossStrength')).toBe(moss.strength);
    expect(constantOf(fragment, 'oylPargeLift')).toBe(WEATHERING.parging.lighten);
    expect(constantOf(fragment, 'oylFlatRoofFlag')).toBe(STYLE_FLAT_ROOF);
  });

  it('bakes each surface’s share of a sill’s streak and its parging into its own program', () => {
    const brick = compiled('brick');
    const render = compiled('render');
    expect(constantOf(brick.fragment, 'oylStreakShare')).toBe(streakShareOf('brick'));
    expect(constantOf(render.fragment, 'oylStreakShare')).toBe(streakShareOf('render'));
    expect(constantOf(brick.fragment, 'oylParged')).toBe(0);
    expect(constantOf(render.fragment, 'oylParged')).toBe(1);
    // Two programs, so three does not hand one surface's to the other.
    expect(brick.key).not.toBe(render.key);
    // A clapboard wall streaks fully, whatever it wears.
    expect(brick.fragment).toContain(
      'float oylStreakAt = mix(oylStreakShare, 1.0, step(abs(oylKind - oylClapboard), 0.5));',
    );
  });

  it('splices each effect where the issue puts it, and leaves #1658’s shade and the foot’s band as they were', () => {
    const { fragment } = compiled();
    const cladding = fragment.indexOf('// 1. The cladding.');
    const weather = fragment.indexOf('// #1661: the weathering.');
    const openings = fragment.indexOf('// 2. The openings.');
    const shade = fragment.indexOf('// 3. The shade');
    expect(cladding).toBeGreaterThan(-1);
    // Under the openings, after every cladding branch: the glass is never grimed.
    expect(weather).toBeGreaterThan(cladding);
    expect(weather).toBeLessThan(openings);
    expect(fragment).toContain(
      'diffuseColor.rgb *= oylWeatherTile(oylPlane.x, oylPlane.y, oylWpw);',
    );
    expect(fragment).toContain('oylWeatherCourses(vOylFacade.y, oylAge)');
    expect(fragment).toContain(
      'oylWeatherMoss(oylPlane.x, oylPlane.y, oylUpFacing, oylAge, oylWpw)',
    );
    expect(fragment).toContain('oylWeatherSplash(oylUp, oylPlane.x, oylAge, oylWpw)');
    expect(fragment).toContain('float oylAge = oylWeatherAgeOf(vOylTint);');
    // A sill's streak in both window branches, after the window is drawn.
    const streaks = [...fragment.matchAll(/oylWeatherStreak\(\n/g)].map((m) => m.index);
    expect(streaks).toHaveLength(2);
    for (const each of streaks) {
      expect(each).toBeGreaterThan(openings);
      expect(each).toBeLessThan(shade);
    }
    // The drip after the shade, on a flat roof's wall.
    const drip = fragment.indexOf('oylWeatherDrip((oylTop - vOylFacade.y) * oylStoreyM');
    expect(drip).toBeGreaterThan(shade);
    expect(fragment).toContain('oylFlag(oylFlags, oylFlatRoofFlag)');
    // #1658's band and the foot's band, untouched.
    expect(fragment).toContain(
      'float oylAtFoot = 1.0 - smoothstep(0.0, oylAoBaseM, vOylFacade.y * oylStoreyM);',
    );
    expect(fragment).toContain(
      'diffuseColor.rgb *= oylEavesShade * (1.0 - (1.0 - oylAoBase) * oylAtFoot);',
    );
    expect(fragment.split('vec3 oylSunF = ').length - 1).toBe(1);
  });

  it('lays each building’s photograph by its tint in the vertex shader, the map and its relief alike', () => {
    const { vertex } = compiled();
    expect(vertex).toContain('vMapUv = vMapUv * oylPhotoTurn + oylPhotoShift;');
    expect(vertex).toContain('vNormalMapUv = vNormalMapUv * oylPhotoTurn + oylPhotoShift;');
    // After three's coordinates are made, and after the tint is decoded.
    const laid = vertex.indexOf('vMapUv = vMapUv * oylPhotoTurn');
    expect(laid).toBeGreaterThan(vertex.indexOf('#include <uv_vertex>'));
    expect(laid).toBeGreaterThan(vertex.indexOf('vOylTint = oylTintOf(oylTint);'));
    const run = shaderFunctions(vertex, ['oylPhotoTurnOf', 'oylPhotoShiftUOf', 'oylPhotoShiftVOf']);
    for (const tint of [
      [0.01, -0.03, 0.02],
      [-0.05, 0.04, -0.01],
      [0, 0, 0],
    ] as const) {
      const twin = photographShiftOf(tint);
      const t = { x: tint[0], y: tint[1], z: tint[2] };
      expect(run.oylPhotoTurnOf?.(t)).toBe(twin.turn);
      expect(run.oylPhotoShiftUOf?.(t)).toBe(twin.shift[0]);
      expect(run.oylPhotoShiftVOf?.(t)).toBe(twin.shift[1]);
    }
  });

  it('lays two neighbours’ brick differently, read from the tint the GPU receives', () => {
    const belt = aBelt();
    const { vertex } = compiled();
    const decode = glslFunction(vertex, 'oylTintOf');
    const run = shaderFunctions(vertex, ['oylPhotoTurnOf', 'oylPhotoShiftUOf', 'oylPhotoShiftVOf']);
    interface Laid {
      readonly x: number;
      readonly z: number;
      readonly laid: string;
    }
    const laidOf = new Map<number, Laid>();
    // Refilled along the town, so that every brick building on its street is drawn somewhere.
    for (let along = 600; along <= 2_400; along += 150) {
      const road = drawnRoadFrame(town.profile, town.origin, along);
      if (road === undefined) continue;
      belt.refill(road.x, road.z, Number.MAX_SAFE_INTEGER);
      const tints = belt.mesh.geometry.getAttribute('oylTint');
      for (let place = 0; ; place += 1) {
        const drawn = belt.drawnAt(place);
        if (drawn === undefined) break;
        const plan = plans[drawn.plan] as FootprintPlan;
        if (plan.surfaces.wall !== 'brick') continue;
        // The tint as the vertex buffer holds it, decoded as the shader decodes it.
        const decoded = decode(tints.getX(drawn.wallAt));
        if (typeof decoded === 'number') throw new Error('oylTintOf returned a float');
        const t = { x: decoded[0], y: decoded[1], z: decoded[2] };
        const laid = [run.oylPhotoTurnOf?.(t), run.oylPhotoShiftUOf?.(t), run.oylPhotoShiftVOf?.(t)]
          .map((each) => (each ?? Number.NaN).toFixed(4))
          .join('/');
        laidOf.set(drawn.plan, { x: plan.centroid.x, z: plan.centroid.z, laid });
      }
    }
    const brick = [...laidOf.values()];
    expect(brick.length).toBeGreaterThan(8);
    // The two nearest neighbours wearing the brick photograph.
    let pair: readonly [Laid, Laid] | undefined;
    let apart = Number.POSITIVE_INFINITY;
    for (const a of brick) {
      for (const b of brick) {
        const d = Math.hypot(a.x - b.x, a.z - b.z);
        if (a !== b && d < apart) {
          apart = d;
          pair = [a, b];
        }
      }
    }
    if (pair === undefined) throw new Error('no two brick buildings');
    expect(apart).toBeLessThan(40);
    expect(pair[0].laid).not.toBe(pair[1].laid);
    // And across the street, nearly every one its own.
    expect(new Set(brick.map((each) => each.laid)).size).toBeGreaterThan(brick.length * 0.8);
  });

  it('fetches the wall’s photograph once, as main does, with the weathering and without it', () => {
    const fetches = (fragment: string): number =>
      resolved(fragment).match(/texture2D\(\s*map\s*,/g)?.length ?? 0;
    const on = compiled();
    weatheringOf({} as never, false);
    const off = compiled();
    expect(fetches(off.fragment)).toBe(1);
    expect(fetches(on.fragment)).toBe(fetches(off.fragment));
    // No texture of any kind is added.
    const any = (fragment: string): number =>
      resolved(fragment).match(/\btexture(?:2D|Cube)?\s*\(/g)?.length ?? 0;
    expect(any(on.fragment)).toBe(any(off.fragment));
  });
});

describe('the owner’s lever — #1661', () => {
  it('builds both programs without the term with `-weathering`, and with it otherwise', () => {
    const on = compiled();
    expect(on.fragment).toContain('float oylWeatherSplash(');
    expect(on.fragment).toContain('// #1661: the weathering.');
    expect(on.vertex).toContain('vOylWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    expect(on.vertex).toContain('vMapUv = vMapUv * oylPhotoTurn + oylPhotoShift;');
    weatheringOf({} as never, false);
    const off = compiled();
    for (const source of [off.fragment, off.vertex]) {
      expect(source).not.toContain('oylWeather');
      expect(source).not.toContain('vOylWorld');
      expect(source).not.toContain('oylPhoto');
    }
    // A different program, so three compiles it rather than reusing the product's.
    expect(on.defines).toMatchObject({ OYL_WEATHERING: 1 });
    expect(off.defines).toMatchObject({ OYL_WEATHERING: 0 });
    // And the other facade levers are not this one's.
    expect(off.fragment).toContain('float oylOverhangShadow(');
    expect(off.fragment).toContain('vec2 oylShift = oylRecess * e.xy / max(e.z, oylGraze);');
    weatheringOf({} as never, true);
    expect(compiled().fragment).toContain('float oylWeatherSplash(');
  });

  it('leaves the weathering built with #1658’s and #1659’s levers off', () => {
    overhangShadowsOf({} as never, false);
    windowRevealsOf({} as never, false);
    const { fragment, defines } = compiled();
    expect(fragment).toContain('// #1661: the weathering.');
    expect(defines).toMatchObject({ OYL_WEATHERING: 1, OYL_OVERHANG_SHADOWS: 0 });
  });
});
