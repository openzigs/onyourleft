// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Riding a saved workout, on the ride screen — #14's last piece.
 *
 * A panel of its own rather than a section of `TrainerPanel.tsx`, because the
 * two answer different questions. That one is the **manual** setpoint: a rider
 * choosing a number and this app writing it. This one hands the setpoint over
 * to a plan, and while it is running the rider is not choosing the number at
 * all — so a screen that mixed them would be offering two things that write to
 * the same control point without saying which is in charge.
 *
 * ## What it will not offer
 *
 * ⚠️ **No Start button until control has been granted.** `startWorkout` refuses
 * without it — a trainer that has not granted control answers every setpoint
 * `0x05 Control Not Permitted`, so a workout started there would run its clock
 * and control nothing, which is #14's revision block's named silent failure.
 * The panel says so in a sentence instead of rendering a control that would
 * fail, which is `TrainerPanel.tsx`'s rule about disabled buttons applied here.
 *
 * ## What is announced, and when — #394, #445
 *
 * ⚠️ **Through ONE region since #445, and this panel is where it lives**
 * (`RideAnnouncer.tsx`). A reviewer who remembers a `live` workout fault and
 * a `WorkoutAnnouncer` here writing the block change straight into its region
 * is reading the old file: those were two voices beside the announcer's
 * throttle, and the region also carries the trainer's *Control lost* and *Not
 * released* now, which `TrainerPanel` used to speak itself.
 *
 * ⚠️ **Why here and not in `RideView`**: the interval sound (#400) plays on
 * the sentence it belongs to, and the sounds are this panel's. And **why it
 * is rendered in every state, first, in a fragment**: *Control lost* can make
 * the trainer uncontrollable, which is the state this panel used to render
 * nothing in — and a region that unmounted or moved to a different parent in
 * that instant would forget what it had seen and say nothing. Being the first
 * child of a fragment is what keeps it the same element whichever branch
 * below it renders.
 *
 * The fault stays on the screen, as a plain `StatusMessage`, for a rider who
 * can see it; only its announcement moved. A library that could not be read
 * stays `live`: it is not something that happens while riding.
 *
 * ⚠️ **Nothing here pre-empts by politeness.** TalkBack treats every region
 * alike (assertive on one Android, polite on another — Roselli, 2026-01-14),
 * so ordering is decided before a sentence is written, not by the role it is
 * written into.
 *
 * ## The sounds — #400
 *
 * For a rider who turned them on (off by default): a tone tracking power
 * against the target the trainer ACKNOWLEDGED (`holdingWatts`, never a target
 * only asked for), and two short rising notes as a block changes — played ON
 * the change, with the *"Now: …"* sentence queued to the announcer in the same
 * event, so the sound is never the only thing offered. ⚠️ The sentence can
 * still be held or dropped by the announcer's order (a *"Control lost"* in the
 * same window outranks it); the sound is not, and the block stays on the panel
 * as *"Now: …"* for a rider who can see it (#448's review). The
 * audio context is resumed inside the rider's press on a workout's *Ride*
 * button and nowhere earlier; a dropped power reading, a paused workout and
 * the end of the workout all silence the tone. `game/audio-cues.ts` holds every
 * one of those rules; this panel only feeds it.
 *
 * ## Re-plans during the ride — #1244, ADR 0048 D-7
 *
 * Two things, and both are the rider's own decision:
 *
 * - **The per-ride switch**, in the chooser, off every time the chooser is
 *   shown (P7). Offered only where a re-plan could happen at all
 *   ({@link WorkoutPanelProps.replansAvailable}), with **the whole of
 *   #1245's disclosure** (`workout/replan-disclosure.ts` §`replanDisclosure`)
 *   written under it, there before it is switched on and never behind a
 *   disclosure widget: it is what leaves the device. The switch's label and
 *   every sentence are that module's, which the privacy policy is held to
 *   word for word, so the screen and the policy cannot say two things. Its
 *   last sentence, *"This is off. …"*, is shown only while the switch is off.
 *   ⚠️ #1329 (owner ruling, 2026-10-13): the switch and the disclosure's
 *   HEADLINE are ABOVE the list, so a rider sees what the switch sends before
 *   choosing a workout; the other eight sentences, in their order, are under
 *   the list, because nine sentences above it would push every *Ride* off the
 *   screen (#422; `rideview.browser.spec.ts` holds both on screen). No word
 *   of the approved wording changed by the move.
 * - ***Keep the plan***, while an accepted move waits for the next block: the
 *   sentence first, then the one 48 px control
 *   (`design/ride-time-controls.ts`). It is not offered at any other time,
 *   because there is nothing to keep the plan from.
 *
 * A move's sentence and the status lines are `workout/replan-text.ts`'s,
 * composed on this device; the control's name is `replan-disclosure.ts`'s.
 * `RideAnnouncer` says the sentence, and the one that says a pause or a lost
 * trainer discarded a waiting move; nothing here is `live` but the answer to
 * the rider's own press, *"The plan stays as it was."* (#445's rule).
 *
 * ## Colour carries nothing
 *
 * The status is a word and the block is a sentence, for `AnalysisView.tsx`'s
 * reason. A progress bar may sit beside them later; it may not replace them.
 */

import { useEffect, useRef, useState, type JSX } from 'react';

import type { Watts } from '@onyourleft/domain';
import type { WorkoutRecord } from '@onyourleft/store';

import type { SideControlState } from '../camera/side-pairing-port';
import { Button } from '../design/Button';
import { StatusMessage } from '../design/StatusMessage';
import {
  deviceStorage,
  type AnnouncementPreference,
  type PreferenceStorage,
} from '../game/hud/announce-preference';
import { RideCues } from '../game/audio-cues';
import type { CueOutput } from '../game/audio-port';
import { readCuePreference, writeCuePreference, type CuePreference } from '../game/cue-preference';
import { SoundControls } from '../game/SoundControls';
import { sharedCueOutput } from '../game/web-audio';
import {
  EASED_DETAIL_SUMMARY,
  workoutRescueDetail,
  workoutRescueHeadline,
} from '../workout/rescue-text';
import { HOLD_LABEL, holdReading, holdSentence } from '../workout/hold-text';
import { TargetBand } from '../workout/TargetBand';
import {
  REPLAN_KEEP_BUTTON,
  REPLAN_SWITCH_LABEL,
  replanDisclosure,
} from '../workout/replan-disclosure';
import {
  PLAN_KEPT,
  REPLAN_DISCARDED,
  REPLAN_LABEL,
  REPLAN_OFF_BUTTON,
  REPLAN_STARTS_AT_NEXT_BLOCK,
  REPLANS_OFF,
  REPLANS_ON_BADGE,
} from '../workout/replan-text';
import { durationText, workoutRow } from '../workouts/library';

import { RideAnnouncer } from './RideAnnouncer';
import { WORKOUT_LIST_LIMIT, type WorkoutPort } from '../workouts/store-port';

import type { RideWorkoutSnapshot, TrainerSnapshot, WorkoutChoices } from './controller';

/** What each player status says to a rider. */
const STATUS_TEXT: Readonly<Record<RideWorkoutSnapshot['status'], string>> = {
  idle: 'Ready',
  running: 'Riding',
  // ⚠️ Not "Stopped". A paused workout keeps every offset and resumes where it
  // left off, and telling a rider it stopped would invite them to restart a
  // session they have not lost.
  paused: 'Paused — it will pick up where you left off',
  finished: 'Finished',
};

/**
 * Why the trainer holds more than the block asks, after "Holding … W."
 * (#1305): the session raised the block's target to the trainer's minimum
 * (#1297), and "Now: …" still words the block as the workout wrote it.
 */
function raisedText(workout: RideWorkoutSnapshot): string {
  return workout.raisedFromWatts === undefined
    ? ''
    : ` This block asks for ${String(workout.raisedFromWatts)} W, which is less than the lowest target this trainer accepts.`;
}

export interface WorkoutPanelProps {
  readonly trainer: TrainerSnapshot;
  readonly workout: RideWorkoutSnapshot | undefined;
  /** `undefined` where this browser has no local store. */
  readonly port?: WorkoutPort | undefined;
  /** The rider's threshold, or `undefined` when they have not set one. */
  readonly thresholdPower?: Watts | undefined;
  /**
   * Start `record`, with what the rider chose for it in the chooser — #1244:
   * whether re-plans are on for this ride. `{}` wherever the switch was not
   * offered, which is off.
   */
  readonly onStart: (record: WorkoutRecord, choices: WorkoutChoices) => void;
  readonly onEnd: () => void;
  /**
   * Whether a re-plan could happen for a workout started now — #1244: the
   * device is signed in to an instance and the rider has set their own two
   * thresholds. `false` or absent, the switch is not shown and every workout
   * starts with re-plans off.
   */
  readonly replansAvailable?: boolean | undefined;
  /** *Keep the plan* — #1244. Absent, the control is not shown. */
  readonly onKeepPlan?: (() => void) | undefined;
  /**
   * *Switch re-plans off* — #1244's review, ADR 0048 D-7: shown beside *End
   * workout* while a workout runs with re-plans on, so the policy's *"switch
   * it off and nothing more is sent"* names a control that exists while
   * something is being sent. Absent, the control is not shown.
   */
  readonly onReplansOff?: (() => void) | undefined;
  /**
   * Whether a ride is in progress — #1244's review. The per-ride switch goes
   * back to off whenever this changes, so *"off at the start of every ride"*
   * holds for a rider who switched it on and started no workout.
   */
  readonly rideInProgress?: boolean | undefined;
  /**
   * Where the rider's announcement choice is read from (#397, #398) — this
   * DEVICE's storage unless a test hands in a double. The sound choice (#400)
   * is read from the same place.
   */
  readonly announcements?: PreferenceStorage | undefined;
  /**
   * The announcement choice the screen above already read, handed on to the
   * ride's one region — #740, @see RideAnnouncerProps.preference.
   */
  readonly announcementPreference?: AnnouncementPreference | undefined;
  /**
   * The rider's live power in watts, or `undefined` when the reading is not
   * live — a dropped meter, none paired. #400's tone reads it, and an
   * `undefined` here SILENCES the tone rather than sounding a floor.
   */
  readonly power?: number | undefined;
  /** Where the sounds go (#400); the platform's Web Audio unless a test hands in a double. */
  readonly sounds?: CueOutput | undefined;
  /** The announcer's clock, in seconds (#445); the wall clock unless a test hands one in. */
  readonly announcerClock?: (() => number) | undefined;
  /**
   * The paired side camera's state, for the ride's one region — #551. This
   * panel holds that region (`RideAnnouncer.tsx`), which is the only reason
   * a camera's state passes through a workout panel.
   */
  readonly sideCamera?: SideControlState | undefined;
  /**
   * #647: the ride may stop if the screen goes off
   * (`RideSnapshot.keepAliveFailed`), for the ride's one region — the same
   * reason {@link sideCamera} passes through this panel.
   */
  readonly keepAliveFailed?: boolean | undefined;
  /**
   * #1318: the lap taken by hand that ended last, for the ride's one region —
   * the same reason {@link sideCamera} passes through this panel.
   */
  readonly lap?: { readonly number: number; readonly sentence: string } | undefined;
}

/** The id the re-plan switch's `aria-describedby` names: the disclosure's headline. */
const REPLAN_DISCLOSURE_HEADLINE_ID = 'oyl-replan-disclosure-headline';

export function WorkoutPanel({
  trainer,
  workout,
  port,
  thresholdPower,
  onStart,
  onEnd,
  replansAvailable,
  onKeepPlan,
  onReplansOff,
  rideInProgress,
  announcements,
  announcementPreference,
  power,
  sounds,
  announcerClock,
  sideCamera,
  keepAliveFailed,
  lap,
}: WorkoutPanelProps): JSX.Element {
  const [saved, setSaved] = useState<readonly WorkoutRecord[]>([]);
  const [loadFault, setLoadFault] = useState<string | undefined>(undefined);
  /**
   * The per-ride switch (#1244, ADR 0048 P7). ⚠️ Off whenever a workout is
   * loaded, so it is off again the next time the chooser is shown: a choice
   * made for one ride is not carried into the next.
   */
  const [replans, setReplans] = useState(false);
  const disclosure = replanDisclosure();
  const loaded = workout !== undefined;
  useEffect(() => {
    if (loaded) setReplans(false);
  }, [loaded]);
  // Off again whenever a ride starts or ends: a choice is for one ride.
  useEffect(() => {
    setReplans(false);
  }, [rideInProgress]);
  const storage = announcements ?? deviceStorage();
  const [sound, setSound] = useState<CuePreference>(() => readCuePreference(storage));
  /** This panel's sounds — made once, fed on every render. @see game/audio-cues.ts */
  const cuesRef = useRef<RideCues | undefined>(undefined);
  cuesRef.current ??= new RideCues(sounds ?? sharedCueOutput(), sound);
  const cues = cuesRef.current;

  // ⚠️ #400's review: the workout outlives this panel — `RideSession` is above
  // the router — so a rider who leaves the Ride screen mid-workout and comes
  // back mounts a FRESH `RideCues`, which used to stay silent for the rest of
  // the workout until they touched a sound control. `rejoin` carries on with a
  // context an earlier press left running, and resumes nothing: a mount is not
  // a gesture. Where the platform suspended the audio meanwhile, the tone stays
  // silent and *Mute sounds* and the volume — shown whenever a workout is — are
  // the press that brings it back (validation 0003, I12). Before the tone
  // effect, so the first render after a return already sounds.
  useEffect(() => {
    cues.rejoin();
  }, [cues]);

  // The tone: power against the ACKNOWLEDGED target, while the workout runs.
  // Anything else — paused, finished, no workout, a dropped reading — is
  // silence, which `RideCues.tone` decides.
  const running = workout?.status === 'running';
  const holding = workout?.holdingWatts;
  useEffect(() => {
    cues.tone({ watts: power, target: running ? holding : undefined });
  }, [cues, power, running, holding]);
  // ⚠️ Leaving the screen ends the sounds: a tone left playing after the panel
  // has gone is #372's shape — a trainer holding the last gradient — in a new
  // place. (The END of a workout needs no line of its own: the effect above
  // then has no running workout and silences the tone.)
  useEffect(() => () => cues.end(), [cues]);
  // #447: the END of a workout, seen from here, lets the platform stop running
  // the audio — `audio-port.ts` §`suspend` weighs it. Only on the transition
  // from a workout to none (or to finished), never on unmount: a rider who
  // leaves this screen mid-workout still has a workout running, and `rejoin`
  // relies on the context being awake when they come back. The game cannot be
  // riding meanwhile — it is another route, and this panel is mounted.
  const active = workout !== undefined && workout.status !== 'finished';
  const wasActive = useRef(active);
  useEffect(() => {
    if (wasActive.current && !active) cues.release();
    wasActive.current = active;
  }, [cues, active]);

  function changeSound(next: CuePreference): void {
    setSound(next);
    writeCuePreference(storage, next);
    cues.set(next);
    // Inside the press: resumes a context the platform suspended.
    cues.begin();
  }

  useEffect(() => {
    if (port === undefined) {
      return;
    }
    let live = true;
    void port.store
      .listWorkouts(port.athleteId, WORKOUT_LIST_LIMIT)
      .then((list) => {
        if (live) setSaved(list);
      })
      .catch(() => {
        if (live) {
          setLoadFault(
            'Your saved workouts could not be read on this device. You can still ride without ' +
              'one.',
          );
        }
      });
    return () => {
      live = false;
    };
  }, [port]);

  // #445: the ride's one region, in every state and always first. @see the
  // module note §"What is announced, and when".
  const region = (
    <RideAnnouncer
      trainer={trainer}
      workout={workout}
      sideCamera={sideCamera}
      keepAliveFailed={keepAliveFailed}
      lap={lap}
      storage={announcements}
      preference={announcementPreference}
      clock={announcerClock}
      // #400: the interval sound, on the block CHANGE — not on the sentence
      // winning the window, which could hold it 3 s or drop it (#448's
      // review). The "Now: …" sentence is queued in the same call, so the
      // sound is never offered alone. @see RideAnnouncerProps.onEvent
      onEvent={(kind) => {
        if (kind === 'interval-now') cues.cue('interval');
      }}
    />
  );
  return (
    <>
      {region}
      {trainer.controllable ? panelBody() : null}
    </>
  );

  function panelBody(): JSX.Element {
    return workout === undefined ? chooser() : riding(workout);
  }

  function riding(workout: RideWorkoutSnapshot): JSX.Element {
    return (
      <section>
        <h3>Workout: {workout.name}</h3>
        {/*
          ⚠️ #605: what to PRESS first, then what is WRONG, then what is merely
          read — where in the workout, what the trainer holds. Measured at
          1280×800 inside the Android shell with a workout eased: in the old
          order *End workout* was last, and cleared the fold by 5 px even with
          the Eased notice cut to one sentence and the ERG form gone, because
          three lines of reading (123 px) and the notice stood between the
          heading and the only control that ends what is holding a stalled
          rider. First, it also stays put when the rider opens *How the target
          comes back* under the notice, which a control after the notice would
          not. The owner's ruling on #605 is that the Eased sentence stays
          VISIBLE beside the ride controls, so it is the reading that moves, not
          the notice. `rideview.browser.spec.ts` §"#605" publishes the margin.
        */}
        {/*
          ⚠️ #1244's review: *Switch re-plans off* on the SAME row as *End
          workout*, and not under the plan-change notice. It is the control
          the privacy policy names for stopping what is being sent, so it is
          on the screen for as long as anything can be sent, where the other
          control that ends things is; and on a row of its own under *Keep
          the plan* it would have pushed that control down by 56 px.
          `rideview.browser.spec.ts` §"#1244" measures both.
        */}
        <div className="oyl-workout-controls">
          <Button
            variant="secondary"
            size="ride"
            type="button"
            onClick={onEnd}
            // #1432: ends the workout's ERG; never stopped by the touch lock.
            touchLockExempt
          >
            End workout
          </Button>
          {workout.replan === undefined ||
          workout.replan.off === true ||
          onReplansOff === undefined ? null : (
            <Button variant="secondary" size="ride" type="button" onClick={onReplansOff}>
              {REPLAN_OFF_BUTTON}
            </Button>
          )}
        </div>
        {workout.replan?.off !== true ? null : (
          // The answer to the rider's own press, so it is `live` (#445).
          // #1329: under the re-plan lines' own label, not the design
          // system's default "Note".
          <StatusMessage tone="info" label={REPLAN_LABEL} live>
            {REPLANS_OFF}
          </StatusMessage>
        )}
        {workout.replan?.waiting === undefined ? null : (
          // #1244: an accepted re-plan waiting for the next block. The
          // sentence, then the one control that drops it. Not `live`:
          // `RideAnnouncer` says it, once.
          <>
            <StatusMessage tone="info" label={REPLAN_LABEL}>
              {workout.replan.waiting.sentence} {REPLAN_STARTS_AT_NEXT_BLOCK}
            </StatusMessage>
            {onKeepPlan === undefined ? null : (
              <Button variant="secondary" size="ride" type="button" onClick={onKeepPlan}>
                {REPLAN_KEEP_BUTTON}
              </Button>
            )}
          </>
        )}
        {workout.replan?.discarded === undefined ? null : (
          // A pause or a lost trainer discarded the waiting move (D-8). One
          // sentence, in the snapshot in which the plan ahead and the graph
          // went back. Not `live`: `RideAnnouncer` says it, once.
          <StatusMessage tone="info" label={REPLAN_LABEL}>
            {REPLAN_DISCARDED}
          </StatusMessage>
        )}
        {workout.replan?.kept !== true ? null : (
          // The answer to the rider's own press, so it is `live` (#445).
          <StatusMessage tone="info" label={REPLAN_LABEL} live>
            {PLAN_KEPT}
          </StatusMessage>
        )}
        {workout.replan?.notice === undefined ? null : (
          // One short line, and never spoken: a failed request changes
          // nothing about the ride (ADR 0048 D-9).
          <StatusMessage tone="info">{workout.replan.notice}</StatusMessage>
        )}
        {workout.rescue === undefined ? null : (
          // #585: the stall rescue's reason, which the workout path used to
          // compute and never show. Not `live`, for the fault's reason below:
          // `RideAnnouncer` speaks it when it appears or changes.
          //
          // ⚠️ #605: ONE sentence on the screen, the rescue's own reason, and
          // the way back and the way out behind a disclosure under it — the
          // owner's ruling. `rideview.browser.spec.ts` §"#605" measures it.
          <StatusMessage
            tone="warning"
            label="Eased"
            more={{
              summary: EASED_DETAIL_SUMMARY,
              detail: workoutRescueDetail(workout.rescue, 'ride-screen'),
            }}
          >
            {workoutRescueHeadline(workout.rescue)}
          </StatusMessage>
        )}
        {workout.hold === undefined ? null : (
          // #1240: the heart-rate hold — the range, the target, and one
          // sentence from `workout/hold-text.ts`, the one module for them.
          // Kept on the screen: it says what the trainer is being told and
          // why, which is trainer-control text (#666). Not `live`:
          // `RideAnnouncer` says it, at most once a minute.
          <StatusMessage tone="info" label={HOLD_LABEL} kept>
            {holdSentence(workout.hold)} {holdReading(workout.hold)}
          </StatusMessage>
        )}
        {workout.fault === undefined ? null : (
          // Not `live` since #445: `RideAnnouncer` speaks it, in order.
          <StatusMessage tone="warning">{workout.fault}</StatusMessage>
        )}
        {sound.enabled ? <SoundControls preference={sound} onChange={changeSound} /> : null}
        <p>
          {STATUS_TEXT[workout.status]} — {durationText(workout.elapsedSeconds)} of{' '}
          {durationText(workout.totalSeconds)}
        </p>
        {workout.nowRiding === undefined ? null : <p>Now: {workout.nowRiding}</p>}
        {/*
          ⚠️ #605's review: `holdingWatts` is the writer's last ACKNOWLEDGED
          write, and it outlives a lost link — the workout does too
          (`controller.ts` §`onControlLost`). Once control is gone this app
          cannot say what the machine holds, so the line says what was last set
          rather than "Holding", and `TrainerPanel`'s "may still be holding …
          can no longer tell" beside it is the statement about the machine.
        */}
        <p>
          {workout.holdingWatts === undefined
            ? 'The trainer has not confirmed a target yet.'
            : trainer.hasControl
              ? `Holding ${String(workout.holdingWatts)} W.${raisedText(workout)}`
              : `The trainer was last set to ${String(workout.holdingWatts)} W.`}
        </p>
        {/*
          #1434: the block being ridden against the target the trainer
          confirmed — the band, the rider's 3 s power and the block's average,
          the time left, and in ERG who holds what. Read, so after every
          sentence above (#605's order). Draws nothing paused, in a free ride,
          a running heart-rate hold or with no confirmed target.
        */}
        <TargetBand workout={workout} />
        {/*
          #1307: the same workout as a picture is NOT drawn here. It is the
          Ride screen's own group, after this one (`views/RideView.tsx`), so a
          landscape tablet can put it under the readings, where there is room
          for it on screen, rather than at the foot of this narrow column.
        */}
      </section>
    );
  }

  function chooser(): JSX.Element {
    const offerReplans =
      replansAvailable === true &&
      trainer.hasControl &&
      thresholdPower !== undefined &&
      saved.length > 0;
    return (
      <section>
        {/*
          #1244, restored on #1332 (the owner's ruling of 2026-10-14): while
          the switch is on, two words say so HERE, on the heading's own line,
          at its end, so nothing under them moves when the switch is pressed.
          Nothing is shown while it is off, which is the default and sends
          nothing.

          ⚠️ BESIDE the heading, not inside it (#1244's fourth review): inside
          the `h3` the heading's name became "Ride a workout Re-plans on",
          and a heading is what a screen-reader user navigates by. It is a
          paragraph straight after the heading, so it is read next.
        */}
        <div className="oyl-workout-heading">
          <h3>Ride a workout</h3>
          {offerReplans && replans ? (
            <p className="oyl-workout-replans-on" data-oyl-replans-on="">
              {REPLANS_ON_BADGE}
            </p>
          ) : null}
        </div>
        {!offerReplans ? null : (
          // #1244: the per-ride switch, only where a workout can be started
          // and a re-plan could happen. #1329: ABOVE the list, with the
          // headline of #1245's disclosure; the rest of it is under the list.
          <div className="oyl-workout-replans">
            <label>
              <input
                type="checkbox"
                role="switch"
                checked={replans}
                aria-describedby={REPLAN_DISCLOSURE_HEADLINE_ID}
                onChange={(event) => {
                  setReplans(event.target.checked);
                }}
              />
              {REPLAN_SWITCH_LABEL}
            </label>
            {/*
              ⚠️ The switch is DESCRIBED by the headline alone, which says
              what switching it on does in one sentence. The paragraphs are
              ordinary text in reading order: nine sentences as one accessible
              description would be read out in one breath on every focus.
            */}
            <div data-oyl-replan-disclosure="headline">
              <p id={REPLAN_DISCLOSURE_HEADLINE_ID}>
                <strong>{disclosure.headline}</strong>
              </p>
            </div>
          </div>
        )}
        {loadFault === undefined ? null : (
          <StatusMessage tone="warning" live>
            {loadFault}
          </StatusMessage>
        )}
        {!trainer.hasControl ? (
          // #1013: trainer-control text, kept on the screen (the mark, not a
          // wrapper, so the measured layout does not move).
          <p data-oyl-kept-visible="">
            Ask the trainer for control first. A workout sets targets on the trainer, and it will
            refuse every one until control is granted.
          </p>
        ) : thresholdPower === undefined ? (
          // ⚠️ Refused rather than defaulted. A workout's targets are shares of
          // threshold, so a substituted threshold would put a made-up number on a
          // trainer — and `analysis/thresholds.ts` is the one place in this
          // program that supplies a default, deliberately.
          <p data-oyl-kept-visible="">
            Set your threshold power on the Analysis screen first. A workout&rsquo;s targets are a
            share of it, so there is no number to send without one.
          </p>
        ) : saved.length === 0 ? (
          <p>No workouts saved on this device yet. Build one on the Workouts screen.</p>
        ) : (
          <ul>
            {saved.map((record) => {
              const row = workoutRow(record);
              return (
                <li key={record.id}>
                  {row.name} — {row.duration}, {row.shape}{' '}
                  <Button
                    variant="secondary"
                    size="ride"
                    type="button"
                    onClick={() => {
                      // ⚠️ #400: inside the press and before anything else — the
                      // one place the audio context may be resumed. The choice is
                      // re-read so one made on Settings since this panel mounted
                      // is the one this workout sounds with.
                      const choice = readCuePreference(storage);
                      setSound(choice);
                      cues.set(choice);
                      cues.begin();
                      onStart(
                        record,
                        replansAvailable === true && replans ? { replans: true } : {},
                      );
                    }}
                  >
                    Ride {row.name}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
        {!offerReplans ? null : (
          // #1244: the disclosure's remaining sentences, in their order, under
          // the list (#1329): the headline and the switch are above it.
          <div data-oyl-replan-disclosure="rest">
            {disclosure.paragraphs.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
            <p>{disclosure.notNeeded}</p>
            {/* True only while it is off (`ReplanDisclosure.offUntilOn`). */}
            {replans ? null : <p>{disclosure.offUntilOn}</p>}
          </div>
        )}
      </section>
    );
  }
}
