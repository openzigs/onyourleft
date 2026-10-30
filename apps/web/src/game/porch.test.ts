// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #1589: a front porch's layout — `porch.ts` — held to its rules in its own
 * frame, before either writer turns it into triangles: the span along the
 * wall and where the steps go, the pitch its headroom leaves, the steps its
 * rise takes, and every piece of it.
 */

import { describe, expect, it } from 'vitest';

import {
  FRONT_PORCH,
  hipFits,
  porchPieces,
  porchPitchOf,
  porchReachOf,
  porchSpanOf,
  porchStepsOf,
  porchTriangleCount,
  porchTriangles,
  postLineOf,
  type PorchPiece,
  type PorchSpec,
} from './porch';

const { post, step } = FRONT_PORCH;

/** The clear width between two posts' faces. */
const opening = (left: number, right: number): number => right - left - post;

describe('a porch’s span along its wall — #1589', () => {
  it('centres four posts on the door, the steps in the middle bay with room for them', () => {
    const span = porchSpanOf({ left: 4, right: 4 }, 6, true, 1);
    if (span === undefined) throw new Error('no span');
    expect(span.posts).toHaveLength(4);
    expect(span.from).toBeCloseTo(-3, 9);
    expect(span.to).toBeCloseTo(3, 9);
    expect(span.stepsAt).toBe(0);
    const [, inner, outer] = span.posts as [number, number, number, number];
    expect(inner).toBeLessThan(0);
    expect(outer).toBeGreaterThan(0);
    expect(opening(inner, outer)).toBeGreaterThanOrEqual(step.width);
    // The corner posts stand inside the deck's ends.
    expect(span.posts[0]).toBeCloseTo(span.from + post / 2, 9);
    expect(span.posts[3]).toBeCloseTo(span.to - post / 2, 9);
  });

  it('runs a three-post porch on past the door, the door in the middle of the bay the steps are in', () => {
    for (const side of [1, -1] as const) {
      const span = porchSpanOf({ left: 4, right: 4 }, 4, false, side);
      if (span === undefined) throw new Error('no span');
      expect(span.posts).toHaveLength(3);
      // The door's bay: from the end post to the middle one, the door in its middle.
      const [first, middle, last] = span.posts as [number, number, number];
      const bay = side === 1 ? [first, middle] : [middle, last];
      expect(((bay[0] as number) + (bay[1] as number)) / 2).toBeCloseTo(
        side === 1 ? post / 4 : -post / 4,
        9,
      );
      expect(opening(bay[0] as number, bay[1] as number)).toBeGreaterThanOrEqual(step.width);
      // And the deck runs three quarters of its width on to `side`.
      expect(side === 1 ? span.to : -span.from).toBeCloseTo(3, 9);
      expect(side === 1 ? -span.from : span.to).toBeCloseTo(1, 9);
    }
  });

  it('keeps inside the room it is given, on the side it is short', () => {
    // A garage on the right: the room there is 1 m. Four posts would need 2.2 m.
    const span = porchSpanOf({ left: 4, right: 1 }, 6, true, 1);
    if (span === undefined) throw new Error('no span');
    expect(span.to).toBeLessThanOrEqual(1 + 1e-9);
    expect(-span.from).toBeLessThanOrEqual(4 + 1e-9);
    expect(span.posts).toHaveLength(3);
  });

  it('has none where neither count fits', () => {
    expect(porchSpanOf({ left: 0.6, right: 0.6 }, 6, true, 1)).toBeUndefined();
    // Control: a little more room has one.
    expect(porchSpanOf({ left: 2.5, right: 2.5 }, 6, true, 1)).toBeDefined();
  });

  it('keeps the steps, centred on the door, off every post, at every width it lays out — #1601', () => {
    // The steps' half-width and the opening's little either side of them.
    const clearance = step.width / 2 + 0.05;
    let three = 0;
    for (let width = 2.5; width <= 4.5 + 1e-9; width += 0.005) {
      for (const four of [true, false]) {
        for (const side of [1, -1] as const) {
          const span = porchSpanOf({ left: 4, right: 4 }, width, four, side);
          if (span === undefined) continue;
          if (span.posts.length === 3) three += 1;
          for (const at of span.posts) {
            expect(Math.abs(at - span.stepsAt) - post / 2).toBeGreaterThanOrEqual(clearance - 1e-9);
          }
        }
      }
    }
    // Control: three-post spans were laid out, down to the narrowest that fits.
    expect(three).toBeGreaterThan(100);
    expect(porchSpanOf({ left: 4, right: 4 }, 4 * (clearance + post), false, 1)).toBeDefined();
  });
});

describe('its pitch and its steps — #1589', () => {
  it('lowers the pitch until the header leaves headroom over the deck, and has none past the least', () => {
    const floor = 0.4;
    const depth = 2;
    const run = postLineOf(depth) + post / 2;
    // Plenty of wall: the pitch wanted.
    expect(porchPitchOf(floor, floor + 4, depth, 14)).toBeCloseTo(14, 9);
    // Less: lowered so the header's foot is the headroom up, exactly.
    const wallY = floor + 2.75;
    const lowered = porchPitchOf(floor, wallY, depth, 14);
    if (lowered === undefined) throw new Error('no pitch');
    expect(lowered).toBeLessThan(14);
    const headerFoot =
      wallY -
      FRONT_PORCH.thickness -
      run * Math.tan((lowered * Math.PI) / 180) -
      FRONT_PORCH.header;
    expect(headerFoot - floor).toBeCloseTo(FRONT_PORCH.headroom, 9);
    // Too little: none.
    expect(porchPitchOf(floor, floor + 2.4, depth, 14)).toBeUndefined();
  });

  it('takes two or three steps, never a riser past the tallest, and none where three are not enough', () => {
    expect(porchStepsOf(0.3)).toBe(2);
    expect(porchStepsOf(0.55)).toBe(2);
    expect(porchStepsOf(0.72)).toBe(3);
    expect(porchStepsOf(1)).toBe(3);
    expect(porchStepsOf(1.01)).toBeUndefined();
    for (let rise = 0.1; rise <= 1; rise += 0.05) {
      const steps = porchStepsOf(rise) as number;
      expect(rise / (steps + 1)).toBeLessThanOrEqual(step.mostRiser + 1e-9);
    }
  });

  it('takes a hip roof only where its two hips do not meet', () => {
    expect(hipFits(6, 2)).toBe(true);
    expect(hipFits(4, 2)).toBe(false);
  });
});

/** A porch as a mapped house might have it. */
const SPEC: PorchSpec = {
  ...(porchSpanOf({ left: 4, right: 4 }, 6, true, 1) as NonNullable<
    ReturnType<typeof porchSpanOf>
  >),
  depth: 2.2,
  floor: 0.5,
  ground: 0,
  footing: -0.3,
  wallY: 3.2,
  roof: 'shed',
  pitchDegrees: porchPitchOf(0.5, 3.2, 2.2, FRONT_PORCH.pitchDegrees.shed) as number,
  steps: 2,
};

const ofPart = (pieces: readonly PorchPiece[], part: PorchPiece['part']): PorchPiece[] =>
  pieces.filter((piece) => piece.part === part);

describe('its pieces — #1589', () => {
  for (const roof of ['shed', 'hip'] as const) {
    const pieces = porchPieces({ ...SPEC, roof });

    it(`lays the deck at the floor and its skirt into the ground (${roof})`, () => {
      const deck = ofPart(pieces, 'deck');
      const top = deck.filter((piece) => piece.normal[2] === 1);
      expect(top).toHaveLength(1);
      for (const [a, n, y] of (top[0] as PorchPiece).corners) {
        expect(y).toBe(SPEC.floor);
        expect(a).toBeGreaterThanOrEqual(SPEC.from);
        expect(a).toBeLessThanOrEqual(SPEC.to);
        expect(n).toBeGreaterThanOrEqual(0);
        expect(n).toBeLessThanOrEqual(SPEC.depth);
      }
      expect(Math.min(...deck.flatMap((piece) => piece.corners.map((p) => p[2])))).toBe(
        SPEC.footing,
      );
    });

    it(`ties the roof to the wall at its top and overhangs the deck (${roof})`, () => {
      const slopes = ofPart(pieces, 'roof');
      expect(slopes).toHaveLength(roof === 'hip' ? 3 : 1);
      const corners = slopes.flatMap((piece) => piece.corners);
      expect(Math.max(...corners.map((p) => p[2]))).toBeCloseTo(SPEC.wallY, 9);
      // Only at the wall is it that high.
      for (const [, n, y] of corners) if (y > SPEC.wallY - 1e-9) expect(n).toBe(0);
      expect(Math.max(...corners.map((p) => p[1]))).toBeCloseTo(
        SPEC.depth + FRONT_PORCH.overhang,
        9,
      );
      expect(Math.min(...corners.map((p) => p[0]))).toBeCloseTo(
        SPEC.from - FRONT_PORCH.overhang,
        9,
      );
      // A ceiling under each slope, a roof's thickness down and facing down.
      const ceiling = ofPart(pieces, 'ceiling');
      expect(ceiling).toHaveLength(slopes.length);
      for (const piece of ceiling) expect(piece.normal[2]).toBeLessThan(-0.9);
      for (const piece of slopes) expect(piece.normal[2]).toBeGreaterThan(0.9);
    });

    it(`stands its posts on the deck up to the header, with headroom (${roof})`, () => {
      const posts = ofPart(pieces, 'post');
      const heights = posts.flatMap((piece) => piece.corners.map((p) => p[2]));
      expect(Math.min(...heights)).toBe(SPEC.floor);
      // Four sides a post, and the header's front, back and foot.
      expect(posts).toHaveLength(4 * SPEC.posts.length + 3);
      const header = posts.filter((piece) => piece.normal[2] === -1)[0] as PorchPiece;
      expect((header.corners[0] as readonly number[])[2] as number).toBeGreaterThanOrEqual(
        SPEC.floor + FRONT_PORCH.headroom - 1e-9,
      );
    });

    it(`rails every bay but the steps’ and both ends, a quad each way (${roof})`, () => {
      const rails = ofPart(pieces, 'railing');
      // Four posts: the two outer bays and the two ends, each seen from both sides.
      expect(rails).toHaveLength(2 * 4);
      for (const piece of rails) {
        expect(piece.railing?.height).toBe(FRONT_PORCH.railing.height);
        const along = piece.corners.map((p) => p[0]);
        const across = piece.corners.map((p) => p[1]);
        // None crosses the steps' bay.
        const steps = [SPEC.stepsAt - step.width / 2, SPEC.stepsAt + step.width / 2] as const;
        const front = Math.min(...across) > 0.5;
        if (front) {
          expect(Math.max(...along) <= steps[0] || Math.min(...along) >= steps[1]).toBe(true);
        }
      }
    });

    it(`steps down to the ground in equal risers, out from the deck (${roof})`, () => {
      const steps = ofPart(pieces, 'step');
      expect(steps).toHaveLength(4 * SPEC.steps);
      const treads = steps
        .filter((piece) => piece.normal[2] === 1)
        .map((piece) => (piece.corners[0] as readonly number[])[2] as number)
        .sort((p, q) => q - p);
      const riser = (SPEC.floor - SPEC.ground) / (SPEC.steps + 1);
      treads.forEach((y, index) => expect(y).toBeCloseTo(SPEC.floor - (index + 1) * riser, 9));
      // The last riser is down to the ground.
      expect((treads[treads.length - 1] as number) - riser).toBeCloseTo(SPEC.ground, 9);
      const out = Math.max(...steps.flatMap((piece) => piece.corners.map((p) => p[1])));
      expect(out).toBeCloseTo(SPEC.depth + SPEC.steps * step.tread, 9);
      expect(porchReachOf(SPEC)).toBeCloseTo(Math.max(out, SPEC.depth + FRONT_PORCH.overhang), 9);
    });

    it(`is about a hundred triangles, as it is counted without being made (${roof})`, () => {
      const count = porchTriangles(pieces);
      for (const steps of [2, 3]) {
        for (const four of [true, false]) {
          const span = porchSpanOf({ left: 4, right: 4 }, 6, four, 1) as NonNullable<
            ReturnType<typeof porchSpanOf>
          >;
          const each = { ...SPEC, ...span, roof, steps };
          expect(porchTriangleCount(each)).toBe(porchTriangles(porchPieces(each)));
        }
      }
      expect(count).toBeGreaterThanOrEqual(75);
      expect(count).toBeLessThanOrEqual(150);
    });
  }

  it('winds every piece to the normal it is drawn facing', () => {
    for (const roof of ['shed', 'hip'] as const) {
      for (const piece of porchPieces({ ...SPEC, roof })) {
        const [a, b, c] = piece.corners as readonly (readonly number[])[] as readonly [
          readonly number[],
          readonly number[],
          readonly number[],
        ];
        const u = [0, 1, 2].map((k) => (b[k] as number) - (a[k] as number));
        const v = [0, 1, 2].map((k) => (c[k] as number) - (a[k] as number));
        const cross = [
          (u[1] as number) * (v[2] as number) - (u[2] as number) * (v[1] as number),
          (u[2] as number) * (v[0] as number) - (u[0] as number) * (v[2] as number),
          (u[0] as number) * (v[1] as number) - (u[1] as number) * (v[0] as number),
        ];
        const length = Math.hypot(...cross);
        expect(length).toBeGreaterThan(0);
        // Parallel to the normal, either way: the writers wind from it.
        const along = cross.reduce((sum, each, k) => sum + each * (piece.normal[k] as number), 0);
        expect(Math.abs(along) / length).toBeCloseTo(Math.hypot(...piece.normal), 6);
      }
    }
  });
});
