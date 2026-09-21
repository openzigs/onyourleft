// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The announcer's pure core: at most ONE sentence, or nothing — #396.
 *
 * ## The defect it exists to prevent
 *
 * A live region bound to a value that changes at 60 fps produces speech that
 * never stops and never finishes a sentence. The fix is not a politer role; it
 * is that **most calls produce nothing at all**. This function is called as
 * often as its caller likes and answers `undefined` unless something is worth
 * a sentence AND the window since the last sentence has passed.
 *
 * ## What it says, and in what order — #395's decision, binding here
 *
 * {@link PRIORITY} is the order, and it is an ORDER — never an `aria-live`
 * politeness, because TalkBack ignores politeness (Roselli, 2026-01-14:
 * every region assertive on one Android, every one polite on another). One
 * sentence per {@link ANNOUNCE_WINDOW_SECONDS}. A higher item waiting in the
 * window pre-empts a lower one; a lower one is **dropped, not queued** — a
 * queue that grows is the continuous-speech failure itself.
 *
 * | rank | what | trigger | evidence (#395) |
 * |---|---|---|---|
 * | 1 | the trainer link lost | event | safety |
 * | 2 | a workout fault | event | safety |
 * | 3 | the next workout block, ahead of it | event (#398) | safety |
 * | 4 | power off an acknowledged target | ≥ 10 % for ≥ 5 s | attested |
 * | 5 | distance to go | a distance tick | attested |
 * | 6 | power | a time cadence | attested |
 *
 * ⚠️ **Ranks 1, 2 and 4 have no production source yet, and the order above is
 * therefore not what a rider hears today** (PR #444's review). The two callers
 * are `GameView` — a gradient ride, so there is no ERG target to be off and no
 * workout to fault, and it feeds power and distance only — and
 * `ride/WorkoutPanel.tsx`, which feeds `interval-ahead` only. A lost trainer
 * link and a workout fault ARE spoken, but by #394's own event regions, which
 * this throttle does not see: a reading here can be said in the same second
 * as one of those. Feeding them in means taking them out of #394's regions in
 * the same change, or each is said twice — which is #445, not something to
 * half-do here.
 *
 * **Not announceable in this cut**, each for #395's reason: cadence and heart
 * rate (inferred only — nothing attested asks for them), the pacer and ghost
 * gaps (inferred; and when they are added the word describes the PACER, #255),
 * speed and wind (not attested; wind cannot change mid-ride, #335). The
 * position is never read at all: no field here is a coordinate, and ADR 0004
 * decision D binds every layer that formats one into a string.
 *
 * ## Pure, and it must stay pure
 *
 * It reads no clock and schedules nothing — `now` is a parameter, on the
 * caller's clock — and `eslint.config.js` makes a `Date`, a timer or
 * `speechSynthesis` in this file an error. It keeps no module state: the
 * carry-over is RETURNED, and the caller threads it back, so a second ride
 * cannot inherit the first one's last sentence.
 *
 * ⚠️ **No text-to-speech.** `window.speechSynthesis` is not supported in the
 * Android WebView (Chromium bug 40417848): a reader built on it works in a
 * desktop browser and is silent in the shipped app. The sentence goes into a
 * live region, and the rider's own screen reader speaks it.
 */

import type { AnnouncementPreference } from './announce-preference';
import { NO_READING, type HudReading } from './fields';

/** One sentence per this many seconds, at most. #395's window. */
export const ANNOUNCE_WINDOW_SECONDS = 3;
/** How far off an acknowledged target power must be to be worth a sentence. */
export const OFF_TARGET_SHARE = 0.1;
/** …and for how long, so a surge out of a corner is not one. */
export const OFF_TARGET_SECONDS = 5;

/** Something that happened, as opposed to a reading that is always there. */
export type AnnouncementEvent =
  | { readonly kind: 'trainer-lost'; readonly text: string }
  | { readonly kind: 'workout-fault'; readonly text: string }
  | { readonly kind: 'interval-ahead'; readonly text: string };

/** Every kind of sentence, events and readings together. */
export type AnnouncementKind =
  AnnouncementEvent['kind'] | 'power-off-target' | 'distance-tick' | 'power';

/**
 * The priority, as an order: earlier wins. ⚠️ This array IS the decision; a
 * comparator elsewhere would be a second copy of it.
 */
export const PRIORITY: readonly AnnouncementKind[] = [
  'trainer-lost',
  'workout-fault',
  'interval-ahead',
  'power-off-target',
  'distance-tick',
  'power',
];

/** The readings a sentence may be built from. Everything else is not announceable. */
export const ANNOUNCEABLE_READINGS: readonly string[] = ['power', 'remaining'];

export interface AnnounceInput {
  /** The caller's clock, in seconds. The only time this module knows. */
  readonly now: number;
  /** `hudReadings`' output, as the HUD renders it. */
  readonly readings: readonly HudReading[];
  /**
   * The distance to go in the rider's own unit, with that unit's spoken
   * plural — both from `units/format.ts`. Absent where there is no route.
   */
  readonly remaining?: { readonly value: number; readonly unit: string } | undefined;
  /**
   * The power the trainer has ACKNOWLEDGED holding, in watts, when it is in
   * ERG. Never a target it has only been asked for (#398).
   */
  readonly acknowledgedTarget?: number | undefined;
  readonly events?: readonly AnnouncementEvent[] | undefined;
  readonly preference: AnnouncementPreference;
}

/** What the caller threads back in. Returned, never kept here. */
export interface AnnouncerState {
  readonly lastSpokenAt: number | undefined;
  /** When power was last said — or the baseline the cadence counts from. */
  readonly powerFrom: number | undefined;
  /** The last distance mark counted from, in the rider's unit. */
  readonly distanceMark: number | undefined;
  /** The one event waiting for the window. @see PRIORITY */
  readonly pending: AnnouncementEvent | undefined;
  readonly offTargetSince: number | undefined;
  readonly offTargetSaid: boolean;
}

export const INITIAL_ANNOUNCER: AnnouncerState = {
  lastSpokenAt: undefined,
  powerFrom: undefined,
  distanceMark: undefined,
  pending: undefined,
  offTargetSince: undefined,
  offTargetSaid: false,
};

export interface Announcement {
  /** At most one sentence. `undefined` on most calls, by design. */
  readonly sentence: string | undefined;
  readonly state: AnnouncerState;
}

const rank = (kind: AnnouncementKind): number => PRIORITY.indexOf(kind);

/**
 * The spoken form of the power reading. ⚠️ A dropped sensor is "no power
 * reading" — never "zero", never "nought": `fields.ts` §`NO_READING` renders a
 * dash for exactly this, and a sentence that said a number would be the
 * wrong-harness shape in a new place.
 */
export function spokenPower(reading: HudReading | undefined): string {
  if (reading === undefined || reading.stale || reading.value === NO_READING) {
    return 'No power reading';
  }
  return `Power ${reading.value} watts`;
}

/** A distance mark, as a rider hears it: `12`, or `0.5` — never `12.0`. */
function spokenNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/** Advance the announcer to `now`. Pure. @see the module note */
export function announce(state: AnnouncerState, input: AnnounceInput): Announcement {
  const { now, preference } = input;
  if (!preference.enabled) {
    // Off is off: nothing said, nothing waiting, and no baseline carried into
    // the moment it is switched on.
    return { sentence: undefined, state: INITIAL_ANNOUNCER };
  }

  // Events: keep the highest; a lower one arriving behind it is dropped.
  let pending = state.pending;
  for (const event of input.events ?? []) {
    if (event.kind === 'interval-ahead' && preference.intervalLeadSeconds === 'never') continue;
    if (pending === undefined || rank(event.kind) <= rank(pending.kind)) {
      pending = event;
    }
  }

  const candidates: { readonly kind: AnnouncementKind; readonly sentence: string }[] = [];
  if (pending !== undefined) {
    candidates.push({ kind: pending.kind, sentence: pending.text });
  }

  // Only what is announceable is read at all — a reading added to the HUD is
  // not spoken until somebody adds it here, deliberately.
  const readable = input.readings.filter((reading) => ANNOUNCEABLE_READINGS.includes(reading.key));
  const power = readable.find((reading) => reading.key === 'power');

  // Power off an acknowledged target, held for a while. ⚠️ It is the POWER
  // row's second trigger — #395's "a time cadence, or a threshold in ERG" — so
  // the power row's "never" silences it too. Until PR #444's review it did not,
  // and a rider who had switched power off still heard "Power 150 watts, under
  // the 200 watt target"; a reviewer who remembers a test pinning that is
  // reading the old file.
  let offTargetSince = state.offTargetSince;
  let offTargetSaid = state.offTargetSaid;
  const target = input.acknowledgedTarget;
  const watts = power === undefined || power.stale ? Number.NaN : Number(power.value);
  if (
    preference.powerEverySeconds !== 'never' &&
    target !== undefined &&
    target > 0 &&
    Number.isFinite(watts)
  ) {
    if (Math.abs(watts - target) / target >= OFF_TARGET_SHARE) {
      offTargetSince ??= now;
      if (!offTargetSaid && now - offTargetSince >= OFF_TARGET_SECONDS) {
        candidates.push({
          kind: 'power-off-target',
          sentence: `Power ${String(Math.round(watts))} watts, ${
            watts < target ? 'under' : 'over'
          } the ${String(Math.round(target))} watt target`,
        });
      }
    } else {
      offTargetSince = undefined;
      offTargetSaid = false;
    }
  } else {
    offTargetSince = undefined;
    offTargetSaid = false;
  }

  // The distance tick: a mark crossed going DOWN. Going up is a new lap, and a
  // new baseline rather than a sentence.
  let distanceMark = state.distanceMark;
  const every = preference.distanceEvery;
  const remaining = input.remaining;
  if (remaining !== undefined && every !== 'never' && every > 0) {
    const mark = Math.floor(remaining.value / every) * every;
    if (distanceMark !== undefined && mark < distanceMark) {
      candidates.push({
        kind: 'distance-tick',
        sentence: `${spokenNumber(distanceMark)} ${remaining.unit} to go`,
      });
    }
    distanceMark = mark;
  } else {
    distanceMark = undefined;
  }

  // Power on a cadence, counted from the first call rather than said at once.
  let powerFrom = state.powerFrom ?? now;
  const cadence = preference.powerEverySeconds;
  if (cadence !== 'never' && now - powerFrom >= cadence) {
    candidates.push({ kind: 'power', sentence: spokenPower(power) });
  }

  const windowOpen =
    state.lastSpokenAt === undefined || now - state.lastSpokenAt >= ANNOUNCE_WINDOW_SECONDS;
  const chosen = windowOpen
    ? candidates.reduce<(typeof candidates)[number] | undefined>(
        (best, each) => (best === undefined || rank(each.kind) < rank(best.kind) ? each : best),
        undefined,
      )
    : undefined;

  // Readings that wanted to speak and did not are DROPPED: their baselines
  // move on as if they had spoken, so they do not all fire the moment the
  // window opens. An event waits — it is safety — until it is said.
  if (candidates.some((each) => each.kind === 'power')) powerFrom = now;
  if (candidates.some((each) => each.kind === 'power-off-target')) offTargetSaid = true;

  return {
    sentence: chosen?.sentence,
    state: {
      lastSpokenAt: chosen === undefined ? state.lastSpokenAt : now,
      powerFrom,
      distanceMark,
      pending: chosen !== undefined && chosen.kind === pending?.kind ? undefined : pending,
      offTargetSince,
      offTargetSaid,
    },
  };
}
