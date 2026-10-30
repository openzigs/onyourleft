// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #1659: every mapped window kind's view-dependent reveal — the twin
 * (`facade.ts` §`revealOf`, asked through `facadePartAt`) held to the issue's
 * numbers, every kind enumerated from the shader's own style flags, and the
 * shader's face-frame contract and its lever read off the program three is
 * handed. What needs a GPU — that the reveal reaches the screen, and that the
 * lever takes it off — is `game.browser.spec.ts` §"#1659".
 */

import { afterEach, describe, expect, it } from 'vitest';

import { OPENING_RECESS_METRES } from './buildings';
import {
  COMMERCIAL_WINDOW_IN_BAY,
  facadePartAt,
  PAIR_MIN_BAY_METRES,
  REVEAL_DEPTH_METRES,
  REVEAL_GRAZE,
  SASH,
  SILL,
  WINDOW_IN_BAY,
  WINDOW_SILL_METRES,
  type FacadePart,
  type FacadeStyle,
  type FacadeView,
  type FaceDirection,
} from './facade';
import {
  DORMER,
  FACADE_DORMER,
  footprintPlans,
  STOREY_METRES,
  STYLE_COMMERCIAL,
  STYLE_SASH,
} from './footprint-buildings';
import { rowTownFixture } from './footprint-fixtures-testing';
import { landClassMask } from './land-class';
import { mappedBuildingsOf } from './mapped-buildings';
import { PHOTOGRAPHIC_STRUCTURE_SURFACES } from './realistic-assets';
import { MappedBuildingBelt, windowRevealsOf } from './three-renderer';

const HALF = Math.SQRT1_2;
/** The eye 45° to the face's left (toward −u), and to its right; and square on. */
const FROM_LEFT: FaceDirection = [-HALF, 0, HALF];
const FROM_RIGHT: FaceDirection = [HALF, 0, HALF];
const SQUARE: FaceDirection = [0, 0, 1];
/** A sun behind the face, which throws no shadow on it. */
const BEHIND: FaceDirection = [0, 0, -1];

const radians = (degrees: number): number => (degrees * Math.PI) / 180;
/** The sun `elevation` degrees high and square to the face, or behind it. */
const sunHigh = (elevation: number, behind = false): FaceDirection => [
  0,
  Math.sin(radians(elevation)),
  (behind ? -1 : 1) * Math.cos(radians(elevation)),
];

const seenFrom = (eye: FaceDirection, sun: FaceDirection = BEHIND): FacadeView => ({ eye, sun });

describe('the reveal’s depth is the procedural houses’ real recess — #1659', () => {
  it('is OPENING_RECESS_METRES, 0.09 m, and the graze 0.2', () => {
    expect(REVEAL_DEPTH_METRES).toBe(OPENING_RECESS_METRES);
    expect(REVEAL_DEPTH_METRES).toBe(0.09);
    expect(REVEAL_GRAZE).toBe(0.2);
  });
});

describe('a casement seen from the side — #1659', () => {
  const bay = 3.6;
  /** The part of bay 1, storey 1's casement at metres `(x, y)` from the bay's left and the storey's floor. */
  const at = (view: FacadeView, x: number, y: number): FacadePart =>
    facadePartAt(1 + x / bay, 1 + y / STOREY_METRES, 3, -1, {
      flags: 0,
      width: bay,
      extra: -1,
      view,
    });
  const left = (WINDOW_IN_BAY.left + WINDOW_IN_BAY.frameAcross) * bay;
  const right = (WINDOW_IN_BAY.right - WINDOW_IN_BAY.frameAcross) * bay;
  // The lower pane's middle, clear of the transom.
  const y = (WINDOW_IN_BAY.bottom + WINDOW_IN_BAY.frameUp) * STOREY_METRES + 0.3;

  it('from 45° to the left shows a 0.09 m reveal inside the right-hand jamb, and glass inside the left', () => {
    const view = seenFrom(FROM_LEFT);
    expect(at(view, right - 0.005, y)).toBe('reveal');
    expect(at(view, right - 0.045, y)).toBe('reveal');
    expect(at(view, right - 0.085, y)).toBe('reveal');
    // 0.09 m, to within a centimetre: glass a centimetre further in.
    expect(at(view, right - 0.1, y)).toBe('glass');
    // The matching strip inside the left jamb is glass.
    for (const inset of [0.005, 0.045, 0.085]) expect(at(view, left + inset, y)).toBe('glass');
  });

  it('mirrors from 45° to the right', () => {
    const view = seenFrom(FROM_RIGHT);
    for (const inset of [0.005, 0.045, 0.085]) {
      expect(at(view, left + inset, y)).toBe('reveal');
      expect(at(view, right - inset, y)).toBe('glass');
    }
    expect(at(view, left + 0.1, y)).toBe('glass');
  });

  it('head-on, neither strip is a reveal', () => {
    const view = seenFrom(SQUARE);
    for (const inset of [0.005, 0.045, 0.085]) {
      expect(at(view, left + inset, y)).toBe('glass');
      expect(at(view, right - inset, y)).toBe('glass');
    }
  });

  it('shifts the mullion with the glass: it is the glazing’s, behind the frame', () => {
    const middle = bay / 2;
    expect(at(seenFrom(SQUARE), middle, y)).toBe('frame');
    // From the left the glass is seen 0.09 m to the left of where it is, so
    // the mullion is drawn 0.09 m to the left of the middle.
    expect(at(seenFrom(FROM_LEFT), middle, y)).toBe('glass');
    expect(at(seenFrom(FROM_LEFT), middle - REVEAL_DEPTH_METRES, y)).toBe('frame');
  });

  it('shifts by at most the graze’s, seen edge-on', () => {
    // An eye 85° off square would shift the glass 1.03 m; the graze holds it to 0.45 m.
    const edgeOn = seenFrom([-Math.sin(radians(85)), 0, Math.cos(radians(85))]);
    const shift = REVEAL_DEPTH_METRES / REVEAL_GRAZE;
    expect(at(edgeOn, right - shift + 0.01, y)).toBe('reveal');
    expect(at(edgeOn, right - shift - 0.01, y)).not.toBe('reveal');
  });
});

/**
 * The style flags the facade shader reads to choose its window, by name and
 * value, from the program three is handed — so that a kind the shader learns
 * later is enumerated here without this file being touched.
 */
function shaderStyleFlags(fragment: string): ReadonlyMap<string, number> {
  const read = new Set(
    [...fragment.matchAll(/oylFlag\(oylFlags, (oyl\w+Flag)\)/g)].map((m) => m[1]),
  );
  const flags = new Map<string, number>();
  for (const [, name, value] of fragment.matchAll(/const float (oyl\w+Flag) = ([\d.]+);/g)) {
    if (name !== undefined && read.has(name)) flags.set(name, Number(value));
  }
  return flags;
}

const town = rowTownFixture();
const buildings = mappedBuildingsOf(
  footprintPlans(town.corridor, landClassMask(town.corridor), town.profile, town.origin).plans,
);
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
  windowRevealsOf({} as never, true);
  for (const belt of belts.splice(0)) belt.dispose();
});

/** The fragment shader a mapped building's material hands three, and the defines three keys it on. */
function compiled(): { readonly fragment: string; readonly defines: unknown } {
  const belt = new MappedBuildingBelt(buildings, textures);
  belts.push(belt);
  const material = belt.materialOf('brick');
  if (material === undefined) throw new Error('the belt has no brick material');
  // The includes `mapped-building-belt.test.ts` hands a lit material.
  const shader = {
    uniforms: {},
    vertexShader:
      '#include <common>\n#include <begin_vertex>\n#include <color_vertex>\n#include <fog_pars_vertex>\n#include <fog_vertex>',
    fragmentShader:
      '#include <common>\n#include <clipping_planes_fragment>\n#include <map_fragment>\n#include <color_fragment>\n#include <roughnessmap_fragment>\n#include <metalnessmap_fragment>\n#include <normal_fragment_begin>\n#include <normal_fragment_maps>\n#include <fog_pars_fragment>\n#include <fog_fragment>',
  };
  material.onBeforeCompile(shader as never, undefined as never);
  return { fragment: shader.fragmentShader, defines: { ...material.defines } };
}

/** One window kind: where it is, and the part at metres across and up its own region. */
interface Kind {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly part: (view: FacadeView, x: number, y: number) => FacadePart;
}

/** The wall window kinds a style's `flags` lay, as `facadePartAt` lays them. */
function wallKinds(name: string, flags: number): readonly Kind[] {
  const wall = (label: string, bay: number, extra: number, storey: number): Kind => ({
    name: `${name} ${label}`,
    width: bay,
    height: STOREY_METRES,
    part: (view, x, y) =>
      facadePartAt(1 + x / bay, storey + y / STOREY_METRES, 3, -1, {
        flags,
        width: bay,
        extra,
        view,
      }),
  });
  if ((flags & STYLE_SASH) === 0) return [wall('window', 3.6, -1, 1)];
  return [
    wall('single sash', 3, -1, 1),
    wall('paired sash', PAIR_MIN_BAY_METRES, -1, 1),
    // The picture window: the ground storey's bay the style names.
    wall('picture window', 3.4, 1, 0),
  ];
}

const DORMER_KIND: Kind = {
  name: 'dormer sash',
  width: DORMER.width,
  height: DORMER.front,
  part: (view, x, y) => {
    const style: FacadeStyle = { flags: 0, width: DORMER.width, extra: DORMER.front, view };
    return facadePartAt(x, y, FACADE_DORMER, -1, style);
  },
};

/** The runs of `reveal` along a row, each with what lies to its right. */
function revealRuns(
  kind: Kind,
  view: FacadeView,
  y: number,
): readonly { readonly width: number; readonly then: FacadePart }[] {
  const step = 0.0025;
  const runs: { width: number; then: FacadePart }[] = [];
  let from: number | undefined;
  for (let x = 0; x <= kind.width; x += step) {
    const part = kind.part(view, x, y);
    if (part === 'reveal') from ??= x;
    else if (from !== undefined) {
      runs.push({ width: x - from, then: part });
      from = undefined;
    }
  }
  return runs;
}

describe('every window kind has its reveal, from the shader’s own flags — #1659', () => {
  it('reads the window flags out of the program, so a later kind is enumerated here', () => {
    const flags = shaderStyleFlags(compiled().fragment);
    expect(flags.get('oylSashFlag')).toBe(STYLE_SASH);
    expect(flags.get('oylCommercialFlag')).toBe(STYLE_COMMERCIAL);
    expect(compiled().fragment).toContain('abs(oylTop - oylDormerTop) < 0.5');
  });

  it('seen from 45° to the left, shows a 0.09 m reveal inside a right-hand jamb of every kind; head-on, none', () => {
    const flags = shaderStyleFlags(compiled().fragment);
    const kinds = [
      ...wallKinds('no flag', 0),
      ...[...flags].flatMap(([name, value]) => wallKinds(name, value)),
      DORMER_KIND,
    ];
    // Every flag the shader reads, and the dormer; a sash flag adds three kinds.
    expect(kinds.length).toBeGreaterThanOrEqual(1 + flags.size + 2 + 1);
    for (const kind of kinds) {
      let strips = 0;
      let squareReveals = 0;
      for (let y = 0.05; y < kind.height; y += 0.05) {
        for (const run of revealRuns(kind, seenFrom(FROM_LEFT), y)) {
          if (run.then === 'frame' && Math.abs(run.width - REVEAL_DEPTH_METRES) <= 0.01) {
            strips += 1;
          }
        }
        squareReveals += revealRuns(kind, seenFrom(SQUARE), y).length;
      }
      expect(strips, kind.name).toBeGreaterThan(0);
      expect(squareReveals, `${kind.name} head-on`).toBe(0);
    }
  });
});

describe('the sun’s shadow in the reveal, not a constant — #1659', () => {
  /** How far down from its head a window's glass is in the head's shadow, along `x`. */
  const headShadow = (kind: Kind, x: number, head: number, sun: FaceDirection): number => {
    const view = seenFrom(SQUARE, sun);
    for (let y = head - 0.0005; y > head - 0.6; y -= 0.0005) {
      if (kind.part(view, x, y) === 'glass') return head - y;
    }
    return Number.POSITIVE_INFINITY;
  };
  const sash = wallKinds('sash', STYLE_SASH)[0] as Kind;
  const sashHead = WINDOW_SILL_METRES + SASH.height - SASH.frame;
  const casement = wallKinds('casement', 0)[0] as Kind;
  const casementHead = (WINDOW_IN_BAY.top - WINDOW_IN_BAY.frameUp) * STOREY_METRES;
  // Clear of the casement's mullion.
  const casementX = (0.5 + 0.1) * 3.6;

  it('throws the head’s shadow 0.09 · tan 70° down the glass with the sun 70° high, square on', () => {
    const expected = 0.09 * Math.tan(radians(70));
    expect(expected).toBeCloseTo(0.247, 3);
    expect(Math.abs(headShadow(sash, 1.5, sashHead, sunHigh(70)) - expected)).toBeLessThan(0.01);
    expect(
      Math.abs(headShadow(casement, casementX, casementHead, sunHigh(70)) - expected),
    ).toBeLessThan(0.01);
    // And a lower sun, a shallower shadow: it is the sun's, not a band.
    expect(
      Math.abs(headShadow(sash, 1.5, sashHead, sunHigh(30)) - 0.09 * Math.tan(radians(30))),
    ).toBeLessThan(0.01);
  });

  it('throws none with the sun behind the face', () => {
    expect(headShadow(sash, 1.5, sashHead, sunHigh(70, true))).toBeLessThan(0.001);
    expect(headShadow(casement, casementX, casementHead, sunHigh(70, true))).toBeLessThan(0.001);
    // Nor with the sun in the face's own plane, which lights none of it: no
    // division by its zero slant shades the whole pane.
    const grazing = seenFrom(SQUARE, [HALF, HALF, 0]);
    expect(sash.part(grazing, 1.5, WINDOW_SILL_METRES + SASH.height / 4)).toBe('glass');
    expect(sash.part(grazing, 1.5, WINDOW_SILL_METRES - SILL.depth - 0.01)).toBe('wall');
  });

  it('throws the sun-side jamb’s shadow d · |s.x| / s.z across the glass, on that side only', () => {
    // The sun 45° round toward +u, on the horizon: 0.09 m in from the +u jamb.
    const sun: FaceDirection = [HALF, 0, HALF];
    const view = seenFrom(SQUARE, sun);
    const inner = SASH.width / 2 - SASH.frame;
    const y = WINDOW_SILL_METRES + SASH.height / 4;
    const middle = 1.5;
    expect(sash.part(view, middle + inner - 0.08, y)).toBe('reveal');
    expect(sash.part(view, middle + inner - 0.1, y)).toBe('glass');
    expect(sash.part(view, middle - inner + 0.02, y)).toBe('glass');
    // From −u, the −u jamb's.
    const mirrored = seenFrom(SQUARE, [-HALF, 0, HALF]);
    expect(sash.part(mirrored, middle - inner + 0.08, y)).toBe('reveal');
    expect(sash.part(mirrored, middle + inner - 0.02, y)).toBe('glass');
  });

  it('throws the sill’s shadow SILL.depth · tan(elevation) down the wall below it', () => {
    const view = seenFrom(SQUARE, sunHigh(70));
    const below = WINDOW_SILL_METRES - SILL.depth;
    const depth = SILL.depth * Math.tan(radians(70));
    expect(sash.part(view, 1.5, below - 0.01)).toBe('shadow');
    expect(sash.part(view, 1.5, below - depth + 0.01)).toBe('shadow');
    expect(sash.part(view, 1.5, below - depth - 0.01)).toBe('wall');
    // The casement's sill too, and none with the sun behind.
    const casementBelow = (WINDOW_IN_BAY.bottom - WINDOW_IN_BAY.sillUp) * STOREY_METRES;
    expect(casement.part(view, casementX, casementBelow - 0.01)).toBe('shadow');
    expect(
      casement.part(seenFrom(SQUARE, sunHigh(70, true)), casementX, casementBelow - 0.01),
    ).toBe('wall');
    expect(sash.part(seenFrom(SQUARE, sunHigh(70, true)), 1.5, below - 0.01)).toBe('wall');
  });

  it('draws a commercial window’s the same way', () => {
    const commercial = wallKinds('commercial', STYLE_COMMERCIAL)[0] as Kind;
    const head = (COMMERCIAL_WINDOW_IN_BAY.top - COMMERCIAL_WINDOW_IN_BAY.frameUp) * STOREY_METRES;
    expect(Math.abs(headShadow(commercial, casementX, head, sunHigh(70)) - 0.247)).toBeLessThan(
      0.01,
    );
  });
});

describe('the shader’s reveal — #1659', () => {
  it('declares the face’s frame outside the sun’s block, and computes the sun’s side as it did', () => {
    const { fragment } = compiled();
    const block = fragment.indexOf('    vec3 oylQx = dFdx(vViewPosition);');
    expect(block).toBeGreaterThan(0);
    for (const name of ['oylFaceN', 'oylFaceU', 'oylFaceUp', 'oylToSunV', 'oylToEyeV']) {
      const declared = fragment.indexOf(`  vec3 ${name};\n`);
      expect(declared, name).toBeGreaterThan(0);
      expect(declared, name).toBeLessThan(block);
    }
    // Toward the eye: three's vViewPosition is −mvPosition already, so not negated again.
    expect(fragment).toContain('oylToEyeV = normalize(vViewPosition);');
    // oylSun, unchanged.
    expect(fragment).toContain(
      'oylSun = step(0.0, dot(oylN, oylToSun)) * sign(oylSunAcross) * step(0.15, abs(oylSunAcross));',
    );
  });

  it('draws every kind through one function, its numbers generated from the twin’s', () => {
    const { fragment } = compiled();
    expect(fragment).toContain(`const float oylRecess = ${String(REVEAL_DEPTH_METRES)};`);
    expect(fragment).toContain(`const float oylGraze = ${String(REVEAL_GRAZE)};`);
    // The sash's (every sash kind and the dormer's) and the casement's, since
    // #1636 the curtain wall's, and the definition.
    expect(fragment.match(/oylRevealOf\(/g)?.length).toBe(4);
    expect(fragment).toContain('oylRevealOf(oylLocal, oylLo, oylHi, pw, e, s,');
    expect(fragment).toContain('oylRevealOf(oylAt * oylToM, oylLo * oylToM, oylHi * oylToM,');
    // The dormer's sash is a sash, and is asked with the face's view.
    expect(fragment).toContain('oylP, oylMw, oylWin, oylFaceW, 0.0, 0.0, 0.0, oylEyeF, oylSunF,');
    // #1588's fixed band is gone from the program.
    expect(fragment).not.toContain('oylRevealHead');
    expect(fragment).not.toContain('oylRevealJamb');
  });

  it('lights a side by the sun’s facing, and darkens one facing away, at every site that draws a side', () => {
    const { fragment } = compiled();
    // The side the eye's ray met is lit by the sun when it faces it, and the
    // reveal lever's empty program says `lit = 1.0` — so the on program must not.
    expect(fragment).toContain(
      'float oylFacing = mix(sign(oylShift.y) * s.y, sign(oylShift.x) * s.x, oylJambSide);',
    );
    expect(fragment).toContain('lit = step(0.0001, oylFacing) * oylFront;');
    // The sash, the commercial window and the dormer/shopfront sash each take
    // the wall's light on a lit side and REVEAL.shade on one facing away; since
    // #1636 the curtain wall its mullion's.
    expect(fragment.split('(1.0 - oylRevealShade * (1.0 - oylSideLit))').length - 1).toBe(4);
  });

  it('shadows the glass under the head and the sun-side jamb, and the wall under the sill', () => {
    const { fragment } = compiled();
    expect(fragment).toContain('shade = oylFront * max(oylUnderHead, oylByJamb);');
    // The casement's and the commercial window's glass (the sash's is its `reveal`).
    expect(fragment).toContain('oylPane * (1.0 - oylRevealShade * oylShadeOn)');
    expect(fragment.split('* (1.0 - oylRevealShade * oylRevealOn)').length - 1).toBe(2);
    // The sill's shadow on the wall, at the sash, the casement and the dormer.
    expect(fragment.split('(1.0 - oylRevealShade * oylSillShade)').length - 1).toBe(3);
    // And the lever's empty program has none of it.
    windowRevealsOf({} as never, false);
    const off = compiled().fragment;
    windowRevealsOf({} as never, true);
    expect(off).not.toContain('oylUnderHead');
    expect(off).not.toContain('oylFacing');
  });

  it('builds the program without the term with `-window-reveals`, and with it otherwise', () => {
    const on = compiled();
    expect(on.fragment).toContain('vec2 oylShift = oylRecess * e.xy / max(e.z, oylGraze);');
    expect(on.fragment).toContain('oylSillShadeOf(');
    windowRevealsOf({} as never, false);
    const off = compiled();
    expect(off.fragment).not.toContain('oylShift');
    expect(off.fragment).not.toContain('oylCast');
    expect(off.fragment).toContain('    q = p;\n    seen = 1.0;');
    // A different program, so three compiles it rather than reusing the
    // product's: three keys a program on its material's defines.
    expect(on.defines).toMatchObject({ OYL_WINDOW_REVEALS: 1 });
    expect(off.defines).toMatchObject({ OYL_WINDOW_REVEALS: 0 });
    windowRevealsOf({} as never, true);
    expect(compiled().fragment).toContain('vec2 oylShift');
  });
});
