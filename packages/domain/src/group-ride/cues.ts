// SPDX-License-Identifier: Apache-2.0

/**
 * **The rider's cue, chosen once per decision window** — #3302, epic #3296,
 * ADR 0101 (#3297, Proposed).
 *
 * From the rotation's answer (`rotation.ts`) and what it read, pick **at most
 * one cue to show now**, by kind, so the ride teaches without nagging. A cue
 * is a kind and its family, never a sentence and never a sound: the HUD line
 * is #3305's and the sound #3306's (owner ruling 2 of 2026-11-26: a HUD line
 * plus a distinct sound per kind, no spoken voice).
 *
 * ## Events: said once, when they happen
 *
 * | Kind | When |
 * |---|---|
 * | `next-up` | the rider's role becomes `second-wheel` |
 * | `your-pull` | the rider's role becomes `on-front` |
 * | `pull-off` | the rotation asks for it (`pull-off-due`, and its one `pull-off-repeat`) |
 * | `ease` | the rider's role becomes `drifting-back` |
 * | `last-wheel` | drifting back, the rider is within {@link CUE_LAST_WHEEL_METRES} of level with the last wheel |
 * | `back-in-line` | the rider's role goes from `latching` to a wheel |
 * | `climb` | {@link CUE_CLIMB_AHEAD_METRES} before a climb |
 * | `regroup` | the line's `waiting` or `regrouping` begins (#3301) |
 *
 * Events are never held by the correction limit. Two due in one window are
 * said a window apart, in the order of the table.
 *
 * ## Corrections: only out of band, for a dwell
 *
 * | Kind | Band and dwell |
 * |---|---|
 * | `close-gap` | on a wheel, more than {@link CUE_GAP_METRES} behind it for {@link CUE_GAP_DWELL_MS} |
 * | `surging` | on the front, over the group's speed by {@link CUE_SURGE_MPS} for {@link CUE_SURGE_DWELL_MS} |
 * | `past-front` | on a wheel, ahead of the front rider for {@link CUE_PAST_FRONT_DWELL_MS} |
 * | `eased-too-much` | latching, more than {@link CUE_EASED_METRES} behind the last wheel for {@link CUE_EASED_DWELL_MS} |
 * | `shorter-pull` | after the rider's pull, back on a wheel, when that pull's mean power was over {@link CUE_SHORTER_PULL_SHARE} of the rider's own threshold |
 *
 * At most one correction every {@link CUE_CORRECTION_GAP_MS}. The same one is
 * said at most twice in a row; after that it comes back as a quiet **mark**
 * for the role strip, counted for the debrief, and is not said. A band still
 * broken when the limit opens again is due at once.
 *
 * ## Silence
 *
 * - **No power reading, no cue at all**, and no mark: silence is the answer
 *   to "I do not know" (`apps/web/src/game/audio-cues.ts`, the epic's safety
 *   rule 11).
 * - **Nothing during a hard effort beyond the cue that started it.** The hard
 *   effort is a climb, from its `climb` cue to its crest: no correction and no
 *   event but the two the line's safety needs, `pull-off` and `last-wheel`.
 *   (The rotation starts no pull change there, so those come only from the
 *   rider's own press.)
 * - **No kind urges more effort** ({@link CUE_ASK}), and no cue carries a
 *   power, or any number, for the rider to reach.
 *
 * ## `shorter-pull` and the rider's threshold
 *
 * The issue left open how the rider's own recent average or threshold reaches
 * the game during a ride. It does: `apps/web/src/game/own-threshold.ts` reads
 * the threshold power the rider set into `GamePort.ownThresholdPower` (#2077),
 * `undefined` when they set none. This module takes it as
 * {@link CueView.thresholdWatts} and computes the pull's mean from the power
 * it is handed each window. **With no threshold, `shorter-pull` is never
 * said**: nothing here guesses one (`analysis/thresholds.ts`' default is not
 * for the HUD either).
 *
 * Deterministic and platform-free: time is the rotation view's `atMs`, there is no
 * clock and no draw, and only `+ − × ÷`, `min` and `max` (ADR 0067 D-5.2).
 * Every number is *proposed*: a feel parameter for the harness (#3309) and the
 * owner's ride.
 */

import { GroupRideError } from './errors';
import { unknownValue, type LinePhase, type RiderRole } from './roles';
import {
  ROTATION_WINDOW_MS,
  type MemberView,
  type RotationStep,
  type RotationView,
} from './rotation';

/** The events, in the order a rotation meets them. */
export const CUE_EVENT_KINDS = [
  'next-up',
  'your-pull',
  'pull-off',
  'ease',
  'last-wheel',
  'back-in-line',
  'climb',
  'regroup',
] as const;

/** One of {@link CUE_EVENT_KINDS}. */
export type CueEventKind = (typeof CUE_EVENT_KINDS)[number];

/** The corrections, in the order they are weighed when two are due at once. */
export const CUE_CORRECTION_KINDS = [
  'past-front',
  'surging',
  'eased-too-much',
  'close-gap',
  'shorter-pull',
] as const;

/** One of {@link CUE_CORRECTION_KINDS}. */
export type CueCorrectionKind = (typeof CUE_CORRECTION_KINDS)[number];

/** Every cue kind. */
export type CueKind = CueEventKind | CueCorrectionKind;

/** Every cue kind, events first. */
export const CUE_KINDS: readonly CueKind[] = [...CUE_EVENT_KINDS, ...CUE_CORRECTION_KINDS];

/**
 * What a cue asks of the rider, which is never more effort:
 * - `hold`: keep riding as you are, at the group's speed;
 * - `ease`: ride a little easier;
 * - `position`: move in the line, smoothly;
 * - `inform`: nothing to do yet.
 */
export const CUE_ASKS = ['hold', 'ease', 'position', 'inform'] as const;

/** One of {@link CUE_ASKS}. */
export type CueAsk = (typeof CUE_ASKS)[number];

/** What each kind asks. A kind that asked for more effort would need an ask this list does not have. */
export const CUE_ASK: Readonly<Record<CueKind, CueAsk>> = {
  'next-up': 'inform',
  'your-pull': 'hold',
  'pull-off': 'position',
  ease: 'ease',
  'last-wheel': 'position',
  'back-in-line': 'ease',
  climb: 'inform',
  regroup: 'inform',
  'close-gap': 'position',
  surging: 'ease',
  'past-front': 'ease',
  'eased-too-much': 'position',
  'shorter-pull': 'inform',
};

/** The cue to show now: its kind and whether it is an event or a correction. Nothing else. */
export type Cue =
  | { readonly family: 'event'; readonly kind: CueEventKind }
  | { readonly family: 'correction'; readonly kind: CueCorrectionKind };

/** The events the line's safety needs: said even during a hard effort. */
export const CUE_TIME_CRITICAL: readonly CueEventKind[] = ['pull-off', 'last-wheel'];

/** One bike length, odometer metres: drifting back this close to level with the last wheel, `last-wheel`. **1.8**. */
export const CUE_LAST_WHEEL_METRES = 1.8;

/** `climb` is said this far before a climb, metres: the rotation's hold, **300**. */
export const CUE_CLIMB_AHEAD_METRES = 300;

/** `close-gap`: more than this behind the wheel, metres: **2**. */
export const CUE_GAP_METRES = 2;

/** `close-gap`: for this long, ms: **4 s**. */
export const CUE_GAP_DWELL_MS = 4_000;

/** `surging`: over the group's speed by this, m/s: **2 km/h**. */
export const CUE_SURGE_MPS = 2 / 3.6;

/** `surging`: for this long, ms: **5 s**. */
export const CUE_SURGE_DWELL_MS = 5_000;

/** `past-front`: ahead of the front for this long, ms: **3 s**. */
export const CUE_PAST_FRONT_DWELL_MS = 3_000;

/** `eased-too-much`: more than this behind the last wheel while latching, metres: **5**. */
export const CUE_EASED_METRES = 5;

/** `eased-too-much`: for this long, ms: **2 s**. */
export const CUE_EASED_DWELL_MS = 2_000;

/** `shorter-pull`: a pull whose mean power was over this share of the rider's threshold: **105 %**. */
export const CUE_SHORTER_PULL_SHARE = 1.05;

/** At most one correction this often, ms: **20 s**. Events are exempt. */
export const CUE_CORRECTION_GAP_MS = 20_000;

/** The same correction is said at most this many times in a row; after, it is a mark. */
export const CUE_SAME_CORRECTION_MOST = 2;

/**
 * The most cues a minute a clean rider hears over the fixture ride, asserted
 * by `cues.test.ts` so a change that makes the ride nag goes red: **2.5**.
 */
export const CUE_CEILING_PER_MINUTE = 2.5;

/** What the selector reads, once per decision window. */
export interface CueView {
  /** The rotation's answer for this instant. */
  readonly rotation: RotationStep;
  /** What the rotation read; its `atMs` is the time. */
  readonly line: RotationView;
  /** The rider's power now, watts, or `null` with no reading. */
  readonly powerWatts: number | null;
  /** The rider's own threshold power, watts, or `null` where they set none (`GamePort.ownThresholdPower`). */
  readonly thresholdWatts: number | null;
}

/** An event waiting for its window. */
export interface PendingCue {
  readonly kind: CueEventKind;
  readonly atMs: number;
}

/** The selector's whole state: plain data. */
export interface CueState {
  readonly nextWindowAtMs: number;
  /** The instant of the last decision, or `null` before the first. */
  readonly decidedAtMs: number | null;
  /** The rider's role and the line's phase at the last window, `null` before it. */
  readonly role: RiderRole | null;
  readonly phase: LinePhase | null;
  /** Events detected and not yet said. */
  readonly pending: readonly PendingCue[];
  /** Since when each correction's band has been broken, or `null`. */
  readonly outSinceMs: Readonly<Record<CueCorrectionKind, number | null>>;
  /** When the last correction was said or marked. */
  readonly correctionAtMs: number | null;
  /** The last correction said or marked, and how many times in a row. */
  readonly run: { readonly kind: CueCorrectionKind; readonly times: number } | null;
  /** Quiet marks, by kind, for the debrief (#3310). */
  readonly marks: Readonly<Record<CueCorrectionKind, number>>;
  /** Whether the line is inside the 300 m before a climb, or on it. */
  readonly climbing: boolean;
  /** Whether `last-wheel` has been said in this drift back. */
  readonly lastWheelSaid: boolean;
  /** The rider's power on the front this pull: a sum and a count of windows. */
  readonly pullWatts: { readonly sum: number; readonly windows: number };
  /** Whether a `shorter-pull` waits for the rider to be back on a wheel. */
  readonly shorterPullDue: boolean;
}

/** One window's answer. */
export interface CueStep {
  readonly state: CueState;
  /** The cue to show now, or `null`. */
  readonly cue: Cue | null;
  /** A correction returned as a quiet mark instead of a cue, or `null`. */
  readonly mark: CueCorrectionKind | null;
}

const noneOut: Readonly<Record<CueCorrectionKind, number | null>> = {
  'past-front': null,
  surging: null,
  'eased-too-much': null,
  'close-gap': null,
  'shorter-pull': null,
};

const noMarks: Readonly<Record<CueCorrectionKind, number>> = {
  'past-front': 0,
  surging: 0,
  'eased-too-much': 0,
  'close-gap': 0,
  'shorter-pull': 0,
};

/** The selector before the ride's first window. */
export function startCues(atMs: number): CueState {
  if (!Number.isFinite(atMs)) {
    throw new GroupRideError(
      'view-out-of-range',
      'a cue start must be a finite number of milliseconds',
    );
  }
  return {
    nextWindowAtMs: atMs,
    decidedAtMs: null,
    role: null,
    phase: null,
    pending: [],
    outSinceMs: noneOut,
    correctionAtMs: null,
    run: null,
    marks: noMarks,
    climbing: false,
    lastWheelSaid: false,
    pullWatts: { sum: 0, windows: 0 },
    shorterPullDue: false,
  };
}

/** Whether a role is on a wheel in the line: where `close-gap` and `past-front` apply. */
function onWheel(role: RiderRole): boolean {
  switch (role) {
    case 'second-wheel':
    case 'in-line':
    case 'last-wheel':
    case 'sitting-in':
      return true;
    case 'on-front':
    case 'drifting-back':
    case 'latching':
    case 'gapped':
    case 'off-the-back':
    case 'off-the-front':
      return false;
    default:
      return unknownValue(role);
  }
}

/** Whether a phase is the group easing or waiting for the rider (#3301). */
function regrouping(phase: LinePhase): boolean {
  switch (phase) {
    case 'waiting':
    case 'regrouping':
      return true;
    case 'forming':
    case 'steady':
    case 'changing':
    case 'latching':
      return false;
    default:
      return unknownValue(phase);
  }
}

function member(view: RotationView, id: string): MemberView {
  return view.members[id] as MemberView;
}

/** The events that happened in this window, in {@link CUE_EVENT_KINDS} order. */
function eventsNow(
  state: CueState,
  view: CueView,
  rider: string,
  role: RiderRole,
  climbing: boolean,
): CueEventKind[] {
  const { rotation, line } = view;
  const phase = rotation.state.phase;
  const was = state.role;
  const order = rotation.state.order;
  const last = order[order.length - 1] as string;
  const levelM = member(line, rider).distanceM - member(line, last).distanceM;
  const happened: Record<CueEventKind, boolean> = {
    'next-up': role === 'second-wheel' && was !== 'second-wheel',
    'your-pull': role === 'on-front' && was !== 'on-front',
    'pull-off': rotation.requests.length > 0,
    ease: role === 'drifting-back' && was !== 'drifting-back',
    'last-wheel':
      role === 'drifting-back' && !state.lastWheelSaid && levelM <= CUE_LAST_WHEEL_METRES,
    'back-in-line': was === 'latching' && onWheel(role),
    climb: climbing && !state.climbing,
    regroup: regrouping(phase) && (state.phase === null || !regrouping(state.phase)),
  };
  return CUE_EVENT_KINDS.filter((kind) => happened[kind]);
}

/** Which corrections' bands are broken now. */
function outOfBand(
  view: CueView,
  rider: string,
  role: RiderRole,
  shorterPullDue: boolean,
): Record<CueCorrectionKind, boolean> {
  const { rotation, line } = view;
  const order = rotation.state.order;
  const at = order.indexOf(rider);
  const me = member(line, rider);
  const ahead = at > 0 ? member(line, order[at - 1] as string) : null;
  const front = member(line, order[0] as string);
  const last = member(line, order[order.length - 1] as string);
  return {
    'past-front': onWheel(role) && me.distanceM > front.distanceM,
    surging: role === 'on-front' && me.speedMps > line.groupSpeedMps + CUE_SURGE_MPS,
    'eased-too-much': role === 'latching' && last.distanceM - me.distanceM > CUE_EASED_METRES,
    'close-gap': onWheel(role) && ahead !== null && ahead.distanceM - me.distanceM > CUE_GAP_METRES,
    'shorter-pull': shorterPullDue && onWheel(role),
  };
}

/** How long each correction's band must be broken before it is due, ms. */
const DWELL_MS: Readonly<Record<CueCorrectionKind, number>> = {
  'past-front': CUE_PAST_FRONT_DWELL_MS,
  surging: CUE_SURGE_DWELL_MS,
  'eased-too-much': CUE_EASED_DWELL_MS,
  'close-gap': CUE_GAP_DWELL_MS,
  'shorter-pull': 0,
};

function checkView(state: CueState, view: CueView): void {
  if (state.decidedAtMs !== null && view.line.atMs < state.decidedAtMs) {
    throw new GroupRideError(
      'instant-out-of-order',
      'a cue view time must not be before the last decision',
    );
  }
  for (const watts of [view.powerWatts, view.thresholdWatts]) {
    if (watts !== null && !(Number.isFinite(watts) && watts >= 0)) {
      throw new GroupRideError(
        'view-out-of-range',
        'a power and a threshold must be finite watts of at least zero, or null',
      );
    }
  }
}

/**
 * The cue to show at `view`, if any, and the selector after it. Inside a
 * decision window it says nothing and changes nothing; a line with no rider
 * says nothing at all.
 *
 * @throws {GroupRideError} `view-out-of-range` for a power or threshold that
 *   is not finite watts;
 *   `instant-out-of-order` for a window before the last.
 */
export function stepCues(state: CueState, view: CueView): CueStep {
  checkView(state, view);
  const silent = { cue: null, mark: null } as const;
  if (view.line.atMs < state.nextWindowAtMs) return { state, ...silent };
  const following = state.nextWindowAtMs + ROTATION_WINDOW_MS;
  const nextWindowAtMs =
    following > view.line.atMs ? following : view.line.atMs + ROTATION_WINDOW_MS;
  const rider = view.rotation.state.line.find((each) => each.kind === 'rider')?.id;
  if (rider === undefined) return { state: { ...state, nextWindowAtMs }, ...silent };
  const role = view.rotation.roles[rider] as RiderRole;
  const phase = view.rotation.state.phase;
  const climbAheadM = view.line.climbAheadM;
  const climbing = climbAheadM !== null && climbAheadM <= CUE_CLIMB_AHEAD_METRES;

  // The rider's pull: its mean power, and whether a shorter one is to be suggested after it.
  const onFront = role === 'on-front';
  const pullWatts = onFront
    ? {
        sum:
          state.role === 'on-front'
            ? state.pullWatts.sum + (view.powerWatts ?? 0)
            : (view.powerWatts ?? 0),
        windows:
          (state.role === 'on-front' ? state.pullWatts.windows : 0) +
          (view.powerWatts === null ? 0 : 1),
      }
    : state.pullWatts;
  let shorterPullDue = state.shorterPullDue;
  if (state.role === 'on-front' && !onFront) {
    const { sum, windows } = state.pullWatts;
    shorterPullDue =
      view.thresholdWatts !== null &&
      windows > 0 &&
      sum / windows > CUE_SHORTER_PULL_SHARE * view.thresholdWatts;
  }

  const hard = climbing && state.climbing;
  const detected = eventsNow(state, view, rider, role, climbing);
  const fresh = [
    ...state.pending,
    ...detected.map((kind) => ({ kind, atMs: view.line.atMs })),
  ].filter(
    // Nothing during a hard effort beyond the cue that started it.
    (each) => !hard || CUE_TIME_CRITICAL.includes(each.kind) || each.kind === 'climb',
  );

  const broken = outOfBand(view, rider, role, shorterPullDue);
  const outSinceMs: Record<CueCorrectionKind, number | null> = { ...noneOut };
  for (const kind of CUE_CORRECTION_KINDS) {
    outSinceMs[kind] =
      broken[kind] && !climbing ? (state.outSinceMs[kind] ?? view.line.atMs) : null;
  }

  const base: CueState = {
    ...state,
    nextWindowAtMs,
    decidedAtMs: view.line.atMs,
    role,
    phase,
    climbing,
    // A detected last-wheel is said or queued: either way it is not detected again this drift.
    lastWheelSaid:
      role === 'drifting-back' ? state.lastWheelSaid || detected.includes('last-wheel') : false,
    pullWatts,
    shorterPullDue,
    outSinceMs,
  };

  // No power reading: no cue at all, and nothing waits to be said when it returns.
  if (view.powerWatts === null) return { state: { ...base, pending: [] }, ...silent };

  const [first, ...rest] = fresh;
  if (first !== undefined) {
    return {
      state: { ...base, pending: rest },
      cue: { family: 'event', kind: first.kind },
      mark: null,
    };
  }

  const limitOpen =
    state.correctionAtMs === null || view.line.atMs - state.correctionAtMs >= CUE_CORRECTION_GAP_MS;
  const due = CUE_CORRECTION_KINDS.find((kind) => {
    const since = outSinceMs[kind];
    return since !== null && view.line.atMs - since >= DWELL_MS[kind];
  });
  if (!limitOpen || due === undefined) return { state: { ...base, pending: [] }, ...silent };

  const times = state.run?.kind === due ? state.run.times + 1 : 1;
  const quiet = times > CUE_SAME_CORRECTION_MOST;
  const after: CueState = {
    ...base,
    pending: [],
    correctionAtMs: view.line.atMs,
    run: { kind: due, times },
    marks: quiet ? { ...state.marks, [due]: state.marks[due] + 1 } : state.marks,
    shorterPullDue: due === 'shorter-pull' ? false : shorterPullDue,
  };
  return quiet
    ? { state: after, cue: null, mark: due }
    : { state: after, cue: { family: 'correction', kind: due }, mark: null };
}
