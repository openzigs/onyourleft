// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * An edge of the drawn road, walked in chords and read for kinks — moved out
 * of `bend-harness.ts` by #572, unchanged, because the loop page now reads the
 * same thing at the start of a loop.
 *
 * ⚠️ **What is reported is the KINK, not the turn**: each turn less the mean of
 * the two either side of it. `bend-harness.ts`'s header says why the turn alone
 * cannot tell a curve from a corner.
 */

/** How long each step along an edge is, in metres: the corridor's own step. */
export const CHORD_METRES = 2;

/** One edge of the road, as the pixels have it. */
export interface EdgeReading {
  /** How many chords of {@link CHORD_METRES} the edge was walked in. */
  readonly chords: number;
  /** How far the edge turned in all, in degrees. */
  readonly turnedDegrees: number;
  /** The largest kink — a turn less the mean of its neighbours — in degrees. */
  readonly worstKinkDegrees: number;
}

/** The direction of the least-squares line through some points, in radians. */
function fittedDirection(points: ReadonlyArray<readonly [number, number]>): number {
  let meanX = 0;
  let meanY = 0;
  for (const [x, y] of points) {
    meanX += x / points.length;
    meanY += y / points.length;
  }
  let xx = 0;
  let xy = 0;
  let yy = 0;
  for (const [x, y] of points) {
    xx += (x - meanX) ** 2;
    xy += (x - meanX) * (y - meanY);
    yy += (y - meanY) ** 2;
  }
  // The principal axis, oriented from the first point toward the last.
  let direction = 0.5 * Math.atan2(2 * xy, xx - yy);
  const [firstX, firstY] = points[0] as readonly [number, number];
  const [lastX, lastY] = points[points.length - 1] as readonly [number, number];
  if (Math.cos(direction) * (lastX - firstX) + Math.sin(direction) * (lastY - firstY) < 0) {
    direction += Math.PI;
  }
  return direction;
}

/** Walks an edge in chords of {@link CHORD_METRES} and reads its turns and kinks. */
export function readEdge(
  runs: Array<readonly [number, number]>[],
  pixelsPerMetre: number,
): EdgeReading {
  const chordPixels = CHORD_METRES * pixelsPerMetre;
  let chords = 0;
  let turned = 0;
  let worst = 0;
  for (const run of runs) {
    const pieces: Array<Array<readonly [number, number]>> = [];
    let piece: Array<readonly [number, number]> = [];
    let length = 0;
    for (let index = 0; index < run.length; index += 1) {
      const point = run[index] as readonly [number, number];
      const previous = run[index - 1];
      if (previous !== undefined)
        length += Math.hypot(point[0] - previous[0], point[1] - previous[1]);
      piece.push(point);
      if (length >= chordPixels) {
        pieces.push(piece);
        piece = [point];
        length = 0;
      }
    }
    const directions = pieces.filter((each) => each.length >= 3).map(fittedDirection);
    const turns: number[] = [];
    for (let index = 1; index < directions.length; index += 1) {
      let turn = (directions[index] as number) - (directions[index - 1] as number);
      while (turn > Math.PI) turn -= 2 * Math.PI;
      while (turn < -Math.PI) turn += 2 * Math.PI;
      turns.push(turn);
    }
    chords += directions.length;
    for (let index = 0; index < turns.length; index += 1) {
      turned += turns[index] as number;
      const before = turns[index - 1];
      const after = turns[index + 1];
      if (before === undefined || after === undefined) continue;
      const kink = Math.abs((turns[index] as number) - (before + after) / 2);
      worst = Math.max(worst, kink);
    }
  }
  return {
    chords,
    turnedDegrees: Math.abs((turned * 180) / Math.PI),
    worstKinkDegrees: (worst * 180) / Math.PI,
  };
}
