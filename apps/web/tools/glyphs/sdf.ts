// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A glyph's outline, turned into the signed-distance bitmap MapLibre draws
 * text from (#578).
 *
 * ## What MapLibre expects, and where each number comes from
 *
 * - **24 px per em** ({@link GLYPH_SIZE}). MapLibre's shaping calls this
 *   `ONE_EM` and scales every glyph from it to the layer's `text-size`.
 * - **A 3 px border** ({@link GLYPH_BORDER}) of field around the glyph's box,
 *   which is what lets a halo and a scaled-up label read outside the ink.
 * - **A field that reaches 8 px** ({@link SDF_RADIUS}) with **the edge at
 *   0.75** of full scale ({@link SDF_CUTOFF} = 0.25). MapLibre's symbol shader
 *   draws the edge at `(256 − 64) / 256` — the same 0.75 — and names 8 as
 *   `SDF_PX`. A field encoded to any other pair draws every letter fatter or
 *   thinner than the font.
 *
 * The encoding is `255 − 255·(d / radius + cutoff)`, clamped and rounded,
 * where `d` is the distance to the outline in pixels, positive outside the
 * ink and negative inside. That is the published TinySDF formula MapLibre
 * uses for glyphs it draws itself, so a glyph from these files and one
 * MapLibre drew locally encode their edges identically.
 *
 * ## The metrics, and the one convention that is an observation
 *
 * `left`, `width` and `height` describe the pixel box around the ink: the
 * outline's own bounding box scaled, floored at the bottom-left and ceiled at
 * the top-right, so no ink is ever outside it. The bitmap is sampled on
 * exactly that grid, so the ink sits where the metrics say it does.
 *
 * ⚠️ **`top` and `advance` follow what published glyph servers emit, which is
 * an observation rather than a specification.** MapLibre's own source says
 * so: its local renderer "calibrated" a baseline adjustment against server
 * fonts because *"server fonts don't yet include baseline information"*.
 * Decoding a published range file (Protomaps' Noto Sans Regular `0-255.pbf`,
 * read 2026-09-26 for this purpose only — nothing of it is committed) gives
 * `top` = the box's top minus the font's ascender floored to a pixel, and an
 * `advance` floored to a pixel: `x` is 12.6 px wide in that font and advances
 * 12. Both are followed, because MapLibre's shaping is tuned against fonts
 * made that way and a label that sits a pixel off every other MapLibre map
 * is a label nobody asked for.
 *
 * ## Determinism
 *
 * Only `+ − × ÷`, `Math.sqrt`, `Math.floor`, `Math.ceil` and `Math.round`,
 * all of which IEEE 754 and ECMAScript pin exactly. That is what lets
 * `generate-glyphs.test.ts` regenerate every committed file in the ordinary
 * suite and compare it byte for byte, on any machine.
 *
 * Pure: no file and no platform API.
 */

import { GLYPH_BORDER, type EncodedGlyph } from './glyph-pbf';
import type { GlyphOutline, OutlinePoint } from './truetype';

export { GLYPH_BORDER };

/** Pixels per em. MapLibre's `ONE_EM`. */
export const GLYPH_SIZE = 24;
/** How far the field reaches, in pixels. MapLibre's `SDF_PX`. */
export const SDF_RADIUS = 8;
/** Where the edge sits, as a share of full scale below 255. */
export const SDF_CUTOFF = 0.25;
/**
 * Straight pieces per quadratic curve.
 *
 * At 24 px an em, Roboto's largest curve spans about 14 px; eight chords
 * leave a sagitta under a twentieth of a pixel, which the 8-bit field cannot
 * represent. Fixed rather than adaptive so the output is a function of the
 * outline alone.
 */
export const CURVE_STEPS = 8;

interface Segment {
  readonly ax: number;
  readonly ay: number;
  readonly bx: number;
  readonly by: number;
}

function midpoint(a: OutlinePoint, b: OutlinePoint): OutlinePoint {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, onCurve: true };
}

/**
 * A closed TrueType contour as straight segments, in pixels.
 *
 * TrueType outlines are quadratic B-splines: two consecutive off-curve points
 * imply an on-curve point midway between them, and a contour may start on an
 * off-curve point, in which case it starts at the implied one.
 */
export function flatten(contour: readonly OutlinePoint[], scale: number): readonly Segment[] {
  if (contour.length === 0) {
    return [];
  }
  const count = contour.length;
  const at = (index: number): OutlinePoint =>
    contour[((index % count) + count) % count] as OutlinePoint;
  const firstOn = contour.findIndex((point) => point.onCurve);
  // Start on an on-curve point; with none, on the one implied between the
  // first two. Then every other point once, in order, ending just before the
  // start — the close below returns to it.
  const start = firstOn === -1 ? midpoint(at(0), at(1)) : at(firstOn);
  const sequence: OutlinePoint[] = [];
  const from = firstOn === -1 ? 1 : firstOn + 1;
  const length = firstOn === -1 ? count : count - 1;
  for (let offset = 0; offset < length; offset += 1) {
    sequence.push(at(from + offset));
  }
  const segments: Segment[] = [];
  let px = start.x * scale;
  let py = start.y * scale;
  const lineTo = (x: number, y: number): void => {
    if (x !== px || y !== py) {
      segments.push({ ax: px, ay: py, bx: x, by: y });
    }
    px = x;
    py = y;
  };
  const curveTo = (control: OutlinePoint, end: OutlinePoint): void => {
    const x0 = px;
    const y0 = py;
    const cx = control.x * scale;
    const cy = control.y * scale;
    const ex = end.x * scale;
    const ey = end.y * scale;
    for (let step = 1; step <= CURVE_STEPS; step += 1) {
      const t = step / CURVE_STEPS;
      const u = 1 - t;
      lineTo(u * u * x0 + 2 * u * t * cx + t * t * ex, u * u * y0 + 2 * u * t * cy + t * t * ey);
    }
  };
  let pending: OutlinePoint | undefined;
  for (const target of sequence) {
    if (target.onCurve) {
      if (pending === undefined) {
        lineTo(target.x * scale, target.y * scale);
      } else {
        curveTo(pending, target);
        pending = undefined;
      }
    } else if (pending === undefined) {
      pending = target;
    } else {
      const implied = midpoint(pending, target);
      curveTo(pending, implied);
      pending = target;
    }
  }
  if (pending === undefined) {
    lineTo(start.x * scale, start.y * scale);
  } else {
    curveTo(pending, start);
  }
  return segments;
}

/** Squared distance from a point to a segment. */
function distanceSquared(x: number, y: number, s: Segment): number {
  const dx = s.bx - s.ax;
  const dy = s.by - s.ay;
  const length = dx * dx + dy * dy;
  let t = length === 0 ? 0 : ((x - s.ax) * dx + (y - s.ay) * dy) / length;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const ex = s.ax + t * dx - x;
  const ey = s.ay + t * dy - y;
  return ex * ex + ey * ey;
}

/** The non-zero winding number of the outline around a point. */
function winding(x: number, y: number, segments: readonly Segment[]): number {
  let total = 0;
  for (const s of segments) {
    if (s.ay <= y) {
      if (s.by > y && (s.bx - s.ax) * (y - s.ay) - (x - s.ax) * (s.by - s.ay) > 0) {
        total += 1;
      }
    } else if (s.by <= y && (s.bx - s.ax) * (y - s.ay) - (x - s.ax) * (s.by - s.ay) < 0) {
      total -= 1;
    }
  }
  return total;
}

/**
 * One code point's glyph, as MapLibre's range file carries it.
 *
 * `ascender` and `unitsPerEm` are the font's; `outline` is the glyph's.
 */
export function signedDistanceGlyph(
  id: number,
  outline: GlyphOutline,
  unitsPerEm: number,
  ascender: number,
): EncodedGlyph {
  const scale = GLYPH_SIZE / unitsPerEm;
  const advance = Math.floor(outline.advance * scale);
  const baselineToTop = Math.floor(ascender * scale);
  const segments = outline.contours.flatMap((contour) => flatten(contour, scale));
  if (segments.length === 0) {
    return {
      id,
      bitmap: new Uint8Array(),
      width: 0,
      height: 0,
      left: 0,
      top: -baselineToTop,
      advance,
    };
  }
  const left = Math.floor(outline.xMin * scale);
  const right = Math.ceil(outline.xMax * scale);
  const bottom = Math.floor(outline.yMin * scale);
  const top = Math.ceil(outline.yMax * scale);
  const width = right - left;
  const height = top - bottom;
  const columns = width + 2 * GLYPH_BORDER;
  const rows = height + 2 * GLYPH_BORDER;
  const bitmap = new Uint8Array(columns * rows);
  for (let row = 0; row < rows; row += 1) {
    // Rows run down from the top; font y runs up from the baseline.
    const y = top + GLYPH_BORDER - row - 0.5;
    for (let column = 0; column < columns; column += 1) {
      const x = left - GLYPH_BORDER + column + 0.5;
      let nearest = Number.POSITIVE_INFINITY;
      for (const segment of segments) {
        const d = distanceSquared(x, y, segment);
        if (d < nearest) nearest = d;
      }
      const inside = winding(x, y, segments) !== 0;
      const distance = inside ? -Math.sqrt(nearest) : Math.sqrt(nearest);
      const value = Math.round(255 - 255 * (distance / SDF_RADIUS + SDF_CUTOFF));
      bitmap[row * columns + column] = value < 0 ? 0 : value > 255 ? 255 : value;
    }
  }
  return { id, bitmap, width, height, left, top: top - baselineToTop, advance };
}
