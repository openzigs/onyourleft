// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What a **shared** copy of a ride's track contains — ADR 0004 decision B,
 * applied to the data rather than to the drawing.
 *
 * ## Why this exists at all in a milestone with no server
 *
 * Two rules from ADR 0004 point in apparently opposite directions, and both
 * are obeyed here:
 *
 * - **Decision E, and #51's export path**: *the athlete's own data is not
 *   obfuscated for the athlete*. A rider looking at their own ride sees their
 *   own track, whole. `transfer/export-activity.ts` says the same thing about
 *   the file it writes and deliberately performs no zone lookup.
 * - **Decision C**: *"The UI must explain the difference on the athlete's own
 *   activity rather than let them discover it."* A rider who has drawn a
 *   privacy zone is entitled to know what a published copy of this ride would
 *   actually contain — **before** publishing is possible, not after.
 *
 * So the detail view shows the true track and offers a *shared view*: the same
 * ride as a reader elsewhere would receive it. That preview is computed by this
 * file, and it is computed **on the data** — the trimmed points never reach the
 * component tree, let alone the DOM. ADR 0004 decision C: *"Client-side hiding
 * is not a control. A client that draws a trimmed line from a full payload has
 * protected nothing."* The same reasoning applies to a preview: a preview that
 * hides points in the renderer would teach the wrong shape to whichever issue
 * copies it, and #7's emit boundary is the one that must not get this wrong.
 *
 * ⚠️ **Phase 3 lifts this into the emit path; it does not reimplement it.**
 * When #7 gains a sync, the function that strips before transmission is this
 * one. That is why {@link sharedTrack} takes plain data and returns plain data,
 * and why the geodesy it rests on lives in `@onyourleft/domain` rather than
 * here: an instance enforcing the same rule in its response bodies (decision C,
 * "two layers, not one") must agree with the device about which points are
 * inside a disc.
 *
 * ## What this does not do
 *
 * It does not make a location private, and the view must not say that it does
 * — ADR 0004 decision B is explicit. It raises the cost of locating a home
 * from reading one file to solving a small geometry problem over many rides.
 */

import {
  distanceBetween,
  geographicPosition,
  type GeographicPosition,
  type Metres,
} from '@onyourleft/domain';
import type { PrivacyZoneRecord, Samples } from '@onyourleft/store';

/**
 * How far the trim radius is jittered, as a fraction of the zone's radius.
 *
 * ADR 0004 decision B: `u ∈ [−0.125, +0.125]`, **symmetric**. The interval is
 * two-sided and the ADR explains at length why a one-sided one is worse than
 * none: with `u ∈ [0, 0.25]` every emitted point lies at or outside the true
 * radius, so an observer takes the minimum over many rides and converges on `r`
 * from above with no error term. Symmetric noise costs nothing and removes the
 * bias.
 */
export const TRIM_JITTER_FRACTION = 0.125;

/** FNV-1a's 32-bit offset basis and prime. Published constants, not a choice made here. */
const FNV_OFFSET_BASIS = 0x81_1c_9d_c5;
const FNV_PRIME = 0x01_00_01_93;

/**
 * A stable 32-bit hash of a string.
 *
 * FNV-1a because it is six lines and needs no dependency. **It is not a
 * cryptographic hash and nothing here needs one**: what the ADR requires of the
 * draw is that it be *deterministic in (activity id, zone id)* — re-emitting
 * the same activity twice with two different draws would hand an observer two
 * constraints instead of one, which is worse than no jitter — not that it be
 * unpredictable. An observer who already knows the activity id and the zone id
 * knows where the ride starts; the jitter defends against averaging, not
 * against inspection.
 */
function hash32(text: string): number {
  let value = FNV_OFFSET_BASIS;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, FNV_PRIME);
  }
  // `>>> 0` because `imul` returns a signed 32-bit result and the mapping below
  // needs a non-negative one; without it half of all ids would produce a
  // negative fraction and the jitter would be asymmetric in exactly the way the
  // ADR rejects.
  return value >>> 0;
}

/**
 * The radius this activity is trimmed at for this zone.
 *
 * `r · (1 + u)` with `u` drawn deterministically from
 * `[−{@link TRIM_JITTER_FRACTION}, +{@link TRIM_JITTER_FRACTION}]`, keyed on
 * the pair. Same ride and same zone, same radius, forever — which is the
 * property the ADR asks for and the one a fresh `Math.random()` would destroy.
 *
 * ⚠️ `Math.random` is not merely discouraged here; using it would make two
 * renders of the same preview disagree, and a rider watching the boundary move
 * would reasonably conclude the feature is broken.
 */
export function trimRadius(radius: Metres, activityId: string, zoneId: string): Metres {
  // Separated, so that ("ab", "c") and ("a", "bc") are different keys and two
  // rides cannot share a draw by accident. Written as an escape rather than as
  // the character itself: #143 took an invisible C0 control out of a source file
  // in this repository once already.
  const draw = hash32(`${activityId}\u001f${zoneId}`) / 2 ** 32;
  const jitter = (draw * 2 - 1) * TRIM_JITTER_FRACTION;
  return (radius * (1 + jitter)) as Metres;
}

/** One emitted point: where it is, and which sample of the ride it came from. */
export interface TrackPoint {
  /** The index into the stored 1 Hz series, so a time can be recovered from it. */
  readonly index: number;
  readonly position: GeographicPosition;
}

/** One run of the track that may be drawn as a single line. */
export interface TrackSegment {
  readonly points: readonly TrackPoint[];
}

/** The ride's track as a reader elsewhere would receive it. */
export interface SharedTrack {
  /**
   * The emitted runs, in order.
   *
   * More than one means the ride passed through a zone and came back out; the
   * break between two segments is a **gap** and ADR 0004 decision B requires a
   * renderer never to join across it. A chord drawn across that gap has a
   * perpendicular bisector through the zone's centre, which hands an observer
   * the thing the zone exists to hide.
   */
  readonly segments: readonly TrackSegment[];
  /** How many stored positions were withheld. A count, never a location. */
  readonly trimmedPoints: number;
  /**
   * The length of the **emitted** track, in metres.
   *
   * Summed within each segment and never across the break between two, so it
   * measures nothing about the trimmed part. ADR 0004 decision B item 4: with a
   * published total derived from the true track, `true − emitted` restores the
   * length of the trimmed prefix, and with a bearing that is the centre again.
   */
  readonly distance: Metres;
  /**
   * The sample index of the first emitted point, or `undefined` when the whole
   * ride was inside a zone.
   *
   * The published start time is this point's, not the ride's — decision B item
   * 3, "no activity started at earlier than the first emitted point".
   */
  readonly startsAtIndex?: number;
  /**
   * How many of the athlete's zones were applied.
   *
   * Carried so the view can distinguish "nothing was withheld because you have
   * no zones" from "nothing was withheld because this ride never went near
   * one". They read identically in every other field and mean opposite things
   * to a rider deciding whether to publish.
   */
  readonly zonesApplied: number;
}

export interface SharedTrackInput {
  /** Keys the jitter with each zone id. The activity's own id. */
  readonly activityId: string;
  readonly latitude: Samples<'latitude'> | undefined;
  readonly longitude: Samples<'longitude'> | undefined;
  readonly zones: readonly PrivacyZoneRecord[];
}

/**
 * The track a shared copy of this ride would carry.
 *
 * A point is withheld when it lies within any zone's jittered trim radius. A
 * sample with only one of the two coordinates is withheld too, and not as a
 * technicality: `streams.ts` records that the channels are separately absent,
 * so a half-position is a real stored shape, and a "position" assembled from
 * one real coordinate and a default zero is a point in the Gulf of Guinea that
 * no zone contains.
 *
 * Returns segments containing **only** emitted points. Nothing in the returned
 * value carries a withheld coordinate, in any field, which is what
 * `privacy.test.ts` asserts by walking the whole structure rather than by
 * checking the segments it expects to find.
 */
export function sharedTrack(input: SharedTrackInput): SharedTrack {
  const { activityId, latitude, longitude, zones } = input;
  const length = Math.max(latitude?.length ?? 0, longitude?.length ?? 0);

  // Radii resolved once rather than per sample: `trimRadius` hashes a string,
  // and a four-hour ride would hash it 14 400 times per zone otherwise.
  const discs = zones.map((zone) => ({
    centre: zone.centre,
    radius: trimRadius(zone.radius, activityId, zone.id),
  }));

  const segments: TrackSegment[] = [];
  let current: TrackPoint[] = [];
  let trimmedPoints = 0;
  let distance = 0;

  const closeSegment = (): void => {
    if (current.length > 0) {
      segments.push({ points: current });
      current = [];
    }
  };

  for (let index = 0; index < length; index += 1) {
    const lat = latitude?.[index];
    const lon = longitude?.[index];
    if (lat === undefined || lon === undefined) {
      // A gap in the stored track is a gap in the emitted one. Not counted as
      // trimmed: nothing was withheld, there was never a reading.
      closeSegment();
      continue;
    }
    const position = geographicPosition(lat, lon);
    if (discs.some((disc) => distanceBetween(position, disc.centre) <= disc.radius)) {
      trimmedPoints += 1;
      closeSegment();
      continue;
    }
    const previous = current.at(-1);
    if (previous !== undefined) {
      distance += distanceBetween(previous.position, position);
    }
    current.push({ index, position });
  }
  closeSegment();

  const first = segments[0]?.points[0];
  return {
    segments,
    trimmedPoints,
    distance: distance as Metres,
    zonesApplied: discs.length,
    ...(first === undefined ? {} : { startsAtIndex: first.index }),
  };
}
