// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2685, round two, as the renderer draws it: the headstones, walls and flags
 * in ONE instanced call (`three-renderer.ts` §`ParkDressingBelt`), inside
 * `realistic-budget.ts` §`REALISTIC_PARK_DRESSING_TRIANGLES`, and the golf
 * courses' and cemeteries' ground painted by the photographic ground's own
 * shader from the window `park-dressing.ts` builds (§`ParkGroundPaint`,
 * §`PARK_GROUND_MIX`). Read off what three is handed: the instance buffers,
 * the texture's bytes and the program's text, whose path rule is evaluated
 * against `park-dressing.ts`' twin. This suite may not import three (the
 * seam, `three-seam.test.ts`), so a matrix is read as its sixteen numbers.
 */

import { describe, expect, it } from 'vitest';

import { glslFunction } from './glsl-testing';
import {
  GOLF_BUNKERS_PER_GREEN,
  HEADSTONE_CROSS_PATH_SLOTS,
  HEADSTONE_CROSS_SLOTS,
  HEADSTONE_PATH_ROWS,
  HEADSTONE_PATH_WIDTH_METRES,
  HEADSTONE_PITCH_METRES,
  HEADSTONE_ROW_METRES,
  isCrossPathSlot,
  isPathRow,
  PARK_DRESSING_CAPACITY,
  PARK_LOOK_CELLS,
  type ParkGround,
  type ParkPiece,
} from './park-dressing';
import { REALISTIC_PARK_DRESSING_TRIANGLES } from './realistic-budget';
import {
  GOLF_APPROACH_METRES,
  GOLF_FAIRWAY_PERIOD_METRES,
  GOLF_FAIRWAY_WIDTH_METRES,
  PARK_DRESSING_TRIANGLES,
  PARK_GROUND_LOOK,
  PARK_GROUND_MIX,
  PARK_PIECE_TRIANGLES,
  ParkDressingBelt,
  ParkGroundPaint,
  parkPieceGeometry,
  photographicGroundMaterial,
} from './three-renderer';

const PIECE: ParkPiece = {
  kind: 'headstone',
  x: 12,
  y: 3,
  z: -40,
  lift: -0.15,
  yaw: 0.6,
  width: 0.7,
  height: 1.1,
  depth: 0.18,
  colour: 0x9a9a96,
};

/** sRGB to linear, as `three-renderer.test.ts` §`toLinear` restates three's. */
function toLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

describe('#2685 the park dressing belt', () => {
  it('draws each piece as a box of 10 triangles, its worst frame inside the budget', () => {
    const geometry = parkPieceGeometry();
    expect((geometry.getIndex()?.count ?? 0) / 3).toBe(PARK_PIECE_TRIANGLES);
    expect(PARK_DRESSING_TRIANGLES).toBe(PARK_DRESSING_CAPACITY * PARK_PIECE_TRIANGLES);
    expect(PARK_DRESSING_TRIANGLES).toBeLessThanOrEqual(REALISTIC_PARK_DRESSING_TRIANGLES);
    // Its base at 0 and its top at 1: a piece stands ON the ground it is given.
    const position = geometry.getAttribute('position');
    let low = Infinity;
    let high = -Infinity;
    for (let index = 0; index < position.count; index += 1) {
      low = Math.min(low, position.getY(index));
      high = Math.max(high, position.getY(index));
    }
    expect([low, high]).toEqual([0, 1]);
    const belt = new ParkDressingBelt();
    expect(belt.mesh.geometry.getIndex()?.count).toBe(PARK_PIECE_TRIANGLES * 3);
    expect(belt.mesh.instanceMatrix.count).toBe(PARK_DRESSING_CAPACITY);
  });

  it('writes each piece where it stands, turned, sized and coloured, and hides with none', () => {
    const belt = new ParkDressingBelt();
    expect(belt.mesh.visible).toBe(false);
    belt.update([PIECE]);
    expect(belt.mesh.count).toBe(1);
    expect(belt.mesh.visible).toBe(true);
    const m = [...belt.mesh.instanceMatrix.array.slice(0, 16)];
    const cos = Math.cos(PIECE.yaw);
    const sin = Math.sin(PIECE.yaw);
    const expected = [
      cos * PIECE.width,
      0,
      -sin * PIECE.width,
      0,
      0,
      PIECE.height,
      0,
      0,
      sin * PIECE.depth,
      0,
      cos * PIECE.depth,
      0,
      PIECE.x,
      PIECE.y + PIECE.lift,
      PIECE.z,
      1,
    ];
    m.forEach((value, index) => {
      expect(value).toBeCloseTo(expected[index] as number, 5);
    });
    const colour = [...(belt.mesh.instanceColor?.array.slice(0, 3) ?? [])];
    [0x9a, 0x9a, 0x96].forEach((channel, index) => {
      expect(colour[index]).toBeCloseTo(toLinear(channel), 5);
    });
    // The same pieces again are not written again; none hides it.
    const version = belt.mesh.instanceMatrix.version;
    const same = [PIECE];
    belt.update(same);
    const written = belt.mesh.instanceMatrix.version;
    expect(written).toBeGreaterThan(version);
    belt.update(same);
    expect(belt.mesh.instanceMatrix.version).toBe(written);
    belt.update([]);
    expect(belt.mesh.visible).toBe(false);
    expect(belt.mesh.count).toBe(0);
  });

  it('draws no more than its capacity', () => {
    const belt = new ParkDressingBelt();
    belt.update(Array.from({ length: PARK_DRESSING_CAPACITY + 40 }, () => PIECE));
    expect(belt.mesh.count).toBe(PARK_DRESSING_CAPACITY);
  });
});

/** The ground's material, and its shader as `onBeforeCompile` leaves the chunks it edits. */
function compiledGround(paint: ParkGroundPaint | undefined): {
  fragmentShader: string;
  uniforms: Record<string, { value: unknown }>;
} {
  const texture = paint === undefined ? new ParkGroundPaint() : paint;
  const map = texture.uniforms.oylParkLooks.value;
  const material = photographicGroundMaterial(
    map,
    map,
    { value: 90 },
    { value: 1 },
    {
      verge: { colour: map, normal: map },
      rock: { colour: map, normal: map },
      crag: { colour: map, normal: map },
      treeLine: { value: 100 },
      ...(paint === undefined ? {} : { park: paint.uniforms }),
    },
  );
  const shader = {
    vertexShader: [
      '#include <common>',
      '#include <fog_pars_vertex>',
      'void main() {',
      '#include <begin_vertex>',
      '#include <uv_vertex>',
      '#include <fog_vertex>',
      '}',
    ].join('\n'),
    fragmentShader: [
      '#include <common>',
      '#include <normalmap_pars_fragment>',
      '#include <fog_pars_fragment>',
      'void main() {',
      '#include <map_fragment>',
      '#include <color_fragment>',
      '#include <alphamap_fragment>',
      '#include <normal_fragment_maps>',
      '#include <fog_fragment>',
      '}',
    ].join('\n'),
    uniforms: {} as Record<string, { value: unknown }>,
    defines: {},
  };
  (material.onBeforeCompile as (s: typeof shader) => void)(shader);
  return shader;
}

const GROUND: ParkGround = {
  originX: -400,
  originZ: 1_000,
  cellMetres: 5,
  cells: PARK_LOOK_CELLS,
  looks: Uint8Array.from({ length: PARK_LOOK_CELLS * PARK_LOOK_CELLS * 4 }, (_, at) =>
    at % 4 === 0 ? 255 : 0,
  ),
  greens: [
    {
      x: 30,
      z: 1_200,
      radius: 13,
      bunkers: [
        { x: 50, z: 1_200, radius: 3 },
        { x: 30, z: 1_220, radius: 4 },
      ],
      pinX: 31,
      pinZ: 1_201,
      flagColour: 0xd8332b,
    },
  ],
};

describe('#2685 the golf courses’ and cemeteries’ ground', () => {
  it('hands the window, the greens and their bunkers to the ground’s program, and none with none', () => {
    const paint = new ParkGroundPaint();
    const shader = compiledGround(paint);
    expect(shader.fragmentShader).toContain(PARK_GROUND_MIX);
    // Painted after the verge and rock, before alpha: over the blended grass.
    const mix = shader.fragmentShader.indexOf('vec2 oylAt = vOylGround.xz;');
    expect(mix).toBeGreaterThan(shader.fragmentShader.indexOf('float oylOther = oylVergeShare'));
    expect(shader.uniforms['oylParkWindow']).toBe(paint.uniforms.oylParkWindow);
    expect(shader.uniforms['oylGreens']).toBe(paint.uniforms.oylGreens);
    expect(shader.uniforms['oylBunkers']).toBe(paint.uniforms.oylBunkers);
    expect(shader.uniforms['oylParkLooks']).toBe(paint.uniforms.oylParkLooks);

    paint.write(GROUND);
    const window = paint.uniforms.oylParkWindow.value;
    expect([window.x, window.y, window.z, window.w]).toEqual([-400, 1_000, 1 / 800, 1]);
    const texture = paint.uniforms.oylParkLooks.value as unknown as {
      image: { data: Uint8Array };
      version: number;
    };
    expect(texture.image.data).toEqual(GROUND.looks);
    const green = paint.uniforms.oylGreens.value[0];
    expect([green?.x, green?.y, green?.z, green?.w]).toEqual([30, 1_200, 13, 1]);
    expect(paint.uniforms.oylGreens.value[1]?.w).toBe(0);
    const bunkers = paint.uniforms.oylBunkers.value;
    expect([bunkers[0]?.x, bunkers[0]?.y, bunkers[0]?.z]).toEqual([50, 1_200, 3]);
    expect([bunkers[1]?.x, bunkers[1]?.y, bunkers[1]?.z]).toEqual([30, 1_220, 4]);
    expect(bunkers[GOLF_BUNKERS_PER_GREEN]?.z).toBe(0);
    // The same window again uploads nothing; none switches the paint off.
    const version = texture.version;
    paint.write(GROUND);
    expect(texture.version).toBe(version);
    paint.write(undefined);
    expect(window.w).toBe(0);
    // A ground built with no paint reads a window that is never drawn.
    const bare = compiledGround(undefined);
    expect((bare.uniforms['oylParkWindow']?.value as { w: number }).w).toBe(0);
  });

  it('draws the cemetery’s narrow paths only where park-dressing.ts leaves its rows and slots empty', () => {
    const shader = compiledGround(new ParkGroundPaint());
    const band = glslFunction(shader.fragmentShader, 'oylParkBand');
    // Each call site's own numbers, read off the program three is handed.
    const call = (axis: 'x' | 'y'): readonly [number, number, number] => {
      const found = new RegExp(
        `oylParkBand\\(mod\\(oylAt\\.${axis}, ([\\d.]+)\\), ([\\d.]+), ([\\d.]+), oylPathAa\\.${axis}\\)`,
      ).exec(shader.fragmentShader);
      if (found === null) throw new Error(`no path band along ${axis}`);
      return [Number(found[1]), Number(found[2]), Number(found[3])];
    };
    const drawnAt = (at: number, [period, from, to]: readonly [number, number, number]): number =>
      band(((at % period) + period) % period, from, to, 0.01) as number;
    // Across a stretch of rows and of slots, a centimetre at a time: the
    // path is drawn only inside a row or slot park-dressing.ts leaves empty
    // of stones, and is the path's width each time, down its middle.
    const walk = (
      [period, from, to]: readonly [number, number, number],
      pitch: number,
      empty: (index: number) => boolean,
    ): number => {
      let widths = 0;
      let drawn = 0;
      for (let at = -3 * period; at < 3 * period; at += 0.01) {
        if (drawnAt(at, [period, from, to]) < 0.5) {
          if (drawn > 0) {
            expect(drawn * 0.01).toBeCloseTo(HEADSTONE_PATH_WIDTH_METRES, 1);
            widths += 1;
          }
          drawn = 0;
          continue;
        }
        expect(empty(Math.floor(at / pitch)), `at ${at.toFixed(2)}`).toBe(true);
        drawn += 1;
      }
      return widths;
    };
    const rows = call('x');
    const slots = call('y');
    expect(walk(rows, HEADSTONE_ROW_METRES, isPathRow)).toBeGreaterThanOrEqual(5);
    expect(walk(slots, HEADSTONE_PITCH_METRES, isCrossPathSlot)).toBeGreaterThanOrEqual(5);
    // Down the middle of the row and of the pair of slots.
    expect((rows[1] + rows[2]) / 2).toBeCloseTo(
      (HEADSTONE_PATH_ROWS - 0.5) * HEADSTONE_ROW_METRES,
      9,
    );
    expect((slots[1] + slots[2]) / 2).toBeCloseTo(
      (HEADSTONE_CROSS_SLOTS - HEADSTONE_CROSS_PATH_SLOTS / 2) * HEADSTONE_PITCH_METRES,
      9,
    );
    expect(rows[0]).toBeCloseTo(HEADSTONE_PATH_ROWS * HEADSTONE_ROW_METRES, 9);
    expect(slots[0]).toBeCloseTo(HEADSTONE_CROSS_SLOTS * HEADSTONE_PITCH_METRES, 9);
  });

  it('lays the cemetery’s paths only where the window’s alpha clears them of the road, toned toward the grass', () => {
    const program = compiledGround(new ParkGroundPaint()).fragmentShader;
    // The paths' share is the bands, times the window's alpha, times the tone.
    const share = /float oylPath = max\(oylRowPath, oylCrossPath\) \* oylLook\.a \* ([\d.]+);/.exec(
      program,
    );
    expect(share).not.toBeNull();
    expect(Number(share?.[1])).toBeCloseTo(PARK_GROUND_LOOK.path, 9);
    expect(PARK_GROUND_LOOK.path).toBeLessThan(1);
    expect(program).toMatch(/oylKept = mix\([^;]*, oylPath\);/);
  });

  it('stripes a course’s fairways in lanes with rough between, and fairway round every green', () => {
    const program = compiledGround(new ParkGroundPaint()).fragmentShader;
    const band = glslFunction(program, 'oylParkBand');
    const lane =
      /float oylFairway = oylParkBand\(mod\(oylLaneAt, ([\d.]+)\), ([\d.]+), ([\d.]+), oylLaneAa\);/.exec(
        program,
      );
    if (lane === null) throw new Error('no fairway lane');
    const [period, from, to] = [Number(lane[1]), Number(lane[2]), Number(lane[3])];
    // Mid-period, so neither edge sits on the mod's wrap, where it is half anti-aliased.
    expect(period).toBe(GOLF_FAIRWAY_PERIOD_METRES);
    expect(from).toBeGreaterThan(0);
    expect(to).toBeLessThan(period);
    expect(to - from).toBe(GOLF_FAIRWAY_WIDTH_METRES);
    // The lane's share of the course is fairway, the rest rough.
    let fairway = 0;
    const steps = 8_000;
    for (let step = 0; step < steps; step += 1) {
      fairway += band((step / steps) * period, from, to, 0.01) as number;
    }
    expect(fairway / steps).toBeCloseTo(GOLF_FAIRWAY_WIDTH_METRES / GOLF_FAIRWAY_PERIOD_METRES, 2);
    // The rough is its own tone, and the fairway's stripes are the mown ground's.
    expect(program).toMatch(
      /vec3 oylCourse = mix\(diffuseColor\.rgb \* vec3\([^)]*\), oylMown, oylFairway\);/,
    );
    // Round each green, its approach is fairway whatever lane it is in.
    const approach =
      /oylFairway = max\(oylFairway, 1\.0 - smoothstep\(oylG\.z \+ ([\d.]+), oylG\.z \+ ([\d.]+), oylD\)\);/.exec(
        program,
      );
    expect(approach).not.toBeNull();
    expect((Number(approach?.[1]) + Number(approach?.[2])) / 2).toBeCloseTo(
      GOLF_APPROACH_METRES,
      9,
    );
    // The rough is darker and yellower than the fairway (red-to-blue up, green down).
    const [fr, fg, fb] = PARK_GROUND_LOOK.fairway;
    const [rr, rg, rb] = PARK_GROUND_LOOK.rough;
    expect(rg).toBeLessThan(fg as number);
    expect((rr as number) / (rb as number)).toBeGreaterThan((fr as number) / (fb as number));
    // And the stripes are further apart than the 1.22 and 0.8 the owner held.
    expect(PARK_GROUND_LOOK.stripePale - PARK_GROUND_LOOK.stripeDeep).toBeGreaterThan(0.42);
  });
});
