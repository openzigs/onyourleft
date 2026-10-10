// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The heart-rate hold's words — #1240, ADR 0048 D-12. The ONE module for
 * them, as `rescue-text.ts` is for the stall rescue's: the Ride screen shows
 * them, the game's HUD shows the short line, and both screens' announcers say
 * them, so a rider reads and hears the same sentence wherever they are.
 *
 * ## The rules every sentence here keeps (ADR 0048 D-12, the owner's Q12)
 *
 * - One short sentence **about the workout, never about the body**.
 * - A heart-rate number is *"the range you chose"* — never a limit, never a
 *   number for health or safety.
 * - None of D-12's banned words, and no claim to prevent, treat or reduce the
 *   risk of anything. `hold-text.test.ts` scans every sentence here for them.
 *
 * ## When it is SPOKEN
 *
 * `hold-changed` ranks below `trainer-lost`, `workout-fault` and `erg-held`
 * (`game/hud/announce.ts` §`PRIORITY`), is spoken only with announcements on,
 * at most once a minute, and never inside the last 30 s of a hard segment —
 * the shape of ADR 0030 D-7 S1 and S4. A silence is never explained.
 * {@link holdAnnouncement} is that rule, and both announcers call it.
 */

import {
  segmentAt,
  seconds,
  type HeartRateRange,
  type HoldReason,
  type WorkoutTimeline,
} from '@onyourleft/domain';

/**
 * Why a hold block is riding its planned target instead of holding, when
 * that is not the heart rate's doing.
 */
export type HoldOff =
  /** The rider has not set their own threshold power and heart rate (H1). */
  | 'thresholds'
  /** The range is above the rider's own threshold heart rate (H2). */
  | 'range'
  /** No heart-rate strap is paired. */
  | 'no-strap';

/** A heart-rate hold as the screens show it. */
export interface WorkoutHold {
  readonly reason: HoldReason;
  readonly range: HeartRateRange;
  /** The hold's own target, in whole watts. */
  readonly target: number;
  /** Set when {@link reason} is `ineligible`: why. */
  readonly off?: HoldOff | undefined;
}

/** The label a screen puts before the hold's sentence. */
export const HOLD_LABEL = 'Heart-rate hold';

const SENTENCES: Readonly<Record<Exclude<HoldReason, 'ineligible'>, string>> = {
  settling: 'Riding the planned target while your heart rate settles.',
  holding: 'Your heart rate is in the range you chose.',
  raised: 'Target raised to bring your heart rate into the range you chose.',
  lowered: 'Target lowered to keep your heart rate in the range you chose.',
  overshoot:
    'Target at its lowest until your heart rate has been back in the range you chose for a minute.',
  silent: 'No heart rate: the target will not go up until it is back.',
};

const OFF_SENTENCES: Readonly<Record<HoldOff, string>> = {
  thresholds:
    'Heart-rate hold is off: set your own threshold power and heart rate on the Analysis screen.',
  range:
    'Heart-rate hold is off: the range you chose is above your threshold heart rate, so this block rides its planned target.',
  'no-strap': 'No heart rate: holding the planned target.',
};

/** The hold's one sentence. */
export function holdSentence(hold: WorkoutHold): string {
  if (hold.reason === 'ineligible') {
    return OFF_SENTENCES[hold.off ?? 'no-strap'];
  }
  return SENTENCES[hold.reason];
}

/** "130–140 bpm": the range, as the rider chose it. */
export function holdRangeText(range: HeartRateRange): string {
  return `${String(range.low)}–${String(range.high)} bpm`;
}

/** The range and the target, on the Ride screen. */
export function holdReading(hold: WorkoutHold): string {
  return `Range ${holdRangeText(hold.range)}, target ${String(hold.target)} W.`;
}

/**
 * The game HUD's one line: short, because it shares the trainer line's place
 * at the bottom of the stage (`hud/fields.ts` §`TrainerLine`). The sentence is
 * spoken there in full.
 */
export function holdHudLine(hold: WorkoutHold): string {
  return `Hold ${holdRangeText(hold.range)}: ${String(hold.target)} W`;
}

/**
 * The event both announcers offer — `game/hud/announce.ts`'s
 * `AnnouncementEvent` of kind `hold-changed`, written out here rather than
 * imported. ⚠️ Deliberately: the ride controller reads this module's types,
 * and an import of the announcer from here pulled the HUD's field module into
 * every import walk that starts at the controller — which doubled the time
 * `ride-analysis/runner-safety.test.ts` spends walking it.
 */
export interface HoldChangedEvent {
  readonly kind: 'hold-changed';
  readonly text: string;
}

/** At most one `hold-changed` a minute. */
export const HOLD_SPOKEN_EVERY_SECONDS = 60;

/** Nothing is said about the hold in the last 30 s of a hard segment. */
export const HOLD_QUIET_BEFORE_HARD_END_SECONDS = 30;

/** A segment at or above threshold power is a hard one (ADR 0030 D-7 S4's line). */
export const HARD_SEGMENT_SHARE = 1;

/**
 * Whether a hold sentence may be said at this point in the workout: not
 * inside the last {@link HOLD_QUIET_BEFORE_HARD_END_SECONDS} of a segment at
 * or above threshold. A hold block's own ceiling is under threshold, so this
 * matters when a sentence is still waiting as a hard block begins.
 */
export function holdMayBeSpoken(timeline: WorkoutTimeline, elapsedSeconds: number): boolean {
  const segment = segmentAt(timeline, seconds(Math.max(0, elapsedSeconds)));
  if (segment === undefined) {
    return true;
  }
  const hard = Math.max(segment.from ?? 0, segment.to ?? 0) >= HARD_SEGMENT_SHARE;
  return !(hard && segment.endsAt - elapsedSeconds <= HOLD_QUIET_BEFORE_HARD_END_SECONDS);
}

/** What an announcer remembers about the hold between calls. */
export interface HoldAnnounced {
  /** The sentence last seen, said or not. */
  readonly sentence: string | undefined;
  /** When a hold sentence was last offered, on the announcer's clock. */
  readonly offeredAt: number | undefined;
}

export const NOTHING_ANNOUNCED: HoldAnnounced = { sentence: undefined, offeredAt: undefined };

/**
 * Whether the hold's sentence ({@link holdSentence}, or `undefined` outside a
 * hold) should be offered now, and what to remember.
 *
 * Offered when it CHANGES — never on first appearance, #394's rule — and only
 * if a minute has passed since the last one offered and the workout is not in
 * the last 30 s of a hard segment. A change that falls inside the minute is
 * not said later: the screen shows it, and the next change is the next news.
 */
export function holdAnnouncement(
  previous: HoldAnnounced,
  sentence: string | undefined,
  now: number,
  where: { readonly timeline: WorkoutTimeline; readonly elapsedSeconds: number } | undefined,
): { readonly event: HoldChangedEvent | undefined; readonly next: HoldAnnounced } {
  const next = { ...previous, sentence };
  if (sentence === undefined || previous.sentence === undefined || sentence === previous.sentence) {
    return { event: undefined, next };
  }
  if (previous.offeredAt !== undefined && now - previous.offeredAt < HOLD_SPOKEN_EVERY_SECONDS) {
    return { event: undefined, next };
  }
  if (where !== undefined && !holdMayBeSpoken(where.timeline, where.elapsedSeconds)) {
    return { event: undefined, next };
  }
  return {
    event: { kind: 'hold-changed', text: `${HOLD_LABEL}: ${sentence}` },
    next: { sentence, offeredAt: now },
  };
}

/** Every sentence this module can produce, for the word scan. */
export const HOLD_SENTENCES: readonly string[] = [
  ...Object.values(SENTENCES),
  ...Object.values(OFF_SENTENCES),
];
