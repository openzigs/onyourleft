// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The framing check and its tolerances — #528, ADR 0033 D-7.
 *
 * Each tolerance is held from BOTH sides: a placement just inside it matches
 * and one just outside it differs. A test on one side only passes for a
 * tolerance of infinity, or of zero.
 */

import { describe, expect, it } from 'vitest';
import type { FramingReferenceRecord } from '@onyourleft/store';

import {
  ASSUMED_HORIZONTAL_FIELD_OF_VIEW_DEGREES,
  FRAMING_GUIDE,
  FRAMING_LANDMARKS,
  framingReferenceFrom,
  framingVerdict,
  guideScaleFor,
  MAXIMUM_ASPECT_CHANGE,
  MAXIMUM_SCALE_CHANGE,
  MAXIMUM_VIEW_TURN_DEGREES,
  MINIMUM_SHARED_LANDMARKS,
  referenceOutline,
  type FramingReference,
} from './framing';

const ASPECT = 16 / 9;

/** A rider seen side-on. */
const RIDER: FramingReference = {
  aspect: ASPECT,
  landmarks: [
    { name: 'ear', x: 0.55, y: 0.15 },
    { name: 'shoulder', x: 0.52, y: 0.3 },
    { name: 'elbow', x: 0.6, y: 0.42 },
    { name: 'wrist', x: 0.66, y: 0.5 },
    { name: 'hip', x: 0.42, y: 0.45 },
    { name: 'knee', x: 0.52, y: 0.62 },
    { name: 'ankle', x: 0.47, y: 0.82 },
  ],
};

/** The rider moved by a share of the picture's width and height. */
function shifted(reference: FramingReference, dx: number, dy: number): FramingReference {
  return {
    ...reference,
    landmarks: reference.landmarks.map((each) => ({ ...each, x: each.x + dx, y: each.y + dy })),
  };
}

/** The rider scaled about their own centre. */
function scaled(reference: FramingReference, factor: number): FramingReference {
  const cx =
    reference.landmarks.reduce((sum, each) => sum + each.x, 0) / reference.landmarks.length;
  const cy =
    reference.landmarks.reduce((sum, each) => sum + each.y, 0) / reference.landmarks.length;
  return {
    ...reference,
    landmarks: reference.landmarks.map((each) => ({
      ...each,
      x: cx + (each.x - cx) * factor,
      y: cy + (each.y - cy) * factor,
    })),
  };
}

/** The share of the width that turns the view by `degrees`. */
const widthShareFor = (degrees: number): number =>
  degrees / ASSUMED_HORIZONTAL_FIELD_OF_VIEW_DEGREES;

describe('the framing check', () => {
  it('matches the same placement', () => {
    expect(framingVerdict(RIDER, RIDER)).toBe('matches');
  });

  it('holds the view-turn tolerance from both sides, across the picture', () => {
    expect(
      framingVerdict(RIDER, shifted(RIDER, widthShareFor(MAXIMUM_VIEW_TURN_DEGREES * 0.95), 0)),
    ).toBe('matches');
    expect(
      framingVerdict(RIDER, shifted(RIDER, widthShareFor(MAXIMUM_VIEW_TURN_DEGREES * 1.05), 0)),
    ).toBe('differs');
  });

  it('holds it down the picture too, which is the tripod’s height', () => {
    // The vertical field of view is the horizontal one narrowed by the shape.
    const half = (ASSUMED_HORIZONTAL_FIELD_OF_VIEW_DEGREES * Math.PI) / 360;
    const verticalDegrees = (2 * Math.atan(Math.tan(half) / ASPECT) * 180) / Math.PI;
    const heightShareFor = (degrees: number): number => degrees / verticalDegrees;
    expect(
      framingVerdict(RIDER, shifted(RIDER, 0, heightShareFor(MAXIMUM_VIEW_TURN_DEGREES * 0.95))),
    ).toBe('matches');
    expect(
      framingVerdict(RIDER, shifted(RIDER, 0, heightShareFor(MAXIMUM_VIEW_TURN_DEGREES * 1.05))),
    ).toBe('differs');
  });

  it('holds the size tolerance from both sides, nearer and further', () => {
    for (const direction of [1, -1]) {
      expect(
        framingVerdict(RIDER, scaled(RIDER, 1 + direction * MAXIMUM_SCALE_CHANGE * 0.95)),
      ).toBe('matches');
      expect(
        framingVerdict(RIDER, scaled(RIDER, 1 + direction * MAXIMUM_SCALE_CHANGE * 1.05)),
      ).toBe('differs');
    }
  });

  it('holds the shape tolerance from both sides', () => {
    expect(
      framingVerdict(RIDER, { ...RIDER, aspect: ASPECT * (1 + MAXIMUM_ASPECT_CHANGE * 0.9) }),
    ).toBe('matches');
    expect(
      framingVerdict(RIDER, { ...RIDER, aspect: ASPECT * (1 + MAXIMUM_ASPECT_CHANGE * 1.1) }),
    ).toBe('differs');
    // A phone turned the other way is never the same placement.
    expect(framingVerdict(RIDER, { ...RIDER, aspect: 9 / 16 })).toBe('differs');
  });

  it('answers differs, never matches, on too few landmarks in common', () => {
    const few = { ...RIDER, landmarks: RIDER.landmarks.slice(0, MINIMUM_SHARED_LANDMARKS - 1) };
    expect(framingVerdict(RIDER, few)).toBe('differs');
    const enough = { ...RIDER, landmarks: RIDER.landmarks.slice(0, MINIMUM_SHARED_LANDMARKS) };
    expect(framingVerdict(RIDER, enough)).toBe('matches');
  });

  it('answers differs for a reference of no size at all', () => {
    const point = {
      aspect: ASPECT,
      landmarks: RIDER.landmarks.map((each) => ({ ...each, x: 0.5, y: 0.5 })),
    };
    expect(framingVerdict(point, point)).toBe('differs');
  });

  it('compares only the landmarks both carry', () => {
    // A current picture that also found the wrist it lacked before is the same
    // placement; the extra landmark must not move the centre it is judged by.
    const withoutWrist = {
      ...RIDER,
      landmarks: RIDER.landmarks.filter((each) => each.name !== 'wrist'),
    };
    expect(framingVerdict(withoutWrist, RIDER)).toBe('matches');
  });
});

describe('a reference from the link is untrusted input', () => {
  it('accepts a well-formed one', () => {
    expect(framingReferenceFrom(RIDER)?.landmarks).toHaveLength(RIDER.landmarks.length);
  });

  it.each([
    ['nothing', undefined],
    ['a string', 'reference'],
    ['a list', []],
    ['an unknown key', { ...RIDER, extra: 1 }],
    [
      'an unknown key on a landmark',
      { ...RIDER, landmarks: [{ name: 'hip', x: 0.5, y: 0.5, z: 1 }] },
    ],
    [
      'a landmark this program does not know',
      { ...RIDER, landmarks: [{ name: 'tail', x: 0.5, y: 0.5 }] },
    ],
    [
      'a landmark twice',
      {
        ...RIDER,
        landmarks: [
          { name: 'hip', x: 0.5, y: 0.5 },
          { name: 'hip', x: 0.4, y: 0.5 },
        ],
      },
    ],
    ['a point off the picture', { ...RIDER, landmarks: [{ name: 'hip', x: 1.5, y: 0.5 }] }],
    [
      'a point that is not a number',
      { ...RIDER, landmarks: [{ name: 'hip', x: Number.NaN, y: 0.5 }] },
    ],
    ['no aspect', { landmarks: RIDER.landmarks }],
    ['a negative aspect', { ...RIDER, aspect: -1 }],
    ['no landmarks', { ...RIDER, landmarks: [] }],
    [
      'more landmarks than there are names',
      { ...RIDER, landmarks: [...RIDER.landmarks, { name: 'ear', x: 0.1, y: 0.1 }] },
    ],
  ])('refuses %s', (_what, value) => {
    expect(framingReferenceFrom(value)).toBeUndefined();
  });

  it('takes the store’s record shape once its owner is removed', () => {
    // The tablet sends the record it keeps (packages/store
    // `FramingReferenceRecord`), less the athlete — ADR 0033 D-3 puts no
    // athlete id on the link. The two shapes are one shape.
    const record: FramingReferenceRecord = {
      athleteId: 'athlete-a' as FramingReferenceRecord['athleteId'],
      ...RIDER,
    };
    const sent = { aspect: record.aspect, landmarks: record.landmarks };
    expect(framingReferenceFrom(sent)).toStrictEqual(RIDER);
    // …and the record itself, with its athlete, is refused: an unknown key.
    expect(framingReferenceFrom(record)).toBeUndefined();
  });
});

describe('the outlines', () => {
  it('draws the ghost from the reference, in picture heights', () => {
    const lines = referenceOutline(RIDER);
    expect(lines).toHaveLength(6);
    // The first bone is ear to shoulder, scaled across by the picture's shape.
    expect(lines[0]).toStrictEqual({ x1: 0.55 * ASPECT, y1: 0.15, x2: 0.52 * ASPECT, y2: 0.3 });
  });

  it('leaves a gap for a missing landmark rather than inventing a line', () => {
    const noKnee = { ...RIDER, landmarks: RIDER.landmarks.filter((each) => each.name !== 'knee') };
    expect(referenceOutline(noKnee)).toHaveLength(4);
  });

  it.each([
    ['landscape 16:9', 16 / 9],
    ['landscape 4:3', 4 / 3],
    ['portrait 3:4', 3 / 4],
    ['portrait 9:16', 9 / 16],
  ])('keeps the guide inside a %s picture once it is scaled', (_shape, aspect) => {
    const scale = guideScaleFor(aspect);
    // Scaled about the bottom-centre, as the preview draws it.
    const across = (dx: number): number => Math.abs(dx) * scale;
    const down = (y: number): number => 1 - (1 - y) * scale;
    const extents = [
      ...FRAMING_GUIDE.wheels.map((wheel) => [
        across(wheel.dx) + wheel.r * scale,
        down(wheel.y) + wheel.r * scale,
      ]),
      ...FRAMING_GUIDE.lines.flatMap((line) => [
        [across(line.dx1), down(line.y1)],
        [across(line.dx2), down(line.y2)],
      ]),
      [
        across(FRAMING_GUIDE.head.dx) + FRAMING_GUIDE.head.r * scale,
        down(FRAMING_GUIDE.head.y) - FRAMING_GUIDE.head.r * scale,
      ],
    ];
    for (const [x, y] of extents) {
      expect(x).toBeLessThanOrEqual(aspect / 2);
      expect(y).toBeLessThanOrEqual(1);
      expect(y).toBeGreaterThanOrEqual(0);
    }
  });

  it('draws the guide full size in landscape and shrinks it only when it must', () => {
    expect(guideScaleFor(16 / 9)).toBe(1);
    expect(guideScaleFor(9 / 16)).toBeLessThan(1);
    expect(FRAMING_LANDMARKS).toContain('knee');
  });
});
