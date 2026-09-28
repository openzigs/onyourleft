// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The Ride screen's ONE announcement region — #445.
 *
 * ## What it replaced
 *
 * Until #445 this screen spoke through four writers that could not see one
 * another: #394's `live` regions on *Control lost*, *Not released* and a
 * workout fault, and the workout's own region, into which the block change
 * was written directly and the lookahead through the announcer. So the order
 * `game/hud/announce.ts` states was not what a rider heard: two of them could
 * speak in the same second, and which one a screen reader finished was up to
 * the screen reader. Everything now goes through the announcer core, into this
 * one region, and the order is the core's.
 *
 * ⚠️ **The visible messages did not move.** `TrainerPanel`'s *Control lost*
 * and *Not released* and `WorkoutPanel`'s fault are still on the screen for a
 * rider who can see it — they are plain `StatusMessage`s now, without `live`,
 * because a second writer is exactly what this file exists to remove.
 *
 * | what | kind | said as |
 * |---|---|---|
 * | `TrainerSnapshot.lost`, when it appears or changes | `trainer-lost` | "Control lost: …", the words `TrainerPanel` shows |
 * | `TrainerSnapshot.releaseFault`, likewise | `trainer-lost` | "Not released: …" |
 * | `RideWorkoutSnapshot.fault`, likewise | `workout-fault` | "Heads up: …" |
 * | `RideWorkoutSnapshot.rescue`, when it appears or its reason changes (#585) | `workout-fault` | "Eased: …", the words `WorkoutPanel` shows |
 * | `TrainerSnapshot.ergRescue`, when it appears or its reason changes (#598) | `workout-fault` | "Eased: …", the words `TrainerPanel` shows |
 * | `RideWorkoutSnapshot.nowRiding`, when it changes | `interval-now` | "Now: …" (#394) |
 * | the next block, `lead` seconds before it | `interval-ahead` | #398's sentence |
 * | the side camera's link, when it goes (#551) | `side-camera-lost` | `side-camera.ts` §`SIDE_CAMERA_LOST_SENTENCE` |
 * | `RideSnapshot.keepAliveFailed`, when it appears (#647) | `screen-off-risk` | `controller.ts` §`RIDE_MAY_STOP_SPOKEN` |
 * | `TrainerSnapshot.ergHeld`, per press, announcements ON only (#655) | `erg-held` | "Held: …", `TrainerPanel` §`heldSentence` |
 *
 * **When something APPEARS or CHANGES, never when it is first rendered** —
 * #394's rule, kept: a screen a rider navigates back to, with control already
 * lost, does not announce it again. Each value is remembered on the first
 * render and spoken only once it differs.
 *
 * ## Which clock
 *
 * ⚠️ **The throttle runs on the WALL clock, where the workout's region used
 * the workout's.** The workout's clock stands still while it is paused — and
 * losing control is precisely what pauses a workout (`ride/controller.ts`
 * §`onControlLost`). On that clock, a *Control lost* arriving within three
 * seconds of the last sentence would have waited for a window that never
 * opened. The lookahead still decides WHEN a block is coming on the
 * workout's own clock (`lookahead.ts`), which is correct for it; only the
 * one-sentence-per-window throttle moved. And because a waiting sentence may
 * have no render to carry it, a timer re-asks the core when the window opens.
 *
 * ## A *Set* the stall rescue held — #655
 *
 * The one sentence here that answers the rider's own press. #445 keeps such
 * answers on the form, `live`, where *Refused* is; this region takes this one
 * only when the rider turned announcements ON, and `TrainerPanel` then shows
 * it without `live` — so one voice answers, whichever the rider chose. It is
 * OWED until spoken, as #647's sentence is: `announce.ts` ranks it last of
 * the events (rank 5c) so it never costs a safety sentence its place, and a
 * sentence that is only offered once can be displaced and never said. It is
 * withdrawn, and no longer owed, the moment it stops being true — the rescue
 * handed back and wrote the target, or another press replaced it.
 *
 * ## The same sentence twice is said twice
 *
 * Each sentence the core returns is rendered as a NEW node inside the region,
 * keyed on a count. A region whose text is set to the text it already holds
 * changes nothing a screen reader can hear, so a second *Set* of the same
 * number (#655) — or a second "Control lost" for the same reason — would
 * otherwise be answered by silence. The core decides what is said; this only
 * stops the DOM deciding that it was not.
 *
 * Visually hidden by CLIP (`oyl-visually-hidden`), never `display: none`,
 * `hidden` or `aria-hidden`, any of which would silence it.
 */

import { useEffect, useRef, useState, type JSX } from 'react';

import {
  ANNOUNCE_WINDOW_SECONDS,
  announce,
  INITIAL_ANNOUNCER,
  withdrawPending,
  type AnnouncementEvent,
  type AnnouncementKind,
  type AnnouncerState,
} from '../game/hud/announce';
import {
  deviceStorage,
  readAnnouncementPreference,
  type AnnouncementPreference,
  type PreferenceStorage,
} from '../game/hud/announce-preference';

import type { SideControlState } from '../camera/side-pairing-port';
import {
  EASED_SPOKEN_PREFIX,
  isEasedAnnouncement,
  workoutRescueText,
} from '../workout/rescue-text';

import { RIDE_MAY_STOP_SPOKEN, type RideWorkoutSnapshot, type TrainerSnapshot } from './controller';
import { upcomingBlock } from './lookahead';
import { sideCameraLost, sideCameraLostEvent } from './side-camera';
import { HELD_LABEL, heldSentence, LOSS_REASON, rescueSentence } from './TrainerPanel';

/** The wall clock, in seconds. */
const wallSeconds = (): number => performance.now() / 1000;

export interface RideAnnouncerProps {
  readonly trainer: TrainerSnapshot;
  readonly workout: RideWorkoutSnapshot | undefined;
  /**
   * The paired side camera's state, or `undefined` with no pairing — #551.
   * Its link going is said once, when it goes (`side-camera.ts`
   * §`sideCameraLostEvent`).
   *
   * ⚠️ **Optional, so a caller that stops passing it is green in
   * `check:wiring`** (§Limits' third entry).
   * `ride/side-camera-ride-screen.a11y.test.tsx` drives the Ride screen and
   * reads the region, which is what pins it.
   */
  readonly sideCamera?: SideControlState | undefined;
  /**
   * #647: whether the platform refused to keep the ride alive
   * (`RideSnapshot.keepAliveFailed`). Said once, when it becomes true — not
   * on a first render, and not again while it stays true.
   *
   * ⚠️ Optional, so a caller that stops passing it is green in
   * `check:wiring` (§Limits' third entry);
   * `ride/keep-alive-notice.a11y.test.tsx` §"the Ride screen — #647" drives
   * a refused keep-alive through the real controller and reads this region,
   * which is what pins it.
   */
  readonly keepAliveFailed?: boolean | undefined;
  /** Where the rider's announcement choice is read from. This device's, by default. */
  readonly storage?: PreferenceStorage | undefined;
  /**
   * The rider's announcement choice, already read — #740. The Ride screen
   * reads it ONCE and hands the same object here and to the ERG form, which
   * answers a held *Set* only when this region does not (#655). Read twice,
   * the two agreed only because both happened to read this device's storage
   * in one mount pass; handed down, they agree by construction. Read from
   * {@link storage} only where nothing is handed in.
   */
  readonly preference?: AnnouncementPreference | undefined;
  /**
   * Told the kind of every event as it HAPPENS — the moment it is handed to
   * the announcer, whether or not it then wins the 3 s window. #400's interval
   * sound plays here, on the block change itself.
   *
   * ⚠️ **This used to be `onSaid`, told only what was SPOKEN, and #448's review
   * is why it is not.** Since #445 `interval-now` goes through the announcer's
   * window, so a sound that waited to be said was held up to 3 s behind
   * anything spoken just before, and DROPPED when a higher-ranked event —
   * *"Control lost"* pausing the workout in the same render — took the window.
   * The beep is not only for a screen-reader user: a sighted rider with sounds
   * on and announcements off lost it too. The sentence is still queued in the
   * same call, so the sound is never the only thing offered; what may be
   * dropped by priority is the SENTENCE, and the change is on the panel as
   * *"Now: …"* either way.
   */
  readonly onEvent?: ((kind: AnnouncementKind) => void) | undefined;
  /** The throttle's clock, in seconds. The wall clock unless a test hands one in. */
  readonly clock?: (() => number) | undefined;
}

/** #647's one sentence, as an event. */
const SCREEN_OFF_RISK: AnnouncementEvent = { kind: 'screen-off-risk', text: RIDE_MAY_STOP_SPOKEN };

/** What each watched value last was, so a change is told from a first render. */
interface Seen {
  readonly lost: TrainerSnapshot['lost'];
  readonly releaseFault: string | undefined;
  readonly fault: string | undefined;
  /** The workout's eased sentence (#585), so a change of REASON is a change. */
  readonly eased: string | undefined;
  /**
   * A hand-set ERG target's rescue (#598): its REASON, which is what decides a
   * change, and the sentence the panel shows, which is what is said. Keyed on
   * the reason, as #598 asks, rather than on the sentence: the sentence also
   * names a target the rider set during the rescue, and re-saying the whole
   * rescue for that is not what the issue asked for. That press is answered on
   * its own, by {@link Seen.heldPress} (#655).
   */
  readonly manualReason: string | undefined;
  readonly manualEased: string | undefined;
  readonly nowRiding: string | undefined;
  readonly sideCamera: SideControlState | undefined;
  readonly keepAliveFailed: boolean;
  /**
   * #655: which *Set* the rescue last held, by its press number — a second
   * press of the same target is a new number — and what answers it.
   */
  readonly heldPress: number | undefined;
  readonly heldText: string | undefined;
}

function seenIn(
  trainer: TrainerSnapshot,
  workout: RideWorkoutSnapshot | undefined,
  sideCamera: SideControlState | undefined,
  keepAliveFailed: boolean,
): Seen {
  return {
    lost: trainer.lost,
    releaseFault: trainer.releaseFault,
    fault: workout?.fault,
    eased:
      workout?.rescue === undefined ? undefined : workoutRescueText(workout.rescue, 'ride-screen'),
    manualReason: trainer.ergRescue?.reason,
    manualEased: trainer.ergRescue === undefined ? undefined : rescueSentence(trainer.ergRescue),
    nowRiding: workout?.nowRiding,
    sideCamera,
    keepAliveFailed,
    heldPress: trainer.ergHeld?.press,
    heldText:
      trainer.ergHeld === undefined
        ? undefined
        : `${HELD_LABEL}: ${heldSentence(trainer.ergHeld.target)}`,
  };
}

/** The events one render carries: whatever APPEARED or CHANGED since the last. */
function changes(before: Seen, now: Seen): AnnouncementEvent[] {
  const events: AnnouncementEvent[] = [];
  // ⚠️ A block that CHANGED, not a workout that started: `undefined` to a
  // block is the rider pressing *Ride*, and #394 was that the block is said
  // when it changes and never on first appearance — which is what the region
  // did when it lived inside the running workout's own panel and mounted with
  // it.
  if (
    now.nowRiding !== before.nowRiding &&
    now.nowRiding !== undefined &&
    before.nowRiding !== undefined
  ) {
    events.push({ kind: 'interval-now', text: `Now: ${now.nowRiding}` });
  }
  if (now.fault !== before.fault && now.fault !== undefined) {
    events.push({ kind: 'workout-fault', text: `Heads up: ${now.fault}` });
  }
  // #585: the stall rescue, as `workout-fault` — rank 2 and spoken with
  // announcements off, because it is the machine under the rider holding a
  // different target from the workout's. Said when it appears or its reason
  // changes (a stall going silent, a relief recovering), never when it clears:
  // the full target coming back is felt, and the panel stops saying it.
  if (now.eased !== before.eased && now.eased !== undefined) {
    events.push({ kind: 'workout-fault', text: `${EASED_SPOKEN_PREFIX}${now.eased}` });
  }
  // #598: the same, for a target the rider set by hand on the ERG form (#567).
  // `workout-fault` for #585's reason — the machine under the rider is holding
  // something other than what they asked for — and the same prefix, so a
  // waiting one is withdrawn by the same rule when it clears.
  if (now.manualReason !== before.manualReason && now.manualEased !== undefined) {
    events.push({ kind: 'workout-fault', text: `${EASED_SPOKEN_PREFIX}${now.manualEased}` });
  }
  if (now.releaseFault !== before.releaseFault && now.releaseFault !== undefined) {
    events.push({ kind: 'trainer-lost', text: `Not released: ${now.releaseFault}` });
  }
  if (now.lost !== before.lost && now.lost !== undefined) {
    events.push({ kind: 'trainer-lost', text: `Control lost: ${LOSS_REASON[now.lost]}` });
  }
  const side = sideCameraLostEvent(sideCameraLost(before.sideCamera), now.sideCamera);
  if (side !== undefined) {
    events.push(side);
  }
  // #647: when the refusal APPEARS. Not while it stands — the notice stays on
  // the screen for that — and not again until it has cleared and come back.
  if (now.keepAliveFailed && !before.keepAliveFailed) {
    events.push(SCREEN_OFF_RISK);
  }
  return events;
}

export function RideAnnouncer({
  trainer,
  workout,
  sideCamera,
  keepAliveFailed = false,
  storage,
  preference: handed,
  onEvent,
  clock,
}: RideAnnouncerProps): JSX.Element {
  /** The last sentence, and how many have been said — @see the module note. */
  const [said, setSaid] = useState({ text: '', count: 0 });
  // Read once, when the screen appears: a preference is a setting, not a live
  // value, and a rider changes it on Settings rather than mid-interval.
  const [preference] = useState(
    () => handed ?? readAnnouncementPreference(storage === undefined ? deviceStorage() : storage),
  );
  const announcer = useRef<AnnouncerState>(INITIAL_ANNOUNCER);
  const seen = useRef<Seen>(seenIn(trainer, workout, sideCamera, keepAliveFailed));
  /** The boundary last offered, so one change is announced once. */
  const offered = useRef<number | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const now = useRef(clock ?? wallSeconds);
  now.current = clock ?? wallSeconds;
  const told = useRef(onEvent);
  told.current = onEvent;
  const keepAlive = useRef(keepAliveFailed);
  keepAlive.current = keepAliveFailed;
  /**
   * Whether *"Keep the screen on: …"* has been SPOKEN while the refusal
   * stands — #647. A refusal already standing when the screen appears counts
   * as said: #394's rule, never on a first render.
   *
   * ⚠️ **Spoken, not offered — #693's review.** `announce.ts` holds one
   * pending event, and a higher one arriving (a climb, the next block, the
   * side camera) replaces it; offered once, on the render it appeared, it
   * could be displaced and never said. So {@link hear} offers it on every call
   * until the core returns it, and asks again after each window while it is
   * owed.
   */
  const screenOffSaid = useRef(keepAliveFailed);
  /**
   * The answer to a held *Set* not yet SPOKEN — #655, with announcements on.
   * Owed like {@link screenOffSaid}'s sentence, and for the same reason.
   */
  const heldOwed = useRef<AnnouncementEvent | undefined>(undefined);

  /**
   * One call of the core. ⚠️ The only place this component writes the region,
   * which is the whole of #445: a second writer is a second voice.
   */
  const hear = useRef((events: readonly AnnouncementEvent[]): void => {
    clearTimeout(timer.current);
    // Told BEFORE the core decides what is said, so a sound bound to an event
    // follows the event rather than the window. @see RideAnnouncerProps.onEvent
    for (const event of events) told.current?.(event.kind);
    // #647: owed until said. Only with announcements on — off, the core drops
    // it on every call, and a timer re-asking for ever would say nothing.
    const owed = (): boolean => preference.enabled && keepAlive.current && !screenOffSaid.current;
    const offered =
      owed() && !events.some((event) => event.kind === 'screen-off-risk')
        ? [...events, SCREEN_OFF_RISK]
        : [...events];
    const heldAnswer = heldOwed.current;
    if (heldAnswer !== undefined && !offered.some((event) => event.kind === 'erg-held')) {
      offered.push(heldAnswer);
    }
    const at = now.current();
    const heard = announce(announcer.current, {
      now: at,
      readings: [],
      events: offered,
      // Nothing here is a reading: the Ride screen's numbers are `MetricGrid`'s
      // own per-cell sentences, and a cadence left at its default would say
      // "No power reading" every minute.
      preference: { ...preference, powerEverySeconds: 'never', distanceEvery: 'never' },
    });
    announcer.current = heard.state;
    if (heard.sentence !== undefined) {
      const sentence = heard.sentence;
      setSaid((last) => ({ text: sentence, count: last.count + 1 }));
    }
    if (heard.kind === 'screen-off-risk') {
      screenOffSaid.current = true;
    }
    if (heard.kind === 'erg-held') {
      heldOwed.current = undefined;
    }
    // A sentence that is WAITING for the window has no render to carry it — a
    // paused workout re-renders nothing — so ask again when the window opens.
    // #647's, too, when a higher sentence took the window it was offered in.
    const last = heard.state.lastSpokenAt;
    if (
      (heard.state.pending !== undefined || owed() || heldOwed.current !== undefined) &&
      last !== undefined
    ) {
      const wait = Math.max(0, ANNOUNCE_WINDOW_SECONDS - (at - last)) * 1000;
      timer.current = setTimeout(() => {
        hear.current([]);
      }, wait + 1);
    }
  });

  useEffect(() => () => clearTimeout(timer.current), []);

  const lead = preference.intervalLeadSeconds;
  const timeline = workout?.timeline;
  const elapsedSeconds = workout?.elapsedSeconds;
  const status = workout?.status;
  const {
    lost,
    releaseFault,
    fault,
    eased,
    manualReason,
    manualEased,
    nowRiding,
    heldPress,
    heldText,
  } = seenIn(trainer, workout, sideCamera, keepAliveFailed);

  useEffect(() => {
    const events = changes(seen.current, {
      lost,
      releaseFault,
      fault,
      eased,
      manualReason,
      manualEased,
      nowRiding,
      sideCamera,
      keepAliveFailed,
      heldPress,
      heldText,
    });
    // #655: a new press held, or the held one no longer true. Whatever was
    // owed or waiting for the last press is taken back first — a hand-back
    // wrote that target, and a newer press is the one to answer.
    if (heldPress !== seen.current.heldPress) {
      heldOwed.current = undefined;
      announcer.current = withdrawPending(announcer.current, (event) => event.kind === 'erg-held');
      if (preference.enabled && heldPress !== undefined && heldText !== undefined) {
        heldOwed.current = { kind: 'erg-held', text: heldText };
      }
    }
    // Cleared while its sentence was still waiting for the window: take it
    // back, or "Eased" is said after the full target is back (PR #599's
    // review, N1).
    // The same for a hand-set target's rescue (#598). The two cannot stand at
    // once — a workout's ERG and the form's are one control point, and
    // `ride/controller.ts` closes the manual writer when a workout starts.
    if (
      (seen.current.eased !== undefined && eased === undefined) ||
      (seen.current.manualReason !== undefined && manualReason === undefined)
    ) {
      announcer.current = withdrawPending(announcer.current, isEasedAnnouncement);
    }
    // #647: the service came up while its sentence waited — it is no longer
    // true, so it is not said.
    if (seen.current.keepAliveFailed && !keepAliveFailed) {
      screenOffSaid.current = false;
      announcer.current = withdrawPending(
        announcer.current,
        (event) => event.kind === 'screen-off-risk',
      );
    }
    seen.current = {
      lost,
      releaseFault,
      fault,
      eased,
      manualReason,
      manualEased,
      nowRiding,
      sideCamera,
      keepAliveFailed,
      heldPress,
      heldText,
    };
    if (
      preference.enabled &&
      lead !== 'never' &&
      status === 'running' &&
      timeline !== undefined &&
      elapsedSeconds !== undefined
    ) {
      const ahead = upcomingBlock(timeline, elapsedSeconds, lead);
      if (ahead !== undefined && ahead.boundary !== offered.current) {
        offered.current = ahead.boundary;
        events.push({ kind: 'interval-ahead', text: ahead.sentence });
      }
    }
    hear.current(events);
  }, [
    lost,
    releaseFault,
    fault,
    eased,
    manualReason,
    manualEased,
    nowRiding,
    sideCamera,
    keepAliveFailed,
    heldPress,
    heldText,
    preference,
    lead,
    timeline,
    elapsedSeconds,
    status,
  ]);

  return (
    <p className="oyl-visually-hidden" role="status" data-oyl-announcer="ride">
      {/* A new node per sentence — @see the module note §"said twice". */}
      <span key={said.count}>{said.text}</span>
    </p>
  );
}
