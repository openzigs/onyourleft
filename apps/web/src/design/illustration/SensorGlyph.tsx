// SPDX-License-Identifier: AGPL-3.0-or-later

import type { JSX } from 'react';

import { paint } from './paint';
import { coordinate, IllustrationSvg, type IllustrationProps } from './svg';

/** The four kinds of thing a rider pairs (#659), each with a picture. */
export const SENSOR_GLYPH_KINDS = ['trainer', 'heart-rate', 'cadence', 'power'] as const;

/** One of {@link SENSOR_GLYPH_KINDS}. */
export type SensorGlyphKind = (typeof SENSOR_GLYPH_KINDS)[number];

/** The glyphs are drawn on a 24-unit square, the size an icon is usually drawn at. */
const SIZE = 24;

/**
 * A circle as a path, so a ring is one shape: an outline drawn one way round
 * and a hole drawn the other, under the default `nonzero` rule.
 *
 * ⚠️ **Where two outlines overlap they must run the same way round.** The
 * trainer's arm reaches into its flywheel and its upright meets its foot, all
 * drawn anticlockwise on the screen as an outline here is; opposite directions
 * would cancel and cut a hole where they meet, and `even-odd` would do the
 * same whatever the direction.
 */
function circlePath(cx: number, cy: number, r: number, way: 'outline' | 'hole'): string {
  const left = `${coordinate(cx - r)} ${coordinate(cy)}`;
  const right = `${coordinate(cx + r)} ${coordinate(cy)}`;
  const radius = `${coordinate(r)} ${coordinate(r)}`;
  const sweep = way === 'outline' ? '0' : '1';
  return `M${left} A${radius} 0 1 ${sweep} ${right} A${radius} 0 1 ${sweep} ${left} Z`;
}

/** A point `radius` from the glyph's middle, `turn` radians clockwise from the right. */
function polar(radius: number, turn: number): string {
  const middle = SIZE / 2;
  return `${coordinate(middle + radius * Math.cos(turn))} ${coordinate(middle + radius * Math.sin(turn))}`;
}

/**
 * The cadence glyph: a thick arc three-quarters of the way round, an
 * arrowhead at its end, and the axle in the middle — a crank going round.
 * The band runs clockwise on the screen (out along its outer edge and back
 * along its inner one) and the arrowhead the same way, which is the rule
 * above for two shapes that meet; the axle touches neither.
 */
function cadenceGlyph(): string {
  const outer = 9;
  const inner = 5.5;
  const start = -Math.PI / 3;
  const end = start + (3 * Math.PI) / 2;
  const band = `M${polar(outer, start)} A${coordinate(outer)} ${coordinate(outer)} 0 1 1 ${polar(
    outer,
    end,
  )} L${polar(inner, end)} A${coordinate(inner)} ${coordinate(inner)} 0 1 0 ${polar(inner, start)} Z`;
  const head = `M${polar(outer + 2.5, end)} L${polar((outer + inner) / 2, end + 0.6)} L${polar(
    inner - 2.5,
    end,
  )} Z`;
  return `${band} ${head} ${circlePath(SIZE / 2, SIZE / 2, 2, 'outline')}`;
}

/**
 * A straight bar of width `width` from one point to another, as an outline
 * that runs anticlockwise on the screen whichever way the points are given —
 * the rule above for two shapes that meet.
 */
function bar(x1: number, y1: number, x2: number, y2: number, width: number): string {
  const length = Math.hypot(x2 - x1, y2 - y1);
  const nx = (-(y2 - y1) / length) * (width / 2);
  const ny = ((x2 - x1) / length) * (width / 2);
  const corners: [number, number][] = [
    [x1 + nx, y1 + ny],
    [x2 + nx, y2 + ny],
    [x2 - nx, y2 - ny],
    [x1 - nx, y1 - ny],
  ];
  // The shoelace sum is positive for a clockwise outline on a y-down screen.
  let area = 0;
  corners.forEach(([ax, ay], index) => {
    const [bx, by] = corners[(index + 1) % corners.length] ?? [ax, ay];
    area += ax * by - bx * ay;
  });
  const ordered = area > 0 ? corners.reverse() : corners;
  return `M${ordered.map(([x, y]) => `${coordinate(x)} ${coordinate(y)}`).join(' L')} Z`;
}

/**
 * The trainer glyph: a flywheel with its hub cut out, the arm that holds a
 * bicycle's back wheel reaching up from it to the upright, and the foot along
 * the floor.
 */
function trainerGlyph(): string {
  return [
    circlePath(8, 14, 5, 'outline'),
    circlePath(8, 14, 1.8, 'hole'),
    bar(10.5, 11.5, 18.5, 5, 2.4),
    bar(18.5, 4.5, 18.5, 20, 2.4),
    bar(2.5, 20.5, 22, 20.5, 2),
  ].join(' ');
}

/**
 * Each glyph, as filled outlines on the 24-unit square.
 *
 * ⚠️ **Drawn here, from these numbers, and from nobody's icon set.** ADR 0034
 * D-3 forbids copying Lucide's path data into the repository, and the shapes
 * below are the plainest geometric reading of each thing — a heart from two
 * arcs and a point, a bolt from six straight edges, a crank going round, and
 * a trainer as a flywheel on its frame — so that nothing here is anybody else's
 * drawing.
 */
const GLYPHS: Readonly<Record<SensorGlyphKind, string>> = {
  // Two half-circles on the shoulders, and straight sides meeting at the point.
  'heart-rate': 'M12 20.5 L4.3 12.4 A4.4 4.4 0 0 1 12 6.6 A4.4 4.4 0 0 1 19.7 12.4 Z',
  // A bolt: down-left to a shelf, then down to the point and back up.
  power: 'M14 2 L5 13.5 L11 13.5 L9.5 22 L19 9.5 L13 9.5 Z',
  cadence: cadenceGlyph(),
  trainer: trainerGlyph(),
};

/**
 * A sensor or a trainer, as a small flat picture — #938.
 *
 * Decoration beside the words that name the device: "Heart rate strap", never
 * the glyph alone (epic #935, principle 1). A connection's state is said in
 * words too; nothing about this drawing changes with one.
 */
export function SensorGlyph({
  className,
  kind,
}: IllustrationProps & { readonly kind: SensorGlyphKind }): JSX.Element {
  return (
    <IllustrationSvg
      aspect="xMidYMid meet"
      className={className}
      viewBox={`0 0 ${String(SIZE)} ${String(SIZE)}`}
    >
      <path className={paint('mark')} d={GLYPHS[kind]} />
    </IllustrationSvg>
  );
}
