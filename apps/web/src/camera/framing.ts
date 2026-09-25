// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Where the rider is in the side camera's picture, and whether that is where
 * they were last time** — #528,
 * [ADR 0033](../../../../docs/adr/0033-side-camera-link.md) D-7.
 *
 * Pure: numbers in, a verdict or an outline out. No camera, no DOM, no store.
 *
 * ## What a reference is, and what it is not
 *
 * D-7 replaced #528's criterion that *"the stored reference is a picture of the
 * rider"*:
 *
 * > The reference is the image-plane positions and scale of the landmarks the
 * > pose model reports, plus the frame's dimensions. It is enough to draw a
 * > ghost outline and to test placement against a tolerance. It is **not** a
 * > photograph.
 *
 * So a {@link FramingReference} is a handful of named points, each a share of
 * the picture's width and height, and the picture's shape. On the tablet it is
 * the athlete's own record (`packages/store` §`FramingReferenceRecord`, whose
 * fields this type mirrors); on the phone it arrives over the link and is held
 * in memory for the session only (D-8).
 *
 * ## Where the check runs, and why this file is on both devices anyway
 *
 * D-7: the check runs **on the tablet**, where the pose model is, and the
 * phone is told the verdict. So {@link framingVerdict} has no caller on the
 * phone and its production caller is the tablet's analysis
 * ([#530](https://github.com/openzigs/onyourleft/issues/530)). It is written
 * here, with its tolerance, because #528's criterion is that *"the tolerance
 * and its provenance are written at the constant"* — and because the phone and
 * the tablet are one client (ADR 0008, ADR 0018), there is one module for both.
 *
 * ## What a mismatch blocks
 *
 * ADR 0033 D-7, superseding ADR 0030 D-3's second sentence: a difference
 * between two sessions may be reported **only when the check passed**; when it
 * did not, the report gives within-session differences and says why. **A
 * mismatch never blocks filming.** It changes what the report may compare the
 * session with, and {@link FRAMING_VERDICT_TEXT} says so in those words.
 */

/**
 * The landmarks a side-on outline is drawn from, near side only.
 *
 * Side-on at hip height (ADR 0029's 2026-09-23 amendment, Q4) the camera sees
 * one side of the body, and these are the points of it a sagittal outline
 * needs: head, shoulder, arm, and hip-knee-ankle. The pose model's own names
 * (and which side is near) are #385's and #530's to map onto these.
 */
export const FRAMING_LANDMARKS = [
  'ear',
  'shoulder',
  'elbow',
  'wrist',
  'hip',
  'knee',
  'ankle',
] as const;

export type FramingLandmark = (typeof FRAMING_LANDMARKS)[number];

/** A point in the picture, as shares of its width (`x`) and height (`y`). */
export interface FramePoint {
  readonly x: number;
  readonly y: number;
}

/**
 * Where the rider was, last time. @see packages/store `FramingReferenceRecord`
 */
export interface FramingReference {
  /** The picture's width over its height. */
  readonly aspect: number;
  readonly landmarks: readonly (FramePoint & { readonly name: FramingLandmark })[];
}

/**
 * The fewest landmarks two pictures must share for a placement to be compared.
 *
 * Three, because a centre and a size need at least two points and a single
 * missing landmark should not make two otherwise identical placements
 * incomparable; with fewer than three in common the check answers *differs*,
 * which is the safe direction — it forbids a cross-session comparison rather
 * than permitting one on too little.
 */
export const MINIMUM_SHARED_LANDMARKS = 3;

/**
 * How far the camera's view onto the rider may have turned since the
 * reference, in degrees, and still count as the same placement.
 *
 * ## Provenance — ⚠️ the author's choice, not a measurement
 *
 * A rider who appears shifted in the picture is seen along a different line
 * than before: a shift of a share `s` of the picture's width is a turn of
 * about `s × horizontal field of view`. ADR 0030 D-3 and the whole of #377's
 * Phase C rest on *"same camera, same placement"*, and Noraxon's guidance, as
 * #386 quotes it, is that placement alone shifts every reported angle. Five
 * degrees is chosen as the turn at which a segment in the sagittal plane is
 * foreshortened by under half a percent (`1 − cos 5° ≈ 0.0038`), so the check
 * is strict enough that a passed one does not itself move a difference the
 * report might state.
 *
 * ⚠️ **Nothing here has been measured.** #385 measures *"the repeatability of
 * a passed framing check between sessions"* (ADR 0033 D-7), and its result
 * replaces this number by an amendment there — including if it shows that a
 * check this strict never passes twice on a real tripod.
 */
export const MAXIMUM_VIEW_TURN_DEGREES = 5;

/**
 * The horizontal field of view the turn above is converted with, in degrees.
 *
 * ⚠️ **Assumed, not read from a device.** A phone's main camera in landscape
 * is commonly quoted at 60° to 70° horizontally; 65° is the middle. The web
 * platform does not report a lens's field of view, so no device's own figure
 * is available to this program. The error this makes is proportional: on a
 * 70° lens the tolerance below is about 7 % looser in degrees than stated.
 */
export const ASSUMED_HORIZONTAL_FIELD_OF_VIEW_DEGREES = 65;

/**
 * How much bigger or smaller the rider may appear than in the reference and
 * still count as the same placement: ±10 %.
 *
 * ## Provenance — ⚠️ the author's choice, not a measurement
 *
 * The rider's size in the picture goes inversely with the camera's distance,
 * so ±10 % is the camera about a tenth nearer or further — some 20 to 30 cm on
 * a tripod two to three metres away, which is roughly the difference between a
 * tripod put back on the same mark and one put back "about there". It also
 * catches a zoom or a different lens. #385 replaces it, as it does
 * {@link MAXIMUM_VIEW_TURN_DEGREES}.
 */
export const MAXIMUM_SCALE_CHANGE = 0.1;

/**
 * How far two pictures' shapes may differ and still be compared: 1 %.
 *
 * `x` and `y` are shares of the picture, so the same point lands on different
 * shares in pictures of different shapes; a portrait picture and a landscape
 * one are not the same placement whatever the landmarks say. The 1 % absorbs
 * a platform reporting 1280 × 720 on one session and 1280 × 718 on the next.
 */
export const MAXIMUM_ASPECT_CHANGE = 0.01;

/**
 * The smallest a reference's landmarks may be spread and still be a rider:
 * one hundredth of the picture's height, as a root-mean-square distance from
 * their centre.
 *
 * Below it the size ratio {@link MAXIMUM_SCALE_CHANGE} is judged by is a
 * division by almost nothing — a set of landmarks all on one point, which is
 * a broken reference rather than a small rider — so the check answers
 * `differs` instead of comparing noise.
 */
export const MINIMUM_REFERENCE_SIZE = 0.01;

/** Whether this session is framed like the reference. */
export type FramingVerdict = 'matches' | 'differs';

/**
 * What the phone says for each verdict, and for none.
 *
 * ⚠️ **Words about the CAMERA, never about the body** — ADR 0030 binds every
 * string near a camera, and a framing check is a statement about where a
 * tripod stands. And each sentence says what the verdict does and does not
 * change, because a rider who reads *"framing differs"* and assumes they may
 * not film is as badly served as one who never reads it.
 */
export const FRAMING_VERDICT_TEXT: Readonly<Record<FramingVerdict | 'no-reference', string>> = {
  matches:
    'The camera is where it was last time, so this session can be compared with your last one.',
  differs:
    'The camera is not where it was last time. You can still film, but this session will only be ' +
    'compared with itself, and the report will say why.',
  'no-reference':
    'There is no earlier session to line up with yet, so this session will only be compared with ' +
    'itself.',
};

/** Where a set of landmarks sits: its centre and its size, in picture heights. */
interface Placement {
  readonly centreX: number;
  readonly centreY: number;
  readonly size: number;
}

/**
 * The centre and size of the landmarks named in `names`, measured in picture
 * HEIGHTS on both axes so that a size is the same number whichever way it
 * points.
 */
function placementOf(
  reference: FramingReference,
  names: ReadonlySet<FramingLandmark>,
): Placement | undefined {
  const points = reference.landmarks
    .filter((landmark) => names.has(landmark.name))
    .map((landmark) => ({ x: landmark.x * reference.aspect, y: landmark.y }));
  if (points.length === 0) {
    return undefined;
  }
  const centreX = points.reduce((sum, point) => sum + point.x, 0) / points.length;
  const centreY = points.reduce((sum, point) => sum + point.y, 0) / points.length;
  const size = Math.sqrt(
    points.reduce((sum, point) => sum + (point.x - centreX) ** 2 + (point.y - centreY) ** 2, 0) /
      points.length,
  );
  return { centreX, centreY, size };
}

/** Degrees to radians. */
function radians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * Whether `current` is framed like `reference`, within the three tolerances
 * above — ADR 0033 D-7's check.
 *
 * Compared only over the landmarks both carry. Too few in common, a different
 * picture shape, or a reference of no size all answer `differs`: every doubt resolves
 * toward *"compare this session only with itself"*, never toward permitting a
 * comparison the check could not establish.
 */
export function framingVerdict(
  reference: FramingReference,
  current: FramingReference,
): FramingVerdict {
  if (Math.abs(current.aspect / reference.aspect - 1) > MAXIMUM_ASPECT_CHANGE) {
    return 'differs';
  }
  const theirs = new Set(current.landmarks.map((landmark) => landmark.name));
  const shared = new Set(
    reference.landmarks.map((landmark) => landmark.name).filter((name) => theirs.has(name)),
  );
  if (shared.size < MINIMUM_SHARED_LANDMARKS) {
    return 'differs';
  }
  const before = placementOf(reference, shared);
  const now = placementOf(current, shared);
  if (before === undefined || now === undefined || before.size < MINIMUM_REFERENCE_SIZE) {
    return 'differs';
  }

  // The turn: a shift across the picture, converted to an angle with the
  // field of view on each axis. Heights are the unit, so the vertical field of
  // view is the horizontal one narrowed by the picture's shape.
  const halfHorizontal = radians(ASSUMED_HORIZONTAL_FIELD_OF_VIEW_DEGREES) / 2;
  const halfVertical = Math.atan(Math.tan(halfHorizontal) / reference.aspect);
  const degreesPerHeightAcross = ((2 * halfHorizontal) / reference.aspect) * (180 / Math.PI);
  const degreesPerHeightDown = 2 * halfVertical * (180 / Math.PI);
  const turn = Math.hypot(
    (now.centreX - before.centreX) * degreesPerHeightAcross,
    (now.centreY - before.centreY) * degreesPerHeightDown,
  );
  if (turn > MAXIMUM_VIEW_TURN_DEGREES) {
    return 'differs';
  }
  if (Math.abs(now.size / before.size - 1) > MAXIMUM_SCALE_CHANGE) {
    return 'differs';
  }
  return 'matches';
}

/**
 * A reference from somewhere this program does not trust, or `undefined` when
 * it is not one.
 *
 * On the phone a reference arrives over the side-camera link, and ADR 0033
 * D-4 makes every received message untrusted input, *"bounded in size and
 * checked for type before it is used"*. So this refuses — rather than repairs
 * — anything outside the shape: an unknown landmark name, a landmark named
 * twice, a point off the picture, more landmarks than there are names, a
 * missing or non-positive aspect, and **any key it does not know**, which is
 * ADR 0017 D-4's rule and ADR 0033 D-1's for the QR code.
 */
export function framingReferenceFrom(value: unknown): FramingReference | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => key !== 'aspect' && key !== 'landmarks')) {
    return undefined;
  }
  const { aspect, landmarks } = record;
  if (typeof aspect !== 'number' || !Number.isFinite(aspect) || aspect <= 0) {
    return undefined;
  }
  if (
    !Array.isArray(landmarks) ||
    landmarks.length === 0 ||
    landmarks.length > FRAMING_LANDMARKS.length
  ) {
    return undefined;
  }
  const known = new Set<string>(FRAMING_LANDMARKS);
  const seen = new Set<string>();
  const decoded: (FramePoint & { name: FramingLandmark })[] = [];
  for (const entry of landmarks as unknown[]) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      return undefined;
    }
    const landmark = entry as Record<string, unknown>;
    if (Object.keys(landmark).some((key) => key !== 'name' && key !== 'x' && key !== 'y')) {
      return undefined;
    }
    const { name, x, y } = landmark;
    if (typeof name !== 'string' || !known.has(name) || seen.has(name)) {
      return undefined;
    }
    if (!isShare(x) || !isShare(y)) {
      return undefined;
    }
    seen.add(name);
    decoded.push({ name: name as FramingLandmark, x, y });
  }
  return { aspect, landmarks: decoded };
}

/** A finite number from 0 to 1. */
function isShare(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

/**
 * The lines of an outline, in the order a body joins up: head to foot, then
 * shoulder to hand. Pairs whose ends are both present are drawn; a missing
 * landmark leaves a gap rather than a line to somewhere invented.
 */
const OUTLINE_BONES: readonly (readonly [FramingLandmark, FramingLandmark])[] = [
  ['ear', 'shoulder'],
  ['shoulder', 'hip'],
  ['hip', 'knee'],
  ['knee', 'ankle'],
  ['shoulder', 'elbow'],
  ['elbow', 'wrist'],
];

/** One straight line of an outline, in picture heights across and down. */
export interface OutlineSegment {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

/**
 * The ghost of the last session, as lines to draw over the live picture —
 * #528's *"a stored reference … shown ghosted over the live preview"*.
 *
 * In picture HEIGHTS, the unit {@link FRAMING_GUIDE} is in, so both can be
 * drawn in one `viewBox` of `aspect × 1` without either being stretched.
 */
export function referenceOutline(reference: FramingReference): readonly OutlineSegment[] {
  const at = new Map(reference.landmarks.map((landmark) => [landmark.name, landmark]));
  const segments: OutlineSegment[] = [];
  for (const [from, to] of OUTLINE_BONES) {
    const start = at.get(from);
    const end = at.get(to);
    if (start !== undefined && end !== undefined) {
      segments.push({
        x1: start.x * reference.aspect,
        y1: start.y,
        x2: end.x * reference.aspect,
        y2: end.y,
      });
    }
  }
  return segments;
}

/** A circle of the guide, in picture heights from the picture's centre line. */
export interface GuideCircle {
  readonly dx: number;
  readonly y: number;
  readonly r: number;
}

/** A line of the guide, in picture heights from the picture's centre line. */
export interface GuideLine {
  readonly dx1: number;
  readonly y1: number;
  readonly dx2: number;
  readonly y2: number;
}

/**
 * Where a bicycle and its rider should stand in the picture, as an outline —
 * #528's *"an overlay of the bike and rider outline"*.
 *
 * Drawn from numbers, as `game/bicycle.ts` draws the game's rider, and for its
 * reason: there is no asset to license and nothing to fetch. Distances are in
 * picture HEIGHTS, horizontally from the picture's centre line (`dx`), facing
 * right, so the same guide sits correctly in a landscape or a portrait picture.
 *
 * ## Why these proportions
 *
 * The picture's height is taken as about 1.9 m of the room, which puts a rider
 * of ordinary height on a road bicycle at roughly four fifths of it with room
 * above the head — close enough to fill the picture, not so close that a
 * pedalling foot leaves it. On that scale a 700c wheel (about 0.67 m across)
 * has a radius of 0.17 and a road wheelbase of about a metre puts the hubs
 * 0.52 apart. ⚠️ **A guide, not a measurement**: it says roughly where to
 * stand the tripod, and the check against the reference is what says whether
 * it stood there last time.
 */
export const FRAMING_GUIDE: {
  readonly wheels: readonly GuideCircle[];
  readonly head: GuideCircle;
  readonly lines: readonly GuideLine[];
} = {
  wheels: [
    { dx: -0.26, y: 0.8, r: 0.17 },
    { dx: 0.26, y: 0.8, r: 0.17 },
  ],
  head: { dx: 0.15, y: 0.14, r: 0.055 },
  lines: [
    // The frame: rear hub, bottom bracket, seat, head tube, front hub.
    { dx1: -0.26, y1: 0.8, dx2: -0.03, y2: 0.82 },
    { dx1: -0.03, y1: 0.82, dx2: -0.1, y2: 0.47 },
    { dx1: -0.1, y1: 0.47, dx2: 0.18, y2: 0.5 },
    { dx1: 0.18, y1: 0.5, dx2: 0.26, y2: 0.8 },
    { dx1: -0.03, y1: 0.82, dx2: 0.18, y2: 0.5 },
    // The rider: hip on the saddle, back to the shoulder, arm to the bars.
    { dx1: -0.1, y1: 0.45, dx2: 0.08, y2: 0.24 },
    { dx1: 0.08, y1: 0.24, dx2: 0.19, y2: 0.44 },
    // The near leg, at the bottom of the stroke.
    { dx1: -0.1, y1: 0.45, dx2: 0.02, y2: 0.63 },
    { dx1: 0.02, y1: 0.63, dx2: -0.01, y2: 0.9 },
  ],
};

/** How far the guide reaches either side of the centre line, in picture heights. */
function guideHalfWidth(): number {
  return Math.max(
    ...FRAMING_GUIDE.wheels.map((wheel) => Math.abs(wheel.dx) + wheel.r),
    ...FRAMING_GUIDE.lines.flatMap((line) => [Math.abs(line.dx1), Math.abs(line.dx2)]),
    Math.abs(FRAMING_GUIDE.head.dx) + FRAMING_GUIDE.head.r,
  );
}

/**
 * How much to shrink the guide so it fits a picture of this shape: `1` in
 * landscape, less in portrait.
 *
 * A bicycle is longer than it is tall, so {@link FRAMING_GUIDE} is drawn for a
 * landscape picture and reaches 0.43 picture heights either side of centre. A
 * phone held upright gives a picture only 0.28 heights either side, and a guide
 * drawn at full size there would run off both edges — so it is shrunk about
 * the bottom of the picture, which is the floor the wheels stand on, keeping a
 * twentieth of the width clear at each edge.
 */
export function guideScaleFor(aspect: number): number {
  const room = (aspect / 2) * 0.95;
  return Math.min(1, room / guideHalfWidth());
}
