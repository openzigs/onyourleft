// SPDX-License-Identifier: Apache-2.0

/**
 * Synthetic height tiles (#2013): ground invented by a formula, encoded as
 * the archive encodes it. **No terrain data from any source is in this file.**
 *
 * Each tile is a real 512 px lossless WebP in Terrarium encoding, written by
 * `testing/webp-encoder.ts`, or a deliberately broken one for a refusal.
 */

import { HEIGHT_TILE_PIXELS } from '../height-tile';
import { encodeLosslessWebp } from '../testing/webp-encoder';

/** A height in metres as Terrarium's three bytes: `R × 256 + G + B / 256 − 32768`. */
export function terrariumBytes(metres: number): readonly [number, number, number] {
  const value = metres + 32_768;
  const whole = Math.floor(value);
  const fraction = Math.min(255, Math.round((value - whole) * 256));
  return [Math.floor(whole / 256), whole % 256, fraction];
}

/** 512 × 512 opaque RGBA pixels whose heights are `height(column, row)`, in metres. */
export function heightRgba(height: (column: number, row: number) => number): Uint8Array {
  const rgba = new Uint8Array(HEIGHT_TILE_PIXELS * HEIGHT_TILE_PIXELS * 4);
  for (let row = 0; row < HEIGHT_TILE_PIXELS; row += 1) {
    for (let column = 0; column < HEIGHT_TILE_PIXELS; column += 1) {
      const [red, green, blue] = terrariumBytes(height(column, row));
      const at = (row * HEIGHT_TILE_PIXELS + column) * 4;
      rgba[at] = red;
      rgba[at + 1] = green;
      rgba[at + 2] = blue;
      rgba[at + 3] = 255;
    }
  }
  return rgba;
}

/** A height tile whose ground is `height(column, row)`. */
export function heightTileWebp(height: (column: number, row: number) => number): Uint8Array {
  return encodeLosslessWebp(heightRgba(height), HEIGHT_TILE_PIXELS, HEIGHT_TILE_PIXELS);
}

/** The flat block's height. */
export const FLAT_HEIGHT_METRES = 120;

/** A flat block: every pixel at {@link FLAT_HEIGHT_METRES}. */
export function flatHeightTile(): Uint8Array {
  return heightTileWebp(() => FLAT_HEIGHT_METRES);
}

/** The slope tile's height at its west edge. */
export const SLOPE_BASE_METRES = 200;

/**
 * A steady slope: the ground rises `risePerPixel` metres with every pixel
 * eastward from {@link SLOPE_BASE_METRES}, and is level north to south.
 */
export function slopeHeightTile(risePerPixel: number): Uint8Array {
  return heightTileWebp((column) => SLOPE_BASE_METRES + column * risePerPixel);
}

/** The valley tile's plateau, its floor, and the columns the valley lies between. */
export const VALLEY = {
  plateauMetres: 300,
  floorMetres: 240,
  westColumn: 236,
  eastColumn: 276,
} as const;

/**
 * A plateau cut by a V-shaped valley running north to south: level at
 * {@link VALLEY}`.plateauMetres` on both sides, falling to `.floorMetres`
 * halfway between `.westColumn` and `.eastColumn`. A bridge fixture crosses it
 * west to east.
 */
export function valleyHeightTile(): Uint8Array {
  const middle = (VALLEY.westColumn + VALLEY.eastColumn) / 2;
  const half = (VALLEY.eastColumn - VALLEY.westColumn) / 2;
  return heightTileWebp((column) => {
    const from = Math.abs(column + 0.5 - middle);
    if (from >= half) return VALLEY.plateauMetres;
    return VALLEY.floorMetres + ((VALLEY.plateauMetres - VALLEY.floorMetres) * from) / half;
  });
}

/**
 * A malformed tile: a true 512 × 512 header, and a body cut off after a few
 * hundred bytes. It passes the header check and a decoder must refuse it.
 */
export function truncatedHeightTile(): Uint8Array {
  const whole = flatHeightTile();
  const cut = whole.slice(0, 600);
  const view = new DataView(cut.buffer);
  view.setUint32(4, cut.length - 8, true);
  view.setUint32(16, cut.length - 20, true);
  return cut;
}

/**
 * An oversize tile: a few bytes of body under a header that states
 * 4,096 × 4,096 pixels, which a decoder trusting it would allocate 64 MiB for.
 */
export function oversizeHeightTile(): Uint8Array {
  return encodeLosslessWebp(new Uint8Array(4), 1, 1, {
    statedSize: { width: 4_096, height: 4_096 },
  });
}

/** A lossy WebP's container (`VP8 `) of the right stated size: not a height tile. */
export function lossyHeightTile(): Uint8Array {
  const bytes = flatHeightTile().slice(0, 64);
  bytes.set([0x56, 0x50, 0x38, 0x20], 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(4, bytes.length - 8, true);
  view.setUint32(16, bytes.length - 20, true);
  return bytes;
}

/** A tile whose every height is outside the range a height may take. */
export function outOfRangeHeightTile(): Uint8Array {
  return heightTileWebp(() => 9_000);
}

/** The cliff tile's two levels, and the column the edge is at. */
export const CLIFF = { topMetres: 500, footMetres: 420, edgeColumn: 256 } as const;

/**
 * A cliff edge: level ground at {@link CLIFF}`.topMetres` west of
 * `.edgeColumn`, and level ground 80 m lower east of it, with nothing between.
 * Every height is a plausible one; the step is not a road.
 */
export function cliffHeightTile(): Uint8Array {
  return heightTileWebp((column) =>
    column < CLIFF.edgeColumn ? CLIFF.topMetres : CLIFF.footMetres,
  );
}

/** The plateau tile's ground, its plateau, and the columns the plateau lies between. */
export const PLATEAU = {
  groundMetres: 100,
  topMetres: 150,
  westColumn: 200,
  eastColumn: 260,
} as const;

/**
 * A plateau inside the valid range (ADR 0087 D-3's hostile tile): level
 * ground with a block 50 m higher standing on it, sheer on both sides and far
 * wider than a median, so nothing but the step rule would refuse it.
 */
export function plateauHeightTile(): Uint8Array {
  return heightTileWebp((column) =>
    column >= PLATEAU.westColumn && column < PLATEAU.eastColumn
      ? PLATEAU.topMetres
      : PLATEAU.groundMetres,
  );
}
