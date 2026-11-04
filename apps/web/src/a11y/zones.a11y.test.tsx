// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * #2039 — the power-zone colours, ADR 0063 D-4: grey, blue, green, yellow,
 * orange, red, and purple above red (the owner's rulings of 2026-11-03).
 *
 * Two things the contrast suite cannot see, both because of colour-vision
 * deficiency, whose commonest forms collapse exactly the green, yellow, orange
 * and red neighbours this order puts side by side:
 *
 * 1. **Neighbouring zones stay apart by lightness, under each deficiency.**
 *    The floor is **1.20:1** (WCAG luminance ratio between adjacent zones),
 *    ADR 0063 D-4 on the owner's choice of direction A on #2035, which carried
 *    spike 0034's proposal. It holds under normal vision and under simulated
 *    deuteranopia, protanopia and tritanopia, in both palettes. The simulation
 *    is Machado, Oliveira and Fernandes (2009), *"A Physiologically-based Model
 *    for Simulation of Color Vision Deficiency"*, IEEE TVCG 15(6), at severity
 *    1.0: a published 3×3 matrix per deficiency, applied to linear sRGB and
 *    written out below. No dependency.
 * 2. **No zone is told by colour alone** (WCAG 2.2 SC 1.4.1). Every component
 *    that reads a zone colour is found by its IMPORT of `BAND_TOKENS`,
 *    `BandToken` or `HEART_RATE_BAND_TOKENS` — not from a hand list — and each
 *    is rendered and must name, in the DOM, every zone it paints by its number
 *    and name beside a swatch of that zone's colour (`design/ZoneKey.tsx`). A
 *    new reader with no fixture here is a red build that says so.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import type { JSX } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  expandWorkout,
  POWER_ZONE_NAMES,
  powerZones,
  seconds,
  thresholdShare,
  timeInZones,
  watts,
  type WorkoutBlock,
} from '@onyourleft/domain';

import { zoneRows } from '../analysis/present';
import { ZoneChart, zoneFillClass } from '../analysis/ZoneChart';
import { contrastRatio } from '../design/contrast';
import { BAND_TOKENS, THEMES, paletteColours, type BandToken } from '../design/tokens';
import { ZoneKey, zoneSwatchClass } from '../design/ZoneKey';
import { WorkoutGraph } from '../workout/WorkoutGraph';
import { BlockChart } from '../workouts/BlockChart';

/** ADR 0063 D-4's floor, written here and not read from the module it checks. */
const ADJACENT_ZONE_FLOOR = 1.2;

/**
 * Machado, Oliveira and Fernandes (2009), Table 1 at severity 1.0, row-major,
 * from linear RGB to linear RGB.
 */
const DEFICIENCIES = {
  protanopia: [
    0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998,
  ],
  deuteranopia: [
    0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.01182, 0.04294, 0.968881,
  ],
  tritanopia: [
    1.255528, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733, 0.691367, 0.3039,
  ],
} as const;

type Vision = 'normal' | keyof typeof DEFICIENCIES;
const VISIONS: readonly Vision[] = ['normal', 'deuteranopia', 'protanopia', 'tritanopia'];

/** sRGB to linear, per channel — WCAG 2.2's own linearisation. */
function linear(channel: number): number {
  const proportion = channel / 255;
  return proportion <= 0.04045 ? proportion / 12.92 : ((proportion + 0.055) / 1.055) ** 2.4;
}

/** A `#rrggbb`'s relative luminance as a reader with this vision sees it. */
function luminanceSeen(hex: string, vision: Vision): number {
  const rgb = [1, 3, 5].map((at) => linear(Number.parseInt(hex.slice(at, at + 2), 16)));
  const [red = 0, green = 0, blue = 0] =
    vision === 'normal'
      ? rgb
      : [0, 1, 2].map((row) => {
          const matrix = DEFICIENCIES[vision];
          const value =
            (matrix[row * 3] ?? 0) * (rgb[0] ?? 0) +
            (matrix[row * 3 + 1] ?? 0) * (rgb[1] ?? 0) +
            (matrix[row * 3 + 2] ?? 0) * (rgb[2] ?? 0);
          return Math.min(1, Math.max(0, value));
        });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function ratioSeen(a: string, b: string, vision: Vision): number {
  const first = luminanceSeen(a, vision);
  const second = luminanceSeen(b, vision);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

describe('the simulation is the published one', () => {
  it('reads normal vision as WCAG does', () => {
    expect(ratioSeen('#000000', '#ffffff', 'normal')).toBeCloseTo(21, 10);
    expect(ratioSeen('#2d74ca', '#5fc372', 'normal')).toBeCloseTo(
      contrastRatio('#2d74ca', '#5fc372'),
      10,
    );
  });

  it('keeps white white under every deficiency: each matrix row sums to 1', () => {
    for (const vision of ['protanopia', 'deuteranopia', 'tritanopia'] as const) {
      expect(DEFICIENCIES[vision]).toHaveLength(9);
      // Each row of a Machado matrix sums to 1: white stays white.
      for (let row = 0; row < 3; row += 1) {
        const sum = DEFICIENCIES[vision]
          .slice(row * 3, row * 3 + 3)
          .reduce((total, value) => total + value, 0);
        expect(sum).toBeCloseTo(1, 5);
      }
    }
  });
});

describe('neighbouring zones stay apart — #2039, ADR 0063 D-4', () => {
  it('walks the seven power zones', () => {
    expect(BAND_TOKENS).toHaveLength(POWER_ZONE_NAMES.length);
  });

  describe.each(THEMES)('in the %s palette', (theme) => {
    const colours = paletteColours(theme);
    const pairs = BAND_TOKENS.slice(1).map(
      (zone, index) => [BAND_TOKENS[index] ?? 'bandRecovery', zone] as const,
    );

    describe.each(VISIONS)('under %s vision', (vision) => {
      it.each(pairs)('%s to %s clears the floor', (lower, higher) => {
        const ratio = ratioSeen(colours[lower], colours[higher], vision);
        expect(
          ratio,
          `${theme}, ${vision}: ${lower} (${colours[lower]}) and ${higher} ` +
            `(${colours[higher]}) are ${ratio.toFixed(3)}:1 apart, under the ` +
            `${String(ADJACENT_ZONE_FLOOR)}:1 floor (ADR 0063 D-4)`,
        ).toBeGreaterThanOrEqual(ADJACENT_ZONE_FLOOR);
      });
    });
  });
});

/** Every non-test `.tsx` under `src`, relative to it. */
function sources(directory: string, root = directory): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return sources(path, root);
    return entry.endsWith('.tsx') && !/\.test\.tsx$/.test(entry) ? [relative(root, path)] : [];
  });
}

const SRC = join(import.meta.dirname, '..');

/** Every component that imports a zone colour from the tokens. */
function zoneReaders(): readonly string[] {
  return sources(SRC)
    .filter((path) => {
      const text = readFileSync(join(SRC, path), 'utf8');
      return /import\s+(?:type\s+)?\{[^}]*\b(BAND_TOKENS|BandToken|HEART_RATE_BAND_TOKENS)\b[^}]*\}\s*from\s*'[./]*\/?(design\/)?tokens'/.test(
        text,
      );
    })
    .sort();
}

const steady = (length: number, share: number): WorkoutBlock => ({
  kind: 'steady',
  seconds: seconds(length),
  target: thresholdShare(share),
});

/** A plan through four zones: 2 Endurance, 4 Threshold, 5 VO₂ and 7 Sprint. */
const BLOCKS: readonly WorkoutBlock[] = [
  steady(300, 0.6),
  steady(300, 0.95),
  steady(300, 1.1),
  steady(60, 1.6),
];

/** Each reader of a zone colour, rendered painting zones. */
const FIXTURES: Readonly<Record<string, () => JSX.Element>> = {
  'design/ZoneKey.tsx': () => <ZoneKey zones={[1, 3, 4, 6]} />,
  // #2069: a ride through every power zone, a minute in each.
  'analysis/ZoneChart.tsx': () => {
    const zones = powerZones(watts(200));
    const samples = zones.map((zone) => zone.lower + 1).flatMap((value) => Array(60).fill(value));
    return (
      <ZoneChart
        rows={zoneRows(zones, timeInZones(zones, samples, seconds(1)), 'W')}
        basis="power"
      />
    );
  },
  'workouts/BlockChart.tsx': () => (
    <BlockChart segments={expandWorkout({ name: 'fixture', blocks: BLOCKS }).segments} />
  ),
  'workout/WorkoutGraph.tsx': () => (
    <WorkoutGraph
      workout={{
        elapsedSeconds: 30,
        timeline: expandWorkout({ name: 'fixture', blocks: BLOCKS }),
        holdingWatts: 150,
        thresholdWatts: 250,
        trace: [],
      }}
    />
  ),
};

function rendered(element: JSX.Element): Element {
  const holder = document.createElement('div');
  holder.innerHTML = renderToStaticMarkup(element);
  return holder;
}

/** The zones a rendering paints, from its drawing's band classes (`oyl-block-chart__band-*`). */
function zonesDrawn(root: Element): readonly number[] {
  const painted = new Set<number>();
  for (const [index, token] of BAND_TOKENS.entries()) {
    const kebab = token.replaceAll(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
    // #2069: and the zone chart's bars, so a bar drawn with no words beside it
    // is a painted zone with no name rather than a zone nothing painted.
    if (
      root.querySelector(
        `.oyl-block-chart__${kebab}, .${zoneSwatchClass(token)}, .${zoneFillClass(token)}`,
      ) !== null
    ) {
      painted.add(index);
    }
  }
  return [...painted].sort((a, b) => a - b);
}

describe('no zone is told by colour alone — #2039, WCAG 2.2 SC 1.4.1', () => {
  it('finds every reader of a zone colour by its imports, and has a fixture for each', () => {
    const readers = zoneReaders();
    // Two components draw zones today, and the key itself.
    expect(readers.length).toBeGreaterThanOrEqual(3);
    expect(readers).toEqual(Object.keys(FIXTURES).sort());
  });

  it.each(Object.keys(FIXTURES).sort())(
    '%s names every zone it paints by its number and name, beside its colour',
    (path) => {
      const root = rendered((FIXTURES[path] as () => JSX.Element)());
      const drawn = zonesDrawn(root);
      expect(
        drawn.length,
        `${path} painted no zone, so the fixture proves nothing`,
      ).toBeGreaterThan(0);
      for (const zone of drawn) {
        const token = BAND_TOKENS[zone] as BandToken;
        const label = `${String(zone + 1)} ${POWER_ZONE_NAMES[zone] ?? ''}`;
        const entry = root.querySelector(
          `[data-oyl-zone-key] [data-oyl-zone="${String(zone + 1)}"]`,
        );
        expect(entry, `${path}: zone ${label} is painted and not named`).not.toBeNull();
        expect(entry?.textContent?.trim(), `${path}: zone ${String(zone + 1)}'s words`).toBe(label);
        // Beside its colour: the swatch inside the same entry is that zone's.
        expect(
          entry?.querySelector(`.${zoneSwatchClass(token)}`),
          `${path}: zone ${label}'s swatch`,
        ).not.toBeNull();
      }
    },
  );
});
