// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A front porch, laid out — #1589, the owner's ruling of 2026-10-22 on the
 * building detail pass.
 *
 * One layout, two writers: a mapped house's plan (`footprint-buildings.ts`,
 * on the wall nearest the road, around the front door) and #1550's lot house
 * (`buildings.ts`, on the farmhouse's front). Both hand {@link porchPieces} a
 * {@link PorchSpec} and turn each piece it returns into their own triangles,
 * so the porch is the same shape on either and its rules are held here once.
 *
 * ## The frame
 *
 * Every point is `[a, n, y]`: `a` metres along the wall, rightwards seen from
 * outside, from the front door's middle; `n` metres out from the wall's face;
 * `y` metres up, in the writer's own heights. A normal is in the same frame.
 *
 * ## The parts
 *
 * - a **deck** at the floor's height, its skirt down to a footing in the
 *   ground (`deck`);
 * - **posts**, three or four, on the deck's front, and a **header** beam over
 *   them (`post`);
 * - a **shed** or **hip** roof tied to the wall under the eaves, overhanging
 *   the deck ({@link FRONT_PORCH}'s `overhang`), with its **ceiling** under
 *   it (`roof`, `ceiling`) and a **fascia** round its edge (`fascia`);
 * - a **railing** — one quad, seen from both sides — between every pair of
 *   posts but the pair the steps are between, and along both ends of the
 *   deck to the wall (`railing`); a mapped house's shader draws its rails and
 *   balusters on it;
 * - **two or three steps** down from the deck to the ground, centred on the
 *   door (`step`).
 *
 * About 75 to 100 triangles, all of them near: the far level is the walls and
 * the roof, and a porch is neither, so far off it folds into the wall it
 * stands against. No coordinate is formatted into any string here.
 */

/** A point or a direction in a porch's frame: along the wall, out from it, up. */
export type PorchPoint = readonly [a: number, n: number, y: number];

/** What a piece of a porch is. */
export type PorchPart = 'deck' | 'ceiling' | 'post' | 'railing' | 'step' | 'roof' | 'fascia';

/** One flat piece of a porch: a triangle or a quad, its corners in order round it. */
export interface PorchPiece {
  readonly part: PorchPart;
  readonly corners: readonly PorchPoint[];
  readonly normal: PorchPoint;
  /** A railing's quad: its length and its height, in metres. */
  readonly railing?: { readonly length: number; readonly height: number };
}

/** The roof shapes a porch has. */
export type PorchRoof = 'shed' | 'hip';

/**
 * A front porch's sizes — #1589.
 *
 * - `share`: of residential houses with a front door, the share that are
 *   given one, seeded per footprint — **0.55**, so that with those the road
 *   or a neighbour drops about half have one;
 * - `width`, `depth`: the seeded range of the deck's, metres; a deck is
 *   shortened by `shorten` at a time, down to `leastDepth`, where it would
 *   reach the road's clearance, and dropped below that;
 * - `endMargin`: how far the deck keeps from either end of its wall, and
 *   from a garage's bay, so its roof clears a corner's downpipe;
 * - `post`: a post's breadth, `postInset` its face's from the deck's edge;
 * - `header`: the depth of the beam over the posts;
 * - `overhang`, `thickness`: the roof's past the deck, and its own;
 * - `pitchDegrees`: a shed's and a hip's, lowered (to `leastPitchDegrees`,
 *   and dropped below it) for `headroom` under the header;
 * - `hipShare`: of porches, the share with a hip roof where it fits;
 * - `fourPostShare`: the share with four posts where they fit;
 * - `railing`: its height, the top rail's depth, the bottom rail's span up
 *   from the deck, a baluster's breadth and their spacing;
 * - `step`: a tread's depth, the steps' width, the riser they are counted
 *   from, and the tallest riser a porch may have before it is dropped.
 */
export const FRONT_PORCH = {
  share: 0.55,
  width: { least: 3.5, most: 6.4 },
  depth: { least: 1.8, most: 2.4 },
  shorten: 0.2,
  leastDepth: 1.4,
  endMargin: 0.5,
  post: 0.14,
  postInset: 0.05,
  header: 0.15,
  overhang: 0.25,
  thickness: 0.12,
  pitchDegrees: { shed: 14, hip: 20 },
  leastPitchDegrees: 5,
  headroom: 2.1,
  hipShare: 0.4,
  fourPostShare: 0.5,
  railing: { height: 0.9, rail: 0.07, bottom: [0.06, 0.12], baluster: 0.045, spacing: 0.13 },
  step: { tread: 0.3, width: 1.2, riser: 0.18, mostRiser: 0.25 },
} as const;

/** The least clear opening, between two posts, the steps are put in: their width and a little. */
const STEP_OPENING = FRONT_PORCH.step.width + 0.1;

/** How far a post's middle is out from the wall, on a deck `depth` deep. */
export function postLineOf(depth: number): number {
  return depth - FRONT_PORCH.postInset - FRONT_PORCH.post / 2;
}

/**
 * Where a porch's deck and posts go along its wall, from the door's middle:
 * its two ends and its posts' middles, in order, and the steps' middle.
 */
export interface PorchSpan {
  readonly from: number;
  readonly to: number;
  readonly posts: readonly number[];
  readonly stepsAt: number;
}

/**
 * A porch's span along its wall — #1589. `room` is how far the deck may run
 * either side of the door, `[−left, right]`; `width` the seeded width wanted;
 * `four` whether four posts are wanted, and `side` which way a three-post
 * porch runs on past the door (`1` rightwards).
 *
 * - **Four posts**: the deck centred on the door, its posts evenly spaced,
 *   and the steps in the middle bay, which is wide enough for them.
 * - **Three posts**: the door in the middle of one of its two bays, the steps
 *   in front of it, and the deck running on past the middle post to `side`.
 *
 * The wanted shape where it fits, else the other count, else the other side;
 * `undefined` where none fits the room.
 */
export function porchSpanOf(
  room: { readonly left: number; readonly right: number },
  width: number,
  four: boolean,
  side: 1 | -1,
): PorchSpan | undefined {
  const { post } = FRONT_PORCH;
  const fourSpan = (): PorchSpan | undefined => {
    const w = Math.min(width, 2 * Math.min(room.left, room.right));
    if (w / 3 - post < STEP_OPENING) return undefined;
    const half = w / 2;
    const posts = [-half, -half / 3, half / 3, half].map(
      (at, index) => at + (index === 0 ? post / 2 : index === 3 ? -post / 2 : 0),
    );
    return { from: -half, to: half, posts, stepsAt: 0 };
  };
  const threeSpan = (towards: 1 | -1): PorchSpan | undefined => {
    // The door at the middle of the near bay: a quarter of the width behind it, three ahead.
    const behind = towards === 1 ? room.left : room.right;
    const ahead = towards === 1 ? room.right : room.left;
    const w = Math.min(width, 4 * behind, (4 * ahead) / 3);
    // #1601: the bay is `w / 2` between the posts' middles, but the end post
    // stands a whole breadth inside it and the middle post half of one, so
    // the steps, centred on the door, are nearer the end post: each side of
    // the door keeps half the opening from the post's face, as four do.
    if (w / 4 - post < STEP_OPENING / 2) return undefined;
    const ends = [-w / 4, (3 * w) / 4].map((at) => at * towards).sort((p, q) => p - q) as [
      number,
      number,
    ];
    const [from, to] = ends;
    const posts = [from + post / 2, (w / 4) * towards, to - post / 2].sort((p, q) => p - q);
    return { from, to, posts, stepsAt: 0 };
  };
  const tries = four
    ? [fourSpan, () => threeSpan(side), () => threeSpan(side === 1 ? -1 : 1)]
    : [() => threeSpan(side), () => threeSpan(side === 1 ? -1 : 1), fourSpan];
  for (const attempt of tries) {
    const span = attempt();
    if (span !== undefined) return span;
  }
  return undefined;
}

/** A porch, decided: everything {@link porchPieces} draws it from. */
export interface PorchSpec extends PorchSpan {
  /** How far the deck reaches out from the wall. */
  readonly depth: number;
  /** The deck's top: the house's floor. */
  readonly floor: number;
  /** The ground at the foot of the steps. */
  readonly ground: number;
  /** How low the deck's skirt and the steps' sides reach: into the ground. */
  readonly footing: number;
  /** Where the roof's top meets the wall. */
  readonly wallY: number;
  readonly roof: PorchRoof;
  readonly pitchDegrees: number;
  /** Two or three. */
  readonly steps: number;
}

/**
 * The tallest a porch's roof may be tied to its wall for the header over its
 * posts to leave {@link FRONT_PORCH}'s headroom over the deck, and the pitch
 * that leaves it — #1589. `wallY` is where the roof may meet the wall at the
 * most, `wanted` the pitch wanted; the pitch is lowered until the headroom
 * is there, and `undefined` where it would be below the least.
 */
export function porchPitchOf(
  floor: number,
  wallY: number,
  depth: number,
  wanted: number,
): number | undefined {
  const { thickness, header, headroom, leastPitchDegrees } = FRONT_PORCH;
  const run = postLineOf(depth) + FRONT_PORCH.post / 2;
  const most = (wallY - thickness - header - floor - headroom) / run;
  const tan = Math.min(Math.tan((wanted * Math.PI) / 180), most);
  const degrees = (Math.atan(tan) * 180) / Math.PI;
  return degrees >= leastPitchDegrees ? degrees : undefined;
}

/**
 * How many steps a porch has down to ground `rise` metres below its deck, or
 * `undefined` where it is too high for three — #1589: one fewer than its
 * risers at {@link FRONT_PORCH}'s `step.riser`, two or three, and none taller
 * than its `mostRiser`.
 */
export function porchStepsOf(rise: number): number | undefined {
  const { riser, mostRiser } = FRONT_PORCH.step;
  const steps = Math.min(3, Math.max(2, Math.round(rise / riser) - 1));
  return rise / (steps + 1) <= mostRiser ? steps : undefined;
}

/** How far out from the wall a porch reaches, its roof's overhang and its steps together. */
export function porchReachOf(spec: { readonly depth: number; readonly steps: number }): number {
  return Math.max(
    spec.depth + FRONT_PORCH.overhang,
    spec.depth + spec.steps * FRONT_PORCH.step.tread,
  );
}

/** Whether a porch `width` along by `depth` out takes a hip roof: its two hips must not meet. */
export function hipFits(width: number, depth: number): boolean {
  const { overhang } = FRONT_PORCH;
  return width + 2 * overhang > 2 * (depth + overhang) + 0.2;
}

/**
 * Every piece of a porch — #1589, in the frame {@link PorchPoint} names. See
 * this file's header for what each part is; {@link FRONT_PORCH} holds the
 * sizes, and `spec` the rest.
 */
export function porchPieces(spec: PorchSpec): PorchPiece[] {
  const { from, to, posts, stepsAt, depth, floor, ground, footing, wallY } = spec;
  const { overhang, thickness, post, header, railing } = FRONT_PORCH;
  const pieces: PorchPiece[] = [];
  const add = (
    part: PorchPart,
    corners: readonly PorchPoint[],
    normal: PorchPoint,
    extra?: PorchPiece['railing'],
  ): void => {
    pieces.push(
      extra === undefined ? { part, corners, normal } : { part, corners, normal, railing: extra },
    );
  };
  const below = (p: PorchPoint): PorchPoint => [p[0], p[1], p[2] - thickness];
  const flip = (n: PorchPoint): PorchPoint => [-n[0], -n[1], -n[2]];

  // The deck: its floor, and its skirt on three sides down into the ground.
  add(
    'deck',
    [
      [from, 0, floor],
      [to, 0, floor],
      [to, depth, floor],
      [from, depth, floor],
    ],
    [0, 0, 1],
  );
  add(
    'deck',
    [
      [from, depth, footing],
      [to, depth, footing],
      [to, depth, floor],
      [from, depth, floor],
    ],
    [0, 1, 0],
  );
  for (const [a, sign] of [
    [from, -1],
    [to, 1],
  ] as const) {
    add(
      'deck',
      [
        [a, 0, footing],
        [a, depth, footing],
        [a, depth, floor],
        [a, 0, floor],
      ],
      [sign, 0, 0],
    );
  }

  // The roof, its ceiling and its fascia.
  const pitch = (spec.pitchDegrees * Math.PI) / 180;
  const tan = Math.tan(pitch);
  const sin = Math.sin(pitch);
  const cos = Math.cos(pitch);
  const a0 = from - overhang;
  const a1 = to + overhang;
  const n1 = depth + overhang;
  const low = wallY - n1 * tan;
  const slope = (corners: readonly PorchPoint[], normal: PorchPoint): void => {
    add('roof', corners, normal);
    add('ceiling', corners.map(below), flip(normal));
  };
  const fascia = (corners: readonly PorchPoint[], normal: PorchPoint): void => {
    add('fascia', corners, normal);
  };
  const front: PorchPoint = [0, sin, cos];
  if (spec.roof === 'hip') {
    const r0 = a0 + n1;
    const r1 = a1 - n1;
    slope(
      [
        [a0, n1, low],
        [a1, n1, low],
        [r1, 0, wallY],
        [r0, 0, wallY],
      ],
      front,
    );
    slope(
      [
        [a0, 0, low],
        [a0, n1, low],
        [r0, 0, wallY],
      ],
      [-sin, 0, cos],
    );
    slope(
      [
        [a1, n1, low],
        [a1, 0, low],
        [r1, 0, wallY],
      ],
      [sin, 0, cos],
    );
    for (const [a, sign] of [
      [a0, -1],
      [a1, 1],
    ] as const) {
      fascia(
        [
          [a, 0, low - thickness],
          [a, n1, low - thickness],
          [a, n1, low],
          [a, 0, low],
        ],
        [sign, 0, 0],
      );
    }
  } else {
    slope(
      [
        [a0, n1, low],
        [a1, n1, low],
        [a1, 0, wallY],
        [a0, 0, wallY],
      ],
      front,
    );
    for (const [a, sign] of [
      [a0, -1],
      [a1, 1],
    ] as const) {
      fascia(
        [
          [a, 0, wallY - thickness],
          [a, n1, low - thickness],
          [a, n1, low],
          [a, 0, wallY],
        ],
        [sign, 0, 0],
      );
    }
  }
  fascia(
    [
      [a0, n1, low - thickness],
      [a1, n1, low - thickness],
      [a1, n1, low],
      [a0, n1, low],
    ],
    [0, 1, 0],
  );

  // The header over the posts, under the ceiling at its lower edge, and the posts up to it.
  const line = postLineOf(depth);
  const half = post / 2;
  const headerTop = wallY - thickness - (line + half) * tan;
  const postTop = headerTop - header;
  const first = posts[0] as number;
  const last = posts[posts.length - 1] as number;
  add(
    'post',
    [
      [first - half, line + half, postTop],
      [last + half, line + half, postTop],
      [last + half, line + half, headerTop],
      [first - half, line + half, headerTop],
    ],
    [0, 1, 0],
  );
  add(
    'post',
    [
      [first - half, line - half, postTop],
      [last + half, line - half, postTop],
      [last + half, line - half, headerTop],
      [first - half, line - half, headerTop],
    ],
    [0, -1, 0],
  );
  add(
    'post',
    [
      [first - half, line - half, postTop],
      [last + half, line - half, postTop],
      [last + half, line + half, postTop],
      [first - half, line + half, postTop],
    ],
    [0, 0, -1],
  );
  for (const at of posts) {
    const sides: readonly (readonly [PorchPoint, PorchPoint, PorchPoint])[] = [
      [
        [at - half, line + half, 0],
        [at + half, line + half, 0],
        [0, 1, 0],
      ],
      [
        [at + half, line - half, 0],
        [at - half, line - half, 0],
        [0, -1, 0],
      ],
      [
        [at + half, line + half, 0],
        [at + half, line - half, 0],
        [1, 0, 0],
      ],
      [
        [at - half, line - half, 0],
        [at - half, line + half, 0],
        [-1, 0, 0],
      ],
    ];
    for (const [p, q, normal] of sides) {
      add(
        'post',
        [
          [p[0], p[1], floor],
          [q[0], q[1], floor],
          [q[0], q[1], postTop],
          [p[0], p[1], postTop],
        ],
        normal,
      );
    }
  }

  // The railing: a quad each way along each run, its pattern the writer's.
  const rail = (p: readonly [number, number], q: readonly [number, number]): void => {
    const length = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (!(length > 0.05)) return;
    const top = floor + railing.height;
    const out: PorchPoint = [(q[1] - p[1]) / length, -(q[0] - p[0]) / length, 0];
    const corners: PorchPoint[] = [
      [p[0], p[1], floor],
      [q[0], q[1], floor],
      [q[0], q[1], top],
      [p[0], p[1], top],
    ];
    add('railing', corners, out, { length, height: railing.height });
    add('railing', corners, flip(out), { length, height: railing.height });
  };
  for (let at = 0; at + 1 < posts.length; at += 1) {
    const left = posts[at] as number;
    const right = posts[at + 1] as number;
    if (stepsAt > left && stepsAt < right) continue;
    rail([left + half, line], [right - half, line]);
  }
  rail([first, 0], [first, line - half]);
  rail([last, line - half], [last, 0]);

  // The steps, down from the deck's edge to the ground.
  const { tread, width } = FRONT_PORCH.step;
  const riser = (floor - ground) / (spec.steps + 1);
  const s0 = stepsAt - width / 2;
  const s1 = stepsAt + width / 2;
  for (let step = 1; step <= spec.steps; step += 1) {
    const top = floor - step * riser;
    const n0 = depth + (step - 1) * tread;
    const nt = depth + step * tread;
    add(
      'step',
      [
        [s0, n0, top],
        [s1, n0, top],
        [s1, nt, top],
        [s0, nt, top],
      ],
      [0, 0, 1],
    );
    add(
      'step',
      [
        [s0, nt, footing],
        [s1, nt, footing],
        [s1, nt, top],
        [s0, nt, top],
      ],
      [0, 1, 0],
    );
    for (const [a, sign] of [
      [s0, -1],
      [s1, 1],
    ] as const) {
      add(
        'step',
        [
          [a, n0, footing],
          [a, nt, footing],
          [a, nt, top],
          [a, n0, top],
        ],
        [sign, 0, 0],
      );
    }
  }
  return pieces;
}

/**
 * How many triangles {@link porchPieces} makes of `spec`, without making them
 * — #1589: the deck's 8, the roof's (a shed's 10, a hip's 14 with its ceiling
 * and fascia), the header's 6, and each post's 8, rail run's 4 (a post a
 * run) and step's 8. A mapped plan counts its porch by this at the press and
 * writes it when it is first drawn.
 */
export function porchTriangleCount(spec: PorchSpec): number {
  const posts = spec.posts.length;
  return 8 + (spec.roof === 'hip' ? 14 : 10) + 6 + 8 * posts + 4 * posts + 8 * spec.steps;
}

/**
 * How many triangles a porch's pieces are: a quad two, a triangle one.
 *
 * @test-facing held by `porch.test.ts` and `front-porches.test.ts`, which state
 * a porch's cost; each writer counts the triangles it writes
 */
export function porchTriangles(pieces: readonly PorchPiece[]): number {
  return pieces.reduce((sum, piece) => sum + piece.corners.length - 2, 0);
}
