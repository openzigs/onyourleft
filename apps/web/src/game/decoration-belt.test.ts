// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #1624's renderer half: `three-renderer.ts` §`DecorationBelt` draws every
 * item on every village in reach as ONE mesh in one material, rebuilt only
 * when the set of villages in reach changes, with the glow spliced into the
 * same program and nothing about it changing from frame to frame.
 *
 * What jsdom cannot do — draw, and read a colour back — the browser gate
 * does: `decoration.browser.spec.ts` (the glow under a light turned away,
 * two frames a second apart, `renderer.info.render.calls` with and without
 * the belt) and `realistic-town.browser.spec.ts` (the owner's page, one call).
 */

import { describe, expect, it } from 'vitest';

import {
  ANCHOR_KINDS,
  decorationsFor,
  HOLIDAY_DECORATIONS,
  type DecorationKind,
  type ItemTable,
} from './decorations';
import { REALISTIC_DECORATION_TRIANGLES } from './realistic-budget';
import { plannerCornerRoute } from './route-fixtures-testing';
import { FURNITURE_DRAW_METRES, streetsAt, type VillageStreet } from './streets';
import { corridorOrigin } from './terrain';
import { PEAK_IRRADIANCE } from './world';
import {
  DECORATION_GLOW_ATTRIBUTE,
  DECORATION_PART_TRIANGLES,
  DecorationBelt,
  decorationGeometry,
  decorationKindTriangles,
  decorationShapeTriangles,
} from './three-renderer';

/**
 * Two villages either side of a 150° corner, 111 m apart at their nearest —
 * found by searching seeds. On a straight road two villages are hardly ever
 * both in reach: `settlements.ts` §`siteAt` keeps a site's middle in the
 * middle 40 % of its 700 m, so two neighbours' streets are at least about
 * 224 m apart, against twice `FURNITURE_DRAW_METRES`' 120 — and no straight
 * fixture searched had a pair under 340 m. Where the road folds back, they are.
 */
const CORNER = plannerCornerRoute(150);
const STREETS = streetsAt(CORNER, corridorOrigin(CORNER), 2, 0, CORNER.totalDistance);

const PROBE: DecorationKind = {
  item: 'probe',
  anchors: ANCHOR_KINDS,
  chance: 1,
  radius: 0.15,
  parts: [
    { size: [0.3, 0.3, 0.3], at: [0, 0.15, 0], colour: 0xe07a1f, glows: false },
    { size: [0.1, 0.1, 0.1], at: [0, 0.4, 0], colour: 0xffd27a, glows: true },
  ],
};
const TABLE: ItemTable = { halloween: [PROBE] };

/** Whether a village is in reach of a point, as the belt decides it. */
function inReach(street: VillageStreet, at: { x: number; z: number }): boolean {
  return street.anchors.some(
    (anchor) => Math.hypot(anchor.x - at.x, anchor.z - at.z) <= FURNITURE_DRAW_METRES,
  );
}

/** A camera with exactly the villages `want` in reach — searched for, along the fixture's road. */
function cameraWith(want: number): { x: number; z: number } {
  for (const street of STREETS) {
    for (const anchor of street.anchors) {
      for (const lateral of [0, 20, -20]) {
        for (const along of [-150, -100, -50, 0, 50, 100, 150]) {
          const at = { x: anchor.x + lateral, z: anchor.z + along };
          if (STREETS.filter((each) => inReach(each, at)).length === want) return at;
        }
      }
    }
  }
  throw new Error(`no camera on the fixture has ${String(want)} villages in reach`);
}

describe('the decoration belt — #1624', () => {
  it('draws two villages’ items as ONE mesh, in one material', () => {
    const camera = cameraWith(2);
    const reached = STREETS.filter((street) => inReach(street, camera));
    expect(reached).toHaveLength(2);
    const anchors = reached.reduce((sum, street) => sum + street.anchors.length, 0);
    for (const world of ['stylised', 'realistic'] as const) {
      const belt = new DecorationBelt(world);
      belt.update(STREETS, camera, 'halloween', TABLE);
      expect(belt.mesh.visible).toBe(true);
      // One material, no groups: one draw call whatever it holds.
      expect(Array.isArray(belt.mesh.material)).toBe(false);
      expect(belt.mesh.geometry.groups).toEqual([]);
      expect(belt.triangles).toBe(anchors * PROBE.parts.length * DECORATION_PART_TRIANGLES);
      belt.dispose();
    }
  });

  it('is the same triangles in both worlds', () => {
    const camera = cameraWith(1);
    const stylised = new DecorationBelt('stylised');
    const realistic = new DecorationBelt('realistic');
    stylised.update(STREETS, camera, 'halloween', TABLE);
    realistic.update(STREETS, camera, 'halloween', TABLE);
    expect(stylised.triangles).toBeGreaterThan(0);
    expect(Array.from(realistic.mesh.geometry.getAttribute('position').array)).toEqual(
      Array.from(stylised.mesh.geometry.getAttribute('position').array),
    );
  });

  it('uploads nothing while the same villages are in reach, and rebuilds once when one comes into reach', () => {
    const camera = cameraWith(1);
    const belt = new DecorationBelt('stylised');
    belt.update(STREETS, camera, 'halloween', TABLE);
    const geometry = belt.mesh.geometry;
    const rebuilds = belt.rebuilds;
    const versions = (geometry.getAttribute('position') as { version: number }).version;
    // 100 frames riding forward a centimetre a frame, the same village in reach.
    for (let frame = 1; frame <= 100; frame += 1) {
      const at = { x: camera.x, z: camera.z + frame * 0.01 };
      expect(STREETS.filter((street) => inReach(street, at))).toHaveLength(1);
      belt.update(STREETS, at, 'halloween', TABLE);
    }
    expect(belt.rebuilds).toBe(rebuilds);
    expect(belt.mesh.geometry).toBe(geometry);
    expect((geometry.getAttribute('position') as { version: number }).version).toBe(versions);
    // A second village comes into reach: one rebuild, and then none again.
    const both = cameraWith(2);
    belt.update(STREETS, both, 'halloween', TABLE);
    expect(belt.rebuilds).toBe(rebuilds + 1);
    belt.update(STREETS, both, 'halloween', TABLE);
    expect(belt.rebuilds).toBe(rebuilds + 1);
  });

  it('is not drawn with no holiday, with the world hidden, or out of every village’s reach', () => {
    const camera = cameraWith(1);
    const belt = new DecorationBelt('stylised');
    belt.update(STREETS, camera, undefined, TABLE);
    expect(belt.mesh.visible).toBe(false);
    expect(belt.triangles).toBe(0);
    belt.update(STREETS, camera, 'halloween', TABLE);
    expect(belt.mesh.visible).toBe(true);
    // A holiday the table names nothing for.
    belt.update(STREETS, camera, 'winter-lights', TABLE);
    expect(belt.mesh.visible).toBe(false);
    belt.update(STREETS, camera, 'halloween', TABLE);
    belt.setShown(false);
    expect(belt.mesh.visible).toBe(false);
    belt.update(STREETS, camera, 'halloween', TABLE);
    expect(belt.mesh.visible).toBe(false);
    belt.setShown(true);
    belt.update(STREETS, { x: 1e6, z: 1e6 }, 'halloween', TABLE);
    expect(belt.mesh.visible).toBe(false);
  });

  it('marks the glowing parts’ vertices, and only theirs', () => {
    const camera = cameraWith(1);
    const belt = new DecorationBelt('stylised');
    belt.update(STREETS, camera, 'halloween', TABLE);
    const glow = Array.from(belt.mesh.geometry.getAttribute(DECORATION_GLOW_ATTRIBUTE).array);
    const perItem = PROBE.parts.length * DECORATION_PART_TRIANGLES * 3;
    expect(glow.length % perItem).toBe(0);
    for (let at = 0; at < glow.length; at += 1) {
      // Each item's first box is lit and its second glows.
      expect(glow[at]).toBe(at % perItem < DECORATION_PART_TRIANGLES * 3 ? 0 : 1);
    }
  });

  it('places no item past REALISTIC_DECORATION_TRIANGLES, and only whole items', () => {
    const heavy: DecorationKind = {
      ...PROBE,
      parts: Array.from({ length: 100 }, () => PROBE.parts[0] as DecorationKind['parts'][number]),
    };
    const camera = cameraWith(2);
    const belt = new DecorationBelt('stylised');
    belt.update(STREETS, camera, 'halloween', { halloween: [heavy] });
    const perItem = heavy.parts.length * DECORATION_PART_TRIANGLES;
    expect(belt.triangles).toBeGreaterThan(REALISTIC_DECORATION_TRIANGLES - perItem);
    expect(belt.triangles).toBeLessThanOrEqual(REALISTIC_DECORATION_TRIANGLES);
    expect(belt.triangles % perItem).toBe(0);
    // An item whose kind the table does not hold is not drawn at all.
    expect(decorationGeometry([], [PROBE]).getAttribute('position').count).toBe(0);
  });
});

describe('the belt’s Halloween set — #1625', () => {
  const halloween = HOLIDAY_DECORATIONS.halloween ?? [];

  it('builds each shape from its own triangles: a pumpkin 96, a stalk 10, a face 2', () => {
    expect(decorationShapeTriangles('box')).toBe(DECORATION_PART_TRIANGLES);
    expect(decorationShapeTriangles('pumpkin')).toBe(96);
    expect(decorationShapeTriangles('stalk')).toBe(10);
    expect(decorationShapeTriangles('face')).toBe(2);
    // A pumpkin and its stalk inside the issue's 80 to 140; a face adds 6.
    const plain = halloween.find((kind) => kind.item === 'pumpkin');
    const jack = halloween.find((kind) => kind.item === 'jack-o-lantern');
    if (plain === undefined || jack === undefined) throw new Error('no Halloween kinds');
    expect(decorationKindTriangles(plain)).toBe(106);
    expect(decorationKindTriangles(jack) - decorationKindTriangles(plain)).toBe(6);
  });

  it('stands each item on its base, its pumpkins’ feet exactly there', () => {
    const camera = cameraWith(2);
    const belt = new DecorationBelt('stylised');
    belt.update(STREETS, camera, 'halloween', HOLIDAY_DECORATIONS);
    expect(belt.triangles).toBeGreaterThan(0);
    // The belt's vertices, every one at or above some item's base, and the
    // lowest of all at the lowest base.
    const items = decorationsFor(
      STREETS.filter((street) => inReach(street, camera)),
      'halloween',
      HOLIDAY_DECORATIONS,
    );
    const position = belt.mesh.geometry.getAttribute('position');
    let lowest = Number.POSITIVE_INFINITY;
    for (let at = 0; at < position.count; at += 1) lowest = Math.min(lowest, position.getY(at));
    expect(lowest).toBeCloseTo(Math.min(...items.map((item) => item.base)), 4);
    // One item alone: its geometry's foot is its base, and not its anchor's
    // height, which is the front path's end, below the step.
    const one = items.find((item) => Math.abs(item.base - item.anchor.y) > 0.05);
    if (one === undefined) throw new Error('no item whose step stands off its path');
    const alone = decorationGeometry([one], halloween).getAttribute('position');
    let foot = Number.POSITIVE_INFINITY;
    for (let at = 0; at < alone.count; at += 1) foot = Math.min(foot, alone.getY(at));
    expect(foot).toBeCloseTo(one.base, 4);
    belt.dispose();
  });

  it('stays under REALISTIC_DECORATION_TRIANGLES with two villages in reach, at its heaviest on every house', () => {
    const camera = cameraWith(2);
    const reached = STREETS.filter((street) => inReach(street, camera));
    const belt = new DecorationBelt('realistic');
    belt.update(STREETS, camera, 'halloween', HOLIDAY_DECORATIONS);
    const items = decorationsFor(reached, 'halloween', HOLIDAY_DECORATIONS);
    const wanted = items.reduce((sum, item) => {
      const kind = halloween.find((each) => each.item === item.item);
      return sum + (kind === undefined ? 0 : decorationKindTriangles(kind));
    }, 0);
    // Every item drawn — none dropped at the ceiling — and under it.
    expect(belt.triangles).toBe(wanted);
    expect(belt.triangles).toBeGreaterThan(0);
    expect(belt.triangles).toBeLessThan(REALISTIC_DECORATION_TRIANGLES);
    // The worst a draw could do: the heaviest arrangement on every house step in reach.
    const houses = reached
      .flatMap((street) => street.anchors)
      .filter((anchor) => anchor.step?.building === 'building').length;
    const heaviest = Math.max(...halloween.map((kind) => decorationKindTriangles(kind)));
    expect(houses).toBeGreaterThan(5);
    expect(houses * heaviest).toBeLessThan(REALISTIC_DECORATION_TRIANGLES);
    belt.dispose();
  });
});

/** A material as the belt holds it: what the suite calls on it. @see compiled */
interface Compilable {
  onBeforeCompile(shader: unknown, renderer: unknown): void;
  customProgramCacheKey(): string;
  readonly version: number;
}

/**
 * Runs a material's `onBeforeCompile` over a shader holding every chunk the
 * belt's splices and the realistic air's look for, as the renderer would —
 * the shape `road-wear.test.ts` uses, since nothing here may import three.
 */
function compiled(material: Compilable): {
  readonly vertexShader: string;
  readonly fragmentShader: string;
  readonly uniforms: Record<string, { value: unknown }>;
} {
  const shader = {
    vertexShader: [
      '#include <common>',
      '#include <fog_pars_vertex>',
      'void main() {',
      '#include <color_vertex>',
      '#include <fog_vertex>',
      '}',
    ].join('\n'),
    fragmentShader: [
      '#include <common>',
      '#include <fog_pars_fragment>',
      'void main() {',
      '#include <opaque_fragment>',
      '#include <fog_fragment>',
      '}',
    ].join('\n'),
    uniforms: {} as Record<string, { value: unknown }>,
    defines: {},
  };
  material.onBeforeCompile(shader, undefined);
  return shader;
}

describe('the decorations’ glow — #1624', () => {
  for (const world of ['stylised', 'realistic'] as const) {
    it(`is spliced into the ${world} world’s lit program, and adds no uniform that could change it`, () => {
      const belt = new DecorationBelt(world);
      const material = belt.mesh.material as unknown as Compilable;
      const shader = compiled(material);
      expect(shader.vertexShader).toContain(`attribute float ${DECORATION_GLOW_ATTRIBUTE};`);
      expect(shader.vertexShader).toContain(`vOylGlow = ${DECORATION_GLOW_ATTRIBUTE};`);
      // After the lit colour is written out, so it overrides the lighting.
      const fragment = shader.fragmentShader;
      const glow = fragment.indexOf(
        'gl_FragColor.rgb = mix(gl_FragColor.rgb, diffuseColor.rgb, vOylGlow);',
      );
      expect(glow).toBeGreaterThan(fragment.indexOf('#include <opaque_fragment>'));
      // Steady (WCAG 2.3.1): the glow brings no uniform at all — no time, no
      // pulse. The realistic world's material brings only its air's, which
      // `withAtmosphere` adds to every realistic material and nothing animates
      // per material.
      const added = Object.keys(shader.uniforms);
      if (world === 'stylised') expect(added).toEqual([]);
      else for (const name of added) expect(name, name).toMatch(/^oyl(Fog|Sky|Valley)/);
      expect(material.customProgramCacheKey()).toContain('oyl-decoration-glow');
    });
  }

  it('changes nothing about its material from frame to frame', () => {
    const camera = cameraWith(1);
    const belt = new DecorationBelt('stylised');
    const material = belt.mesh.material as unknown as Compilable;
    belt.update(STREETS, camera, 'halloween', TABLE);
    const version = material.version;
    for (let frame = 0; frame < 100; frame += 1) belt.update(STREETS, camera, 'halloween', TABLE);
    expect(belt.mesh.material).toBe(material);
    expect(material.version).toBe(version);
  });
});

/** sRGB to linear, as `three-renderer.test.ts` §`toLinear` restates three's — this file may not import three. */
function toLinear(channel: number): number {
  const proportion = channel / 255;
  return proportion < 0.04045
    ? proportion * 0.0773993808
    : Math.pow(proportion * 0.9478672986 + 0.0521327014, 2.4);
}

describe('the decorations and “lights no colour past white” — #1624', () => {
  it('holds every LIT part to it, and leaves the glowing parts out of it', () => {
    // `three-renderer.test.ts` §"lights no colour past white" sweeps the
    // product's style tables, which the decorations are not in. Their lit
    // parts are held to the same bound here; a GLOWING part is excluded by
    // design — it leaves the lighting with its own colour, so the sun's
    // `PEAK_IRRADIANCE` never multiplies it, and an sRGB colour is never past
    // white. The product's table is empty until #1625 to #1627, so the probe
    // is swept too, so the sweep is not vacuous.
    const kinds = [...Object.values(HOLIDAY_DECORATIONS).flatMap((each) => each ?? []), PROBE];
    const lit = kinds.flatMap((kind) => kind.parts.filter((part) => !part.glows));
    expect(lit.length).toBeGreaterThan(0);
    for (const part of lit) {
      for (const shift of [16, 8, 0]) {
        expect(toLinear((part.colour >> shift) & 0xff) * PEAK_IRRADIANCE).toBeLessThanOrEqual(1);
      }
    }
  });
});
